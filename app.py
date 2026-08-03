import sys, os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.dirname(os.path.abspath(sys.argv[0])))
import time
import json
import random
import re
import traceback
import shutil
import webbrowser
from threading import Timer
from urllib.parse import urlsplit
from flask import Flask, render_template, request, jsonify, send_from_directory, Response, stream_with_context
from werkzeug.utils import secure_filename
import platform
import subprocess


from chat_history import (
    load_chat_history,
    save_chat_history,
    load_conv_detail,
    save_conv_detail,
    update_index_timestamp,
    set_conv_processing,
    UPLOAD_FOLDER as CHAT_UPLOAD_FOLDER,
)

import skill_registry

app = Flask(__name__)

# 上传大小上限：图片/文档单次最多 256MB，防止磁盘被写满
app.config["MAX_CONTENT_LENGTH"] = 256 * 1024 * 1024

# conversationId 只允许字母数字与 - _，防止用对话 ID 做路径穿越
_CONV_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")

ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".avif"}
ALLOWED_DOC_EXTS = {".pdf", ".txt", ".md", ".markdown", ".docx", ".js", ".py", ".json", ".csv", ".log", ".html", ".htm", ".xml", ".css"}


@app.errorhandler(413)
def _request_too_large(e):
    return jsonify({"error": "上传内容过大（单次上限 256MB）"}), 413


def _is_valid_conv_id(conv_id):
    return bool(_CONV_ID_RE.match(conv_id or ""))


def _resolve_upload_path(rel_path):
    """把前端传的 /uploads/xxx 相对路径解析为 uploads 目录内的绝对路径；
    不在 uploads 内的路径一律返回 None（防路径穿越读取任意文件）。"""
    if not rel_path:
        return None
    upload_root = os.path.realpath(UPLOAD_FOLDER)
    abs_p = os.path.abspath(os.path.join(_BASE, rel_path.lstrip("/")))
    real_p = os.path.realpath(abs_p)
    if real_p != upload_root and not real_p.startswith(upload_root + os.sep):
        return None
    return real_p


@app.before_request
def _reject_cross_site_requests():
    """本地服务的基本 CSRF 防护：拒绝来自非 localhost 页面的跨站请求。
    正常页面自身、curl 等不带 Origin/Referer 或来源为 localhost 的请求不受影响。"""
    for header_name in ("Origin", "Referer"):
        value = request.headers.get(header_name)
        if not value:
            continue
        try:
            host = urlsplit(value).hostname or ""
        except Exception:
            host = ""
        if host not in ("127.0.0.1", "localhost", "::1"):
            return jsonify({"error": "拒绝跨站请求"}), 403
    return None


def _get_base_dir():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

_BASE = _get_base_dir()
print(f"Base directory: {_BASE}")
UPLOAD_FOLDER = CHAT_UPLOAD_FOLDER
CONFIG_FILE = "config.json"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
CHAT_HISTORY_FILE = os.path.join(_BASE, "chat_history.json")
PROMPTS_FILE = os.path.join(_BASE, "prompts.json")

DEFAULT_PROMPTS = []

def get_conv_folder(conversation_id):
    """返回 uploads/{conversation_id}/ 的绝对路径，不存在则自动创建"""
    if not _is_valid_conv_id(conversation_id):
        raise ValueError("无效的 conversationId")
    folder = os.path.join(UPLOAD_FOLDER, str(conversation_id))
    os.makedirs(folder, exist_ok=True)
    print(f"Conversation folder: {folder}")
    return folder


get_skills_base = skill_registry.get_skills_base
get_skill_dir = skill_registry.get_skill_dir
load_skill_config_only = skill_registry.load_skill_config_only


# ==================== API 路由 ====================

@app.route("/api/history", methods=["GET", "POST"])
def api_history():
    if request.method == "GET":
        return jsonify(load_chat_history())   # 只返回索引
    elif request.method == "POST":
        try:
            data = request.get_json()
            if not isinstance(data, list):
                return jsonify({"error": "无效的数据格式"}), 400
            # 保存时会将完整对话拆解为索引 + 详情文件
            save_chat_history(data)
            return jsonify({"success": True})
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    return Response("方法不允许"), 405


