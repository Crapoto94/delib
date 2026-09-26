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

const SCRIPT = `param([string]$in,[string]$out)
$ErrorActionPreference = 'Stop'
$ext = [System.IO.Path]::GetExtension($in).ToLower()
try {
  if ($ext -in '.doc','.docx','.rtf','.odt') {
    $app = New-Object -ComObject Word.Application; $app.Visible = $false; $app.DisplayAlerts = 0
    $d = $app.Documents.Open($in, $false, $true); $d.ExportAsFixedFormat($out, 17); $d.Close($false); $app.Quit()
  } elseif ($ext -in '.xls','.xlsx','.csv','.ods') {
    $app = New-Object -ComObject Excel.Application; $app.Visible = $false; $app.DisplayAlerts = $false
    $wb = $app.Workbooks.Open($in); $wb.ExportAsFixedFormat(0, $out); $wb.Close($false); $app.Quit()
  } elseif ($ext -in '.ppt','.pptx','.odp') {
    $app = New-Object -ComObject PowerPoint.Application
    $p = $app.Presentations.Open($in, $true, $false, $false); $p.SaveAs($out, 32); $p.Close(); $app.Quit()
  } else { throw "Extension non gérée : $ext" }
} catch { Write-Error $_.Exception.Message; exit 1 }`;

/** Binaires LibreOffice essayés dans l'ordre (surchargeable par SOFFICE_BIN). */
const SOFFICE_BIN = [process.env.SOFFICE_BIN, 'soffice', 'libreoffice', 'soffice.bin'].filter(Boolean);

async function viaWord(buffer, e) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vdconv-'));
  const input = path.join(dir, `in.${e}`);
  const output = path.join(dir, 'out.pdf');
  const script = path.join(dir, 'conv.ps1');
  try {
    await fs.promises.writeFile(input, buffer);
    await fs.promises.writeFile(script, SCRIPT, 'utf8');
    await execFileP('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, input, output], { windowsHide: true, timeout: 180000 });
    return await fs.promises.readFile(output);
  } catch { return null; }
  finally { await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); }
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
