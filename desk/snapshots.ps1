# Renders the 20 widget states at 96 and 144 dpi plus the tray sheet (41 PNGs) offscreen.
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
}
$states = 'healthy','first-launch','pending','one-lane','lanes-and-items','overflow','long-copy','vitals-null','stale',
  'offline-with-last-known','offline-never-answered','config-missing','config-invalid-json','token-missing',
  'wrong-token-401','desk-off-503','server-too-new','hover-row-1','focus-row-1','update-held'

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
