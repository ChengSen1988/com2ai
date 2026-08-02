# Com2AI : AI chat

English | [中文](README.md)

A locally running AI chat framework.

At its core is a chat interface + a pluggable "Skill" system: skills determine what the AI can do - plain chat, text-to-image, document analysis, code execution... entirely up to you. The project ships with two example skills (chat and text-to-image); everything else can be added or removed as needed without touching the framework code.

## Core Features

- **Skills are plugins**: every folder under `skills/` is a skill. Add, remove or modify by creating/editing folders - refresh the page and it takes effect
- **UI parameters generated automatically**: a skill declares its parameters in `config.json`, and the frontend renders the corresponding input controls (text boxes, dropdowns, switches, etc.) with no UI code changes needed
- **Built-in example skills**:
  - `qwythos9b`: local AI chat (Ollama, fully offline, with streaming output including the thinking process)
  - `text2img`: text-to-image (ZImage Turbo GGUF + LoRA styles, with ratio / seed / count parameters)
- Document / image upload: the conversation can answer based on uploaded content
- Long-term memory: Chroma vector search over past conversations, recall across sessions
- Conversation history management: saved locally, create / delete / switch conversations

## How to Create Your Own Skill

1. Create a new folder under `skills/`, e.g. `skills/my_skill/`
2. Create `config.json`: declare the skill's display name, description and frontend parameters
3. Create `skill.py`: implement `process_i(**params)` and `yield` the result (text or image)
4. Restart the app and the new skill appears in the skill dropdown

Skill directory layout:

```text
skills/my_skill/
├── config.json     # Skill metadata + frontend parameter declarations (custom_params)
├── skill.py        # Skill implementation: process_i(**params) generator
└── prompts.json    # Optional: prompt library for this skill
```

## Requirements

- Windows (the scripts are written for Windows)
- NVIDIA GPU recommended (automatically falls back to CPU)
- Network required for the first install (about 5-20 minutes)

## Quick Start

### Option 1: One-line install

Open Windows PowerShell, paste the command below and press Enter. The script automatically: downloads the project → sets up the Python environment and dependencies → installs Ollama and downloads the chat/embedding models (about 6-8 GB) → starts the app.

```powershell
irm https://raw.githubusercontent.com/ChengSen1988/com2ai/main/install.ps1 | iex
```

### Option 2: Manual install

Download this repository to your computer, then double-click `installandstart.bat`: it automatically completes the Python environment, all dependencies, Ollama and model downloads, then starts the app. (First run takes about 5-30 minutes)

### Start the app

Double-click `installandstart.bat` in the local directory to start the app.

## Example Skills Overview

| Purpose | Model | Source | Skill |
| --- | --- | --- | --- |
| Chat model | `aratan/Qwythos-9B-v2-1M-Uncensored-GGUF:Q4_K_M` | Ollama | qwythos9b |
| Embedding model | `nomic-embed-text` | Ollama | qwythos9b (memory) |
| Text-to-image base model | `csssss/com2ai-zimage-gguf` | Hugging Face | text2img |
| Text-to-image LoRA | `csssss/com2ai-zimage-lora` | Hugging Face | text2img |

The text-to-image model is downloaded automatically from Hugging Face on first use (a few GB) and works offline once cached locally.

## Directory Structure

```text
installandstart.bat      One-click install and start (double-click to use, incl. Ollama/model download)
install.ps1              One-line install entry (irm ... | iex)
app.py / start.py        Web server entry
skills/                  Skill plugin directory (each subfolder = one skill)
static/                  Frontend assets (HTML/JS/CSS)
templates/index.html     Chat UI
chat_history.py          Conversation history data layer
storage.py               Message persistence
memory_store.py          Vector memory (Chroma + Ollama embeddings)
skill_registry.py        Skill registration, loading and config reading
uploads/  vector_memory/  chat.db  Runtime data
```

## Data & Privacy

All data is stored locally on your machine.

## License

This project is open-sourced under the [MIT License](LICENSE): free to use, modify and distribute (including commercially), as long as the copyright notice is retained. Everyone is welcome to use and contribute - feel free to tell me about your use cases.
