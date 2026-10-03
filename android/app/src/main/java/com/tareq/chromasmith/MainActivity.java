package com.tareq.chromasmith;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SharedImportPlugin.class);
        registerPlugin(BarBackgroundPlugin.class);
        super.onCreate(savedInstanceState);
        ingestShared(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        ingestShared(intent);
    }

    // Copy shared photos on a worker thread, then tell the page to pull them.
    private void ingestShared(Intent intent) {
        if (intent == null || !(Intent.ACTION_SEND.equals(intent.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction()))) return;
        new Thread(() -> {
            SharedImportPlugin.ingest(getApplicationContext(), intent);
            runOnUiThread(() -> {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript("window.csCheckShared&&window.csCheckShared()", null);
                }
            });
        }).start();
    }
}
