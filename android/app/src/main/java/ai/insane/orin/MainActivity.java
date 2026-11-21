package ai.insane.orin;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(TermuxBridgePlugin.class);
        registerPlugin(AppUpdateBridgePlugin.class);
        registerPlugin(DeviceStatusBridgePlugin.class);
        registerPlugin(ProjectStoragePlugin.class);
        registerPlugin(MemoryMaintenancePlugin.class);
        registerPlugin(AssistantTaskPlugin.class);
        super.onCreate(savedInstanceState);
        if (android.os.Build.VERSION.SDK_INT >= 33
            && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 4101);
        }
    }
}
