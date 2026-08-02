# C2Achat（Com2AI 多图创作助手）

本地运行的 AI 创作助手：离线对话 + 文生图。Flask 提供 Web 界面，聊天模型与向量记忆走 Ollama，文生图走 Diffusers + ZImage（GGUF 量化）。

## 功能特性

- 本地 AI 对话：Ollama + Qwythos-9B，纯离线运行，支持带思考过程的流式输出
- 文档 / 图片上传：对话可结合已上传内容回答
- 长期记忆：Chroma 向量检索历史对话，跨会话回忆
- 文生图：ZImage Turbo（GGUF），支持 LoRA 画风、比例/种子/数量参数
- 对话历史管理：本地保存、新建/删除/切换对话

## 环境要求

- Windows 10/11（脚本针对 Windows 编写）
- 建议 NVIDIA 显卡（无显卡时自动回退 CPU）
- 首次安装需要联网（约 5–20 分钟）

## 快速开始

1. 运行 `01installv5.bat`：一键部署 Python 3.12 环境并安装全部依赖（含 GPU 检测）
2. 运行 `ollamainstall.bat`：安装 Ollama 并下载对话模型与嵌入模型（约 6–8 GB）
3. 启动：运行 `start.py`（或 `python start.py`），浏览器自动打开 `http://127.0.0.1:12457`

> 也可以自行准备环境后按 `requirements.txt` 安装依赖（PyTorch 请按需选择 CUDA/CPU 版本）。

## 模型依赖

| 用途 | 模型 | 来源 |
| --- | --- | --- |
| 对话模型 | `aratan/Qwythos-9B-v2-1M-Uncensored-GGUF:Q4_K_M` | Ollama |
| 嵌入模型 | `nomic-embed-text` | Ollama |
| 文生图主模型 | `csssss/com2ai-zimage-gguf` | Hugging Face |
| 文生图 LoRA | `csssss/com2ai-zimage-lora` | Hugging Face |

文生图模型首次使用时自动从 Hugging Face 下载（约几 GB），缓存到本地后离线可用。

## 目录结构

```text
app.py / start.py         Web 服务入口
skills/                   技能模块（对话、文生图等）
  qwythos9b/              本地对话技能
  text2img/               文生图技能
static/                   前端资源（HTML/JS/CSS）
templates/index.html      聊天界面
chat_history.py           对话历史数据层
storage.py                消息持久化
memory_store.py           向量记忆（Chroma + Ollama 嵌入）
skill_registry.py         技能注册与配置
uploads/  vector_memory/  chat.db  运行时数据（不入库，见 .gitignore）
```

## 数据与隐私

所有数据均保存在本机。聊天记录、上传文件、向量库等运行时数据已被 `.gitignore` 排除，不会随仓库提交。

## 开源许可

本项目采用 [MIT License](LICENSE) 开源：允许自由使用、修改、分发（含商用），
但分发时需保留版权声明。欢迎任何人使用、贡献，也欢迎告诉我你的使用场景。
