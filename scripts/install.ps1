$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
  Write-Error "demo-video-builder install: $Message"
  exit 1
}

function Add-ToolPath([string]$Directory) {
  if ((Test-Path $Directory) -and ($env:PATH -notlike "*$Directory*")) {
    $env:PATH = "$Directory;$env:PATH"
  }
}

function Install-PlaywrightZip([string]$Url, [string]$Destination) {
  $marker = Join-Path $Destination 'INSTALLATION_COMPLETE'
  if (Test-Path $marker) { return }
  $zipName = [IO.Path]::GetFileName(($Url -split '\?')[0])
  $zip = Join-Path ([IO.Path]::GetTempPath()) $zipName
  & curl.exe --fail --location --retry 3 --retry-all-errors --show-error --output $zip $Url
  if ($LASTEXITCODE -ne 0) { Fail "Unable to download $Url" }
  if (Test-Path $Destination) { Remove-Item $Destination -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & tar.exe -xf $zip -C $Destination
  if ($LASTEXITCODE -ne 0) { Fail "Unable to extract $zip" }
  New-Item -ItemType File -Force -Path $marker | Out-Null
  Remove-Item $zip -Force
}

function Install-PlaywrightBrowsersWithCurl([string]$Root) {
  $manifest = Get-Content (Join-Path $Root 'node_modules\playwright-core\browsers.json') -Raw | ConvertFrom-Json
  $chromium = $manifest.browsers | Where-Object { $_.name -eq 'chromium' }
  $ffmpeg = $manifest.browsers | Where-Object { $_.name -eq 'ffmpeg' }
  $cache = Join-Path $env:LOCALAPPDATA 'ms-playwright'
  $version = $chromium.browserVersion
  Install-PlaywrightZip `
    -Url "https://cdn.playwright.dev/builds/cft/$version/win64/chrome-win64.zip" `
    -Destination (Join-Path $cache "chromium-$($chromium.revision)")
  Install-PlaywrightZip `
    -Url "https://cdn.playwright.dev/builds/cft/$version/win64/chrome-headless-shell-win64.zip" `
    -Destination (Join-Path $cache "chromium_headless_shell-$($chromium.revision)")
  Install-PlaywrightZip `
    -Url "https://cdn.playwright.dev/builds/ffmpeg/$($ffmpeg.revision)/ffmpeg-win64.zip" `
    -Destination (Join-Path $cache "ffmpeg-$($ffmpeg.revision)")
}

if ($env:OS -ne 'Windows_NT') {
  Fail "Windows is required; this installer does not support this operating system."
}

$windowsRoot = if ($env:SystemRoot) { $env:SystemRoot } else { 'C:\Windows' }
Add-ToolPath (Join-Path $windowsRoot 'System32')
Add-ToolPath "$env:ProgramFiles\nodejs"
Add-ToolPath "$env:ProgramFiles\Git\cmd"

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  Fail "Node.js 20 or newer is required. Install Node.js, then rerun this script."
}

$nodeMajor = & node -p "Number(process.versions.node.split('.')[0])"
if ($LASTEXITCODE -ne 0) {
  Fail "Unable to determine the installed Node.js version."
}
if ([int]$nodeMajor -lt 20) {
  Fail "Node.js 20 or newer is required; found $(& node --version)."
}

$npm = Join-Path (Split-Path $nodeCommand.Source) 'npm.cmd'
if (-not (Test-Path $npm)) {
  Fail "npm is required. Install it with Node.js, then rerun this script."
}

$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
if (-not $curl) {
  Fail "curl.exe is required to install the verified Kokoro model."
}

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

& $npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail "npm ci failed." }

$playwright = Join-Path $Root 'node_modules\.bin\playwright.cmd'
Install-PlaywrightBrowsersWithCurl $Root
$browsers = Get-Content (Join-Path $Root 'node_modules\playwright-core\browsers.json') -Raw | ConvertFrom-Json
$chromiumRevision = ($browsers.browsers | Where-Object { $_.name -eq 'chromium' }).revision
$chrome = Join-Path $env:LOCALAPPDATA "ms-playwright\chromium-$chromiumRevision\chrome-win64\chrome.exe"
if (-not (Test-Path $chrome)) {
  $env:PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT = '20000'
  & $playwright install chromium
  if ($LASTEXITCODE -ne 0) { Fail "Playwright Chromium install failed." }
}

& node scripts/demo.mjs kokoro-setup
if ($LASTEXITCODE -ne 0) { Fail "Kokoro setup failed." }

& $npm run smoke
if ($LASTEXITCODE -ne 0) { Fail "smoke checks failed." }

& $npm test
if ($LASTEXITCODE -ne 0) { Fail "tests failed." }

& node scripts/demo.mjs help > $null
if ($LASTEXITCODE -ne 0) { Fail "demo help failed." }

Write-Output "Demo Video Builder (demo-video-builder) is ready at $Root"
