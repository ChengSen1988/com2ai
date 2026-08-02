@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
set PYTHONIOENCODING=utf-8
title C2Achat Install & Start / C2Achat 一键安装并启动

set BASE_DIR=%~dp0
cd /d "%BASE_DIR%"

set EMBED_DIR=%BASE_DIR%python_env
set PYTHON_EXE=%EMBED_DIR%\python.exe
set PIP_EXE=%EMBED_DIR%\Scripts\pip.exe
set INSTALL_DONE=%BASE_DIR%.install_done
set EMBED_ZIP=%BASE_DIR%python_env.zip
set GETPIP=%BASE_DIR%get-pip.py
set REALESRGAN_ZIP=%BASE_DIR%Real-ESRGAN.zip
set PATCH_DIR=%BASE_DIR%patches

:: 通用 pip 参数：显示进度条 + 不提示 PATH 警告
set PIP_EXTRA_ARGS=--progress-bar on --no-warn-script-location

:: 网络模式 / 镜像相关变量（在 Step 1 中赋值）
set NET_MODE=GLOBAL
set PIP_MIRROR=
set GETPIP_URL=https://bootstrap.pypa.io/get-pip.py
set EMBED_ZIP_URL=https://www.python.org/ftp/python/3.12.6/python-3.12.6-embed-amd64.zip

:: ============================================================
:: 安装版本签名
:: ============================================================
set INSTALL_VER=C2Achat_v1.0.0#torch=2.9.1#torchvision=0.24.1#torchaudio=2.9.1#cuda=cu128#deps=opencv-python,flask,Pillow,transformers,diffusers,accelerate,peft,safetensors,timm,kornia,einops,sdnq,gguf,scipy,python-docx,numpy,chromadb,pymupdf,requests

echo.
echo [C2Achat] ==========================================
echo [C2Achat]   C2Achat  Installer / C2Achat 安装程序
echo [C2Achat]   First install takes 5 to 20 minutes / 首次安装大约需要 5 到 20 分钟
echo [C2Achat]   Please keep network connected / 请保持网络连接
echo [C2Achat] ==========================================
echo.

:: 如果已经安装过，检查版本签名是否一致
if exist "%INSTALL_DONE%" (
    set /p INSTALLED_VER=<"%INSTALL_DONE%"
    if "!INSTALLED_VER!"=="!INSTALL_VER!" (
        echo [OK] Already installed. Launching directly... / 已安装，正在直接启动...
        echo      To reinstall, delete .install_done and rerun. / 如需重装，请删除 .install_done 文件后重新运行
        goto :launch
    ) else (
        echo [INFO] Installation version changed or dependencies updated. Reinstalling... / [信息] 安装版本或依赖已更新，正在重新安装...
    )
)

:: ============================================================
:: Step 1: 网络环境检测（能否连通 Google）
:: ============================================================
echo [Step 1/6] Detecting network environment... / [步骤 1/6] 正在检测网络环境...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'https://www.google.com/generate_204' -TimeoutSec 5 -UseBasicParsing | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Cannot reach Google within 5s. Assuming Mainland China network. / [信息] 5 秒内无法访问 Google，判定为国内网络环境
    echo        Switching to domestic mirrors for pip / PyTorch / downloads. / 正在切换到国内镜像源（pip / PyTorch / 下载）
    set NET_MODE=CN
    set PIP_MIRROR=-i https://mirrors.aliyun.com/pypi/simple
    set GETPIP_URL=https://mirrors.aliyun.com/pypi/get-pip.py
    set EMBED_ZIP_URL=https://registry.npmmirror.com/-/binary/python/3.12.6/python-3.12.6-embed-amd64.zip
) else (
    echo [OK] Google is reachable. Using official sources ^(overseas network^). / [成功] 可访问 Google，使用官方源（海外网络）
)
echo.

