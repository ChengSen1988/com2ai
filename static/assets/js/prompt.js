console.log("prompt system loading...");

let globalPromptList = [];
const PROMPT_MENU_ELEMENT = document.getElementById("promptMenu");
const PROMPT_TOGGLE_ELEMENT = document.getElementById("promptToggle");
const SKILL_MENU_ELEMENT = document.getElementById("skillMenu");
const SKILL_TOGGLE_ELEMENT = document.getElementById("skillToggle");
const SKILL_TOGGLE_LABEL_ELEMENT = document.getElementById("skillToggleLabel");

function _t(key) {
  return (window.C2AI_t && window.C2AI_t(key)) || key;
}

let modalInstance = null;

let skillOptions = [];

async function loadSkills() {
  try {
    const res = await fetch('/api/skills');
    if (!res.ok) throw new Error('fetch skills failed');
    skillOptions = await res.json();

    const pageSkillSelect = document.getElementById('skill');
    if (pageSkillSelect) {
      pageSkillSelect.innerHTML = '';
      skillOptions.forEach(skill => {
        const option = document.createElement('option');
        option.value = typeof skill === 'string' ? skill : skill.value;
        option.textContent = typeof skill === 'string' ? skill : skill.label;
        pageSkillSelect.appendChild(option);
      });

      // 初始直接选中 config 里标记的默认技能（未标记则选第一个），并应用其参数
      const defaultSkill = skillOptions.find(s => s.is_default) || skillOptions[0];
      if (defaultSkill) {
        pageSkillSelect.value = typeof defaultSkill === 'string' ? defaultSkill : defaultSkill.value;
        applySkillConfig(pageSkillSelect.value);
      }
    }
  } catch (err) {
    console.error('load skills failed:', err);
    skillOptions = [];
  } finally {
    renderSkillMenu();
    syncSkillToggleUI();
  }
}

// ── 技能下拉（外观与"✦ 提示词"按钮/菜单保持一致） ──────────────
function renderSkillMenu() {
  if (!SKILL_MENU_ELEMENT) return;
  SKILL_MENU_ELEMENT.innerHTML = "";

  if (!skillOptions || skillOptions.length === 0) {
    const empty = document.createElement("div");
    empty.classList.add("prompt-empty");
    empty.textContent = "No skills";
    SKILL_MENU_ELEMENT.appendChild(empty);
    return;
  }

  skillOptions.forEach(function (skill) {
    const value = typeof skill === 'string' ? skill : skill.value;
    const label = typeof skill === 'string' ? skill : skill.label;

    const row = document.createElement("div");
    row.classList.add("prompt-item", "row", "justify-content-center");

    const btn = document.createElement("button");
    btn.classList.add("prompt-item-btn", "col-12", "text-truncate");
    btn.textContent = label;
    btn.title = label;
    btn.dataset.skillValue = value;
    btn.addEventListener("click", function () {
      selectSkill(value);
    });

    row.appendChild(btn);
    SKILL_MENU_ELEMENT.appendChild(row);
  });
}

function selectSkill(value) {
  const skillSelect = document.getElementById('skill');
  if (skillSelect) {
    skillSelect.value = value;
    // 复用原有 change 监听逻辑（会触发 applySkillConfig），保证行为与原生 select 完全一致
    skillSelect.dispatchEvent(new Event('change'));
  }
  if (SKILL_MENU_ELEMENT) SKILL_MENU_ELEMENT.classList.remove("show");
}

function syncSkillToggleUI() {
  const skillSelect = document.getElementById('skill');
  const value = skillSelect ? skillSelect.value : "";

  if (SKILL_TOGGLE_LABEL_ELEMENT) {
    if (!value) {
      const first = skillOptions.find(s => s.is_default) || skillOptions[0];
      SKILL_TOGGLE_LABEL_ELEMENT.textContent = first
        ? (typeof first === 'string' ? first : first.label)
        : 'Default';
    } else {
      const match = (skillOptions || []).find(s => (typeof s === 'string' ? s : s.value) === value);
      SKILL_TOGGLE_LABEL_ELEMENT.textContent = match ? (typeof match === 'string' ? match : match.label) : value;
    }
  }

  if (SKILL_MENU_ELEMENT) {
    SKILL_MENU_ELEMENT.querySelectorAll('.prompt-item-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.skillValue === value);
    });
  }
}

