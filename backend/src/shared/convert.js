/**
 * Conversion de documents Office en PDF, côté serveur. Trois moteurs, dans cet ordre :
 *  1. le moteur externe (port `bureau` : le conteneur du serveur de documents, mutualisé pour l'édition ET la conversion) ;
 *  2. Windows : Microsoft Office installé (Word / Excel / PowerPoint) via COM ;
 *  3. Linux / Docker : LibreOffice (`soffice`), installé dans l'image backend.
 * Un moteur qui échoue laisse la main au suivant ; si aucun ne répond, la conversion échoue proprement
 * (l'appelant attache alors le fichier d'origine seul).
 *
 * Le moteur qui a produit le PDF est renvoyé avec le tampon (`moteur`) : il est enregistré dans `files.moteur`,
 * car le PDF d'une annexe entre dans le dossier remis au conseil et au contrôle de légalité.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);

const EXT_CONVERTIBLES = new Set(['doc', 'docx', 'rtf', 'odt', 'xls', 'xlsx', 'csv', 'ods', 'ppt', 'pptx', 'odp']);

// L'automatisation Office (Word/Excel/PowerPoint) hors session interactive est explicitement déconseillée par
// Microsoft (KB257757) : une boîte de dialogue jamais affichée en headless peut bloquer indéfiniment l'appel COM,
// et le process reste alors ouvert (zombie) même si PowerShell est tué par le timeout de Node (processus distinct,
// pas un enfant). Repli : $pidFile identifie le process créé (diff avant/après) pour que l'appelant puisse le
// forcer à quitter si l'appel ne revient jamais ; $app.Quit() est aussi tenté dans un `finally`.
const SCRIPT = `param([string]$in,[string]$out,[string]$pidFile)
$ErrorActionPreference = 'Stop'
$ext = [System.IO.Path]::GetExtension($in).ToLower()
$app = $null
try {
  if ($ext -in '.doc','.docx','.rtf','.odt') {
    $before = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    $app = New-Object -ComObject Word.Application
    $after = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    ($after | Where-Object { $before -notcontains $_ } | Select-Object -First 1) | Set-Content -Path $pidFile
    $app.Visible = $false; $app.DisplayAlerts = 0
    $d = $app.Documents.Open($in, $false, $true); $d.ExportAsFixedFormat($out, 17); $d.Close($false)
  } elseif ($ext -in '.xls','.xlsx','.csv','.ods') {
    $before = @(Get-Process EXCEL -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    $app = New-Object -ComObject Excel.Application
    $after = @(Get-Process EXCEL -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    ($after | Where-Object { $before -notcontains $_ } | Select-Object -First 1) | Set-Content -Path $pidFile
    $app.Visible = $false; $app.DisplayAlerts = $false
    $wb = $app.Workbooks.Open($in); $wb.ExportAsFixedFormat(0, $out); $wb.Close($false)
  } elseif ($ext -in '.ppt','.pptx','.odp') {
    $before = @(Get-Process POWERPNT -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    $app = New-Object -ComObject PowerPoint.Application
    $after = @(Get-Process POWERPNT -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    ($after | Where-Object { $before -notcontains $_ } | Select-Object -First 1) | Set-Content -Path $pidFile
    $p = $app.Presentations.Open($in, $true, $false, $false); $p.SaveAs($out, 32); $p.Close()
  } else { throw "Extension non gérée : $ext" }
} catch { Write-Error $_.Exception.Message; exit 1 }
finally { if ($app) { try { $app.Quit() } catch {} } }`;

/** Binaires LibreOffice essayés dans l'ordre (surchargeable par SOFFICE_BIN). */
const SOFFICE_BIN = [process.env.SOFFICE_BIN, 'soffice', 'libreoffice', 'soffice.bin'].filter(Boolean);

async function viaWord(buffer, e) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vdconv-'));
  const input = path.join(dir, `in.${e}`);
  const output = path.join(dir, 'out.pdf');
  const script = path.join(dir, 'conv.ps1');
  const pidFile = path.join(dir, 'office.pid');
  try {
    await fs.promises.writeFile(input, buffer);
    await fs.promises.writeFile(script, SCRIPT, 'utf8');
    // Délai court (pas 3 min) : l'automatisation Office headless échoue en général instantanément (COM absent)
    // ou reste bloquée indéfiniment (boîte de dialogue jamais affichée) — un délai long ne fait qu'accumuler des
    // process zombies plus longtemps sans jamais aboutir. LibreOffice (ci-dessous) reste l'essai suivant.
    await execFileP('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, input, output, pidFile], { windowsHide: true, timeout: 30000 });
    return await fs.promises.readFile(output);
  } catch {
    // L'appel n'a pas abouti (erreur ou timeout) : si un process Office a été identifié, on le termine de force
    // plutôt que de laisser un zombie invisible (Visible=$false) consommer de la mémoire indéfiniment.
    try { const pid = Number((await fs.promises.readFile(pidFile, 'utf8')).trim()); if (pid) process.kill(pid); } catch { /* pas de PID capturé, ou déjà terminé */ }
    return null;
  } finally { await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

async function viaLibreOffice(buffer, e) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vdconv-'));
  const input = path.join(dir, `in.${e}`);
  const outDir = path.join(dir, 'out');
  const profile = path.join(dir, 'profile');
  try {
    await fs.promises.writeFile(input, buffer);
    await fs.promises.mkdir(outDir, { recursive: true });
    for (const bin of SOFFICE_BIN) {
      try {
        await execFileP(bin, ['--headless', '--norestore', '--nolockcheck', '--convert-to', 'pdf', '--outdir', outDir, `-env:UserInstallation=file://${profile}`, input], { timeout: 180000 });
        return await fs.promises.readFile(path.join(outDir, 'in.pdf'));
      } catch { /* binaire suivant */ }
    }
    return null;
  } catch { return null; }
  finally { await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

/** Convertit un tampon Office en PDF et indique le moteur employé ; `null` si la conversion est impossible. */
async function convertirEnPdfTrace(buffer, ext, { moteur } = {}) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (!EXT_CONVERTIBLES.has(e)) return null;
  const essais = [
    moteur ? async () => { const r = await moteur.versPdf({ buffer, ext: e }); return r ? { buffer: r.buffer, moteur: r.moteur } : null; } : null,
    process.platform === 'win32' ? async () => { const b = await viaWord(buffer, e); return b ? { buffer: b, moteur: 'office' } : null; } : null,
    async () => { const b = await viaLibreOffice(buffer, e); return b ? { buffer: b, moteur: 'libreoffice' } : null; },
  ];
  for (const essai of essais) {
    if (!essai) continue;
    try { const r = await essai(); if (r) return r; } catch { /* moteur suivant */ }
  }
  return null;
}

/** Convertit un tampon Office en PDF ; renvoie le tampon PDF ou `null` si la conversion n'est pas possible. */
async function convertirEnPdf(buffer, ext, opts) {
  const r = await convertirEnPdfTrace(buffer, ext, opts);
  return r ? r.buffer : null;
}

module.exports = { convertirEnPdf, convertirEnPdfTrace, EXT_CONVERTIBLES };
