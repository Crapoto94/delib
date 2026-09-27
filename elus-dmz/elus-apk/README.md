# VibeDélib Élus pour tablette Android

L’APK embarque le même frontend que l’espace élus web. Au premier lancement, il propose l’adresse de l’instance publiée, préremplie avec `https://vibedelib.ivry94.fr/elus`. L’adresse peut être modifiée depuis le bouton globe dans l’application. Elle est mémorisée sur la tablette et vérifiée avant utilisation.

L’application utilise l’API du même hôte (`/api/v1`). Pour `https://vibedelib.ivry94.fr/elus`, l’API appelée est donc `https://vibedelib.ivry94.fr/api/v1`.

## Prérequis de construction

- Node.js 22 ou plus récent
- JDK 17 ou plus récent
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
.\gradlew.bat assembleDebug
```

L’APK installable est produit dans `elus-apk/android/app/build/outputs/apk/debug/app-debug.apk`.

Le backend doit autoriser l’origine WebView Capacitor `https://localhost` dans `CORS_ORIGINS`, en plus des origines web habituelles. Il doit aussi présenter un certificat HTTPS reconnu par Android.

## Mode hors ligne

Les documents téléchargés sont conservés localement pour permettre leur lecture hors ligne, puis supprimés à la déconnexion ou au changement d’instance. La session reste propre à l’élu.
