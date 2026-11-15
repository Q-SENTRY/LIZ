/* Herramientas: comprimir PDF e imágenes, imágenes↔PDF, Word→PDF, Excel→CSV (todo en el dispositivo) */
const Tools = (() => {
  const { el, toast, loading, modal, download, share, readFile } = UI;
  const fmtSize = b => (b >= 1048576 ? (b / 1048576).toFixed(b >= 10485760 ? 0 : 1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const baseName = n => n.replace(/\.[^.]+$/, '');
  const pad = (n, w) => String(n).padStart(w, '0');
  let openInFolio = null;     // lo define app.js (abrir un resultado en el editor)

  function pickFiles(accept, multiple) {
    return new Promise(res => {
      const input = el('input', { type: 'file', accept, multiple: !!multiple, hidden: true });
      document.body.append(input);
      input.addEventListener('change', () => { const f = [...input.files]; input.remove(); res(f); });
      input.click();
    });
  }

  /** Diálogo de opciones con grupos de botones tipo "segmento". groups: [{ key, label, options:[{value,label,hint}], value }] */
  async function optionsDialog(title, groups, okLabel = 'Continuar', intro) {
    const state = {};
    const body = el('div', { class: 'tool-opts' }, intro ? el('p', { class: 'tool-intro' }, intro) : null);
    for (const g of groups) {
      state[g.key] = g.value;
      const seg = el('div', { class: 'seg' + (g.options.length > 3 ? ' seg-wrap' : '') });
      const hint = el('p', { class: 'seg-hint' });
      const sync = () => {
        seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(state[g.key])));
        const o = g.options.find(o => String(o.value) === String(state[g.key]));
        hint.textContent = (o && o.hint) || '';
        hint.hidden = !hint.textContent;
      };
      for (const o of g.options) seg.append(el('button', { 'data-v': o.value, onclick: () => { state[g.key] = o.value; sync(); } }, o.label));
      body.append(el('label', {}, g.label), seg, hint);
      sync();
    }
    const ok = await modal(title, body, [{ label: 'Cancelar', value: false }, { label: okLabel, value: true, primary: true }]);
    return ok ? state : null;
  }

  /** Lista para ordenar archivos (subir / quitar) */
  async function orderDialog(title, files, intro) {
    files = files.slice();
    const list = el('div', { class: 'merge-list' });
    const draw = () => list.replaceChildren(...files.map((f, i) => el('div', { class: 'merge-item' },
      el('span', { class: 'merge-n' }, String(i + 1)),
      el('span', { class: 'merge-name' }, f.name),
      el('button', { class: 'icon-btn', 'aria-label': 'Subir', disabled: i === 0, onclick: () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; draw(); } }, UI.icon('arrowUp', 18)),
      el('button', { class: 'icon-btn', 'aria-label': 'Quitar', onclick: () => { files.splice(i, 1); draw(); } }, UI.icon('x', 18)))));
    draw();
    const ok = await modal(title, el('div', {}, el('p', {}, intro), list), [{ label: 'Cancelar', value: false }, { label: 'Continuar', value: true, primary: true }]);
    return ok && files.length ? files : null;
  }

  /** Resultado: tamaños y acciones. outputs: [{ blob, name }] */
  async function resultDialog(title, outputs, { before, note, openable } = {}) {
    const total = outputs.reduce((a, o) => a + o.blob.size, 0);
    const body = el('div', { class: 'tool-result' });
    if (before) {
      const saved = before - total, pct = Math.round((saved / before) * 100);
      body.append(el('div', { class: 'size-compare' },
        el('div', {}, el('small', {}, 'Antes'), el('b', {}, fmtSize(before))),
        UI.icon('arrowRight', 20),
        el('div', {}, el('small', {}, 'Después'), el('b', {}, fmtSize(total))),
        el('span', { class: 'size-pct' + (pct > 0 ? ' good' : '') }, pct > 0 ? `−${pct}%` : 'sin cambio')));
    }
    if (outputs.length > 1) body.append(el('p', { class: 'tool-intro' }, `${outputs.length} archivos · ${fmtSize(total)}`));
    else body.append(el('p', { class: 'tool-file' }, UI.icon('file', 16), el('span', {}, outputs[0].name)));
    if (note) body.append(el('p', { class: 'tool-note' }, note));
    const buttons = [];
    if (openable && outputs.length === 1 && openInFolio) buttons.push({ label: 'Abrir', value: 'open' });
    buttons.push({ label: 'Compartir', value: 'share' });
    if (outputs.length > 1) buttons.push({ label: 'ZIP', value: 'zip' });
    buttons.push({ label: outputs.length > 1 ? 'Guardar todo' : 'Guardar', value: 'save', primary: true });
    const v = await modal(title, body, buttons);
    if (v === 'save') { for (const o of outputs) await download(o.blob, o.name); if (!UI.android) toast(outputs.length > 1 ? `Se guardaron ${outputs.length} archivos` : 'Guardado: ' + outputs[0].name); }
    else if (v === 'zip') { const z = await zipOutputs(outputs, title); await download(z.blob, z.name); }
    else if (v === 'share') {
      if (outputs.length > 1) { const z = await zipOutputs(outputs, title); await share(z.blob, z.name); }
      else await share(outputs[0].blob, outputs[0].name);
    } else if (v === 'open') openInFolio(outputs[0].name, await outputs[0].blob.arrayBuffer());
  }
  async function zipOutputs(outputs, title) {
    loading(true, 'Creando ZIP…');
    try {
      const zip = new JSZip();
      for (const o of outputs) zip.file(o.name, o.blob);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const first = outputs[0].name.replace(/( - página \d+)?\.[^.]+$/, '');
      return { blob, name: `${first || title}.zip` };
    } finally { loading(false); }
  }

  const canvasBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));
  async function loadImage(blob) {
    if (window.createImageBitmap) { try { return await createImageBitmap(blob); } catch {} }
    const url = URL.createObjectURL(blob);
    try { return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la imagen')); i.src = url; }); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  /* ===================== Comprimir PDF ===================== */
  const PDF_LEVELS = {
    rec: { label: 'Recomendada', max: 1600, q: 0.72, hint: 'Reduce las imágenes y conserva el texto seleccionable. Buena calidad.' },
    strong: { label: 'Fuerte', max: 1100, q: 0.55, hint: 'Imágenes más livianas. El texto sigue siendo texto.' },
    max: { label: 'Máxima', dpi: 96, q: 0.55, hint: 'Convierte cada página en imagen. El archivo más pequeño, pero el texto ya no se puede seleccionar.' }
  };

  async function openPdfJs(bytes, label) {
    const task = pdfjsLib.getDocument({ data: bytes.slice(0) });
    task.onPassword = async (cb, reason) => {
      const pw = await UI.prompt(reason === 2 ? 'Contraseña incorrecta' : `PDF protegido${label ? ': ' + label : ''}`, '', { label: 'Contraseña' });
      if (pw == null) { task.destroy(); return; }
      cb(pw);
    };
    return task.promise;
  }

  /** Recomprime las imágenes JPEG dentro del PDF (el texto y los vectores no se tocan) */
  async function recompressImages(bytes, level, progress) {
    const { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFArray } = PDFLib;
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    const objs = doc.context.enumerateIndirectObjects();
    const images = objs.filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
    let done = 0, changed = 0;
    const OUTER = new Set(['/ASCII85Decode', '/ASCIIHexDecode', '/FlateDecode', '/LZWDecode', '/RunLengthDecode', '/A85', '/AHx', '/Fl', '/LZW', '/RL']);
    /** Decodifica con pdf-lib solo los filtros indicados (los "externos") */
    const decodeWith = (obj, filters) => {
      const dd = obj.dict.clone(doc.context);
      if (filters.length) dd.set(PDFName.of('Filter'), filters.length === 1 ? filters[0] : doc.context.obj(filters)); else dd.delete(PDFName.of('Filter'));
      const parms = obj.dict.get(PDFName.of('DecodeParms'));
      if (parms instanceof PDFArray) dd.set(PDFName.of('DecodeParms'), doc.context.obj(parms.asArray().slice(0, filters.length)));
      return PDFLib.decodePDFRawStream(PDFRawStream.of(dd, obj.contents)).decode();
    };
    for (const [ref, obj] of images) {
      progress(`Optimizando imágenes ${++done} de ${images.length}…`);
      const d = obj.dict;
      const w0 = d.get(PDFName.of('Width')), h0 = d.get(PDFName.of('Height'));
      const W = w0 && w0.asNumber ? w0.asNumber() : 0, H = h0 && h0.asNumber ? h0.asNumber() : 0;
      if (!W || !H || d.get(PDFName.of('ImageMask'))) continue;
      const fRaw = d.get(PDFName.of('Filter'));
      const filters = fRaw instanceof PDFArray ? fRaw.asArray() : fRaw ? [fRaw] : [];
      const names = filters.map(f => (f instanceof PDFName ? f.asString() : '?'));
      // espacio de color: solo RGB y gris (CMYK de imprenta o paletas se dejan como están)
      const cs = d.get(PDFName.of('ColorSpace'));
      let comps = 0;
      const csName = cs instanceof PDFName ? cs.asString() : null;
      if (csName === '/DeviceRGB') comps = 3; else if (csName === '/DeviceGray') comps = 1;
      else if (cs instanceof PDFArray && cs.get(0) === PDFName.of('ICCBased')) {
        try { const icc = doc.context.lookup(cs.get(1)); const n = icc.dict.get(PDFName.of('N')).asNumber(); if (n === 3 || n === 1) comps = n; } catch {}
      }
      if (!comps) continue;
      // con "predictores" (PNG/TIFF) pdf-lib no decodifica bien: esas imágenes no se tocan
      const parms = d.get(PDFName.of('DecodeParms'));
      const parmList = parms instanceof PDFArray ? parms.asArray() : parms ? [parms] : [];
      if (parmList.some(pp => { try { const pr = (pp.get ? pp : doc.context.lookup(pp)).get(PDFName.of('Predictor')); return pr && pr.asNumber() > 1; } catch { return true; } })) continue;
      try {
        let bmp;
        const last = names[names.length - 1];
        if (last === '/DCTDecode' || last === '/DCT') {
          const outer = filters.slice(0, -1);
          if (!names.slice(0, -1).every(n => OUTER.has(n))) continue;
          const jpg = outer.length ? decodeWith(obj, outer) : obj.contents;
          bmp = await loadImage(new Blob([jpg], { type: 'image/jpeg' }));
        } else if (names.every(n => OUTER.has(n))) {
          // imagen sin comprimir como foto (p. ej. capturas): se pasa a JPEG si es grande
          const bpc = d.get(PDFName.of('BitsPerComponent'));
          if (!bpc || bpc.asNumber() !== 8 || W * H < 250 * 250 || d.get(PDFName.of('Decode'))) continue;
          const raw = filters.length ? decodeWith(obj, filters) : obj.contents;
          if (raw.length < W * H * comps) continue;
          const c0 = document.createElement('canvas'); c0.width = W; c0.height = H;
          const id = c0.getContext('2d').createImageData(W, H);
          for (let i = 0, j = 0; i < W * H; i++, j += comps) {
            const o = i * 4;
            if (comps === 3) { id.data[o] = raw[j]; id.data[o + 1] = raw[j + 1]; id.data[o + 2] = raw[j + 2]; }
            else id.data[o] = id.data[o + 1] = id.data[o + 2] = raw[j];
            id.data[o + 3] = 255;
          }
          c0.getContext('2d').putImageData(id, 0, 0);
          bmp = c0;
        } else continue;
        const w = bmp.width, h = bmp.height;
        const k = Math.min(1, level.max / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(bmp, 0, 0, c.width, c.height);
        if (bmp.close) bmp.close();
        if (bmp.tagName === 'CANVAS') bmp.width = bmp.height = 0;
        const out = new Uint8Array(await (await canvasBlob(c, 'image/jpeg', level.q)).arrayBuffer());
        c.width = c.height = 0;
        if (out.length >= obj.contents.length * 0.92) continue;     // no vale la pena
        const nd = d.clone(doc.context);
        nd.set(PDFName.of('Width'), PDFNumber.of(Math.max(1, Math.round(w * k))));
        nd.set(PDFName.of('Height'), PDFNumber.of(Math.max(1, Math.round(h * k))));
        nd.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
        nd.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
        nd.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
        nd.delete(PDFName.of('DecodeParms'));
        nd.delete(PDFName.of('Decode'));
        nd.delete(PDFName.of('Length'));
        doc.context.assign(ref, PDFRawStream.of(nd, out));
        changed++;
      } catch { /* imagen que no se sabe leer: se deja como estaba */ }
    }
    progress('Guardando…');
    const saved = await doc.save({ useObjectStreams: true });
    return { bytes: saved, changed, images: images.length };
  }

  /** Cada página como imagen JPEG (máxima compresión) */
  async function rasterizePdf(bytes, level, progress, label) {
    const pdf = await openPdfJs(bytes, label);
    const out = await PDFLib.PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
      progress(`Página ${i} de ${pdf.numPages}…`);
      const page = await pdf.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: level.dpi / 72 });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      const jpg = await out.embedJpg(await (await canvasBlob(c, 'image/jpeg', level.q)).arrayBuffer());
      out.addPage([vp1.width, vp1.height]).drawImage(jpg, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      c.width = c.height = 0;
    }
    pdf.destroy();
    return { bytes: await out.save() };
  }

  async function compressPdfBytes(bytes, levelKey, progress = () => {}, label) {
    const level = PDF_LEVELS[levelKey];
    if (level.dpi) return { ...(await rasterizePdf(bytes, level, progress, label)), mode: 'raster' };
    try {
      return { ...(await recompressImages(bytes, level, progress)), mode: 'images' };
    } catch (e) {
      if (/encrypt/i.test(String(e && e.message))) {
        progress('El PDF tiene contraseña: se comprime como imágenes…');
        return { ...(await rasterizePdf(bytes, { dpi: 130, q: level.q }, progress, label)), mode: 'raster', encrypted: true };
      }
      throw e;
    }
  }

  async function compressPdf(fileArg) {
    const files = fileArg ? [fileArg] : (await pickFiles('.pdf,application/pdf', true)).filter(f => /\.pdf$/i.test(f.name));
    if (!files.length) return;
    const opts = await optionsDialog('Comprimir PDF', [{ key: 'level', label: 'Nivel de compresión', value: 'rec', options: Object.entries(PDF_LEVELS).map(([value, o]) => ({ value, label: o.label, hint: o.hint })) }], 'Comprimir',
      files.length > 1 ? `${files.length} archivos seleccionados` : files[0].name);
    if (!opts) return;
    const outputs = [];
    let before = 0, notes = new Set();
    loading(true, 'Comprimiendo…');
    try {
      for (const f of files) {
        const bytes = new Uint8Array(f instanceof Blob ? await readFile(f) : f.data);
        before += bytes.length;
        const r = await compressPdfBytes(bytes, opts.level, m => loading(true, (files.length > 1 ? f.name + ' · ' : '') + m), f.name);
        let blob = new Blob([r.bytes], { type: 'application/pdf' });
        if (blob.size >= bytes.length) { blob = new Blob([bytes], { type: 'application/pdf' }); notes.add('Algún archivo ya estaba optimizado: se dejó como estaba.'); }
        if (r.mode === 'images' && r.changed === 0 && r.images === 0) notes.add('El PDF casi no tiene imágenes; para reducirlo más usa el nivel «Máxima».');
        if (r.encrypted) notes.add('El PDF tenía contraseña: el resultado no tiene contraseña.');
        outputs.push({ blob, name: `${baseName(f.name)} (comprimido).pdf` });
      }
    } catch (e) { loading(false); return modal('No se pudo comprimir', String(e.message || e)); }
    loading(false);
    await resultDialog('PDF comprimido', outputs, { before, note: [...notes].join(' '), openable: true });
  }

  /* ===================== Comprimir imágenes ===================== */
  const IMG_LEVELS = {
    high: { label: 'Alta', max: 2560, q: 0.85, hint: 'Casi sin diferencia visible. Hasta 2560 px.' },
    medium: { label: 'Media', max: 1920, q: 0.72, hint: 'Ideal para WhatsApp y correo. Hasta 1920 px.' },
    low: { label: 'Liviana', max: 1280, q: 0.6, hint: 'El tamaño más pequeño. Hasta 1280 px.' }
  };
  async function compressImages() {
    const files = (await pickFiles('image/*', true)).filter(f => /^image\//.test(f.type) || Importers.kindOf(f.name) === 'image');
    if (!files.length) return;
    const opts = await optionsDialog('Comprimir imágenes', [
      { key: 'level', label: 'Calidad', value: 'medium', options: Object.entries(IMG_LEVELS).map(([value, o]) => ({ value, label: o.label, hint: o.hint })) },
      { key: 'fmt', label: 'Formato', value: 'jpg', options: [{ value: 'jpg', label: 'JPG', hint: 'El más compatible. Las zonas transparentes quedan en blanco.' }, { value: 'webp', label: 'WebP', hint: 'Más liviano que JPG y conserva la transparencia.' }] }
    ], 'Comprimir', `${files.length} imagen${files.length === 1 ? '' : 'es'}`);
    if (!opts) return;
    const L = IMG_LEVELS[opts.level], type = opts.fmt === 'webp' ? 'image/webp' : 'image/jpeg', ext = opts.fmt === 'webp' ? 'webp' : 'jpg';
    const outputs = [];
    let before = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        loading(true, `Imagen ${i + 1} de ${files.length}…`);
        const f = files[i];
        before += f.size;
        const bmp = await loadImage(f);
        const k = Math.min(1, L.max / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        const g = c.getContext('2d');
        if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
        g.drawImage(bmp, 0, 0, c.width, c.height);
        let blob = await canvasBlob(c, type, L.q);
        if (!blob || blob.type !== type) blob = await canvasBlob(c, 'image/jpeg', L.q);   // WebP no disponible
        const outExt = blob.type === 'image/webp' ? 'webp' : 'jpg';
        if (blob.size >= f.size && /jpe?g|webp/i.test(f.type) && k === 1) blob = f;      // ya estaba optimizada
        outputs.push({ blob, name: `${baseName(f.name)} (comprimida).${blob === f ? f.name.split('.').pop() : outExt}` });
        c.width = c.height = 0;
      }
    } catch (e) { loading(false); return modal('No se pudo comprimir', String(e.message || e)); }
    loading(false);
    await resultDialog('Imágenes comprimidas', outputs, { before });
  }

  /* ===================== Imágenes a PDF ===================== */
  async function imagesToPdf() {
    let files = (await pickFiles('image/*', true)).filter(f => /^image\//.test(f.type) || Importers.kindOf(f.name) === 'image');
    if (!files.length) return;
    if (files.length > 1) { files = await orderDialog('Imágenes a PDF', files, 'Cada imagen será una página, en este orden:'); if (!files) return; }
    const opts = await optionsDialog('Imágenes a PDF', [
      { key: 'size', label: 'Tamaño de página', value: 'a4', options: [{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Carta' }, { value: 'fit', label: 'Como la imagen', hint: 'Cada página mide lo mismo que su imagen.' }] },
      { key: 'margin', label: 'Márgenes', value: 'small', options: [{ value: 'none', label: 'Sin margen' }, { value: 'small', label: 'Pequeño' }, { value: 'large', label: 'Grande' }] }
    ], 'Crear PDF');
    if (!opts) return;
    const { PDFDocument } = PDFLib;
    const doc = await PDFDocument.create();
    doc.setProducer('Folio');
    try {
      for (let i = 0; i < files.length; i++) {
        loading(true, `Imagen ${i + 1} de ${files.length}…`);
        const f = files[i];
        const bmp = await loadImage(f);
        let w = bmp.width, h = bmp.height;
        // imágenes muy grandes se reducen (el PDF quedaría enorme)
        const k = Math.min(1, 3000 / Math.max(w, h));
        let img;
        if (k === 1 && /jpe?g/i.test(f.type)) img = await doc.embedJpg(await readFile(f));
        else if (k === 1 && /png/i.test(f.type)) img = await doc.embedPng(await readFile(f));
        else {
          const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
          img = await doc.embedJpg(await (await canvasBlob(c, 'image/jpeg', 0.88)).arrayBuffer());
          c.width = c.height = 0;
        }
        const ptW = w * 0.75, ptH = h * 0.75;
        let PW, PH;
        if (opts.size === 'fit') { const s = Math.min(1, 842 / Math.max(ptW, ptH)); PW = ptW * s; PH = ptH * s; }
        else { [PW, PH] = HtmlPdf.SIZES[opts.size]; if (w > h) [PW, PH] = [PH, PW]; }
        const m = opts.size === 'fit' && opts.margin === 'none' ? 0 : { none: 0, small: 18, large: 42 }[opts.margin];
        const s = Math.min((PW - m * 2) / ptW, (PH - m * 2) / ptH, opts.size === 'fit' ? Infinity : 99);
        const dw = ptW * s, dh = ptH * s;
        const pageW = opts.size === 'fit' ? dw + m * 2 : PW, pageH = opts.size === 'fit' ? dh + m * 2 : PH;
        doc.addPage([pageW, pageH]).drawImage(img, { x: (pageW - dw) / 2, y: (pageH - dh) / 2, width: dw, height: dh });
      }
    } catch (e) { loading(false); return modal('No se pudo crear el PDF', String(e.message || e)); }
    loading(true, 'Guardando…');
    const blob = new Blob([await doc.save()], { type: 'application/pdf' });
    loading(false);
    const name = files.length === 1 ? `${baseName(files[0].name)}.pdf` : `Imágenes (${files.length}).pdf`;
    await resultDialog('PDF creado', [{ blob, name }], { openable: true, note: `${files.length} página${files.length === 1 ? '' : 's'}` });
  }

  /* ===================== PDF a imágenes ===================== */
  async function pdfToImages(fileArg) {
    const f = fileArg || (await pickFiles('.pdf,application/pdf', false))[0];
    if (!f) return;
    const opts = await optionsDialog('PDF a imágenes', [
      { key: 'dpi', label: 'Calidad', value: 150, options: [{ value: 96, label: 'Liviana', hint: '96 ppp · para ver en pantalla.' }, { value: 150, label: 'Normal', hint: '150 ppp · buena para compartir.' }, { value: 300, label: 'Alta', hint: '300 ppp · para imprimir.' }] },
      { key: 'fmt', label: 'Formato', value: 'jpg', options: [{ value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG', hint: 'Sin pérdida de calidad, archivos más grandes.' }] }
    ], 'Convertir', f.name);
    if (!opts) return;
    const outputs = [];
    try {
      loading(true, 'Abriendo…');
      const bytes = new Uint8Array(f instanceof Blob ? await readFile(f) : f.data);
      const pdf = await openPdfJs(bytes, f.name);
      const wdt = String(pdf.numPages).length;
      for (let i = 1; i <= pdf.numPages; i++) {
        loading(true, `Página ${i} de ${pdf.numPages}…`);
        const page = await pdf.getPage(i);
        let scale = opts.dpi / 72;
        const vp1 = page.getViewport({ scale: 1 });
        scale = Math.min(scale, Math.sqrt(30e6 / (vp1.width * vp1.height)));      // límite de memoria del celular
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: vp }).promise;
        const blob = await canvasBlob(c, opts.fmt === 'png' ? 'image/png' : 'image/jpeg', 0.9);
        c.width = c.height = 0;
        outputs.push({ blob, name: pdf.numPages === 1 ? `${baseName(f.name)}.${opts.fmt}` : `${baseName(f.name)} - página ${pad(i, Math.max(2, wdt))}.${opts.fmt}` });
      }
      pdf.destroy();
    } catch (e) { loading(false); return modal('No se pudo convertir', String(e.message || e)); }
    loading(false);
    await resultDialog('Imágenes listas', outputs, { note: outputs.length > 1 ? 'Puedes guardarlas sueltas o en un solo archivo ZIP.' : '' });
  }

  /* ===================== Word a PDF ===================== */
  async function wordToPdf() {
    const f = (await pickFiles('.docx,.docm,.dotx,.doc,.odt,.rtf,.md,.markdown,.txt,.html,.htm', false))[0];
    if (!f) return;
    const opts = await optionsDialog('Word a PDF', [{ key: 'size', label: 'Tamaño de página', value: 'letter', options: [{ value: 'letter', label: 'Carta' }, { value: 'a4', label: 'A4' }] }], 'Convertir', f.name);
    if (!opts) return;
    let r;
    try {
      loading(true, 'Leyendo documento…');
      const div = await WordEditor.documentHtml(await readFile(f), f.name);
      loading(true, 'Creando PDF…');
      r = await HtmlPdf.render(div, { size: opts.size, title: baseName(f.name) });
    } catch (e) { loading(false); return modal('No se pudo convertir', String(e.message || e)); }
    loading(false);
    const notes = [`${r.pages} página${r.pages === 1 ? '' : 's'}. El texto se puede seleccionar y buscar.`];
    if (r.replaced) notes.push('Algunos caracteres especiales (emojis u otros alfabetos) se reemplazaron por «?».');
    await resultDialog('PDF creado', [{ blob: new Blob([r.bytes], { type: 'application/pdf' }), name: `${baseName(f.name)}.pdf` }], { openable: true, note: notes.join(' ') });
  }

  /* ===================== Excel a CSV ===================== */
  async function excelToCsv() {
    const f = (await pickFiles(Importers.FORMATS.excel.map(e => '.' + e).join(','), false))[0];
    if (!f) return;
    let wb;
    try { loading(true, 'Leyendo…'); wb = XLSX.read(new Uint8Array(await readFile(f)), { type: 'array', cellNF: true, cellDates: false }); }
    catch (e) { loading(false); return modal('No se pudo leer', String(e.message || e)); }
    loading(false);
    const sheets = wb.SheetNames;
    const groups = [{ key: 'sep', label: 'Separador', value: ';', options: [
      { value: ';', label: 'Punto y coma', hint: 'Recomendado si abres el CSV en Excel en español.' },
      { value: ',', label: 'Coma', hint: 'Estándar internacional.' },
      { value: '\t', label: 'Tabulación' }] }];
    if (sheets.length > 1) groups.unshift({ key: 'which', label: 'Hojas', value: 'all', options: [{ value: 'all', label: `Todas (${sheets.length})`, hint: 'Un archivo CSV por hoja.' }, ...sheets.slice(0, 6).map((n, i) => ({ value: String(i), label: n.length > 14 ? n.slice(0, 13) + '…' : n }))] });
    const opts = await optionsDialog('Excel a CSV', groups, 'Convertir', f.name);
    if (!opts) return;
    const pick = sheets.length > 1 && opts.which !== 'all' ? [sheets[+opts.which]] : sheets;
    const outputs = pick.map(n => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: opts.sep, blankrows: false });
      const name = pick.length === 1 && sheets.length === 1 ? `${baseName(f.name)}.csv` : `${baseName(f.name)} - ${n.replace(/[\\/:*?"<>|]/g, '_')}.csv`;
      return { blob: new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), name };
    });
    await resultDialog('CSV listo', outputs, { note: 'Codificación UTF-8: acentos y eñes se ven bien en Excel.' });
  }

  const LIST = [
    { id: 'merge', icon: 'pages', label: 'Unir PDF', desc: 'Varios PDF o imágenes en uno' },
    { id: 'compressPdf', icon: 'compress', label: 'Comprimir PDF', desc: 'Reduce el peso del archivo', run: () => compressPdf() },
    { id: 'compressImg', icon: 'compress', label: 'Comprimir imágenes', desc: 'Fotos más livianas', run: compressImages },
    { id: 'imgToPdf', icon: 'image', label: 'Imágenes a PDF', desc: 'Fotos en un solo PDF', run: imagesToPdf },
    { id: 'pdfToImg', icon: 'image', label: 'PDF a imágenes', desc: 'Cada página en JPG o PNG', run: () => pdfToImages() },
    { id: 'wordToPdf', icon: 'filePdf', label: 'Word a PDF', desc: '.docx, .doc, .odt, .rtf, .md', run: wordToPdf },
    { id: 'excelToCsv', icon: 'table', label: 'Excel a CSV', desc: 'Exporta hojas a CSV', run: excelToCsv }
  ];

  return { LIST, compressPdf, compressImages, imagesToPdf, pdfToImages, wordToPdf, excelToCsv, compressPdfBytes, setOpener: fn => { openInFolio = fn; }, fmtSize };
})();