@app.route("/api/conv/<conversation_id>/messages", methods=["GET"])
def get_conv_messages(conversation_id):
    """获取对话的完整详情（热消息 + 归档元数据）"""
    if not _is_valid_conv_id(conversation_id):
        return jsonify({"error": "无效的 conversationId"}), 400
    try:
        detail = load_conv_detail(conversation_id)
        # 如果对话详情文件不存在，返回404
        if not detail or "id" not in detail:
            return jsonify({"error": "对话不存在"}), 404
        return jsonify(detail)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/conv/<conversation_id>", methods=["PUT"])
def put_conv_detail(conversation_id):
    """
    单个对话的局部保存：只写入这一个对话的 conversation.json，
    并只更新索引中这一条记录的时间戳/标题。
    不会触碰其它对话的数据，从根本上避免全量保存带来的竞态覆盖问题。
    """
    if not _is_valid_conv_id(conversation_id):
        return jsonify({"error": "无效的 conversationId"}), 400
    try:
        conv = request.get_json()
        if not isinstance(conv, dict):
            return jsonify({"error": "无效的数据格式"}), 400
        conv["id"] = conversation_id
        save_conv_detail(conversation_id, conv)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/conv/<conversation_id>/processing", methods=["PUT"])
def put_conv_processing(conversation_id):
    """只切换某个对话的 processing 状态（索引层面），不涉及消息内容，
    避免因为这个高频调用的小操作触发整列表的全量覆盖。"""
    if not _is_valid_conv_id(conversation_id):
        return jsonify({"error": "无效的 conversationId"}), 400
    try:
        body = request.get_json() or {}
        is_processing = bool(body.get("processing", False))
        ok = set_conv_processing(conversation_id, is_processing)
        if not ok:
            return jsonify({"error": "对话不存在"}), 404
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500





@app.route("/")
def index():
    return render_template("index.html")




@app.route("/upload", methods=["POST"])
def upload_images():
    conversation_id = request.form.get("conversationId", str(int(time.time() * 1000)))
    if not _is_valid_conv_id(conversation_id):
        return jsonify({"error": "无效的 conversationId"}), 400
    files = request.files.getlist("images")
    conv_folder = get_conv_folder(conversation_id)
    saved_paths = []

    # 服务端校验文件类型（前端限制可被绕过）
    for file in files:
        if file and file.filename:
            ext = os.path.splitext(file.filename)[1].lower()
            if ext not in ALLOWED_IMAGE_EXTS:
                return jsonify({"error": f"不支持的图片类型: {ext or '无扩展名'}"}), 400

    for file in files:
        if file:
            filename = secure_filename(f"{int(time.time() * 1000)}_{file.filename}")
            filepath = os.path.join(conv_folder, filename)
            file.save(filepath)
            saved_paths.append(f"/uploads/{conversation_id}/{filename}")
    return jsonify({"success": True, "paths": saved_paths})





@app.route("/upload_doc", methods=["POST"])
def upload_docs():
    conversation_id = request.form.get("conversationId", str(int(time.time() * 1000)))
    if not _is_valid_conv_id(conversation_id):
        return jsonify({"error": "无效的 conversationId"}), 400
    files = request.files.getlist("documents")
    conv_folder = get_conv_folder(conversation_id)
    saved_docs = []

    # 服务端校验文件类型（前端限制可被绕过）
    for file in files:
        if file and file.filename:
            ext = os.path.splitext(file.filename)[1].lower()
            if ext not in ALLOWED_DOC_EXTS:
                return jsonify({"error": f"不支持的文件类型: {ext or '无扩展名'}"}), 400

    for file in files:
        if not file or not file.filename:
            continue
        filename = secure_filename(f"{int(time.time() * 1000)}_{file.filename}")
        filepath = os.path.join(conv_folder, filename)
        file.save(filepath)
        saved_docs.append(f"/uploads/{conversation_id}/{filename}")
    return jsonify({"success": True, "docs": saved_docs})


