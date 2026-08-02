import os
import ast
import logging
import base64

log = logging.getLogger("SkillUtils")

try:
    import fitz
except ImportError:
    fitz = None


def load_pdf(file_path: str) -> str:
    if fitz is None:
        raise ImportError("pymupdf 未安装")
    doc = fitz.open(file_path)
    text = "".join(page.get_text() for page in doc)
    log.info(f"【PDF】{file_path}  页数:{len(doc)}  字符数:{len(text)}")
    doc.close()
    return text


def load_txt(file_path: str) -> str:
    for enc in ("utf-8", "gbk", "utf-8-sig"):
        try:
            with open(file_path, "r", encoding=enc) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    raise ValueError(f"无法识别文件编码: {file_path}")


def load_file(file_path) -> str:
    if isinstance(file_path, str):
        s = file_path.strip()
        if s.startswith("[") and s.endswith("]"):
            try:
                file_path = ast.literal_eval(s)
            except Exception as e:
                log.warning(f"列表解析失败: {e}")

    if isinstance(file_path, list):
        parts = []
        for p in file_path:
            try:
                parts.append(load_file(p))
            except Exception as e:
                parts.append(f"【读取失败 {p}】{e}")
        return "\n\n====分隔线====\n\n".join(parts)

    p = file_path.strip().strip("'\"")
    ext = os.path.splitext(p)[-1].lower()
    if ext == ".pdf":
        return load_pdf(p)
    elif ext in (".txt", ".md", ".markdown", ".js", ".py", ".json", ".csv", ".log", ".html", ".htm", ".xml"):
        return load_txt(p)
    elif ext == ".docx":
        try:
            import docx
            return "\n".join(para.text for para in docx.Document(p).paragraphs)
        except ImportError:
            raise ImportError("python-docx 未安装")
    elif ext == "":
        return ""
    else:
        raise ValueError(f"不支持的文件类型: {ext}")


def load_image_to_base64(image_path: str) -> str:
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def build_system_prompt(doc_text: str) -> str:
    base = (
        "你使用中文进行思考和回复。\n"
        "你使用温暖的语气，以善意对待用户，不对其判断力或能力做负面假设。\n"
        "你仍愿意提出反对意见并保持坦诚，但以建设性、善意和为用户最佳利益着想的方式进行。\n"
        "你可通过示例、思想实验或比喻来说明解释。\n"
        "你绝不咒骂，除非用户主动要求或自己大量咒骂，即便如此也仅少量使用。\n"
        "你不总是提问，但若提问，每次回答不超过一个问题，并尽量在请求澄清之前先回答哪怕含糊的查询。\n"
        "如果你怀疑自己在与未成年人交谈，保持友好、年龄适宜且不包含任何不适合青少年的内容。"
        "否则，假定用户是有能力的成年人，并以此对待。\n"
        "暗示有文件存在的提示并不意味着文件确实存在，因为用户可能忘记上传，因此你应自行检查。\n"
        "你避免过度使用粗体强调、标题、列表和项目符号，仅使用清晰所需的最少格式。\n"
        "在典型对话和简单问题中，你保持自然语气，以散文而非列表或项目符号回应，除非被要求。"
    )
    if doc_text.strip():
        return (
            f"{base}\n\n"
            f"========== 用户上传的文档内容 ==========\n"
            f"{doc_text}\n"
            f"========== 文档结束 =========="
        )
    return base


def build_messages(hot_messages: list, doc_text: str, retrieved_context: str = "") -> list:
    """
    hot_messages: storage.get_recent_messages() 返回的列表，
                  已经按时间正序排列，最后一条就是当前这轮用户输入
                  （因为调用方在构建 messages 之前已经把它存进 storage 了）。
    """
    messages = [{"role": "system", "content": build_system_prompt(doc_text)}]

    if retrieved_context:
        messages.append({"role": "assistant", "content": retrieved_context})

    for msg in hot_messages:
        role = msg.get("role", "").strip()
        text = msg.get("text", "").strip()
        if not text or role not in ("user", "ai", "assistant"):
            continue
        messages.append({"role": "user" if role == "user" else "assistant", "content": text})

    return messages