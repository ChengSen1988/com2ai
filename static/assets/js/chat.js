const chatContainerElement = document.getElementById("chatContainer");
const userInputElement = document.getElementById("userInput");
const sendButtonElement = document.getElementById("sendButton");
const fileUploadElement = document.getElementById("fileUpload");
const imagePreviewContainerElement = document.getElementById("imagePreviewContainer");
const documentPreviewContainerElement = document.getElementById("documentPreviewContainer");
const yinyonidtgw = document.getElementById("yinyonidtgw");
const yinyonidtg = document.getElementById("yinyonidtg");
// 所有参数（数量/种子/比例/画风等）都按当前技能 config.json 的 custom_params
// 动态生成在 #customParamsRow 里，发送时统一遍历读取，不再有固定 DOM 元素
const skille = document.getElementById("skill");
const tupianbxe = document.getElementById("tupianbx");

// 配置 marked（如果已加载）
if (typeof marked !== 'undefined') {
  marked.setOptions({
    gfm: true,
    breaks: true,
    headerIds: false,
    mangle: false
  });
}



// ---------- Markdown 安全渲染 ----------
// AI 输出先经 marked 解析成 HTML，再做白名单清洗：只保留常见排版标签，
// 删除所有事件属性（onerror/onclick 等）和 javascript:/data: 危险链接，
// 防止模型被诱导输出恶意 HTML 时造成存储型 XSS。
const SAFE_MD_TAGS = new Set([
  'DIV','P','BR','HR','STRONG','EM','B','I','U','S','CODE','PRE','BLOCKQUOTE',
  'UL','OL','LI','H1','H2','H3','H4','H5','H6','A','IMG','TABLE','THEAD','TBODY',
  'TR','TH','TD','SPAN','DETAILS','SUMMARY','CONTENT','MARK','DEL','INS','SUP','SUB','SMALL'
]);

// AI 输出文本规范化：
// 1. 去掉自定义的 <content> 包裹标签，让正文按标准 Markdown 渲染成 <p> 段落。
//    （否则正文会成为带首尾换行的裸文本，在 white-space: pre-wrap 下显示成大段空白）
// 2. 统一换行符 -> trim 掉首尾空白 -> 折叠多余空行（最多保留单个空行 \n\n）。
function normalizeAiText(content) {
  if (typeof content !== 'string') return '';
  let text = content.replace(/<\/?content\s*>/gi, '');
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.trim();
  text = text.replace(/\n{3,}/g, '\n\n');
  return text;
}

function renderMarkdownSafe(content) {
  const container = document.createElement('div');
  const normalized = normalizeAiText(content);
  if (typeof marked !== 'undefined') {
    container.innerHTML = marked.parse(normalized || '');
  } else {
    container.textContent = normalized || '';
  }

  const nodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) nodes.push(walker.currentNode);

  nodes.forEach((el) => {
    const tag = el.tagName;
    if (!SAFE_MD_TAGS.has(tag)) {
      // 白名单外的元素（script/iframe/svg 等）替换为纯文本，保留可见内容
      const text = document.createTextNode(el.textContent || '');
      if (el.parentNode) el.parentNode.replaceChild(text, el);
      return;
    }
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'style') el.removeAttribute(attr.name);
    });
    if (tag === 'A' || tag === 'IMG') {
      const urlAttr = tag === 'A' ? 'href' : 'src';
      const value = (el.getAttribute(urlAttr) || '').trim().toLowerCase();
      if (/^(javascript|vbscript|data):/.test(value)) {
        el.removeAttribute(urlAttr);
        if (tag === 'IMG') el.remove();
      }
    }
  });

  // thinking 内容里连续 3 个以上的换行折叠成 2 个（最多留一个空行），
  // 避免模型输出里的多余空行把段落间距撑得过大
  container.querySelectorAll('details').forEach((details) => {
    const walker = document.createTreeWalker(details, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => {
      node.nodeValue = node.nodeValue.replace(/\n{3,}/g, '\n\n');
    });
  });

  // white-space: pre-wrap 下，块级标签之间只含换行的空白节点也会被渲染成空行，
  // 造成段落间隔过大。这里移除它们；代码块（pre/code）内的空白保留。
  const removeBlankLineNodes = (el) => {
    Array.from(el.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && /^\s*[\r\n]\s*$/.test(node.nodeValue)) {
        el.removeChild(node);
      }
    });
  };
  container.querySelectorAll('*').forEach((el) => {
    if (el.matches('pre, code')) return;
    removeBlankLineNodes(el);
  });
  removeBlankLineNodes(container);

  return container;
}
window.renderMarkdownSafe = renderMarkdownSafe;

