'use strict';
/* 通用工具集 */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      }
    }
    for (const c of (children || [])) {
      if (c === null || c === undefined) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function debounce(fn, wait) {
    let timer = null;
    const wrapped = function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fn.apply(this, args); }, wait);
    };
    wrapped.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    wrapped.flush = function (...args) { if (timer) { clearTimeout(timer); timer = null; fn.apply(this, args); } };
    return wrapped;
  }

  function throttle(fn, wait) {
    let last = 0;
    let timer = null;
    return function (...args) {
      const now = Date.now();
      const remain = wait - (now - last);
      if (remain <= 0) { last = now; fn.apply(this, args); }
      else if (!timer) {
        timer = setTimeout(() => { timer = null; last = Date.now(); fn.apply(this, args); }, remain);
      }
    };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /** 中文字数：CJK 字符每个计 1，连续西文/数字串每个计 1，标点不算 */
  function countWords(text) {
    if (!text) return 0;
    const cjk = (text.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/g) || []).length;
    const latin = (text.match(/[A-Za-z0-9_\u00C0-\u024F]+(?:['’-][A-Za-z0-9_\u00C0-\u024F]+)*/g) || []).length;
    return cjk + latin;
  }

  /** 字符数（不含空白） */
  function countChars(text) {
    if (!text) return 0;
    return text.replace(/\s/g, '').length;
  }

  function formatNumber(n) {
    return (n || 0).toLocaleString('zh-CN');
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const p = (x) => String(x).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  /* ---------- Toast ---------- */
  const toastWrap = () => document.getElementById('toastWrap');
  function toast(message, type, duration) {
    const wrap = toastWrap();
    if (!wrap) return;
    const node = el('div', { class: 'toast ' + (type || ''), text: message });
    wrap.appendChild(node);
    const ttl = duration || (type === 'error' ? 5200 : 2600);
    setTimeout(() => {
      node.style.transition = 'opacity .25s, transform .25s';
      node.style.opacity = '0';
      node.style.transform = 'translateY(6px)';
      setTimeout(() => node.remove(), 260);
    }, ttl);
  }

  /* ---------- 确认框 ---------- */
  let confirmResolve = null;
  function confirmBox(opts) {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');
    const closeBtn = document.getElementById('confirmClose');
    if (!modal) return Promise.resolve(window.confirm(opts.message));

    titleEl.textContent = opts.title || '确认';
    msgEl.textContent = opts.message || '';
    okBtn.textContent = opts.okText || '确定';
    cancelBtn.textContent = opts.cancelText || '取消';
    okBtn.className = 'mini-btn ' + (opts.danger ? 'danger-btn' : 'primary');
    if (opts.danger) { okBtn.style.background = 'var(--danger)'; okBtn.style.borderColor = 'var(--danger)'; okBtn.style.color = '#fff'; }
    else { okBtn.style.background = ''; okBtn.style.borderColor = ''; okBtn.style.color = ''; }
    modal.classList.add('show');

    return new Promise((resolve) => {
      confirmResolve = resolve;
      const done = (val) => {
        modal.classList.remove('show');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        closeBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onOverlay);
        confirmResolve = null;
        resolve(val);
      };
      const onOk = () => done(true);
      const onCancel = () => done(false);
      const onOverlay = (e) => { if (e.target === modal) done(false); };
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      closeBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onOverlay);
    });
  }

  /* ---------- 提示条 ---------- */
  let statusTimer = null;
  function status(text, sticky) {
    const node = document.getElementById('statusMessage');
    if (!node) return;
    node.textContent = text || '';
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    if (text && !sticky) {
      statusTimer = setTimeout(() => { node.textContent = ''; }, 4200);
    }
  }

  /* ---------- DOM 测量 ---------- */
  function isVisible(node) {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function textOfNode(node) {
    return (node && node.textContent) ? node.textContent : '';
  }

  window.U = {
    $, $$, el, debounce, throttle, escapeHtml, uid,
    countWords, countChars, formatNumber, formatTime, formatDate, clamp,
    toast, confirmBox, status, isVisible, textOfNode
  };
})();
