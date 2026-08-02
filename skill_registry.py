"""
skill_registry.py
──────────────────
所有"技能"相关的公共逻辑集中在这里，供 app.py 和各个 skills/*/skill.py（尤其是路由技能）共用：

- list_skills()          只读 config.json，列出技能，不 import 任何 .py
- load_skill_config_only() 只读单个技能的 config.json
- load_skill_module()     真正需要执行某个技能时，才 import 它的 skill.py；
                          并且做了缓存 —— 像 ChatMiniCPM 这种在模块顶层就要
                          加载大模型/连数据库的技能，同一个进程里只会被真正
                          加载一次，之后复用，否则"路由技能"每次调用都要用它
                          做一次路由决策，会导致模型被反复重新加载，完全不可用。
"""

import sys
import os
import json
import importlib.util
from pathlib import Path


def get_skills_base() -> Path:
    if getattr(sys, 'frozen', False):
        return Path(os.path.dirname(sys.executable)) / 'skills'
    return Path(__file__).parent / 'skills'


def get_skill_dir(skill_name: str) -> Path:
    return get_skills_base() / skill_name


def load_skill_config_only(skill_name: str):
    """只读取 skills/{skill_name}/config.json，不执行任何代码。返回 dict 或 None。"""
    config_path = get_skill_dir(skill_name) / "config.json"
    if not config_path.exists():
        return None
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def list_skills(exclude=None, only_routable=False):
    """
    列出所有技能。只读每个技能目录下的 config.json，速度很快。

    参数：
      exclude:       要排除的技能名列表（比如路由技能自己，避免路由技能把自己也加进
                      可选技能里，造成递归调用）。
      only_routable: 为 True 时，只返回 config.json 里没有显式写
                      "routable": false 的技能（默认所有技能都是可被路由调用的）。

    返回：
      [{"value": 技能目录名, "label": 展示名, "config": 完整 config.json 内容}, ...]
    """
    exclude = set(exclude or [])
    base = get_skills_base()
    result = []
    if not base.exists():
        return result

    for d in sorted(base.iterdir()):
        if not d.is_dir():
            continue
        skill_name = d.name
        if skill_name in exclude:
            continue
        config = load_skill_config_only(skill_name)
        if config is None:
            continue
        if only_routable and config.get("routable") is False:
            continue
        result.append({
            "value": skill_name,
            "label": config.get("label", skill_name),
            "config": config,
        })
    return result


def get_default_skill():
    """返回配置里标记了 is_default: true 的技能；
    如果没有技能标记，则回退到列表第一个技能；没有任何技能时返回 None。"""
    skills = list_skills()
    if not skills:
        return None
    for s in skills:
        if s["config"].get("is_default") is True:
            return s
    return skills[0]


_module_cache = {}


def load_skill_module(skill_name: str, use_cache: bool = True):
    """
    真正加载 skills/{skill_name}/skill.py 并返回 module 对象（此时才会触发模型
    加载等重逻辑）。默认按技能名缓存，同一个技能在同一个进程里只会被 exec 一次。

    如果某个技能在开发调试阶段需要"改完代码立刻生效、不想用缓存"，
    可以调用 load_skill_module(name, use_cache=False)。
    """
    if use_cache and skill_name in _module_cache:
        return _module_cache[skill_name]

    file_path = get_skill_dir(skill_name) / "skill.py"
    if not file_path.exists():
        raise ImportError(f"技能模块文件不存在: {file_path}")

    spec = importlib.util.spec_from_file_location(f"skills_dynamic.{skill_name}", file_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    if use_cache:
        _module_cache[skill_name] = module
    return module


def clear_skill_module_cache(skill_name: str = None):
    """清空技能模块缓存（调试用）：不传参数清空全部，传参数只清空指定技能。"""
    if skill_name is None:
        _module_cache.clear()
    else:
        _module_cache.pop(skill_name, None)
