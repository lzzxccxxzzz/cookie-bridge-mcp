param(
    [string]$GameAppPath,
    [switch]$NoPause
)

# Cookie Bridge — Install Script
# Run as Administrator (required to write to Program Files)
# Usage: Right-click install.ps1 → Run with PowerShell

$ErrorActionPreference = 'Stop'

# ── Detect Cookie Clicker path ────────────────────────────────────────────────
$CC_DEFAULT = "C:\Program Files (x86)\Steam\steamapps\common\Cookie Clicker\resources\app"
if ($GameAppPath) {
    $CC_APP = (Resolve-Path -LiteralPath $GameAppPath).Path
} elseif (Test-Path $CC_DEFAULT) {
    $CC_APP = $CC_DEFAULT
} else {
    Write-Host ""
    Write-Host "Cookie Clicker not found at default path." -ForegroundColor Yellow
    $CC_APP = Read-Host "Enter full path to Cookie Clicker resources\app folder"
}

$CC_APP = (Resolve-Path -LiteralPath $CC_APP).Path
$CC_MODS = Join-Path $CC_APP "mods\local"

$ROOT = $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $CC_APP 'src\main.js'))) {
    throw 'Expected a Cookie Clicker resources\app folder containing src\main.js.'
}
$gameRoot = Split-Path (Split-Path $CC_APP)
$gameExe = Join-Path $gameRoot 'Cookie Clicker.exe'
if (Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $gameExe }) {
    throw 'Close this Cookie Clicker instance before installing.'
}
$controlFiles = @('main.js', 'control-schema.js', 'control-runtime.js', 'control-queue.js', 'info.txt')
foreach ($source in @('start.js') + @($controlFiles | ForEach-Object { 'mod_api\' + $_ })) {
    if (-not (Test-Path -LiteralPath (Join-Path $ROOT $source))) { throw "Missing source file: $source" }
}

Write-Host ""
Write-Host "Cookie Bridge Installer" -ForegroundColor Cyan
Write-Host "  Game path : $CC_APP" -ForegroundColor Gray
Write-Host "  Repo root : $ROOT" -ForegroundColor Gray
Write-Host ""

# ── Backup original start.js ──────────────────────────────────────────────────
$ORIG = Join-Path $CC_APP "start.js"
$BAK  = Join-Path $CC_APP "start.js.original"
$backupRoot = Join-Path $CC_APP ('cookie-bridge-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
if (Test-Path -LiteralPath $ORIG) { Copy-Item -LiteralPath $ORIG -Destination (Join-Path $backupRoot 'start.js') }
$existingMod = Join-Path $CC_MODS 'mod_api'
if (Test-Path -LiteralPath $existingMod) { Copy-Item -LiteralPath $existingMod -Destination (Join-Path $backupRoot 'mod_api') -Recurse }
Write-Host "[backup] Previous bridge files: $backupRoot" -ForegroundColor Green
if ((Test-Path $ORIG) -and -not (Test-Path $BAK)) {
    Copy-Item $ORIG $BAK -Force
    Write-Host "[backup] start.js.original saved" -ForegroundColor Green
}

# ── Install patched start.js ──────────────────────────────────────────────────
Copy-Item (Join-Path $ROOT "start.js") $ORIG -Force
Write-Host "[OK] start.js installed" -ForegroundColor Green

# ── Install mod ───────────────────────────────────────────────────────────────
$MOD_DEST = Join-Path $CC_MODS "mod_api"
if (-not (Test-Path $MOD_DEST)) {
    New-Item -ItemType Directory -Path $MOD_DEST -Force | Out-Null
}
foreach ($ControlFile in $controlFiles) {
    Copy-Item -LiteralPath (Join-Path (Join-Path $ROOT 'mod_api') $ControlFile) -Destination (Join-Path $MOD_DEST $ControlFile) -Force
}
Write-Host "[OK] mod_api installed to $MOD_DEST" -ForegroundColor Green

Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Cyan
Write-Host "Start Cookie Clicker and open http://localhost:8000/docs" -ForegroundColor White
Write-Host ""
if (-not $NoPause) { Pause }
