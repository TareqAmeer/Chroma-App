package com.tareq.chromasmith;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import android.net.Uri;
import android.webkit.WebView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.io.File;

import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** JPEG-only binary save bridge, restricted to the app's main frame and Photos album. */
@CapacitorPlugin(name="PhotoExport",permissions={@Permission(alias="publicPhotos",strings={Manifest.permission.WRITE_EXTERNAL_STORAGE})})
public class PhotoExportPlugin extends Plugin {
    private final ExecutorService writer=Executors.newSingleThreadExecutor();
    private Request pending;
    private final android.os.Handler deadline=new android.os.Handler(android.os.Looper.getMainLooper());
    private boolean writing;
    private final java.util.LinkedHashMap<String,JSObject> completed=new java.util.LinkedHashMap<>();
    private static final class Request {
        final String id,name;final int size;
        Request(String id,String name,int size){this.id=id;this.name=name;this.size=size;}
    }
    @Override public void load() {
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                ||!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER))return;
        WebViewCompat.addWebMessageListener(getBridge().getWebView(),"ChromaPhotoExport",
                Collections.singleton("https://localhost"),this::message);
    }
    private void reply(JavaScriptReplyProxy proxy,String id,String status,String detail) {
        try {
            JSONObject data=new JSONObject();data.put("id",id);data.put("status",status);
            data.put(status.equals("saved")?"path":"error",detail);
            getActivity().runOnUiThread(()->proxy.postMessage(data.toString()));
        }catch(Exception ignored){}
    }
    private synchronized void message(WebView view,WebMessageCompat message,Uri origin,
                                      boolean mainFrame,JavaScriptReplyProxy proxy) {
        if(!mainFrame||!"https".equals(origin.getScheme())||!"localhost".equals(origin.getHost()))return;
        if(message.getType()==WebMessageCompat.TYPE_STRING) {
            String id="";
            try {
                JSONObject header=new JSONObject(message.getData());id=header.getString("id");
                if(!id.matches("[a-zA-Z0-9-]{1,80}"))throw new IllegalArgumentException("Invalid export ID");
                if(writing||pending!=null)throw new IllegalStateException("A photo save is already running");
                int size=header.getInt("size");
                String name=header.getString("name").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_");
                if(name.startsWith("."))name="_"+name;
                if(size<4||size>64*1024*1024||name.isEmpty()||name.length()>220
                        ||!name.toLowerCase(java.util.Locale.ROOT).matches(".*\\.jpe?g"))
                    throw new IllegalArgumentException("Invalid JPEG export");
                pending=new Request(id,name,size);Request waiting=pending;
                deadline.postDelayed(()->{synchronized(this){if(pending==waiting)pending=null;}},30000);
                reply(proxy,id,"ready","");
            }catch(Exception e){reply(proxy,id,"error",e.getMessage()==null?"Photo save failed":e.getMessage());}
            return;
        }
        if(message.getType()!=WebMessageCompat.TYPE_ARRAY_BUFFER||pending==null||writing)return;
        Request request=pending;pending=null;
        byte[] data=message.getArrayBuffer();
        if(data.length!=request.size||data[0]!=(byte)0xff||data[1]!=(byte)0xd8){
            reply(proxy,request.id,"error","Invalid JPEG bytes");return;
        }
        writing=true;
        writer.execute(()->save(request,data,proxy));
    }
    private void finish(JavaScriptReplyProxy proxy,Request request,String status,String detail) {
        synchronized(this){
            writing=false;
            JSObject result=new JSObject();result.put("status",status);
            result.put(status.equals("saved")?"path":"error",detail);completed.put(request.id,result);
            while(completed.size()>20)completed.remove(completed.keySet().iterator().next());
        }
        reply(proxy,request.id,status,detail);
    }
    @PluginMethod public synchronized void status(PluginCall call){
        String id=call.getString("id","");
        if(!id.matches("[a-zA-Z0-9-]{1,80}")){call.reject("Invalid export ID");return;}
        JSObject result=completed.get(id);
        if(result==null){result=new JSObject();result.put("status","unconfirmed");}
        call.resolve(result);
    }
    @PluginMethod public void prepare(PluginCall call){
        if(Build.VERSION.SDK_INT<29&&getPermissionState("publicPhotos")!=PermissionState.GRANTED){
            if(Boolean.TRUE.equals(call.getBoolean("checkOnly",false))){JSObject result=new JSObject();result.put("persistent",false);result.put("needsPermission",new PublicPhotoStore(getContext()).hasExisting());call.resolve(result);}
            else requestPermissionForAlias("publicPhotos",call,"publicPermission");
            return;
        }
        writer.execute(()->{
            int[] moved=new PublicPhotoStore(getContext()).migrateExisting();JSObject result=new JSObject();
            result.put("persistent",true);result.put("migrated",moved[0]);result.put("failed",moved[1]);call.resolve(result);
        });
    }
    @PermissionCallback private void publicPermission(PluginCall call){
        if(getPermissionState("publicPhotos")==PermissionState.GRANTED)prepare(call);
        else call.reject("Storage permission is required to save photos that survive uninstall");
    }
    @PluginMethod public void savePhoto(PluginCall call){
        if(Build.VERSION.SDK_INT<29&&getPermissionState("publicPhotos")!=PermissionState.GRANTED){call.reject("Storage permission denied");return;}
        writer.execute(()->{
            try{
                Uri source=Uri.parse(call.getString("path",""));
                if(!"file".equals(source.getScheme())||source.getPath()==null)throw new IllegalArgumentException("Invalid cached photo path");
                File file=new File(source.getPath()).getCanonicalFile();String cache=getContext().getCacheDir().getCanonicalPath()+File.separator;
                if(!file.getPath().startsWith(cache)||!file.isFile())throw new IllegalArgumentException("Photo must be in the export cache");
                Uri saved=new PublicPhotoStore(getContext()).saveFile(call.getString("name"),file);
                JSObject result=new JSObject();result.put("path",saved.toString());result.put("persistent",true);call.resolve(result);
            }catch(Exception error){call.reject(error.getMessage()==null?"Photo save failed":error.getMessage());}
        });
    }
    private void save(Request request,byte[] data,JavaScriptReplyProxy proxy) {
        try {
            if(Build.VERSION.SDK_INT<29&&getPermissionState("publicPhotos")!=PermissionState.GRANTED)throw new java.io.IOException("Storage permission denied");
            Uri saved=new PublicPhotoStore(getContext()).saveBytes(request.name,data);
            finish(proxy,request,"saved",saved.toString());
        }catch(Exception error){finish(proxy,request,"error",error.getMessage()==null?"Photo save failed":error.getMessage());}
    }
    @Override protected void handleOnDestroy(){deadline.removeCallbacksAndMessages(null);writer.shutdown();}
}
