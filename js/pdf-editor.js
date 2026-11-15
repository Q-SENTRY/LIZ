/* Editor de PDF: visor (pdf.js) + anotaciones editables guardadas con pdf-lib */
const PdfEditor = (() => {
  const { el, toast, modal, confirm, choose } = UI;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  const SVGNS = 'http://www.w3.org/2000/svg';
  const TOOLS = [
    ['view', 'pointer', 'Ver'], ['select', 'move', 'Seleccionar'], ['text', 'type', 'Texto'], ['pen', 'pen', 'Lápiz'],
    ['hl', 'marker', 'Resaltar'], ['shape', 'shapes', 'Formas'], ['image', 'image', 'Imagen'], ['sign', 'sign', 'Firma'], ['erase', 'eraser', 'Borrar']
  ];
  const SHAPES = { rect: 'Rectángulo', whiteout: 'Corrector (tapar)', ellipse: 'Círculo', line: 'Línea', arrow: 'Flecha' };
  const DRAW_TOOLS = new Set(['pen', 'hl', 'shape']);
  const WIDTHS = { 1: 1.2, 2: 2.5, 3: 5 };
  const MAX_HISTORY = 120;

  // medir texto (para cajas de selección)
  const measureCtx = document.createElement('canvas').getContext('2d');
  function measureText(a) {
    measureCtx.font = `${a.bold ? 'bold ' : ''}100px Helvetica, Arial, sans-serif`;
    const lines = a.text.split('\n');
    a.w = Math.max(4, ...lines.map(l => measureCtx.measureText(l || ' ').width)) * a.size / 100;
    a.h = lines.length * a.size * 1.2;
  }
  const hexToRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const cloneAnn = a => ({ ...a, pts: a.pts && a.pts.map(q => q.slice()), p1: a.p1 && a.p1.slice(), p2: a.p2 && a.p2.slice() });

  function create(ctx) {
    let bytes, pdf, pages = [], zoom = 1, tool = 'view', shape = 'rect', color = '#d93025', widthLevel = 2, baseWidth = 0;
    let observer, container, encrypted = false, sel = null;   // sel = { p, a }
    let undoStack = [], redoStack = [];

    /* ---------- Geometría ---------- */
    const totalRot = p => (p.page.rotate + p.extraRot) % 360;
    const vpAt = (p, rot) => p.page.getViewport({ scale: 1, rotation: rot });
    const BOX = new Set(['image', 'rect', 'whiteout', 'ellipse', 'text']);

    /** Esquinas (en PDF) de un elemento de caja definido en la vista con giro a.rot */
    function boxPdfCorners(p, a) {
      const vr = vpAt(p, a.rot);
      const [ax, ay] = vr.convertToViewportPoint(a.x, a.y);
      return [[ax, ay], [ax + a.w, ay], [ax + a.w, ay + a.h], [ax, ay + a.h]].map(([x, y]) => vr.convertToPdfPoint(x, y));
    }
    /** Caja (en la vista actual) que ocupa un elemento */
    function bboxOf(p, a) {
      let pts;
      if (BOX.has(a.type)) pts = boxPdfCorners(p, a);
      else if (a.type === 'ink') pts = a.pts;
      else pts = [a.p1, a.p2];
      const v = pts.map(q => p.vp.convertToViewportPoint(q[0], q[1]));
      const xs = v.map(q => q[0]), ys = v.map(q => q[1]);
      const pad = a.type === 'ink' || a.type === 'line' ? (a.width * p.vp.scale) / 2 + 2 : 0;
      return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
    }
    /** Crea un elemento de caja a partir de un rectángulo en la vista actual */
    function setBoxFromView(p, a, x, y, w, h) {
      const rot = a.rot, vr = vpAt(p, rot);
      const c1 = p.vp.convertToPdfPoint(x, y), c2 = p.vp.convertToPdfPoint(x + w, y + h);
      const d1 = vr.convertToViewportPoint(c1[0], c1[1]), d2 = vr.convertToViewportPoint(c2[0], c2[1]);
      const nx = Math.min(d1[0], d2[0]), ny = Math.min(d1[1], d2[1]);
      const tl = vr.convertToPdfPoint(nx, ny);
      a.x = tl[0]; a.y = tl[1];
      a.w = Math.abs(d2[0] - d1[0]); a.h = Math.abs(d2[1] - d1[1]);
    }

    /* ---------- Historial (deshacer / rehacer) ---------- */
    const snapshot = () => pages.map(p => ({ anns: p.anns.map(cloneAnn), extraRot: p.extraRot, deleted: p.deleted }));
    function checkpoint() {
      undoStack.push(snapshot());
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack = [];
      updateHistoryButtons();
      ctx.dirty();
    }
    function restore(state) {
      let relayout = false;
      state.forEach((s, i) => {
        const p = pages[i];
        if (p.extraRot !== s.extraRot) relayout = true;
        p.anns = s.anns.map(cloneAnn);
        p.extraRot = s.extraRot;
        setDeleted(p, s.deleted);
      });
      sel = null;
      if (relayout) layoutAll(); else pages.forEach(drawOverlay);
      ctx.dirty();
    }
    function undo() {
      if (!undoStack.length) return toast('No hay nada que deshacer');
      redoStack.push(snapshot());
      restore(undoStack.pop());
      updateHistoryButtons();
    }
    function redo() {
      if (!redoStack.length) return toast('No hay nada que rehacer');
      undoStack.push(snapshot());
      restore(redoStack.pop());
      updateHistoryButtons();
    }
    function updateHistoryButtons() {
      const u = ctx.toolbar.querySelector('[data-act=undo]'), r = ctx.toolbar.querySelector('[data-act=redo]');
      if (u) u.disabled = !undoStack.length;
      if (r) r.disabled = !redoStack.length;
    }

    /* ---------- Barra de herramientas ---------- */
    function buildToolbar() {
      const tb = ctx.toolbar;
      tb.innerHTML = '';
      tb.append(
        UI.tbBtn('undo', 'Deshacer (Ctrl+Z)', undo, { attrs: { 'data-act': 'undo' } }),
        UI.tbBtn('redo', 'Rehacer (Ctrl+Y)', redo, { attrs: { 'data-act': 'redo' } }),
        el('span', { class: 'tb-sep' }));
      for (const [k, icon, label] of TOOLS) {
        const b = UI.tbBtn(icon, label, () => onToolButton(k), { label: k === 'shape' ? SHAPES[shape].split(' ')[0] : label, attrs: { 'data-tool': k } });
        tb.append(b);
      }
      const colorIn = el('input', { type: 'color', class: 'tb-color', value: color, title: 'Color', 'aria-label': 'Color' });
      colorIn.addEventListener('input', () => { color = colorIn.value; });
      colorIn.addEventListener('change', () => { if (sel) applyToSelection(a => { if (a.type !== 'image' && a.type !== 'whiteout') a.color = color; }); });
      const widthSel = el('select', { class: 'tb', title: 'Grosor', 'aria-label': 'Grosor' },
        ...[[1, 'Fino'], [2, 'Medio'], [3, 'Grueso']].map(([v, l]) => el('option', { value: v, selected: v === widthLevel }, l)));
      widthSel.addEventListener('change', () => {
        widthLevel = +widthSel.value;
        if (sel && (sel.a.type === 'ink' || sel.a.type === 'line' || sel.a.type === 'rect' || sel.a.type === 'ellipse')) applyToSelection(a => { a.width = WIDTHS[widthLevel] * (a.hl ? 5 : 1); });
      });
      tb.append(el('span', { class: 'tb-sep' }), colorIn, widthSel,
        el('span', { class: 'tb-sep' }),
        UI.tbBtn('minus', 'Alejar', () => setZoom(zoom / 1.25)),
        UI.tbBtn('plus', 'Acercar', () => setZoom(zoom * 1.25)),
        UI.tbBtn('fit', 'Ajustar al ancho', () => setZoom(1)));
      updateHistoryButtons();
    }

    async function onToolButton(k) {
      if (k === 'shape') {
        const v = await choose('Formas', Object.entries(SHAPES).map(([value, label]) => ({ value, label, icon: { rect: 'square', whiteout: 'whiteout', ellipse: 'circle', line: 'minus', arrow: 'arrowRight' }[value] })));
        if (!v) return;
        shape = v;
        const b = ctx.toolbar.querySelector('[data-tool=shape] span:not(.ic)');
        if (b) b.textContent = SHAPES[v].split(' ')[0];
        if (v === 'whiteout') toast('Arrastra sobre el texto que quieres tapar. Luego puedes escribir encima.', 3500);
        return setTool('shape');
      }
      if (k === 'image') return pickImage();
      if (k === 'sign') return signatureDialog();
      setTool(k);
    }

    function setTool(t) {
      tool = t;
      if (t !== 'select') select(null);
      ctx.toolbar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
      container.classList.toggle('draw-mode', DRAW_TOOLS.has(t));
      container.dataset.tool = t;
      for (const p of pages) p.svg.style.pointerEvents = t === 'view' ? 'none' : 'auto';
    }

    function setZoom(z) {
      zoom = Math.min(5, Math.max(0.4, z));
      layoutAll();
    }

    /* ---------- Diseño y render ---------- */
    function scaleFor(p) {
      // en pantallas grandes la página no pasa de ~900 px para que se lea cómoda
      const avail = Math.min(900, Math.max(200, ctx.workspace.clientWidth - 24));
      // cada página se ajusta a su propio ancho (las horizontales y giradas también caben en pantalla)
      const w = vpAt(p, totalRot(p)).width || baseWidth;
      return (avail / w) * zoom;
    }
    function layoutAll() {
      for (const p of pages) {
        p.vp = p.page.getViewport({ scale: scaleFor(p), rotation: totalRot(p) });
        p.wrap.style.width = p.vp.width + 'px';
        p.wrap.style.height = p.vp.height + 'px';
        p.rendered = false;
        p.svg.setAttribute('viewBox', `0 0 ${p.vp.width} ${p.vp.height}`);
        drawOverlay(p);
      }
      for (const p of pages) { observer.unobserve(p.wrap); observer.observe(p.wrap); }
    }
    async function renderPage(p) {
      if (p.rendered || p.rendering) return;
      p.rendering = true;
      try {
        const vp = p.vp;
        let ratio = Math.min(window.devicePixelRatio || 1, 3);
        const maxPx = 12e6;
        if (vp.width * vp.height * ratio * ratio > maxPx) ratio = Math.sqrt(maxPx / (vp.width * vp.height));
        const c = p.canvas;
        c.width = Math.floor(vp.width * ratio);
        c.height = Math.floor(vp.height * ratio);
        c.style.width = vp.width + 'px';
        c.style.height = vp.height + 'px';
        await p.page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null }).promise;
        p.rendered = vp === p.vp;
      } catch (e) { console.warn(e); }
      p.rendering = false;
      if (!p.rendered && isVisible(p)) renderPage(p);
    }
    const isVisible = p => { const r = p.wrap.getBoundingClientRect(); return r.bottom > -500 && r.top < innerHeight + 500; };

    /* ---------- Dibujo de anotaciones ---------- */
    const svgEl = (name, attrs) => { const n = document.createElementNS(SVGNS, name); for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v); return n; };
    function annNode(p, a) {
      const vp = p.vp, s = vp.scale;
      if (a.type === 'ink') {
        return svgEl('polyline', {
          points: a.pts.map(([x, y]) => vp.convertToViewportPoint(x, y).map(n => n.toFixed(1)).join(',')).join(' '),
          fill: 'none', stroke: a.color, 'stroke-width': a.width * s, 'stroke-linecap': a.hl ? 'butt' : 'round', 'stroke-linejoin': 'round', opacity: a.opacity
        });
      }
      if (a.type === 'line') {
        const [x1, y1] = vp.convertToViewportPoint(...a.p1), [x2, y2] = vp.convertToViewportPoint(...a.p2);
        const g = svgEl('g', { stroke: a.color, 'stroke-width': a.width * s, 'stroke-linecap': 'round', fill: 'none' });
        g.append(svgEl('line', { x1, y1, x2, y2 }));
        if (a.arrow) {
          const ang = Math.atan2(y2 - y1, x2 - x1), L = Math.max(10, a.width * s * 4);
          g.append(svgEl('polyline', { points: `${x2 - L * Math.cos(ang - 0.45)},${y2 - L * Math.sin(ang - 0.45)} ${x2},${y2} ${x2 - L * Math.cos(ang + 0.45)},${y2 - L * Math.sin(ang + 0.45)}`, 'stroke-linejoin': 'round' }));
        }
        return g;
      }
      // elementos de caja: se dibujan en su sistema (vista con giro a.rot) y se giran a la vista actual
      const [ax, ay] = vp.convertToViewportPoint(a.x, a.y);
      const delta = (totalRot(p) - a.rot + 360) % 360;
      const g = svgEl('g', { transform: `translate(${ax} ${ay}) rotate(${delta}) scale(${s})` });
      if (a.type === 'image') g.append(svgEl('image', { href: a.src, x: 0, y: 0, width: a.w, height: a.h, preserveAspectRatio: 'none' }));
      else if (a.type === 'rect') g.append(svgEl('rect', { x: 0, y: 0, width: a.w, height: a.h, fill: 'none', stroke: a.color, 'stroke-width': a.width }));
      else if (a.type === 'ellipse') g.append(svgEl('ellipse', { cx: a.w / 2, cy: a.h / 2, rx: a.w / 2, ry: a.h / 2, fill: 'none', stroke: a.color, 'stroke-width': a.width }));
      else if (a.type === 'whiteout') g.append(svgEl('rect', { x: 0, y: 0, width: a.w, height: a.h, fill: '#ffffff' }));
      else if (a.type === 'text') {
        const t = svgEl('text', { 'font-family': 'Helvetica, Arial, sans-serif', 'font-size': a.size, fill: a.color, 'font-weight': a.bold ? 'bold' : null });
        a.text.split('\n').forEach((line, li) => { const ts = svgEl('tspan', { x: 0, y: a.size * (0.85 + li * 1.2) }); ts.textContent = line || ' '; t.append(ts); });
        g.append(t);
      }
      return g;
    }
    function drawOverlay(p) {
      const svg = p.svg;
      svg.innerHTML = '';
      for (const a of p.anns) svg.append(annNode(p, a));
      p.wrap.querySelectorAll('.pdf-selbar').forEach(n => n.remove());
      if (sel && sel.p === p && p.anns.includes(sel.a)) drawSelection(p, sel.a);
    }
    function drawSelection(p, a) {
      const b = bboxOf(p, a);
      const g = svgEl('g', { class: 'sel-ui' });
      g.append(svgEl('rect', { x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8, fill: 'rgba(26,115,232,.06)', stroke: '#1a73e8', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      g.append(svgEl('circle', { cx: b.x + b.w + 4, cy: b.y + b.h + 4, r: 11, fill: '#1a73e8', stroke: '#fff', 'stroke-width': 2.5, 'data-handle': 'resize', class: 'sel-handle' }));
      p.svg.append(g);
      // barra flotante de acciones
      const bar = el('div', { class: 'pdf-selbar' },
        a.type === 'text' ? el('button', { onclick: () => editText(p, a) }, UI.icon('type', 16), el('span', {}, 'Editar')) : null,
        el('button', { onclick: () => duplicate(p, a) }, UI.icon('copy', 16), el('span', {}, 'Duplicar')),
        el('button', { onclick: () => bringFront(p, a), title: 'Traer al frente' }, UI.icon('layers', 16)),
        el('button', { class: 'danger', onclick: () => removeAnn(p, a) }, UI.icon('trash', 16), el('span', {}, 'Eliminar')));
      const top = b.y - 52 < 0 ? b.y + b.h + 22 : b.y - 52;
      bar.style.top = top + 'px';
      bar.style.left = Math.max(4, Math.min(p.vp.width - 4, b.x + b.w / 2)) + 'px';
      p.wrap.append(bar);
    }
    function select(target) {
      const prev = sel && sel.p;
      sel = target;
      if (prev) drawOverlay(prev);
      if (sel && sel.p !== prev) drawOverlay(sel.p);
    }

    /* ---------- Acciones sobre la selección ---------- */
    function applyToSelection(fn) {
      if (!sel) return;
      checkpoint();
      fn(sel.a);
      if (sel.a.type === 'text') measureText(sel.a);
      drawOverlay(sel.p);
    }
    function removeAnn(p, a) {
      checkpoint();
      p.anns.splice(p.anns.indexOf(a), 1);
      sel = null;
      drawOverlay(p);
    }
    function duplicate(p, a) {
      checkpoint();
      const c = cloneAnn(a);
      // desplazar 12 px en la vista actual
      const o = p.vp.convertToPdfPoint(0, 0), d = p.vp.convertToPdfPoint(14, 14);
      translateAnn(c, d[0] - o[0], d[1] - o[1]);
      p.anns.push(c);
      sel = { p, a: c };
      drawOverlay(p);
    }
    function bringFront(p, a) {
      checkpoint();
      p.anns.splice(p.anns.indexOf(a), 1);
      p.anns.push(a);
      drawOverlay(p);
    }
    function translateAnn(a, dx, dy) {
      if (a.type === 'ink') a.pts.forEach(q => { q[0] += dx; q[1] += dy; });
      else if (a.type === 'line') { a.p1[0] += dx; a.p1[1] += dy; a.p2[0] += dx; a.p2[1] += dy; }
      else { a.x += dx; a.y += dy; }
    }
    /** Escala un elemento para que su caja en la vista pase de b0 a b1 */
    function resizeAnn(p, a, orig, b0, b1) {
      const sx = b1.w / b0.w, sy = b1.h / b0.h;
      const mapPt = q => {
        const [vx, vy] = p.vp.convertToViewportPoint(q[0], q[1]);
        return p.vp.convertToPdfPoint(b1.x + (vx - b0.x) * sx, b1.y + (vy - b0.y) * sy);
      };
      if (a.type === 'ink') { a.pts = orig.pts.map(mapPt); a.width = orig.width * Math.sqrt(sx * sy); }
      else if (a.type === 'line') { a.p1 = mapPt(orig.p1); a.p2 = mapPt(orig.p2); }
      else if (a.type === 'text') {
        a.size = Math.max(4, Math.min(200, orig.size * sx));
        measureText(a);
        // el ancla del texto es su esquina superior izquierda en su propia vista: se recoloca para que la caja empiece en b1
        Object.assign(a, { x: orig.x, y: orig.y });
        const nb = bboxOf(p, a), shift = p.vp.convertToPdfPoint(b1.x - nb.x, b1.y - nb.y), zero = p.vp.convertToPdfPoint(0, 0);
        translateAnn(a, shift[0] - zero[0], shift[1] - zero[1]);
      } else setBoxFromView(p, a, b1.x, b1.y, b1.w, b1.h);
    }

    function hitTest(p, vx, vy) {
      for (let i = p.anns.length - 1; i >= 0; i--) {
        const a = p.anns[i];
        if (a.type === 'ink') {
          const tol = Math.max(10, a.width * p.vp.scale);
          for (let k = 0; k < a.pts.length; k++) {
            const [x, y] = p.vp.convertToViewportPoint(a.pts[k][0], a.pts[k][1]);
            if (Math.hypot(x - vx, y - vy) < tol) return a;
          }
        } else if (a.type === 'line') {
          const [x1, y1] = p.vp.convertToViewportPoint(...a.p1), [x2, y2] = p.vp.convertToViewportPoint(...a.p2);
          const L2 = (x2 - x1) ** 2 + (y2 - y1) ** 2 || 1;
          const t = Math.max(0, Math.min(1, ((vx - x1) * (x2 - x1) + (vy - y1) * (y2 - y1)) / L2));
          if (Math.hypot(vx - (x1 + t * (x2 - x1)), vy - (y1 + t * (y2 - y1))) < Math.max(10, a.width * p.vp.scale)) return a;
        } else {
          const b = bboxOf(p, a);
          if (vx >= b.x - 6 && vx <= b.x + b.w + 6 && vy >= b.y - 6 && vy <= b.y + b.h + 6) return a;
        }
      }
      return null;
    }
    function onHandle(p, vx, vy) {
      if (!sel || sel.p !== p) return false;
      const b = bboxOf(p, sel.a);
      return Math.hypot(vx - (b.x + b.w + 4), vy - (b.y + b.h + 4)) < 22;
    }

    /* ---------- Texto ---------- */
    async function textDialog(initial) {
      const ta = el('textarea', { placeholder: 'Escribe aquí…' });
      ta.value = initial ? initial.text : '';
      const size = el('input', { type: 'number', min: 4, max: 200, value: initial ? Math.round(initial.size) : 14 });
      const bold = el('input', { type: 'checkbox', checked: initial ? !!initial.bold : false });
      const body = el('div', {}, el('label', {}, 'Texto'), ta,
        el('div', { class: 'form-row' }, el('div', {}, el('label', {}, 'Tamaño'), size), el('label', { class: 'check' }, bold, el('span', {}, 'Negrita'))));
      return modal(initial ? 'Editar texto' : 'Agregar texto', body, [
        { label: 'Cancelar', value: null },
        { label: 'Aceptar', primary: true, value: () => ({ text: ta.value, size: Math.max(4, +size.value || 14), bold: bold.checked }) }
      ]);
    }
    async function editText(p, a) {
      const r = await textDialog(a);
      if (!r) return;
      if (!r.text.trim()) return removeAnn(p, a);
      checkpoint();
      Object.assign(a, r);
      measureText(a);
      drawOverlay(p);
    }
    async function addTextAt(p, vx, vy) {
      const r = await textDialog(null);
      if (!r || !r.text.trim()) return;
      checkpoint();
      const [x, y] = p.vp.convertToPdfPoint(vx, vy);
      const a = { type: 'text', x, y, rot: totalRot(p), color, ...r };
      measureText(a);
      p.anns.push(a);
      setTool('select');
      select({ p, a });
    }

    /* ---------- Imágenes y firma ---------- */
    function currentPage() { return pages[pagesApi.current()] || pages[0]; }
    async function prepareImage(blob) {
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la imagen')); i.src = url; });
        let w = img.naturalWidth || 600, h = img.naturalHeight || 400;
        const isJpg = /jpe?g/i.test(blob.type), isPng = /png/i.test(blob.type);
        const k = Math.min(1, 2400 / Math.max(w, h));
        if (k === 1 && (isJpg || isPng)) {
          const data = new Uint8Array(await blob.arrayBuffer());
          return { bytes: data, fmt: isJpg ? 'jpg' : 'png', src: await blobToDataUrl(blob), w, h };
        }
        // otros formatos o imágenes enormes: se redibujan (PNG conserva transparencia)
        const c = el('canvas', { width: Math.round(w * k), height: Math.round(h * k) });
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const type = isJpg ? 'image/jpeg' : 'image/png';
        const out = await new Promise(r => c.toBlob(r, type, 0.9));
        return { bytes: new Uint8Array(await out.arrayBuffer()), fmt: isJpg ? 'jpg' : 'png', src: c.toDataURL(type, 0.9), w: c.width, h: c.height };
      } finally { URL.revokeObjectURL(url); }
    }
    const blobToDataUrl = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });

    function placeImage(info, widthFrac = 0.4) {
      const p = currentPage();
      if (!p) return;
      checkpoint();
      const rot = totalRot(p), vr = vpAt(p, rot);
      let w = vr.width * widthFrac, h = w * info.h / info.w;
      if (h > vr.height * 0.6) { h = vr.height * 0.6; w = h * info.w / info.h; }
      // centrado en la parte visible de la página
      const r = p.wrap.getBoundingClientRect(), ws = ctx.workspace.getBoundingClientRect();
      const visTop = Math.max(r.top, ws.top), visBot = Math.min(r.bottom, ws.bottom);
      const cy = ((visTop + visBot) / 2 - r.top) / p.vp.scale;
      const cx = vr.width / 2;
      const tl = vr.convertToPdfPoint(cx - w / 2, Math.max(0, Math.min(vr.height - h, cy - h / 2)));
      const a = { type: 'image', x: tl[0], y: tl[1], w, h, rot, src: info.src, bytes: info.bytes, fmt: info.fmt };
      p.anns.push(a);
      setTool('select');
      select({ p, a });
      toast('Arrastra la imagen para moverla; usa el punto azul para cambiar su tamaño.', 3500);
    }
    function pickImage() {
      const input = el('input', { type: 'file', accept: 'image/*', hidden: true });
      document.body.append(input);
      input.addEventListener('change', async () => {
        const f = input.files[0];
        input.remove();
        if (!f) return;
        try { placeImage(await prepareImage(f)); } catch (e) { UI.modal('No se pudo insertar', String(e.message || e)); }
      });
      input.click();
    }

    async function signatureDialog() {
      let saved = null;
      try { saved = localStorage.getItem('folio-signature'); } catch {}
      const cw = Math.min(480, window.innerWidth - 72), ch = Math.round(cw * 0.45);
      const canvas = el('canvas', { class: 'sign-pad', width: cw * 2, height: ch * 2, style: { width: cw + 'px', height: ch + 'px' } });
      const g = canvas.getContext('2d');
      g.scale(2, 2); g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 2.6;
      const inkColor = color === '#d93025' ? '#1a2a6c' : color;
      g.strokeStyle = inkColor;
      let drawing = false, empty = true, last = null;
      const pos = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * cw / r.width, (e.clientY - r.top) * ch / r.height]; };
      canvas.addEventListener('pointerdown', e => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); g.beginPath(); g.arc(last[0], last[1], 1.2, 0, 7); g.fillStyle = inkColor; g.fill(); empty = false; e.preventDefault(); });
      canvas.addEventListener('pointermove', e => {
        if (!drawing) return;
        for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) { const q = pos(ev); g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(q[0], q[1]); g.stroke(); last = q; }
      });
      const stop = () => { drawing = false; };
      canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
      const clear = el('button', { class: 'btn', onclick: () => { g.clearRect(0, 0, cw, ch); empty = true; } }, 'Borrar');
      const body = el('div', { class: 'sign-body' }, el('p', { class: 'muted' }, 'Firma con el dedo dentro del recuadro.'), canvas, el('div', { class: 'sign-tools' }, clear,
        saved ? el('button', { class: 'btn', onclick: () => UI.closeModal('saved') }, 'Usar firma guardada') : null));
      const r = await modal('Firma', body, [{ label: 'Cancelar', value: null }, { label: 'Insertar', primary: true, value: 'ok' }]);
      if (r === 'saved' && saved) {
        const blob = await (await fetch(saved)).blob();
        return placeImage(await prepareImage(blob), 0.3);
      }
      if (r !== 'ok') return;
      if (empty) return toast('La firma está vacía');
      // recortar al trazo
      const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
      let x0 = canvas.width, y0 = canvas.height, x1 = 0, y1 = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (data[(y * canvas.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const padPx = 8;
      x0 = Math.max(0, x0 - padPx); y0 = Math.max(0, y0 - padPx); x1 = Math.min(canvas.width - 1, x1 + padPx); y1 = Math.min(canvas.height - 1, y1 + padPx);
      const out = el('canvas', { width: x1 - x0 + 1, height: y1 - y0 + 1 });
      out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      const url = out.toDataURL('image/png');
      try { localStorage.setItem('folio-signature', url); } catch {}
      const blob = await (await fetch(url)).blob();
      placeImage(await prepareImage(blob), 0.3);
    }

    /* ---------- Interacción con el puntero ---------- */
    function attachPointer(p) {
      let drag = null;   // { mode: 'draw'|'shape'|'move'|'resize', ... }
      let lastDown = { a: null, t: 0 };
      const pos = e => { const r = p.svg.getBoundingClientRect(); return [(e.clientX - r.left) * p.vp.width / r.width, (e.clientY - r.top) * p.vp.height / r.height]; };

      // En "Seleccionar", tocar un elemento no desplaza la página; tocar el fondo sí
      p.svg.addEventListener('touchstart', e => {
        if (tool !== 'select' || e.touches.length > 1) return;
        const t = e.touches[0], r = p.svg.getBoundingClientRect();
        const vx = (t.clientX - r.left) * p.vp.width / r.width, vy = (t.clientY - r.top) * p.vp.height / r.height;
        if (onHandle(p, vx, vy) || hitTest(p, vx, vy)) e.preventDefault();
      }, { passive: false });

      p.svg.addEventListener('pointerdown', e => {
        if (tool === 'view' || p.deleted || e.button > 0) return;
        const [vx, vy] = pos(e);
        if (tool === 'pen' || tool === 'hl') {
          e.preventDefault();
          p.svg.setPointerCapture(e.pointerId);
          const s = p.vp.scale, hl = tool === 'hl';
          const a = {
            type: 'ink', hl, color: hl ? (color === '#d93025' ? '#ffeb3b' : color) : color,
            width: (hl ? WIDTHS[widthLevel] * 5 : WIDTHS[widthLevel]) / s * (hl ? 1.1 : 1), opacity: hl ? 0.4 : 1,
            pts: [p.vp.convertToPdfPoint(vx, vy)]
          };
          drag = { mode: 'draw', a, snap: snapshot() };
          p.anns.push(a);
          drawOverlay(p);
        } else if (tool === 'shape') {
          e.preventDefault();
          p.svg.setPointerCapture(e.pointerId);
          drag = { mode: 'shape', start: [vx, vy], snap: snapshot(), a: null };
        } else if (tool === 'select') {
          if (onHandle(p, vx, vy)) {
            e.preventDefault();
            p.svg.setPointerCapture(e.pointerId);
            const b0 = bboxOf(p, sel.a);
            drag = { mode: 'resize', start: [vx, vy], b0, orig: cloneAnn(sel.a), snap: snapshot(), moved: false };
            return;
          }
          const hit = hitTest(p, vx, vy);
          if (hit) {
            e.preventDefault();
            p.svg.setPointerCapture(e.pointerId);
            const now = Date.now();
            const dbl = hit === lastDown.a && now - lastDown.t < 400;
            lastDown = { a: hit, t: now };
            select({ p, a: hit });
            drag = { mode: 'move', last: [vx, vy], start: [vx, vy], snap: snapshot(), moved: false, dbl };
          } else select(null);
        }
      });

      p.svg.addEventListener('pointermove', e => {
        if (!drag) return;
        e.preventDefault();
        const [vx, vy] = pos(e);
        if (drag.mode === 'draw') {
          for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) { const q = pos(ev); drag.a.pts.push(p.vp.convertToPdfPoint(q[0], q[1])); }
          drawOverlay(p);
        } else if (drag.mode === 'shape') {
          const [sx, sy] = drag.start;
          if (!drag.a) {
            if (Math.hypot(vx - sx, vy - sy) < 4) return;
            if (shape === 'line' || shape === 'arrow') drag.a = { type: 'line', arrow: shape === 'arrow', color, width: WIDTHS[widthLevel] / p.vp.scale * 1.2, p1: p.vp.convertToPdfPoint(sx, sy), p2: p.vp.convertToPdfPoint(vx, vy) };
            else drag.a = { type: shape, color, width: WIDTHS[widthLevel] / p.vp.scale * 1.2, rot: totalRot(p), x: 0, y: 0, w: 1, h: 1 };
            p.anns.push(drag.a);
          }
          if (drag.a.type === 'line') drag.a.p2 = p.vp.convertToPdfPoint(vx, vy);
          else setBoxFromView(p, drag.a, Math.min(sx, vx), Math.min(sy, vy), Math.abs(vx - sx), Math.abs(vy - sy));
          drawOverlay(p);
        } else if (drag.mode === 'move') {
          if (!drag.moved && Math.hypot(vx - drag.start[0], vy - drag.start[1]) < 3) return;
          drag.moved = true;
          const o = p.vp.convertToPdfPoint(...drag.last), n = p.vp.convertToPdfPoint(vx, vy);
          translateAnn(sel.a, n[0] - o[0], n[1] - o[1]);
          drag.last = [vx, vy];
          drawOverlay(p);
        } else if (drag.mode === 'resize') {
          drag.moved = true;
          const b0 = drag.b0, a = sel.a;
          let w = Math.max(12, b0.w + (vx - drag.start[0])), h = Math.max(12, b0.h + (vy - drag.start[1]));
          const free = a.type === 'rect' || a.type === 'whiteout' || a.type === 'ellipse';
          if (!free) { const k = Math.max(w / b0.w, h / b0.h); w = b0.w * k; h = b0.h * k; }
          resizeAnn(p, a, drag.orig, b0, { x: b0.x, y: b0.y, w, h });
          drawOverlay(p);
        }
      });

      const end = () => {
        if (!drag) return;
        const d = drag;
        drag = null;
        if (d.mode === 'draw') {
          if (d.a.pts.length === 1) d.a.pts.push([d.a.pts[0][0] + 0.1, d.a.pts[0][1]]);
          pushHistory(d.snap);
        } else if (d.mode === 'shape') {
          if (d.a) { pushHistory(d.snap); if (d.a.type === 'whiteout') { setTool('select'); select({ p, a: d.a }); } }
        } else if ((d.mode === 'move' || d.mode === 'resize') && d.moved) pushHistory(d.snap);
        else if (d.mode === 'move' && d.dbl && sel && sel.a.type === 'text') {
          const a = sel.a;
          setTimeout(() => editText(p, a), 60);   // después del "click" para que no cierre el diálogo
        }
        drawOverlay(p);
      };
      p.svg.addEventListener('pointerup', end);
      p.svg.addEventListener('pointercancel', end);

      // Texto y borrar usan "click" para que el diálogo no se cierre con el mismo toque
      p.svg.addEventListener('click', e => {
        if (p.deleted) return;
        const [vx, vy] = pos(e);
        if (tool === 'text') {
          const hit = hitTest(p, vx, vy);
          if (hit && hit.type === 'text') return editText(p, hit);
          return addTextAt(p, vx, vy);
        }
        if (tool === 'erase') {
          const hit = hitTest(p, vx, vy);
          if (hit) removeAnn(p, hit);
          return;
        }
      });
    }
    function pushHistory(snap) {
      undoStack.push(snap);
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack = [];
      updateHistoryButtons();
      ctx.dirty();
    }

    function onKey(e) {
      if (!container || !container.isConnected) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || !document.getElementById('modal').hidden) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeAnn(sel.p, sel.a); }
      else if (e.key === 'Escape' && sel) select(null);
      else if (mod && k === 'd' && sel) { e.preventDefault(); duplicate(sel.p, sel.a); }
    }

    /* ---------- Páginas: girar / eliminar ---------- */
    function setDeleted(p, v) {
      p.deleted = v;
      p.wrap.classList.toggle('deleted', v);
      p.delBtn.replaceChildren(UI.icon(v ? 'restore' : 'trash', 15), el('span', {}, v ? 'Restaurar' : 'Eliminar'));
    }

    async function open(data) {
      bytes = new Uint8Array(data);
      const task = pdfjsLib.getDocument({ data: bytes.slice(0) });
      task.onPassword = async (cb, reason) => {
        const pw = await UI.prompt(reason === 2 ? 'Contraseña incorrecta' : 'PDF protegido', '', { label: 'Contraseña' });
        if (pw == null) { task.destroy(); return; }
        encrypted = true;
        cb(pw);
      };
      pdf = await task.promise;
      buildToolbar();
      container = el('div', { class: 'pdf-pages' });
      ctx.workspace.append(container);
      observer = new IntersectionObserver(entries => {
        for (const en of entries) if (en.isIntersecting) renderPage(en.target._p);
      }, { root: ctx.workspace, rootMargin: '600px 0px' });

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        if (i === 1) baseWidth = page.getViewport({ scale: 1 }).width;
        const p = { page, index: i - 1, extraRot: 0, anns: [], deleted: false };
        p.canvas = el('canvas');
        p.svg = document.createElementNS(SVGNS, 'svg');
        p.svg.style.pointerEvents = 'none';
        p.wrap = el('div', { class: 'pdf-page' }, p.canvas, p.svg);
        p.wrap._p = p;
        p.delBtn = el('button', {}, UI.icon('trash', 15), el('span', {}, 'Eliminar'));
        p.delBtn.onclick = () => {
          if (!p.deleted && pages.filter(x => !x.deleted).length === 1) return toast('El documento debe conservar al menos una página');
          checkpoint();
          setDeleted(p, !p.deleted);
        };
        const label = el('div', { class: 'pdf-label' }, el('span', { class: 'pg' }, `${i} / ${pdf.numPages}`),
          el('button', { onclick: () => { checkpoint(); p.extraRot = (p.extraRot + 90) % 360; layoutAll(); } }, UI.icon('rotate', 15), el('span', {}, 'Girar')), p.delBtn);
        container.append(p.wrap, label);
        attachPointer(p);
        pages.push(p);
      }
      layoutAll();
      setTool('view');
      let rt;
      api._onResize = () => { clearTimeout(rt); rt = setTimeout(layoutAll, 200); };
      window.addEventListener('resize', api._onResize);
      document.addEventListener('keydown', onKey);
    }

    /* ---------- Guardar ---------- */
    /**
     * Dibuja las anotaciones de una página en una página de pdf-lib.
     * T convierte un punto del PDF original al espacio de la página destino.
     */
    async function drawAnnotations(doc, pg, p, T, fonts, imgCache) {
      const { rgb, degrees, LineCapStyle } = PDFLib;
      const safe = (font, str) => [...str].map(ch => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
      for (const a of p.anns) {
        const col = a.color ? rgb(...hexToRgb(a.color)) : rgb(0, 0, 0);
        if (a.type === 'ink') {
          for (let i = 1; i < a.pts.length; i++) {
            const s = T(a.pts[i - 1]), e = T(a.pts[i]);
            pg.drawLine({ start: { x: s[0], y: s[1] }, end: { x: e[0], y: e[1] }, thickness: a.width, color: col, opacity: a.opacity, lineCap: a.hl ? LineCapStyle.Butt : LineCapStyle.Round });
          }
          continue;
        }
        if (a.type === 'line') {
          const s = T(a.p1), e = T(a.p2);
          pg.drawLine({ start: { x: s[0], y: s[1] }, end: { x: e[0], y: e[1] }, thickness: a.width, color: col, lineCap: LineCapStyle.Round });
          if (a.arrow) {
            const ang = Math.atan2(e[1] - s[1], e[0] - s[0]), L = Math.max(7, a.width * 4);
            for (const d of [-0.45, 0.45]) pg.drawLine({ start: { x: e[0], y: e[1] }, end: { x: e[0] - L * Math.cos(ang + d), y: e[1] - L * Math.sin(ang + d) }, thickness: a.width, color: col, lineCap: LineCapStyle.Round });
          }
          continue;
        }
        // elementos de caja: origen = esquina inferior izquierda de su vista, girado según esa vista
        const vr = vpAt(p, a.rot);
        const [ax, ay] = vr.convertToViewportPoint(a.x, a.y);
        const P = (dx, dy) => T(vr.convertToPdfPoint(ax + dx, ay + dy));
        const origin = P(0, a.h), right = P(1, a.h);
        const angle = Math.round(Math.atan2(right[1] - origin[1], right[0] - origin[0]) * 180 / Math.PI);
        if (a.type === 'image') {
          let img = imgCache.get(a.bytes);
          if (!img) { img = a.fmt === 'jpg' ? await doc.embedJpg(a.bytes) : await doc.embedPng(a.bytes); imgCache.set(a.bytes, img); }
          pg.drawImage(img, { x: origin[0], y: origin[1], width: a.w, height: a.h, rotate: degrees(angle) });
        } else if (a.type === 'rect' || a.type === 'whiteout') {
          pg.drawRectangle({ x: origin[0], y: origin[1], width: a.w, height: a.h, rotate: degrees(angle),
            ...(a.type === 'whiteout' ? { color: rgb(1, 1, 1) } : { borderColor: col, borderWidth: a.width }) });
        } else if (a.type === 'ellipse') {
          const c = P(a.w / 2, a.h / 2);
          pg.drawEllipse({ x: c[0], y: c[1], xScale: a.w / 2, yScale: a.h / 2, rotate: degrees(angle), borderColor: col, borderWidth: a.width });
        } else if (a.type === 'text') {
          const font = a.bold ? fonts.bold : fonts.regular;
          a.text.split('\n').forEach((line, li) => {
            if (!line) return;
            const o = P(0, a.size * (0.85 + li * 1.2));
            pg.drawText(safe(font, line), { x: o[0], y: o[1], size: a.size, font, color: col, rotate: degrees(angle) });
          });
        }
      }
    }

    async function save() {
      const { PDFDocument, StandardFonts, degrees } = PDFLib;
      if (encrypted) return saveFlattened();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
      const imgCache = new Map();
      for (const p of pages) {
        const pg = doc.getPage(p.index);
        if (p.extraRot) pg.setRotation(degrees((pg.getRotation().angle + p.extraRot) % 360));
        await drawAnnotations(doc, pg, p, q => q, fonts, imgCache);
      }
      const del = pages.filter(p => p.deleted).map(p => p.index).sort((a, b) => b - a);
      if (del.length === pages.length) throw new Error('No puedes eliminar todas las páginas.');
      for (const i of del) doc.removePage(i);
      return new Blob([await doc.save()], { type: 'application/pdf' });
    }

    /**
     * PDF protegido con contraseña: pdf-lib no puede reescribirlo, así que se crea una copia
     * sin contraseña con cada página como imagen de alta calidad y las anotaciones encima.
     */
    async function saveFlattened() {
      const { PDFDocument, StandardFonts } = PDFLib;
      const live = pages.filter(p => !p.deleted);
      if (!live.length) throw new Error('No puedes eliminar todas las páginas.');
      toast('El PDF tenía contraseña: se guardará una copia sin contraseña.', 4000);
      const doc = await PDFDocument.create();
      const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
      const imgCache = new Map();
      for (const p of live) {
        const rot = totalRot(p), vp1 = vpAt(p, rot);
        const k = Math.min(2.5, Math.sqrt(16e6 / (vp1.width * vp1.height)));
        const vpk = p.page.getViewport({ scale: k, rotation: rot });
        const c = document.createElement('canvas');
        c.width = Math.ceil(vpk.width); c.height = Math.ceil(vpk.height);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await p.page.render({ canvasContext: g, viewport: vpk }).promise;
        const jpg = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
        const img = await doc.embedJpg(await jpg.arrayBuffer());
        const W = vp1.width, H = vp1.height;
        const pg = doc.addPage([W, H]);
        pg.drawImage(img, { x: 0, y: 0, width: W, height: H });
        await drawAnnotations(doc, pg, p, q => { const [vx, vy] = vp1.convertToViewportPoint(q[0], q[1]); return [vx, H - vy]; }, fonts, imgCache);
      }
      return new Blob([await doc.save()], { type: 'application/pdf' });
    }

    function destroy() {
      observer && observer.disconnect();
      window.removeEventListener('resize', api._onResize);
      document.removeEventListener('keydown', onKey);
      pdf && pdf.destroy();
    }

    /* ---------- Navegación de páginas ---------- */
    const cleanSvg = p => { const svg = p.svg.cloneNode(true); svg.querySelectorAll('.sel-ui').forEach(n => n.remove()); return svg; };
    const pagesApi = {
      label: 'Página',
      count: () => pages.length,
      current() { return UI.visiblePage(pages.map(p => p.wrap), ctx.workspace, pagesApi); },
      goTo(i) {
        i = Math.max(0, Math.min(pages.length - 1, i));
        const p = pages[i];
        if (!p) return;
        pagesApi.target = i; pagesApi._settling = true; clearTimeout(pagesApi._t); pagesApi._t = setTimeout(() => { pagesApi._settling = false; }, 900);
        ctx.workspace.scrollTo({ top: p.wrap.offsetTop - 12, behavior: 'smooth' });
      },
      async thumb(i, width) {
        const p = pages[i];
        const vp1 = vpAt(p, totalRot(p));
        const k = (width * Math.min(2, window.devicePixelRatio || 1)) / vp1.width;
        const vp = p.page.getViewport({ scale: k, rotation: totalRot(p) });
        const c = el('canvas', { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
        await p.page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        if (p.anns.length) {
          const svg = cleanSvg(p);
          svg.setAttribute('width', c.width); svg.setAttribute('height', c.height);
          const img = new Image();
          await new Promise(r => { img.onload = r; img.onerror = r; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)); });
          try { c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); } catch {}
        }
        if (p.deleted) c.style.opacity = '.3';
        return c;
      }
    };

    /** Contenido para imprimir: cada página como imagen nítida con sus anotaciones, a su tamaño original */
    async function printable() {
      const root = el('div', { class: 'print-pdf' });
      const sizes = new Map();
      let css = '';
      for (const p of pages) {
        if (p.deleted) continue;
        const rot = totalRot(p), vp1 = vpAt(p, rot);
        const wIn = +(vp1.width / 72).toFixed(3), hIn = +(vp1.height / 72).toFixed(3);
        const key = wIn + 'x' + hIn;
        if (!sizes.has(key)) { const name = 'pdfp' + sizes.size; sizes.set(key, name); css += `@page ${name} { size: ${wIn}in ${hIn}in; margin: 0; }`; }
        const k = Math.min(2.5, Math.sqrt(14e6 / (vp1.width * vp1.height)));
        const vp = p.page.getViewport({ scale: k, rotation: rot });
        const c = el('canvas', { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await p.page.render({ canvasContext: g, viewport: vp }).promise;
        const box = { width: wIn + 'in', height: (hIn - 0.01) + 'in' };
        root.append(el('div', { class: 'print-page', style: { ...box, page: sizes.get(key) } },
          el('img', { src: c.toDataURL('image/jpeg', 0.92), alt: '', style: box }), cleanSvg(p)));
      }
      return { node: root, page: css + '@page { margin: 0; }' };
    }

    const api = { open, save, destroy, ext: 'pdf', kind: 'pdf', pages: pagesApi, printable, undo, redo };
    return api;
  }
  return { create };
})();
