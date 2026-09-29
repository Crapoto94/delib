# pulldmz.ps1
# Copie le dossier elus-dmz/ (uniquement les fichiers suivis par git, pour ne
# jamais embarquer node_modules/ ou dist/ locaux) sur le serveur DMZ distant,
# puis reconstruit et relance le conteneur Docker sur place.
# Lit pulldmz.ini (cle:valeur). Fichier local uniquement (voir .gitignore).

[CmdletBinding()]
param(
    [string]$IniPath
)

$ErrorActionPreference = 'Stop'

$ScriptDir = if ($PSScriptRoot) {
    $PSScriptRoot
} elseif ($MyInvocation.MyCommand.Path) {
    Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    (Get-Location).Path
}

if ([string]::IsNullOrWhiteSpace($IniPath)) {
    $IniPath = Join-Path $ScriptDir 'pulldmz.ini'
}

if (-not (Test-Path $IniPath)) {
    Write-Error "Fichier de configuration introuvable : $IniPath"
    exit 1
}

# --- Parsing du fichier ini (format cle:valeur, une entree par ligne) ---
$config = @{}

Get-Content -Path $IniPath -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#') -or $line.StartsWith(';')) { return }
    $idx = $line.IndexOf(':')
    if ($idx -lt 1) { return }
    $key = $line.Substring(0, $idx).Trim().ToLower()
    $value = $line.Substring($idx + 1).Trim()
    $config[$key] = $value
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

$elusDmzDir = Join-Path $ScriptDir 'elus-dmz'
if (-not (Test-Path $elusDmzDir)) {
    Write-Error "Dossier introuvable : $elusDmzDir"
    exit 1
}

Write-Host "=== Deploiement DMZ (elus-dmz) sur $($config.ip):$($config.port) ===" -ForegroundColor Cyan
Write-Host "Utilisateur    : $($config.login)"
Write-Host "Chemin distant : $($config.chemin)"
Write-Host ""

# Recherche de pscp.exe / plink.exe (PuTTY) pour l'authentification par mot de passe non interactive.
function Find-PuttyTool {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Path }
    # PuTTY s'installe soit pour tous les utilisateurs (Program Files), soit pour l'utilisateur courant
    # (%LOCALAPPDATA%\Programs) : le paquet winget récent choisit le second, et l'installation « programme »
    # peut ne contenir que pscp.exe. Chercher aux deux endroits évite l'échec « plink introuvable ».
    $candidats = @(
        (Join-Path $env:ProgramFiles 'PuTTY'),
        (Join-Path ${env:ProgramFiles(x86)} 'PuTTY'),
        (Join-Path $env:LOCALAPPDATA 'Programs\PuTTY')
    )
    foreach ($dossier in $candidats) {
        if ($dossier -and (Test-Path (Join-Path $dossier $Name))) { return (Join-Path $dossier $Name) }
    }
    Write-Error "$Name introuvable (PuTTY). Installez PuTTY (winget install PuTTY.PuTTY)."
    exit 1
}
$pscpPath = Find-PuttyTool 'pscp.exe'
$plinkPath = Find-PuttyTool 'plink.exe'

# --- Etape 1 : ne copier que les fichiers suivis par git (jamais node_modules/dist locaux) ---
Push-Location $ScriptDir
try {
    $tracked = git ls-files -- 'elus-dmz' | Where-Object { $_ -notmatch '/pulldmz(-.*)?\.ini$' }
} finally {
    Pop-Location
}
if (-not $tracked -or $tracked.Count -eq 0) {
    Write-Error "Aucun fichier suivi par git trouve sous elus-dmz/ (es-tu bien dans un depot git avec des fichiers ajoutes ?)"
    exit 1
}

$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("pulldmz-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    foreach ($rel in $tracked) {
        $src = Join-Path $ScriptDir $rel
        $dst = Join-Path $staging $rel
        $dstDir = Split-Path -Parent $dst
        if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
        Copy-Item -Path $src -Destination $dst -Force
    }
    Write-Host "Fichiers a copier : $($tracked.Count)" -ForegroundColor Cyan

    # L'APK publiée n'est pas versionnée (binaire reconstruit localement) : on l'ajoute au vol si elle est présente,
    # pour que l'image DMZ la serve sous /apk/ sans alourdir le dépôt git.
    $apkSrc = Join-Path $ScriptDir 'elus-dmz\apk'
    $apkFichiers = @(Get-ChildItem -Path $apkSrc -Filter *.apk -ErrorAction SilentlyContinue)
    if ($apkFichiers.Count -gt 0) {
        $apkDst = Join-Path $staging 'elus-dmz\apk'
        if (-not (Test-Path $apkDst)) { New-Item -ItemType Directory -Path $apkDst -Force | Out-Null }
        $apkFichiers | ForEach-Object { Copy-Item -Path $_.FullName -Destination $apkDst -Force }
        Write-Host "APK ajoutee : $($apkFichiers.Name -join ', ')" -ForegroundColor Cyan
    } else {
        Write-Host "Aucune APK locale dans elus-dmz\apk : le telechargement sous /apk/ sera indisponible." -ForegroundColor Yellow
    }

    # --- Etape 2 : creer le dossier distant puis copier (pscp -r) ---
    & $plinkPath -ssh -P $config.port -batch -pw $config.password "$($config.login)@$($config.ip)" "mkdir -p `"$($config.chemin)`""
    if ($LASTEXITCODE -ne 0) { Write-Error "Echec de creation du dossier distant (code $LASTEXITCODE)."; exit $LASTEXITCODE }

    $stagedElusDmz = Join-Path $staging 'elus-dmz'
    & $pscpPath -P $config.port -pw $config.password -batch -r "$stagedElusDmz\*" "$($config.login)@$($config.ip):$($config.chemin)/"
    if ($LASTEXITCODE -ne 0) { Write-Error "Echec de copie (pscp, code $LASTEXITCODE)."; exit $LASTEXITCODE }
} finally {
    Remove-Item -Path $staging -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Etape 3 : construire et relancer le conteneur sur place ---
$remoteCommand = "cd `"$($config.chemin)`" && docker compose build --no-cache && docker compose up -d"
& $plinkPath -ssh -P $config.port -batch -pw $config.password "$($config.login)@$($config.ip)" $remoteCommand
$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "Termine avec succes." -ForegroundColor Green
} else {
    Write-Host "Echec (code $exitCode)." -ForegroundColor Red
}
exit $exitCode
