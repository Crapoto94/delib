# S²LOW 6.0.0 — l'API ACTES est inatteignable pour un client externe (`/api/get-nounce.php` répond 302 vers `/`)

**Objet** : signalement de bug + correctifs proposés, à l'attention de l'éditeur S²LOW (Libriciel)
**Constaté le** : 30/09/2026
**Environnement** : S²LOW 6.0.0, Symfony 6.4, images `s2low-app:canary` + `s2low-web:canary`, PHP 8.5 (FrankenPHP/PHP-FPM), Apache 2.4.68, PostgreSQL
**Demandeur** : Mairie d'Ivry-sur-Seine — DSI (intégration VibeDélib ↔ S²LOW, module ACTES)

---

## 1. Résumé

Le scénario d'authentification de l'API ACTES décrit par la documentation S²LOW
(et par l'API D20) est **inopérant** :

1. `GET /api/get-nounce.php` avec **certificat client + HTTP Basic** doit renvoyer
   `200` et `{"nounce":"…"}` ;
2. `GET /modules/actes/actes_transac_post_confirm_api.php?...&nounce=…&login=…&hash=sha256(motdepasse:nounce)`
   doit confirmer l'acte.

En pratique, l'étape 1 **répond toujours `302 Location: /`**, quel que soit le
certificat client, la session ou les identifiants. Le nonce n'est jamais délivré
et aucun acte ne peut être acquitté depuis un progiciel tiers.

Quatre défauts indépendants, tous côté éditeur, doivent être corrigés :

| # | Composant | Nature |
|---|-----------|--------|
| A | `AuthenticationNounceController` | Garde `ROLE_USER` insatisfiable → 403 systématique |
| B | `ExceptionSubscriber` | Transforme tout 403 en `302 /` au lieu d'un code d'erreur |
| C | `SharedCertificateAuthenticator`, `SimpleCertificateAuthenticator` | Redirection inconditionnelle vers `/` en cas de succès |
| D | image `s2low-web` (vhost Apache) | L'en-tête `Authorization` n'est pas transmis à PHP-FPM |

Après correction des quatre points, le flux complet est validé : nonce délivré
puis acte confirmé (statut `17 En attente d'être postée` → `1 Posté`).

---

## 2. Symptôme

Test depuis un client externe (certificat client valide, `SSL_CLIENT_VERIFY=SUCCESS`),
agent TLS présentant `p12` + `Authorization: Basic` :

| # | Requête | Réponse observée | Attendu |
|---|---------|------------------|---------|
| 1 | `GET /api/info-connexion.php` | `200` + JSON | conforme |
| 2 | `POST /login.php` (login + mot de passe valides) | `200` + `PHPSESSID` | conforme |
| 3 | `GET /api/get-nounce.php` + `Authorization: Basic` | **`302 → /`** | `200` + `{"nounce":"…"}` |
| 4 | `GET /api/get-nounce.php` + cookie de session | **`302 → /`** | idem |
| 5 | `GET /api/get-nounce.php` + session + Basic | **`302 → /`** | idem |

Corps de la réponse (cas 3 à 5) — page de redirection standard Symfony :

```html
<!DOCTYPE html>
<html>
    <head>
        <meta charset="UTF-8" />
        <meta http-equiv="refresh" content="0;url='/'" />
        <title>Redirecting to /</title>
    </head>
    <body>Redirecting to <a href="/">/</a>.</body>
</html>
```

Le contrôleur `AuthenticationNounceController` n'est **jamais exécuté** : aucune
trace de nonce ni de message d'erreur dans la réponse.

---

## 3. Défaut A — `#[IsGranted('ROLE_USER')]` ne peut jamais être satisfait

`src/Controller/AuthenticationNounceController.php:22`

```php
#[Route('/api/get-nounce.php', name: 'get-nounce', methods: ['GET'])]
#[IsGranted('ROLE_USER')]
public function createNounce(Request $request): Response
```

Or les rôles S²LOW sont construits dans `src/Security/SecurityUser.php:56` :

```php
public function getRoles(): array
{
    return ['ROLE_' . $this->role];
}
```

Un utilisateur reçoit donc exactement **`ROLE_ADM`**, `ROLE_`… selon sa colonne
`role`, et **jamais `ROLE_USER`**. `config/packages/security.yaml` ne déclare par
ailleurs **aucune `role_hierarchy`** :

```yaml
security:
    providers:
        app_user_provider:
            id: S2low\Security\SecurityUserProvider
    firewalls:
        teletransmission_api: { ... }
        main: { ... }
    access_control:
```

`ROLE_USER` n'est donc accordé à **personne**, y compris aux administrateurs.
`#[IsGranted('ROLE_USER')]` lève systématiquement une `AccessDeniedException`.

**Preuve** — journal applicatif instrumenté sur l'instance de test :

```
SUCCESS SharedCert pathInfo=/api/get-nounce.php firewall=main roles=["ROLE_ADM"]
EXC AccessDeniedException :: Access Denied by #[IsGranted("ROLE_USER")] on controller @ /api/get-nounce.php
```

L'authentification réussit (`SUCCESS`, rôle `ROLE_ADM`), puis la garde refuse.

**Correctif** — la route a besoin d'« un utilisateur authentifié », pas d'un rôle
particulier :

```diff
     #[Route('/api/get-nounce.php', name: 'get-nounce', methods: ['GET'])]
-    #[IsGranted('ROLE_USER')]
+    #[IsGranted('IS_AUTHENTICATED_FULLY')]
     public function createNounce(Request $request): Response
```

> Alternative si la sémantique `ROLE_USER` est voulue ailleurs : déclarer
> `security.role_hierarchy` (`ROLE_USER: []`, puis chaque rôle métier héritant de
> `ROLE_USER`). Le remplacement par `IS_AUTHENTICATED_FULLY` est toutefois plus
> lisible ici et sans effet de bord.

---

## 4. Défaut B — `ExceptionSubscriber` masque tout refus par un `302` vers l'accueil

`src/EventSubscriber/ExceptionSubscriber.php:32`

```php
public function onKernelException(ExceptionEvent $event): void
{
    $exception = $event->getThrowable();

    if ($exception instanceof AccessDeniedHttpException || $exception instanceof AccessDeniedException) {
        $request = $this->requestStack->getCurrentRequest();
        if ($request && $request->hasSession()) {
            $request->getSession()->getFlashBag()->add(
                'error',
                "Accès refusé : Vous n'avez pas les droits pour accéder à cette page."
            );
        }

        $url = $this->urlGenerator->generate('index');
        $response = new RedirectResponse($url);   // <-- 302 vers '/'

        $event->setResponse($response);
    }
}
```

Ce comportement est acceptable pour l'IHM, mais désastreux pour une API :

- il **transforme un 403 en 302** et masque la cause réelle (le client ne voit
  qu'une page de connexion) ;
- il **casse le contrat `url_return`** des scripts legacy `*_api.php`, qui
  transportent leur résultat dans `%%ERROR%%` / `%%MESSAGE%%` de l'URL de retour ;
- il rend illisible le JSON de `/api/*.php`.

C'est ce défaut qui produit exactement le `302 → /` observé au §2, une fois le
défaut A déclenché.

**Correctif** — laisser les chemins d'API sortir par un code de statut :

```diff
 use Symfony\Component\EventDispatcher\EventSubscriberInterface;
+use Symfony\Component\HttpFoundation\JsonResponse;
 use Symfony\Component\HttpFoundation\RedirectResponse;
 use Symfony\Component\HttpFoundation\RequestStack;
+use Symfony\Component\HttpFoundation\Response;
@@
     public function onKernelException(ExceptionEvent $event): void
     {
         $exception = $event->getThrowable();
 
         if ($exception instanceof AccessDeniedHttpException || $exception instanceof AccessDeniedException) {
             $request = $this->requestStack->getCurrentRequest();
+
+            // Un appel d'API doit renvoyer un code de statut, pas une redirection
+            // vers la page d'accueil : le contrat url_return des *_api.php et le
+            // JSON de /api/*.php en dependent.
+            if ($request && $this->isApiPath($request->getPathInfo())) {
+                $event->setResponse(new JsonResponse(
+                    ['error' => 'access_denied'],
+                    Response::HTTP_FORBIDDEN
+                ));
+
+                return;
+            }
+
             if ($request && $request->hasSession()) {
                 $request->getSession()->getFlashBag()->add(
                     'error',
                     "Accès refusé : Vous n'avez pas les droits pour accéder à cette page."
                 );
             }
@@
             $event->setResponse($response);
         }
     }
+
+    /**
+     * Les routes d'API repondent par un code de statut ou par "url_return" :
+     * elles ne doivent jamais etre redirigees vers l'IHM.
+     */
+    private function isApiPath(string $pathInfo): bool
+    {
+        return str_starts_with($pathInfo, '/api/')
+            || str_contains($pathInfo, '_api.php');
+    }
```

---

## 5. Défaut C — redirection inconditionnelle dans les authentificateurs du pare-feu `main`

Fichiers `src/Security/SharedCertificateAuthenticator.php:88` et
`src/Security/SimpleCertificateAuthenticator.php:83` :

```php
public function onAuthenticationSuccess(Request $request, TokenInterface $token, string $firewallName): ?Response
{
    $targetPath = $this->getTargetPath($request->getSession(), $firewallName);

    if ($targetPath) {
        return new RedirectResponse($targetPath);
    }

    return null;
}
```

`TargetPathTrait::getTargetPath()` renvoie la **cible de navigation par défaut**
(`'/'`) lorsqu'aucune cible n'est mémorisée en session — ce qui est toujours le
cas d'un client d'API. Une fois le défaut A corrigé, l'authentification réussit
et cette méthode **interrompt la réponse par une redirection** avant que le
contrôleur ne s'exécute.

Note : `NounceAuthenticator::onAuthenticationSuccess()` (pare-feu
`teletransmission_api`, stateless) renvoie déjà `null` — l'intention « pas de
redirection pour une API » est donc bien connue du code, elle n'a simplement pas
été appliquée aux deux authenticateurs du pare-feu `main`.

**Correctif** — dans **les deux** fichiers :

```diff
     public function onAuthenticationSuccess(Request $request, TokenInterface $token, string $firewallName): ?Response
     {
+        // Un appel d'API ne doit jamais etre redirige : la cible de navigation par
+        // defaut ('/') interrompt la reponse (JSON attendu par /api/*.php) avant
+        // que le controleur ne soit execute.
+        if (str_starts_with($request->getPathInfo(), '/api/')) {
+            return null;
+        }
+
         $targetPath = $this->getTargetPath($request->getSession(), $firewallName);
```

Le comportement de navigation de l'IHM est inchangé : la garde ne s'applique
qu'aux chemins `/api/`.

---

## 6. Défaut D — l'en-tête `Authorization` n'atteint pas PHP-FPM

C'est le défaut le plus sournois : il rend l'authentification HTTP Basic
**impossible sur toute l'application**, et pas seulement sur l'API.

Le vhost embarqué dans l'image `s2low-web` (`/usr/local/apache2/conf/vhosts/s2low.conf`,
source : `docker/web/vhost/s2low.conf`) délègue PHP à FPM :

```apache
<FilesMatch \.php$>
    SetHandler "proxy:fcgi://app:9000"
</FilesMatch>
```

Avec `mod_proxy_fcgi`, Apache **ne transmet pas** l'en-tête `Authorization` au
backend par défaut. PHP-FPM ne renseigne donc jamais `$_SERVER['PHP_AUTH_USER']`
ni `$_SERVER['PHP_AUTH_PW']`.

Conséquences en cascade :

- `SharedCertificateAuthenticator::supports()` teste
  `$request->server->get('PHP_AUTH_USER')` : toujours `null` → l'authenticateur
  HTTP Basic **ne se déclenche jamais** ;
- le contrôleur exige explicitement un login/mot de passe HTTP et répond
  `401 "La fonction n'est utilisable qu'avec un login+mot de passe HTTP"` ;
- `NounceAuthenticator::supports()` **refuse** toute requête portant
  `PHP_AUTH_USER` : comme le header n'arrive pas, l'appel de confirmation
  pouvait au contraire se croire « non-Basic » — d'où une confusion de diagnostic
  supplémentaire.

**Preuve** — journal instrumenté, avant / après correctif, sur `/api/get-nounce.php` :

```
avant : SUPPORTS-ENTER SharedCert ... PHP_AUTH_USER=NULL hdr=NULL
après : SUPPORTS-ENTER SharedCert ... PHP_AUTH_USER='delib-api' hdr='Basic ZGVsaWItYXBpOmRlbGliLWFwaQ=='
```

**Correctif** — recopier l'en-tête dans une variable transmise par FastCGI, dans
les **deux** blocs `<VirtualHost>` (`:80` et `:443`) :

```apache
# Transmission de l'en-tete Authorization a PHP-FPM. Indispensable pour que
# PHP_AUTH_USER / PHP_AUTH_PW soient renseignes (authentification HTTP Basic,
# API ACTES via /api/get-nounce.php).
SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
```

`SetEnvIf` produit `HTTP_AUTHORIZATION`, que `mod_proxy_fcgi` transmet à PHP-FPM
sous forme de `$_SERVER['HTTP_AUTHORIZATION']` ; PHP-FPM en dérive alors
`PHP_AUTH_USER` / `PHP_AUTH_PW`. C'est la correction de référence pour FastCGI.

---

## 7. Défauts annexes constatés (à corriger au passage)

1. **`CreateSecurityResponseTrait::createConnexionImpossibleResponse()`**
   (`src/Security/CreateSecurityResponseTrait.php:9`) renvoie un **HTTP 200** pour
   un échec d'authentification, et sa chaîne source est doublement mal encodée :

   ```php
   $retour = "KO\nLa connexion n&#039;a pas pu ?tre ?tablie\n";
   ```

   Un client ne peut pas distinguer succès et échec par le code de statut, et le
   message affiché est corrompu (`?tre ?tablie`). À l'arrivée, le client reçoit
   en outre une conversion ISO-8859-1 via `mb_convert_encoding()`. Il faudrait
   renvoyer `401`, une chaîne correctement encodée (`être établie`), et du UTF-8.

2. **`LegacyController::loadLegacyScript()`** (`src/Controller/LegacyController.php:24`)
   intercepte toute exception d'un script legacy pour la `var_dump()` dans le
   corps de la réponse (`<pre class='xdebug-var-dump'>`). En environnement de
   test/dév, cette sortie de débogage fuit dans les réponses d'API. À réserver à
   un `APP_ENV=dev` explicite.

3. **`NounceAuthenticator::supports()`** refuse la requête dès que
   `PHP_AUTH_USER` est présent. Autrement dit, sur
   `actes_transac_post_confirm_api.php`, **l'authentification par nonce remplace
   l'HTTP Basic** : envoyer les deux fait échouer la confirmation. Ce n'est pas
   forcément un défaut, mais l'ambiguïté mériterait d'être documentée côté API
   (un client qui « réutilise » son agent Basic, comme le nôtre au premier essai,
   se trompe silencieusement).

---

## 8. Vérification après correctifs (instance de test)

Flux complet exécuté depuis un client externe (certificat `CN=delib-api`) :

| Étape | Résultat |
|-------|----------|
| `GET /api/get-nounce.php` + Basic | **`200` `{"nounce":"2ntdB4K"}`** |
| `GET …/actes_transac_post_confirm_api.php?id=19&nounce=…&login=…&hash=…` | **`302 → url_return?e=0`** |
| Transaction 19 en base | **`status_id 17` « En attente d'être postée » → `1` « Posté »** |

Non-régressions vérifiées :

- `GET /` → `200` (page S²LOW) ;
- `POST /login.php` → `200` + `PHPSESSID`, puis `GET /` avec session → `200` ;
- `GET /admin/` **sans** session → `302` vers l'URL de connexion (comportement
  IHM normal, préservé) ;
