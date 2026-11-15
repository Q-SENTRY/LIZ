/* Utilidades de interfaz compartidas por todos los editores */
const UI = (() => {
  const $ = (s, r = document) => r.querySelector(s);

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) e.append(c);
    return e;
  }

  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  function loading(on, msg = 'Cargando…') {
    const l = $('#loading');
    l.querySelector('span').textContent = msg;
    l.hidden = !on;
  }

  /**
   * Muestra un diálogo. buttons: [{label, value, primary, danger}]
   * body: Node o string. Devuelve una promesa con el value del botón (o null).
   */
  function modal(title, body, buttons = [{ label: 'Aceptar', value: true, primary: true }]) {
    return new Promise(resolve => {
      const m = $('#modal');
      $('#modalTitle').textContent = title;
      const b = $('#modalBody');
      b.innerHTML = '';
      if (typeof body === 'string') b.append(el('p', {}, body)); else if (body) b.append(body);
      const a = $('#modalActions');
      a.innerHTML = '';
      const close = v => { m.hidden = true; m.onclick = null; resolve(v); };
      for (const btn of buttons) {
        a.append(el('button', {
          class: 'btn' + (btn.primary ? ' primary' : '') + (btn.danger ? ' danger' : ''),
          onclick: () => close(typeof btn.value === 'function' ? btn.value() : btn.value)
        }, btn.label));
      }
      m.onclick = e => { if (e.target === m) close(null); };
      m.hidden = false;
      const first = b.querySelector('textarea, input, select');
      if (first) setTimeout(() => first.focus(), 50);
    });
  }

  async function prompt(title, value = '', { multiline = false, label = '' } = {}) {
    const input = multiline ? el('textarea') : el('input', { type: 'text' });
    input.value = value;
    const body = el('div', {}, label ? el('label', {}, label) : null, input);
    if (!multiline) input.addEventListener('keydown', e => { if (e.key === 'Enter') $('#modalActions .primary').click(); });
    const r = await modal(title, body, [
      { label: 'Cancelar', value: null },
      { label: 'Aceptar', value: () => input.value, primary: true }
    ]);
    return r;
  }

  function confirm(title, msg, okLabel = 'Aceptar', danger = false) {
    return modal(title, msg, [
      { label: 'Cancelar', value: false },
      { label: okLabel, value: true, primary: !danger, danger }
    ]);
  }

  /** Lista de opciones; devuelve el value elegido o null */
  function choose(title, options) {
    const list = el('div', { class: 'choice-list' });
    return new Promise(resolve => {
      for (const o of options) {
        list.append(el('button', { class: 'btn', onclick: () => { $('#modal').hidden = true; resolve(o.value); } }, o.label));
      }
      modal(title, list, [{ label: 'Cancelar', value: null }]).then(v => resolve(v));
    });
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function share(blob, name) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return true; }
      catch (e) { if (e.name === 'AbortError') return true; }
    }
    download(blob, name);
    toast('Tu dispositivo no permite compartir; se descargó el archivo.');
    return false;
  }

  const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  function readFile(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsArrayBuffer(file);
    });
  }

  /* ---------- Recientes (IndexedDB, opcional) ---------- */
  const DB_NAME = 'liz-docs', STORE = 'recent', MAX_RECENT = 10, MAX_BYTES = 30 * 1024 * 1024;
  function db() {
    return new Promise((res, rej) => {
      try {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'name' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  }
  const recent = {
    async list() {
      try {
        const all = await tx('readonly', s => s.getAll());
        return (all || []).sort((a, b) => b.time - a.time);
      } catch { return []; }
    },
    async add(name, bytes) {
      try {
        if (bytes.byteLength > MAX_BYTES) return;
        await tx('readwrite', s => s.put({ name, bytes, size: bytes.byteLength, time: Date.now() }));
        const all = await recent.list();
        for (const old of all.slice(MAX_RECENT)) await recent.remove(old.name);
      } catch { /* almacenamiento no disponible */ }
    },
    async remove(name) { try { await tx('readwrite', s => s.delete(name)); } catch {} }
  };

  return { $, el, toast, loading, modal, prompt, confirm, choose, download, share, xmlEsc, readFile, recent };
})();
