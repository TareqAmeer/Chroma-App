package com.tareq.chromasmith;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// The status/navigation bar strips draw the window background, which the web layer cannot reach. The page picks light or
// dark system-bar glyphs to contrast with its own background (Capacitor SystemBars.setStyle), so the strip has to take
// that same colour or the glyphs vanish (white clock on a white strip, or dark on dark).
@CapacitorPlugin(name = "BarBackground")
public class BarBackgroundPlugin extends Plugin {
    @PluginMethod
    public void setColor(PluginCall call) {
        final String hex = call.getString("color");
        if (hex == null) { call.reject("color required"); return; }
        final int color;
        try { color = Color.parseColor(hex); } catch (IllegalArgumentException e) { call.reject("bad color"); return; }
        getActivity().runOnUiThread(() -> {
            android.view.Window w = getActivity().getWindow();
            w.setBackgroundDrawable(new ColorDrawable(color));
            // The theme also pins these (styles.xml), and the strips draw them, so they have to move with the colour.
            w.setStatusBarColor(color);
            w.setNavigationBarColor(color);
            call.resolve();
        });
    }
}
