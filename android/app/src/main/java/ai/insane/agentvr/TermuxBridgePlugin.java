package ai.insane.agentvr;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Native boundary for the real Termux runtime.
 * Termux must be installed separately and configured with allow-external-apps=true.
 * The app manifest requests com.termux.permission.RUN_COMMAND.
 */
@CapacitorPlugin(name = "TermuxBridge")
public class TermuxBridgePlugin extends Plugin {
    private static final AtomicInteger NEXT_ID = new AtomicInteger(1000);
    private static final Map<Integer, PluginCall> CALLS = new ConcurrentHashMap<>();

    @PluginMethod
    public void runCommand(PluginCall call) {
        String command = call.getString("command", "").trim();
        String cwd = call.getString("cwd", "~").trim();
        if (command.isEmpty()) {
            call.reject("Command is empty");
            return;
        }
        if (!isTermuxInstalled()) {
            call.reject("Termux is not installed");
            return;
        }

        int executionId = NEXT_ID.incrementAndGet();
        CALLS.put(executionId, call);
        call.setKeepAlive(true);

        Intent intent = new Intent("com.termux.RUN_COMMAND");
        intent.setClassName("com.termux", "com.termux.app.RunCommandService");
        intent.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash");
        intent.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-lc", command});
        intent.putExtra("com.termux.RUN_COMMAND_WORKDIR", normalizeWorkdir(cwd));
        intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
        intent.putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0");
        intent.putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL", "Insane AI Agent");
        intent.putExtra("com.termux.RUN_COMMAND_COMMAND_DESCRIPTION", "Command requested by the Insane AI Agent workspace.");

        Intent resultIntent = new Intent(getContext(), TermuxResultReceiver.class);
        resultIntent.putExtra(TermuxResultReceiver.EXTRA_EXECUTION_ID, executionId);
        int flags = PendingIntent.FLAG_ONE_SHOT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        PendingIntent pendingIntent = PendingIntent.getBroadcast(getContext(), executionId, resultIntent, flags);
        intent.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pendingIntent);

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

    static void resolveCommand(int executionId, String stdout, String stderr, int exitCode, String error) {
        PluginCall call = CALLS.remove(executionId);
        if (call == null) return;
        JSObject result = new JSObject();
        result.put("ok", error == null && exitCode == 0);
        result.put("stdout", stdout == null ? "" : stdout);
        result.put("stderr", stderr == null ? "" : stderr);
        result.put("code", exitCode);
        if (error != null) result.put("reason", error);
        call.resolve(result);
    }
}