function isErrorContent(content) {
  return /^(msgErrorPrefix|生成失败|Failed|\s*\[错误\])/.test(content || '');
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


// ---------- 消息工具函数：时间格式化 / 复制 ----------
function formatMessageTime(isoString) {
  let date;
  try {
    date = new Date(isoString);
  } catch (e) {
    date = new Date();
  }
  if (isNaN(date.getTime())) date = new Date();

  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 复制时优先取聊天数据里的最新文本（流式输出过程中内容会不断更新）
function getMessageTextById(messageId, fallbackText) {
  if (messageId && window.ChatHistorySystem) {
    const conv = window.ChatHistorySystem.getCurrentConversation();
    const msg = conv?.messages.find(m => m.id === messageId);
    if (msg && typeof msg.text === "string" && msg.text !== "") return msg.text;
  }
  return fallbackText || "";
}

function fallbackCopyToClipboard(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } catch (err) {
    console.warn("copy failed:", err);
  }
  document.body.removeChild(textarea);
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopyToClipboard(text));
  } else {
    fallbackCopyToClipboard(text);
  }
}

const COPY_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>' +
  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

const CHECK_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="20 6 9 17 4 12"></polyline></svg>';

// 折叠 AI 消息里的 thinking 内容（<details open> 去掉 open 属性）
function collapseThinkingContent(msgElement) {
  if (!msgElement) return;
  msgElement.querySelectorAll("details[open]").forEach((d) => d.removeAttribute("open"));
}


let uploadedImageList = [];
let uploadedDocumentList = [];
const MAXIMUM_IMAGE_COUNT = 9999;

let pendingRequestCount = 0;

window._skillNeedImage = false;

function isProcessing() {
  return pendingRequestCount > 0;
}

function canSendNow() {
  const hasContent = userInputElement.value.trim() !== "";
  const imageSatisfied = !window._skillNeedImage || uploadedImageList.length > 0;
  return !isProcessing() && hasContent && imageSatisfied;
}

function updateSendButtonState() {
  const allowed = canSendNow();
  sendButtonElement.disabled = !allowed;

  const icon = sendButtonElement.querySelector("i, span");
  if (!icon) return;

  if (!allowed && isProcessing()) {
    icon.textContent = "︱";
    icon.style.color = "";
    icon.style.animation = "spin 1s linear infinite";
    sendButtonElement.title = "发送中...";
  } else if (!allowed && window._skillNeedImage && uploadedImageList.length === 0) {
    icon.textContent = "➤";
    icon.style.color = "";
    icon.style.animation = "";
    sendButtonElement.title = "需要图片";
  } else if (!allowed) {
    icon.textContent = "➤";
    icon.style.color = "";
    icon.style.animation = "";
    sendButtonElement.title = "发送";
  } else {
    icon.textContent = "➤";
    icon.style.color = "";
    icon.style.animation = "";
    sendButtonElement.title = "发送";
  }
}

function addImagePreviewFromBase64(base64Data) {
  uploadedImageList.push(base64Data);

  const thumb = document.createElement("div");
  thumb.classList.add("image-thumb");

  const img = document.createElement("img");
  img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  const del = document.createElement("div");
  del.classList.add("remove-btn");
  del.textContent = "×";
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    thumb.remove();
    uploadedImageList = uploadedImageList.filter((b) => b !== base64Data);
    updateSendButtonState();
  });

  thumb.appendChild(img);
  thumb.appendChild(del);
  imagePreviewContainerElement.appendChild(thumb);
  updateSendButtonState();

  const originalImage = new Image();
  originalImage.onload = () => {
    const targetSize = 34;
    let sourceX = 0, sourceY = 0;
    let sourceWidth = originalImage.width;
    let sourceHeight = originalImage.height;

    if (originalImage.width > originalImage.height) {
      sourceWidth = originalImage.height;
      sourceX = (originalImage.width - sourceWidth) / 2;
    } else if (originalImage.height > originalImage.width) {
      sourceHeight = originalImage.width;
      sourceY = (originalImage.height - sourceHeight) / 2;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(
      originalImage,
      sourceX, sourceY, sourceWidth, sourceHeight,
      0, 0, targetSize, targetSize
    );

    const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.7);
    img.src = thumbnailDataUrl;
  };

  originalImage.onerror = () => {
    console.warn('thumbnail generation failed, using original');
    img.src = base64Data;
  };

  originalImage.src = base64Data;
}