- `GET /api/get-nounce.php` **certificat seul** → `401 "La fonction n'est
  utilisable qu'avec un login+mot de passe HTTP"` (garde du contrôleur) ;
- `GET /api/get-nounce.php` Basic **incorrect** → échec d'authentification
  propre, **plus de `302 → /`** ;
- `actes_transac_post_confirm_api.php` avec nonce inconnu ou hash erroné →
  `302 → url_return?e=1&m=La connexion à échoué` (contrat `url_return` respecté).

---

## 9. Récapitulatif des patchs

| Fichier | Nature |
|---------|--------|
| `src/Controller/AuthenticationNounceController.php` | `ROLE_USER` → `IS_AUTHENTICATED_FULLY` |
| `src/EventSubscriber/ExceptionSubscriber.php` | 403 JSON au lieu de `302 /` sur les chemins d'API |
| `src/Security/SharedCertificateAuthenticator.php` | pas de redirection sur `/api/` |
| `src/Security/SimpleCertificateAuthenticator.php` | pas de redirection sur `/api/` |
| `docker/web/vhost/s2low.conf` (image `s2low-web`) | `SetEnvIf Authorization` → `HTTP_AUTHORIZATION` (vhosts `:80` et `:443`) |
| `src/Security/CreateSecurityResponseTrait.php` *(souhaitable)* | `401` au lieu de `200`, chaîne corrigée, UTF-8 |
| `src/Controller/LegacyController.php` *(souhaitable)* | ne pas `var_dump()` les exceptions hors dev |

Ces correctifs sont appliqués et validés sur notre instance de test. Le défaut D
(vhost) est contourné via une surcharge Docker en attendant une image corrigée.
