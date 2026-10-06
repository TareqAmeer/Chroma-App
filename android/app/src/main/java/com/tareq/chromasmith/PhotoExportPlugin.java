package com.tareq.chromasmith;

import android.media.MediaScannerConnection;
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
import java.io.FileOutputStream;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** JPEG-only binary save bridge, restricted to the app's main frame and Photos album. */
@CapacitorPlugin(name="PhotoExport")
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
    private void save(Request request,byte[] data,JavaScriptReplyProxy proxy) {
        File temporary=null;
        try {
            File[] roots=getContext().getExternalMediaDirs();
            if(roots.length==0||roots[0]==null)throw new java.io.IOException("Photos storage unavailable");
            // Same location as the existing Media plugin, preserving the user's album.
            File album=new File(roots[0],"Chromasmith");
            if(!album.isDirectory()&&!album.mkdirs())throw new java.io.IOException("Cannot create Photos album");
            File target=new File(album,request.name);int dot=request.name.lastIndexOf('.');
            String base=request.name.substring(0,dot),ext=request.name.substring(dot);
            for(int n=2;target.exists();n++){
                if(n>10000)throw new java.io.IOException("Too many exports use this filename");
                target=new File(album,base+" ("+n+")"+ext);
            }
            temporary=new File(album,".chromasmith-export-"+UUID.randomUUID()+".tmp");
            try(FileOutputStream stream=new FileOutputStream(temporary)){stream.write(data);}
            // Publish a complete file; scanning never sees the partially written JPEG.
            if(!temporary.renameTo(target))throw new java.io.IOException("Cannot publish exported photo");
            String path=target.getAbsolutePath();
            MediaScannerConnection.scanFile(getContext(),new String[]{path},new String[]{"image/jpeg"},
                    (scanned,uri)->finish(proxy,request,uri==null?"error":"saved",
                            uri==null?"Photo written but gallery registration failed":Uri.fromFile(new File(path)).toString()));
        }catch(Exception e){finish(proxy,request,"error",e.getMessage()==null?"Photo save failed":e.getMessage());}
        finally{if(temporary!=null&&temporary.exists())temporary.delete();}
    }
    @Override protected void handleOnDestroy(){deadline.removeCallbacksAndMessages(null);writer.shutdown();}
}
