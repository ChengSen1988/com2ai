"""
memory_store.py（新项目版）
--------------------------
轻量本地向量记忆层：Chroma（内嵌、单文件、零运维）+ Ollama embedding。

跟 storage.py 的分工：
- storage.py 是"真相来源"，每条消息落库后永久保留，有明确的 position。
- 这里只是给 storage 里的消息建一份语义索引，方便按内容检索，
  不存储消息本身的"真相"，随时可以删库重建（重新跑一遍
  storage.get_all_messages + index_message 即可）。
"""

import os
import re
import logging
from typing import List, Dict, Optional

import chromadb
from chromadb.api.types import EmbeddingFunction, Documents, Embeddings
import requests

log = logging.getLogger("MemoryStore")

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VECTOR_DB_PATH = os.environ.get("VECTOR_DB_PATH", os.path.join(_BASE_DIR, "vector_memory"))
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text")
COLLECTION_NAME = "chat_messages"

os.makedirs(VECTOR_DB_PATH, exist_ok=True)

_FIRST_MSG_PATTERNS = [
    r"第一句", r"第一条", r"最开始", r"一开始", r"开头(说|问|聊)",
    r"最初(的问题|说|聊|问)", r"first\s+message", r"very\s+first",
]


class OllamaEmbeddingFunction(EmbeddingFunction):
    """
    注意：这里故意不用 `ollama` 这个 Python 包（它内部基于 httpx）。
    Windows 上 httpx 的流式请求和 Ollama 服务端有已知兼容性问题，会稳定复现
    502 Bad Gateway（见 ollama/ollama#9549）。改用 requests 直接打 REST 接口，
    跟 skill.py 里调 /api/chat 用的是同一套客户端，已验证在这台机器上没问题。
    """

    def __init__(self, model: str = EMBED_MODEL, host: str = OLLAMA_HOST):
        self.model = model
        self.url = f"{host.rstrip('/')}/api/embed"

    def __call__(self, input: Documents) -> Embeddings:
        vectors = []
        for text in input:
            text = (text or "").strip() or " "
            resp = requests.post(
                self.url,
                json={"model": self.model, "input": text},
                timeout=60,
            )
            resp.raise_for_status()
            data = resp.json()
            vectors.append(data["embeddings"][0])
        return vectors


_embedding_fn = OllamaEmbeddingFunction()
_client = chromadb.PersistentClient(path=VECTOR_DB_PATH)
_collection = _client.get_or_create_collection(
    name=COLLECTION_NAME,
    embedding_function=_embedding_fn,
    metadata={"hnsw:space": "cosine"},
)


def index_message(conversation_id: str, msg_id: str, role: str, text: str, position: int) -> None:
    text = (text or "").strip()
    if not text:
        return
    try:
        _collection.upsert(
            ids=[f"{conversation_id}::{msg_id}"],
            documents=[text],
            metadatas=[{
                "conversation_id": conversation_id,
                "msg_id": msg_id,
                "role": role,
                "position": position,
            }],
        )
    except Exception as e:
        log.error(f"向量索引写入失败 msg_id={msg_id}: {e}")


def delete_conversation(conversation_id: str) -> None:
    """配合 storage.delete_conversation 一起清理向量库里对应的数据。"""
    try:
        _collection.delete(where={"conversation_id": conversation_id})
    except Exception as e:
        log.error(f"向量索引删除失败 conversation_id={conversation_id}: {e}")


def semantic_search(conversation_id: str, query: str, top_k: int = 5,
                     exclude_ids: Optional[set] = None) -> List[Dict]:
    if not query.strip():
        return []
    try:
        res = _collection.query(
            query_texts=[query],
            n_results=top_k,
            where={"conversation_id": conversation_id},
        )
    except Exception as e:
        log.error(f"向量检索失败: {e}")
        return []

    hits = []
    ids = res.get("ids", [[]])[0]
    docs = res.get("documents", [[]])[0]
    metas = res.get("metadatas", [[]])[0]
    dists = res.get("distances", [[]])[0] if res.get("distances") else [None] * len(ids)

    for _id, doc, meta, dist in zip(ids, docs, metas, dists):
        msg_id = meta.get("msg_id")
        if exclude_ids and msg_id in exclude_ids:
            continue
        hits.append({
            "msg_id": msg_id, "role": meta.get("role"), "text": doc,
            "position": meta.get("position"), "distance": dist,
        })
    return hits


def get_message_by_position(conversation_id: str, position: int) -> Optional[Dict]:
    try:
        res = _collection.get(
            where={"$and": [{"conversation_id": conversation_id}, {"position": position}]},
        )
    except Exception as e:
        log.error(f"按 position 检索失败: {e}")
        return None

    ids = res.get("ids", [])
    if not ids:
        return None
    doc = res.get("documents", [""])[0]
    meta = res.get("metadatas", [{}])[0]
    return {"msg_id": meta.get("msg_id"), "role": meta.get("role"), "text": doc, "position": meta.get("position")}


def is_first_message_query(prompt: str) -> bool:
    return any(re.search(p, prompt, re.IGNORECASE) for p in _FIRST_MSG_PATTERNS)


def build_retrieved_context(conversation_id: str, prompt: str, top_k: int = 5,
                             exclude_ids: Optional[set] = None) -> str:
    exclude_ids = set(exclude_ids or set())
    pieces = []

    if is_first_message_query(prompt):
        for pos in (0, 1):
            m = get_message_by_position(conversation_id, pos)
            if m and m["msg_id"] not in exclude_ids:
                pieces.append(f"[对话开头 · 第{pos+1}条 · {m['role']}] {m['text']}")
                exclude_ids.add(m["msg_id"])

    for h in semantic_search(conversation_id, prompt, top_k=top_k, exclude_ids=exclude_ids):
        pieces.append(f"[相关历史 · 第{h['position']+1}条 · {h['role']}] {h['text']}")
        exclude_ids.add(h["msg_id"])

    if not pieces:
        return ""
    return (
        "以下是从完整历史中检索到的、与当前问题相关的原文片段"
        "（不是摘要，是原文，可直接引用）：\n" + "\n".join(pieces)
    )
