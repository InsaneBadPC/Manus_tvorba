package ai.insane.agentvr;

import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AppUpdateBridge")
public class AppUpdateBridgePlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String rawUrl = call.getString("url", "").trim();
        if (!rawUrl.startsWith("https://github.com/")) {
            call.reject("Update URL is not allowed");
            return;
        }
        executor.execute(() -> {
            File apk = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "insane-ai-agent-latest.apk");
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL(rawUrl).openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(120000);
                connection.connect();
                if (connection.getResponseCode() < 200 || connection.getResponseCode() >= 300) {
                    throw new IllegalStateException("APK download HTTP " + connection.getResponseCode());
                }
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apk)) {
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                } finally {
                    connection.disconnect();
                }
                Uri apkUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(apkUri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().runOnUiThread(() -> {
                    getActivity().startActivity(install);
                    JSObject result = new JSObject();
                    result.put("ok", true);
                    call.resolve(result);
                });
            } catch (Exception error) {
                JSObject result = new JSObject();
                result.put("ok", false);
                result.put("reason", error.getMessage() == null ? "APK download failed" : error.getMessage());
                getActivity().runOnUiThread(() -> call.resolve(result));
            }
        });
    }
}
