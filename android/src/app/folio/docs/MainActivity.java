package app.folio.docs;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Folio para Android: muestra la app web incluida en el APK (assets/www) dentro de un WebView
 * servido desde un origen https propio, y añade guardar, compartir y "abrir con".
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String BASE = "https://" + HOST + "/";
    private static final int REQ_PICK = 41;
    private static final int REQ_SAVE = 42;

    private WebView web;
    private ValueCallback<Uri[]> pickCallback;
    private boolean pageReady = false;
    private Uri pendingOpen;
    private byte[] pendingSave;
    private final Map<String, byte[]> incoming = new HashMap<>();
    private final Map<String, String> incomingMime = new HashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        applySystemBars();
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " FolioAndroid/1");

        web.addJavascriptInterface(new Bridge(), "FolioAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (state != null) web.restoreState(state);
        else web.loadUrl(BASE + "index.html");
        handleIntent(getIntent());
    }

    private void applySystemBars() {
        Window w = getWindow();
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int bg = night ? Color.parseColor("#0F0F10") : Color.parseColor("#F6F5F2");
        w.setStatusBarColor(bg);
        w.setNavigationBarColor(bg);
        int flags = 0;
        if (!night) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) flags |= 0x00000010; // SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }
        w.getDecorView().setSystemUiVisibility(flags);
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        applySystemBars();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /* ---------- Abrir documentos recibidos de otras apps ---------- */
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
        else if (Intent.ACTION_SEND.equals(intent.getAction())) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) return;
        if (pageReady) deliver(uri); else pendingOpen = uri;
    }

    private void deliver(Uri uri) {
        try {
            String name = displayName(uri);
            byte[] data = readAll(getContentResolver().openInputStream(uri));
            String id = "f" + System.nanoTime();
            incoming.put(id, data);
            String mime = getContentResolver().getType(uri);
            incomingMime.put(id, mime == null ? "application/octet-stream" : mime);
            String js = "window.__folioOpenUrl && window.__folioOpenUrl(" + JSONObject.quote(BASE + "__incoming/" + id) + "," + JSONObject.quote(name) + ")";
            web.evaluateJavascript(js, null);
        } catch (Exception e) {
            toast("No se pudo abrir el archivo");
        }
    }

    private String displayName(Uri uri) {
        String name = null;
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) { }
        if (name == null) name = uri.getLastPathSegment();
        if (name == null) name = "documento";
        if (!name.contains(".")) {
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(getContentResolver().getType(uri));
            if (ext != null) name += "." + ext;
        }
        return name;
    }

    static byte[] readAll(InputStream in) throws IOException {
        try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    /* ---------- Servidor local de los archivos de la app ---------- */
    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String path = u.getPath() == null ? "/" : u.getPath();
            if (path.startsWith("/__incoming/")) {
                String id = path.substring("/__incoming/".length());
                byte[] data = incoming.remove(id);
                if (data == null) return notFound();
                return response(incomingMime.remove(id), new ByteArrayInputStream(data));
            }
            if (path.equals("/")) path = "/index.html";
            try {
                InputStream in = getAssets().open("www" + path);
                return response(mimeOf(path), in);
            } catch (IOException e) {
                return notFound();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri u = Uri.parse(url);
            if (HOST.equals(u.getHost())) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException ignored) { }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pageReady = true;
            if (pendingOpen != null) {
                final Uri u = pendingOpen;
                pendingOpen = null;
                main.postDelayed(new Runnable() { public void run() { deliver(u); } }, 300);
            }
        }
    }

    private WebResourceResponse response(String mime, InputStream in) {
        WebResourceResponse r = new WebResourceResponse(mime, mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") ? "utf-8" : null, in);
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", BASE.substring(0, BASE.length() - 1));
        h.put("Cache-Control", "no-cache");
        r.setResponseHeaders(h);
        return r;
    }

    private WebResourceResponse notFound() {
        WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
        r.setStatusCodeAndReasonPhrase(404, "Not Found");
        return r;
    }

    static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        return "application/octet-stream";
    }

    /* ---------- Selector de archivos para <input type="file"> ---------- */
    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (pickCallback != null) pickCallback.onReceiveValue(null);
            pickCallback = cb;
            List<String> mimes = new ArrayList<>();
            for (String t : params.getAcceptTypes()) {
                for (String part : t.split(",")) {
                    String m = part.trim();
                    if (m.contains("/")) mimes.add(m);
                }
            }
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            boolean images = !mimes.isEmpty();
            for (String m : mimes) if (!m.startsWith("image/")) images = false;
            if (images) i.setType("image/*");
            else {
                i.setType("*/*");
                if (!mimes.isEmpty()) {
                    mimes.add("application/octet-stream");
                    mimes.add("application/zip");
                    i.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
                }
            }
            try {
                startActivityForResult(i, REQ_PICK);
            } catch (ActivityNotFoundException e) {
                pickCallback = null;
                toast("No hay un selector de archivos disponible");
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_PICK) {
            if (pickCallback != null) {
                Uri[] result = (res == RESULT_OK && data != null && data.getData() != null) ? new Uri[]{data.getData()} : null;
                pickCallback.onReceiveValue(result);
                pickCallback = null;
            }
            return;
        }
        if (req == REQ_SAVE) {
            byte[] bytes = pendingSave;
            pendingSave = null;
            if (res == RESULT_OK && data != null && data.getData() != null && bytes != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    out.write(bytes);
                    toast("Archivo guardado");
                } catch (Exception e) {
                    toast("No se pudo guardar");
                }
            }
            return;
        }
        super.onActivityResult(req, res, data);
    }

    private void toast(final String msg) {
        main.post(new Runnable() { public void run() { Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show(); } });
    }

    /* ---------- Puente con la app web ---------- */
    private class Bridge {
        /** Guarda en Descargas (Android 10+) o pregunta dónde guardar (Android 7–9). Devuelve true si ya quedó guardado. */
        @JavascriptInterface
        public boolean saveFile(final String name, final String mime, String base64) {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            if (Build.VERSION.SDK_INT >= 29) {
                try {
                    ContentResolver cr = getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put("_display_name", name);
                    v.put("mime_type", mime);
                    v.put("relative_path", Environment.DIRECTORY_DOWNLOADS + "/Folio");
                    v.put("is_pending", 1);
                    Uri item = cr.insert(Uri.parse("content://media/external/downloads"), v);
                    if (item == null) throw new IOException("sin acceso");
                    try (OutputStream out = cr.openOutputStream(item)) { out.write(bytes); }
                    ContentValues done = new ContentValues();
                    done.put("is_pending", 0);
                    cr.update(item, done, null, null);
                    return true;
                } catch (Exception e) {
                    // si falla, se pregunta dónde guardar
                }
            }
            pendingSave = bytes;
            main.post(new Runnable() { public void run() {
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(mime);
                i.putExtra(Intent.EXTRA_TITLE, name);
                try { startActivityForResult(i, REQ_SAVE); } catch (ActivityNotFoundException e) { toast("No se pudo guardar"); }
            } });
            return false;
        }

        /** Comparte el archivo con otras apps (WhatsApp, Gmail, Drive…) */
        @JavascriptInterface
        public void shareFile(final String name, String mime, String base64) {
            try {
                File dir = new File(getCacheDir(), "share");
                dir.mkdirs();
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                File f = new File(dir, name.replaceAll("[\\\\/:*?\"<>|]", "_"));
                try (FileOutputStream out = new FileOutputStream(f)) { out.write(Base64.decode(base64, Base64.DEFAULT)); }
                Uri uri = Uri.parse("content://app.folio.docs.share/" + Uri.encode(f.getName()) + "?type=" + Uri.encode(mime));
                final Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(mime);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.setClipData(ClipData.newRawUri(name, uri));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                main.post(new Runnable() { public void run() { startActivity(Intent.createChooser(send, "Compartir " + name)); } });
            } catch (Exception e) {
                toast("No se pudo compartir");
            }
        }

        @JavascriptInterface
        public String version() { return "1"; }
    }
}
