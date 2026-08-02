@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
set PYTHONIOENCODING=utf-8
title C2Achat Install and Start

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

:: Generic pip options: show progress bar + suppress PATH warning
set PIP_EXTRA_ARGS=--progress-bar on --no-warn-script-location

:: Network mode / mirror variables (assigned in Step 1)
set NET_MODE=GLOBAL
set PIP_MIRROR=
set GETPIP_URL=https://bootstrap.pypa.io/get-pip.py
set EMBED_ZIP_URL=https://www.python.org/ftp/python/3.12.6/python-3.12.6-embed-amd64.zip

:: ============================================================
:: Installation version signature
:: ============================================================
set INSTALL_VER=C2Achat_v1.0.0#torch=2.9.1#torchvision=0.24.1#torchaudio=2.9.1#cuda=cu128#deps=opencv-python,flask,Pillow,transformers,diffusers,accelerate,peft,safetensors,timm,kornia,einops,sdnq,gguf,scipy,python-docx,numpy,chromadb,pymupdf,requests

echo.
echo [C2Achat] ==========================================
echo [C2Achat]   C2Achat Installer
echo [C2Achat]   First install takes 5 to 20 minutes
echo [C2Achat]   Please keep network connected
echo [C2Achat] ==========================================
echo.

:: Skip reinstall if the same version was already installed
if exist "%INSTALL_DONE%" (
    set /p INSTALLED_VER=<"%INSTALL_DONE%"
    if "!INSTALLED_VER!"=="!INSTALL_VER!" (
        echo [OK] Already installed. Launching directly...
        echo      To reinstall, delete .install_done and rerun.
        goto :launch
    ) else (
        echo [INFO] Installation version changed or dependencies updated. Reinstalling...
    )
)

:: ============================================================
:: Step 1: Detect network environment (can we reach Google)
:: ============================================================
echo [Step 1/6] Detecting network environment...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'https://www.google.com/generate_204' -TimeoutSec 5 -UseBasicParsing | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Cannot reach Google within 5s. Assuming Mainland China network.
    echo        Switching to domestic mirrors for pip / PyTorch / downloads.
    set NET_MODE=CN
    set PIP_MIRROR=-i https://mirrors.aliyun.com/pypi/simple
    set GETPIP_URL=https://mirrors.aliyun.com/pypi/get-pip.py
    set EMBED_ZIP_URL=https://registry.npmmirror.com/-/binary/python/3.12.6/python-3.12.6-embed-amd64.zip
) else (
    echo [OK] Google is reachable. Using official sources ^(overseas network^).
)
echo.

:: ============================================================
:: Step 2: Prepare Python Embeddable
:: ============================================================
echo [Step 2/6] Preparing Python 3.12.6...
if exist "%PYTHON_EXE%" (
    echo [OK] python_env already exists, skipping
    goto :step3
)
if exist "%EMBED_ZIP%" (
    echo Extracting built-in python_env.zip...
    powershell -NoProfile -Command "Expand-Archive -Path '%EMBED_ZIP%' -DestinationPath '%EMBED_DIR%' -Force"
    if errorlevel 1 ( echo [ERROR] Extraction failed & pause & exit /b 1 )
    echo [OK] Extraction complete
    goto :step3
)
echo Downloading Python 3.12.6 from !EMBED_ZIP_URL!...
powershell -NoProfile -Command "Invoke-WebRequest -Uri '!EMBED_ZIP_URL!' -OutFile '%EMBED_ZIP%'"
if errorlevel 1 ( echo [ERROR] Download failed & pause & exit /b 1 )
echo [OK] Download complete. Extracting...
powershell -NoProfile -Command "Expand-Archive -Path '%EMBED_ZIP%' -DestinationPath '%EMBED_DIR%' -Force"
if errorlevel 1 ( echo [ERROR] Extraction failed & pause & exit /b 1 )
echo [OK] Python Embeddable ready

