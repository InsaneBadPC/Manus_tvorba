package ai.insane.orin;

import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "AppUpdateBridge")
public class AppUpdateBridgePlugin extends Plugin {
    private static final int MAX_MANIFEST_BYTES = 64 * 1024;
    private static final long MAX_APK_BYTES = 250L * 1024 * 1024;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    /**
     * GitHub release assets are served without CORS headers, so a fetch() from
     * the Capacitor WebView (https://localhost) cannot read latest.json.
     * Reading it natively keeps the update check functional.
     */
    @PluginMethod
    public void fetchManifest(PluginCall call) {
        String rawUrl = call.getString("url", "").trim();
        if (!isAllowedGithubUrl(rawUrl)) {
            call.reject("Update manifest URL is not allowed");
            return;
        }
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(rawUrl).openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setRequestProperty("Cache-Control", "no-cache");
                connection.connect();
                int code = connection.getResponseCode();
                if (code < 200 || code >= 300) throw new IllegalStateException("Manifest HTTP " + code);
                if (!isAllowedFinalUrl(connection.getURL())) throw new IllegalStateException("Manifest redirect is not allowed");

                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                try (InputStream input = connection.getInputStream()) {
                    byte[] chunk = new byte[8192];
                    int read;
                    while ((read = input.read(chunk)) != -1) {
                        if (buffer.size() + read > MAX_MANIFEST_BYTES) throw new IllegalStateException("Manifest is too large");
                        buffer.write(chunk, 0, read);
                    }
                }
                JSONObject json = new JSONObject(buffer.toString(StandardCharsets.UTF_8.name()));
                JSObject result = new JSObject();
                result.put("build", json.optString("build", ""));
                result.put("run", json.optString("run", ""));
                result.put("apk", json.optString("apk", ""));
                result.put("sha256", json.optString("sha256", ""));
                result.put("release", json.optString("release", ""));
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "Update manifest failed" : error.getMessage());
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String rawUrl = call.getString("url", "").trim();
        String expectedHash = call.getString("sha256", "").trim().toLowerCase(Locale.ROOT);
        if (!isAllowedGithubUrl(rawUrl)) {
            call.reject("Update URL is not allowed");
            return;
        }
        if (!expectedHash.isEmpty() && !expectedHash.matches("[0-9a-f]{64}")) {
            call.reject("Update hash has an invalid format");
            return;
        }
        executor.execute(() -> {
            File apk = null;
            HttpURLConnection connection = null;
            try {
                File downloads = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (downloads == null) throw new IllegalStateException("Downloads directory is unavailable");
                apk = new File(downloads, "orin-latest.apk");

                connection = (HttpURLConnection) new URL(rawUrl).openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(120000);
                connection.connect();
                if (!isAllowedFinalUrl(connection.getURL())) throw new IllegalStateException("APK redirect is not allowed");
                int code = connection.getResponseCode();
                if (code < 200 || code >= 300) throw new IllegalStateException("APK download HTTP " + code);
                long declared = connection.getContentLength();
                if (declared > MAX_APK_BYTES) throw new IllegalStateException("APK is too large");

                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long written = 0;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apk)) {
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        written += read;
                        if (written > MAX_APK_BYTES) throw new IllegalStateException("APK is too large");
                        output.write(buffer, 0, read);
                        digest.update(buffer, 0, read);
                    }
                }

                String actualHash = toHex(digest.digest());
                if (!expectedHash.isEmpty() && !MessageDigest.isEqual(
                        expectedHash.getBytes(StandardCharsets.UTF_8),
                        actualHash.getBytes(StandardCharsets.UTF_8))) {
                    //noinspection ResultOfMethodCallIgnored
                    apk.delete();
                    throw new IllegalStateException("APK hash mismatch");
                }

                Uri apkUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(apkUri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().runOnUiThread(() -> {
                    getActivity().startActivity(install);
                    JSObject result = new JSObject();
                    result.put("ok", true);
                    result.put("sha256", actualHash);
                    call.resolve(result);
                });
            } catch (Exception error) {
                if (apk != null) {
                    //noinspection ResultOfMethodCallIgnored
                    apk.delete();
                }
                JSObject result = new JSObject();
                result.put("ok", false);
                result.put("reason", error.getMessage() == null ? "APK download failed" : error.getMessage());
                getActivity().runOnUiThread(() -> call.resolve(result));
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private static boolean isAllowedGithubUrl(String rawUrl) {
        try {
            URL url = new URL(rawUrl);
            return "https".equalsIgnoreCase(url.getProtocol()) && "github.com".equalsIgnoreCase(url.getHost());
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean isAllowedFinalUrl(URL url) {
        if (url == null) return false;
        String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
        return "https".equalsIgnoreCase(url.getProtocol())
                && ("github.com".equals(host) || host.endsWith(".githubusercontent.com"));
    }

    private static String toHex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) builder.append(String.format(Locale.ROOT, "%02x", value));
        return builder.toString();
    }
}
