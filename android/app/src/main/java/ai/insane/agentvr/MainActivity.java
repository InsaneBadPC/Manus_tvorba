package ai.insane.agentvr;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(TermuxBridgePlugin.class);
        registerPlugin(AppUpdateBridgePlugin.class);
        registerPlugin(DeviceStatusBridgePlugin.class);
        registerPlugin(ProjectStoragePlugin.class);
        registerPlugin(MemoryMaintenancePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
