# Renders the 42 widget states at 96 and 144 dpi plus the tray sheet (85 PNGs) offscreen.
# Usage: powershell -File desk\snapshots.ps1 <outdir> [-NoBuild]
param([Parameter(Mandatory)][string]$OutDir, [switch]$NoBuild)
$ErrorActionPreference = 'Stop'
$desk = $PSScriptRoot
$proj = Join-Path $desk 'App\App.csproj'
if (-not $NoBuild) { dotnet build $proj -c Release -nologo -v q | Out-Null; if ($LASTEXITCODE) { throw 'build failed' } }
$exe = Join-Path $desk 'App\bin\Release\net9.0-windows\NightwatchDesk.exe'
$fx = Join-Path $desk 'App\snapshots\fixtures'
New-Item -ItemType Directory -Force $OutDir | Out-Null

# state -> fixture (the same table as App.Tests Fix.For; states with no glance ignore the fixture)
$fixture = @{
  'healthy' = 'healthy'; 'first-launch' = 'healthy'; 'pending' = 'pending'; 'one-lane' = 'one-lane'
  'overflow' = 'overflow'; 'long-copy' = 'long-copy'; 'vitals-null' = 'vitals-null'
  'weather-on' = 'healthy-weather'; 'weather-dim' = 'healthy-weather'; 'weather-long' = 'weather-long'; 'weather-null' = 'healthy'
  'camera-folded' = 'camera-3-items'
  'camera-loading' = 'camera'; 'camera-live' = 'camera'; 'camera-letterbox' = 'camera'; 'camera-stale' = 'camera'; 'camera-no-picture' = 'camera'
  'camera-watch-waking' = 'camera'; 'camera-watch-on' = 'camera'; 'camera-watch-stale' = 'camera'; 'camera-watch-no-picture' = 'camera'; 'camera-watch-letterbox' = 'camera'
  'camera-watch-focus' = 'camera'; 'camera-watch-folded' = 'camera-3-items'
  'offline-last-frame' = 'camera'; 'camera-collapsed' = 'camera'; 'camera-hidden' = 'camera'; 'camera-hover-frame' = 'camera'; 'camera-focus-header' = 'camera'
}
$states = 'healthy','first-launch','pending','one-lane','lanes-and-items','overflow','long-copy','vitals-null','stale',
  'offline-with-last-known','offline-never-answered','config-missing','config-invalid-json','token-missing',
  'wrong-token-401','desk-off-503','server-too-new','hover-row-1','focus-row-1','update-held',
  'weather-on','weather-long','weather-null','weather-dim','camera-loading','camera-live','camera-letterbox','camera-stale',
  'camera-no-picture','offline-last-frame','camera-collapsed','camera-folded','camera-hidden','camera-hover-frame','camera-focus-header',
  'camera-watch-waking','camera-watch-on','camera-watch-stale','camera-watch-no-picture','camera-watch-letterbox','camera-watch-folded','camera-watch-focus'

function Snap($fixtureFile, $state, $out, $dpi) {
  # Start-Process -Wait: a WinExe is not waited on by the call operator
  $p = Start-Process -FilePath $exe -ArgumentList @('--snapshot', "`"$fixtureFile`"", $state, "`"$out`"", $dpi) -Wait -PassThru -WindowStyle Hidden
  if ($p.ExitCode -ne 0 -or -not (Test-Path $out)) { throw "snapshot failed: $state at $dpi" }
}
foreach ($s in $states) {
  $f = if ($fixture.ContainsKey($s)) { $fixture[$s] } else { 'lanes-and-items' }
  foreach ($dpi in 96, 144) { Snap (Join-Path $fx "$f.json") $s (Join-Path $OutDir "$s-$dpi.png") $dpi }
}
$tray = Join-Path $OutDir 'tray-sheet.png'
Snap (Join-Path $fx 'healthy.json') 'tray-sheet' $tray 96
"{0} PNGs in {1}" -f (Get-ChildItem $OutDir -Filter *.png).Count, $OutDir
