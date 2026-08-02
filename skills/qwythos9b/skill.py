import os
import json
import logging
import requests

import storage
import memory_store
from skill_utils import (
    load_file,
    load_image_to_base64,
    build_messages,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = logging.getLogger("DesignAgent")

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
MODEL = "aratan/Qwythos-9B-v2-1M-Uncensored-GGUF:Q4_K_M"


HOT_WINDOW = 20
RETRIEVE_TOP_K = 5
MAX_INPUT_CHARS = 6000


def process_i(**params):
    conv_id_param = params.get("conversationId", ["default"])
    conversation_id = conv_id_param[0] if isinstance(conv_id_param, list) else str(conv_id_param)
    conversation_id = conversation_id.strip("[]'\" ") or "default"
    log.info(f"\n========== 【对话ID】{conversation_id} ==========")

    prompt = params.get('prompt', [''])[0] if params.get('prompt') else ''

    # 多图循环时 app.py 会传入当前轮次；聊天技能只在第 1 轮把用户消息/AI 回复落库，
    # 避免同一轮生成把同一条消息重复写进数据库和向量库，污染历史记忆
    iter_index = int((params.get("_iter_index") or ["0"])[0] or 0)

    # 图片路径
    image_paths = params.get('uploadedPaths[]', []) or params.get('uploadedPaths', [])
    abs_image_paths = [p for p in image_paths if os.path.exists(p)]

    # 文档路径
    doc_paths = params.get('docPaths[]', []) or params.get('docPaths', [])
    abs_doc_paths = [p for p in doc_paths if os.path.exists(p)]



    storage.ensure_conversation(conversation_id)

    # 加载并截断文档内容
    doc_text = load_file(abs_doc_paths) if abs_doc_paths else ""
    if len(doc_text) > MAX_INPUT_CHARS:
        head = doc_text[:1500]
        tail = doc_text[-500:] if len(doc_text) > 2000 else ""
        doc_text = f"{head}\n\n......(内容过长，已截取首尾关键部分)\n\n{tail}"
    log.info(f"【附件】文档 {len(abs_doc_paths)} 个，文本长度 {len(doc_text)} 字符")

    # 1. 当前用户输入直接落库（storage 是唯一真相来源，落库即定型）
    if prompt and iter_index == 0:
        user_msg = storage.add_message(conversation_id, "user", prompt)
        memory_store.index_message(
            conversation_id, user_msg["id"], "user", prompt, user_msg["position"]
        )

    # 2. 短期上下文：最近 HOT_WINDOW 条（包含刚存进去的当前这条）
    hot_messages = storage.get_recent_messages(conversation_id, limit=HOT_WINDOW)
    hot_ids = {m["id"] for m in hot_messages}

    # 3. 长期记忆：向量检索 + "第一句话"这类元问题的精确定位，
    #    排除掉已经在热区窗口里的，避免同一句话重复出现在 prompt 里两遍
    retrieved_context = memory_store.build_retrieved_context(
        conversation_id, prompt, top_k=RETRIEVE_TOP_K, exclude_ids=hot_ids
    )

    # 4. 组装最终发给模型的 messages
    messages = build_messages(hot_messages, doc_text, retrieved_context)

    # 5. 注入图片。当前模型支持视觉（多模态），图片按原图直接注入，
    #    依靠较大的 num_ctx（32768）承接多图 token 占用；
    #    只有 Ollama 明确提示模型不支持图片时，才会去掉图片重试。
    images_b64 = []
    if abs_image_paths:
        for p in abs_image_paths:
            try:
                images_b64.append(load_image_to_base64(p))
            except Exception as e:
                log.warning(f"图片加载失败 {p}: {e}")
        log.info(f"【附件】已加载图片 {len(images_b64)} 张")

    # 6. 调用 Ollama 流式生成
    url = f"{OLLAMA_HOST.rstrip('/')}/api/chat"

    def make_payload(with_images):
        msgs = messages
        if with_images and images_b64:
            msgs = [dict(m) for m in messages]
            for msg in reversed(msgs):
                if msg.get("role") == "user":
                    msg["images"] = images_b64
                    break
        return {
            "model": MODEL,
            "messages": msgs,
            "stream": True,
            "options": {
                "temperature": 0.6,
                "top_p": 0.95,
                "top_k": 20,
                "repeat_penalty": 1.05,
                "num_ctx": 32768,
            },
        }

    payload = make_payload(True)

    full_response = ""
    thinking_started = False
    content_started = False

    try:
        response = requests.post(url, json=payload, stream=True, timeout=60)
        if response.status_code != 200 and images_b64:
            # 只有 Ollama 明确提示模型不支持图片时，才去掉图片重试；
            # 其它错误（图片过大、上下文超限等）如实报错，
            # 避免模型在没收到图的情况下"假装没收到图"。
            err_text = (response.text or "").lower()
            if "image" in err_text or "vision" in err_text:
                payload = make_payload(False)
                response = requests.post(url, json=payload, stream=True, timeout=60)
        if response.status_code != 200:
            yield "text", f"\n[错误] Ollama 返回状态码 {response.status_code}"
            return

        for line in response.iter_lines():
            if not line:
                continue
            chunk = json.loads(line.decode('utf-8'))
            msg = chunk.get('message', {})

            if msg.get('thinking'):
                if not thinking_started:
                    yield "text", "\n\n<details open> <summary>Thinking</summary>\n"
                    thinking_started = True
                yield "text", msg['thinking']

            if msg.get('content'):
                content_chunk = msg['content']
                if not content_started:
                    yield "text", ("\n\n</details>\n\n<content>\n" if thinking_started else "\n\n<content>\n")
                    content_started = True
                full_response += content_chunk
                yield "text", content_chunk

        if content_started:
            yield "text", "\n\n</content>"
        elif thinking_started:
            yield "text", "\n\n</think>"

    except Exception as exc:
        log.error("LLM 调用失败: %s", exc)
        yield "text", f"\n[错误] 调用失败: {exc}"
        return

    # 7. AI 回复落库 + 索引。
    #    跟旧版不同：这一步不再依赖前面 LLM 调用是否"干净"跑完才决定要不要
    #    persist——用户消息在第 1 步就已经落库了，这里只是把 AI 回复也存一份，
    #    两次写入互相独立，不存在"写了一半就整体丢失"的问题。
    if full_response and iter_index == 0:
        ai_msg = storage.add_message(conversation_id, "assistant", full_response)
        memory_store.index_message(
            conversation_id, ai_msg["id"], "assistant", full_response, ai_msg["position"]
        )
        log.info(f"【存储】AI 回复已写入，当前对话消息数: {storage.get_message_count(conversation_id)}")
