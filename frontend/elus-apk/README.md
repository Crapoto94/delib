# APK de l'espace des élus

L'application Android est une **enveloppe Capacitor** autour du build web des élus : une seule base de code (web + APK).

## Construire
```
cd frontend
VITE_ELUS_API=https://elus.exemple.fr/api/v1 npm run build:elus      # -> dist-elus
cd elus-apk
npm init -y && npm i @capacitor/core @capacitor/cli @capacitor/android
npx cap add android && npx cap sync android
npx cap open android                                                   # Android Studio : Build > Generate Signed APK
```
Côté backend, ajouter `https://localhost` à `CORS_ORIGINS` (origine de la WebView Capacitor).

## Téléchargement en arrière-plan (ELU-65)
- **Ce qui est fait** : le code de l'application (`src/elus/docs.ts`) télécharge en arrière-plan les documents de la séance dans le stockage de l'appareil
  (manifeste versionné, 3 en parallèle, reprise, contrôle de version, respect de l'économiseur de données, purge à la déconnexion).
  Il démarre à l'ouverture de l'application, au retour du réseau, au retour au premier plan et toutes les 10 minutes. Le passage d'un point à l'autre lit
  le stockage local : il est instantané.
- **Extension native (à ajouter à la construction de l'APK)** : pour poursuivre le téléchargement **application fermée**, brancher un plugin d'arrière-plan
  (WorkManager, p. ex. `@capacitor/background-runner`) qui appelle la même fonction `prefetchSeance(seanceId)` avec le jeton de session. L'interface ne change pas.
- **Sécurité** : jeton d'élu court (12 h), documents nominatifs filigranés, stockage propre à l'élu et effacé à la déconnexion ; épinglage de certificat possible via le plugin HTTP natif.
