"""
storage.py
----------
新项目的消息存储层：单文件 SQLite，取代原来 uploads/{id}/conversation.json +
archives/*.json 那一整套容易半写半坏的方案。

设计原则：
- 每条消息落库即定型，不再有"热消息 / 归档消息"两种状态的区分——
  是否要塞进发给模型的 prompt 里，完全是读的时候（skill.py）决定的事，
  跟存储层无关。
- position 由数据库自动维护（同一 conversation 下消息数量的自增序号），
  "第一条消息"永远等价于 position=0，不用另外记录。
- 用 sqlite3 标准库，不引入额外依赖，单文件、零运维，直接可以整个文件复制备份。
"""

import os
import sqlite3
import uuid
import datetime
from contextlib import contextmanager
from typing import List, Dict, Optional

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("CHAT_DB_PATH", os.path.join(_BASE_DIR, "chat.db"))


def _now() -> str:
    return datetime.datetime.now().isoformat()


@contextmanager
def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT DEFAULT '新对话',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                processing INTEGER DEFAULT 0
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                text TEXT NOT NULL,
                position INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_conv_pos
            ON messages(conversation_id, position)
        """)


init_db()


# ==================== 对话 ====================
def ensure_conversation(conversation_id: str, title: str = "新对话") -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (conversation_id, title, _now(), _now()),
        )


def touch_conversation(conversation_id: str, title: Optional[str] = None) -> None:
    with _conn() as conn:
        if title:
            conn.execute(
                "UPDATE conversations SET updated_at=?, title=? WHERE id=?",
                (_now(), title, conversation_id),
            )
        else:
            conn.execute(
                "UPDATE conversations SET updated_at=? WHERE id=?",
                (_now(), conversation_id),
            )


def set_processing(conversation_id: str, is_processing: bool) -> bool:
    with _conn() as conn:
        cur = conn.execute(
            "UPDATE conversations SET processing=? WHERE id=?",
            (1 if is_processing else 0, conversation_id),
        )
        return cur.rowcount > 0


def list_conversations() -> List[Dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, title, created_at, updated_at, processing FROM conversations ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def delete_conversation(conversation_id: str) -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM messages WHERE conversation_id=?", (conversation_id,))
        conn.execute("DELETE FROM conversations WHERE id=?", (conversation_id,))


# ==================== 消息 ====================
def add_message(conversation_id: str, role: str, text: str) -> Dict:
    """写入一条消息，position 自动取"当前对话已有消息数"。返回写入的消息完整信息。"""
    ensure_conversation(conversation_id)
    with _conn() as conn:
        pos_row = conn.execute(
            "SELECT COUNT(*) AS c FROM messages WHERE conversation_id=?", (conversation_id,)
        ).fetchone()
        position = pos_row["c"]
        msg_id = f"msg_{uuid.uuid4().hex[:12]}"
        created_at = _now()
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, text, position, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (msg_id, conversation_id, role, text, position, created_at),
        )
        conn.execute(
            "UPDATE conversations SET updated_at=? WHERE id=?", (created_at, conversation_id)
        )
        return {
            "id": msg_id,
            "conversation_id": conversation_id,
            "role": role,
            "text": text,
            "position": position,
            "created_at": created_at,
        }


def get_recent_messages(conversation_id: str, limit: int = 20) -> List[Dict]:
    """取最近 N 条消息，按时间正序返回（给模型当"短期上下文"用）。"""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE conversation_id=? ORDER BY position DESC LIMIT ?",
            (conversation_id, limit),
        ).fetchall()
        return [dict(r) for r in reversed(rows)]


def get_all_messages(conversation_id: str) -> List[Dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE conversation_id=? ORDER BY position ASC",
            (conversation_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_message_count(conversation_id: str) -> int:
    with _conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM messages WHERE conversation_id=?", (conversation_id,)
        ).fetchone()
        return row["c"]
