/* Editor de PDF: visor (pdf.js) + anotaciones guardadas con pdf-lib */
const PdfEditor = (() => {
  const { el, toast, modal, confirm } = UI;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  const TOOLS = { view: 'Ver', text: 'Texto', pen: 'Lápiz', hl: 'Resaltar', erase: 'Borrar' };

  function create(ctx) {
    let bytes, pdf, pages = [], zoom = 1, tool = 'view', color = '#d93025', baseWidth = 0;
    const history = [];
    let observer, container, encrypted = false;

    const hexToRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

    function buildToolbar() {
      const tb = ctx.toolbar;
      tb.innerHTML = '';
      for (const [k, label] of Object.entries(TOOLS)) {
        const b = UI.tbBtn({ view: 'pointer', text: 'type', pen: 'pen', hl: 'marker', erase: 'eraser' }[k], label, () => setTool(k), { label, attrs: { 'data-tool': k } });
        if (tool === k) b.classList.add('on');
        tb.append(b);
      }
      const colorIn = el('input', { type: 'color', class: 'tb-color', value: color, title: 'Color' });
      colorIn.addEventListener('input', () => (color = colorIn.value));
      tb.append(el('span', { class: 'tb-sep' }), colorIn,
        UI.tbBtn('undo', 'Deshacer', undo),
        el('span', { class: 'tb-sep' }),
        UI.tbBtn('minus', 'Alejar', () => setZoom(zoom / 1.25)),
        UI.tbBtn('plus', 'Acercar', () => setZoom(zoom * 1.25)),
        UI.tbBtn('fit', 'Ajustar al ancho', () => setZoom(1)));
    }

    function setTool(t) {
      tool = t;
      ctx.toolbar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
      container.classList.toggle('draw-mode', t !== 'view');
      for (const p of pages) p.svg.style.pointerEvents = t === 'view' ? 'none' : 'auto';
    }

    function setZoom(z) {
      zoom = Math.min(5, Math.max(0.4, z));
      layoutAll();
    }

    function scaleFor(p) {
      // en pantallas grandes la página no pasa de ~900 px para que se lea cómoda
      const avail = Math.min(900, Math.max(200, ctx.workspace.clientWidth - 24));
      // cada página se ajusta a su propio ancho (las horizontales y giradas también caben en pantalla)
      const w = p.page.getViewport({ scale: 1, rotation: (p.page.rotate + p.extraRot) % 360 }).width || baseWidth;
      return (avail / w) * zoom;
    }

    function viewportFor(p) {
      return p.page.getViewport({ scale: scaleFor(p), rotation: (p.page.rotate + p.extraRot) % 360 });
    }

    function layoutAll() {
      for (const p of pages) {
        p.vp = viewportFor(p);
        p.wrap.style.width = p.vp.width + 'px';
        p.wrap.style.height = p.vp.height + 'px';
        p.rendered = false;
        p.svg.setAttribute('viewBox', `0 0 ${p.vp.width} ${p.vp.height}`);
        drawOverlay(p);
      }
      // volver a observar para que se rendericen las visibles
      for (const p of pages) { observer.unobserve(p.wrap); observer.observe(p.wrap); }
    }

    async function renderPage(p) {
      if (p.rendered || p.rendering) return;
      p.rendering = true;
      try {
        const vp = p.vp;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        let ratio = dpr;
        const maxPx = 12e6;
        if (vp.width * vp.height * ratio * ratio > maxPx) ratio = Math.sqrt(maxPx / (vp.width * vp.height));
        const c = p.canvas;
        c.width = Math.floor(vp.width * ratio);
        c.height = Math.floor(vp.height * ratio);
        c.style.width = vp.width + 'px';
        c.style.height = vp.height + 'px';
        const task = p.page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
        await task.promise;
        p.rendered = vp === p.vp;
      } catch (e) { console.warn(e); }
      p.rendering = false;
      if (!p.rendered && isVisible(p)) renderPage(p);
    }
    const isVisible = p => { const r = p.wrap.getBoundingClientRect(); return r.bottom > -500 && r.top < innerHeight + 500; };

    /* ----- Anotaciones (guardadas en coordenadas PDF) ----- */
    const SVGNS = 'http://www.w3.org/2000/svg';
    function drawOverlay(p) {
      const svg = p.svg, vp = p.vp, s = vp.scale;
      svg.innerHTML = '';
      p.anns.forEach((a, i) => {
        if (a.type === 'ink') {
          const pts = a.pts.map(([x, y]) => vp.convertToViewportPoint(x, y).map(n => n.toFixed(1)).join(',')).join(' ');
          const pl = document.createElementNS(SVGNS, 'polyline');
          pl.setAttribute('points', pts);
          pl.setAttribute('fill', 'none');
          pl.setAttribute('stroke', a.color);
          pl.setAttribute('stroke-width', a.width * s);
          pl.setAttribute('stroke-linecap', a.hl ? 'butt' : 'round');
          pl.setAttribute('stroke-linejoin', 'round');
          pl.setAttribute('opacity', a.opacity);
          pl.dataset.i = i;
          svg.append(pl);
        } else if (a.type === 'text') {
          const [x, y] = vp.convertToViewportPoint(a.x, a.y);
          const t = document.createElementNS(SVGNS, 'text');
          t.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
          t.setAttribute('font-size', a.size * s);
          t.setAttribute('fill', a.color);
          t.dataset.i = i;
          a.text.split('\n').forEach((line, li) => {
            const ts = document.createElementNS(SVGNS, 'tspan');
            ts.setAttribute('x', x);
            ts.setAttribute('y', y + a.size * s * (0.85 + li * 1.2));
            ts.textContent = line || ' ';
            t.append(ts);
          });
          svg.append(t);
        }
      });
    }

    function hitTest(p, vx, vy) {
      const s = p.vp.scale;
      for (let i = p.anns.length - 1; i >= 0; i--) {
        const a = p.anns[i];
        if (a.type === 'text') {
          const [x, y] = p.vp.convertToViewportPoint(a.x, a.y);
          const lines = a.text.split('\n');
          const w = Math.max(...lines.map(l => l.length)) * a.size * s * 0.55;
          const h = lines.length * a.size * s * 1.2;
          if (vx >= x - 6 && vx <= x + w + 6 && vy >= y - 6 && vy <= y + h + 6) return i;
        } else {
          const tol = Math.max(10, a.width * s);
          for (const [px, py] of a.pts) {
            const [x, y] = p.vp.convertToViewportPoint(px, py);
            if (Math.hypot(x - vx, y - vy) < tol) return i;
          }
        }
      }
      return -1;
    }

    async function textDialog(initial) {
      const ta = el('textarea', { placeholder: 'Escribe aquí…' });
      ta.value = initial ? initial.text : '';
      const size = el('input', { type: 'number', min: 6, max: 96, value: initial ? initial.size : 14 });
      const body = el('div', {}, el('label', {}, 'Texto'), ta, el('label', {}, 'Tamaño de letra'), size);
      const buttons = [{ label: 'Cancelar', value: null }];
      if (initial) buttons.push({ label: 'Eliminar', value: 'delete', danger: true });
      buttons.push({ label: 'Aceptar', primary: true, value: () => ({ text: ta.value, size: Math.max(6, +size.value || 14) }) });
      return modal(initial ? 'Editar texto' : 'Agregar texto', body, buttons);
    }

    function attachPointer(p) {
      let cur = null;
      const pos = e => { const r = p.svg.getBoundingClientRect(); return [(e.clientX - r.left) * p.vp.width / r.width, (e.clientY - r.top) * p.vp.height / r.height]; };
      p.svg.addEventListener('pointerdown', async e => {
        if (tool === 'view' || p.deleted) return;
        const [vx, vy] = pos(e);
        if (tool === 'pen' || tool === 'hl') {
          e.preventDefault();
          p.svg.setPointerCapture(e.pointerId);
          const s = p.vp.scale;
          cur = {
            type: 'ink', hl: tool === 'hl', color: tool === 'hl' ? (color === '#d93025' ? '#ffeb3b' : color) : color,
            width: (tool === 'hl' ? 14 : 2.5) / s, opacity: tool === 'hl' ? 0.4 : 1,
            pts: [p.vp.convertToPdfPoint(vx, vy)]
          };
          p.anns.push(cur);
          drawOverlay(p);
        }
      });
      // Texto y borrar usan "click" para que el diálogo no se cierre con el mismo toque
      p.svg.addEventListener('click', async e => {
        if (p.deleted || (tool !== 'text' && tool !== 'erase')) return;
        const [vx, vy] = pos(e);
        if (tool === 'text') {
          const hit = hitTest(p, vx, vy);
          if (hit >= 0 && p.anns[hit].type === 'text') {
            const a = p.anns[hit];
            const r = await textDialog(a);
            if (r === 'delete') p.anns.splice(hit, 1);
            else if (r && r.text.trim()) { a.text = r.text; a.size = r.size; a.color = color; }
            drawOverlay(p); ctx.dirty();
            return;
          }
          const r = await textDialog(null);
          if (r && r.text.trim()) {
            const [x, y] = p.vp.convertToPdfPoint(vx, vy);
            const a = { type: 'text', x, y, text: r.text, size: r.size, color };
            p.anns.push(a); history.push(p);
            drawOverlay(p); ctx.dirty();
          }
        } else if (tool === 'erase') {
          const hit = hitTest(p, vx, vy);
          if (hit >= 0) { p.anns.splice(hit, 1); drawOverlay(p); ctx.dirty(); }
        }
      });
      p.svg.addEventListener('pointermove', e => {
        if (!cur) return;
        e.preventDefault();
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of evs) { const [vx, vy] = pos(ev); cur.pts.push(p.vp.convertToPdfPoint(vx, vy)); }
        drawOverlay(p);
      });
      const end = () => {
        if (!cur) return;
        if (cur.pts.length === 1) cur.pts.push([cur.pts[0][0] + 0.1, cur.pts[0][1]]);
        history.push(p); cur = null; ctx.dirty();
      };
      p.svg.addEventListener('pointerup', end);
      p.svg.addEventListener('pointercancel', end);
    }

    function undo() {
      while (history.length) {
        const p = history.pop();
        if (p.anns.length) { p.anns.pop(); drawOverlay(p); return; }
      }
      toast('Nada que deshacer');
    }

    async function open(data, name) {
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
        const delBtn = el('button', {}, UI.icon('trash', 15), el('span', {}, 'Eliminar'));
        delBtn.onclick = () => {
          p.deleted = !p.deleted;
          p.wrap.classList.toggle('deleted', p.deleted);
          delBtn.replaceChildren(UI.icon(p.deleted ? 'restore' : 'trash', 15), el('span', {}, p.deleted ? 'Restaurar' : 'Eliminar'));
          ctx.dirty();
        };
        const label = el('div', { class: 'pdf-label' }, el('span', { class: 'pg' }, `${i} / ${pdf.numPages}`),
          el('button', { onclick: () => { p.extraRot = (p.extraRot + 90) % 360; layoutAll(); ctx.dirty(); } }, UI.icon('rotate', 15), el('span', {}, 'Girar')), delBtn);
        container.append(p.wrap, label);
        attachPointer(p);
        pages.push(p);
      }
      layoutAll();
      setTool('view');
      let rt;
      window.addEventListener('resize', onResize);
      function onResize() { clearTimeout(rt); rt = setTimeout(layoutAll, 200); }
      api._onResize = onResize;
    }

    async function save() {
      const { PDFDocument, StandardFonts, rgb, degrees, LineCapStyle } = PDFLib;
      if (encrypted) return saveFlattened();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const safe = str => [...str].map(ch => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
      for (const p of pages) {
        const pg = doc.getPage(p.index);
        if (p.extraRot) pg.setRotation(degrees((pg.getRotation().angle + p.extraRot) % 360));
        for (const a of p.anns) {
          const [r, g, b] = hexToRgb(a.color);
          const col = rgb(r, g, b);
          if (a.type === 'ink') {
            for (let i = 1; i < a.pts.length; i++) {
              pg.drawLine({
                start: { x: a.pts[i - 1][0], y: a.pts[i - 1][1] }, end: { x: a.pts[i][0], y: a.pts[i][1] },
                thickness: a.width, color: col, opacity: a.opacity,
                lineCap: a.hl ? LineCapStyle.Butt : LineCapStyle.Round
              });
            }
          } else {
            // Orientar el texto según cómo se ve la página (páginas giradas)
            const vp1 = p.page.getViewport({ scale: 1, rotation: (p.page.rotate + p.extraRot) % 360 });
            const [vx, vy] = vp1.convertToViewportPoint(a.x, a.y);
            const o = vp1.convertToPdfPoint(vx, vy), dn = vp1.convertToPdfPoint(vx, vy + 1), rt = vp1.convertToPdfPoint(vx + 1, vy);
            const down = [dn[0] - o[0], dn[1] - o[1]];
            const angle = Math.round(Math.atan2(rt[1] - o[1], rt[0] - o[0]) * 180 / Math.PI);
            a.text.split('\n').forEach((line, li) => {
              if (!line) return;
              const off = a.size * (0.85 + li * 1.2);
              pg.drawText(safe(line), { x: a.x + down[0] * off, y: a.y + down[1] * off, size: a.size, font, color: col, rotate: degrees(angle) });
            });
          }
        }
      }
      const del = pages.filter(p => p.deleted).map(p => p.index).sort((a, b) => b - a);
      if (del.length === pages.length) throw new Error('No puedes eliminar todas las páginas.');
      for (const i of del) doc.removePage(i);
      const out = await doc.save();
      return new Blob([out], { type: 'application/pdf' });
    }

    /**
     * PDF protegido con contraseña: pdf-lib no puede reescribirlo, así que se crea una copia
     * sin contraseña con cada página como imagen de alta calidad y las anotaciones encima.
     */
    async function saveFlattened() {
      const { PDFDocument, StandardFonts, rgb, LineCapStyle } = PDFLib;
      const live = pages.filter(p => !p.deleted);
      if (!live.length) throw new Error('No puedes eliminar todas las páginas.');
      toast('El PDF tenía contraseña: se guardará una copia sin contraseña.', 4000);
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const safe = str => [...str].map(ch => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
      for (const p of live) {
        const rot = (p.page.rotate + p.extraRot) % 360;
        const vp1 = p.page.getViewport({ scale: 1, rotation: rot });
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
        const pt = (x, y) => { const [vx, vy] = vp1.convertToViewportPoint(x, y); return { x: vx, y: H - vy }; };
        for (const a of p.anns) {
          const [r, gg, b] = hexToRgb(a.color);
          const col = rgb(r, gg, b);
          if (a.type === 'ink') {
            for (let i = 1; i < a.pts.length; i++) pg.drawLine({ start: pt(...a.pts[i - 1]), end: pt(...a.pts[i]), thickness: a.width, color: col, opacity: a.opacity, lineCap: a.hl ? LineCapStyle.Butt : LineCapStyle.Round });
          } else {
            const o = pt(a.x, a.y);
            a.text.split('\n').forEach((line, li) => { if (line) pg.drawText(safe(line), { x: o.x, y: o.y - a.size * (0.85 + li * 1.2), size: a.size, font, color: col }); });
          }
        }
      }
      return new Blob([await doc.save()], { type: 'application/pdf' });
    }

    function destroy() {
      observer && observer.disconnect();
      window.removeEventListener('resize', api._onResize);
      pdf && pdf.destroy();
    }

    /* ----- Navegación de páginas ----- */
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
        const vp1 = p.page.getViewport({ scale: 1, rotation: (p.page.rotate + p.extraRot) % 360 });
        const k = (width * Math.min(2, window.devicePixelRatio || 1)) / vp1.width;
        const vp = p.page.getViewport({ scale: k, rotation: (p.page.rotate + p.extraRot) % 360 });
        const c = el('canvas', { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
        await p.page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        if (p.anns.length) {
          // anotaciones encima de la miniatura
          const svg = p.svg.cloneNode(true);
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
        const rot = (p.page.rotate + p.extraRot) % 360;
        const vp1 = p.page.getViewport({ scale: 1, rotation: rot });
        const wIn = +(vp1.width / 72).toFixed(3), hIn = +(vp1.height / 72).toFixed(3);
        const key = wIn + 'x' + hIn;
        if (!sizes.has(key)) { const name = 'pdfp' + sizes.size; sizes.set(key, name); css += `@page ${name} { size: ${wIn}in ${hIn}in; margin: 0; }`; }
        const k = Math.min(2.5, Math.sqrt(14e6 / (vp1.width * vp1.height)));
        const vp = p.page.getViewport({ scale: k, rotation: rot });
        const c = el('canvas', { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await p.page.render({ canvasContext: g, viewport: vp }).promise;
        const svg = p.svg.cloneNode(true);
        const box = { width: wIn + 'in', height: (hIn - 0.01) + 'in' };
        root.append(el('div', { class: 'print-page', style: { ...box, page: sizes.get(key) } },
          el('img', { src: c.toDataURL('image/jpeg', 0.92), alt: '', style: box }), svg));
      }
      return { node: root, page: css + '@page { margin: 0; }' };
    }

    const api = { open, save, destroy, ext: 'pdf', kind: 'pdf', pages: pagesApi, printable };
    return api;
  }
  return { create };
})();