:: ============================================================
:: Step 2: Prepare Python Embeddable
:: ============================================================
echo [Step 2/6] Preparing Python 3.12.6... / [步骤 2/6] 正在准备 Python 3.12.6...
if exist "%PYTHON_EXE%" (
    echo [OK] python_env already exists, skipping / [成功] python_env 已存在，跳过此步骤
    goto :step3
)
if exist "%EMBED_ZIP%" (
    echo Extracting built-in python_env.zip... / 正在解压内置的 python_env.zip...
    powershell -NoProfile -Command "Expand-Archive -Path '%EMBED_ZIP%' -DestinationPath '%EMBED_DIR%' -Force"
    if errorlevel 1 ( echo [ERROR] Extraction failed / [错误] 解压失败 & pause & exit /b 1 )
    echo [OK] Extraction complete / [成功] 解压完成
    goto :step3
)
echo Downloading Python 3.12.6 from !EMBED_ZIP_URL!... / 正在从 !EMBED_ZIP_URL! 下载 Python 3.12.6...
powershell -NoProfile -Command "Invoke-WebRequest -Uri '!EMBED_ZIP_URL!' -OutFile '%EMBED_ZIP%'"
if errorlevel 1 ( echo [ERROR] Download failed / [错误] 下载失败 & pause & exit /b 1 )
echo [OK] Download complete. Extracting... / [成功] 下载完成，正在解压...
powershell -NoProfile -Command "Expand-Archive -Path '%EMBED_ZIP%' -DestinationPath '%EMBED_DIR%' -Force"
if errorlevel 1 ( echo [ERROR] Extraction failed / [错误] 解压失败 & pause & exit /b 1 )
echo [OK] Python Embeddable ready / [成功] Python 环境准备完成

:step3
:: Step 3: Enable import site in pth file
echo.
echo [Step 3/6] Configuring Python Embeddable... / [步骤 3/6] 正在配置 Python 运行环境...
set PTH_FILE=%EMBED_DIR%\python312._pth
if exist "%PTH_FILE%" (
    powershell -NoProfile -Command "(Get-Content '%PTH_FILE%') -replace '#import site','import site' | Set-Content '%PTH_FILE%'"
    echo [OK] pth file configured / [成功] pth 文件配置完成
) else ( echo [WARN] pth file not found, skipping / [警告] 未找到 pth 文件，跳过此步骤 )

:: Step 4: Install pip
echo.
echo [Step 4/6] Installing pip... / [步骤 4/6] 正在安装 pip...
if not exist "%GETPIP%" (
    echo Downloading get-pip.py from !GETPIP_URL!... / 正在从 !GETPIP_URL! 下载 get-pip.py...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri '!GETPIP_URL!' -OutFile '%GETPIP%'"
    if errorlevel 1 ( echo [ERROR] Failed to download get-pip.py / [错误] 下载 get-pip.py 失败 & pause & exit /b 1 )
)
"%PYTHON_EXE%" "%GETPIP%" !PIP_EXTRA_ARGS!
if errorlevel 1 ( echo [ERROR] pip installation failed / [错误] pip 安装失败 & pause & exit /b 1 )
echo [OK] pip installed / [成功] pip 安装完成
"%PYTHON_EXE%" -m pip install --upgrade pip !PIP_MIRROR! !PIP_EXTRA_ARGS!

:: ============================================================
:: Step 5: Detect GPU / driver version and install PyTorch
:: [修复] 用临时文件承接 nvidia-smi 输出，避免错误文本被 CMD 当成命令执行
:: ============================================================
echo.
echo [Step 5/6] Detecting GPU and driver version... / [步骤 5/6] 正在检测显卡及驱动版本...
set GPU_MODE=CPU
set DRIVER_VER=
set GPU_NAME=
set GPU_CC=
set CUDA_TAG=cu128
set TORCH_PKGS=torch==2.9.1 torchvision==0.24.1 torchaudio==2.9.1

:: 创建临时目录承接输出
set "TMPDIR=%BASE_DIR%_gpuchk"
if not exist "%TMPDIR%" mkdir "%TMPDIR%"
set "DRV_FILE=%TMPDIR%\drv.txt"
set "NAME_FILE=%TMPDIR%\name.txt"
set "CC_FILE=%TMPDIR%\cc.txt"

