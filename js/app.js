/* Controlador principal: inicio, apertura de archivos, guardado */
(() => {
  const { $, el, toast, loading, confirm, choose, download, share, readFile, recent } = UI;

  const KINDS = {
    pdf: { exts: ['pdf'], factory: PdfEditor, badge: 'PDF', cls: 't-pdf' },
    excel: { exts: ['xlsx', 'xls', 'xlsm', 'csv', 'ods'], factory: ExcelEditor, badge: 'XLS', cls: 't-xls' },
    word: { exts: ['docx', 'txt'], factory: WordEditor, badge: 'DOC', cls: 't-doc' },
    ppt: { exts: ['pptx'], factory: PptEditor, badge: 'PPT', cls: 't-ppt' }
  };
  const UNSUPPORTED = {
    doc: 'Los archivos .doc antiguos no son compatibles. Ábrelo en Word y guárdalo como .docx.',
    ppt: 'Los archivos .ppt antiguos no son compatibles. Guárdalo como .pptx.'
  };
  const kindOf = name => {
    const ext = name.split('.').pop().toLowerCase();
    return Object.keys(KINDS).find(k => KINDS[k].exts.includes(ext));
  };

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
    badge.textContent = k.badge;
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
  }

  function closeEditor() {
    if (editor) { try { editor.destroy(); } catch {} }
    editor = null;
    isDirty = false;
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

  async function openFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (UNSUPPORTED[ext]) return UI.modal('Formato no compatible', UNSUPPORTED[ext]);
    const kind = kindOf(file.name);
    if (!kind) return UI.modal('Formato no compatible', 'Puedes abrir archivos PDF, Excel (.xlsx, .xls, .csv), Word (.docx, .txt) y PowerPoint (.pptx).');
    loading(true, 'Leyendo archivo…');
    let data;
    try { data = await readFile(file); } finally { loading(false); }
    recent.add(file.name, data.slice(0));
    await openEditor(kind, data, file.name);
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
      const k = KINDS[kind];
      const li = el('li', {},
        el('span', { class: 'tag ' + k.cls }, k.badge),
        el('div', { class: 'meta' }, el('b', {}, it.name), el('small', {}, fmtDate(it.time) + ' · ' + fmtSize(it.size))),
        el('button', { 'aria-label': 'Quitar de recientes', onclick: async e => { e.stopPropagation(); await recent.remove(it.name); renderRecent(); } }, UI.icon('x', 16)));
      li.addEventListener('click', async () => {
        await recent.add(it.name, it.bytes.slice(0));
        openEditor(kind, it.bytes.slice(0), it.name);
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
  document.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => {
    const kind = b.dataset.new;
    const names = { word: 'Documento.docx', excel: 'Libro.xlsx', ppt: 'Presentación.pptx' };
    openEditor(kind, null, names[kind]);
  }));
  $('#btnBack').addEventListener('click', () => history.back());
  window.addEventListener('popstate', () => { if (editor) goHome(); });
  $('#btnSave').addEventListener('click', onSave);
  $('#btnShare').addEventListener('click', onShare);
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

  window.LizApp = { openFile, openEditor };
})();
