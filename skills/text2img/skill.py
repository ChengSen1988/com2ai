import os
import sys
from pathlib import Path
root_dir = Path(__file__).parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))
import gc
import random
import torch
from sdnq import SDNQConfig
from pathlib import Path
from diffusers import ZImagePipeline, ZImageTransformer2DModel, GGUFQuantizationConfig, Flux2KleinPipeline, Flux2Transformer2DModel
from transformers import AutoTokenizer, AutoModelForCausalLM 

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

_zimage_model = None
def load_z_image():
    global _zimage_model
    if _zimage_model is not None:
        return _zimage_model
    base_model_path = "csssss/com2ai-zimage-gguf"

    def _load(local_only):
        gguf_path = hf_hub_download(
            repo_id=base_model_path,
            filename="transformer/z-image-turbo-Q4_K_S.gguf",
            local_files_only=local_only,
        )
        config_path = hf_hub_download(
            repo_id=base_model_path,
            filename="transformer/config.json",
            local_files_only=local_only,
        )
        transformer = ZImageTransformer2DModel.from_single_file(
            gguf_path,
            quantization_config=GGUFQuantizationConfig(compute_dtype=dtype),
            torch_dtype=dtype,
            config=config_path,
        )
        pipe = ZImagePipeline.from_pretrained(
            base_model_path,
            transformer=transformer,
            torch_dtype=dtype,
            local_files_only=local_only,
        )
        pipe.enable_model_cpu_offload()
        return pipe

    try:
        # 模型已下载到本地缓存时直接离线加载，不再联网校验（from_pretrained
        # 默认会去 Hugging Face 查 revision，网络不通时就是之前那个超时）。
        # 只有显式设置了 HF_HUB_OFFLINE 才强制离线；否则缓存不完整时自动联网补齐。
        offline_only = os.environ.get("HF_HUB_OFFLINE", "").lower() in ("1", "true", "yes")
        if offline_only:
            pipe = _load(local_only=True)
        else:
            try:
                pipe = _load(local_only=True)
                print("✅ 使用本地缓存的 ZImage GGUF 模型（未联网）")
            except Exception:
                print("本地缓存不完整，尝试联网下载/补齐模型文件（HF_ENDPOINT="
                      f"{os.environ.get('HF_ENDPOINT', 'https://huggingface.co')}) ...")
                pipe = _load(local_only=False)
        _zimage_model = pipe
        print("✅ ZImage GGUF model is ready.")
        return _zimage_model
    except Exception as e:
        raise RuntimeError(
            f"文生图模型加载失败：{e}\n\n"
            "首次使用需要从 Hugging Face 下载模型（约几 GB）。"
            "如果错误是网络连接超时/失败（ConnectTimeout / ConnectionError），"
            "说明当前网络无法访问模型仓库，请检查：\n"
            "1. 模型是否已下载到本地缓存（默认缓存目录 %USERPROFILE%\\.cache\\huggingface\\hub，"
            "可用 HF_HOME 环境变量修改）；\n"
            "2. 若缓存已有模型仍报错，请确认下载完整（目录里不能残留 *.incomplete 文件）；\n"
            "3. 请确认网络可以正常访问 huggingface.co；如需使用代理或自定义镜像，"
            "可设置 HF_ENDPOINT 环境变量后重启应用。"
        ) from e






def process_i(
**params
):

    zhongzi_val = params.get('zhongzi', [''])[0]
    seed = int(zhongzi_val) if zhongzi_val and zhongzi_val.strip() else random.randint(1, 999999999)
    # seed = int(zhongzi) if zhongzi is not None else random.randint(1, 999999999)
    generator = torch.Generator(device=device).manual_seed(seed)
    bili = params.get('bili', ['1x1'])[0]
    prompt = params.get('prompt', [''])[0]
    lora = params.get('art_style', [''])[0]


    restype='png'

    size_map = {"1x1": (1024,1024), "1x2": (720,1440), "3x4": (960,1280),"2x1": (1440,720),"4x3": (1280,960)}
    print(prompt)
    print(seed)
    widths, heights = size_map.get(bili, (1024,1024))
    try:
        pipeline = load_z_image()

        try:
            pipeline.unload_lora_weights()
        except Exception:
            pass


        if lora=="moreDetail":
            lora_path0 = hf_hub_download(
                repo_id="csssss/com2ai-zimage-lora",
                filename="MidJourney-Style-v001.safetensors",
             )
            lora_path2 = hf_hub_download(
                repo_id="csssss/com2ai-zimage-lora",
                filename="moreDetail-v001.safetensors",
            )
            pipeline.load_lora_weights(str(lora_path0), adapter_name="ziamgelora0")
            pipeline.load_lora_weights(str(lora_path2), adapter_name="ziamgelora2")
            pipeline.set_adapters("ziamgelora0", adapter_weights=[0.7])
            pipeline.set_adapters("ziamgelora2", adapter_weights=[0.3])         



        result = pipeline(
            prompt=prompt,
            width=widths,
            height=heights,
            guidance_scale=0.0,
            num_inference_steps=9,
            generator=generator,
        )            
        result=result.images[0]            
        yield restype,result
    finally:
        torch.cuda.empty_cache()
        gc.collect()
