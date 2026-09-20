/**
 * Transports de sauvegarde (SAV-03) : où et comment la sauvegarde est déposée.
 *  - « local » : un dossier accessible tel quel (disque, lecteur réseau déjà monté, tests) ;
 *  - « smb »   : partage Windows (chemin UNC) avec identifiant et mot de passe. Le mot de passe est transmis au processus de copie par
 *    VARIABLE D'ENVIRONNEMENT — jamais sur une ligne de commande ; la connexion est ouverte puis refermée à chaque opération.
 * Contrat : tester(), copier({ source, nom, fichiers }), lister(), supprimer(nom).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { E } = require('../../shared/errors');

const NOM = /^vibedelib_\d{4}-\d{2}-\d{2}_\d{4}$/;

// ------------------------------------------------------------------------------------------------------------------ local
function transportLocal(cible) {
  const racine = path.resolve(cible);
  return {
    type: 'local',
    async tester() {
      await fs.promises.mkdir(racine, { recursive: true });
      const f = path.join(racine, `.vibedelib-test-${process.pid}-${Date.now()}`);
      await fs.promises.writeFile(f, 'ok'); await fs.promises.rm(f, { force: true });
      return { ok: true, message: `Dossier accessible en écriture : ${racine}` };
    },
    async copier({ source, nom, fichiers }) {
      if (!NOM.test(nom)) throw E.badRequest('Nom de sauvegarde invalide');
      await fs.promises.mkdir(racine, { recursive: true });
      await fs.promises.cp(source, path.join(racine, nom), { recursive: true });
      let copies = 0;
      if (fichiers) { // copie incrémentale : les fichiers sont immuables, seuls les nouveaux sont copiés
        const dest = path.join(racine, 'fichiers');
        const marcher = async (d, rel) => {
          for (const e of await fs.promises.readdir(d, { withFileTypes: true })) {
            if (e.name === '.cache-alfresco') continue;
            const src = path.join(d, e.name); const r = path.join(rel, e.name);
            if (e.isDirectory()) await marcher(src, r);
            else if (!(await fs.promises.access(path.join(dest, r)).then(() => true, () => false))) { await fs.promises.mkdir(path.dirname(path.join(dest, r)), { recursive: true }); await fs.promises.copyFile(src, path.join(dest, r)); copies++; }
          }
        };
        await marcher(fichiers, '');
      }
      return { fichiersCopies: copies };
    },
    async lister() { try { return (await fs.promises.readdir(racine, { withFileTypes: true })).filter((e) => e.isDirectory() && NOM.test(e.name)).map((e) => e.name).sort(); } catch { return []; } },
    async supprimer(nom) { if (!NOM.test(nom)) throw E.badRequest('Nom de sauvegarde invalide'); await fs.promises.rm(path.join(racine, nom), { recursive: true, force: true }); },
  };
}

// ------------------------------------------------------------------------------------------------------------------ partage Windows (UNC)
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$unc = $env:VD_BK_UNC.TrimEnd('\')
$parts = $unc.TrimStart('\').Split('\')
if ($parts.Length -lt 2) { throw "Chemin UNC invalide (attendu : \\serveur\partage\dossier)" }
$share = '\\' + $parts[0] + '\' + $parts[1]
$mapped = $false
if ($env:VD_BK_USER) {
  try { Remove-SmbMapping -RemotePath $share -Force -UpdateProfile -ErrorAction SilentlyContinue } catch {}
  New-SmbMapping -RemotePath $share -UserName $env:VD_BK_USER -Password $env:VD_BK_PASS | Out-Null
  $mapped = $true
}
try {
  switch ($env:VD_BK_ACTION) {
    'tester' {
      New-Item -ItemType Directory -Force -Path $unc | Out-Null
      $f = Join-Path $unc ('.vibedelib-test-' + [guid]::NewGuid().ToString('N'))
      Set-Content -Path $f -Value 'ok'; Remove-Item $f -Force
      Write-Output 'OK'
    }
    'copier' {
      $dest = Join-Path $unc $env:VD_BK_NOM
      New-Item -ItemType Directory -Force -Path $dest | Out-Null
      robocopy $env:VD_BK_SRC $dest /E /R:2 /W:5 /NFL /NDL /NJH /NJS /NP | Out-Null
      if ($LASTEXITCODE -ge 8) { throw "robocopy (base) : code $LASTEXITCODE" }
      if ($env:VD_BK_FICHIERS) {
        robocopy $env:VD_BK_FICHIERS (Join-Path $unc 'fichiers') /E /XD .cache-alfresco /R:2 /W:5 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy (fichiers) : code $LASTEXITCODE" }
      }
      Write-Output 'OK'
    }
    'lister' { if (Test-Path $unc) { Get-ChildItem -Path $unc -Directory -Filter 'vibedelib_*' | ForEach-Object { $_.Name } } }
    'supprimer' { Remove-Item -Path (Join-Path $unc $env:VD_BK_NOM) -Recurse -Force; Write-Output 'OK' }
    default { throw "Action inconnue" }
  }
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)  # message brut sur stderr (pas de CLIXML)
  exit 1
} finally {
  if ($mapped) { try { Remove-SmbMapping -RemotePath $share -Force -UpdateProfile -ErrorAction SilentlyContinue } catch {} }
}
`;
const SCRIPT_B64 = Buffer.from(SCRIPT, 'utf16le').toString('base64');

function executer(env, { timeoutMs = 4 * 3600 * 1000, secrets = [] } = {}) {
  return new Promise((resolve, reject) => {
    const enfant = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', SCRIPT_B64], { env: { ...process.env, ...env }, windowsHide: true });
    let sortie = ''; let erreur = '';
    const propre = (t) => secrets.filter(Boolean).reduce((s, x) => s.split(x).join('***'), String(t)).replace(/#< CLIXML[\s\S]*$/m, '').trim().slice(0, 600);
    const minuteur = setTimeout(() => { enfant.kill(); reject(E.upstream('Le partage réseau ne répond pas (délai dépassé)')); }, timeoutMs);
    enfant.stdout.on('data', (d) => { sortie += d; }); enfant.stderr.on('data', (d) => { erreur += d; });
    enfant.on('error', (e) => { clearTimeout(minuteur); reject(E.upstream(`PowerShell indisponible : ${e.message}`)); });
    enfant.on('close', (code) => { clearTimeout(minuteur); code === 0 ? resolve(sortie) : reject(E.upstream(propre(erreur || sortie) || `Échec de l'accès au partage (code ${code})`)); });
  });
}

function transportSmb({ cible, utilisateur, motDePasse }) {
  const base = { VD_BK_UNC: cible, VD_BK_USER: utilisateur || '', VD_BK_PASS: motDePasse || '' };
  const secrets = [motDePasse];
  const run = (action, extra = {}) => executer({ ...base, VD_BK_ACTION: action, ...extra }, { secrets });
  return {
    type: 'smb',
    async tester() { await run('tester'); return { ok: true, message: `Partage accessible en écriture : ${cible}` }; },
    async copier({ source, nom, fichiers }) {
      if (!NOM.test(nom)) throw E.badRequest('Nom de sauvegarde invalide');
      await run('copier', { VD_BK_SRC: source, VD_BK_NOM: nom, VD_BK_FICHIERS: fichiers || '' });
      return { fichiersCopies: null };
    },
    async lister() { return String(await run('lister')).split(/\r?\n/).map((x) => x.trim()).filter((x) => NOM.test(x)).sort(); },
    async supprimer(nom) { if (!NOM.test(nom)) throw E.badRequest('Nom de sauvegarde invalide'); await run('supprimer', { VD_BK_NOM: nom }); },
  };
}

/** Choisit le transport d'après la cible : UNC → partage Windows ; sinon dossier accessible tel quel. */
function choisirTransport({ cible, utilisateur, motDePasse }) {
  const c = String(cible || '').trim();
  if (!c) throw E.conflict('Aucune destination de sauvegarde configurée');
  if (/^\\\\[^\\]+\\[^\\]+/.test(c)) {
    if (process.platform !== 'win32') throw E.conflict('Un chemin réseau UNC n\'est pris en charge que sous Windows : montez le partage et indiquez le dossier monté');
    return transportSmb({ cible: c, utilisateur, motDePasse });
  }
  return transportLocal(c);
}

module.exports = { choisirTransport, transportLocal, transportSmb, NOM };
