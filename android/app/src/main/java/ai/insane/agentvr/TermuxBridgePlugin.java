package ai.insane.agentvr;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Native boundary for the real Termux runtime.
 * Termux must be installed separately and configured with allow-external-apps=true.
 * The app manifest requests com.termux.permission.RUN_COMMAND.
 *
 * Commands are intentionally not prefix-allowlisted: the product runs user
 * supplied CLI agents. Instead the boundary enforces a size limit, an execution
 * timeout, a bounded output and the Termux permission.
 */
@CapacitorPlugin(name = "TermuxBridge")
public class TermuxBridgePlugin extends Plugin {
    private static final int MAX_COMMAND_LENGTH = 8192;
    private static final int MAX_OUTPUT_CHARS = 200_000;
    private static final long TIMEOUT_MS = 120_000;
    private static final String TERMUX_PERMISSION = "com.termux.permission.RUN_COMMAND";
    private static final AtomicInteger NEXT_ID = new AtomicInteger(1000);
    private static final Map<Integer, PluginCall> CALLS = new ConcurrentHashMap<>();
    private static final Handler TIMEOUT_HANDLER = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void runCommand(PluginCall call) {
        String command = call.getString("command", "").trim();
        String cwd = call.getString("cwd", "~").trim();
        String shell = call.getString("shell", "bash").trim().toLowerCase(Locale.ROOT);
        if (command.isEmpty()) {
            call.reject("Command is empty");
            return;
        }
        if (command.length() > MAX_COMMAND_LENGTH) {
            call.reject("Command is too long (max " + MAX_COMMAND_LENGTH + " characters)");
            return;
        }
        if (!"bash".equals(shell) && !"sh".equals(shell)) {
            call.reject("Unsupported shell");
            return;
        }
        if (!isTermuxInstalled()) {
            call.reject("Termux is not installed");
            return;
        }
        if (ContextCompat.checkSelfPermission(getContext(), TERMUX_PERMISSION) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Termux RUN_COMMAND permission was not granted");
            return;
        }

        int executionId = NEXT_ID.incrementAndGet();
        CALLS.put(executionId, call);
        call.setKeepAlive(true);

        Intent intent = new Intent("com.termux.RUN_COMMAND");
        intent.setClassName("com.termux", "com.termux.app.RunCommandService");
        String binary = "/data/data/com.termux/files/usr/bin/" + shell;
        intent.putExtra("com.termux.RUN_COMMAND_PATH", binary);
        intent.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"bash".equals(shell) ? "-lc" : "-c", command});
        intent.putExtra("com.termux.RUN_COMMAND_WORKDIR", normalizeWorkdir(cwd));
        intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
        intent.putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0");
        intent.putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL", "Insane AI Agent");
        intent.putExtra("com.termux.RUN_COMMAND_COMMAND_DESCRIPTION", "Command requested by the Insane AI Agent workspace.");

        Intent resultIntent = new Intent(getContext(), TermuxResultReceiver.class);
        resultIntent.putExtra(TermuxResultReceiver.EXTRA_EXECUTION_ID, executionId);
        // Termux writes its result into this PendingIntent, so it must stay
        // mutable on Android 12+. FLAG_ONE_SHOT limits reuse.
        int flags = PendingIntent.FLAG_ONE_SHOT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        PendingIntent pendingIntent = PendingIntent.getBroadcast(getContext(), executionId, resultIntent, flags);
        intent.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pendingIntent);

        TIMEOUT_HANDLER.postDelayed(() -> {
            PluginCall pending = CALLS.remove(executionId);
            if (pending == null) return;
            JSObject result = new JSObject();
            result.put("ok", false);
            result.put("stdout", "");
            result.put("stderr", "");
            result.put("code", -1);
            result.put("reason", "Termux command timed out after " + (TIMEOUT_MS / 1000) + "s");
            pending.resolve(result);
        }, TIMEOUT_MS);

        try {
            getContext().startService(intent);
        } catch (Exception error) {
            CALLS.remove(executionId);
            call.reject("Unable to start Termux", error);
        }
    }

    private boolean isTermuxInstalled() {
        try {
            getContext().getPackageManager().getPackageInfo("com.termux", 0);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private String normalizeWorkdir(String cwd) {
        if (cwd.isEmpty() || cwd.equals("~")) return "/data/data/com.termux/files/home";
        if (cwd.startsWith("/")) return cwd;
        return "/data/data/com.termux/files/home/" + cwd;
    }

    private static String bounded(String value) {
        if (value == null) return "";
        if (value.length() <= MAX_OUTPUT_CHARS) return value;
        return value.substring(0, MAX_OUTPUT_CHARS) + "\n… output truncated at " + MAX_OUTPUT_CHARS + " characters";
    }

    static void resolveCommand(int executionId, String stdout, String stderr, int exitCode, String error) {
        PluginCall call = CALLS.remove(executionId);
        if (call == null) return;
        JSObject result = new JSObject();
        result.put("ok", error == null && exitCode == 0);
        result.put("stdout", bounded(stdout));
        result.put("stderr", bounded(stderr));
        result.put("code", exitCode);
        if (error != null) result.put("reason", error);
        call.resolve(result);
    }
}