function setThumbnailOnImage(imgElement, originalSrc, options = {}) {
  const {
    maxWidth = 180,
    maxHeight = 180,
    quality = 0.8,
    fallbackMime = 'image/jpeg',
    backgroundColor = "#ffffff"
  } = options;

  const loader = new Image();
  
  loader.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = maxWidth;
    canvas.height = maxHeight;
    const ctx = canvas.getContext('2d');

    if (backgroundColor) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, maxWidth, maxHeight);
    }

    let drawWidth = loader.width;
    let drawHeight = loader.height;
    const scale = Math.min(maxWidth / drawWidth, maxHeight / drawHeight);
    drawWidth = drawWidth * scale;
    drawHeight = drawHeight * scale;

    const offsetX = (maxWidth - drawWidth) / 2;
    const offsetY = (maxHeight - drawHeight) / 2;

    ctx.drawImage(loader, offsetX, offsetY, drawWidth, drawHeight);

    const thumbnailUrl = canvas.toDataURL(fallbackMime, quality);
    imgElement.src = thumbnailUrl;
  };

  loader.onerror = () => {
    console.warn('thumbnail generation failed, using original');
    imgElement.src = originalSrc;
  };

  loader.src = originalSrc;
}

window.clearAllUploadedImages = clearAllUploadedImages;
// dragdrop.js 需要知道当前已经选了几张图，来计算拖拽追加时还剩多少额度。
// uploadedImageList 这个变量会被多处重新赋值（push/filter/清空都是重新赋值），
// 直接把数组挂到 window 上只会同步一次、之后就是旧值；改成暴露一个函数，
// 每次调用都读到当前最新的长度
window.getUploadedImageCount = function () { return uploadedImageList.length; };

window.addImagePreviewFromBase64 = addImagePreviewFromBase64;
window.updateSendButtonState = updateSendButtonState;

function clearAllUploadedImages() {
  uploadedImageList = [];
  imagePreviewContainerElement.innerHTML = "";
  updateSendButtonState();
}

function clearAllUploadedDocuments() {
  uploadedDocumentList = [];
  if (documentPreviewContainerElement) {
    documentPreviewContainerElement.innerHTML = "";
  }
}

function addDocumentPreview(file) {
  const docItem = {
    file,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
  };
  uploadedDocumentList.push(docItem);

  const thumb = document.createElement("div");
  thumb.className = "doc-thumb";

  const icon = document.createElement("div");
  icon.textContent = "📄";
  icon.style.fontSize = "11px";

  const main = document.createElement("div");
  main.style.display = "flex";
  main.style.flexDirection = "column";
  main.style.minWidth = "0";

  const nameEl = document.createElement("div");
  nameEl.className = "doc-name";
  nameEl.textContent = file.name;

  const metaEl = document.createElement("div");
  metaEl.className = "doc-meta";
  metaEl.textContent = `${(file.size / 1024).toFixed(1)} KB`;

  main.appendChild(nameEl);
  // main.appendChild(metaEl);

  const del = document.createElement("div");
  del.className = "remove-btn";
  del.textContent = "×";
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    thumb.remove();
    uploadedDocumentList = uploadedDocumentList.filter((item) => item !== docItem);
  });

  // thumb.appendChild(icon);
  thumb.appendChild(main);
  thumb.appendChild(del);
  documentPreviewContainerElement.appendChild(thumb);
}

