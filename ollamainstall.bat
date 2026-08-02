@echo off
chcp 65001 >nul
title Ollama 自动安装与模型下载

echo ==================================================
echo       Ollama 自动安装与模型下载脚本
echo ==================================================
echo.

:: 检查管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [警告] 建议以管理员身份运行此脚本，以确保安装顺利。
    echo.
)

:: ============================================================
:: 第一步：检测本机是否已安装 Ollama
:: ============================================================
set "OLLAMA_INSTALLED=0"
set "OLLAMA_PATH=%LOCALAPPDATA%\Programs\Ollama"

if exist "%OLLAMA_PATH%\ollama.exe" (
    set "OLLAMA_INSTALLED=1"
    set "PATH=%PATH%;%OLLAMA_PATH%"
    echo [检测] 发现已安装的 Ollama（路径：%OLLAMA_PATH%）
    goto :check_service
)

where ollama >nul 2>&1
if %errorlevel% equ 0 (
    set "OLLAMA_INSTALLED=1"
    echo [检测] 发现已安装的 Ollama（位于 PATH 中）
    goto :check_service
)

echo [检测] 本机未安装 Ollama，开始下载安装...
echo.
goto :install_ollama

:: ============================================================
:: 第二步：安装 Ollama
:: ============================================================
:install_ollama
echo [步骤 1/3] 正在下载 Ollama 安装包...
powershell -Command "Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile 'OllamaSetup.exe'"

if not exist "OllamaSetup.exe" (
    echo [错误] 下载 Ollama 安装包失败，请检查网络连接后重试。
    pause
    exit /b 1
)

echo [步骤 1/3] 正在安装 Ollama（静默安装）...
start /wait OllamaSetup.exe /S

if %errorlevel% neq 0 (
    echo [错误] Ollama 安装失败，错误代码：%errorlevel%
    pause
    exit /b 1
)

echo [步骤 1/3] Ollama 安装完成！
echo.

del OllamaSetup.exe 2>nul

set "OLLAMA_PATH=%LOCALAPPDATA%\Programs\Ollama"
set "PATH=%PATH%;%OLLAMA_PATH%"

:: ============================================================
:: 第三步：确保 Ollama 服务已启动
:: ============================================================
:check_service
echo [步骤 2/3] 正在配置 Ollama 服务...

if not defined OLLAMA_PATH (
    set "OLLAMA_PATH=%LOCALAPPDATA%\Programs\Ollama"
    set "PATH=%PATH%;%OLLAMA_PATH%"
)

echo 正在检测 Ollama 服务状态...
ollama list >nul 2>&1
if %errorlevel% neq 0 (
    echo Ollama 服务未运行，正在后台启动...
    start /b ollama serve
    echo 等待服务初始化（约 5 秒）...
    timeout /t 5 /nobreak >nul
    ollama list >nul 2>&1
    if %errorlevel% neq 0 (
        echo [警告] 服务启动后仍未响应，请手动检查 ollama 是否正常运行。
        echo 您可以稍后打开新终端手动执行：ollama serve
    ) else (
        echo Ollama 服务已就绪。
    )
) else (
    echo Ollama 服务已在运行。
)
echo.

:: ============================================================
:: 第四步：检查并下载所需模型
:: ============================================================
set "MODEL_NAME=aratan/Qwythos-9B-v2-1M-Uncensored-GGUF:Q4_K_M"
set "EMBED_MODEL=nomic-embed-text"

echo [步骤 3/3] 检查所需模型是否已下载...

call :ensure_model "%MODEL_NAME%" "对话模型（约 6-8 GB）"
if errorlevel 1 exit /b 1

call :ensure_model "%EMBED_MODEL%" "嵌入模型（向量记忆用，体积小）"
if errorlevel 1 exit /b 1

echo.
echo 所有模型均已就绪！
goto :finish

:ensure_model
setlocal
set "M_NAME=%~1"
set "M_DESC=%~2"
echo.
echo --- 检查 %M_DESC%：%M_NAME% ---
call ollama show "%M_NAME%" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] %M_NAME% 已存在，跳过下载。
    exit /b 0
)
echo [信息] %M_NAME% 未找到，开始下载...
echo 注意：%M_DESC% 下载时间取决于网络速度，请耐心等待...
echo.
call ollama pull "%M_NAME%"
if %errorlevel% neq 0 (
    echo.
    echo [错误] 模型 %M_NAME% 下载失败，错误代码：%errorlevel%
    echo 可能原因：
    echo   1. 网络连接问题
    echo   2. Ollama 服务未正常运行
    echo   3. 模型名称不正确或该模型在远程仓库中不存在
    echo.
    echo 建议：
    echo   - 访问 https://ollama.com/aratan/Qwythos-9B-v2-1M-Uncensored-GGUF 确认模型是否存在
    echo   - 也可以尝试使用其他模型，如 llama3.2 或 qwen2.5
    echo.
    exit /b 1
)
echo [OK] %M_NAME% 下载完成。
exit /b 0

:: ============================================================
:: 完成
:: ============================================================
:finish
echo.
echo ==================================================
echo        全部完成！Ollama 已就绪，模型已可用！
echo ==================================================
echo.
echo 验证安装：运行 ollama list 查看已安装的模型
echo 运行模型：ollama run %MODEL_NAME%
echo.
pause
