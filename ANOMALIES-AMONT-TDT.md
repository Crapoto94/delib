# Anomalies à remonter à l'éditeur (plateforme de test TDT / ACTES)

Date : 2026-09-30
Contexte : déploiement d'une plateforme de test S2LOW orientée télétransmission
d'actes (module ACTES). Les points ci-dessous relèvent du **dépôt S2LOW
(éditeur Libriciel)**, pas des scripts d'installation ajoutés pour la
plateforme de test.

| # | Gravité | Résumé | Référence principale |
|---|---|---|---|
| 1 | Bloquant | URL du service `pdf-stamp` doublée → tampon des actes jamais appliqué, en silence | `class/PDFStampWrapper.php:11` + `config/services.yaml:78` |
| 2 | Bloquant (API) | Le défaut de `type_acte` est inatteignable → l'API exige `type_acte` | `public.ssl/modules/actes/actes_transac_create.php:316-333` |
| 3 | Majeur | `ActeTamponne` masque les erreurs et renvoie le PDF non tamponné | `class/actes/ActeTamponne.php:58-60` |
| 4 | Majeur (test/recette) | Le cron `validca.sh` efface toute CA locale (RGS) toutes les heures | `docker/app/cron.d/validca:1`, `docker/web/crontab:1` |
| 5 | Mineur | Lecture du statut ACTES : droit de modification (`RW`) exigé | `public.ssl/modules/actes/actes_transac_get_status.php:22` |
| 6 | Mineur | Deux vhosts de même `ServerName` → `421 Misdirected Request` | `docker/web/vhost/mailsec.conf`, `docker/web/vhost/s2low.conf` |

---

## 1. Tampon des actes : URL du service `pdf-stamp` doublée

**Gravité : bloquante (silencieuse).**

**Symptôme :** le téléchargement d'un acte tamponné
(`actes_download_file.php?tampon=true&file=<id>`) renvoie le PDF **non
tamponné**, avec un code HTTP 200. Aucune erreur n'est visible pour l'appelant.

**Cause :** l'URL de base par défaut contient déjà le contexte Tomcat
`/pdf-stamp/`, et le wrapper y ajoute un chemin qui contient lui aussi
`/pdf-stamp` :

- `config/services.yaml:78` : `app.pdf_stamp_url.default: 'http://pdf-stamp:8080/pdf-stamp/'`
  (idem `config/config.php:645`, `compose.yaml:55`, `variables.md:39`)
- `class/PDFStampWrapper.php:11` : `private const STAMP_ADD_PATH = '/pdf-stamp/v3/stamp/add';`
- `class/PDFStampWrapper.php:110-113` : `rtrim($pdfStampUrl, '/') . self::STAMP_ADD_PATH`

URL obtenue : `http://pdf-stamp:8080/pdf-stamp/pdf-stamp/v3/stamp/add` → `404`
(`{"type":"about:blank","title":"Not Found","detail":"No static resource pdf-stamp/v3/stamp/add."}`).

**Impact :** la fonctionnalité « acte tamponné » ne produit jamais de tampon,
en production comme en test, sans alerte côté client (voir anomalie 3).

**Correctif proposé :** base sans le contexte (`http://pdf-stamp:8080`) **ou**
`STAMP_ADD_PATH = '/v3/stamp/add'`, et aligner la valeur par défaut, la
constante legacy et la documentation.