function convertBase64ToBlob(base64String) {
  const parts = base64String.split(",");
  const mimeType = parts[0].match(/:(.*?);/)[1];
  const byteString = atob(parts[1]);
  const arrayBuffer = new ArrayBuffer(byteString.length);
  const uint8Array = new Uint8Array(arrayBuffer);
  for (let i = 0; i < byteString.length; i++) uint8Array[i] = byteString.charCodeAt(i);
  return new Blob([uint8Array], { type: mimeType });
}

// ---------- 修改 displayMessage 以支持 Markdown ----------
function displayMessage(content, images, isUserMessage, messageId, docs) {
  const el = document.createElement("div");
  el.classList.add("message", isUserMessage ? "user-message" : "ai-message");
  if (messageId) {
    el.dataset.messageId = messageId;
  }
  if (content) {
    const text = document.createElement("div");
    if (isUserMessage) {
      text.textContent = content;
    } else {
      text.className = 'md-content';
      if (isErrorContent(content)) {
        text.textContent = content;
        text.style.whiteSpace = "pre-wrap";
      } else {
        const safeContent = renderMarkdownSafe(content);
        text.innerHTML = '';
        Array.from(safeContent.childNodes).forEach((n) => text.appendChild(n));
      }
    }
    el.appendChild(text);
  }

  // ---- 渲染图片和文档附件 ----
  const hasImages = images && images.length > 0;
  const hasDocs = docs && docs.length > 0;
  if (hasImages || hasDocs) {
    const attachmentsContainer = document.createElement("div");
    attachmentsContainer.classList.add("message-attachments"); // 可自定义类名

    // 图片
    if (hasImages) {
      const imgBox = document.createElement("div");
      imgBox.classList.add("message-images");
      images.forEach((src) => {
        const imgBoxx = document.createElement("div");
        imgBoxx.classList.add("message-imagex");
        const yinyong = document.createElement("div");
        yinyong.innerText = "引用";
        yinyong.classList.add("yinyong");
        yinyong.addEventListener("click", function abc() {
          if (!uploadedImageList.includes(src)) {
            addImagePreviewFromBase64(src);
          }
          updateSendButtonState();
        });
        const img = document.createElement("img");
        img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
        img.classList.add("message-image");
        img.addEventListener("click", () => window.open(src, "_blank"));
        imgBoxx.appendChild(img);
        imgBoxx.appendChild(yinyong);
        setThumbnailOnImage(img, src);
        imgBox.appendChild(imgBoxx);
      });
      attachmentsContainer.appendChild(imgBox);
    }

    // 文档
    if (hasDocs) {
      const docBox = document.createElement("div");
      docBox.classList.add("message-docs");
      docs.forEach((docPath) => {
        // 从路径中提取文件名
        const fileName = docPath.split('/').pop() || docPath;
        const docItem = document.createElement("div");
        docItem.className = "message-doc-item";
        // 可以根据扩展名选择图标
        const ext = fileName.split('.').pop().toLowerCase();
        let icon = '📄';
        if (['pdf'].includes(ext)) icon = '📕';
        else if (['py', 'js', 'html', 'css'].includes(ext)) icon = '📜';
        else if (['jpg', 'png', 'gif'].includes(ext)) icon = '🖼️';
        else if (['doc', 'docx'].includes(ext)) icon = '📘';
        else if (['txt', 'md'].includes(ext)) icon = '📃';
        // 显示文件名
        docItem.innerHTML = `${icon} <span class="doc-filename">${fileName}</span>`;
        // 点击打开（或下载）
        docItem.style.cursor = 'pointer';
        docItem.addEventListener('click', () => {
          window.open(docPath, '_blank');
        });
        docBox.appendChild(docItem);
      });
      attachmentsContainer.appendChild(docBox);
    }

    el.appendChild(attachmentsContainer);
  }

  // 文件夹链接部分保持不变
  if (messageId) {
    const conv = window.ChatHistorySystem?.getCurrentConversation();
    const msg = conv?.messages.find(m => m.id === messageId);
    if (msg?.folderPath && !el.querySelector('.folder-link')) {
      const folderLink = document.createElement('div');
      folderLink.className = 'folder-link';
      const link = document.createElement('a');
      link.href = '#';
      const pathtext = truncateTextSmartly(msg.folderPath, 30);
      link.textContent = pathtext;
      link.addEventListener('click', (e) => {
        e.preventDefault(); 
        window.openFolder(msg.folderPath);
      });
      folderLink.appendChild(document.createTextNode('📁 '));
      folderLink.appendChild(link);
      el.appendChild(folderLink);
    }
  }

  // ---- 消息底部信息条：时间 + 复制按钮 ----
  const meta = document.createElement("div");
  meta.className = "message-meta";

  let timestamp = new Date().toISOString();
  if (messageId && window.ChatHistorySystem) {
    const conv = window.ChatHistorySystem.getCurrentConversation();
    const msg = conv?.messages.find(m => m.id === messageId);
    if (msg?.timestamp) timestamp = msg.timestamp;
  }
  const timeEl = document.createElement("span");
  timeEl.className = "message-time";
  timeEl.textContent = formatMessageTime(timestamp);

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "copy-btn";
  copyBtn.title = "复制消息内容";
  copyBtn.setAttribute("aria-label", "复制消息内容");
  copyBtn.innerHTML = COPY_ICON_SVG;
  copyBtn.addEventListener("click", () => {
    const text = getMessageTextById(messageId, content);
    copyToClipboard(text);
    copyBtn.innerHTML = CHECK_ICON_SVG;
    copyBtn.classList.add("copied");
    clearTimeout(copyBtn._resetTimer);
    copyBtn._resetTimer = setTimeout(() => {
      copyBtn.innerHTML = COPY_ICON_SVG;
      copyBtn.classList.remove("copied");
    }, 1500);
  });

  meta.appendChild(timeEl);
  meta.appendChild(copyBtn);
  el.appendChild(meta);

  chatContainerElement.appendChild(el);

  // 历史记录里已完整输出的 AI 消息，thinking 默认折叠显示
  if (!isUserMessage) {
    collapseThinkingContent(el);
  }
  chatContainerElement.scrollTop = chatContainerElement.scrollHeight;
}
window.displayMessage = displayMessage;




