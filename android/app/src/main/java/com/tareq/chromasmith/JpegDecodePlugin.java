package com.tareq.chromasmith;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ColorSpace;
import android.media.ExifInterface;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.util.UUID;
import java.util.Collections;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Restore JPEG pixels only when WebView's low-memory decoder reduced the source. */
@CapacitorPlugin(name="JpegDecode")
public class JpegDecodePlugin extends Plugin {
    private final ExecutorService decoder=Executors.newSingleThreadExecutor();
    private final Handler expiry=new Handler(Looper.getMainLooper());
    private volatile boolean closed;
    // Accessed on decoder only. One bitmap; bounded row replies, no files or media permissions.
    private Bitmap bitmap;
    private String token;
    @Override public void load(){
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                ||!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER))return;
        WebViewCompat.addWebMessageListener(getBridge().getWebView(),"ChromaJpegDecode",Collections.singleton("https://localhost"),
            (view,message,origin,mainFrame,proxy)->{
                if(!mainFrame||!"https".equals(origin.getScheme())||!"localhost".equals(origin.getHost())
                        ||message.getType()!=WebMessageCompat.TYPE_STRING)return;
                String header=message.getData();if(header==null||header.length()>256)return;
                try{
                    JSONObject request=new JSONObject(header);String id=request.getString("token");int y=request.getInt("y"),height=request.getInt("height");
                    decoder.execute(()->{
                        try{byte[] packet=readRows(id,y,height,true);if(!closed)getActivity().runOnUiThread(()->{if(!closed)proxy.postMessage(packet);});}
                        catch(Exception|OutOfMemoryError error){
                            JSObject failure=new JSObject();failure.put("token",id);failure.put("y",y);failure.put("error",error.getMessage()==null?"JPEG row decode failed":error.getMessage());
                            if(!closed)getActivity().runOnUiThread(()->{if(!closed)proxy.postMessage(failure.toString());});
                        }
                    });
                }catch(Exception ignored){}
            });
    }
    private void release(){if(bitmap!=null)bitmap.recycle();bitmap=null;token=null;expiry.removeCallbacksAndMessages(null);}
    private void touch(){
        expiry.removeCallbacksAndMessages(null);String expected=token;
        expiry.postDelayed(()->{try{if(!closed)decoder.execute(()->{if(expected!=null&&expected.equals(token))release();});}catch(java.util.concurrent.RejectedExecutionException ignored){}},60000);
    }
    @PluginMethod public void begin(PluginCall call){
        decoder.execute(()->{
            Bitmap decoded=null;
            try{
                if(closed)throw new IllegalStateException("JPEG decoder unavailable");
                if(bitmap!=null)throw new IllegalStateException("A JPEG decode is already running");
                String encoded=call.getString("data","");
                if(encoded.length()<8||encoded.length()>90*1024*1024)throw new IllegalArgumentException("Invalid JPEG size");
                byte[] bytes=Base64.decode(encoded,Base64.DEFAULT);
                if(bytes.length<4||bytes.length>64*1024*1024||bytes[0]!=(byte)255||bytes[1]!=(byte)216)
                    throw new IllegalArgumentException("Invalid JPEG bytes");
                BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;
                BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);
                if(bounds.outWidth<1||bounds.outHeight<1||bounds.outWidth>16384||bounds.outHeight>16384
                        ||(long)bounds.outWidth*bounds.outHeight>24_000_000L||!"image/jpeg".equals(bounds.outMimeType))
                    throw new IllegalArgumentException("Full-resolution JPEG exceeds this fallback's 24MP limit");
                int orientation=1;
                try{orientation=new ExifInterface(new ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION,1);}catch(java.io.IOException ignored){}
                BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=1;options.inScaled=false;
                options.inPreferredConfig=Bitmap.Config.ARGB_8888;
                if(Build.VERSION.SDK_INT>=26)options.inPreferredColorSpace=ColorSpace.get(ColorSpace.Named.SRGB);
                decoded=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
                if(decoded==null||decoded.getWidth()!=bounds.outWidth||decoded.getHeight()!=bounds.outHeight)
                    throw new IllegalStateException("Could not decode the full-resolution JPEG");
                if(closed)throw new IllegalStateException("JPEG decoder unavailable");
                bitmap=decoded;decoded=null;token=UUID.randomUUID().toString();touch();
                JSObject result=new JSObject();result.put("token",token);result.put("width",bitmap.getWidth());result.put("height",bitmap.getHeight());
                result.put("orientation",orientation>=1&&orientation<=8?orientation:1);call.resolve(result);
            }catch(Exception|OutOfMemoryError error){call.reject(error.getMessage()==null?"Full-resolution JPEG decode failed":error.getMessage());}
            finally{if(decoded!=null)decoded.recycle();}
        });
    }
    private byte[] readRows(String id,int y,int height,boolean binary){
                if(closed||bitmap==null||!token.equals(id))throw new IllegalStateException("JPEG decode expired");
                int width=bitmap.getWidth();
                if(y<0||height<1||height>128||y>bitmap.getHeight()-height||(long)width*height>1_048_576L)
                    throw new IllegalArgumentException("Invalid JPEG row range");
                int[] pixels=new int[width*height];bitmap.getPixels(pixels,0,width,0,y,width,height);
                int offset=binary?44:0;byte[] rgba=new byte[pixels.length*4+offset];
                if(binary){System.arraycopy(id.getBytes(StandardCharsets.US_ASCII),0,rgba,0,36);ByteBuffer.wrap(rgba).order(ByteOrder.LITTLE_ENDIAN).putInt(36,y).putInt(40,height);}
                for(int i=0,j=offset;i<pixels.length;i++){int color=pixels[i];rgba[j++]=(byte)(color>>16);rgba[j++]=(byte)(color>>8);rgba[j++]=(byte)color;rgba[j++]=(byte)(color>>>24);}
                touch();return rgba;
    }
    @PluginMethod public void rows(PluginCall call){
        decoder.execute(()->{
            try{
                byte[] rgba=readRows(call.getString("token"),call.getInt("y",-1),call.getInt("height",0),false);
                JSObject result=new JSObject();result.put("data",Base64.encodeToString(rgba,Base64.NO_WRAP));call.resolve(result);
            }catch(Exception|OutOfMemoryError error){call.reject(error.getMessage()==null?"JPEG row decode failed":error.getMessage());}
        });
    }
    @PluginMethod public void end(PluginCall call){decoder.execute(()->{if(token!=null&&token.equals(call.getString("token")))release();call.resolve();});}
    @Override protected void handleOnDestroy(){closed=true;expiry.removeCallbacksAndMessages(null);decoder.execute(this::release);decoder.shutdown();}
}
