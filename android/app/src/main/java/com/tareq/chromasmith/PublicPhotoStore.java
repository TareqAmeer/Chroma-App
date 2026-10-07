package com.tareq.chromasmith;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.os.Environment;
import android.provider.MediaStore;
import java.io.*;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Exported user photos belong in shared Pictures, never in an app-specific directory. */
final class PublicPhotoStore {
    private final Context context;
    PublicPhotoStore(Context context){this.context=context;}
    static String name(String value){
        if(value==null)throw new IllegalArgumentException("Photo filename required");
        String clean=value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_");
        if(clean.startsWith("."))clean="_"+clean;
        if(clean.isEmpty()||clean.length()>220)throw new IllegalArgumentException("Invalid photo filename");
        return clean;
    }
    private static String mime(String name){
        String ext=name.substring(name.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);
        switch(ext){
            case "jpg":case "jpeg":return "image/jpeg";
            case "png":return "image/png";
            case "webp":return "image/webp";
            case "avif":return "image/avif";
            case "heic":case "heif":return "image/heic";
            case "tif":case "tiff":return "image/tiff";
            case "gif":return "image/gif";
            case "mp4":case "m4v":return "video/mp4";
            case "mov":return "video/quicktime";
            case "webm":return "video/webm";
            case "3gp":return "video/3gpp";
            default:throw new IllegalArgumentException("Unsupported photo format");
        }
    }
    Uri saveBytes(String filename,byte[] bytes)throws Exception{
        return write(name(filename),new ByteArrayInputStream(bytes),bytes.length,false);
    }
    Uri saveFile(String filename,File file)throws Exception{
        return saveFile(filename,file,false);
    }
    private Uri saveFile(String filename,File file,boolean verify)throws Exception{
        return write(name(filename),new FileInputStream(file),file.length(),verify);
    }
    private Uri write(String filename,InputStream input,long expected,boolean verify)throws Exception{
        Uri uri=null;File target=null,temporary=null;boolean complete=false;
        try(InputStream source=new BufferedInputStream(input)){
            if(expected<4)throw new IOException("Invalid photo bytes");
            String type=mime(filename);boolean video=type.startsWith("video/");String directory=video?Environment.DIRECTORY_MOVIES:Environment.DIRECTORY_PICTURES;
            source.mark(16);byte[] header=new byte[8];int read=source.read(header);source.reset();
            if((type.equals("image/jpeg")&&(read<2||header[0]!=(byte)255||header[1]!=(byte)216))
                    ||(type.equals("image/png")&&(read!=8||!Arrays.equals(header,new byte[]{(byte)137,80,78,71,13,10,26,10}))))
                throw new IOException("Photo format does not match its filename");
            OutputStream output;
            if(Build.VERSION.SDK_INT>=29){
                ContentValues values=new ContentValues();values.put(MediaStore.Images.Media.DISPLAY_NAME,filename);
                values.put(MediaStore.Images.Media.MIME_TYPE,type);
                values.put(MediaStore.Images.Media.RELATIVE_PATH,directory+"/Chromasmith/");
                values.put(MediaStore.Images.Media.IS_PENDING,1);
                uri=context.getContentResolver().insert(video?MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY):MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),values);
                if(uri==null)throw new IOException("Cannot create public photo");
                output=context.getContentResolver().openOutputStream(uri,"w");
            }else{
                File album=new File(Environment.getExternalStoragePublicDirectory(directory),"Chromasmith");
                if(!album.isDirectory()&&!album.mkdirs())throw new IOException("Cannot create public Photos album");
                int dot=filename.lastIndexOf('.');String base=filename.substring(0,dot),ext=filename.substring(dot);
                for(int n=1;n<=10000;n++){
                    File candidate=new File(album,base+(n==1?"":" ("+n+")")+ext);
                    if(candidate.createNewFile()){target=candidate;break;}
                }
                if(target==null)throw new IOException("Too many exports use this filename");
                temporary=new File(album,".chromasmith-export-"+UUID.randomUUID()+".tmp");
                output=new FileOutputStream(temporary);
            }
            if(output==null)throw new IOException("Cannot write public photo");
            // New saves close a complete native write before publication. Full checksum
            // readback is reserved for migration, where an old copy is about to be removed.
            MessageDigest digest=verify?MessageDigest.getInstance("SHA-256"):null;long count=0;byte[] buffer=new byte[65536];
            try(OutputStream stream=output){int n;while((n=source.read(buffer))!=-1){stream.write(buffer,0,n);if(digest!=null)digest.update(buffer,0,n);count+=n;}}
            if(count!=expected)throw new IOException("Incomplete photo write");
            byte[] wanted=verify?digest.digest():null;
            if(Build.VERSION.SDK_INT>=29){
                if(verify)try(InputStream written=originalInput(uri)){
                    if(written==null||!Arrays.equals(wanted,hash(written)))throw new IOException("Public photo verification failed");
                }
                ContentValues published=new ContentValues();published.put(MediaStore.Images.Media.IS_PENDING,0);
                if(context.getContentResolver().update(uri,published,null,null)!=1)throw new IOException("Cannot publish public photo");
            }else{
                if(verify)try(InputStream written=new FileInputStream(temporary)){
                    if(!Arrays.equals(wanted,hash(written)))throw new IOException("Public photo verification failed");
                }
                if(!temporary.renameTo(target))throw new IOException("Cannot publish public photo");
                CountDownLatch scanned=new CountDownLatch(1);final Uri[] result={null};
                MediaScannerConnection.scanFile(context,new String[]{target.getAbsolutePath()},new String[]{type},(path,item)->{result[0]=item;scanned.countDown();});
                if(!scanned.await(20,TimeUnit.SECONDS)||result[0]==null)throw new IOException("Public photo gallery registration failed");
                uri=result[0];
            }
            complete=true;return uri;
        }finally{
            if(!complete){
                if(Build.VERSION.SDK_INT>=29&&uri!=null)try{context.getContentResolver().delete(uri,null,null);}catch(Exception ignored){}
                if(target!=null)target.delete();
            }
            if(temporary!=null)temporary.delete();
        }
    }
    private static byte[] hash(InputStream stream)throws Exception{
        MessageDigest digest=MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[65536];int n;
        while((n=stream.read(buffer))!=-1)digest.update(buffer,0,n);return digest.digest();
    }
    private InputStream originalInput(Uri uri)throws IOException{
        // Own public rows are writable. Opening read/write verifies the original EXIF
        // bytes without read-only MediaStore GPS redaction or requesting location access.
        ParcelFileDescriptor fd=context.getContentResolver().openFileDescriptor(uri,"rw");
        return fd==null?null:new ParcelFileDescriptor.AutoCloseInputStream(fd);
    }
    private boolean same(Uri publicUri,File original){
        try(InputStream a=originalInput(publicUri);InputStream b=new FileInputStream(original)){
            return a!=null&&Arrays.equals(hash(a),hash(b));
        }catch(Exception error){return false;}
    }
    boolean hasExisting(){
        for(File root:context.getExternalMediaDirs()){
            if(root==null)continue;File[] files=new File(root,"Chromasmith").listFiles();if(files==null)continue;
            for(File file:files){if(!file.isFile()||file.getName().startsWith("."))continue;try{mime(file.getName());return true;}catch(IllegalArgumentException ignored){}}
        }
        return false;
    }
    int[] migrateExisting(){
        int migrated=0,failed=0;SharedPreferences prefs=context.getSharedPreferences("public-photo-migration",Context.MODE_PRIVATE);
        // This is the only app-specific path used here: read old exports, never save new ones.
        for(File root:context.getExternalMediaDirs()){
            if(root==null)continue;File album=new File(root,"Chromasmith");File[] files=album.listFiles();if(files==null)continue;
            for(File file:files){
                if(!file.isFile()||file.getName().startsWith("."))continue;
                try{mime(file.getName());}catch(IllegalArgumentException ignored){continue;}
                try{
                    if(!file.getCanonicalFile().getParentFile().equals(album.getCanonicalFile()))throw new IOException("Invalid legacy photo path");
                    String key=file.getCanonicalPath()+":"+file.length()+":"+file.lastModified();
                    String saved=prefs.getString(key,null);Uri publicUri=saved==null?null:Uri.parse(saved);
                    if(publicUri==null||!same(publicUri,file))publicUri=saveFile(file.getName(),file,true);
                    // Verify and publish before removing the old copy. Remember the URI before
                    // deletion so a failed deletion/restart cannot generate duplicate migrations.
                    if(!same(publicUri,file)||!prefs.edit().putString(key,publicUri.toString()).commit())throw new IOException("Cannot confirm preserved photo");
                    if(file.delete())MediaScannerConnection.scanFile(context,new String[]{file.getAbsolutePath()},null,null);
                    // A retained old copy is safe: the verified public copy and receipt exist.
                    migrated++;
                }catch(Exception error){failed++;android.util.Log.w("PublicPhotoStore","An earlier export could not be preserved",error);}
            }
        }
        return new int[]{migrated,failed};
    }
}