window.displayMessage = displayMessage;

window.openFolder = function(path) {
  fetch('/open_folder?path=' + encodeURIComponent(path))
    .then(res => res.json())
    .then(data => {
      if (!data.success) alert("打开文件夹失败" + data.error);
    })
    .catch(err => alert("打开文件夹错误"));
};

async function handleSendMessage() {
  if (!canSendNow()) return;

  if (!window.ChatHistorySystem) {
    console.error('ChatHistorySystem not loaded, please refresh');
    return;
  }

  const text = userInputElement.value.trim();
  const conversation = window.ChatHistorySystem.getCurrentConversation();
  const convId = conversation.id;
  const skill = skille.value.trim();
  const tupianbx = tupianbxe.value.trim();

  pendingRequestCount++;
  window.ChatHistorySystem.setConversationProcessing(convId, true);
  updateSendButtonState();

  let uploadedPaths = [];
  let uploadedDocPaths = [];

  if (uploadedImageList.length > 0) {
    const formData = new FormData();
    formData.append("conversationId", convId);

    uploadedImageList.forEach((item, i) => {
      if (item.startsWith("data:")) {
        formData.append("images", convertBase64ToBlob(item), `image_${i}.png`);
      } else {
        uploadedPaths.push(item);
      }
    });

    if ([...formData.keys()].some(k => k === "images")) {
      try {
        const upRes = await fetch("/upload", { method: "POST", body: formData });
        const upData = await upRes.json();
        if (upData.success) {
          uploadedPaths = uploadedPaths.concat(upData.paths || []);
        } else {
          throw new Error(upData.error || "上传失败");
        }
      } catch (e) {
        displayMessage("上传失败" + e.message, [], false);
        pendingRequestCount = 0;
        window.ChatHistorySystem.setConversationProcessing(convId, false);
        updateSendButtonState();
        return;
      }
    }
  }

  // ========== 文档上传改造：接收路径 + 存入数组 ==========
  if (uploadedDocumentList.length > 0) {
    try {
      const docFormData = new FormData();
      docFormData.append("conversationId", convId);
      uploadedDocumentList.forEach((item) => {
        docFormData.append("documents", item.file);
      });
      const docRes = await fetch("/upload_doc", { method: "POST", body: docFormData });
      const docData = await docRes.json();
      if (!docData.success) {
        throw new Error(docData.error || "上传失败");
      }

      // 收集后端返回的文档路径
      uploadedDocPaths = docData.docs; // docs 是路径字符串数组
      // 控制台打印路径，方便调试
      console.log("本次上传文档路径列表：", uploadedDocPaths);

    } catch (e) {
      displayMessage("上传失败" + e.message, [], false);
      pendingRequestCount = 0;
      window.ChatHistorySystem.setConversationProcessing(convId, false);
      updateSendButtonState();
      return;
    }
  }

  window.ChatHistorySystem.addMessageById(convId, "user", text, uploadedPaths, true, uploadedDocPaths);
  clearAllUploadedImages();
  clearAllUploadedDocuments();

  const pendingId = window.ChatHistorySystem.addMessageById(
    convId,
    "ai_pending",
    "处理中...",
    [],
    true
  );

  try {
    const fd = new FormData();
    fd.append("prompt", text);
    fd.append("conversationId", convId);
    fd.append("skill", skill);
    fd.append("tupianbx", tupianbx);
    fd.append("pendingMessageId", pendingId);

    uploadedPaths.forEach((p) => fd.append("uploadedPaths[]", p));

    // ========== 参数提交：把当前技能动态渲染出的所有自定义控件值一并提交 ==========
    // 数量/种子/比例/画风等所有参数都来自 config.json 的 custom_params，统一从这里
    // 读值提交。后端 /process 已把所有表单字段透传给 skill 的 process_i(**kwargs)。
    // 其中 numimagese 是配置里的参数 key，后端 /process 循环出图读取的字段名是
    // numimages，这里做一次字段名映射。
    document.querySelectorAll('#customParamsRow [data-custom-key]').forEach((el) => {
      const key = el.dataset.customKey;
      const type = el.dataset.customType;
      const value = (type === 'checkbox') ? (el.checked ? 'true' : 'false') : el.value;
      const wireKey = (key === 'numimagese') ? 'numimages' : key;
      fd.append(wireKey, value);
    });

    // ========== 把文档路径批量塞入 FormData 传给后端 /process ==========
    uploadedDocPaths.forEach(docPath => {
      fd.append("docPaths[]", docPath);
    });

    console.log("最终发给后端的docPaths[]：", uploadedDocPaths);

    const response = await fetch("/process", {
      method: "POST",
      body: fd
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let firstChunk = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(5);
          try {
            const data = JSON.parse(jsonStr);
            if (data.file_url) {
              if (data.folder_path) {
                window.ChatHistorySystem.appendMessageImages(convId, pendingId, [data.file_url]);
                window.ChatHistorySystem.appendMessageFolderPath(convId, pendingId, data.folder_path);
              } else {
                window.ChatHistorySystem.appendMessageImages(convId, pendingId, [data.file_url]);
              }
            } else if (data.textmsg) {
              const conversation = window.ChatHistorySystem.getCurrentConversation();
              const msg = conversation.messages.find(m => m.id === pendingId);
              const currentText = firstChunk ? "" : (msg?.text || "");
              firstChunk = false;
              const newContent = currentText + data.textmsg;

              window.ChatHistorySystem.updateMessageById(
                convId, pendingId, "ai", newContent, undefined
              );

              const msgEl = document.querySelector(`[data-message-id="${pendingId}"]`);
              if (msgEl) {
                let textDiv = msgEl.querySelector('.md-content');
                if (!textDiv) {
                  const oldDiv = msgEl.querySelector('div');
                  if (oldDiv) oldDiv.remove();
                  textDiv = document.createElement('div');
                  textDiv.className = 'md-content';
                  msgEl.prepend(textDiv);
                }
                // 错误消息保留纯文本，其他走白名单清洗后的 Markdown 渲染
                if (isErrorContent(newContent)) {
                  textDiv.textContent = newContent;
                  textDiv.style.whiteSpace = "pre-wrap";
                } else {
                  const safeContent = renderMarkdownSafe(newContent);
                  textDiv.innerHTML = '';
                  Array.from(safeContent.childNodes).forEach((n) => textDiv.appendChild(n));
                }
              }
            }
            else if (data.error) {
              const errMsg = data.error_detail
                ? `[错误] ${data.error}\n\n${data.error_detail}`
                : `[错误] ${data.error}`;
              window.ChatHistorySystem.updateMessageById(
                convId, pendingId, "ai", errMsg, undefined
              );
            } else if (data.done) {
              const doneConv = window.ChatHistorySystem.getCurrentConversation();
              const doneMsg = doneConv.messages.find(m => m.id === pendingId);
              if (doneMsg?.images && doneMsg.images.length > 0) {
                window.ChatHistorySystem.updateMessageById(convId, pendingId, "ai", "", undefined);
              }
            }
          } catch (e) {
            console.warn('SSE parse error:', e);
          }
        }
      }
    }
  } catch (err) {
    console.log(err);
    window.ChatHistorySystem.updateMessageById(convId, pendingId, "ai", _t("msgNetworkError") + err.message, []);
  } finally {
    pendingRequestCount = 0;
    window.ChatHistorySystem.setConversationProcessing(convId, false);
    updateSendButtonState();
    // AI 全部输出结束后，自动折叠 thinking 内容
    const finishedMsgEl = document.querySelector(`[data-message-id="${pendingId}"]`);
    if (finishedMsgEl) {
      collapseThinkingContent(finishedMsgEl);
    }
    const chatright = document.getElementById("right");
    requestAnimationFrame(() => {
      chatright.scrollTop = chatright.scrollHeight;
    });
  }
}

