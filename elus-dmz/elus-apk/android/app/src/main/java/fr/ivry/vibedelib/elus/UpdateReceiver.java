package fr.ivry.vibedelib.elus;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Android ferme l'application pendant l'installation d'une mise à jour : on la relance aussitôt après, pour que
 * l'élu retrouve l'écran sans avoir à revenir au lanceur.
 */
public class UpdateReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            Intent relance = new Intent(context, MainActivity.class);
            relance.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(relance);
        }
    }
}