if (SKILL_TOGGLE_ELEMENT) {
  SKILL_TOGGLE_ELEMENT.addEventListener("click", function (event) {
    event.stopPropagation();
    if (PROMPT_MENU_ELEMENT) PROMPT_MENU_ELEMENT.classList.remove("show");
    SKILL_MENU_ELEMENT.classList.toggle("show");
  });
}

function createModal() {
  if (modalInstance) return modalInstance;

  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'customPromptModal';
  modalOverlay.style.cssText = `
    display: none;
    position: fixed;
    top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.5);
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(4px);
  `;

  const modalContent = document.createElement('div');
  modalContent.style.cssText = `
    background: var(--bg-elevated, #2d2d2d);
    border: 1px solid var(--border, #444);
    border-radius: var(--radius-lg, 8px);
    padding: 24px;
    min-width: 700px;
    max-width: 900px;
    color: var(--text-primary, #f0f0f0);
    box-shadow: var(--shadow, 0 4px 16px rgba(0,0,0,0.5));
  `;

  function buildModalHTML() {
    return `
      <h3 id="modalTitle" style="margin-top:0; margin-bottom:16px; font-size:16px; font-weight:600;">Edit</h3>
      <div style="margin-bottom:16px;">
        <label style="display:block; margin-bottom:4px; font-size:13px;" id="modalNameLabel">Name (optional)</label>
        <input type="text" id="modalPromptLabel" style="width:100%; padding:8px; background:var(--input-bg, #1a1a1a); border:1px solid var(--border, #444); border-radius:var(--radius-sm,4px); color:inherit; font-size:13px;">
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block; margin-bottom:4px; font-size:13px;" id="modalPromptLabel_label">Prompt</label>
        <textarea id="modalPromptText" rows="3" style="width:100%; padding:8px; background:var(--input-bg, #1a1a1a); border:1px solid var(--border, #444); border-radius:var(--radius-sm,4px); color:inherit; font-size:13px; resize:vertical;"></textarea>
      </div>
      <div style="margin-bottom:16px; border-top:1px solid var(--border, #444); padding-top:16px;">
        <div style="font-size:14px; font-weight:500; margin-bottom:12px;" id="modalParamsLabel">Parameters</div>
        <div style="display:flex; align-items:center; gap:4px;">
          <label for="modalSkill" style="font-size:13px;" id="modalSkillLabel">Skill</label>
          <select id="modalSkill" style="width:100px; padding:4px; background:var(--input-bg, #1a1a1a); border:1px solid var(--border, #444); border-radius:var(--radius-sm,4px); color:inherit; font-size:13px;">
          </select>
        </div>
        <!-- 所有参数（数量/种子/比例/画风等）都由所选技能 config.json 里的
             custom_params 动态生成，随 #modalSkill 的选择变化 -->
        <div id="modalCustomParamsRow" style="display:flex; flex-wrap:wrap; gap:12px; margin-top:12px;"></div>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button id="modalCancelBtn" style="padding:6px 12px; background:var(--bg-surface, #3d3d3d); border:1px solid var(--border, #555); border-radius:var(--radius-sm,4px); color:inherit; cursor:pointer;">Cancel</button>
        <button id="modalConfirmBtn" style="padding:6px 12px; background:var(--accent, #f6a725); border:none; border-radius:var(--radius-sm,4px); color:#000; font-weight:500; cursor:pointer;">Confirm</button>
      </div>
    `;
  }

  modalContent.innerHTML = buildModalHTML();
  modalOverlay.appendChild(modalContent);
  document.body.appendChild(modalOverlay);

  const hideModal = () => {
    modalOverlay.style.display = 'none';
  };

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) hideModal();
  });

  modalContent.querySelector('#modalCancelBtn').addEventListener('click', hideModal);

  modalInstance = {
    element: modalOverlay,
    show: (options = {}) => {
      modalContent.innerHTML = buildModalHTML();
      modalContent.querySelector('#modalCancelBtn').addEventListener('click', hideModal);

      document.getElementById('modalPromptLabel').value = options.label || '';
      document.getElementById('modalPromptText').value = options.text || '';

      const skillSelect = document.getElementById('modalSkill');
      if (skillSelect) {
        const defaultSkill = skillOptions.find(s => s.is_default) || skillOptions[0];
        const currentValue = options.skill
          || (defaultSkill ? (typeof defaultSkill === 'string' ? defaultSkill : defaultSkill.value) : '');
        skillSelect.innerHTML = '';
        skillOptions.forEach(skill => {
          const option = document.createElement('option');
          option.value = typeof skill === 'string' ? skill : skill.value;
          option.textContent = typeof skill === 'string' ? skill : skill.label;
          skillSelect.appendChild(option);
        });
        skillSelect.value = currentValue;

        // 弹窗内的参数控件随这里选的技能动态变化，全部来自该技能 config.json 的 custom_params
        applyModalSkillConfig(currentValue, options.customParams || {});
        skillSelect.addEventListener('change', function () {
          // 手动切换技能时，自定义参数回到该技能的默认值（不再套用原预设的值）
          applyModalSkillConfig(this.value, {});
        });
      }

      const confirmBtn = document.getElementById('modalConfirmBtn');
      const newConfirm = confirmBtn.cloneNode(true);
      confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);

      newConfirm.addEventListener('click', () => {
        if (options.onConfirm) {
          // 所有参数（数量/种子/比例/画风等）都来自 custom_params 动态控件，统一读取
          const customParams = collectCustomParamValues(document.getElementById('modalCustomParamsRow'));
          options.onConfirm({
            label: document.getElementById('modalPromptLabel').value.trim(),
            text: document.getElementById('modalPromptText').value.trim(),
            skill: document.getElementById('modalSkill').value.trim(),
            customParams: customParams
          });
        }
        hideModal();
      });

      modalOverlay.style.display = 'flex';
    },
    hide: hideModal
  };

  return modalInstance;
}

