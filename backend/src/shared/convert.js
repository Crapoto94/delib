/**
 * Conversion de documents Office en PDF, côté serveur.
 * Sur Windows, s'appuie sur Microsoft Office installé (Word / Excel / PowerPoint) via COM.
 * Ailleurs (ou sans Office), la conversion échoue proprement (l'appelant attache alors le fichier d'origine seul).
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

/** Convertit un tampon Office en PDF ; renvoie le tampon PDF ou `null` si la conversion n'est pas possible. */
async function convertirEnPdf(buffer, ext) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (process.platform !== 'win32' || !EXT_CONVERTIBLES.has(e)) return null;
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

module.exports = { convertirEnPdf, EXT_CONVERTIBLES };
