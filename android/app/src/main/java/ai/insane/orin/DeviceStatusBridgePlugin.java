package ai.insane.orin;

import android.app.ActivityManager;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "DeviceStatusBridge")
public class DeviceStatusBridgePlugin extends Plugin {
    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("batteryPercent", batteryPercent());
        result.put("charging", isCharging());
        result.put("signalDbm", wifiSignalDbm());
        result.put("networkDownlinkMbps", networkDownlinkMbps());
        result.put("cpuCores", Runtime.getRuntime().availableProcessors());
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        if (manager != null) {
            manager.getMemoryInfo(memory);
            result.put("ramTotalMb", memory.totalMem / (1024 * 1024));
            result.put("ramUsedMb", Math.max(0, (memory.totalMem - memory.availMem) / (1024 * 1024)));
        } else {
            result.put("ramTotalMb", -1);
            result.put("ramUsedMb", -1);
        }
        result.put("source", "native");
        call.resolve(result);
    }

    private int batteryPercent() {
        BatteryManager battery = (BatteryManager) getContext().getSystemService(Context.BATTERY_SERVICE);
        if (battery == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return -1;
        return battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
    }

    private boolean isCharging() {
        android.content.IntentFilter filter = new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED);
        android.content.Intent status = getContext().registerReceiver(null, filter);
        if (status == null) return false;
        int plugged = status.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, -1);
        return plugged == android.os.BatteryManager.BATTERY_PLUGGED_AC || plugged == android.os.BatteryManager.BATTERY_PLUGGED_USB || plugged == android.os.BatteryManager.BATTERY_PLUGGED_WIRELESS;
    }

    private int wifiSignalDbm() {
        try {
            WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiInfo info = wifi == null ? null : wifi.getConnectionInfo();
            return info == null ? -127 : info.getRssi();
        } catch (Exception ignored) { return -127; }
    }

    private double networkDownlinkMbps() {
        ConnectivityManager connectivity = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity == null) return 0;
        Network network = connectivity.getActiveNetwork();
        NetworkCapabilities caps = network == null ? null : connectivity.getNetworkCapabilities(network);
        if (caps == null) return 0;
        return caps.getLinkDownstreamBandwidthKbps() / 1000.0;
    }
}
