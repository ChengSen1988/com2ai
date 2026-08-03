(function () {
  const LOCAL_STORAGE_KEY = "chat_history_v2";
  const MAXIMUM_HISTORY_COUNT = 50;
  let currentConversationId = null;
  let allConversations = [];


  // ===================== 从服务器加载索引 =====================
  async function loadChatHistoryFromServer() {
    try {
      const res = await fetch("/api/history");
      const data = await res.json();

      if (!Array.isArray(data)) {
        console.warn("⚠️ invalid server data format, skipping load");
        return;
      }

      allConversations = data;

      let changed = false;
      allConversations.forEach(conv => {
        if (conv.processing === true) {
          conv.processing = false;
          changed = true;
        }
      });
      if (changed) {
        await saveChatHistoryToServer();
      }

      if (allConversations.length > 0) {
        currentConversationId = allConversations[0].id;
        await loadConversation(currentConversationId);  // 注意加 await
      } else {
        createNewConversation(true);
      }

      renderConversationList();
    } catch (err) {
      console.error("❌ failed to load chat history:", err);
    }
  }

  // ===================== 保存到服务器（索引 + 详情，仅用于全量同步场景，如删除对话） =====================
  async function saveChatHistoryToServer() {
    if (!Array.isArray(allConversations) || allConversations.length === 0) {
      console.warn("⚠️ allConversations is empty, skipping save");
      return;
    }
    try {
      await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(allConversations)
      });
    } catch (err) {
      console.warn("⚠️ failed to save chat history:", err);
    }
  }

  // ===================== 串行保存队列 =====================
  // 同一个对话的多次保存请求严格按顺序发出，避免并发请求乱序到达服务器，
  // 导致旧的（可能不含最新 messages 的）请求在新请求之后落盘，造成数据覆盖丢失。
  let _saveQueue = Promise.resolve();
  function _enqueueSave(taskFn) {
    _saveQueue = _saveQueue.then(taskFn).catch(err => {
      console.warn("⚠️ save task failed:", err);
    });
    return _saveQueue;
  }

  // ===================== 保存单个对话详情（不影响其它对话） =====================
  function saveConversationToServer(conversationId) {
    return _enqueueSave(async () => {
      const conv = allConversations.find(c => c.id === conversationId);
      if (!conv) return;
      try {
        await fetch(`/api/conv/${conversationId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(conv)
        });
      } catch (err) {
        console.warn("⚠️ failed to save conversation:", err);
      }
    });
  }

  // ===================== 仅同步 processing 状态（不涉及消息内容） =====================
  function saveProcessingToServer(conversationId, isProcessing) {
    return _enqueueSave(async () => {
      try {
        await fetch(`/api/conv/${conversationId}/processing`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ processing: isProcessing })
        });
      } catch (err) {
        console.warn("⚠️ failed to save processing state:", err);
      }
    });
  }

  // ===================== 删除对话（含物理文件） =====================
  async function deleteConversationWithAssets(conversationId) {
    // 先从内存中移除
    allConversations = allConversations.filter(c => c.id !== conversationId);
    await saveChatHistoryToServer();

    // 删除物理文件夹
    try {
      await fetch(`/api/conv/${conversationId}/assets`, { method: "DELETE" });
    } catch (err) {
      console.warn("⚠️ failed to delete image folder:", err);
    }

    // 如果删除的是当前对话，清空聊天区，然后加载第一个或新建
    if (conversationId === currentConversationId) {
      const chatContainer = document.getElementById("chatContainer");
      if (chatContainer) chatContainer.innerHTML = "";

      if (allConversations.length > 0) {
        await loadConversation(allConversations[0].id);
      } else {
        createNewConversation(true);
      }
    }

    renderConversationList();
  }

  // ===================== 工具函数 =====================
  function generateMessageId() {
    return "m_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  }

  function getCurrentConversation() {
    if (!currentConversationId) return createNewConversation(true);
    let conv = allConversations.find(c => c.id === currentConversationId);
    if (!conv) {
      conv = createNewConversation(true);
    }
    // 确保 messages 存在
    if (!conv.messages) conv.messages = [];
    return conv;
  }

  // ===================== 新建对话 =====================
  function createNewConversation(autoLoad = false) {
    const newConversation = {
      id: Date.now().toString() + "_" + Math.random().toString(36).slice(2, 6),
      title: "New Chat",
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    allConversations.unshift(newConversation);
    currentConversationId = newConversation.id;
    saveChatHistoryToServer();
    renderConversationList();

    if (autoLoad) loadConversation(newConversation.id);

    return newConversation;
  }

  // ===================== 添加消息 =====================
  function addMessageById(conversationId, role, text, images, render = true, docs = []) {
    const conversation = allConversations.find(c => c.id === conversationId);
    if (!conversation) return null;

    // 确保 messages 存在
    if (!conversation.messages) conversation.messages = [];

    const messageId = generateMessageId();
    const messageObject = {
      id: messageId,
      role: role,
      text: text,
      images: images || [],
      docs: docs || [],
      timestamp: new Date().toISOString()
    };

    conversation.messages.push(messageObject);
    conversation.updatedAt = new Date().toISOString();

    if (role === "user") {
      const isDefaultTitle = !conversation.title
        || conversation.title === "New Chat"
        || conversation.title.trim() === "";
      if (isDefaultTitle) {
        if (text && text.trim() !== "") {
          conversation.title = text.substring(0, 20);
        } else if (images && images.length > 0) {
          conversation.title = "Chat with images";
        } else {
          conversation.title = "Untitled Chat";
        }
      }
    }

    saveConversationToServer(conversationId);
    renderConversationList();

if (render && conversationId === currentConversationId && window.displayMessage) {
  window.displayMessage(text, images || [], role === "user", messageId, docs || []);
}
    return messageId;
  }

  function updateMessageById(conversationId, messageId, newRole, newText, newImages) {
    const conversation = allConversations.find(c => c.id === conversationId);
    if (!conversation) return false;

    const idx = conversation.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return false;

    const msg = conversation.messages[idx];
    msg.role = newRole !== undefined ? newRole : msg.role;
    msg.text = newText !== undefined ? newText : msg.text;
    msg.images = newImages !== undefined ? newImages : msg.images;
    msg.timestamp = new Date().toISOString();

    conversation.updatedAt = new Date().toISOString();

    saveConversationToServer(conversationId);

    if (conversationId === currentConversationId) {
      const msgElement = document.querySelector(`[data-message-id="${messageId}"]`);
      if (msgElement) {
        const textDiv = msgElement.querySelector('div:first-child');
        if (textDiv && newText !== undefined) {
          if (msg.role !== 'user' && window.renderMarkdownSafe) {
            const safeContent = window.renderMarkdownSafe(newText);
            textDiv.innerHTML = '';
            Array.from(safeContent.childNodes).forEach((n) => textDiv.appendChild(n));
          } else {
            textDiv.textContent = newText;
          }
        }
      } else {
        loadConversation(conversationId);
      }
    } else {
      renderConversationList();
    }

    return true;
  }

  function appendMessageImages(conversationId, messageId, newImages) {
    const conversation = allConversations.find(c => c.id === conversationId);
    if (!conversation) return false;

    const msg = conversation.messages.find(m => m.id === messageId);
    if (!msg) return false;

    if (!Array.isArray(msg.images)) msg.images = [];
    msg.images.push(...newImages);
    conversation.updatedAt = new Date().toISOString();

    saveConversationToServer(conversationId);

    if (conversationId === currentConversationId) {
      const msgElement = document.querySelector(`[data-message-id="${messageId}"]`);
      if (msgElement) {
        let imgBox = msgElement.querySelector('.message-images');
        if (!imgBox) {
          imgBox = document.createElement('div');
          imgBox.classList.add('message-images');
          msgElement.appendChild(imgBox);
        }
        newImages.forEach(src => {
          const imgBoxx = document.createElement('div');
          imgBoxx.classList.add('message-imagex');

          const yinyong = document.createElement('div');
          yinyong.innerText = "Quote";
          yinyong.classList.add('yinyong');
          yinyong.addEventListener('click', () => {
            if (window.addImagePreviewFromBase64) {
              window.addImagePreviewFromBase64(src);
            } else {
              console.warn('addImagePreviewFromBase64 not available');
            }
            if (window.updateSendButtonState) window.updateSendButtonState();
          });

          const img = document.createElement('img');
          img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
          img.classList.add('message-image');
          img.addEventListener('click', () => window.open(src, '_blank'));

          if (window.setThumbnailOnImage) {
            window.setThumbnailOnImage(img, src);
          } else {
            img.src = src;
          }

          imgBoxx.appendChild(img);
          imgBoxx.appendChild(yinyong);
          imgBox.appendChild(imgBoxx);
        });
      } else {
        loadConversation(conversationId);
      }
    }
    return true;
  }

  function appendMessageFolderPath(conversationId, messageId, folderPath) {
    const conversation = allConversations.find(c => c.id === conversationId);
    if (!conversation) return false;
    const msg = conversation.messages.find(m => m.id === messageId);
    if (!msg) return false;
    msg.folderPath = folderPath; // 关键修复：写回消息对象，否则只更新了 DOM，
                                   // 保存到服务端的数据里始终没有这个字段，
                                   // 刷新页面后 chat.js 的 displayMessage() 读不到 msg.folderPath，
                                   // 文件夹链接就不会再显示
    saveConversationToServer(conversationId);

    if (conversationId === currentConversationId) {
      const msgElement = document.querySelector(`[data-message-id="${messageId}"]`);
      if (msgElement && !msgElement.querySelector('.folder-link')) {
        const folderLink = document.createElement('div');
        folderLink.className = 'folder-link';

        const link = document.createElement('a');
        link.href = '#';

        const pathtext = typeof truncateTextSmartly === 'function'
            ? truncateTextSmartly(folderPath, 30)
            : folderPath;

        link.textContent = pathtext;
        link.addEventListener('click', (e) => {
          e.preventDefault();
          window.openFolder(folderPath);
        });

        folderLink.appendChild(document.createTextNode('📁 '));
        folderLink.appendChild(link);
        msgElement.appendChild(folderLink);
      }
    }
    return true;
  }

  // ===================== 渲染侧边栏列表 =====================
  function renderConversationList() {
    const historyListElement = document.getElementById("history-list");
    if (!historyListElement) return;
    historyListElement.innerHTML = "";

    allConversations.forEach(function (conversation) {
      const itemElement = document.createElement("div");
      itemElement.className = "history-item";

      if (conversation.id === currentConversationId) {
        itemElement.classList.add("active");
        itemElement.style.borderLeft = "3px solid #416afe";
      }

      const titleElement = document.createElement("div");
      titleElement.textContent = conversation.title || "Untitled Chat";
      if (conversation.processing) {
        titleElement.style.color = "#000000";
        titleElement.style.opacity = "1";
      }

      const timeElement = document.createElement("small");
      timeElement.textContent = new Date(conversation.updatedAt).toLocaleString();

      const deleteButton = document.createElement("button");
      deleteButton.className = "history-del-btn";

      if (conversation.processing) {
        deleteButton.textContent = "︱";
        deleteButton.style.color = "#000000";
        deleteButton.disabled = true;
        deleteButton.style.animation = "spin 1s linear infinite";
      } else {
        deleteButton.textContent = "×";
        deleteButton.disabled = false;
      }

      deleteButton.onclick = function (event) {
        event.stopPropagation();
        if (conversation.processing) return;
        deleteConversationWithAssets(conversation.id);
      };

      itemElement.addEventListener("click", function () {
        loadConversation(conversation.id);
      });

      itemElement.appendChild(titleElement);
      itemElement.appendChild(timeElement);
      itemElement.appendChild(deleteButton);
      historyListElement.appendChild(itemElement);
    });
  }

  function setConversationProcessing(conversationId, isProcessing) {
    const conv = allConversations.find(c => c.id === conversationId);
    if (conv) {
      conv.processing = isProcessing;
      saveProcessingToServer(conversationId, isProcessing);
      renderConversationList();
    }
  }

  // ===================== 核心：加载对话详情 =====================
  async function loadConversation(conversationId) {
    currentConversationId = conversationId;
    let conversation = allConversations.find(c => c.id === conversationId);
    if (!conversation) {
      console.warn("Conversation not found:", conversationId);
      return;
    }

    // 如果 messages 未定义或为空（可能只加载了索引），从服务器拉取详情
    if (!conversation.messages || conversation.messages.length === 0) {
      try {
        const res = await fetch(`/api/conv/${conversationId}/messages`);
        if (!res.ok) throw new Error("Failed to load messages");
        const detail = await res.json();
        // 合并详情（包括 messages, archives 等）
        conversation.messages = detail.messages || [];
        conversation.archives = detail.archives || [];
        if (detail.title) conversation.title = detail.title;
        if (detail.updatedAt) conversation.updatedAt = detail.updatedAt;
        // 如果 messages 仍为空，留空数组
      } catch (err) {
        console.error("Failed to load conversation detail:", err);
        // 若加载失败，确保 messages 为空数组，避免后续 forEach 报错
        conversation.messages = [];
        // 显示错误提示
        const chatContainer = document.getElementById("chatContainer");
        if (chatContainer) {
          chatContainer.innerHTML = `<div class="message ai-message">⚠️ Failed to load conversation. Please refresh and try again.</div>`;
        }
        renderConversationList();
        return;
      }
    }

    // 渲染消息
    const chatContainer = document.getElementById("chatContainer");
    if (!chatContainer) return;
    chatContainer.innerHTML = "";

    if (conversation.messages && conversation.messages.length > 0) {
      conversation.messages.forEach(function (msg) {
        if (window.displayMessage) {
  window.displayMessage(msg.text, msg.images || [], msg.role === "user", msg.id, msg.docs || []);
        }
      });
    } else {
      // 空对话显示欢迎消息
      const welcome = document.createElement("div");
      welcome.className = "message ai-message";
      welcome.textContent = "Start a new conversation!";
      chatContainer.appendChild(welcome);
    }

    // 滚动到底部
    const chatright = document.getElementById("right");
    if (chatright) {
      requestAnimationFrame(() => {
        chatright.scrollTop = chatright.scrollHeight;
      });
    }

    renderConversationList();
  }

  // ===================== 初始化 =====================
  let _initialized = false;

  function initializeChatHistorySystem() {
    if (_initialized) return;
    _initialized = true;
    loadChatHistoryFromServer();
    renderConversationList();

    const newChatButton = document.getElementById("newChatBtn");
    if (newChatButton) {
      newChatButton.onclick = function () {
        const newConv = createNewConversation(true);
        if (window.displayMessage) {
          window.displayMessage("Start a new conversation!", [], false);
        }
      };
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeChatHistorySystem);
  } else {
    initializeChatHistorySystem();
  }

  // ===================== 暴露全局 API =====================
  window.ChatHistorySystem = {
    initialize: initializeChatHistorySystem,
    getCurrentConversation,
    addMessageById,
    updateMessageById,
    create: createNewConversation,
    load: loadConversation,
    renderList: renderConversationList,
    setConversationProcessing,
    appendMessageImages,
    appendMessageFolderPath
  };

})();
