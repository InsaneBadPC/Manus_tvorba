package ai.insane.orin;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

public class TermuxResultReceiver extends BroadcastReceiver {
    public static final String EXTRA_EXECUTION_ID = "execution_id";
    private static final String RESULT_BUNDLE = "result";
    private static final String STDOUT = "stdout";
    private static final String STDERR = "stderr";
    private static final String EXIT_CODE = "exitCode";
    private static final String ERROR = "errmsg";

    @Override
    public void onReceive(Context context, Intent intent) {
        int executionId = intent.getIntExtra(EXTRA_EXECUTION_ID, 0);
        Bundle result = intent.getBundleExtra(RESULT_BUNDLE);
        if (result == null) {
            TermuxBridgePlugin.resolveCommand(executionId, "", "", -1, "Termux returned no result bundle");
            return;
        }
        String stdout = result.getString(STDOUT, "");
        String stderr = result.getString(STDERR, "");
        int exitCode = result.getInt(EXIT_CODE, -1);
        String error = result.getString(ERROR, null);
        TermuxBridgePlugin.resolveCommand(executionId, stdout, stderr, exitCode, error);
    }
}