:step3
:: Step 3: Enable import site in pth file
echo.
echo [Step 3/6] Configuring Python Embeddable...
set PTH_FILE=%EMBED_DIR%\python312._pth
if exist "%PTH_FILE%" (
    powershell -NoProfile -Command "(Get-Content '%PTH_FILE%') -replace '#import site','import site' | Set-Content '%PTH_FILE%'"
    echo [OK] pth file configured
) else ( echo [WARN] pth file not found, skipping )

:: Step 4: Install pip
echo.
echo [Step 4/6] Installing pip...
if not exist "%GETPIP%" (
    echo Downloading get-pip.py from !GETPIP_URL!...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri '!GETPIP_URL!' -OutFile '%GETPIP%'"
    if errorlevel 1 ( echo [ERROR] Failed to download get-pip.py & pause & exit /b 1 )
)
"%PYTHON_EXE%" "%GETPIP%" !PIP_EXTRA_ARGS!
if errorlevel 1 ( echo [ERROR] pip installation failed & pause & exit /b 1 )
echo [OK] pip installed
"%PYTHON_EXE%" -m pip install --upgrade pip !PIP_MIRROR! !PIP_EXTRA_ARGS!

:: ============================================================
:: Step 5: Detect GPU / driver version and install PyTorch
:: [Fix] Use temp files for nvidia-smi output to avoid
:: error text being executed by CMD
:: ============================================================
echo.
echo [Step 5/6] Detecting GPU and driver version...
set GPU_MODE=CPU
set DRIVER_VER=
set GPU_NAME=
set GPU_CC=
set CUDA_TAG=cu128
set TORCH_PKGS=torch==2.9.1 torchvision==0.24.1 torchaudio==2.9.1

:: Create a temp directory to hold command output
set "TMPDIR=%BASE_DIR%_gpuchk"
if not exist "%TMPDIR%" mkdir "%TMPDIR%"
set "DRV_FILE=%TMPDIR%\drv.txt"
set "NAME_FILE=%TMPDIR%\name.txt"
set "CC_FILE=%TMPDIR%\cc.txt"

nvidia-smi --query-gpu=driver_version --format=csv,noheader >"%DRV_FILE%" 2>nul
nvidia-smi --query-gpu=name --format=csv,noheader >"%NAME_FILE%" 2>nul
nvidia-smi --query-gpu=compute_cap --format=csv,noheader >"%CC_FILE%" 2>nul

:: Read from files (not from command output, to avoid executing error text)
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

:: Clean up temp files
del /q "%DRV_FILE%" "%NAME_FILE%" "%CC_FILE%" >nul 2>&1
rmdir "%TMPDIR%" >nul 2>&1

:: Validate: reject error text and empty values
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
        echo [WARN] nvidia-smi returned error or unsupported parameter.
        echo        This usually means the NVIDIA driver is very old.
    ) else (
        echo [WARN] No NVIDIA GPU detected or nvidia-smi not available.
    )
    echo        Installing CPU-only PyTorch.
    set "DRIVER_VER="
    set "GPU_NAME="
    set "GPU_CC="
    goto :install_pytorch
)

echo [OK] NVIDIA GPU detected: !GPU_NAME!
echo      Driver version: !DRIVER_VER!

:: Parse driver version
for /f "tokens=1,2 delims=." %%a in ("!DRIVER_VER!") do (
    set DRV_MAJOR=%%a
    set DRV_MINOR_RAW=%%b
)
:: Strip leading zeros safely (avoid 08 being parsed as octal)
for /f "tokens=* delims=0" %%m in ("!DRV_MINOR_RAW!") do set DRV_MINOR=%%m
if "!DRV_MINOR!"=="" set DRV_MINOR=0

:: CUDA 12.8 requires driver >= 570.65
set DRIVER_OK=1
if !DRV_MAJOR! LSS 570 set DRIVER_OK=0
if !DRV_MAJOR! EQU 570 if !DRV_MINOR! LSS 65 set DRIVER_OK=0

