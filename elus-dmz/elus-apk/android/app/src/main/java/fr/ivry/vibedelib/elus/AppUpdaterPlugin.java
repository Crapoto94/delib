package fr.ivry.vibedelib.elus;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Mise à jour de l'application depuis l'instance (…/apk). Android interdit l'installation silencieuse hors Play
 * Store / MDM : on fait donc au plus proche — téléchargement en arrière-plan, puis UN SEUL écran système à valider.
 * La WebView (JS) appelle `download` dès qu'une nouvelle version est détectée, puis `install` quand l'utilisateur
 * touche le bouton ; l'installateur du système prend le relais.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private File fichierApk(Context ctx) {
        return new File(ctx.getCacheDir(), "mise-a-jour.apk");
    }

    /** Télécharge l'APK dans le cache de l'application (appelable en arrière-plan, sans ouvrir d'écran). */
    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url");
        if (url == null) { call.reject("URL de l'APK manquante"); return; }
        final Context ctx = getContext();
        new Thread(() -> {
            try {
                telecharger(ctx, url);
                JSObject r = new JSObject();
                r.put("status", "telecharge");
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Téléchargement impossible : " + e.getMessage());
            }
        }).start();
    }

    /** Ouvre l'écran d'installation du système avec l'APK déjà téléchargée (la télécharge si besoin). */
    @PluginMethod
    public void install(PluginCall call) {
        final String url = call.getString("url");
        final Context ctx = getContext();
        new Thread(() -> {
            try {
                File apk = fichierApk(ctx);
                if (!apk.exists() && url != null) telecharger(ctx, url);
                if (!apk.exists()) { call.reject("APK introuvable : lancez d'abord le téléchargement"); return; }

                // Android 8+ : une application ne peut installer une APK que si l'utilisateur l'a autorisée à le faire.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ctx.getPackageManager().canRequestPackageInstalls()) {
                    Intent perm = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
                    perm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(perm);
                    JSObject r = new JSObject();
                    r.put("status", "permission");
                    call.resolve(r);
                    return;
                }

                Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                JSObject r = new JSObject();
                r.put("status", "installeur");
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Installation impossible : " + e.getMessage());
            }
        }).start();
    }

    private void telecharger(Context ctx, String url) throws Exception {
        File apk = fichierApk(ctx);
        File temporaire = new File(ctx.getCacheDir(), "mise-a-jour.apk.part");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(15000);
        c.setReadTimeout(120000);
        try {
            c.connect();
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(temporaire)) {
                byte[] tampon = new byte[65536];
                int n;
                while ((n = in.read(tampon)) > 0) out.write(tampon, 0, n);
            }
        } finally {
            c.disconnect();
        }
        if (apk.exists() && !apk.delete()) throw new Exception("ancien fichier verrouillé");
        if (!temporaire.renameTo(apk)) throw new Exception("mise en place du fichier impossible");
    }
}
