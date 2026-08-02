<#
C2Achat one-click installer (Windows PowerShell)

Usage (copy one line into PowerShell and press Enter):
  Global network:
    irm https://raw.githubusercontent.com/ChengSen1988/com2ai/main/install.ps1 | iex
  China network (jsDelivr CDN, no proxy needed):
    irm https://cdn.jsdelivr.net/gh/ChengSen1988/com2ai@main/install.ps1 | iex

Optional environment variables (set before running):
  C2A_INSTALL_DIR  Installation directory (default: %USERPROFILE%\C2Achat)
  C2A_SKIP_MODELS  Set to 1 to skip the Ollama chat model download (~6-8 GB)
#>

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($env:OS -ne 'Windows_NT') {
    Write-Host '[X] Windows only.' -ForegroundColor Red
    return
}
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Host '[X] PowerShell 5.1 or later is required (built into Windows 10/11).' -ForegroundColor Red
    return
}

function Write-Step { param([string]$msg) Write-Host "`n==== $msg ====" -ForegroundColor Cyan }
function Write-OK   { Write-Host "  [OK] $($args -join ' ')" -ForegroundColor Green }
function Write-Warn { Write-Host "  [!] $($args -join ' ')" -ForegroundColor Yellow }
function Write-Fail { Write-Host "  [X] $($args -join ' ')" -ForegroundColor Red }

# ---------- Configuration ----------
$InstallDir = $env:C2A_INSTALL_DIR
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $InstallDir = Join-Path $env:USERPROFILE 'C2Achat'
}
$SkipModels = $env:C2A_SKIP_MODELS -eq '1'

$RepoUrl = 'https://github.com/ChengSen1988/com2ai'
$ZipCandidates = @(
    "$RepoUrl/archive/refs/heads/main.zip",
    "https://ghfast.top/$RepoUrl/archive/refs/heads/main.zip",
    "https://gh-proxy.com/$RepoUrl/archive/refs/heads/main.zip"
)

Write-Host '============================================' -ForegroundColor Cyan
Write-Host '   C2Achat One-Click Installer'
Write-Host '============================================' -ForegroundColor Cyan
Write-Host "Install directory: $InstallDir"
if ($SkipModels) {
    Write-Host 'Model download: skipped (C2A_SKIP_MODELS=1)'
} else {
    Write-Host 'Model download: yes (chat + embedding models, about 6-8 GB)'
}

# ---------- 1. Download / refresh project files ----------
Write-Step 'Downloading project files'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$zipPath = Join-Path $env:TEMP 'c2achat_main.zip'
$extractDir = Join-Path $env:TEMP 'c2achat_extract'

$downloaded = $false
foreach ($url in $ZipCandidates) {
    try {
        Write-Host "  Trying: $url"
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
        if ((Get-Item $zipPath).Length -gt 100KB) { $downloaded = $true; break }
    } catch {
        Write-Warn 'Download failed, trying the next source...'
    }
}

if (-not $downloaded) {
    Write-Fail "Failed to download the project. Check your network and retry, or download the ZIP manually and extract it to $InstallDir"
    return
}
Write-OK 'Project archive downloaded'

if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
$top = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
if (-not $top) {
    Write-Fail 'Extraction failed'
    return
}
Copy-Item -Path (Join-Path $top.FullName '*') -Destination $InstallDir -Recurse -Force
Write-OK "Project files are ready in $InstallDir (existing installation was refreshed)"

# ---------- 2. One-click install and start ----------
# installandstart.bat installs the Python environment, dependencies,
# Ollama and the models, then starts the app automatically.
$env:C2A_SKIP_MODELS = if ($SkipModels) { '1' } else { '0' }
Write-Step 'Installing Python environment, dependencies, Ollama and models (first run about 5-30 min), then the app will start automatically'
Push-Location $InstallDir
try {
    & .\installandstart.bat nopause
    if ($LASTEXITCODE -ne 0) {
        Write-Warn 'Installation did not fully succeed. You can rerun installandstart.bat to retry.'
    }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Done. After the app starts, open http://127.0.0.1:12457' -ForegroundColor Green
