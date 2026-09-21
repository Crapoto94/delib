# pulldocker.ps1
# Lit pulldocker.ini (cle:valeur) et execute cmd1..cmdX en SSH sur le serveur
# distant, dans le repertoire "chemin". Fichier local uniquement (voir .gitignore).

[CmdletBinding()]
param(
    [string]$IniPath
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot peut etre vide selon la maniere dont le script est invoque
# (double-clic, dot-sourcing, powershell -Command "& ...") : on calcule un
# repli robuste sur le dossier reel du script.
$ScriptDir = if ($PSScriptRoot) {
    $PSScriptRoot
} elseif ($MyInvocation.MyCommand.Path) {
    Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    (Get-Location).Path
}

if ([string]::IsNullOrWhiteSpace($IniPath)) {
    $IniPath = Join-Path $ScriptDir 'pulldocker.ini'
}

if (-not (Test-Path $IniPath)) {
    Write-Error "Fichier de configuration introuvable : $IniPath"
    exit 1
}

# --- Parsing du fichier ini (format cle:valeur, une entree par ligne) ---
$config = @{}
$cmds = @{}

Get-Content -Path $IniPath -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#') -or $line.StartsWith(';')) { return }
    $idx = $line.IndexOf(':')
    if ($idx -lt 1) { return }
    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    if ($key -match '^(?i)cmd(\d+)$') {
        $cmds[[int]$Matches[1]] = $value
    } else {
        $config[$key.ToLower()] = $value
    }
}

if (-not $config.ContainsKey('port') -or [string]::IsNullOrWhiteSpace($config.port)) {
    $config.port = '22'
}

foreach ($required in @('ip', 'login', 'password', 'chemin')) {
    if (-not $config.ContainsKey($required)) {
        Write-Error "Parametre manquant dans '$IniPath' : $required"
        exit 1
    }
}
if ($cmds.Count -eq 0) {
    Write-Error "Aucune commande (cmd1, cmd2, ...) trouvee dans '$IniPath'"
    exit 1
}

$orderedCmds = $cmds.Keys | Sort-Object | ForEach-Object { $cmds[$_] }

# Une seule commande distante : cd puis chaque cmdX enchainee avec &&
# (s'arrete a la premiere commande qui echoue).
$remoteCommand = "cd `"$($config.chemin)`" && " + ($orderedCmds -join ' && ')

Write-Host "=== Deploiement Docker distant sur $($config.ip):$($config.port) ===" -ForegroundColor Cyan
Write-Host "Utilisateur    : $($config.login)"
Write-Host "Chemin distant : $($config.chemin)"
Write-Host "Commandes      : $($orderedCmds -join ' | ')"
Write-Host ""

# Recherche de plink.exe (PuTTY) pour l'authentification par mot de passe non interactive.
$plinkCmd = Get-Command plink.exe -ErrorAction SilentlyContinue
if ($plinkCmd) {
    $plinkPath = $plinkCmd.Path
} elseif (Test-Path 'C:\Program Files\PuTTY\plink.exe') {
    $plinkPath = 'C:\Program Files\PuTTY\plink.exe'
} else {
    Write-Error "plink.exe introuvable (PuTTY). Installez PuTTY, ou adaptez ce script pour utiliser ssh.exe avec une cle."
    exit 1
}

& $plinkPath -ssh -P $config.port -batch -pw $config.password "$($config.login)@$($config.ip)" $remoteCommand
$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "Termine avec succes." -ForegroundColor Green
} else {
    Write-Host "Echec (code $exitCode)." -ForegroundColor Red
    Write-Host "Astuce : si plink refuse la connexion (cle d'hote inconnue), relancez-le" -ForegroundColor Yellow
    Write-Host "une premiere fois sans -batch pour accepter la cle, puis reessayez." -ForegroundColor Yellow
}
exit $exitCode
