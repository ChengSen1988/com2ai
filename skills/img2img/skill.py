import os
import sys
from pathlib import Path
root_dir = Path(__file__).parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))
import gc
import torch
from sdnq import SDNQConfig
from PIL import Image
from pathlib import Path
from diffusers import  GGUFQuantizationConfig, Flux2KleinPipeline, Flux2Transformer2DModel
import random
from huggingface_hub import hf_hub_download


print("CUDA available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("CUDA device count:", torch.cuda.device_count())
    print("Current device:", torch.cuda.current_device())
    print("Device name:", torch.cuda.get_device_name())
else:
    print("CUDA is not available, using CPU.")

if torch.cuda.is_available():
    device = "cuda"
    dtype = torch.bfloat16
elif torch.backends.mps.is_available():
    device = "mps"
    dtype = torch.float16  
else:
    device = "cpu"
    dtype = torch.float32

device = str(device)

_pipeline_klein = None






def load_pipeline_klein():
    global _pipeline_klein

    # 缓存判断必须放在任何下载之前：已加载过的直接复用，不碰网络
    if _pipeline_klein is not None:
        print("Klein model cached, reusing.")
        return _pipeline_klein

    base_model_path = "csssss/com2ai-klein-4b"

    def _load(local_only):
        gguf_path = hf_hub_download(
            repo_id=base_model_path,
            filename="transformer/flux-2-klein-4b-Q8_0.gguf",
            local_files_only=local_only,
        )
        config_path = hf_hub_download(
            repo_id=base_model_path,
            filename="transformer/config.json",
            local_files_only=local_only,
        )
        transformer = Flux2Transformer2DModel.from_single_file(
            gguf_path,
            quantization_config=GGUFQuantizationConfig(compute_dtype=dtype),
            torch_dtype=dtype,
            config=config_path,
        )
        print(f"Loading Klein pipeline from: {base_model_path}")
        pipeline = Flux2KleinPipeline.from_pretrained(
            base_model_path,
            transformer=transformer,
            torch_dtype=dtype,
            local_files_only=local_only,
        )
        pipeline.enable_model_cpu_offload()
        return pipeline

    try:
        try:
            pipe = _load(local_only=True)
            print("✅ Using locally cached Klein model (offline)")
        except Exception:
            print("Local cache incomplete, trying to download missing files online ...")
            pipe = _load(local_only=False)
        _pipeline_klein = pipe
        print("✅ Klein model loaded successfully")
        return _pipeline_klein
    except Exception as e:
        raise RuntimeError(
            f"Failed to load the Klein model: {e}\n\n"
            "The first use downloads the model from Hugging Face (a few GB). "
            "If the error is a connection timeout/failure (ConnectTimeout / ConnectionError), "
            "the network cannot reach the model repository. Please check:\n"
            "1. Whether the model is already in the local cache (default: %USERPROFILE%\\.cache\\huggingface\\hub, "
            "changeable via HF_HOME);\n"
            "2. If the cache exists but still fails, make sure the download is complete "
            "(no *.incomplete files left in the directory)."
        ) from e

# load_pipeline_klein()



def process_i(**params):
    zhongzi_val = params.get('zhongzi', [''])[0]
    seed = int(zhongzi_val) if zhongzi_val and zhongzi_val.strip() else random.randint(1, 999999999)
    prompt = params.get('prompt', [''])[0]

    uploaded_paths = params.get('uploadedPaths[]', [])
    if not uploaded_paths or not uploaded_paths[0]:
        raise ValueError("No uploaded image received. Please upload at least one image first.")

    app_base = root_dir.parent.parent
    restype = 'png'
    # 使用固定种子，所有图片共用同一个生成器（若希望每张图随机不同，可在循环内重新生成）
    generator = torch.Generator(device="cuda").manual_seed(seed)

    try:
        pipeline = load_pipeline_klein()
        for input_image_rel in uploaded_paths:
            if not input_image_rel:          # 跳过空路径
                continue
            input_image = str((app_base / input_image_rel.lstrip("/")).resolve())
            print(f"Processing image: {input_image}")

            image = Image.open(input_image).convert("RGB")
            result = pipeline(
                image=image,
                prompt=prompt,
                guidance_scale=0.0,
                num_inference_steps=9,
                generator=generator,
            )
            result = result.images[0]
            yield restype, result            # 每张图片立即返回一个结果
    finally:
        torch.cuda.empty_cache()
        gc.collect()