nvidia-smi --query-gpu=driver_version --format=csv,noheader >"%DRV_FILE%" 2>nul
nvidia-smi --query-gpu=name --format=csv,noheader >"%NAME_FILE%" 2>nul
nvidia-smi --query-gpu=compute_cap --format=csv,noheader >"%CC_FILE%" 2>nul

:: 从文件读取（而非从命令输出读取，避免错误文本被执行）
set "DRIVER_VER="
for /f "usebackq tokens=* delims=" %%v in ("%DRV_FILE%") do (
    if not defined DRIVER_VER set "DRIVER_VER=%%v"
)
set "GPU_NAME="
for /f "usebackq tokens=* delims=" %%n in ("%NAME_FILE%") do (
    if not defined GPU_NAME set "GPU_NAME=%%n"
)
set "GPU_CC="
for /f "usebackq tokens=* delims=" %%c in ("%CC_FILE%") do (
    if not defined GPU_CC set "GPU_CC=%%c"
)

:: 清理临时文件
del /q "%DRV_FILE%" "%NAME_FILE%" "%CC_FILE%" >nul 2>&1
rmdir "%TMPDIR%" >nul 2>&1

:: 校验：剔除错误文本与空值
set "QUERY_OK=0"
if defined DRIVER_VER (
    echo !DRIVER_VER! | findstr /I /C:"ERROR" /C:"not a valid" /C:"recognized" /C:"help" >nul
    if !errorlevel! equ 1 (
        if defined GPU_NAME (
            echo !GPU_NAME! | findstr /I /C:"ERROR" /C:"not a valid" /C:"recognized" >nul
            if !errorlevel! equ 1 set "QUERY_OK=1"
        )
    )
)

if "!QUERY_OK!"=="0" (
    if defined DRIVER_VER (
        echo [WARN] nvidia-smi returned error or unsupported parameter. / [警告] nvidia-smi 返回错误或参数不受支持
        echo        This usually means the NVIDIA driver is very old. / 通常表示 NVIDIA 驱动版本过旧
    ) else (
        echo [WARN] No NVIDIA GPU detected or nvidia-smi not available. / [警告] 未检测到 NVIDIA 显卡或 nvidia-smi 不可用
    )
    echo        Installing CPU-only PyTorch. / 将安装纯 CPU 版 PyTorch
    set "DRIVER_VER="
    set "GPU_NAME="
    set "GPU_CC="
    goto :install_pytorch
)

echo [OK] NVIDIA GPU detected: !GPU_NAME! / [成功] 检测到 NVIDIA 显卡：!GPU_NAME!
echo      Driver version: !DRIVER_VER! / 驱动版本：!DRIVER_VER!

:: 解析驱动版本号
for /f "tokens=1,2 delims=." %%a in ("!DRIVER_VER!") do (
    set DRV_MAJOR=%%a
    set DRV_MINOR_RAW=%%b
)
:: 安全去除前导零（避免 08 被解析为八进制）
for /f "tokens=* delims=0" %%m in ("!DRV_MINOR_RAW!") do set DRV_MINOR=%%m
if "!DRV_MINOR!"=="" set DRV_MINOR=0

:: CUDA 12.8 需要驱动 >= 570.65
set DRIVER_OK=1
if !DRV_MAJOR! LSS 570 set DRIVER_OK=0
if !DRV_MAJOR! EQU 570 if !DRV_MINOR! LSS 65 set DRIVER_OK=0

