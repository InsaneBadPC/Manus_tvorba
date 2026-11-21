package ai.insane.agentvr;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Keeps long assistant commands alive with a foreground notification. Termux
 * still owns the process; this service holds the Android execution context and
 * a wake lock, and the result receiver persists bounded stdout/stderr.
 */
public class AssistantTaskService extends Service {
    public static final String ACTION_START = "ai.insane.agentvr.action.START_TASK";
    public static final String ACTION_STOP = "ai.insane.agentvr.action.STOP_TASK";
    public static final String EXTRA_TASK_ID = "task_id";
    public static final String EXTRA_COMMAND = "command";
    public static final String EXTRA_CWD = "cwd";
    public static final String EXTRA_LABEL = "label";
    public static final String PREFS = "assistant_tasks";
    public static final String CHANNEL = "assistant-tasks";
    public static final int NOTIFICATION_ID = 4101;

    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        if (ACTION_STOP.equals(intent.getAction())) {
            finishService();
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(intent.getAction())) return START_NOT_STICKY;

        String taskId = intent.getStringExtra(EXTRA_TASK_ID);
        if (taskId == null || taskId.trim().isEmpty()) taskId = UUID.randomUUID().toString();
        String command = intent.getStringExtra(EXTRA_COMMAND);
        String cwd = intent.getStringExtra(EXTRA_CWD);
        String label = intent.getStringExtra(EXTRA_LABEL);

        startForegroundCompat(
            buildNotification(
                this,
                label == null ? "Úloha na pozadí" : label,
                "Agent pracuje v Termuxu…",
                true
            )
        );
        acquireWakeLock();
        writeState(this, taskId, true, null, null);

        File output = outputFile(this, taskId);
        writeHeader(output, label, command);

        PendingIntent result = resultIntent(this, taskId);
        boolean sent = TermuxCommandSender.sendWithResult(
            this,
            command,
            cwd,
            result,
            label == null ? "Insane AI Agent – dlouhá úloha" : label
        );
        if (!sent) {
            append(output, "\n[bridge] Termux RUN_COMMAND se nepodařilo odeslat.\n");
            writeState(this, taskId, false, -1, "Termux RUN_COMMAND se nepodařilo odeslat.");
            finishService();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        try {
            // Keep the completion notification posted by AssistantTaskReceiver.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_DETACH);
            } else {
                stopForeground(false);
            }
        } catch (Exception ignored) {
            // Service may already be detached.
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void finishService() {
        releaseWakeLock();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager manager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (manager == null) return;
        wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "InsaneAI:assistant-task");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(30 * 60 * 1000L);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    static File outputFile(Context context, String taskId) {
        File directory = new File(context.getCacheDir(), "assistant-tasks");
        if (!directory.exists()) directory.mkdirs();
        String safe = taskId.replaceAll("[^A-Za-z0-9._-]", "_");
        if (safe.isEmpty()) safe = "task";
        return new File(directory, safe + ".log");
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void writeState(Context context, String taskId, boolean running, Integer exitCode, String error) {
        SharedPreferences.Editor editor = prefs(context).edit();
        editor.putString("task_id", taskId);
        editor.putBoolean("running", running);
        if (!running) {
            editor.putLong("finished_at", System.currentTimeMillis());
        }
        if (exitCode != null) editor.putInt("exit_code", exitCode);
        if (error != null && !error.isEmpty()) editor.putString("error", error);
        else if (!running) editor.remove("error");
        if (running) {
            editor.putLong("started_at", System.currentTimeMillis());
            editor.remove("finished_at");
            editor.remove("exit_code");
            editor.remove("error");
        }
        editor.apply();
    }

    private static void writeHeader(File output, String label, String command) {
        String header =
            "task: " + (label == null ? "assistant" : label) + "\n" +
            "command: " + (command == null ? "" : command) + "\n" +
            "started: " + System.currentTimeMillis() + "\n\n";
        try (FileOutputStream stream = new FileOutputStream(output, false)) {
            stream.write(header.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            // The receiver can still create the file.
        }
    }

    private static void append(File output, String text) {
        try (FileOutputStream stream = new FileOutputStream(output, true)) {
            stream.write(text.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            // Best effort diagnostics.
        }
    }

    private static PendingIntent resultIntent(Context context, String taskId) {
        Intent intent = new Intent(context, AssistantTaskReceiver.class);
        intent.putExtra(EXTRA_TASK_ID, taskId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getBroadcast(context, taskId.hashCode(), intent, flags);
    }

    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL,
            "Dlouhé úlohy agenta",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Stav dlouhých příkazů spouštěných v Termuxu.");
        manager.createNotificationChannel(channel);
    }

    static Notification buildNotification(Context context, String title, String text, boolean ongoing) {
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentIntent = PendingIntent.getActivity(context, 9101, open, flags);
        return new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setOngoing(ongoing)
            .setOnlyAlertOnce(true)
            .setContentIntent(contentIntent)
            .build();
    }
}
