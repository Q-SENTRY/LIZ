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
  let activeClose = null;
  /** Cierra el diálogo abierto (si lo hay) devolviendo un valor */
  function closeModal(v = null) { if (activeClose) activeClose(v); }
  function modal(title, body, buttons = [{ label: 'Aceptar', value: true, primary: true }]) {
    return new Promise(resolve => {
      const m = $('#modal');
      $('#modalTitle').textContent = title;
      const b = $('#modalBody');
      b.innerHTML = '';
      if (typeof body === 'string') b.append(el('p', {}, body)); else if (body) b.append(body);
      const a = $('#modalActions');
      a.innerHTML = '';
      const close = v => { m.hidden = true; m.onclick = null; activeClose = null; resolve(v); };
      activeClose = close;
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
        list.append(el('button', { class: 'choice', onclick: () => { $('#modal').hidden = true; resolve(o.value); } },
          o.icon ? icon(o.icon, 18) : null, el('span', {}, o.label), icon('chevron', 16)));
      }
      modal(title, list, [{ label: 'Cancelar', value: null }]).then(v => resolve(v));
    });
  }

  /* ---------- Integración con la app Android (APK) ---------- */
  const android = typeof window.FolioAndroid !== 'undefined';
  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1] || '');
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
  }

  /** Envía un archivo a la app Android en partes de 512 KB (evita un texto gigante en memoria) */
  async function sendToAndroid(blob, name) {
    const A = window.FolioAndroid;
    if (!A.beginFile) return null;
    const id = A.beginFile(name, blob.type || 'application/octet-stream');
    if (!id) return null;
    const CH = 512 * 1024;
    for (let off = 0; off < blob.size; off += CH) {
      if (!A.appendFile(id, await blobToBase64(blob.slice(off, off + CH)))) throw new Error('No se pudo escribir el archivo');
    }
    return id;
  }

  async function download(blob, name) {
    if (android && window.FolioAndroid.beginFile) {
      const id = await sendToAndroid(blob, name);
      if (id) {
        const r = window.FolioAndroid.finishSave(id);
        if (r === 'saved') toast('Guardado en Descargas › Folio: ' + name, 3500);
        else if (r === 'error') toast('No se pudo guardar');
        return;
      }
    }
    if (android) {
      const saved = window.FolioAndroid.saveFile(name, blob.type || 'application/octet-stream', await blobToBase64(blob));
      if (saved) toast('Guardado en Descargas › Folio: ' + name, 3500);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function share(blob, name) {
    if (android && window.FolioAndroid.beginFile) { const id = await sendToAndroid(blob, name); if (id) { window.FolioAndroid.finishShare(id); return true; } }
    if (android) { window.FolioAndroid.shareFile(name, blob.type || 'application/octet-stream', await blobToBase64(blob)); return true; }
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
  const DB_NAME = 'folio-docs', STORE = 'recent', MAX_RECENT = 10, MAX_BYTES = 30 * 1024 * 1024;
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


  /* ---------- Íconos de línea (SVG, 24×24) ---------- */
  const P = d => d.split(' M').map((x, i) => `<path d="${i ? 'M' + x : x}"/>`).join('');
  const ICONS = {
    back: P('M15 18l-6-6 6-6'),
    chevron: P('M9 18l6-6-6-6'),
    share: P('M12 3v12 M8 7l4-4 4 4 M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7'),
    open: P('M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z'),
    plus: P('M12 5v14 M5 12h14'),
    minus: P('M5 12h14'),
    x: P('M6 6l12 12 M18 6L6 18'),
    lock: P('M6.5 11h11v9h-11z M8.5 11V8a3.5 3.5 0 0 1 7 0v3'),
    pointer: P('M5 3.5l13 6.5-5.5 1.8L10.5 17.5z'),
    type: P('M5 7V5h14v2 M12 5v14 M9 19h6'),
    pen: P('M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z'),
    marker: P('M4 16l8.5-8.5 4 4L8 20H4z M14.5 5.5l2-2 4 4-2 2 M13 20h7'),
    eraser: P('M7 20h12 M4.6 13.4l7.8-7.8a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L11 19H8.2l-3.6-3.6a1.4 1.4 0 0 1 0-2z'),
    undo: P('M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11'),
    redo: P('M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13'),
    fit: P('M3 12h18 M7 8l-4 4 4 4 M17 8l4 4-4 4'),
    rotate: P('M20 12a8 8 0 1 1-2.6-5.9L20 8.5 M20 3.5v5h-5'),
    restore: P('M4 12a8 8 0 1 0 2.6-5.9L4 8.5 M4 3.5v5h5'),
    trash: P('M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3'),
    rows: P('M3 5h18 M3 10h18 M3 15h9 M18 13v7 M14.5 16.5h7'),
    cols: P('M5 3v18 M10 3v18 M15 3v9 M18 14.5v7 M14.5 18h7'),
    clear: P('M21 5H9l-6 7 6 7h12z M12.5 9l6 6 M18.5 9l-6 6'),
    sigma: P('M18 7V4H6l6 8-6 8h12v-3'),
    textDown: P('M3 18l5-12 5 12 M5 14h6 M15.5 12h5.5'),
    textUp: P('M3 18l5-12 5 12 M5 14h6 M18.25 9.25v5.5 M15.5 12h5.5'),
    list: P('M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01'),
    listOl: P('M10 6h10 M10 12h10 M10 18h10 M4 4.5h1.2v4 M3.6 14.2a1.3 1.3 0 0 1 2.4.7c0 .9-2.5 2.4-2.5 3.1H6'),
    alignL: P('M4 6h16 M4 10h10 M4 14h16 M4 18h10'),
    alignC: P('M4 6h16 M7 10h10 M4 14h16 M7 18h10'),
    alignR: P('M4 6h16 M10 10h10 M4 14h16 M10 18h10'),
    image: P('M4 5h16v14H4z M4 16l5-5 4 4 2-2 5 5 M15.5 9h.01'),
    table: P('M3.5 5h17v14h-17z M3.5 10h17 M3.5 14.5h17 M9.5 5v14 M14.5 5v14'),
    link: P('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'),
    unformat: P('M4 7V5h12v2 M10 5l-3 14 M14.5 14.5l5 5 M19.5 14.5l-5 5'),
    move: P('M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3'),
    copy: P('M8.5 8.5h11v11h-11z M15.5 8.5v-4h-11v11h4'),
    play: P('M7.5 5l11 7-11 7z'),
    check: P('M5 12.5l4.5 4.5L19 7.5'),
    more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    textbox: P('M4 4h16v16H4z M8.5 9h7 M12 9v7'),
    file: P('M13.5 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8.5z M13.5 3v5.5H19'),
    download: P('M12 4v11 M7.5 10.5L12 15l4.5-4.5 M5 19h14'),
    shapes: P('M3.5 13.5h7v7h-7z M17 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M10 3.5l-4.5 7h9z'),
    square: P('M4.5 4.5h15v15h-15z'),
    circle: P('M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z'),
    arrowRight: P('M4 12h15 M13 6l6 6-6 6'),
    compress: P('M12 3v6 M9 6l3 3 3-3 M12 21v-6 M9 18l3-3 3 3 M4 12h16'),
    arrowUp: P('M12 20V5 M6 11l6-6 6 6'),
    whiteout: P('M4 7h16v10H4z M7 10.5h5 M7 13.5h8'),
    sign: P('M3 17c2.5 0 3.5-9 6-9s1 8 3.5 8 2-4 3.5-4 1.5 2 5 2 M3 21h18'),
    layers: P('M12 3.5l8.5 4.5-8.5 4.5L3.5 8z M3.5 12l8.5 4.5 8.5-4.5 M3.5 16l8.5 4.5 8.5-4.5'),
    printer: P('M7 8V3.5h10V8 M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M7 14h10v6.5H7z M17.5 11h.01'),
    pages: P('M8 3.5h9.5A1.5 1.5 0 0 1 19 5v12.5 M5 7.5A1.5 1.5 0 0 1 6.5 6H14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 14 21H6.5A1.5 1.5 0 0 1 5 19.5z'),
    filePdf: P('M13.5 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8.5z M13.5 3v5.5H19 M8.5 13.5h7 M8.5 17h4.5')
  };
  function icon(name, size = 20) {
    const span = document.createElement('span');
    span.className = 'ic';
    span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    return span;
  }
  /**
   * Página "actual" dentro de un contenedor con scroll: la que se acaba de elegir (si sigue visible),
   * la primera al inicio, la última al final y, si no, la que ocupa más pantalla.
   */
  function visiblePage(els, container, state) {
    if (!els.length) return 0;
    const cr = container.getBoundingClientRect();
    const vis = els.map(e => { const r = e.getBoundingClientRect(); const v = Math.max(0, Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top)); return { v, ratio: r.height ? v / r.height : 0 }; });
    if (state && state.target != null) {
      // mientras se desplaza hacia la página elegida, o mientras se vea bien, se mantiene
      if (state._settling || (vis[state.target] && vis[state.target].ratio > 0.5)) return state.target;
      state.target = null;
    }
    if (container.scrollTop <= 2) return 0;
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
      for (let i = els.length - 1; i >= 0; i--) if (vis[i].ratio > 0.5) return i;
    }
    let best = 0;
    vis.forEach((x, i) => { if (x.v > vis[best].v + 1) best = i; });
    return best;
  }

  /** Botón de barra de herramientas: ícono + etiqueta opcional */
  function tbBtn(iconName, title, onclick, { label = '', attrs = {} } = {}) {
    return el('button', { class: 'tb' + (label ? ' tb-l' : ''), title, 'aria-label': title, onclick, ...attrs }, icon(iconName), label ? el('span', {}, label) : null);
  }

  return { visiblePage, closeModal, android, icon, tbBtn, $, el, toast, loading, modal, prompt, confirm, choose, download, share, xmlEsc, readFile, recent };
})();
