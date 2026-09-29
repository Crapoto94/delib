# VibeDélib Élus pour tablette Android

L’APK embarque le même frontend que l’espace élus web. Au premier lancement, il propose l’adresse de l’instance publiée, préremplie avec `https://vibedelib.ivry94.fr`. L’adresse peut être modifiée depuis le bouton globe dans l’application. Elle est mémorisée sur la tablette et vérifiée avant utilisation.

L’application utilise l’API du même hôte (`/api/v1`). Pour `https://vibedelib.ivry94.fr`, l’API appelée est donc `https://vibedelib.ivry94.fr/api/v1`.

## Prérequis de construction

- Node.js 22 ou plus récent
- JDK 21 (exigé par Capacitor 8 ; celui embarqué dans Android Studio convient : `C:\Program Files\Android\Android Studio\jbr`)
- Android SDK avec les plateformes et outils de compilation demandés par Capacitor

## Construire l’APK de débogage

Depuis `elus-dmz` :

```powershell
npm ci
npm run build
cd elus-apk
npm ci
npx cap sync android
cd android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug
```

L’APK installable est produit dans `elus-apk/android/app/build/outputs/apk/debug/app-debug.apk`.

## Publier l’APK sur l’instance (téléchargement et mise à jour)

Depuis `elus-dmz`, une fois l’APK construite :

```powershell
node scripts/publier-apk.mjs --notes "ce que corrige cette version"
```

Le script copie l’APK dans `apk/vibedelib-elus.apk` (binaire non versionné) et écrit `apk/latest.json`
(versionné). Il refuse de publier si l’APK ne correspond pas au build web courant. Un `pulldmz.bat` copie
ensuite le tout vers la DMZ : la page `https://<instance>/apk/` propose le téléchargement, et les tablettes
déjà à jour via ce mécanisme affichent une proposition de mise à jour au lancement.

Le backend doit autoriser l’origine WebView Capacitor `https://localhost` dans `CORS_ORIGINS`, en plus des origines web habituelles. Il doit aussi présenter un certificat HTTPS reconnu par Android.

## Mode hors ligne

Les documents téléchargés sont conservés localement pour permettre leur lecture hors ligne, puis supprimés à la déconnexion ou au changement d’instance. La session reste propre à l’élu.