def out(restype, result, seed, conv_folder, conversation_id, pending_message_id, i):
    if restype == "text":
        yield f"data: {json.dumps({'pendingMessageId': pending_message_id, 'textmsg': result})}\n\n"

    else:
        timestamp = int(time.time() * 1000)
        filename = secure_filename(f"{timestamp}_{seed}_result.{restype}")
        result_path = os.path.join(conv_folder, filename)
        conv_folder_abs = os.path.abspath(conv_folder)
        result.save(result_path)
        url = f"/uploads/{conversation_id}/{filename}"
        if i == 0:
            yield f"data: {json.dumps({'file_url': url, 'pendingMessageId': pending_message_id, 'folder_path': conv_folder_abs})}\n\n"
        else:
            yield f"data: {json.dumps({'file_url': url, 'pendingMessageId': pending_message_id})}\n\n"



# ==================== /process 主处理路由 ====================

@app.route("/process", methods=["POST"])
def process_is():
    try:
        params = {key: request.form.getlist(key) for key in request.form.keys()}

        conversation_id = request.form.get("conversationId", str(int(time.time() * 1000)))
        if not _is_valid_conv_id(conversation_id):
            return jsonify({"error": "无效的 conversationId"}), 400
        conv_folder = get_conv_folder(conversation_id)

        num_images_str = request.form.get("count", "").strip()
        try:
            num_images = int(num_images_str) if num_images_str else 1
        except ValueError:
            num_images = 1
        num_images = max(1, min(num_images, 20))  # 限制单次出图数量，防止资源被耗尽

        pending_message_id = request.form.get("pendingMessageId")
        seed_str = request.form.get("seed", "").strip()
        try:
            seed = int(seed_str) if seed_str else None
        except ValueError:
            seed = None

        skill = request.form.get("skill", "").strip()
        if not skill:
            default_skill = skill_registry.get_default_skill()
            skill = default_skill["value"] if default_skill else ""
            if not skill:
                return jsonify({"error": "没有可用的技能"}), 400
        known_skills = {s["value"].lower() for s in skill_registry.list_skills()}
        if skill.lower() not in known_skills:
            return jsonify({"error": f"未知的技能: {skill}"}), 400

        # 把前端传的 /uploads/xxx 路径解析为 uploads 目录内的绝对路径并写回 params：
        # 之前文档/图片路径都没有真正转成绝对路径，导致技能里 os.path.exists 检查失败、
        # 附件被静默丢弃；这里同时做路径穿越校验，只允许引用 uploads 内的文件。
        abs_doc_paths = []
        for rel_p in request.form.getlist("docPaths[]"):
            resolved = _resolve_upload_path(rel_p)
            if resolved and os.path.exists(resolved):
                abs_doc_paths.append(resolved)
        abs_img_paths = []
        for rel_p in request.form.getlist("uploadedPaths[]"):
            resolved = _resolve_upload_path(rel_p)
            if resolved and os.path.exists(resolved):
                abs_img_paths.append(resolved)
        params["docPaths[]"] = abs_doc_paths
        params["uploadedPaths[]"] = abs_img_paths

        def generate():
            try:
                conv_folder_abs = os.path.abspath(conv_folder)
                module = skill_registry.load_skill_module(skill)

                for i in range(num_images):
                    # 注意：不能用 `seed = int(seed) ...`，那会让 seed 变成 generate()
                    # 的局部变量，右侧引用未赋值的局部变量会报 UnboundLocalError。
                    # 用独立变量 cur_seed：用户填了种子则所有图共用，没填则每张图随机。
                    cur_seed = seed if seed is not None else random.randint(1, 4294967295)
                    # 把多图循环的当前轮次传给技能，聊天技能只在第 1 轮落库，
                    # 避免同一轮生成把同一条消息重复写进数据库/向量库
                    params["_iter_index"] = [str(i)]
                    params["_num_images"] = [str(num_images)]
                    result_gen = module.process_i(
                        **params
                    )
                    for restype, result in result_gen:
                        for event in out(restype, result, cur_seed, conv_folder, conversation_id, pending_message_id, i):
                            yield event

                yield f"data: {json.dumps({'done': True, 'pendingMessageId': pending_message_id})}\n\n"
            except Exception as e:
                traceback.print_exc()
                error_detail = traceback.format_exc()
                yield f"data: {json.dumps({'error': str(e), 'error_detail': error_detail, 'pendingMessageId': pending_message_id})}\n\n"

        return Response(stream_with_context(generate()), mimetype='text/event-stream')

    except Exception as e:
        return jsonify({"error": str(e)}), 500



