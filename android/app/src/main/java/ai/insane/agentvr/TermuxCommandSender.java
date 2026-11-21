package ai.insane.agentvr;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Shared Termux RUN_COMMAND sender for background workers and plugins. */
final class TermuxCommandSender {
    private static final String TERMUX_PACKAGE = "com.termux";
    private static final String TERMUX_SERVICE = "com.termux.app.RunCommandService";
    private static final String TERMUX_BIN = "/data/data/com.termux/files/usr/bin/bash";
    private static final String TERMUX_HOME = "/data/data/com.termux/files/home";

    private TermuxCommandSender() {}

    static boolean send(Context context, String command, String cwd) {
        return sendWithResult(context, command, cwd, null, "Orin – údržba paměti");
    }

    static boolean sendWithResult(
        Context context,
        String command,
        String cwd,
        android.app.PendingIntent resultIntent,
        String label
    ) {
        if (command == null || command.trim().isEmpty() || command.length() > 16_000) {
            return false;
        }
        try {
            context.getPackageManager().getPackageInfo(TERMUX_PACKAGE, 0);
        } catch (Exception ignored) {
            return false;
        }

        Intent intent = new Intent("com.termux.RUN_COMMAND");
        intent.setClassName(TERMUX_PACKAGE, TERMUX_SERVICE);
        intent.putExtra("com.termux.RUN_COMMAND_PATH", TERMUX_BIN);
        intent.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-lc", command});
        intent.putExtra(
            "com.termux.RUN_COMMAND_WORKDIR",
            cwd == null || cwd.trim().isEmpty() ? TERMUX_HOME : cwd
        );
        intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
        intent.putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0");
        intent.putExtra(
            "com.termux.RUN_COMMAND_COMMAND_LABEL",
            label == null || label.trim().isEmpty() ? "Orin" : label
        );
        intent.putExtra(
            "com.termux.RUN_COMMAND_COMMAND_DESCRIPTION",
            "Command requested by the Orin Android client."
        );
        if (resultIntent != null) {
            intent.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", resultIntent);
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
            return true;
        } catch (Exception first) {
            try {
                context.startService(intent);
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }
    }
}
