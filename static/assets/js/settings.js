(function () {
  'use strict';

  let i18nData    = {};
  let currentLang = 'zh-CN';
  const LANG_KEY  = 'c2a_lang';

  function t(key) {
    const pack = i18nData[currentLang] || i18nData['zh-CN'] || {};
    return pack[key] !== undefined ? pack[key] : key;
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (!val) return;
      if (val.includes('<br')) {
        el.innerHTML = val;
      } else {
        el.textContent = val;
      }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = t(key);
      if (val) el.setAttribute('placeholder', val);
    });

    const biliDefault = document.querySelector('#bili option[value="moren"]');
    if (biliDefault) biliDefault.textContent = t('ratioDefault');

    const skillNone = document.querySelector('#skill option[value=""]');
    if (skillNone) skillNone.textContent = t('skillNone');

    document.title = t('appTitle') + ' — Com2AI.com';

    const ddTitle = document.querySelector('.drag-drop-title');
    const ddSub   = document.querySelector('.drag-drop-sub');
    if (ddTitle) ddTitle.textContent = t('dragDropTitle');
    if (ddSub)   ddSub.innerHTML    = t('dragDropSub');

    const promptLoading = document.querySelector('.prompt-loading');
    if (promptLoading) promptLoading.textContent = t('promptLoading');
  }

  async function initI18n() {
    try {
      const res = await fetch('/api/i18n');
      i18nData  = await res.json();
    } catch (e) {
      console.warn('Failed to load language pack, falling back to default', e);
      i18nData = {};
    }

    // 优先级：localStorage > config.json > zh-CN
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && i18nData[saved]) {
      currentLang = saved;
    } else {
      try {
        const cfgRes = await fetch('/api/config');
        const cfg    = await cfgRes.json();
        if (cfg.language && i18nData[cfg.language]) {
          currentLang = cfg.language;
        }
      } catch (_) {}
    }

    if (!i18nData[currentLang]) {
      currentLang = Object.keys(i18nData)[0] || 'zh-CN';
    }

    // 同步侧边栏语言下拉的选中状态
    const langSelect = document.getElementById('settingsLang');
    if (langSelect && langSelect.querySelector('option[value="' + currentLang + '"]')) {
      langSelect.value = currentLang;
    }

    applyTranslations();
  }

  // ── 侧边栏语言下拉：选择即切换 ──
  const langSelect = document.getElementById('settingsLang');
  if (langSelect) {
    langSelect.addEventListener('change', async () => {
      currentLang = langSelect.value;
      localStorage.setItem(LANG_KEY, currentLang);
      applyTranslations();
      try {
        await fetch('/api/config', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ language: currentLang })
        });
      } catch (_) {}
    });
  }

  window.C2AI_t                = t;
  window.C2AI_applyTranslations = applyTranslations;

  initI18n();

})();
