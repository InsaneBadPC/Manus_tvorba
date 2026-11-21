package ai.insane.agentvr;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.NotificationCompat;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** Persists Termux output and closes the matching foreground task. */
public class AssistantTaskReceiver extends BroadcastReceiver {
    private static final String RESULT_BUNDLE = "result";

    @Override
    public void onReceive(Context context, Intent intent) {
        String taskId = intent.getStringExtra(AssistantTaskService.EXTRA_TASK_ID);
        if (taskId == null || taskId.trim().isEmpty()) taskId = "unknown";
        Bundle result = intent.getBundleExtra(RESULT_BUNDLE);
        String stdout = result == null ? "" : result.getString("stdout", "");
        String stderr = result == null ? "" : result.getString("stderr", "");
        int exitCode = result == null ? -1 : result.getInt("exitCode", -1);
        String error = result == null
            ? "Termux returned no result bundle"
            : result.getString("errmsg", null);

        File output = AssistantTaskService.outputFile(context, taskId);
        try (FileOutputStream stream = new FileOutputStream(output, true)) {
            stream.write("\n--- stdout ---\n".getBytes(StandardCharsets.UTF_8));
            stream.write(stdout.getBytes(StandardCharsets.UTF_8));
            if (!stderr.isEmpty()) {
                stream.write("\n--- stderr ---\n".getBytes(StandardCharsets.UTF_8));
                stream.write(stderr.getBytes(StandardCharsets.UTF_8));
            }
            stream.write(("\n--- exit: " + exitCode + " ---\n").getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            // State still records the exit code.
        }

        AssistantTaskService.writeState(context, taskId, false, exitCode, error);
        AssistantTaskService.createChannel(context);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            String text = error != null
                ? error
                : "Termux dokončil úlohu s kódem " + exitCode + ".";
            manager.notify(
                AssistantTaskService.NOTIFICATION_ID,
                AssistantTaskService.buildNotification(context, "Úloha dokončena", text, false)
            );
        }
        context.stopService(new Intent(context, AssistantTaskService.class));
    }
}