if "!DRIVER_OK!"=="0" (
    echo.
    echo [WARN] Driver !DRIVER_VER! is below the cuDNN requirement for CUDA 12.8
    echo [WARN] ^(Windows ^>= 570.65^). This applies to ALL GPU generations covered
    echo [WARN] by the cu128 build ^(20/30/40/50 series^) - it is a driver/cuDNN gate,
    echo [WARN] not a per-GPU architecture limit. CUDA is unavailable at this driver
    echo [WARN] version, so falling back to CPU-only PyTorch automatically.
    echo [WARN] To use the GPU, update your NVIDIA driver to 570.65+ and re-run:
    echo [WARN] https://www.nvidia.com/Download/index.aspx
    echo.
    goto :install_pytorch
)

echo [OK] Driver meets the CUDA 12.8 / cuDNN requirement ^(^>= 570.65^).

:: GPU architecture (Compute Capability) check
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
        echo [WARN] GPU Compute Capability !GPU_CC! is below sm_75
        echo [WARN] CUDA 12.8 requires sm_75 or higher ^(RTX 20 series or newer^).
        echo [WARN] Falling back to CPU-only PyTorch.
        echo.
        goto :install_pytorch
    ) else (
        echo [OK] GPU Compute Capability !GPU_CC! meets requirement ^(sm_75+^).
        set GPU_MODE=CUDA
    )
) else (
    echo [WARN] Could not query GPU Compute Capability, assuming compatible.
    set GPU_MODE=CUDA
)

:install_pytorch
echo.

:: ============================================================
:: PyTorch installation
:: ============================================================
if "!GPU_MODE!"=="CUDA" (
    if "!NET_MODE!"=="CN" (
        set TORCH_MIRROR=https://mirrors.aliyun.com/pytorch-wheels/!CUDA_TAG!
        echo  - Installing PyTorch ^(!CUDA_TAG!^) from Aliyun mirror...
        "%PIP_EXE%" install !TORCH_PKGS! -f !TORCH_MIRROR! !PIP_EXTRA_ARGS!
    ) else (
        set TORCH_INDEX_URL=https://download.pytorch.org/whl/!CUDA_TAG!
        echo  - Installing PyTorch ^(!CUDA_TAG!^): !TORCH_PKGS!
        "%PIP_EXE%" install !TORCH_PKGS! --index-url !TORCH_INDEX_URL! !PIP_EXTRA_ARGS!
    )
    if errorlevel 1 (
        echo [WARN] CUDA version failed to install. Falling back to CPU version...
        if "!NET_MODE!"=="CN" (
            set TORCH_MIRROR=https://mirrors.aliyun.com/pytorch-wheels/cpu
            "%PIP_EXE%" install torch torchvision torchaudio -f !TORCH_MIRROR! !PIP_EXTRA_ARGS!
        ) else (
            set TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
            "%PIP_EXE%" install torch torchvision torchaudio --index-url !TORCH_INDEX_URL! !PIP_EXTRA_ARGS!
        )
        set GPU_MODE=CPU
    ) else ( echo [OK] PyTorch !CUDA_TAG! version installed )
) else (
    if "!NET_MODE!"=="CN" (
        set TORCH_MIRROR=https://mirrors.aliyun.com/pytorch-wheels/cpu
        echo  - Installing PyTorch CPU version from Aliyun mirror...
        "%PIP_EXE%" install torch torchvision torchaudio -f !TORCH_MIRROR! !PIP_EXTRA_ARGS!
    ) else (
        set TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
        echo  - Installing PyTorch CPU version...
        "%PIP_EXE%" install torch torchvision torchaudio --index-url !TORCH_INDEX_URL! !PIP_EXTRA_ARGS!
    )
    echo [OK] PyTorch CPU version installed
)

:: Step 6: Install dependencies
echo.
echo [Step 6/6] Installing project dependencies...
echo    This may take a while. Do NOT close the window.
echo.