if "!DRIVER_OK!"=="0" (
    echo.
    echo [WARN] Driver !DRIVER_VER! is below the cuDNN requirement for CUDA 12.8 / [警告] 驱动版本 !DRIVER_VER! 未达到 CUDA 12.8 所需的 cuDNN 要求
    echo [WARN] ^(Windows ^>= 570.65^). This applies to ALL GPU generations covered / [警告] Windows 需 570.65 及以上版本。此限制适用于 cu128 构建覆盖的
    echo [WARN] by the cu128 build ^(20/30/40/50 series^) - it's a driver/cuDNN gate, / [警告] 所有显卡世代（20/30/40/50 系列）——这是驱动与 cuDNN 层面的限制，
    echo [WARN] not a per-GPU architecture limit. CUDA is unavailable at this driver / [警告] 并非针对特定显卡架构。当前驱动版本下 CUDA 不可用，
    echo [WARN] version, so falling back to CPU-only PyTorch automatically. / [警告] 因此将自动回退到纯 CPU 版 PyTorch
    echo [WARN] To use the GPU, update your NVIDIA driver to 570.65+ and re-run: / [警告] 如需使用 GPU，请将 NVIDIA 驱动更新到 570.65 或以上版本后重新运行本安装程序：
    echo [WARN] https://www.nvidia.com/Download/index.aspx
    echo.
    goto :install_pytorch
)

echo [OK] Driver meets the CUDA 12.8 / cuDNN requirement ^(^>= 570.65^). / [成功] 驱动版本满足 CUDA 12.8 与 cuDNN 要求（570.65 或以上）

:: GPU 架构（Compute Capability）检查
if not "!GPU_CC!"=="" (
    for /f "tokens=1,2 delims=." %%a in ("!GPU_CC!") do (
        set CC_MAJOR=%%a
        set CC_MINOR=%%b
    )
    set CC_OK=1
    if !CC_MAJOR! LSS 7 set CC_OK=0
    if !CC_MAJOR! EQU 7 if !CC_MINOR! LSS 5 set CC_OK=0

    if "!CC_OK!"=="0" (
        echo.
        echo [WARN] GPU Compute Capability !GPU_CC! is below sm_75 / [警告] GPU 计算能力 !GPU_CC! 低于 sm_75
        echo [WARN] CUDA 12.8 requires sm_75 or higher ^(RTX 20 series or newer^). / [警告] CUDA 12.8 需要 sm_75 或更高（RTX 20 系列或更新）
        echo [WARN] Falling back to CPU-only PyTorch. / [警告] 将回退到纯 CPU 版 PyTorch
        echo.
        goto :install_pytorch
    ) else (
        echo [OK] GPU Compute Capability !GPU_CC! meets requirement ^(sm_75+^). / [成功] GPU 计算能力 !GPU_CC! 满足要求（sm_75+）
        ::echo cu128 covers sm_75/80/86/89/90/120 - i.e. 20/30/40/50 series, A100, A800. / cu128 覆盖 sm_75/80/86/89/90/120，即 20/30/40/50 系列、A100、A800
        set GPU_MODE=CUDA
    )
) else (
    echo [WARN] Could not query GPU Compute Capability, assuming compatible. / [警告] 无法查询 GPU 计算能力，假设兼容
    ::echo cu128 covers sm_75/80/86/89/90/120 - i.e. 20/30/40/50 series, A100, A800. / cu128 覆盖 sm_75/80/86/89/90/120，即 20/30/40/50 系列、A100、A800
    set GPU_MODE=CUDA
)

:install_pytorch
echo.