function truncateTextSmartly(originalText, maximumLength = 30) {
  if (originalText.length <= maximumLength) return originalText;
  const subString = originalText.substring(0, maximumLength);
  const lastSpaceIndex = subString.lastIndexOf(" ");
  if (lastSpaceIndex > 0 && lastSpaceIndex > maximumLength - 10) {
    return subString.substring(0, lastSpaceIndex) + "...";
  }
  return originalText.substring(0, maximumLength) + "...";
}

async function loadPromptsFromServer() {
  try {
    const response = await fetch("/api/prompts");
    if (!response.ok) throw new Error("load failed, status: " + response.status);
    const responseData = await response.json();

    if (Array.isArray(responseData) && responseData.length > 0 && responseData[0].category) {
      globalPromptList = [];
      responseData.forEach(categoryObject => {
        if (Array.isArray(categoryObject.groups)) {
          categoryObject.groups.forEach(groupObject => {
            if (Array.isArray(groupObject.items)) {
              globalPromptList.push(...groupObject.items);
            }
          });
        }
      });
    } else {
      globalPromptList = Array.isArray(responseData) ? responseData : [];
    }

    // 统一参数存储结构：旧版预设把参数拆成 params（数量/种子等固定参数）和
    // customParams（技能自定义参数）两个字段；现在所有参数都归入 customParams，
    // 加载时自动把旧数据合并迁移过来（params 优先，保证旧数值不丢）
    globalPromptList = globalPromptList.map(item => {
      const mergedCustomParams = { ...(item.customParams || {}), ...(item.params || {}) };
      item.customParams = mergedCustomParams;
      delete item.params;
      return item;
    });

    renderPromptMenu();
  } catch (error) {
    console.error("prompt load error:", error);
    PROMPT_MENU_ELEMENT.innerHTML = `<div class='prompt-error'>Failed to load prompts.</div>`;
  }
}

async function savePromptsToServer() {
  try {
    await fetch("/api/prompts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(globalPromptList)
    });
  } catch (error) {
    alert("Failed to save prompts: " + (error.message || JSON.stringify(error)));
  }
}

