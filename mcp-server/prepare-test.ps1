param(
    [string]$GameDirectory = 'D:\SteamLibrary\steamapps\common\Cookie Clicker',
    [string]$Name = 'integration',
    [int]$Port = 8001,
    [int]$DebugPort = 9223,
    [switch]$Launch
)
$ErrorActionPreference = 'Stop'
if ($Name -notmatch '^[a-zA-Z0-9-]+$') { throw 'Name must contain letters, digits and hyphens only.' }
$repo = Split-Path $PSScriptRoot
$output = Join-Path $PSScriptRoot 'output'
$testRoot = Join-Path $output $Name
$runtime = Join-Path $testRoot 'runtime'
$testApp = Join-Path $runtime 'resources\app'
$gameApp = Join-Path $GameDirectory 'resources\app'
if (-not (Test-Path -LiteralPath (Join-Path $gameApp 'src\main.js'))) { throw 'Cookie Clicker source not found.' }
$active = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq (Join-Path $runtime 'Cookie Clicker.exe') }
if ($active) { throw 'Stop this test runtime before updating its files.' }
New-Item -ItemType Directory -Path $testApp -Force | Out-Null
foreach ($entry in Get-ChildItem -LiteralPath $GameDirectory -File) {
    if ($entry.Name -ne 'steam_appid.txt' -and -not (Test-Path -LiteralPath (Join-Path $runtime $entry.Name))) { Copy-Item -LiteralPath $entry.FullName -Destination $runtime }
}
foreach ($directory in @('locales','swiftshader')) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtime $directory))) { Copy-Item -LiteralPath (Join-Path $GameDirectory $directory) -Destination $runtime -Recurse }
}
foreach ($directory in @('src','steam','node_modules')) {
    if (-not (Test-Path -LiteralPath (Join-Path $testApp $directory))) { Copy-Item -LiteralPath (Join-Path $gameApp $directory) -Destination $testApp -Recurse }
}
foreach ($file in @('package.json','preload.js','splash.html')) { Copy-Item -LiteralPath (Join-Path $gameApp $file) -Destination $testApp -Force }
& (Join-Path $repo 'install.ps1') -GameAppPath $testApp -NoPause
if ($Launch) {
    $env:COOKIE_BRIDGE_TEST_MODE = '1'
    $env:COOKIE_BRIDGE_TEST_ROOT = $testRoot
    $env:COOKIE_BRIDGE_PORT = "$Port"
    $process = Start-Process -FilePath (Join-Path $runtime 'Cookie Clicker.exe') -ArgumentList @("--remote-debugging-port=$DebugPort",'--remote-debugging-address=127.0.0.1','--disable-gpu','--disable-background-timer-throttling') -WorkingDirectory $runtime -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'stdout.log') -RedirectStandardError (Join-Path $testRoot 'stderr.log')
    Write-Output "Test PID: $($process.Id)"
}
Write-Output "Isolated test root: $testRoot"
Write-Output "Bridge: http://127.0.0.1:$Port ; CDP: http://127.0.0.1:$DebugPort"
