package ai.insane.agentvr;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

@CapacitorPlugin(name = "AssistantTask")
public class AssistantTaskPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        String command = call.getString("command", "").trim();
        if (command.isEmpty()) {
            call.reject("Command is empty");
            return;
        }
        if (command.length() > 16_000) {
            call.reject("Command is too long");
            return;
        }
        String taskId = UUID.randomUUID().toString();
        Intent intent = new Intent(getContext(), AssistantTaskService.class)
            .setAction(AssistantTaskService.ACTION_START)
            .putExtra(AssistantTaskService.EXTRA_TASK_ID, taskId)
            .putExtra(AssistantTaskService.EXTRA_COMMAND, command)
            .putExtra(AssistantTaskService.EXTRA_CWD, call.getString("cwd", "~"))
            .putExtra(AssistantTaskService.EXTRA_LABEL, call.getString("label", "Úloha agenta"));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            JSObject result = new JSObject();
            result.put("started", true);
            result.put("taskId", taskId);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to start foreground task", error);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context context = getContext();
        SharedPreferences prefs = AssistantTaskService.prefs(context);
        String taskId = prefs.getString("task_id", "");
        boolean running = prefs.getBoolean("running", false);
        JSObject result = new JSObject();
        result.put("taskId", taskId);
        result.put("running", running);
        result.put("startedAt", prefs.getLong("started_at", 0));
        result.put("finishedAt", prefs.getLong("finished_at", 0));
        result.put("exitCode", prefs.getInt("exit_code", -1));
        String error = prefs.getString("error", null);
        if (error != null) result.put("error", error);
        result.put("output", readTail(context, taskId, 8_000));
        call.resolve(result);
    }

    @PluginMethod
    public void read(PluginCall call) {
        String taskId = call.getString("taskId", "");
        if (taskId.isEmpty()) taskId = AssistantTaskService.prefs(getContext()).getString("task_id", "");
        JSObject result = new JSObject();
        result.put("taskId", taskId);
        result.put("output", readTail(getContext(), taskId, 200_000));
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        boolean stopped = getContext().stopService(new Intent(getContext(), AssistantTaskService.class));
        NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(AssistantTaskService.NOTIFICATION_ID);
        SharedPreferences.Editor editor = AssistantTaskService.prefs(getContext()).edit();
        editor.putBoolean("running", false);
        editor.apply();
        JSObject result = new JSObject();
        result.put("stopped", stopped);
        call.resolve(result);
    }

    private String readTail(Context context, String taskId, int maxChars) {
        if (taskId == null || taskId.isEmpty()) return "";
        File file = AssistantTaskService.outputFile(context, taskId);
        if (!file.exists()) return "";
        try (RandomAccessFile stream = new RandomAccessFile(file, "r")) {
            long length = stream.length();
            long start = Math.max(0, length - maxChars * 4L);
            byte[] bytes = new byte[(int) (length - start)];
            stream.seek(start);
            stream.readFully(bytes);
            String text = new String(bytes, StandardCharsets.UTF_8);
            if (start > 0) {
                int newline = text.indexOf('\n');
                text = newline >= 0 ? text.substring(newline + 1) : text;
            }
            if (text.length() <= maxChars) return text;
            return "… output truncated …\n" + text.substring(text.length() - maxChars);
        } catch (Exception ignored) {
            return "";
        }
    }
}