// 仅更新技能相关的图片上传UI状态，不清空任何参数
function updateImageUploadBySkill(skillName) {
  const setEnabled = async (enabled) => {
    setImageUploadEnabled(enabled);
    if (!enabled) {
      window._skillNeedImage = false;
    } else {
      // 如果技能存在，需要获取 need_image 配置
      if (skillName) {
        try {
          const res = await fetch(`/api/skill_config/${encodeURIComponent(skillName)}`);
          if (res.ok) {
            const config = await res.json();
            window._skillNeedImage = !!config.need_image;
          } else {
            window._skillNeedImage = false;
          }
        } catch (err) {
          window._skillNeedImage = false;
        }
      } else {
        window._skillNeedImage = false;
      }
    }
    if (window.updateSendButtonState) window.updateSendButtonState();
  };

  if (!skillName) {
    setImageUploadEnabled(true);
    window._skillNeedImage = false;
    if (window.updateSendButtonState) window.updateSendButtonState();
    return;
  }

  fetch(`/api/skill_config/${encodeURIComponent(skillName)}`)
    .then(res => res.ok ? res.json() : null)
    .then(config => {
      if (config) {
        const allowImage = config.allow_image !== undefined ? !!config.allow_image : true;
        setImageUploadEnabled(allowImage);
        window._skillNeedImage = !!config.need_image;
      } else {
        setImageUploadEnabled(true);
        window._skillNeedImage = false;
      }
      if (window.updateSendButtonState) window.updateSendButtonState();
    })
    .catch(err => {
      console.warn('updateImageUploadBySkill error:', err);
      setImageUploadEnabled(true);
      window._skillNeedImage = false;
      if (window.updateSendButtonState) window.updateSendButtonState();
    });
}

// prompt 与技能强绑定：只展示 skill 字段等于当前所选技能的条目
// （未绑定技能的条目 skill 为空字符串，只在"未选技能"时展示）
function getCurrentSkillValue() {
  const skillSelect = document.getElementById('skill');
  return skillSelect ? skillSelect.value : '';
}