echo Installing general dependencies (with opencv-python)...
if "!NET_MODE!"=="CN" (
    echo [INFO] pip source: Tsinghua ^(https://pypi.tuna.tsinghua.edu.cn/simple^)
) else (
    echo [INFO] pip source: PyPI official ^(https://pypi.org/simple^)
)
"%PIP_EXE%" install opencv-python flask Pillow transformers diffusers accelerate peft safetensors timm kornia einops sdnq gguf scipy python-docx numpy chromadb pymupdf requests !PIP_MIRROR! !PIP_EXTRA_ARGS!
if errorlevel 1 ( echo [WARNING] Some general dependencies failed, but continuing... )

echo.

:: ============================================================
:: Post-install runtime self-check
:: ============================================================
echo.
echo [Self-Check] Verifying PyTorch installation...
if "!GPU_MODE!"=="CUDA" (
    "%PYTHON_EXE%" -c "import torch; assert torch.cuda.is_available(), 'CUDA not available'; x = torch.randn(10).cuda(); print('[OK] CUDA self-check passed. device =', torch.cuda.get_device_name(0), '| sum =', x.sum().item())"
    if errorlevel 1 (
        echo.
        echo [ERROR] =====================================================
        echo [ERROR]  PyTorch CUDA self-check FAILED.
        echo [ERROR]  Packages were installed, but torch cannot actually
        echo [ERROR]  use the GPU on this machine. Common causes:
        echo [ERROR]   - NVIDIA driver too old for CUDA 12.8 ^(need ^>=570.65^)
        echo [ERROR]   - GPU architecture ^(sm_XX^) not supported by this build
        echo [ERROR]  Please update your NVIDIA driver, then re-run this
        echo [ERROR]  installer, or run C2Achat in CPU mode for now.
        echo [ERROR] =====================================================
        echo.
    ) else (
        echo [OK] PyTorch CUDA self-check passed.
    )
) else (
    "%PYTHON_EXE%" -c "import torch; print('[OK] PyTorch import check passed. version =', torch.__version__)"
    if errorlevel 1 (
        echo [ERROR] PyTorch import failed. Please check the installation log above.
    )
)

:: Write installation done marker (version signature)
> "%INSTALL_DONE%" echo !INSTALL_VER!

:: ============================================================
:: Ollama install + chat/embedding model download
:: (set C2A_SKIP_MODELS=1 to skip)
:: ============================================================
set "SKIP_MODELS=0"
if /I "%C2A_SKIP_MODELS%"=="1" set "SKIP_MODELS=1"
if "%SKIP_MODELS%"=="1" (
    echo [INFO] Skipping Ollama model download (C2A_SKIP_MODELS=1)
    goto :after_models
)
:: Check admin rights
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] Recommended to run as administrator for a smooth installation.
    echo.
)

:: ============================================================
:: Step A: Detect whether Ollama is already installed
:: ============================================================
set "OLLAMA_INSTALLED=0"
set "OLLAMA_PATH=%LOCALAPPDATA%\Programs\Ollama"

if exist "%OLLAMA_PATH%\ollama.exe" (
    set "OLLAMA_INSTALLED=1"
    set "PATH=%PATH%;%OLLAMA_PATH%"
    echo [INFO] Ollama found (path: %OLLAMA_PATH%)
    goto :ollama_check_service
)

where ollama >nul 2>&1
if %errorlevel% equ 0 (
    set "OLLAMA_INSTALLED=1"
    echo [INFO] Ollama found (in PATH)
    goto :ollama_check_service
)

echo [INFO] Ollama not found, downloading and installing...
echo.
goto :ollama_install

:: ============================================================
:: Step B: Install Ollama
:: ============================================================
:ollama_install
echo [Step 1/3] Downloading Ollama installer...
powershell -Command "Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile 'OllamaSetup.exe'"

if not exist "OllamaSetup.exe" (
    echo [ERROR] Failed to download Ollama installer. Check your network and retry.
    goto :after_models
)

