# C2Achat（Com2AI AI 对话框架）

一个本地运行的 AI 对话框架。核心是一个聊天界面 + 可插拔的「技能」（Skill）系统：技能决定了 AI 能做什么——可以是纯对话、文生图、文档分析、代码执行……完全由你自己定义。项目内置了对话和文生图两个示例技能，其余能力按需增删，不需要改框架代码。

## 核心特性

- **技能即插件**：`skills/` 下每个目录就是一个技能，增删改只需新建/修改文件夹，重启应用即生效
- **UI 参数自动生成**：技能通过 `config.json` 声明参数，前端自动渲染出对应的输入控件（文本框、下拉、开关等），无需改动界面代码
- **内置示例技能**：
  - `qwythos9b`：本地 AI 对话（Ollama，纯离线，支持带思考过程的流式输出）
  - `text2img`：文生图（ZImage Turbo GGUF + LoRA 画风，支持比例/种子/数量等参数）
- 文档 / 图片上传：对话可结合已上传内容回答
- 长期记忆：Chroma 向量检索历史对话，跨会话回忆
- 对话历史管理：本地保存、新建/删除/切换对话

## 如何自定义一个技能

1. 在 `skills/` 下新建目录，例如 `skills/my_skill/`
2. 创建 `config.json`：声明技能展示名、描述和前端参数
3. 创建 `skill.py`：实现 `process_i(**params)`，用 `yield` 输出结果（文字或图片）
4. 重启应用，新技能自动出现在技能下拉框中

技能目录结构：

```text
skills/my_skill/
├── config.json     # 技能元信息 + 前端参数声明（custom_params）
├── skill.py        # 技能实现：process_i(**params) 生成器
└── prompts.json    # 可选：该技能的提示词库
```

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

模型只和具体技能相关，不同技能可以依赖不同模型，甚至完全不依赖模型：

| 用途 | 模型 | 来源 | 对应技能 |
| --- | --- | --- | --- |
| 对话模型 | `aratan/Qwythos-9B-v2-1M-Uncensored-GGUF:Q4_K_M` | Ollama | qwythos9b |
| 嵌入模型 | `nomic-embed-text` | Ollama | qwythos9b（记忆功能） |
| 文生图主模型 | `csssss/com2ai-zimage-gguf` | Hugging Face | text2img |
| 文生图 LoRA | `csssss/com2ai-zimage-lora` | Hugging Face | text2img |

文生图模型首次使用时自动从 Hugging Face 下载（约几 GB），缓存到本地后离线可用。

## 目录结构

```text
app.py / start.py         Web 服务入口
skills/                   技能插件目录（每个子目录 = 一个技能）
static/                   前端资源（HTML/JS/CSS）
templates/index.html      聊天界面
chat_history.py           对话历史数据层
storage.py                消息持久化
memory_store.py           向量记忆（Chroma + Ollama 嵌入）
skill_registry.py         技能注册、加载与配置读取
uploads/  vector_memory/  chat.db  运行时数据（不入库，见 .gitignore）
```

## 数据与隐私

所有数据均保存在本机。聊天记录、上传文件、向量库等运行时数据已被 `.gitignore` 排除，不会随仓库提交。

## 开源许可

本项目采用 [MIT License](LICENSE) 开源：允许自由使用、修改、分发（含商用），但分发时需保留版权声明。欢迎任何人使用、贡献，也欢迎告诉我你的使用场景。
