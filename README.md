# Com2AI ：AI chat

[English](README_EN.md) | 中文

一个本地运行的 AI 对话框架。
核心是一个聊天界面 + 可插拔的「技能」（Skill）系统：技能决定了 AI 能做什么——可以是纯对话、文生图、文档分析、代码执行……完全由你自己定义。
项目内置了对话、文生图、图生图三个示例技能，其余能力按需增删，不需要改框架代码。

## 核心特性

- **技能即插件**：`skills/` 下每个目录就是一个技能，增删改只需新建/修改文件夹，刷新页面即生效
- **UI 参数自动生成**：技能通过 `config.json` 声明参数，前端自动渲染出对应的输入控件（文本框、下拉、开关等），无需改动界面代码
- **内置示例技能**：
  - `qwythos9b`：本地 AI 对话（Ollama，纯离线，支持带思考过程的流式输出）
  - `text2img`：文生图（ZImage Turbo GGUF + LoRA 画风，支持比例/种子/数量等参数）
  - `img2img`：图生图 / 图片编辑（Flux 2 Klein 4B GGUF，上传图片后可去水印、精修、换背景等）
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

- Windows （脚本针对 Windows 编写）
- 建议 NVIDIA 显卡（无显卡时自动回退 CPU）
- 所有示例技能在 NVIDIA 最低 8GB 显存下运行也非常良好
- 首次安装需要联网（约 5–20 分钟）

## 快速开始

### 方式一：一行命令安装

打开 Windows PowerShell，粘贴下面指令回车即可。脚本会自动完成：下载项目 → 部署 Python 环境与依赖 → 安装 Ollama 并下载对话/嵌入模型（约 6–8 GB）→ 启动应用。


```powershell
irm https://raw.githubusercontent.com/ChengSen1988/com2ai/main/install.ps1 | iex
```

### 方式二：手动安装
将本仓库下载到你的电脑中，然后直接双击 `installandstart.bat`：便自动完成 Python 环境、全部依赖、Ollama 与模型下载，并启动应用。（首次约 5–30 分钟）


### 启动应用
在本机目录中双击 `installandstart.bat`：便启动应用。
安装或启动时还会自动在桌面创建 `C2Achat` 快捷方式（图标为项目根目录的 `icon.ico`，可自行替换）。


## 示例中的技能简介


| 用途 | 模型 | 来源 | 对应技能 |
| --- | --- | --- | --- |
| 对话模型 | `aratan/Qwythos-9B-v2-1M-Uncensored-GGUF:Q4_K_M` | Ollama | qwythos9b |
| 嵌入模型 | `nomic-embed-text` | Ollama | qwythos9b（记忆功能） |
| 文生图主模型 | `csssss/com2ai-zimage-gguf` | Hugging Face | text2img |
| 文生图 LoRA | `csssss/com2ai-zimage-lora` | Hugging Face | text2img |
| 图生图主模型 | `csssss/com2ai-klein-4b` | Hugging Face | img2img |

文生图模型首次使用时自动从 Hugging Face 下载（约几 GB），缓存到本地后离线可用。

## 目录结构

```text
installandstart.bat      一键安装并启动（双击即用，含 Ollama/模型下载）
install.ps1              一行命令安装入口（irm ... | iex）
app.py / start.py         Web 服务入口
skills/                   技能插件目录（每个子目录 = 一个技能）
static/                   前端资源（HTML/JS/CSS）
templates/index.html      聊天界面
chat_history.py           对话历史数据层
storage.py                消息持久化
memory_store.py           向量记忆（Chroma + Ollama 嵌入）
skill_registry.py         技能注册、加载与配置读取
uploads/  vector_memory/  chat.db  运行时数据
```

## 数据与隐私

所有数据均保存在本机。

## 开源许可

本项目采用 [MIT License](LICENSE) 开源：允许自由使用、修改、分发（含商用），但分发时需保留版权声明。欢迎任何人使用、贡献，也欢迎告诉我你的使用场景。
