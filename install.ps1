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

$CC_MODS = Join-Path (Split-Path $CC_APP) "resources\app\mods\local"
# handle both cases: user gave ..\resources\app or ..\resources\app already
$CC_MODS = Join-Path $CC_APP "mods\local"

$ROOT = $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $CC_APP 'src\main.js'))) {
    throw 'Expected a Cookie Clicker resources\app folder containing src\main.js.'
}

Write-Host ""
Write-Host "Cookie Bridge Installer" -ForegroundColor Cyan
Write-Host "  Game path : $CC_APP" -ForegroundColor Gray
Write-Host "  Repo root : $ROOT" -ForegroundColor Gray
Write-Host ""

# ── Backup original start.js ──────────────────────────────────────────────────
$ORIG = Join-Path $CC_APP "start.js"
$BAK  = Join-Path $CC_APP "start.js.original"
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
foreach ($ControlFile in @('main.js', 'control-schema.js', 'control-runtime.js', 'control-queue.js', 'info.txt')) {
    Copy-Item -LiteralPath (Join-Path (Join-Path $ROOT 'mod_api') $ControlFile) -Destination (Join-Path $MOD_DEST $ControlFile) -Force
}
Write-Host "[OK] mod_api installed to $MOD_DEST" -ForegroundColor Green

Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Cyan
Write-Host "Start Cookie Clicker and open http://localhost:8000/docs" -ForegroundColor White
Write-Host ""
if (-not $NoPause) { Pause }
