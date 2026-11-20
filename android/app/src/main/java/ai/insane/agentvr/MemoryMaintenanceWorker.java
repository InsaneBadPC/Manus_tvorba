package ai.insane.agentvr;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.PowerManager;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * Runs consolidation only in the real background window. WorkManager already
 * constrains this worker to charging + device idle; the worker checks charging
 * and screen state again because constraints can race with a user waking up.
 */
public class MemoryMaintenanceWorker extends Worker {
    private static final String TERMUX_HOME = "/data/data/com.termux/files/home";

    public MemoryMaintenanceWorker(
        @NonNull Context context,
        @NonNull WorkerParameters params
    ) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        // The constraints should already guarantee this. If the user woke the
        // device in between, skip this window instead of retrying every minute.
        if (!isCharging(context)) return Result.success();

        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (power == null || power.isInteractive()) return Result.success();

        String command =
            "CLI=\"\"; " +
            "for candidate in \"$HOME/Manus_tvorba/agent-memory/src/cli.ts\" " +
            "\"/storage/emulated/0/InsaneCode/Manus_tvorba/agent-memory/src/cli.ts\"; do " +
            "if [ -f \"$candidate\" ]; then CLI=\"$candidate\"; break; fi; done; " +
            "if [ -z \"$CLI\" ]; then " +
            "CLI=$(find \"$HOME\" -maxdepth 5 -path '*/agent-memory/src/cli.ts' -print -quit 2>/dev/null); " +
            "fi; " +
            "if [ -z \"$CLI\" ]; then exit 3; fi; " +
            "EXTRA=\"\"; " +
            "if [ -n \"$GEMINI_API_KEY\" ] || [ -n \"$GOOGLE_API_KEY\" ]; then EXTRA=\"--curator\"; fi; " +
            "node \"$CLI\" consolidate --idle --charging --retention-days 30 --merge-duplicates $EXTRA";

        boolean sent = TermuxCommandSender.send(context, command, TERMUX_HOME);
        return sent ? Result.success() : Result.retry();
    }

    private boolean isCharging(Context context) {
        Intent status = context.registerReceiver(
            null,
            new IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        );
        if (status == null) return false;
        int plugged = status.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1);
        return (
            plugged == BatteryManager.BATTERY_PLUGGED_AC ||
            plugged == BatteryManager.BATTERY_PLUGGED_USB ||
            plugged == BatteryManager.BATTERY_PLUGGED_WIRELESS
        );
    }
}
