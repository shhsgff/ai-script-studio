'use strict';
/* 设置与主题：读写主进程设置、应用到界面 */
(function () {
  const U = window.U;
  let settings = null;
  let applying = false;

  const DEFAULT = {
    theme: 'dark',
    font: { family: 'Microsoft YaHei, PingFang SC, sans-serif', size: 16, lineHeight: 2, indent: 2, paragraphGap: 20 },
    wallpaper: { type: null, file: null, url: null, opacity: 1, blur: 0 },
    api: { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat', temperature: 0.8, maxTokens: 4096, systemPrompt: '', supportsVision: false },
    autosave: { enabled: true, intervalMs: 15000 }
  };

  async function load() {
    const loaded = await window.api.getSettings();
    settings = Object.assign({}, DEFAULT, loaded || {});
    settings.font = Object.assign({}, DEFAULT.font, (loaded && loaded.font) || {});
    settings.api = Object.assign({}, DEFAULT.api, (loaded && loaded.api) || {});
    settings.wallpaper = Object.assign({}, DEFAULT.wallpaper, (loaded && loaded.wallpaper) || {});
    settings.autosave = Object.assign({}, DEFAULT.autosave, (loaded && loaded.autosave) || {});
    return settings;
  }

  function get() { return settings; }

  async function patch(partial) {
    if (!settings) return null;
    Object.assign(settings, partial || {});
    const saved = await window.api.saveSettings(partial || {});
    settings = Object.assign(settings, saved || {});
    return settings;
  }

  /* ---------- 主题 ---------- */
  function applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', t);
    const btn = document.getElementById('btnQuickTheme');
    if (btn) btn.textContent = t === 'light' ? '☀️' : '🌙';
    const themeBtns = U.$$('.theme-btn');
    themeBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-theme') === t));
    if (settings) settings.theme = t;
  }

  async function setTheme(theme) {
    applyTheme(theme);
    await patch({ theme: theme });
  }

  async function toggleTheme() {
    const next = (settings && settings.theme === 'light') ? 'dark' : 'light';
    await setTheme(next);
    U.status('已切换到' + (next === 'light' ? '明亮' : '暗黑') + '主题');
  }

  /* ---------- 排版 ---------- */
  function applyFont(font) {
    const f = Object.assign({}, DEFAULT.font, font || {});
    const root = document.documentElement;
    root.style.setProperty('--editor-font', f.family);
    root.style.setProperty('--editor-size', f.size + 'px');
    root.style.setProperty('--editor-line', String(f.lineHeight));
    root.style.setProperty('--editor-gap', f.paragraphGap + 'px');
    root.style.setProperty('--editor-indent', f.indent > 0 ? f.indent + 'em' : '0');
  }

  async function updateFont(partial) {
    const next = Object.assign({}, settings.font, partial || {});
    settings.font = next;
    applyFont(next);
    await patch({ font: next });
  }

  /* ---------- 壁纸 ---------- */
  function applyWallpaper(wp) {
    const w = Object.assign({}, DEFAULT.wallpaper, wp || {});
    const imgLayer = document.getElementById('wallpaper-image');
    const vidLayer = document.getElementById('wallpaper-video');
    if (!imgLayer || !vidLayer) return;

    const shade = Number.isFinite(w.opacity) ? w.opacity : 1;
    document.documentElement.style.setProperty('--wp-shade', String(1 - shade));
    const blur = Number.isFinite(w.blur) ? w.blur : 0;

    if (!w.type || !w.url) {
      imgLayer.classList.remove('on');
      imgLayer.style.backgroundImage = 'none';
      imgLayer.style.filter = 'none';
      vidLayer.classList.remove('on');
      try { vidLayer.pause(); } catch (e) {}
      vidLayer.removeAttribute('src');
      try { vidLayer.load(); } catch (e) {}
      return;
    }

    if (w.type === 'video') {
      imgLayer.classList.remove('on');
      imgLayer.style.backgroundImage = 'none';
      vidLayer.style.filter = blur > 0 ? 'blur(' + blur + 'px)' : 'none';
      if (vidLayer.getAttribute('src') !== w.url) {
        vidLayer.setAttribute('src', w.url);
        vidLayer.load();
      }
      vidLayer.classList.add('on');
      const p = vidLayer.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      vidLayer.classList.remove('on');
      try { vidLayer.pause(); } catch (e) {}
      vidLayer.removeAttribute('src');
      imgLayer.style.backgroundImage = 'url("' + w.url.replace(/"/g, '\\"') + '")';
      imgLayer.style.filter = blur > 0 ? 'blur(' + blur + 'px)' : 'none';
      imgLayer.classList.add('on');
    }
  }

  async function setWallpaperFromPicker() {
    const res = await window.api.pickWallpaper();
    if (res && res.error) { U.toast(res.error, 'error'); return null; }
    if (!res || res.canceled) return null;
    settings.wallpaper = Object.assign({}, settings.wallpaper, res.wallpaper);
    applyWallpaper(settings.wallpaper);
    if (window.SettingsPanel) window.SettingsPanel.refresh();
    U.toast('壁纸已应用并保存', 'success');
    return res.wallpaper;
  }

  async function clearWallpaper() {
    const wp = await window.api.clearWallpaper();
    settings.wallpaper = Object.assign({}, DEFAULT.wallpaper, wp || {});
    applyWallpaper(settings.wallpaper);
    if (window.SettingsPanel) window.SettingsPanel.refresh();
    U.toast('已恢复默认背景');
  }

  async function setWallpaperEffect(partial) {
    const next = Object.assign({}, settings.wallpaper, partial || {});
    settings.wallpaper = next;
    applyWallpaper(next);
    await patch({ wallpaper: next });
  }

  function applyAll() {
    applying = true;
    applyTheme(settings.theme);
    applyFont(settings.font);
    applyWallpaper(settings.wallpaper);
    applying = false;
  }

  window.Store = {
    DEFAULT,
    load, get, patch, applyAll,
    applyTheme, setTheme, toggleTheme,
    applyFont, updateFont,
    applyWallpaper, setWallpaperFromPicker, clearWallpaper, setWallpaperEffect,
    isApplying: () => applying
  };
})();
