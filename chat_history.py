import os
import json
from datetime import datetime

# 所有数据路径都基于本文件所在目录，避免从其它工作目录启动时数据写到别处
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHAT_HISTORY_FILE = os.path.join(_BASE_DIR, "chat_history.json")
UPLOAD_FOLDER = os.path.join(_BASE_DIR, "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def load_chat_history():
    """只加载索引列表"""
    if not os.path.exists(CHAT_HISTORY_FILE):
        return []
    try:
        with open(CHAT_HISTORY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        data.sort(key=lambda item: item.get("updatedAt", ""), reverse=True)
        return data
    except:
        return []


def save_chat_history(data):
    """
    入参 data 是完整的对话列表（含 messages 和 archives）。
    本函数会：
      1. 将每个对话的完整热消息 + 归档元数据存到 uploads/{id}/conversation.json
      2. 将每个归档的完整消息（messages）外置到 uploads/{id}/archives/{arc_id}.json
      3. 只把索引（不含 messages 和 archives 内容）写入 chat_history.json
    """
    if not isinstance(data, list):
        raise ValueError("数据必须为列表")

    now_iso = datetime.now().isoformat()
    index_list = []

    for conv in data:
        conv_id = conv["id"]
        if "updatedAt" not in conv:
            conv["updatedAt"] = now_iso

        conv_folder = os.path.join(UPLOAD_FOLDER, conv_id)
        os.makedirs(conv_folder, exist_ok=True)

        # ---- 0. 防御性保护：如果传入的 conv 没有 messages 字段（说明前端
        #         只持有索引、从未加载过该对话详情），绝不能用它覆盖磁盘上
        #         已有的完整对话内容，否则会导致历史消息被清空丢失。
        detail_path = os.path.join(conv_folder, "conversation.json")
        if "messages" not in conv:
            if os.path.exists(detail_path):
                try:
                    with open(detail_path, "r", encoding="utf-8") as f:
                        existing_detail = json.load(f)
                    # 用磁盘上已有的 messages / archives 补回，避免被空值覆盖
                    conv["messages"] = existing_detail.get("messages", [])
                    if "archives" not in conv:
                        conv["archives"] = existing_detail.get("archives", [])
                except Exception:
                    conv["messages"] = []
            else:
                conv["messages"] = []

        # ---- 1. 处理归档：把 messages 外置到单独文件 ----
        archives_folder = os.path.join(conv_folder, "archives")
        if "archives" in conv and conv["archives"]:
            os.makedirs(archives_folder, exist_ok=True)
            for arc in conv["archives"]:
                arc_id = arc.get("id")
                if not arc_id:
                    continue
                # 仅当归档自带完整 messages 时才覆盖归档文件，
                # 避免同样的"空覆盖"问题影响归档
                if "messages" in arc:
                    arc_file_path = os.path.join(archives_folder, f"{arc_id}.json")
                    with open(arc_file_path, "w", encoding="utf-8") as f:
                        json.dump(arc, f, ensure_ascii=False, indent=2)
                # 从内存中的 conv 剥离 messages 字段，只保留元数据
                arc.pop("messages", None)

        # ---- 2. 保存当前对话的详情（热消息 + 归档元数据） ----
        with open(detail_path, "w", encoding="utf-8") as f:
            json.dump(conv, f, ensure_ascii=False, indent=2)

        # ---- 3. 构建索引条目（剥离 messages 和 archives 内容） ----
        index_item = {
            "id": conv["id"],
            "title": conv.get("title", "新对话"),
            "createdAt": conv.get("createdAt", now_iso),
            "updatedAt": conv["updatedAt"],
            "processing": conv.get("processing", False),
        }
        index_list.append(index_item)

    # ---- 4. 写入索引文件 ----
    tmp_path = CHAT_HISTORY_FILE + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(index_list, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, CHAT_HISTORY_FILE)


def update_index_timestamp(conv_id, title=None):
    """仅更新索引中的时间戳和标题，不修改详情文件"""
    index = load_chat_history()
    found = False
    for item in index:
        if item["id"] == conv_id:
            item["updatedAt"] = datetime.now().isoformat()
            if title:
                item["title"] = title
            found = True
            break
    if not found:
        # 如果索引中不存在（极少发生），新建一条
        index.append({
            "id": conv_id,
            "title": title or "新对话",
            "createdAt": datetime.now().isoformat(),
            "updatedAt": datetime.now().isoformat(),
            "processing": False,
        })
    tmp_path = CHAT_HISTORY_FILE + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, CHAT_HISTORY_FILE)


def load_conv_detail(conv_id):
    """加载某个对话的详情（热消息 + 归档元数据）"""
    detail_path = os.path.join(UPLOAD_FOLDER, conv_id, "conversation.json")
    if not os.path.exists(detail_path):
        return {"id": conv_id, "messages": [], "archives": []}
    with open(detail_path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_conv_detail(conv_id, conv_detail):
    """保存对话详情，并更新索引时间。
    若传入的 conv_detail 缺少 messages 字段，视为调用方未持有完整数据，
    自动从磁盘已有文件补回 messages/archives，避免误覆盖丢失历史消息。
    写入采用临时文件 + 原子替换，避免并发写入导致文件损坏。
    """
    folder = os.path.join(UPLOAD_FOLDER, conv_id)
    os.makedirs(folder, exist_ok=True)
    detail_path = os.path.join(folder, "conversation.json")

    if "messages" not in conv_detail:
        if os.path.exists(detail_path):
            try:
                with open(detail_path, "r", encoding="utf-8") as f:
                    existing = json.load(f)
                conv_detail["messages"] = existing.get("messages", [])
                if "archives" not in conv_detail:
                    conv_detail["archives"] = existing.get("archives", [])
            except Exception:
                conv_detail["messages"] = []
        else:
            conv_detail["messages"] = []

    tmp_path = detail_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(conv_detail, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, detail_path)

    update_index_timestamp(conv_id, conv_detail.get("title"))


def set_conv_processing(conv_id, is_processing):
    """仅切换索引中某个对话的 processing 标记，不读写详情文件。
    返回 True 表示成功，False 表示该对话不存在于索引中。
    """
    index = load_chat_history()
    found = False
    for item in index:
        if item["id"] == conv_id:
            item["processing"] = bool(is_processing)
            found = True
            break
    if not found:
        return False
    tmp_path = CHAT_HISTORY_FILE + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, CHAT_HISTORY_FILE)
    return True