// 支持粘贴图片（Ctrl+V / Cmd+V）
userInputElement.addEventListener("paste", (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;

  const imageItems = Array.from(items).filter(item => item.type.startsWith("image/"));
  if (imageItems.length === 0) return;

  // 有图片时阻止默认粘贴行为（避免粘贴成乱码）
  e.preventDefault();

  const remaining = MAXIMUM_IMAGE_COUNT - uploadedImageList.length;
  imageItems.slice(0, remaining).forEach((item) => {
    const file = item.getAsFile();
    if (!file) return;
    const r = new FileReader();
    r.onload = () => addImagePreviewFromBase64(r.result);
    r.readAsDataURL(file);
  });
});


userInputElement.addEventListener("input", updateSendButtonState);
userInputElement.addEventListener("keypress", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSendMessage();
  }
});
sendButtonElement.addEventListener("click", handleSendMessage);
const DOCUMENT_EXTENSIONS = [".pdf", ".txt", ".md", ".markdown", ".docx", ".js", ".py", ".json", ".csv", ".log", ".html", ".htm", ".xml", ".css"];

fileUploadElement.addEventListener("change", function (event) {
  const allFiles = Array.from(event.target.files);

  const imageFiles = allFiles.filter((f) => f.type.startsWith("image/"));
  const documentFiles = allFiles.filter((f) => {
    if (f.type.startsWith("image/")) return false;
    const name = (f.name || "").toLowerCase();
    return DOCUMENT_EXTENSIONS.some((ext) => name.endsWith(ext));
  });

  // 图片：追加式，和粘贴（paste）、文档上传的行为保持一致——
  // 之前这里会先 clearAllUploadedImages() 把已选的图片清空再加新的，
  // 导致二次选择顶替掉前面选的图片；改成只在剩余额度内追加
  if (imageFiles.length > 0) {
    const remaining = MAXIMUM_IMAGE_COUNT - uploadedImageList.length;
    imageFiles.slice(0, remaining).forEach((f) => {
      const r = new FileReader();
      r.onload = () => addImagePreviewFromBase64(r.result);
      r.readAsDataURL(f);
    });
  }

  // 文档：追加式，与原 documentUpload 行为一致
  documentFiles.forEach((f) => addDocumentPreview(f));

  // 允许重复选择同一文件时也能触发 change
  event.target.value = "";
});


function init() {
  if (window.ChatHistorySystem) {
    window.ChatHistorySystem.initialize();
    userInputElement.value = "";
  } else {
    console.warn('waiting for ChatHistorySystem...');
    setTimeout(init, 50);
    return;
  }
  updateSendButtonState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
window.setThumbnailOnImage = setThumbnailOnImage;