echo [Step 1/3] Installing Ollama silently...
start /wait OllamaSetup.exe /S

if %errorlevel% neq 0 (
    echo [ERROR] Ollama installation failed, error code: %errorlevel%
    goto :after_models
)

echo [Step 1/3] Ollama installed successfully!
echo.

del OllamaSetup.exe 2>nul

set "OLLAMA_PATH=%LOCALAPPDATA%\Programs\Ollama"
set "PATH=%PATH%;%OLLAMA_PATH%"

:: ============================================================
:: Step C: Make sure the Ollama service is running
:: ============================================================
:ollama_check_service
echo [Step 2/3] Configuring the Ollama service...

if not defined OLLAMA_PATH (
    set "OLLAMA_PATH=%LOCALAPPDATA%\Programs\Ollama"
    set "PATH=%PATH%;%OLLAMA_PATH%"
)

echo Checking Ollama service status...
ollama list >nul 2>&1
if %errorlevel% neq 0 (
    echo Ollama service is not running, starting it in the background...
    start /b ollama serve
    echo Waiting for the service to initialize ^(about 5 seconds^)...
    timeout /t 5 /nobreak >nul
    ollama list >nul 2>&1
    if %errorlevel% neq 0 (
        echo [WARN] Service still not responding. Please check that ollama runs correctly.
        echo        You can run "ollama serve" manually in a new terminal later.
    ) else (
        echo Ollama service is ready.
    )
) else (
    echo Ollama service is already running.
)
echo.

:: ============================================================
:: Step D: Check and download required models
:: ============================================================
set "MODEL_NAME=aratan/Qwythos-9B-v2-1M-Uncensored-GGUF:Q4_K_M"
set "EMBED_MODEL=nomic-embed-text"

echo [Step 3/3] Checking whether the required models are downloaded...

call :ollama_ensure_model "%MODEL_NAME%" "chat model (about 6-8 GB)"
if errorlevel 1 goto :after_models

call :ollama_ensure_model "%EMBED_MODEL%" "embedding model (small, for vector memory)"
if errorlevel 1 goto :after_models

echo.
echo All models are ready!
goto :ollama_finish

:ollama_ensure_model
setlocal
set "M_NAME=%~1"
set "M_DESC=%~2"
echo.
echo --- Checking %M_DESC%: %M_NAME% ---
call ollama show "%M_NAME%" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] %M_NAME% already exists, skipping download.
    exit /b 0
)
echo [INFO] %M_NAME% not found, downloading...
echo Note: download time for %M_DESC% depends on your network speed. Please wait...
echo.
call ollama pull "%M_NAME%"
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to download model %M_NAME%, error code: %errorlevel%
    echo Possible causes:
    echo   1. Network connection problem
    echo   2. Ollama service is not running properly
    echo   3. Incorrect model name or the model does not exist in the remote registry
    echo.
    echo Suggestions:
    echo   - Visit https://ollama.com/aratan/Qwythos-9B-v2-1M-Uncensored-GGUF to confirm the model exists
    echo   - Or try another model, e.g. llama3.2 or qwen2.5
    echo.
    goto :after_models
)
echo [OK] %M_NAME% downloaded.
exit /b 0

:: ============================================================
:: Ollama setup complete
:: ============================================================
:ollama_finish
echo.
echo ==================================================
echo        Done! Ollama is ready and models are available!
echo ==================================================
echo.
echo Verify: run "ollama list" to see installed models
echo Run: ollama run %MODEL_NAME%
echo.
goto :after_models
:after_models


echo.
echo [C2Achat] ==========================================
echo [C2Achat]   Install complete! Launching C2Achat...
echo [C2Achat] ==========================================

:: ============================================================
:: Launch the app
:: ============================================================
:launch

echo.
echo Launching C2Achat... The browser will open automatically
echo.
"%PYTHON_EXE%" start.py
if /I not "%~1"=="nopause" pause
