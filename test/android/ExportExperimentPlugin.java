// Benchmark-only source. The staging script installs this in src/debug, never src/main.
package com.tareq.chromasmith;

import android.content.ContentValues;
import android.graphics.Bitmap;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;

@CapacitorPlugin(name="ExportExperiment")
public class ExportExperimentPlugin extends Plugin {
  private ServerSocket server;
  private final String token=UUID.randomUUID().toString();
  @PluginMethod public void start(PluginCall call) {
    try {
      if(server==null) {
        server=new ServerSocket(0,4,InetAddress.getByName("127.0.0.1"));
        new Thread(()->{while(!server.isClosed())try{Socket s=server.accept();handle(s);}catch(Exception e){android.util.Log.e("ExportExperiment","request",e);}},"export-experiment").start();
      }
      JSObject r=new JSObject();r.put("url","http://127.0.0.1:"+server.getLocalPort()+"/"+token);call.resolve(r);
    }catch(Exception e){call.reject(e.toString());}
  }
  @PluginMethod public void base64Save(PluginCall call) {
    new Thread(()->{try{call.resolve(save(Base64.decode(call.getString("data"),Base64.DEFAULT),"jpeg",0,0,call.getString("destination","files")));}catch(Exception e){call.reject(e.toString());}}).start();
  }
  private String line(InputStream in)throws IOException {
    ByteArrayOutputStream b=new ByteArrayOutputStream();int c;
    while((c=in.read())!=-1){if(c==10)break;if(c!=13)b.write(c);if(b.size()>8192)throw new IOException("header too long");}
    return b.toString("UTF-8");
  }
  private void handle(Socket socket)throws Exception {
    try(Socket s=socket){s.setSoTimeout(30000);InputStream in=new BufferedInputStream(s.getInputStream());
      String request=line(in);Map<String,String> headers=new HashMap<>();String l;
      while(!(l=line(in)).isEmpty()){int i=l.indexOf(':');if(i>0)headers.put(l.substring(0,i).toLowerCase(Locale.ROOT),l.substring(i+1).trim());}
      if(!request.contains(" /"+token+" ")){respond(s,403,"{}");return;}
      if(request.startsWith("OPTIONS ")){respond(s,200,"{}");return;}
      int length=Integer.parseInt(headers.getOrDefault("content-length","0"));
      if(length<=0||length>110000000)throw new IOException("invalid body length");
      byte[] data=in.readNBytes(length);if(data.length!=length)throw new IOException("short body");
      JSObject result=save(data,headers.getOrDefault("x-mode","jpeg"),Integer.parseInt(headers.getOrDefault("x-width","0")),Integer.parseInt(headers.getOrDefault("x-height","0")),headers.getOrDefault("x-destination","files"));
      respond(s,200,result.toString());
    }
  }
  private void respond(Socket s,int status,String body)throws IOException {
    byte[] bytes=body.getBytes(StandardCharsets.UTF_8);
    s.getOutputStream().write(("HTTP/1.1 "+status+" OK\r\nAccess-Control-Allow-Origin: https://localhost\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type,x-mode,x-width,x-height,x-destination\r\nAccess-Control-Allow-Private-Network: true\r\nContent-Type: application/json\r\nContent-Length: "+bytes.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
    s.getOutputStream().write(bytes);s.getOutputStream().flush();
  }
  private JSObject save(byte[] data,String mode,int w,int h,String destination)throws Exception {
    long started=System.nanoTime();double encode=0;
    if(mode.equals("rgba")) {
      if(w<=0||h<=0||(long)w*h*4!=data.length)throw new IOException("wrong RGBA dimensions");
      Bitmap bm=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);bm.copyPixelsFromBuffer(ByteBuffer.wrap(data));
      ByteArrayOutputStream out=new ByteArrayOutputStream();if(!bm.compress(Bitmap.CompressFormat.JPEG,99,out))throw new IOException("encode failed");
      bm.recycle();data=out.toByteArray();encode=(System.nanoTime()-started)/1e6;
    }
    long saveStart=System.nanoTime();String name="experiment-"+UUID.randomUUID()+".jpg",path;
    if(destination.equals("photos")) {
      ContentValues values=new ContentValues();values.put(MediaStore.Images.Media.DISPLAY_NAME,name);values.put(MediaStore.Images.Media.MIME_TYPE,"image/jpeg");
      values.put(MediaStore.Images.Media.RELATIVE_PATH,"Pictures/ChromaExperiments");values.put(MediaStore.Images.Media.IS_PENDING,1);
      Uri uri=getContext().getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);
      if(uri==null)throw new IOException("MediaStore insert failed");
      try{try(OutputStream out=getContext().getContentResolver().openOutputStream(uri)){if(out==null)throw new IOException("no stream");out.write(data);}values.clear();values.put(MediaStore.Images.Media.IS_PENDING,0);getContext().getContentResolver().update(uri,values,null,null);}
      catch(Exception e){getContext().getContentResolver().delete(uri,null,null);throw e;}
      path="/sdcard/Pictures/ChromaExperiments/"+name;
    } else {
      File file=new File(getContext().getExternalFilesDir(null),name);try(OutputStream out=new FileOutputStream(file)){out.write(data);}path=file.getAbsolutePath();
    }
    JSObject r=new JSObject();r.put("path",path);r.put("bytes",data.length);r.put("encodeMs",encode);r.put("writeMs",(System.nanoTime()-saveStart)/1e6);r.put("nativeMs",(System.nanoTime()-started)/1e6);return r;
  }
  @Override protected void handleOnDestroy(){try{if(server!=null)server.close();}catch(Exception ignored){}}
}