@app.route("/api/conv/<conversation_id>/assets", methods=["DELETE"])
def delete_conv_assets(conversation_id):
    if not _is_valid_conv_id(conversation_id):
        return jsonify({"error": "错误的 conversationId"}), 400

    conv_folder = os.path.join(UPLOAD_FOLDER, conversation_id)
    if os.path.isdir(conv_folder):
        try:
            shutil.rmtree(conv_folder)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # 同步清理 SQLite 与向量库里的消息（JSON 之外的两套持久化），
    # 避免删除对话后残留幽灵数据、数据库持续膨胀
    for module_name in ("storage", "memory_store"):
        try:
            mod = __import__(module_name)
            if hasattr(mod, "delete_conversation"):
                mod.delete_conversation(conversation_id)
        except Exception as e:
            print(f"清理 {module_name} 数据失败: {e}")

    return jsonify({"success": True})


@app.route('/api/skills', methods=['GET'])
def get_skills():
    skills = skill_registry.list_skills()
    return jsonify([
        {"value": s["value"], "label": s["label"], "is_default": bool(s["config"].get("is_default"))}
        for s in skills
    ])


def _skill_prompts_path(skill_name: str):

    skill_name = (skill_name or "").strip()
    if skill_name:
        return os.path.join(str(skill_registry.get_skill_dir(skill_name)), "prompts.json")
    return PROMPTS_FILE


def load_prompts():

    all_prompts = []

    common_path = _skill_prompts_path("")
    if not os.path.exists(common_path):

        save_prompts(DEFAULT_PROMPTS)

    if os.path.exists(common_path):
        try:
            with open(common_path, "r", encoding="utf-8") as f:
                all_prompts.extend(json.load(f))
        except Exception:
            pass

    for skill in skill_registry.list_skills():
        skill_path = _skill_prompts_path(skill["value"])
        if os.path.exists(skill_path):
            try:
                with open(skill_path, "r", encoding="utf-8") as f:
                    all_prompts.extend(json.load(f))
            except Exception:
                pass

    return all_prompts


def save_prompts(data):
    grouped = {}
    for item in data:
        skill_name = (item.get("skill") or "").strip()
        grouped.setdefault(skill_name, []).append(item)
    known_skill_names = {s["value"] for s in skill_registry.list_skills()}
    # 只允许写入已知技能（或公共 prompts.json），丢弃未知/非法分组，
    # 防止 skill 字段携带路径穿越去覆盖任意位置的 prompts.json
    all_targets = known_skill_names | {""}

    for skill_name in all_targets:
        path = _skill_prompts_path(skill_name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(grouped.get(skill_name, []), f, ensure_ascii=False, indent=2)


@app.route("/api/prompts", methods=["GET", "PUT"])
def api_prompts():
    if request.method == "GET":
        return jsonify(load_prompts())
    elif request.method == "PUT":
        try:
            data = request.get_json()
            if not isinstance(data, list):
                return jsonify({"error": "Invalid data format"}), 400
            save_prompts(data)
            return jsonify({"success": True})
        except Exception as e:
            return jsonify({"error": str(e)}), 500


@app.route('/open_folder')
def open_folder():
    path = request.args.get('path')
    if not path:
        return jsonify({'success': False, 'error': '路径不存在'})
    try:
        upload_root = os.path.realpath(UPLOAD_FOLDER)
        target = os.path.realpath(path)
        if target != upload_root and not target.startswith(upload_root + os.sep):
            return jsonify({'success': False, 'error': '路径不在允许范围内'})
    except Exception:
        return jsonify({'success': False, 'error': '路径不合法'})
    if not path or not os.path.exists(path):
        return jsonify({'success': False, 'error': '路径不存在'})
    try:
        if platform.system() == 'Windows':
            os.startfile(path)
        elif platform.system() == 'Darwin':  # macOS
            subprocess.run(['open', path])
        else: 
            subprocess.run(['xdg-open', path])
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/skill_config/<skill_name>', methods=['GET'])
def get_skill_config(skill_name):
    config = load_skill_config_only(skill_name)
    if config is None:
        return jsonify({"error": "tool not found"}), 404
    return jsonify(config)


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)


def open_browser():
    webbrowser.open_new("http://127.0.0.1:5000/")

if __name__ == "__main__":
    Timer(1, open_browser).start()
    app.run(debug=False, use_reloader=False, port=5000)
