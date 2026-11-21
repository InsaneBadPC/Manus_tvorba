package ai.insane.orin;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "ProjectStorage")
public class ProjectStoragePlugin extends Plugin {
    @PluginMethod
    public void pickDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        saveCall(call);
        startActivityForResult(call, intent, "directoryPicked");
    }

    @ActivityCallback
    private void directoryPicked(PluginCall call, ActivityResult result) {
        if (result == null || result.getData() == null || result.getData().getData() == null) {
            call.reject("Výběr projektové složky byl zrušen.");
            return;
        }
        Intent data = result.getData();
        Uri uri = data.getData();
        int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try { getContext().getContentResolver().takePersistableUriPermission(uri, flags); }
        catch (Exception error) { call.reject("Android nepovolil trvalý přístup k vybrané složce.", error); return; }

        JSObject value = new JSObject();
        value.put("uri", uri.toString());
        value.put("displayName", DocumentsContract.getTreeDocumentId(uri));
        value.put("termuxPath", toTermuxPath(uri));
        value.put("readableByFileManager", true);
        call.resolve(value);
    }

    private String toTermuxPath(Uri treeUri) {
        String documentId = DocumentsContract.getTreeDocumentId(treeUri);
        if (documentId == null) return "";
        if (documentId.startsWith("primary:")) {
            String relative = documentId.substring("primary:".length());
            String root = Environment.getExternalStorageDirectory().getAbsolutePath();
            return relative.isEmpty() ? root : root + "/" + relative;
        }
        return treeUri.toString();
    }
}
