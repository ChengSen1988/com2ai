<#
C2Achat 一键安装脚本（Windows PowerShell）

用法（复制下面任意一行到 PowerShell 回车即可）：
  海外网络：
    irm https://raw.githubusercontent.com/ChengSen1988/com2ai/main/install.ps1 | iex
  国内网络（jsDelivr CDN）：
    irm https://cdn.jsdelivr.net/gh/ChengSen1988/com2ai@main/install.ps1 | iex

可选环境变量（在运行前设置）：
  C2A_INSTALL_DIR  安装目录，默认 %USERPROFILE%\C2Achat
  C2A_SKIP_MODELS  设为 1 可跳过 Ollama 对话模型下载（约 6-8GB）
#>

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($env:OS -ne 'Windows_NT') {
    Write-Host '[X] 当前仅支持 Windows。' -ForegroundColor Red
    exit 1
}
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Host '[X] 需要 PowerShell 5.1 或更高版本（Windows 10/11 自带）。' -ForegroundColor Red
    exit 1
}

function Write-Step { param([string]$msg) Write-Host "`n==== $msg ====" -ForegroundColor Cyan }
function Write-OK   { Write-Host "  [OK] $($args -join ' ')" -ForegroundColor Green }
function Write-Warn { Write-Host "  [!] $($args -join ' ')" -ForegroundColor Yellow }
function Write-Fail { Write-Host "  [X] $($args -join ' ')" -ForegroundColor Red }

# ---------- 配置 ----------
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
Write-Host '   C2Achat 一键安装 / Com2AI One-Click Install'
Write-Host '============================================' -ForegroundColor Cyan
Write-Host "安装目录: $InstallDir"
if ($SkipModels) {
    Write-Host '模型下载: 跳过（C2A_SKIP_MODELS=1）'
} else {
    Write-Host '模型下载: 是（对话 + 嵌入模型，约 6-8GB）'
}

# ---------- 1. 下载 / 获取项目文件 ----------
if (Test-Path (Join-Path $InstallDir 'app.py')) {
    Write-Step "已检测到项目文件，跳过下载：$InstallDir"
} else {
    Write-Step '下载项目文件'
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    $zipPath = Join-Path $env:TEMP 'c2achat_main.zip'
    $extractDir = Join-Path $env:TEMP 'c2achat_extract'

    $downloaded = $false
    foreach ($url in $ZipCandidates) {
        try {
            Write-Host "  尝试下载: $url"
            Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
            if ((Get-Item $zipPath).Length -gt 100KB) { $downloaded = $true; break }
        } catch {
            Write-Warn '该源下载失败，尝试下一个源...'
        }
    }

    if (-not $downloaded) {
        Write-Fail "项目下载失败，请检查网络后重试，或手动下载 ZIP 解压到 $InstallDir"
        exit 1
    }
    Write-OK '项目压缩包下载完成'

    if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    $top = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
    if (-not $top) {
        Write-Fail '解压失败'
        exit 1
    }
    Copy-Item -Path (Join-Path $top.FullName '*') -Destination $InstallDir -Recurse -Force
    Write-OK "项目已安装到 $InstallDir"
}

# ---------- 2. Ollama 与对话模型 ----------
if (-not $SkipModels) {
    Write-Step '安装 Ollama 并下载对话/嵌入模型（约 6-8GB，请耐心等待）'
    Push-Location $InstallDir
    try {
        & .\ollamainstall.bat nopause
        if ($LASTEXITCODE -ne 0) {
            Write-Warn '模型安装未完全成功，之后可手动运行 ollamainstall.bat 补齐'
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Warn '已跳过模型下载；之后需要时运行安装目录下的 ollamainstall.bat 即可'
}

# ---------- 3. Python 环境与依赖，完成后自动启动 ----------
Write-Step '安装 Python 环境与依赖（首次约 5-20 分钟），完成后自动启动应用'
Push-Location $InstallDir
try {
    & .\01installv5.bat nopause
} finally {
    Pop-Location
}

Write-Host ''
Write-Host '安装流程结束，应用启动后可访问 http://127.0.0.1:12457' -ForegroundColor Green
