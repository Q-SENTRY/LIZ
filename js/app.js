/* Controlador principal: inicio, apertura de archivos, guardado */
(() => {
  const { $, el, toast, loading, confirm, choose, download, share, readFile, recent } = UI;

  const KINDS = {
    pdf: { factory: PdfEditor, cls: 't-pdf' },
    excel: { factory: ExcelEditor, cls: 't-xls' },
    word: { factory: WordEditor, cls: 't-doc' },
    ppt: { factory: PptEditor, cls: 't-ppt' }
  };
  const TAG_CLASS = { pdf: 't-pdf', excel: 't-xls', word: 't-doc', ppt: 't-ppt', outline: 't-ppt', image: 't-pdf' };
  const kindOf = name => Importers.kindOf(name);
  const tagText = name => (Importers.extOf(name) || 'doc').slice(0, 4).toUpperCase();

  let editor = null, isDirty = false, baseName = '';

  const ctx = {
    get toolbar() { return $('#toolbar'); },
    get workspace() { return $('#workspace'); },
    dirty() { isDirty = true; }
  };

  function show(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === view));
  }

  async function openEditor(kind, data, name) {
    closeEditor();
    const k = KINDS[kind];
    $('#workspace').innerHTML = '';
    $('#toolbar').innerHTML = '';
    $('#workspace').scrollTo(0, 0);
    const badge = $('#docBadge');
    badge.className = 'tag ' + k.cls;
    badge.textContent = tagText(name);
    baseName = name.replace(/\.[^.]+$/, '');
    $('#docName').value = baseName;
    show('editor');
    history.pushState({ editor: true }, '');
    loading(true, 'Abriendo…');
    try {
      editor = k.factory.create(ctx);
      await editor.open(data, name);
      isDirty = !data;
    } catch (e) {
      console.error(e);
      loading(false);
      await UI.modal('No se pudo abrir', 'El archivo está dañado o tiene un formato no compatible.\n\n' + (e.message || e));
      closeEditor();
      show('home');
      return;
    }
    loading(false);
    mountPager();
  }

  function closeEditor() {
    if (editor) { try { editor.destroy(); } catch {} }
    editor = null;
    isDirty = false;
    unmountPager();
    $('#printRoot').innerHTML = '';
    $('#workspace').innerHTML = '';
    $('#workspace').style.overflow = '';
  }

  async function goHome() {
    if (editor && isDirty && !(await confirm('Cambios sin guardar', '¿Salir sin guardar los cambios?', 'Salir', true))) {
      history.pushState({ editor: true }, '');
      return;
    }
    closeEditor();
    show('home');
    renderRecent();
  }

  /** Abre bytes según el tipo de archivo (convierte imágenes a PDF, etc.) */
  async function openData(name, data) {
    const kind = kindOf(name);
    if (!kind) {
      const list = ['PDF', 'Word (.docx, .doc, .odt, .rtf)', 'Excel (.xlsx, .xls, .ods, .csv, .numbers)', 'PowerPoint (.pptx, .ppt, .odp)', 'imágenes', 'Markdown, HTML y archivos de texto'];
      return UI.modal('Formato no compatible', 'Folio puede abrir: ' + list.join(', ') + '.');
    }
    if (kind === 'image') {
      loading(true, 'Convirtiendo imagen…');
      let pdf;
      try { pdf = await Importers.imageToPdf(data, name); } catch (e) { loading(false); return UI.modal('No se pudo abrir', String(e.message || e)); }
      loading(false);
      await openEditor('pdf', pdf, name.replace(/\.[^.]+$/, '') + '.pdf');
      toast('La imagen se abrió como PDF: puedes anotarla y guardarla.', 3500);
      return;
    }
    await openEditor(kind === 'outline' ? 'word' : kind, data, name);
  }

  async function openFile(file) {
    loading(true, 'Leyendo archivo…');
    let data;
    try { data = await readFile(file); } finally { loading(false); }
    recent.add(file.name, data.slice(0));
    await openData(file.name, data);
  }

  /* ----- Unir PDF ----- */
  function pickFiles(accept, multiple) {
    return new Promise(res => {
      const input = el('input', { type: 'file', accept, multiple: !!multiple, hidden: true });
      document.body.append(input);
      input.addEventListener('change', () => { const f = [...input.files]; input.remove(); res(f); });
      input.click();
    });
  }
  const isPdfLike = f => ['pdf', 'image'].includes(kindOf(f.name));
  async function toPdfBytes(f) {
    const data = await readFile(f);
    return kindOf(f.name) === 'image' ? Importers.imageToPdf(data, f.name) : data;
  }
  async function appendFiles(files) {
    files = files.filter(isPdfLike);
    if (!files.length || !editor || !editor.appendPdf) return;
    loading(true, 'Uniendo…');
    let total = 0;
    try { for (const f of files) total += await editor.appendPdf(await toPdfBytes(f), f.name); }
    catch (e) { loading(false); return UI.modal('No se pudo unir', String(e.message || e)); }
    loading(false);
    toast(`Se añadieron ${total} página${total === 1 ? '' : 's'} al final`);
    if (editor.pages) editor.pages.goTo(editor.pages.count() - total);
  }
  /** Inicio › Unir PDF: elige varios PDF o imágenes, los ordena y abre el resultado */
  async function mergeFlow() {
    let files = (await pickFiles('.pdf,application/pdf,image/*', true)).filter(isPdfLike);
    if (!files.length) return;
    if (files.length > 1) {
      // permitir ordenar antes de unir
      const list = el('div', { class: 'merge-list' });
      const draw = () => {
        list.replaceChildren(...files.map((f, i) => el('div', { class: 'merge-item' },
          el('span', { class: 'tag ' + (kindOf(f.name) === 'pdf' ? 't-pdf' : 't-ppt') }, tagText(f.name)),
          el('span', { class: 'merge-name' }, f.name),
          el('button', { class: 'icon-btn', 'aria-label': 'Subir', disabled: i === 0, onclick: () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; draw(); } }, UI.icon('arrowUp', 18)),
          el('button', { class: 'icon-btn', 'aria-label': 'Quitar', onclick: () => { files.splice(i, 1); draw(); } }, UI.icon('x', 18)))));
      };
      draw();
      const ok = await UI.modal('Unir PDF', el('div', {}, el('p', {}, 'Se unirán en este orden:'), list), [{ label: 'Cancelar', value: false }, { label: 'Unir', value: true, primary: true }]);
      if (!ok || !files.length) return;
    }
    loading(true, 'Uniendo…');
    let first;
    try { first = await toPdfBytes(files[0]); } catch (e) { loading(false); return UI.modal('No se pudo abrir', String(e.message || e)); }
    loading(false);
    await openEditor('pdf', first, files.length > 1 ? 'PDF unido.pdf' : files[0].name.replace(/\.[^.]+$/, '') + '.pdf');
    if (!editor || !editor.appendPdf) return;
    if (editor.setSourceLabel) editor.setSourceLabel(0, files[0].name);
    if (files.length > 1) {
      loading(true, 'Uniendo…');
      try { for (const f of files.slice(1)) await editor.appendPdf(await toPdfBytes(f), f.name); }
      catch (e) { loading(false); return UI.modal('No se pudo unir', String(e.message || e)); }
      loading(false);
      isDirty = true;
      toast(`Se unieron ${files.length} archivos · ${editor.pages.count()} páginas. Toca «Guardar» para descargar.`, 4500);
    }
  }

  /* ----- Navegación de páginas: indicador, ir a página y miniaturas ----- */
  let pagerRaf = 0, thumbsBuilt = -1, thumbObserver = null;
  function mountPager() {
    const P = editor && editor.pages;
    $('#pager').hidden = !P;
    if (!P) return;
    $('#workspace').addEventListener('scroll', onWsScroll, { passive: true });
    window.addEventListener('resize', onWsScroll);
    updatePager();
    setTimeout(updatePager, 600);
  }
  function unmountPager() {
    $('#pager').hidden = true;
    $('#workspace').removeEventListener('scroll', onWsScroll);
    window.removeEventListener('resize', onWsScroll);
    const t = $('#thumbs'); t.hidden = true; t.innerHTML = ''; thumbsBuilt = -1;
    document.body.classList.remove('with-thumbs');
    if (thumbObserver) { thumbObserver.disconnect(); thumbObserver = null; }
  }
  function onWsScroll() { cancelAnimationFrame(pagerRaf); pagerRaf = requestAnimationFrame(updatePager); }
  function updatePager() {
    const P = editor && editor.pages;
    if (!P) return;
    const n = P.count(), cur = Math.min(n - 1, P.current());
    $('#pgNow').textContent = (P.approx ? '≈' : '') + (cur + 1);
    $('#pgTotal').textContent = n;
    $('#pager').querySelector('[data-dir="-1"]').disabled = cur <= 0;
    $('#pager').querySelector('[data-dir="1"]').disabled = cur >= n - 1;
    const wide = window.matchMedia('(min-width: 1024px)').matches;
    if (P.thumb && wide) { if (thumbsBuilt !== n) buildThumbs($('#thumbs'), P, true); }
    else if (thumbsBuilt !== -1) { $('#thumbs').hidden = true; $('#thumbs').innerHTML = ''; thumbsBuilt = -1; document.body.classList.remove('with-thumbs'); setTimeout(() => window.dispatchEvent(new Event('resize')), 0); }
    $('#thumbs').querySelectorAll('.thumb').forEach((t, i) => t.classList.toggle('on', i === cur));
    const on = $('#thumbs').querySelector('.thumb.on');
    if (on && !$('#thumbs').hidden) {
      const tr = $('#thumbs').getBoundingClientRect(), r = on.getBoundingClientRect();
      if (r.top < tr.top || r.bottom > tr.bottom) on.scrollIntoView({ block: 'nearest' });
    }
  }
  function buildThumbs(container, P, sidebar, onPick) {
    const n = P.count();
    container.innerHTML = '';
    const width = sidebar ? 132 : Math.min(150, Math.floor((Math.min(window.innerWidth, 520) - 70) / 2));
    const obs = new IntersectionObserver(entries => {
      for (const en of entries) {
        if (!en.isIntersecting || en.target._done) continue;
        en.target._done = true;
        const box = en.target.querySelector('.thumb-img');
        P.thumb(+en.target.dataset.i, width).then(node => { box.innerHTML = ''; box.append(node); }).catch(() => {});
      }
    }, { root: container, rootMargin: '300px 0px' });
    for (let i = 0; i < n; i++) {
      const t = el('button', { class: 'thumb', 'data-i': i, 'aria-label': `${P.label} ${i + 1}` },
        el('span', { class: 'thumb-img', style: { width: width + 'px' } }), el('span', { class: 'thumb-n' }, String(i + 1)));
      t.addEventListener('click', () => { P.goTo(i); if (onPick) onPick(); });
      container.append(t);
      obs.observe(t);
    }
    if (sidebar) {
      container.hidden = false;
      document.body.classList.add('with-thumbs');
      setTimeout(() => window.dispatchEvent(new Event('resize')), 0);   // reajustar páginas al nuevo ancho
      thumbsBuilt = n;
      if (thumbObserver) thumbObserver.disconnect();
      thumbObserver = obs;
    }
    return obs;
  }
  async function openPageSheet() {
    const P = editor && editor.pages;
    if (!P) return;
    const n = P.count(), cur = P.current();
    const input = el('input', { type: 'number', min: 1, max: n, value: cur + 1, inputmode: 'numeric', 'aria-label': 'Número' });
    const go = () => { const v = Math.max(1, Math.min(n, parseInt(input.value) || 1)); P.goTo(v - 1); UI.closeModal(); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    const row = el('div', { class: 'goto-row' }, input, el('span', { class: 'goto-of' }, `de ${n}${P.approx ? ' (aprox.)' : ''}`), el('button', { class: 'btn primary', onclick: go }, 'Ir'));
    const body = el('div', { class: 'page-sheet' }, row);
    let obs = null;
    if (P.thumb) {
      const grid = el('div', { class: 'thumb-grid' });
      body.append(grid);
      setTimeout(() => {
        obs = buildThumbs(grid, P, false, () => UI.closeModal());
        const curT = grid.children[cur];
        if (curT) { curT.classList.add('on'); curT.scrollIntoView({ block: 'center' }); }
      }, 30);
    }
    if (P.outline) {
      const items = P.outline();
      if (items.length) {
        body.append(el('label', {}, 'Títulos del documento'));
        const list = el('div', { class: 'outline' });
        for (const it of items) list.append(el('button', { class: 'outline-item lv' + it.level, onclick: () => { it.go(); UI.closeModal(); } }, it.text));
        body.append(list);
      }
    }
    await UI.modal(`Ir a ${P.label.toLowerCase()}`, body, [{ label: 'Cerrar', value: null }]);
    if (obs) obs.disconnect();
  }

  /* ----- Zoom con dos dedos (pellizcar) y Ctrl + rueda ----- */
  (function setupPinchZoom() {
    const ws = $('#workspace');
    let pinch = null, suppressClickUntil = 0, wheelRaf = 0, wheelAcc = 1, wheelAt = null;
    const Z = () => editor && editor.zoom;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    /** Aplica un nuevo zoom manteniendo fijo el punto (fx, fy) del área visible */
    function zoomAround(z, newZoom, sc, fx, fy) {
      const before = z.get();
      const cx = sc.scrollLeft + fx, cy = sc.scrollTop + fy;
      z.set(newZoom);
      const ratio = z.get() / before;
      sc.scrollLeft = cx * ratio - fx;
      sc.scrollTop = cy * ratio - fy;
      updatePager();
    }
    ws.addEventListener('touchstart', e => {
      const z = Z();
      if (!z || e.touches.length !== 2) return;
      e.preventDefault();
      if (z.cancel) z.cancel();
      const [a, b] = e.touches;
      const sc = z.scroller ? z.scroller() : ws, tgt = z.target();
      const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
      const sr = sc.getBoundingClientRect(), tr = tgt.getBoundingClientRect();
      const local = z.cssZoom ? z.get() : 1;     // el origen de la transformación va en coordenadas propias del elemento
      tgt.style.transformOrigin = `${(mx - tr.left) / local}px ${(my - tr.top) / local}px`;
      tgt.style.willChange = 'transform';
      pinch = { d0: dist(a, b) || 1, z0: z.get(), k: 1, fx: mx - sr.left, fy: my - sr.top, sc, tgt, z };
    }, { passive: false, capture: true });
    ws.addEventListener('touchmove', e => {
      if (!pinch || e.touches.length < 2) return;
      e.preventDefault();
      const p = pinch, raw = p.z0 * dist(e.touches[0], e.touches[1]) / p.d0;
      const nz = Math.max(p.z.min, Math.min(p.z.max, raw));
      p.k = nz / p.z0;
      p.tgt.style.transform = `scale(${p.k})`;
    }, { passive: false, capture: true });
    const finish = e => {
      if (!pinch || (e.touches && e.touches.length >= 2)) return;
      const p = pinch;
      pinch = null;
      p.tgt.style.transform = '';
      p.tgt.style.transformOrigin = '';
      p.tgt.style.willChange = '';
      suppressClickUntil = Date.now() + 450;     // el dedo que queda no debe contar como toque
      if (Math.abs(p.k - 1) > 0.02) zoomAround(p.z, p.z0 * p.k, p.sc, p.fx, p.fy);
    };
    ws.addEventListener('touchend', finish, { capture: true });
    ws.addEventListener('touchcancel', finish, { capture: true });
    ws.addEventListener('click', e => { if (Date.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); } }, { capture: true });
    ws.addEventListener('pointerdown', e => { if (pinch || Date.now() < suppressClickUntil) e.stopPropagation(); }, { capture: true });
    // Ctrl + rueda / pellizco en el trackpad
    ws.addEventListener('wheel', e => {
      const z = Z();
      if (!z || !e.ctrlKey) return;
      e.preventDefault();
      wheelAcc *= Math.exp(-e.deltaY * 0.01);
      const sc = z.scroller ? z.scroller() : ws, sr = sc.getBoundingClientRect();
      wheelAt = { sc, fx: e.clientX - sr.left, fy: e.clientY - sr.top };
      if (wheelRaf) return;
      wheelRaf = requestAnimationFrame(() => {
        wheelRaf = 0;
        const zz = Z(); if (!zz) return;
        const nz = Math.max(zz.min, Math.min(zz.max, zz.get() * wheelAcc));
        wheelAcc = 1;
        zoomAround(zz, nz, wheelAt.sc, wheelAt.fx, wheelAt.fy);
      });
    }, { passive: false });
  })();

  /* ----- Imprimir / exportar a PDF ----- */
  async function printDoc(asPdf) {
    if (!editor) return;
    if (asPdf && editor.kind === 'pdf') return onSave();
    if (asPdf && editor.exportPdf) {
      // documentos: PDF con texto real, directo a un archivo
      loading(true, 'Creando PDF…');
      try {
        const blob = await editor.exportPdf();
        const name = ($('#docName').value.trim() || 'documento').replace(/[\\/:*?"<>|]/g, '_') + '.pdf';
        loading(false);
        await download(blob, name);
        if (!UI.android) toast('Guardado: ' + name);
      } catch (e) { loading(false); UI.modal('No se pudo crear el PDF', String(e.message || e)); }
      return;
    }
    if (!editor.printable) return toast('Este documento no se puede imprimir');
    loading(true, 'Preparando…');
    try {
      const { node, page } = await editor.printable();
      const root = $('#printRoot');
      root.innerHTML = '';
      root.append(node);
      let st = document.getElementById('printPageStyle');
      if (!st) { st = el('style', { id: 'printPageStyle' }); document.head.append(st); }
      st.textContent = '@media print {' + page + '}';
      await Promise.all([...root.querySelectorAll('img')].map(i => (i.complete ? null : new Promise(r => { i.onload = i.onerror = r; }))));
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    } catch (e) {
      loading(false);
      return UI.modal('No se pudo preparar', String(e.message || e));
    }
    loading(false);
    const title = $('#docName').value.trim() || 'Documento';
    if (asPdf) toast('En «Destino» o «Impresora» elige «Guardar como PDF».', 5000);
    const prevTitle = document.title;
    document.title = title;            // nombre sugerido del PDF
    setTimeout(() => {
      if (UI.android && window.FolioAndroid.print) window.FolioAndroid.print(title);
      else window.print();
      setTimeout(() => { document.title = prevTitle; }, 1500);
    }, asPdf ? 900 : 50);
  }
  window.addEventListener('afterprint', () => { if (!UI.android) setTimeout(() => { $('#printRoot').innerHTML = ''; }, 500); });

  async function onMore() {
    if (!editor) return;
    const opts = [];
    if (editor.pages) opts.push({ label: `Ir a ${editor.pages.label.toLowerCase()}…`, value: 'goto', icon: 'pages' });
    if (editor.organizer) opts.push({ label: 'Organizar páginas (eliminar, mover, extraer)', value: 'org', icon: 'pages' });
    if (editor.appendPdf) opts.push({ label: 'Añadir otro PDF al final', value: 'append', icon: 'plus' });
    if (editor.kind === 'pdf') {
      opts.push({ label: 'Comprimir este PDF', value: 'compress', icon: 'compress' });
      opts.push({ label: 'Exportar páginas como imágenes', value: 'toimg', icon: 'image' });
    }
    opts.push({ label: 'Imprimir', value: 'print', icon: 'printer' });
    opts.push({ label: 'Exportar como PDF', value: 'pdf', icon: 'filePdf' });
    opts.push({ label: 'Compartir', value: 'share', icon: 'share' });
    const v = await choose('Opciones', opts);
    if (v === 'goto') openPageSheet();
    else if (v === 'org') editor.organizer();
    else if (v === 'compress' || v === 'toimg') {
      try {
        const { blob, name } = await produce('pdf');
        const f = { name, data: await blob.arrayBuffer() };
        if (v === 'compress') Tools.compressPdf(f); else Tools.pdfToImages(f);
      } catch (e) { UI.modal('Error', String(e.message || e)); }
    }
    else if (v === 'append') appendFiles(await pickFiles('.pdf,application/pdf,image/*', true));
    else if (v === 'print') printDoc(false);
    else if (v === 'pdf') printDoc(true);
    else if (v === 'share') onShare();
  }

  async function produce(fmt) {
    loading(true, 'Guardando…');
    try {
      const blob = await editor.save(fmt);
      const name = ($('#docName').value.trim() || 'documento').replace(/[\\/:*?"<>|]/g, '_') + '.' + (fmt || editor.ext);
      return { blob, name };
    } finally { loading(false); }
  }

  async function onSave() {
    if (!editor) return;
    let fmt = editor.ext;
    if (editor.formats) {
      fmt = await choose('Guardar como', editor.formats.map(f => ({ label: f.label, value: f.value })));
      if (!fmt) return;
    }
    try {
      const { blob, name } = await produce(fmt);
      await download(blob, name);
      if (fmt === editor.ext) { isDirty = false; recent.add(name, await blob.arrayBuffer()); }
      if (!UI.android) toast('Guardado: ' + name);
    } catch (e) {
      console.error(e);
      UI.modal('Error al guardar', String(e.message || e));
    }
  }

  async function onShare() {
    if (!editor) return;
    try {
      const { blob, name } = await produce(editor.ext);
      await share(blob, name);
    } catch (e) { UI.modal('Error', String(e.message || e)); }
  }

  /* ----- Recientes ----- */
  const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  function fmtDate(t) {
    const d = new Date(t), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Hoy, ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Ayer';
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }
  async function renderRecent() {
    const items = await recent.list();
    const ul = $('#recentList');
    ul.innerHTML = '';
    $('#recentEmpty').hidden = items.length > 0;
    for (const it of items) {
      const kind = kindOf(it.name);
      if (!kind) continue;
      const li = el('li', {},
        el('span', { class: 'tag ' + TAG_CLASS[kind] }, tagText(it.name)),
        el('div', { class: 'meta' }, el('b', {}, it.name), el('small', {}, fmtDate(it.time) + ' · ' + fmtSize(it.size))),
        el('button', { 'aria-label': 'Quitar de recientes', onclick: async e => { e.stopPropagation(); await recent.remove(it.name); renderRecent(); } }, UI.icon('x', 16)));
      li.addEventListener('click', async () => {
        await recent.add(it.name, it.bytes.slice(0));
        openData(it.name, it.bytes.slice(0));
      });
      ul.append(li);
    }
  }

  /* ----- Eventos ----- */
  $('#btnOpen').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) openFile(f);
  });
  // Herramientas del inicio
  const grid = document.getElementById('toolsGrid');
  for (const t of Tools.LIST) {
    grid.append(el('button', { class: 'tool-card', onclick: () => (t.id === 'merge' ? mergeFlow() : t.run()) },
      el('span', { class: 'tool-ic' }, UI.icon(t.icon, 19)), el('span', { class: 'tool-txt' }, el('b', {}, t.label), el('small', {}, t.desc))));
  }
  Tools.setOpener((name, bytes) => openData(name, bytes));
  document.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => {
    const kind = b.dataset.new;
    const names = { word: 'Documento.docx', excel: 'Libro.xlsx', ppt: 'Presentación.pptx' };
    openEditor(kind, null, names[kind]);
  }));
  $('#btnBack').addEventListener('click', () => history.back());
  window.addEventListener('popstate', () => {
    // una ventana superpuesta (p. ej. Organizar páginas) se cierra con "Atrás" sin salir del documento
    if (window.__folioOverlay) { const f = window.__folioOverlay; window.__folioOverlay = null; f(); return; }
    if (editor) goHome();
  });
  // cambió el número u orden de páginas: rehacer miniaturas e indicador
  window.addEventListener('folio-pages-changed', () => { thumbsBuilt = -1; if (editor && editor.pages) updatePager(); });
  $('#btnSave').addEventListener('click', onSave);
  $('#btnShare').addEventListener('click', onShare);
  $('#btnMore').addEventListener('click', onMore);
  $('#pager').querySelectorAll('.pg-btn').forEach(b => b.addEventListener('click', () => {
    const P = editor && editor.pages; if (!P) return;
    P.goTo(P.current() + +b.dataset.dir);
  }));
  $('#pager .pg-count').addEventListener('click', openPageSheet);
  // Atajos de teclado (tablets con teclado / computadora)
  document.addEventListener('keydown', e => {
    if (!editor) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); onSave(); }
    else if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); printDoc(false); }
    else if (mod && e.key.toLowerCase() === 'g' && editor.pages) { e.preventDefault(); openPageSheet(); }
  });
  window.addEventListener('beforeunload', e => { if (editor && isDirty) { e.preventDefault(); e.returnValue = ''; } });

  // Arrastrar y soltar (tablets / escritorio)
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });

  // Abrir archivos desde el sistema (PWA instalada en escritorio / Android con File Handling)
  if ('launchQueue' in window) {
    launchQueue.setConsumer(async params => {
      if (params.files && params.files.length) openFile(await params.files[0].getFile());
    });
  }

  // Íconos declarados en el HTML
  document.querySelectorAll('[data-icon]').forEach(n => n.prepend(UI.icon(n.dataset.icon, n.classList.contains('icon-btn') ? 22 : n.closest('.foot') ? 14 : 20)));

  renderRecent();

  // Documentos recibidos desde otras apps de Android ("Abrir con Folio")
  window.__folioOpenUrl = async (url, name) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      if (editor) closeEditor();
      openFile(new File([blob], name, { type: blob.type }));
    } catch (e) { UI.modal('No se pudo abrir', String(e.message || e)); }
  };

  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !UI.android) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Selector de archivos: todas las extensiones compatibles
  $('#fileInput').setAttribute('accept', Importers.allExtensions().map(e => '.' + e).join(','));

  window.LizApp = { openFile, openEditor, openData };
})();
