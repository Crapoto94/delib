/**
 * Accès à une source dossier / partage réseau pour les collecteurs d'arrêtés.
 *  - chemin UNC (« \\serveur\partage\… »)  → partage Windows (identifiant / mot de passe via VARIABLES D'ENVIRONNEMENT) ;
 *  - tout autre chemin                      → dossier accessible tel quel (disque, lecteur monté, tests).
 * Un même script PowerShell encodé couvre les opérations : tester, lister les sous-dossiers, lister les fichiers
 * (profondeur 1), lire un fichier (base64 sur la sortie standard), déplacer, copier et supprimer.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { E } = require('../../shared/errors');

// ------------------------------------------------------------------------------------------------------------------ dossier local
function partageLocal(cible) {
  const racine = path.resolve(cible);
  const chemins = (sous) => path.join(racine, ...(sous ? (Array.isArray(sous) ? sous : [sous]) : []).map(String));
  return {
    type: 'local',
    async tester() {
      await fs.promises.mkdir(racine, { recursive: true });
      const f = path.join(racine, `.vibedelib-test-${process.pid}-${Date.now()}`);
      await fs.promises.writeFile(f, 'ok'); await fs.promises.rm(f, { force: true });
      return { ok: true, message: `Dossier accessible : ${racine}` };
    },
    async listerSousDossiers() {
      try { return (await fs.promises.readdir(racine, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).filter((n) => !n.startsWith('.')).sort(); }
      catch { return []; }
    },
    async listerFichiers(sous) {
      const d = chemins(sous);
      try {
        return (await fs.promises.readdir(d, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => {
          const st = fs.statSync(path.join(d, e.name));
          return { nom: e.name, taille: st.size, modifie: st.mtime.toISOString() };
        }).sort((a, b) => a.nom.localeCompare(b.nom));
      } catch { return []; }
    },
    async lire(sous, nom) { return fs.promises.readFile(path.join(chemins(sous), nom)); },
    async deplace(sous, nom, destSous) {
      const src = path.join(chemins(sous), nom);
      const dest = path.join(chemins(destSous), nom);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.rename(src, dest);
      return dest;
    },
    async copier(sous, nom, destSous) {
      const src = path.join(chemins(sous), nom);
      const dest = path.join(chemins(destSous), nom);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.copyFile(src, dest);
      return dest;
    },
    async supprimer(sous, nom) { await fs.promises.rm(path.join(chemins(sous), nom), { force: true }); },
    async ecrire(sous, nom, buffer) {
      const d = chemins(sous);
      await fs.promises.mkdir(d, { recursive: true });
      await fs.promises.writeFile(path.join(d, nom), buffer);
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------ partage Windows (UNC)
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$base = $env:VD_COL_BASE.TrimEnd('\')
$parts = $base.TrimStart('\').Split('\')
if ($parts.Length -lt 2) { throw "Chemin UNC invalide (attendu : \\serveur\partage\dossier)" }
$share = '\\' + $parts[0] + '\' + $parts[1]
$mapped = $false
if ($env:VD_COL_USER) {
  try { Remove-SmbMapping -RemotePath $share -Force -UpdateProfile -ErrorAction SilentlyContinue } catch {}
  New-SmbMapping -RemotePath $share -UserName $env:VD_COL_USER -Password $env:VD_COL_PASS | Out-Null
  $mapped = $true
}
try {
  switch ($env:VD_COL_ACTION) {
    'tester' {
      New-Item -ItemType Directory -Force -Path $base | Out-Null
      $f = Join-Path $base ('.vibedelib-test-' + [guid]::NewGuid().ToString('N'))
      Set-Content -Path $f -Value 'ok'; Remove-Item $f -Force
      Write-Output 'OK'
    }
    'sous' { if (Test-Path $base) { Get-ChildItem -Path $base -Directory | Where-Object { -not $_.Name.StartsWith('.') } | ForEach-Object { $_.Name } } }
    'fichiers' {
      $d = Join-Path $base $env:VD_COL_SOUS
      if (Test-Path $d) {
        Get-ChildItem -Path $d -File |
          Where-Object { -not $_.Name.StartsWith('.') } |
          ForEach-Object { $_.Name + '|' + $_.Length + '|' + $_.LastWriteTime.ToString('o') }
      }
    }
    'lire' {
      $f = Join-Path (Join-Path $base $env:VD_COL_SOUS) $env:VD_COL_NOM
      if (-not (Test-Path $f)) { throw "Fichier introuvable : $($env:VD_COL_NOM)" }
      [Convert]::ToBase64String([IO.File]::ReadAllBytes($f))
    }
    'deplacer' {
      $f = Join-Path (Join-Path $base $env:VD_COL_SOUS) $env:VD_COL_NOM
      $d = Join-Path $base $env:VD_COL_DEST
      New-Item -ItemType Directory -Force -Path $d | Out-Null
      Move-Item -Path $f -Destination (Join-Path $d $env:VD_COL_NOM) -Force
      Write-Output 'OK'
    }
    'copier' {
      $f = Join-Path (Join-Path $base $env:VD_COL_SOUS) $env:VD_COL_NOM
      $d = Join-Path $base $env:VD_COL_DEST
      New-Item -ItemType Directory -Force -Path $d | Out-Null
      Copy-Item -Path $f -Destination (Join-Path $d $env:VD_COL_NOM) -Force
      Write-Output 'OK'
    }
    'supprimer' { Remove-Item -Path (Join-Path (Join-Path $base $env:VD_COL_SOUS) $env:VD_COL_NOM) -Force; Write-Output 'OK' }
    'ecrire' {
      $d = Join-Path $base $env:VD_COL_DEST
      New-Item -ItemType Directory -Force -Path $d | Out-Null
      [IO.File]::WriteAllBytes((Join-Path $d $env:VD_COL_NOM), [Convert]::FromBase64String($env:VD_COL_BASE64))
      Write-Output 'OK'
    }
    default { throw "Action inconnue" }
  }
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
} finally {
  if ($mapped) { try { Remove-SmbMapping -RemotePath $share -Force -UpdateProfile -ErrorAction SilentlyContinue } catch {} }
}
`;
const SCRIPT_B64 = Buffer.from(SCRIPT, 'utf16le').toString('base64');

function executer(env, { timeoutMs = 120000, secrets = [] } = {}) {
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

function partageSmb({ cible, utilisateur, motDePasse }) {
  const base = { VD_COL_BASE: cible, VD_COL_USER: utilisateur || '', VD_COL_PASS: motDePasse || '' };
  const secrets = [motDePasse];
  const run = (action, extra = {}) => executer({ ...base, VD_COL_ACTION: action, ...extra }, { secrets });
  return {
    type: 'smb',
    async tester() { await run('tester'); return { ok: true, message: `Partage accessible : ${cible}` }; },
    async listerSousDossiers() { return String(await run('sous')).split(/\r?\n/).map((x) => x.trim()).filter(Boolean).sort(); },
    async listerFichiers(sous) {
      return String(await run('fichiers', { VD_COL_SOUS: sous || '' })).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const [nom, taille, modifie] = l.split('|');
        return { nom, taille: Number(taille) || 0, modifie: modifie || null };
      });
    },
    async lire(sous, nom) { return Buffer.from(String(await run('lire', { VD_COL_SOUS: sous || '', VD_COL_NOM: nom })), 'base64'); },
    async deplace(sous, nom, destSous) { await run('deplacer', { VD_COL_SOUS: sous || '', VD_COL_NOM: nom, VD_COL_DEST: destSous || '' }); },
    async copier(sous, nom, destSous) { await run('copier', { VD_COL_SOUS: sous || '', VD_COL_NOM: nom, VD_COL_DEST: destSous || '' }); },
    async supprimer(sous, nom) { await run('supprimer', { VD_COL_SOUS: sous || '', VD_COL_NOM: nom }); },
    async ecrire(sous, nom, buffer) { await run('ecrire', { VD_COL_DEST: sous || '', VD_COL_NOM: nom, VD_COL_BASE64: buffer.toString('base64') }); },
  };
}

/** Choisit un transport d'après la cible : UNC → partage Windows ; sinon dossier tel quel. */
function choisirPartage({ cible, utilisateur, motDePasse }) {
  const c = String(cible || '').trim();
  if (!c) throw E.conflict('Aucun dossier source configuré');
  if (/^\\\\[^\\]+\\[^\\]+/.test(c)) {
    if (process.platform !== 'win32') throw E.conflict('Un chemin réseau UNC n\'est pris en charge que sous Windows : montez le partage et indiquez le dossier monté');
    return partageSmb({ cible: c, utilisateur, motDePasse });
  }
  return partageLocal(c);
}

module.exports = { choisirPartage, partageLocal, partageSmb };