:: ============================================================
:: PyTorch 安装 
:: ============================================================
if "!GPU_MODE!"=="CUDA" (
    if "!NET_MODE!"=="CN" (
        set TORCH_MIRROR=https://mirrors.aliyun.com/pytorch-wheels/!CUDA_TAG!
        echo  - Installing PyTorch ^(!CUDA_TAG!^) from Aliyun mirror... / 正在从阿里云镜像安装 PyTorch（!CUDA_TAG!）...
        "%PIP_EXE%" install !TORCH_PKGS! -f !TORCH_MIRROR! !PIP_EXTRA_ARGS!
    ) else (
        set TORCH_INDEX_URL=https://download.pytorch.org/whl/!CUDA_TAG!
        echo  - Installing PyTorch ^(!CUDA_TAG!^): !TORCH_PKGS! / 正在安装 PyTorch（!CUDA_TAG!）：!TORCH_PKGS!
        "%PIP_EXE%" install !TORCH_PKGS! --index-url !TORCH_INDEX_URL! !PIP_EXTRA_ARGS!
    )
    if errorlevel 1 (
        echo [WARN] CUDA version failed to install. Falling back to CPU version... / [警告] CUDA 版本安装失败，正在回退到 CPU 版本...
        if "!NET_MODE!"=="CN" (
            set TORCH_MIRROR=https://mirrors.aliyun.com/pytorch-wheels/cpu
            "%PIP_EXE%" install torch torchvision torchaudio -f !TORCH_MIRROR! !PIP_EXTRA_ARGS!
        ) else (
            set TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
            "%PIP_EXE%" install torch torchvision torchaudio --index-url !TORCH_INDEX_URL! !PIP_EXTRA_ARGS!
        )
        set GPU_MODE=CPU
    ) else ( echo [OK] PyTorch !CUDA_TAG! version installed / [成功] PyTorch !CUDA_TAG! 版本安装完成 )
) else (
    if "!NET_MODE!"=="CN" (
        set TORCH_MIRROR=https://mirrors.aliyun.com/pytorch-wheels/cpu
        echo  - Installing PyTorch CPU version from Aliyun mirror... / 正在从阿里云镜像安装 CPU 版 PyTorch...
        "%PIP_EXE%" install torch torchvision torchaudio -f !TORCH_MIRROR! !PIP_EXTRA_ARGS!
    ) else (
        set TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
        echo  - Installing PyTorch CPU version... / 正在安装 CPU 版 PyTorch...
        "%PIP_EXE%" install torch torchvision torchaudio --index-url !TORCH_INDEX_URL! !PIP_EXTRA_ARGS!
    )
    echo [OK] PyTorch CPU version installed / [成功] CPU 版 PyTorch 安装完成
)

:: Step 6: Install dependencies
echo.
echo [Step 6/6] Installing project dependencies... / [步骤 6/6] 正在安装项目依赖...
echo    This may take a while. Do NOT close the window. / 这可能需要一段时间，请不要关闭窗口
echo.

