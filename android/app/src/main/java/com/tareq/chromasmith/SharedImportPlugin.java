package com.tareq.chromasmith;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Parcelable;
import android.provider.OpenableColumns;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

// Photos shared TO Chromasmith from the Android share sheet. MainActivity copies each shared
// stream into the app's cache (the content:// grant dies with the intent) and queues it here; the
// web layer drains the queue with PhotoPair.takeShared() and imports the files like picked photos.
@CapacitorPlugin(name = "PhotoPair")
public class SharedImportPlugin extends Plugin {
    private static final List<JSObject> pending = new ArrayList<>();

    @PluginMethod
    public void takeShared(PluginCall call) {
        JSArray files = new JSArray();
        synchronized (pending) {
            for (JSObject f : pending) files.put(f);
            pending.clear();
        }
        JSObject res = new JSObject();
        res.put("files", files);
        call.resolve(res);
    }

    // Copies every shared stream on the intent into cache/shared/. Blocking: call off the UI thread.
    static void ingest(Context ctx, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri u = getStream(intent);
            if (u != null) uris.add(u);
        } else {
            ArrayList<Uri> many = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.<Uri>getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) uris.addAll(many);
        }
        File dir = new File(ctx.getCacheDir(), "shared");
        dir.mkdirs();
        ContentResolver cr = ctx.getContentResolver();
        for (Uri uri : uris) {
            try {
                String name = displayName(cr, uri);
                File out = new File(dir, UUID.randomUUID().toString().substring(0, 8) + "-" + name);
                try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
                    if (in == null) continue;
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
                JSObject f = new JSObject();
                f.put("path", out.getAbsolutePath());
                f.put("name", name);
                synchronized (pending) { pending.add(f); }
            } catch (Exception ignored) { }
        }
    }

    @SuppressWarnings("deprecation")
    private static Uri getStream(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        Parcelable p = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return p instanceof Uri ? (Uri) p : null;
    }

    private static String displayName(ContentResolver cr, Uri uri) {
        String name = null;
        try (Cursor c = cr.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) { }
        if (name == null || name.isEmpty()) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "shared.jpg";
        return name.replaceAll("[/\\\\]", "_");
    }
}
