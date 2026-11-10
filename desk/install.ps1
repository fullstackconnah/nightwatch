# Installs Nightwatch Desk for the current user. No admin needed.
# Usage: powershell -File desk\install.ps1 [-Start]
param([switch]$Start)
$ErrorActionPreference = 'Stop'
$dest = Join-Path $env:LOCALAPPDATA 'NightwatchDesk'
$data = Join-Path $env:APPDATA 'NightwatchDesk'
$proj = Join-Path $PSScriptRoot 'App\App.csproj'

# 1. Publish a single file next to nothing else (framework-dependent: needs the .NET 9 Desktop Runtime).
dotnet publish $proj -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o $dest
if ($LASTEXITCODE) { throw 'dotnet publish failed' }
$exe = Join-Path $dest 'NightwatchDesk.exe'

# 2. Start with Windows: a shortcut in the user's Startup folder.
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Nightwatch Desk.lnk'
$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sc.TargetPath = $exe
$sc.WorkingDirectory = $dest
$sc.Save()

# 3. desk.json: asked for once, never overwritten, token never echoed or logged.
$cfg = Join-Path $data 'desk.json'
if (-not (Test-Path $cfg)) {
  $url = Read-Host 'nightwatch address (for example http://homelab.local:3005)'
  $secure = Read-Host 'desk token' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  New-Item -ItemType Directory -Force $data | Out-Null
  @{ baseUrl = $url.TrimEnd('/'); token = $token } | ConvertTo-Json | Set-Content -Path $cfg -Encoding UTF8
  $token = $null
  Write-Host "Wrote $cfg"
} else {
  Write-Host "Kept existing $cfg"
}

Write-Host "Installed to $dest. Check it with: `"$exe`" --check"
if ($Start) { Start-Process -FilePath $exe }