echo Installing general dependencies (with opencv-python)... / 正在安装常规依赖（含 opencv-python ）...
if "!NET_MODE!"=="CN" (
    echo [INFO] pip source / 当前 pip 源: Tsinghua ^(https://pypi.tuna.tsinghua.edu.cn/simple^)
) else (
    echo [INFO] pip source / 当前 pip 源: PyPI official ^(https://pypi.org/simple^)
)
"%PIP_EXE%" install opencv-python flask Pillow transformers diffusers accelerate peft safetensors timm kornia einops sdnq gguf scipy python-docx numpy chromadb pymupdf requests !PIP_MIRROR! !PIP_EXTRA_ARGS!
if errorlevel 1 ( echo [WARNING] Some general dependencies failed, but continuing... / [警告] 部分依赖安装失败，但将继续执行 )

echo.

:: ============================================================
:: 安装后运行时自检
:: ============================================================
echo.
echo [Self-Check] Verifying PyTorch installation... / [自检] 正在验证 PyTorch 安装...
if "!GPU_MODE!"=="CUDA" (
    "%PYTHON_EXE%" -c "import torch; assert torch.cuda.is_available(), 'CUDA not available'; x = torch.randn(10).cuda(); print('[OK] CUDA self-check passed. device =', torch.cuda.get_device_name(0), '| sum =', x.sum().item())"
    if errorlevel 1 (
        echo.
        echo [ERROR] =====================================================
        echo [ERROR]  PyTorch CUDA self-check FAILED. / [错误] PyTorch CUDA 自检失败
        echo [ERROR]  Packages were installed, but torch cannot actually / [错误] 相关软件包已安装，但 torch 实际无法
        echo [ERROR]  use the GPU on this machine. Common causes: / [错误] 在本机使用 GPU，常见原因如下：
        echo [ERROR]   - NVIDIA driver too old for CUDA 12.8 ^(need ^>=570.65^) / [错误]   - NVIDIA 驱动版本过旧，CUDA 12.8 需要 570.65 或以上
        echo [ERROR]   - GPU architecture ^(sm_XX^) not supported by this build / [错误]   - 显卡架构（sm_XX）不受此版本支持
        echo [ERROR]  Please update your NVIDIA driver, then re-run this / [错误]  请更新 NVIDIA 驱动后重新运行本安装程序，
        echo [ERROR]  installer, or run C2Achat in CPU mode for now. / 或暂时以 CPU 模式运行 C2Achat
        echo [ERROR] =====================================================
        echo.
    ) else (
        echo [OK] PyTorch CUDA self-check passed. / [成功] PyTorch CUDA 自检通过
    )
) else (
    "%PYTHON_EXE%" -c "import torch; print('[OK] PyTorch import check passed. version =', torch.__version__)"
    if errorlevel 1 (
        echo [ERROR] PyTorch import failed. Please check the installation log above. / [错误] PyTorch 导入失败，请查看上方安装日志
    )
)

:: 写入安装完成标记（版本签名）
> "%INSTALL_DONE%" echo !INSTALL_VER!

:: ============================================================
:: Ollama 安装与对话/嵌入模型下载（设置 C2A_SKIP_MODELS=1 可跳过）
:: ============================================================
set "SKIP_MODELS=0"
if /I "%C2A_SKIP_MODELS%"=="1" set "SKIP_MODELS=1"
if "%SKIP_MODELS%"=="1" (
    echo [信息] 已跳过 Ollama 模型下载（C2A_SKIP_MODELS=1）
    goto :after_models
)
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
    goto :ollama_check_service
)

where ollama >nul 2>&1
if %errorlevel% equ 0 (
    set "OLLAMA_INSTALLED=1"
    echo [检测] 发现已安装的 Ollama（位于 PATH 中）
    goto :ollama_check_service
)

echo [检测] 本机未安装 Ollama，开始下载安装...
echo.
goto :ollama_install

:: ============================================================
:: 第二步：安装 Ollama
:: ============================================================
:ollama_install
echo [步骤 1/3] 正在下载 Ollama 安装包...
powershell -Command "Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile 'OllamaSetup.exe'"

if not exist "OllamaSetup.exe" (
    echo [错误] 下载 Ollama 安装包失败，请检查网络连接后重试。
    pause
    goto :after_models
)

echo [步骤 1/3] 正在安装 Ollama（静默安装）...
start /wait OllamaSetup.exe /S

if %errorlevel% neq 0 (
    echo [错误] Ollama 安装失败，错误代码：%errorlevel%
    pause
    goto :after_models
)

echo [步骤 1/3] Ollama 安装完成！
echo.

del OllamaSetup.exe 2>nul

set "OLLAMA_PATH=%LOCALAPPDATA%\Programs\Ollama"
set "PATH=%PATH%;%OLLAMA_PATH%"

:: ============================================================
:: 第三步：确保 Ollama 服务已启动
:: ============================================================
:ollama_check_service
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

call :ollama_ensure_model "%MODEL_NAME%" "对话模型（约 6-8 GB）"
if errorlevel 1 goto :after_models

call :ollama_ensure_model "%EMBED_MODEL%" "嵌入模型（向量记忆用，体积小）"
if errorlevel 1 goto :after_models

echo.
echo 所有模型均已就绪！
goto :ollama_finish

:ollama_ensure_model
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
    goto :after_models
)
echo [OK] %M_NAME% 下载完成。
exit /b 0

:: ============================================================
:: 完成
:: ============================================================
:ollama_finish
echo.
echo ==================================================
echo        全部完成！Ollama 已就绪，模型已可用！
echo ==================================================
echo.
echo 验证安装：运行 ollama list 查看已安装的模型
echo 运行模型：ollama run %MODEL_NAME%
echo.
goto :after_models
:after_models


echo.
echo [C2Achat] ==========================================
echo [C2Achat]   Install complete! Launching C2Achat... / 安装完成！正在启动 C2Achat...
echo [C2Achat] ==========================================

:: ============================================================
:: 启动程序
:: ============================================================
:launch

echo.
echo Launching C2Achat... Browser will open  / 正在启动C2Achat，浏览器将自动打开
echo.
"%PYTHON_EXE%" start.py
if /I not "%~1"=="nopause" pause