package ai.insane.agentvr;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "MemoryMaintenance")
public class MemoryMaintenancePlugin extends Plugin {
    private static final String WORK_NAME = "agent-memory-consolidation";

    @PluginMethod
    public void schedule(PluginCall call) {
        try {
            Constraints constraints = new Constraints.Builder()
                .setRequiresCharging(true)
                .setRequiresDeviceIdle(true)
                .setRequiresBatteryNotLow(true)
                .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
                .build();

            PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                MemoryMaintenanceWorker.class,
                24,
                TimeUnit.HOURS
            )
                .setConstraints(constraints)
                .setInitialDelay(1, TimeUnit.HOURS)
                .build();

            WorkManager.getInstance(getContext()).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            );

            JSObject result = new JSObject();
            result.put("scheduled", true);
            result.put("work", WORK_NAME);
            call.resolve(result);
        } catch (Exception error) {
            JSObject result = new JSObject();
            result.put("scheduled", false);
            result.put("reason", error.getMessage() == null ? "WorkManager unavailable" : error.getMessage());
            call.resolve(result);
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        WorkManager.getInstance(getContext()).cancelUniqueWork(WORK_NAME);
        JSObject result = new JSObject();
        result.put("cancelled", true);
        call.resolve(result);
    }
}
