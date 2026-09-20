# pulldocker.ps1 — VibeDélib
# Lit pulldocker.ini (cle:valeur) et exécute cmd1..cmdX en SSH sur le serveur Docker, dans le répertoire « chemin ».
# pulldocker.ini contient des accès : il reste local (voir .gitignore). Modèle : pulldocker.ini.example.
[CmdletBinding()]
param([string]$IniPath)
$ErrorActionPreference = 'Stop'

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
if ([string]::IsNullOrWhiteSpace($IniPath)) { $IniPath = Join-Path $ScriptDir 'pulldocker.ini' }
if (-not (Test-Path $IniPath)) { Write-Error "Fichier de configuration introuvable : $IniPath (copiez pulldocker.ini.example)"; exit 1 }

$config = @{}; $cmds = @{}
Get-Content -Path $IniPath -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#') -or $line.StartsWith(';')) { return }
    $idx = $line.IndexOf(':'); if ($idx -lt 1) { return }
    $key = $line.Substring(0, $idx).Trim(); $value = $line.Substring($idx + 1).Trim()
    if ($key -match '^(?i)cmd(\d+)$') { $cmds[[int]$Matches[1]] = $value } else { $config[$key.ToLower()] = $value }
}
if (-not $config.ContainsKey('port') -or [string]::IsNullOrWhiteSpace($config.port)) { $config.port = '22' }
foreach ($required in @('ip', 'login', 'password', 'chemin')) { if (-not $config.ContainsKey($required)) { Write-Error "Paramètre manquant dans '$IniPath' : $required"; exit 1 } }
if ($cmds.Count -eq 0) { Write-Error "Aucune commande (cmd1, cmd2, ...) dans '$IniPath'"; exit 1 }

$ordered = $cmds.Keys | Sort-Object | ForEach-Object { $cmds[$_] }
# une seule commande distante : cd puis chaque cmdX enchaînée avec && (s'arrête à la première qui échoue)
$remote = "cd `"$($config.chemin)`" && " + ($ordered -join ' && ')

Write-Host "=== Déploiement Docker VibeDélib sur $($config.ip):$($config.port) ===" -ForegroundColor Cyan
Write-Host "Chemin distant : $($config.chemin)"; Write-Host "Commandes      : $($ordered -join ' | ')"; Write-Host ""

$plink = Get-Command plink.exe -ErrorAction SilentlyContinue
$plinkPath = if ($plink) { $plink.Path } elseif (Test-Path 'C:\Program Files\PuTTY\plink.exe') { 'C:\Program Files\PuTTY\plink.exe' } else { $null }
if (-not $plinkPath) { Write-Error 'plink.exe introuvable (PuTTY).'; exit 1 }

& $plinkPath -ssh -P $config.port -batch -pw $config.password "$($config.login)@$($config.ip)" $remote
$code = $LASTEXITCODE
Write-Host ""
if ($code -eq 0) { Write-Host 'Terminé avec succès.' -ForegroundColor Green } else { Write-Host "Échec (code $code). Si plink refuse la clé d'hôte, relancez-le une fois sans -batch pour l'accepter." -ForegroundColor Yellow }
exit $code