**Reproduction observée :** après avoir forcé `PDF_STAMP_URL=http://pdf-stamp:8080`,
le même appel renvoie un PDF tamponné (taille 20 004 octets contre 15 158 pour
le PDF d'origine).

---

## 2. `actes_transac_create.php` : le défaut de `type_acte` est mort

**Gravité : bloquante pour l'API de dépôt.**

**Symptôme :** un appel API sans le champ `type_acte` est rejeté avec
« Erreur lors de la réception du fichier … : typologie absente ».

**Cause :** deux conditions identiques successives ; la première interrompt le
script, la seconde (qui calcule le défaut) n'est jamais atteinte :

```php
// public.ssl/modules/actes/actes_transac_create.php:316-334
if (empty($type_acte)) {
    Helpers::returnAndExit(1, "… : typologie absente", …);   // sort ici
}
if (empty($type_acte)) {                                      // code mort
    $correspondance_nature_type = array('1' => '99_DE', '2' => '99_AR', …);
    $type_acte = $correspondance_nature_type[$nature_code];
}
```

**Impact :** l'API exige explicitement `type_acte` alors que le code prévoit un
défaut par nature. L'exemple livré `test/api/api_test_actes_transac_create.php`
ne transmet pas `type_acte` et échoue donc.

**Correctif proposé :** supprimer le premier `returnAndExit` ou fusionner les
deux blocs pour que le défaut s'applique.

---

## 3. `ActeTamponne` masque les erreurs de tamponnage

**Gravité : majeure (fiabilité / confiance dans le document).**

**Cause :** en cas d'échec du service de tampon, l'exception est seulement
journalisée et le PDF d'origine est renvoyé :

```php
// class/actes/ActeTamponne.php:58-61
} catch (Exception $e) {
    $this->logger->error("Impossible de tamponner l'acte $transaction_id : " . $e->getMessage());
    return file_get_contents($file_path);   // renvoie le PDF NON tamponné
}
```

**Impact :** un acte non tamponné peut être diffusé en croyant qu'il l'est ;
l'erreur n'apparaît que dans les logs applicatifs.

**Correctif proposé :** propager l'erreur (code HTTP 5xx / message explicite)
au lieu de servir le PDF brut ; éventuellement permettre un mode dégradé
explicite et signalé.

---

## 4. Test/recette : la CA locale (RGS) est effacée toutes les heures

**Gravité : majeure pour les environnements de test/intégration.**

**Cause :** deux crons réinstallent le magasin `_validca` depuis
`validca.libriciel.fr`, ce qui supprime toute AC ajoutée localement :

- `docker/app/cron.d/validca:1` : `10 * * * * /usr/local/bin/validca.sh`
- `docker/web/crontab:1` : `10 * * * * /usr/local/bin/validca.sh && apachectl graceful`

Or `RgsConnexion::isRgsConnexion()` (`class/RgsConnexion.php`) valide le
certificat client contre `RGS_VALIDCA_PATH` (par défaut
`/data/certificates/_validca/validca`). Sans l'AC, la vérification échoue et
l'application refuse les actes : « La télétransmission nécessite un certificat
RGS ».

**Impact :** impossible de tester durablement le flux ACTES/RGS avec une PKI de
recette ou une AC de test ; le comportement change au bout d'une heure.

**Correctif proposé :** prévoir une option (variable d'environnement) pour
désactiver le rafraîchissement, ou un magasin dédié aux CA ajoutées qui n'est
pas écrasé par `validca.sh`.

---

## 5. Lecture du statut ACTES : droit de modification exigé

**Gravité : mineure (ergonomie / moindre privilège).**

**Cause :** `public.ssl/modules/actes/actes_transac_get_status.php:22` exige
`canEdit('actes')`, donc le droit `RW`.

**Impact :** un compte technique en lecture seule (`RO`) ne peut pas consulter
le statut d'un acte ; il faut lui donner `RW`, plus large que nécessaire.

**Correctif proposé :** utiliser `canAccess('actes')` (ou accepter `RO` et `RW`)
pour une opération de lecture.

---

## 6. Deux vhosts de même `ServerName` (`s2low.conf` / `mailsec.conf`)

**Gravité : mineure (dépend du paramétrage des hôtes).**

**Cause :** quand `APP_HOST` et `MAILSEC_HOST` sont identiques,
`docker/web/vhost/mailsec.conf` (inclus avant `s2low.conf`, ordre alphabétique)
devient la vhost 443 par défaut. Un accès par adresse IP (un client TLS
n'envoie pas de SNI pour une IP) est alors rattaché à MAILSEC et Apache répond
`421 Misdirected Request` (ou 403).

**Correctif proposé :** définir explicitement s2low comme vhost par défaut de
`*:443`, ou garantir des `ServerName` distincts.

---

## Hors périmètre éditeur

Ces points proviennent des scripts ajoutés pour la plateforme de test, pas du
dépôt S2LOW : `script/installation/bootstrap-test-platform.sh`,
`script/installation/create-test-ca.sh`, `script/installation/tdt-smoke-test.sh`,
`compose.test-platform.yaml`. Ils ont été corrigés côté plateforme de test et ne
sont pas à remonter à l'éditeur.
