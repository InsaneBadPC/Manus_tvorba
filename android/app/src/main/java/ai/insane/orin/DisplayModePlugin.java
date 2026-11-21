package ai.insane.orin;

import android.content.pm.ActivityInfo;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The WebView's Screen Orientation API is not reliable inside Android WebView.
 * This plugin makes normal portrait/landscape switching and the VR headset mode
 * deterministic, including immersive fullscreen with the system bars hidden.
 */
@CapacitorPlugin(name = "DisplayMode")
public class DisplayModePlugin extends Plugin {
    private int normalOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private boolean vrActive = false;

    @PluginMethod
    public void setOrientation(PluginCall call) {
        String orientation = call.getString("orientation", "auto");
        int requested;
        switch (orientation == null ? "auto" : orientation) {
            case "portrait":
                requested = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
                break;
            case "landscape":
                requested = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
                break;
            default:
                requested = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
                break;
        }
        getActivity().runOnUiThread(() -> {
            normalOrientation = requested;
            getActivity().setRequestedOrientation(requested);
            call.resolve();
        });
    }

    @PluginMethod
    public void setVrMode(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            if (enabled == vrActive) {
                call.resolve();
                return;
            }

            if (enabled) {
                normalOrientation = getActivity().getRequestedOrientation();
                vrActive = true;
                getActivity().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                setImmersive(true);
            } else {
                vrActive = false;
                getActivity().setRequestedOrientation(normalOrientation);
                setImmersive(false);
            }
            call.resolve();
        });
    }

    private void setImmersive(boolean enabled) {
        Window window = getActivity().getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, !enabled);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller == null) return;

        if (enabled) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars());
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }
}