function renderPromptMenu() {
  PROMPT_MENU_ELEMENT.innerHTML = "";

  const currentSkill = getCurrentSkillValue();
  const hasAnyForCurrentSkill = globalPromptList.some(p => (p.skill || '') === currentSkill);

  if (globalPromptList.length === 0) {
    PROMPT_MENU_ELEMENT.innerHTML = `<div class='prompt-empty'>No prompts</div>`;
  } else if (!hasAnyForCurrentSkill) {
    const empty = document.createElement("div");
    empty.classList.add("prompt-empty");
    empty.textContent = "No prompts";
    PROMPT_MENU_ELEMENT.appendChild(empty);
  }

  globalPromptList.forEach(function(promptItem, index) {
    // 只渲染归属于当前选中技能的条目；index 仍指向 globalPromptList 中的原始
    // 位置，保证下面的编辑/删除按钮改的是同一条数据
    if ((promptItem.skill || '') !== currentSkill) return;

    const promptItemContainer = document.createElement("div");
    promptItemContainer.classList.add("prompt-item", "row", "justify-content-center");

    const promptButton = document.createElement("button");
    promptButton.classList.add("prompt-item-btn", "col-10", "text-truncate");
    let truncatedText;
    if (promptItem.label) {
      truncatedText = truncateTextSmartly(promptItem.label, 30);
    } else {
      truncatedText = truncateTextSmartly(promptItem.prompt, 30);
    }
    promptButton.textContent = truncatedText;
    promptButton.title = promptItem.prompt;

    promptButton.addEventListener("click", function() {
      const userInputElement = document.getElementById("userInput");
      if (userInputElement) {
        userInputElement.value = promptItem.prompt;
        userInputElement.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // 所有参数都保存在 customParams 里，先切技能（applySkillConfig 会按当前技能
      // custom_params 重建控件并套用默认值），再把预设保存的参数值覆盖上去
      if (document.getElementById('skill')) document.getElementById('skill').value = promptItem.skill || '';
      if (document.getElementById('tupianbx')) document.getElementById('tupianbx').value = promptItem.tupianbx || '';

      // 处理技能相关 UI（图片上传权限等），但不要清空参数
      if (promptItem.skill) {
        applySkillConfig(promptItem.skill).then(function () {
          applyCustomParamValuesToMainPage(promptItem.customParams);
        });
      } else {
        // 无技能：只更新图片上传状态，不清空任何参数
        updateImageUploadBySkill(null);
        renderCustomParams(null);
        // 同时确保 allow_image 逻辑（如果 promptItem 显式禁止图片上传）
        if (promptItem.allow_image === false) {
          setImageUploadEnabled(false);
        } else {
          setImageUploadEnabled(true);
        }
      }

      PROMPT_MENU_ELEMENT.classList.remove("show");
      userInputElement.focus();
    });

    if (promptItem.mozi) {
      promptItemContainer.appendChild(promptButton);
      PROMPT_MENU_ELEMENT.appendChild(promptItemContainer);
      return;
    }

    const editButton = document.createElement("button");
    editButton.classList.add("prompt-edit-btn", "col-1");
    editButton.textContent = "∕";
    editButton.title = "Edit prompt";

    editButton.addEventListener("click", function(event) {
      event.stopPropagation();
      const modal = createModal();
      modal.show({
        label: promptItem.label || '',
        text: promptItem.prompt,
        skill: promptItem.skill || '',
        customParams: promptItem.customParams || {},
        onConfirm: (data) => {
          globalPromptList[index] = {
            ...promptItem,
            label: data.label || undefined,
            prompt: data.text,
            skill: data.skill || undefined,
            duotuhecheng: undefined,
            customParams: data.customParams
          };
          savePromptsToServer();
          renderPromptMenu();

          const userInputElement = document.getElementById("userInput");
          if (userInputElement) {
            userInputElement.value = data.text;
            userInputElement.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (document.getElementById('skill')) document.getElementById('skill').value = data.skill || '';

          // 处理技能相关 UI（所有参数都通过 customParams 回填）
          if (data.skill) {
            applySkillConfig(data.skill).then(function () {
              applyCustomParamValuesToMainPage(data.customParams);
            });
          } else {
            updateImageUploadBySkill(null);
            setImageUploadEnabled(true);
            renderCustomParams(null);
          }
        }
      });
    });

    const deleteButton = document.createElement("button");
    deleteButton.classList.add("prompt-del-btn", "col-1");
    deleteButton.textContent = "×";
    deleteButton.title = "Delete prompt";

    deleteButton.addEventListener("click", function(event) {
      event.stopPropagation();
      const name = promptItem.label || promptItem.prompt;
      const confirmMsg = "Delete this prompt?\n" + name;
      const confirmDelete = confirm(confirmMsg);
      if (!confirmDelete) return;
      globalPromptList.splice(index, 1);
      savePromptsToServer();
      renderPromptMenu();
    });

    promptItemContainer.appendChild(promptButton);
    promptItemContainer.appendChild(editButton);
    promptItemContainer.appendChild(deleteButton);
    PROMPT_MENU_ELEMENT.appendChild(promptItemContainer);
  });

  const addButton = document.createElement("button");
  addButton.classList.add("prompt-add-btn");
  addButton.innerHTML = "＋ Add Prompt";

  addButton.addEventListener("click", function() {
    const modal = createModal();
    modal.show({
      label: '',
      text: '',
      skill: getCurrentSkillValue(),
      customParams: {},
      onConfirm: (data) => {
        if (!data.text) {
          alert("Prompt cannot be empty.");
          return;
        }
        globalPromptList.push({
          label: data.label || undefined,
          prompt: data.text,
          skill: data.skill || undefined,
          customParams: data.customParams
        });
        savePromptsToServer();
        renderPromptMenu();

        const userInputElement = document.getElementById("userInput");
        if (userInputElement) {
          userInputElement.value = data.text;
          userInputElement.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (document.getElementById('skill')) document.getElementById('skill').value = data.skill || '';

        // 处理技能相关 UI（所有参数都通过 customParams 回填）
        if (data.skill) {
          applySkillConfig(data.skill).then(function () {
            applyCustomParamValuesToMainPage(data.customParams);
          });
        } else {
          updateImageUploadBySkill(null);
          setImageUploadEnabled(true);
          renderCustomParams(null);
        }
      }
    });
  });

  PROMPT_MENU_ELEMENT.appendChild(addButton);
}

if (PROMPT_TOGGLE_ELEMENT) {
  PROMPT_TOGGLE_ELEMENT.addEventListener("click", function(event) {
    event.stopPropagation();
    if (SKILL_MENU_ELEMENT) SKILL_MENU_ELEMENT.classList.remove("show");
    renderPromptMenu(); // 保证展示的是当前所选技能下的最新提示词列表
    PROMPT_MENU_ELEMENT.classList.toggle("show");
  });
}

// 通用的"点击外部关闭"逻辑：同时适用于"提示词"菜单和"技能"菜单
document.addEventListener("click", function(event) {
  document.querySelectorAll(".prompt-menu.show").forEach(function (menu) {
    const dropdown = menu.closest(".prompt-dropdown");
    if (!dropdown || !dropdown.contains(event.target)) {
      menu.classList.remove("show");
    }
  });
});

window.clearSelectedPrompt = function() {
  const userInput = document.getElementById("userInput");
  if (userInput) {
    userInput.value = "";
    userInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (document.getElementById('skill')) document.getElementById('skill').value = '';

  setImageUploadEnabled(true);
  applySkillConfig('');
  renderPromptMenu();
  if (document.getElementById('tupianbx')) document.getElementById('tupianbx').value = '';
};

document.addEventListener("DOMContentLoaded", function() {
  const clearBtn = document.getElementById("clearPromptBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      window.clearSelectedPrompt();
    });
  }
});

loadPromptsFromServer();
loadSkills();

// ── 参数控件：技能自己在 config.json 里定义 custom_params 数组 ──
// 每一项形如：
//   { "key": "negative_prompt", "label": "反向提示词", "type": "text",
//     "default": "", "placeholder": "不希望出现的内容", "width": 160 }
//   { "key": "art_style", "label": "画风", "type": "select", "default": "realistic",
//     "options": [{"value":"realistic","label":"写实"}, {"value":"anime","label":"二次元"}] }
//   { "key": "remove_watermark", "label": "去水印", "type": "checkbox", "default": false }
// key / label / type 完全自由，不局限于内置的那几个参数。
// 支持的 type：text（默认）、number、select、checkbox、textarea。
const CUSTOM_PARAMS_CONTAINER = document.getElementById('customParamsRow');

function buildCustomParamControl(def, idPrefix) {
    if (!def || !def.key) return null;
    idPrefix = idPrefix || 'custom_param__';
    const key   = def.key;
    const label = def.label !== undefined ? def.label : key;
    const type  = def.type || 'text';
    const elId  = idPrefix + key;

    const wrapper = document.createElement('span');
    wrapper.className = 'param-item custom-param-item';
    // 注意：data-custom-key 只放在下面真正的 input/select 上，wrapper 本身不放——
    // 否则 querySelector('[data-custom-key="..."]') 会先匹配到这层 wrapper（一个
    // <span>，没有 .value），导致读值/写值全部失效；querySelectorAll 也会因为
    // wrapper+input 都命中而把同一个参数提交两次。

    if (label) {
        const labelEl = document.createElement('label');
        labelEl.setAttribute('for', elId);
        labelEl.className = 'yinyong';
        labelEl.style.cssText = '';
        labelEl.textContent = label;
        if (def.title) labelEl.title = def.title;
        wrapper.appendChild(labelEl);
    }

    let inputEl;
    if (type === 'select') {
        inputEl = document.createElement('select');
        inputEl.style.cssText = 'width:' + (def.width || 90) + 'px; ';
        (def.options || []).forEach(function (opt) {
            const optionEl = document.createElement('option');
            optionEl.value = typeof opt === 'string' ? opt : opt.value;
            optionEl.textContent = typeof opt === 'string' ? opt : (opt.label || opt.value);
            inputEl.appendChild(optionEl);
        });
        if (def.default !== undefined) inputEl.value = def.default;
    } else if (type === 'checkbox') {
        inputEl = document.createElement('input');
        inputEl.type = 'checkbox';
        inputEl.checked = !!def.default;
        inputEl.style.cssText = 'width:16px; height:16px; vertical-align:middle; margin-left:0px;';
    } else if (type === 'textarea') {
        inputEl = document.createElement('textarea');
        inputEl.rows = def.rows || 2;
        inputEl.value = def.default !== undefined ? def.default : '';
        inputEl.style.cssText = 'width:' + (def.width || 160) + 'px;';
    } else {
        // text / number 等原生 input 类型都走这里
        inputEl = document.createElement('input');
        inputEl.type = (type === 'number') ? 'number' : 'text';
        inputEl.value = (def.default !== undefined && def.default !== null) ? def.default : '';
        inputEl.style.cssText = 'width:' + (def.width || 80) + 'px;';
        if (def.maxlength !== undefined) inputEl.maxLength = def.maxlength;
        if (def.step !== undefined) inputEl.step = def.step;
        if (def.min !== undefined) inputEl.min = def.min;
        if (def.max !== undefined) inputEl.max = def.max;
    }

    inputEl.id = elId;
    inputEl.dataset.customKey = key;
    inputEl.dataset.customType = type;
    if (def.placeholder) inputEl.placeholder = def.placeholder;
    if (def.title) inputEl.title = def.title;

    wrapper.appendChild(inputEl);
    return wrapper;
}

function renderCustomParams(customParams) {
    if (!CUSTOM_PARAMS_CONTAINER) return;
    CUSTOM_PARAMS_CONTAINER.innerHTML = '';
    if (!Array.isArray(customParams) || customParams.length === 0) return;
    customParams.forEach(function (def) {
        const control = buildCustomParamControl(def);
        if (control) CUSTOM_PARAMS_CONTAINER.appendChild(control);
    });
}
window.renderCustomParams = renderCustomParams;

// 从某个容器里读出所有自定义参数控件的当前值，返回 { key: value } 形式的普通对象。
// 主页面 (#customParamsRow) 和"编辑提示词"弹窗 (#modalCustomParamsRow) 都会用到。
function collectCustomParamValues(containerEl) {
    const result = {};
    if (!containerEl) return result;
    containerEl.querySelectorAll('[data-custom-key]').forEach(function (el) {
        const key = el.dataset.customKey;
        result[key] = (el.dataset.customType === 'checkbox') ? el.checked : el.value;
    });
    return result;
}

// 把某个 prompt 预设保存下来的自定义参数值，套用到主页面当前已渲染出的自定义控件上
// （控件本身的"存在与否/类型"仍然由当前选中技能的 custom_params 定义决定，
// 这里只是覆盖具体的值）
function applyCustomParamValuesToMainPage(customParams) {
    if (!customParams || !CUSTOM_PARAMS_CONTAINER) return;
    Object.keys(customParams).forEach(function (key) {
        const el = CUSTOM_PARAMS_CONTAINER.querySelector('[data-custom-key="' + key + '"]');
        if (!el) return;
        if (el.dataset.customType === 'checkbox') {
            el.checked = !!customParams[key];
        } else {
            el.value = customParams[key];
        }
    });
}

// "编辑提示词" 弹窗里的参数随所选技能动态变化，
// 全部来自该技能 config.json 的 custom_params。
// presetCustomValues：正在编辑的这条预设已保存的参数值（用来回填），
// 新建或切换技能时传 {} 即可（走该技能自己的默认值）
async function applyModalSkillConfig(skillName, presetCustomValues) {
    const container = document.getElementById('modalCustomParamsRow');
    if (!container) return;

    let customParamDefs = [];

    if (skillName) {
        try {
            const res = await fetch(`/api/skill_config/${encodeURIComponent(skillName)}`);
            if (res.ok) {
                const config = await res.json();
                if (Array.isArray(config.custom_params)) {
                    customParamDefs = config.custom_params;
                }
            }
        } catch (err) {
            console.warn('modal skill config fetch failed:', err);
        }
    }

    container.innerHTML = '';
    customParamDefs.forEach(function (def) {
        const control = buildCustomParamControl(def, 'modal_custom_param__');
        if (!control) return;
        if (presetCustomValues && Object.prototype.hasOwnProperty.call(presetCustomValues, def.key)) {
            const inputEl = control.querySelector('[data-custom-key]');
            if (inputEl) {
                if (inputEl.dataset.customType === 'checkbox') {
                    inputEl.checked = !!presetCustomValues[def.key];
                } else {
                    inputEl.value = presetCustomValues[def.key];
                }
            }
        }
        container.appendChild(control);
    });
}

// 页面刚加载、还没有任何技能被选中/配置返回时，先清空参数区，
// 避免旧技能的参数控件在异步请求完成前闪现。
renderCustomParams(null);

async function applySkillConfig(skillName) {
    // 无论技能是通过原生 select、技能下拉菜单，还是提示词预设间接切换的，
    // 这里统一同步一次按钮文案 / 选中态，保证 UI 与 #skill 的值始终一致
    syncSkillToggleUI();

    if (!skillName) {
        // 注意：clearSelectedPrompt 和 skill 下拉框为空时会走到这里，此时需要清空参数（这是预期行为）
        window._skillNeedImage = false;
        if (window.updateSendButtonState) window.updateSendButtonState();
        setImageUploadEnabled(true);
        renderCustomParams(null);
        return;
    }

    try {
        const res = await fetch(`/api/skill_config/${encodeURIComponent(skillName)}`);
        if (!res.ok) return;
        const config = await res.json();

        window._skillNeedImage = !!config.need_image;
        if (window.updateSendButtonState) window.updateSendButtonState();

        const allowImage = config.allow_image !== undefined ? !!config.allow_image : true;
        setImageUploadEnabled(allowImage);

        // 所有参数（数量/种子/比例/画风等）都来自该技能 config.json 的 custom_params，
        // 控件默认值由每条参数自己的 "default" 决定，统一在这里重建
        renderCustomParams(config.custom_params);

    } catch (err) {
        console.warn('get skill config failed:', err);
    }
}

function setImageUploadEnabled(enabled) {
    // 之前这里查的是 #imageUpload，但页面里实际的上传控件 id 是 fileUpload，
    // 一直没生效；顺带修掉，并且改成真正的显隐（display:none），
    // 而不只是禁用+置灰——这样 config 里的 allow_image:false 能把整个
    // “上传文件”按钮（#chooseimg）藏起来，不只是禁用点击。
    const chooseimgContainer = document.getElementById("chooseimg");
    const fileUpload         = document.getElementById("fileUpload");
    const imagePreview       = document.getElementById("imagePreviewContainer");

    if (chooseimgContainer) chooseimgContainer.style.display = enabled ? "" : "none";
    if (fileUpload)         fileUpload.disabled = !enabled;

    if (enabled) {
        if (imagePreview) imagePreview.style.opacity = "1";
        if (imagePreview) imagePreview.style.pointerEvents = "auto";
    } else {
        if (imagePreview) imagePreview.style.opacity = "0.35";
        if (imagePreview) imagePreview.style.pointerEvents = "none";
        if (window.clearAllUploadedImages) window.clearAllUploadedImages();
    }
}

document.addEventListener("DOMContentLoaded", function () {
    const skillSelect = document.getElementById("skill");
    if (skillSelect) {
        skillSelect.addEventListener("change", function () {
            applySkillConfig(this.value);
            renderPromptMenu();
        });

        if (skillSelect.value) {
            applySkillConfig(skillSelect.value);
        }
    }
});

const _origApply = window.C2AI_applyTranslations;

document.addEventListener("DOMContentLoaded", function () {
  const patchApply = setInterval(() => {
    if (window.C2AI_applyTranslations) {
      const original = window.C2AI_applyTranslations;
      window.C2AI_applyTranslations = function () {
        original();
        renderPromptMenu();
        modalInstance = null;
      };
      clearInterval(patchApply);
    }
  }, 100);
});
