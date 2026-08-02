(function () {
  const overlay    = document.getElementById('dragDropOverlay');
  const previewEl  = document.getElementById('imagePreviewContainer');
  const inputEl    = document.getElementById('fileUpload');

  // 允许的图片 MIME 类型
  const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp',
                               'image/gif', 'image/bmp', 'image/tiff',
                               'image/avif', 'image/svg+xml']);
  // 允许的文档扩展名（与 chat.js 中的 DOCUMENT_EXTENSIONS 保持一致）
  const DOC_EXTENSIONS = [".pdf", ".txt", ".md", ".markdown", ".docx", ".js", ".py", ".json", ".csv", ".log", ".html", ".htm", ".xml", ".css"];

  const MAX_COUNT  = 9999;

  let dragDepth = 0;   

  function showOverlay()  { overlay.classList.add('active'); }
  function hideOverlay()  { overlay.classList.remove('active'); }

  // 判断文件是否可接受（图片或文档）
  function isAcceptedFile(file) {
    if (IMAGE_TYPES.has(file.type)) return true;
    const name = (file.name || "").toLowerCase();
    return DOC_EXTENSIONS.some(ext => name.endsWith(ext));
  }

  async function readEntry(entry) {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file((file) => {
          // 只接受图片或文档
          resolve(isAcceptedFile(file) ? [file] : []);
        }, () => resolve([]));
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const allFiles = [];
        function readBatch() {
          reader.readEntries(async (entries) => {
            if (entries.length === 0) {
              resolve(allFiles);
            } else {
              for (const e of entries) {
                const files = await readEntry(e);
                allFiles.push(...files);
              }
              readBatch();   
            }
          }, () => resolve(allFiles));
        }
        readBatch();
      } else {
        resolve([]);
      }
    });
  }

  async function extractFilesFromDataTransfer(dt) {
    const files = [];

    if (dt.items && dt.items.length > 0) {
      const promises = [];
      for (const item of dt.items) {
        if (item.kind !== 'file') continue;
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry) {
          promises.push(readEntry(entry));
        } else {
          const f = item.getAsFile();
          if (f && isAcceptedFile(f)) files.push(f);
        }
      }
      const results = await Promise.all(promises);
      results.forEach(arr => files.push(...arr));
    } else if (dt.files && dt.files.length > 0) {
      // 降级：直接读 files（不支持文件夹展开）
      for (const f of dt.files) {
        if (isAcceptedFile(f)) files.push(f);
      }
    }

    return files;
  }

  function loadFilesToPreview(files) {
    const uploadInput = document.getElementById('fileUpload');
    if (uploadInput && uploadInput.disabled) return;
    
    const currentCount = (typeof window.getUploadedImageCount === 'function') ? window.getUploadedImageCount() : 0;
    const remaining    = MAX_COUNT - currentCount;
    if (remaining <= 0) return;

    const toLoad = Array.from(files).slice(0, remaining);
    toLoad.forEach((file) => {
      if (IMAGE_TYPES.has(file.type)) {
        // 图片：用 base64 预览
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof window.addImagePreviewFromBase64 === 'function') {
            window.addImagePreviewFromBase64(reader.result);
          }
        };
        reader.readAsDataURL(file);
      } else {
        // 文档：直接调用 addDocumentPreview
        if (typeof window.addDocumentPreview === 'function') {
          window.addDocumentPreview(file);
        } else {
          console.warn('addDocumentPreview not available');
        }
      }
    });
  }

  document.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    const uploadInput = document.getElementById('fileUpload');
    if (uploadInput && uploadInput.disabled) return;
    if (dragDepth === 1) showOverlay();
  });
  

  document.addEventListener('dragleave', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragDepth--;
    if (dragDepth === 0) hideOverlay();
  });

  document.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    const uploadInput = document.getElementById('fileUpload');
    if (uploadInput && uploadInput.disabled) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    dragDepth = 0;
    hideOverlay();

    const uploadInput = document.getElementById('fileUpload');
    if (uploadInput && uploadInput.disabled) return;

    const files = await extractFilesFromDataTransfer(e.dataTransfer);
    if (files.length > 0) loadFilesToPreview(files);
  });

  overlay.addEventListener('dragenter', (e) => e.preventDefault());
  overlay.addEventListener('dragover',  (e) => e.preventDefault());
  overlay.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth = 0;
      hideOverlay();
      extractFilesFromDataTransfer(e.dataTransfer).then(files => {
          if (files.length > 0) loadFilesToPreview(files); 
      });
  });

})();