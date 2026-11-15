/* Editor de PowerPoint (.pptx): renderiza diapositivas desde el XML y edita el texto en su lugar */
const PptEditor = (() => {
  const { el, toast, confirm, choose } = UI;
  const NS = {
    p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    pr: 'http://schemas.openxmlformats.org/package/2006/relationships',
    ct: 'http://schemas.openxmlformats.org/package/2006/content-types'
  };
  const DESIGN_W = 960;          // ancho de diseño en px de cada diapositiva
  const EMU_PT = 12700;

  /* ---------- Utilidades XML ---------- */
  const kids = (n, name) => n ? [...n.children].filter(c => c.localName === name) : [];
  const kid = (n, name) => n ? [...n.children].find(c => c.localName === name) || null : null;
  const path = (n, p) => p.split('/').reduce((acc, s) => acc && kid(acc, s), n);
  const attr = (n, a) => (n ? n.getAttribute(a) : null);
  const rAttr = (n, a) => (n ? n.getAttributeNS(NS.r, a) || n.getAttribute('r:' + a) : null);
  const parseXml = s => new DOMParser().parseFromString(s, 'application/xml');
  const serialize = d => new XMLSerializer().serializeToString(d);

  function resolvePath(base, target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = base.split('/'); parts.pop();
    for (const seg of target.split('/')) {
      if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  }
  const relsPathOf = part => { const i = part.lastIndexOf('/'); return part.slice(0, i) + '/_rels/' + part.slice(i + 1) + '.rels'; };

  /* ---------- Colores ---------- */
  function hexToRgb(h) { const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b); let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
    }
    return [h, s, l];
  }
  function hslToRgb([h, s, l]) {
    if (s === 0) return [l, l, l].map(v => Math.round(v * 255));
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
  }

  function create(ctx) {
    let zip, slideW, slideH, k, presDoc, presRels, presPath = 'ppt/presentation.xml';
    const slides = [];          // {path, doc, rels, layout, master, dom, shapes:[]}
    const partCache = {};       // path -> {doc, rels}
    const blobUrls = [];
    let list, current = 0, moveMode = false, picked = null, theme = { colors: {}, major: 'Calibri', minor: 'Calibri' }, clrMap = {};

    async function loadPart(p) {
      if (partCache[p]) return partCache[p];
      const f = zip.file(p);
      if (!f) return null;
      const doc = parseXml(await f.async('string'));
      const rels = {};
      const rf = zip.file(relsPathOf(p));
      if (rf) {
        const rd = parseXml(await rf.async('string'));
        for (const r of rd.documentElement.children) {
          rels[r.getAttribute('Id')] = {
            type: r.getAttribute('Type').split('/').pop(),
            target: r.getAttribute('TargetMode') === 'External' ? r.getAttribute('Target') : resolvePath(p, r.getAttribute('Target')),
            external: r.getAttribute('TargetMode') === 'External'
          };
        }
      }
      return (partCache[p] = { path: p, doc, rels });
    }
    const relOfType = (part, t) => Object.values(part.rels).find(r => r.type === t);

    function color(fillParent) {
      // fillParent: elemento que contiene srgbClr/schemeClr/... (p.ej. a:solidFill)
      if (!fillParent) return null;
      const c = [...fillParent.children].find(x => /Clr$/.test(x.localName));
      if (!c) return null;
      let hex = null;
      if (c.localName === 'srgbClr') hex = attr(c, 'val');
      else if (c.localName === 'sysClr') hex = attr(c, 'lastClr') || (attr(c, 'val') === 'window' ? 'FFFFFF' : '000000');
      else if (c.localName === 'schemeClr') {
        let v = attr(c, 'val');
        if (v === 'phClr') v = 'tx1';
        v = clrMap[v] || v;
        hex = theme.colors[v];
      } else if (c.localName === 'prstClr') {
        hex = { black: '000000', white: 'FFFFFF', red: 'FF0000', blue: '0000FF', green: '00FF00', yellow: 'FFFF00' }[attr(c, 'val')] || '000000';
      }
      if (!hex) return null;
      let rgb = hexToRgb(hex), alpha = 1;
      for (const m of c.children) {
        const v = +attr(m, 'val') / 100000;
        if (m.localName === 'lumMod' || m.localName === 'lumOff') {
          const hsl = rgbToHsl(rgb);
          hsl[2] = m.localName === 'lumMod' ? hsl[2] * v : Math.min(1, hsl[2] + v);
          rgb = hslToRgb(hsl);
        } else if (m.localName === 'tint') rgb = rgb.map(x => Math.round(x + (255 - x) * (1 - v)));
        else if (m.localName === 'shade') rgb = rgb.map(x => Math.round(x * v));
        else if (m.localName === 'alpha') alpha = v;
      }
      return alpha < 1 ? `rgba(${rgb.join(',')},${alpha})` : `rgb(${rgb.join(',')})`;
    }

    function fillCss(spPr, style, part) {
      if (!spPr && !style) return null;
      if (kid(spPr, 'noFill')) return 'transparent';
      const sf = kid(spPr, 'solidFill');
      if (sf) return color(sf);
      const gf = kid(spPr, 'gradFill');
      if (gf) {
        const stops = kids(kid(gf, 'gsLst'), 'gs').map(g => `${color(g) || '#fff'} ${+attr(g, 'pos') / 1000}%`);
        const lin = kid(gf, 'lin');
        const ang = lin ? (+attr(lin, 'ang') / 60000 + 90) : 180;
        return stops.length ? `linear-gradient(${ang}deg, ${stops.join(',')})` : null;
      }
      const bf = kid(spPr, 'blipFill');
      if (bf && part) { const u = blipUrl(bf, part); return u ? `url("${u}") center/cover` : null; }
      const fr = kid(style, 'fillRef');
      if (fr && +attr(fr, 'idx') > 0) return color(fr);
      return null;
    }

    function blipUrl(blipFill, part) {
      const blip = kid(blipFill, 'blip');
      const id = rAttr(blip, 'embed');
      if (!id || !part.rels[id]) return null;
      return mediaUrl(part.rels[id].target);
    }
    const mediaCache = {};
    const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp' };
    const mediaUrl = p => mediaCache[p] || null;
    async function preloadMedia() {
      for (const part of Object.values(partCache)) {
        for (const r of Object.values(part.rels)) {
          if (r.type !== 'image' || r.external || r.target in mediaCache) continue;
          const f = zip.file(r.target), mime = MIME[r.target.split('.').pop().toLowerCase()];
          if (!f || !mime) { mediaCache[r.target] = null; continue; }
          const url = URL.createObjectURL(new Blob([await f.async('uint8array')], { type: mime }));
          blobUrls.push(url);
          mediaCache[r.target] = url;
        }
      }
    }

    /* ---------- Placeholders / herencia ---------- */
    const phOf = sp => path(sp, 'nvSpPr/nvPr/ph') || path(sp, 'nvPicPr/nvPr/ph') || path(sp, 'nvGraphicFramePr/nvPr/ph');
    const phType = ph => attr(ph, 'type') || 'body';
    function findPh(part, ph) {
      if (!part || !ph) return null;
      const tree = path(part.doc.documentElement, 'cSld/spTree');
      const all = [];
      (function walk(n) { for (const c of n.children) { if (c.localName === 'grpSp') walk(c); else if (phOf(c)) all.push(c); } })(tree);
      const idx = attr(ph, 'idx'), type = phType(ph);
      const norm = t => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' ? 'body' : t);
      return (idx != null && all.find(s => attr(phOf(s), 'idx') === idx && (phType(phOf(s)) === type || !attr(ph, 'type'))))
        || all.find(s => phType(phOf(s)) === type)
        || all.find(s => norm(phType(phOf(s))) === norm(type))
        || null;
    }
    function chainFor(sp, slide, level) {
      // level: 0 slide, 1 layout, 2 master
      const ph = phOf(sp);
      const chain = [sp];
      if (ph && level < 1) { const l = findPh(slide.layout, ph); if (l) chain.push(l); }
      if (ph && level < 2) { const m = findPh(slide.master, ph); if (m) chain.push(m); }
      return chain;
    }
    function xfrmOf(chain) {
      for (const s of chain) {
        const x = path(s, 'spPr/xfrm') || path(s, 'xfrm');
        if (x && kid(x, 'off')) return x;
      }
      return null;
    }
    function txStyleFor(sp, slide) {
      const ph = phOf(sp);
      const st = path(slide.master.doc.documentElement, 'txStyles');
      if (!st) return null;
      if (!ph) return kid(st, 'otherStyle');
      const t = phType(ph);
      if (t === 'title' || t === 'ctrTitle') return kid(st, 'titleStyle');
      if (['body', 'subTitle', 'obj'].includes(t) || !attr(ph, 'type')) return kid(st, 'bodyStyle');
      return kid(st, 'otherStyle');
    }
    // Devuelve la lista de lvlNpPr de la cadena de herencia (más específico primero)
    function lvlProps(chain, sp, slide, lvl) {
      const out = [];
      for (const s of chain) { const l = path(s, `txBody/lstStyle/lvl${lvl + 1}pPr`); if (l) out.push(l); }
      const ts = txStyleFor(sp, slide);
      const l = ts && kid(ts, `lvl${lvl + 1}pPr`);
      if (l) out.push(l);
      // otherStyle no es aplicable a cajas de texto normales: usa defaultTextStyle de la presentación
      if (!phOf(sp)) { const d = path(presDoc.documentElement, `defaultTextStyle/lvl${lvl + 1}pPr`); if (d) out.push(d); }
      return out;
    }

    function fontFace(rPr, defs) {
      for (const r of [rPr, ...defs.map(d => kid(d, 'defRPr'))]) {
        const lat = kid(r, 'latin');
        if (lat) {
          const tf = attr(lat, 'typeface');
          if (tf === '+mj-lt') return theme.major; if (tf === '+mn-lt') return theme.minor;
          if (tf) return tf;
        }
      }
      return null;
    }

    function pText(p) {
      let t = '';
      for (const c of p.children) {
        if (c.localName === 'r' || c.localName === 'fld') t += (kid(c, 't') || {}).textContent || '';
        else if (c.localName === 'br') t += '\n';
      }
      return t;
    }

    /* ---------- Render ---------- */
    async function renderSlide(slide, idx) {
      const root = el('div', { class: 'ppt-slide', style: { width: DESIGN_W + 'px', height: slideH * k + 'px', transformOrigin: '0 0' } });
      slide.shapes = [];
      // fondo
      let bg = null;
      for (const part of [slide, slide.layout, slide.master]) {
        if (!part) continue;
        const b = path(part.doc.documentElement, 'cSld/bg');
        if (!b) continue;
        const bgPr = kid(b, 'bgPr'), bgRef = kid(b, 'bgRef');
        bg = bgPr ? fillCss(bgPr, null, part) : bgRef ? color(bgRef) : null;
        if (bg) break;
      }
      root.style.background = bg || '#fff';

      const showMaster = n => attr(n.doc.documentElement, 'showMasterSp') !== '0';
      if (slide.master && showMaster(slide) && showMaster(slide.layout)) await renderTree(slide.master, root, slide, 2);
      if (slide.layout && showMaster(slide)) await renderTree(slide.layout, root, slide, 1);
      await renderTree(slide, root, slide, 0);

      const holder = el('div', { style: { position: 'relative', flex: 'none' } }, root);
      holder._root = root;
      holder.addEventListener('focusin', () => setCurrent(idx));
      holder.addEventListener('pointerdown', () => setCurrent(idx));
      return holder;
    }

    async function renderTree(part, root, slide, level) {
      const tree = path(part.doc.documentElement, 'cSld/spTree');
      if (!tree) return;
      await renderChildren(tree, part, root, slide, level, v => v);
    }

    async function renderChildren(tree, part, root, slide, level, tx) {
      for (const n of [...tree.children]) {
        if (level > 0 && phOf(n)) continue; // placeholders de diseño no se dibujan
        if (n.localName === 'sp') renderSp(n, part, root, slide, level, tx);
        else if (n.localName === 'pic') await renderPic(n, part, root, tx);
        else if (n.localName === 'grpSp') {
          const x = path(n, 'grpSpPr/xfrm');
          let ntx = tx;
          if (x && kid(x, 'off') && kid(x, 'chOff')) {
            const o = kid(x, 'off'), e = kid(x, 'ext'), co = kid(x, 'chOff'), ce = kid(x, 'chExt');
            const sx = (+attr(e, 'cx') || 1) / (+attr(ce, 'cx') || 1), sy = (+attr(e, 'cy') || 1) / (+attr(ce, 'cy') || 1);
            ntx = b => tx({ x: +attr(o, 'x') + (b.x - attr(co, 'x')) * sx, y: +attr(o, 'y') + (b.y - attr(co, 'y')) * sy, w: b.w * sx, h: b.h * sy });
          }
          await renderChildren(n, part, root, slide, level, ntx);
        } else if (n.localName === 'graphicFrame') {
          const uri = attr(path(n, 'graphic/graphicData'), 'uri') || '';
          if (/\/chart$/.test(uri)) await renderChart(n, part, root, tx);
          else if (level === 0) renderTable(n, part, root, slide, tx);
        }
      }
    }

    function boxOf(x) {
      const o = kid(x, 'off'), e = kid(x, 'ext');
      return { x: +attr(o, 'x'), y: +attr(o, 'y'), w: +attr(e, 'cx') || 0, h: +attr(e, 'cy') || 0, rot: +attr(x, 'rot') || 0, flipH: attr(x, 'flipH') === '1', flipV: attr(x, 'flipV') === '1' };
    }
    function place(div, b, raw) {
      Object.assign(div.style, { left: b.x * k + 'px', top: b.y * k + 'px', width: b.w * k + 'px', height: b.h * k + 'px' });
      const t = [];
      if (raw.rot) t.push(`rotate(${raw.rot / 60000}deg)`);
      if (raw.flipH) t.push('scaleX(-1)');
      if (raw.flipV) t.push('scaleY(-1)');
      if (t.length) div.style.transform = t.join(' ');
    }

    async function renderPic(n, part, root, tx) {
      const x = path(n, 'spPr/xfrm');
      if (!x) return;
      const raw = boxOf(x), b = tx(raw);
      const bf = kid(n, 'blipFill');
      const url = bf && blipUrl(bf, part);
      if (!url) return;
      const img = el('img', { class: 'ppt-pic', src: url, alt: '' });
      place(img, b, raw);
      root.append(img);
    }

    function renderSp(sp, part, root, slide, level, tx) {
      const chain = chainFor(sp, slide, level);
      const x = xfrmOf(chain);
      if (!x) return;
      const raw = boxOf(x), b = tx(raw);
      const div = el('div', { class: 'ppt-shape' });
      place(div, b, raw);
      const spPr = kid(sp, 'spPr');
      const fill = fillCss(spPr, kid(sp, 'style'), part);
      if (fill) div.style.background = fill;
      const geom = attr(path(sp, 'spPr/prstGeom'), 'prst');
      if (geom === 'ellipse') div.style.borderRadius = '50%';
      else if (geom === 'roundRect') div.style.borderRadius = Math.min(b.w, b.h) * k * 0.16 + 'px';
      const ln = kid(spPr, 'ln');
      if (ln && !kid(ln, 'noFill')) {
        const lc = color(kid(ln, 'solidFill'));
        if (lc) div.style.border = `${Math.max(1, (+attr(ln, 'w') || 12700) * k)}px solid ${lc}`;
      } else if (!ln && kid(sp, 'style') && +attr(path(sp, 'style/lnRef'), 'idx') > 0 && !phOf(sp) && fill && fill !== 'transparent') {
        const lc = color(path(sp, 'style/lnRef'));
        if (lc) div.style.border = `1px solid ${lc}`;
      }

      const txBody = kid(sp, 'txBody');
      const editable = level === 0 && !!txBody;
      if (txBody) renderText(div, txBody, chain, sp, slide, editable);
      if (editable) {
        div.classList.add('editable');
        const info = { sp, txBody, div, slide, raw, part };
        slide.shapes.push(info);
        div._info = info;
        attachMove(div, info);
      }
      root.append(div);
    }


    /* ---------- Gráficos (barras, líneas, áreas, circulares) ---------- */
    async function renderChart(gf, part, root, tx) {
      const x = kid(gf, 'xfrm');
      const cref = path(gf, 'graphic/graphicData/chart');
      const rid = cref && rAttr(cref, 'id');
      if (!x || !rid || !part.rels[rid]) return;
      const raw = boxOf(x), b = tx(raw);
      const cp = await loadPart(part.rels[rid].target);
      if (!cp) return;
      const W = b.w * k, H = b.h * k;
      const div = el('div', { class: 'ppt-shape' });
      place(div, b, raw);
      const plot = path(cp.doc.documentElement, 'chart/plotArea');
      if (!plot) return;
      const types = [...plot.children].filter(c => /Chart$/.test(c.localName));
      if (!types.length) return;
      const num = n => (n ? [...n.getElementsByTagNameNS('*', 'pt')].sort((a, b) => attr(a, 'idx') - attr(b, 'idx')).map(p => { const v = (kid(p, 'v') || {}).textContent; return v; }) : []);
      const series = [];
      for (const t of types) for (const ser of kids(t, 'ser')) {
        const name = (ser.getElementsByTagNameNS('*', 'v')[0] && kid(ser, 'tx')) ? [...kid(ser, 'tx').getElementsByTagNameNS('*', 'v')].map(v => v.textContent).join(' ') : '';
        const cats = num(kid(ser, 'cat') || kid(ser, 'xVal'));
        const vals = num(kid(ser, 'val') || kid(ser, 'yVal')).map(v => +v || 0);
        const fill = color(path(ser, 'spPr/solidFill')) || color(path(ser, 'spPr/ln/solidFill'));
        series.push({ type: t.localName, dir: attr(kid(t, 'barDir'), 'val'), name, cats, vals, fill, ser });
      }
      if (!series.length) return;
      const accents = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map(a => theme.colors[a] ? '#' + theme.colors[a] : null);
      const pal = i => accents[i % 6] || ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'][i % 6];
      const titleEl = path(cp.doc.documentElement, 'chart/title');
      let title = titleEl ? [...titleEl.getElementsByTagNameNS('*', 't')].map(t => t.textContent).join('') : '';
      const autoDel = attr(path(cp.doc.documentElement, 'chart/autoTitleDeleted'), 'val');
      if (!title && series.length === 1 && (titleEl || (autoDel !== '1' && autoDel !== 'true'))) title = series[0].name;
      const fs = Math.max(9, Math.min(16, H * 0.045));
      const esc = UI.xmlEsc;
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Calibri, Carlito, Arial, sans-serif" font-size="${fs}" fill="#404040">`;
      let top = 6;
      if (title) { svg += `<text x="${W / 2}" y="${fs * 1.5}" text-anchor="middle" font-size="${fs * 1.3}">${esc(title)}</text>`; top = fs * 2.4; }
      const isPie = /pie|doughnut/i.test(series[0].type);
      const legendItems = isPie ? series[0].cats.map((c, i) => ({ name: c, col: (() => { const dp = kids(series[0].ser, 'dPt').find(d => +attr(kid(d, 'idx'), 'val') === i); return (dp && color(path(dp, 'spPr/solidFill'))) || pal(i); })() }))
        : series.map((s, i) => ({ name: s.name, col: s.fill || pal(i) }));
      const showLegend = !!path(cp.doc.documentElement, 'chart/legend') && legendItems.some(l => l.name);
      const bottom = H - (showLegend ? fs * 2.2 : 6);
      if (showLegend) {
        const itemW = legendItems.map(l => fs * 1.4 + String(l.name).length * fs * 0.55 + fs);
        let lx = Math.max(4, (W - itemW.reduce((a, c) => a + c, 0)) / 2);
        legendItems.forEach((l, i) => {
          svg += `<rect x="${lx}" y="${H - fs * 1.5}" width="${fs * 0.8}" height="${fs * 0.8}" fill="${l.col}"/><text x="${lx + fs * 1.1}" y="${H - fs * 0.75}">${esc(l.name)}</text>`;
          lx += itemW[i];
        });
      }
      if (isPie) {
        const s0 = series[0], total = s0.vals.reduce((a, c) => a + Math.max(0, c), 0) || 1;
        const cx = W / 2, cy = (top + bottom) / 2, r = Math.max(4, Math.min(W, bottom - top) / 2 - 4);
        const hole = /doughnut/i.test(s0.type) ? r * 0.5 : 0;
        let a0 = -Math.PI / 2;
        s0.vals.forEach((v, i) => {
          const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const p = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
          const d = hole ? `M${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}L${p(hole, a1)}A${hole},${hole} 0 ${large} 0 ${p(hole, a0)}Z` : `M${cx},${cy}L${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}Z`;
          svg += `<path d="${s0.vals.length === 1 ? `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0` : d}" fill="${legendItems[i].col}" stroke="#fff" stroke-width="1"/>`;
          a0 = a1;
        });
      } else {
        const horiz = series.some(s => s.dir === 'bar');
        const all = series.flatMap(s => s.vals);
        let max = Math.max(0, ...all), min = Math.min(0, ...all);
        if (max === min) max = min + 1;
        const step = (() => { const rough = (max - min) / 5, mag = 10 ** Math.floor(Math.log10(rough)); return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rough); })();
        max = Math.ceil(max / step) * step; min = Math.floor(min / step) * step;
        const cats = series[0].cats.length ? series[0].cats : series[0].vals.map((_, i) => String(i + 1));
        const n = cats.length;
        const fmt = v => (Math.abs(v) >= 1000 ? v.toLocaleString() : String(+v.toFixed(2)));
        const labW = horiz ? Math.min(W * 0.3, Math.max(...cats.map(c => String(c).length)) * fs * 0.55 + 8) : Math.max(...[max, min].map(v => fmt(v).length)) * fs * 0.6 + 8;
        const L = labW, R = W - 8, T = top, B = bottom - fs * 1.6;
        const scale = v => (horiz ? L + ((v - min) / (max - min)) * (R - L) : B - ((v - min) / (max - min)) * (B - T));
        for (let v = min; v <= max + step / 2; v += step) {
          const q = scale(v);
          svg += horiz ? `<line x1="${q}" y1="${T}" x2="${q}" y2="${B}" stroke="#d9d9d9"/><text x="${q}" y="${B + fs * 1.2}" text-anchor="middle">${fmt(v)}</text>`
            : `<line x1="${L}" y1="${q}" x2="${R}" y2="${q}" stroke="#d9d9d9"/><text x="${L - 6}" y="${q + fs * 0.35}" text-anchor="end">${fmt(v)}</text>`;
        }
        const band = ((horiz ? B - T : R - L) / n);
        const bars = series.filter(s => /bar/i.test(s.type)), nb = bars.length;
        cats.forEach((c, i) => {
          const mid = (horiz ? T : L) + band * (i + 0.5);
          svg += horiz ? `<text x="${L - 6}" y="${mid + fs * 0.35}" text-anchor="end">${esc(c)}</text>` : `<text x="${mid}" y="${B + fs * 1.2}" text-anchor="middle">${esc(c)}</text>`;
        });
        series.forEach((s, si) => {
          const col = s.fill || pal(si);
          if (/bar/i.test(s.type)) {
            const bi = bars.indexOf(s), gw = band * 0.7, bw = gw / nb;
            s.vals.forEach((v, i) => {
              const o = (horiz ? T : L) + band * i + (band - gw) / 2 + bw * bi;
              const a = scale(0), z = scale(v);
              svg += horiz ? `<rect x="${Math.min(a, z)}" y="${o}" width="${Math.abs(z - a)}" height="${bw * 0.92}" fill="${col}"/>`
                : `<rect x="${o}" y="${Math.min(a, z)}" width="${bw * 0.92}" height="${Math.abs(z - a)}" fill="${col}"/>`;
            });
          } else {
            const pts = s.vals.map((v, i) => [L + band * (i + 0.5), scale(v)]);
            if (/area/i.test(s.type)) svg += `<path d="M${pts[0][0]},${scale(0)}L${pts.map(p => p.join(',')).join('L')}L${pts[pts.length - 1][0]},${scale(0)}Z" fill="${col}" opacity=".75"/>`;
            else svg += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="${Math.max(1.5, fs * 0.2)}" stroke-linejoin="round"/>` + pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="${fs * 0.22}" fill="${col}"/>`).join('');
          }
        });
        svg += horiz ? `<line x1="${scale(0)}" y1="${T}" x2="${scale(0)}" y2="${B}" stroke="#a6a6a6"/>` : `<line x1="${L}" y1="${scale(0)}" x2="${R}" y2="${scale(0)}" stroke="#a6a6a6"/>`;
      }
      div.innerHTML = svg + '</svg>';
      root.append(div);
    }

    function renderTable(gf, part, root, slide, tx) {
      const tbl = path(gf, 'graphic/graphicData/tbl');
      const x = kid(gf, 'xfrm');
      if (!tbl || !x) return;
      const raw = boxOf(x), b = tx(raw);
      const div = el('div', { class: 'ppt-shape' });
      place(div, b, raw);
      div.style.height = 'auto';
      const t = el('table', { style: { borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' } });
      const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map(c => +attr(c, 'w') * k);
      t.append(el('colgroup', {}, cols.map(w => el('col', { style: { width: w + 'px' } }))));
      const fakeSp = gf;
      for (const tr of kids(tbl, 'tr')) {
        const row = el('tr', { style: { height: +attr(tr, 'h') * k + 'px' } });
        for (const tc of kids(tr, 'tc')) {
          if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') continue;
          const td = el('td', { colspan: attr(tc, 'gridSpan') || null, rowspan: attr(tc, 'rowSpan') || null, style: { border: '1px solid #8a8a8a', verticalAlign: 'top', padding: 0 } });
          const tcPr = kid(tc, 'tcPr');
          const f = tcPr && fillCss(tcPr, null, part);
          if (f) td.style.background = f;
          const txBody = kid(tc, 'txBody');
          if (txBody) {
            const cell = el('div', { class: 'ppt-shape editable', style: { position: 'static', padding: '4px 6px' } });
            renderText(cell, txBody, [tc], fakeSp, slide, true, 18);
            slide.shapes.push({ sp: null, txBody, div: cell, slide, isCell: true });
            td.append(cell);
          }
          row.append(td);
        }
        t.append(row);
      }
      div.append(t);
      root.append(div);
    }

    function renderText(div, txBody, chain, sp, slide, editable, fallbackSz) {
      // bodyPr con herencia
      const bodyPrs = chain.map(s => path(s, 'txBody/bodyPr') || kid(s, 'bodyPr')).filter(Boolean);
      const bp = a => { for (const b of bodyPrs) { const v = attr(b, a); if (v != null) return v; } return null; };
      const anchor = bp('anchor') || 't';
      div.style.justifyContent = { t: 'flex-start', ctr: 'center', b: 'flex-end' }[anchor] || 'flex-start';
      const ins = (a, d) => (+(bp(a) ?? d)) * k + 'px';
      div.style.padding = `${ins('tIns', 45720)} ${ins('rIns', 91440)} ${ins('bIns', 45720)} ${ins('lIns', 91440)}`;
      const vert = bp('vert');
      if (vert === 'vert' || vert === 'eaVert') div.style.writingMode = 'vertical-rl';
      let fontScale = 1, lnSpcRed = 0;
      for (const b of bodyPrs) {
        const na = kid(b, 'normAutofit');
        if (na) { fontScale = (+attr(na, 'fontScale') || 100000) / 100000; lnSpcRed = (+attr(na, 'lnSpcReduction') || 0) / 100000; break; }
      }
      const wrapNone = bp('wrap') === 'none';
      const isTitle = (() => { const ph = phOf(sp); return ph && /title/i.test(phType(ph)); })();
      const container = el('div', { class: 'ppt-text' });
      const paras = [];
      for (const p of kids(txBody, 'p')) {
        const node = renderPara(p, chain, sp, slide, editable, { fontScale, lnSpcRed, wrapNone, fallbackSz: fallbackSz || (isTitle ? 44 : 18) });
        container.append(node);
        paras.push({ el: node, src: p, orig: pText(p) });
      }
      div.append(container);
      div._paras = paras;
      div._render = { chain, sp, slide, opts: { fontScale, lnSpcRed, wrapNone, fallbackSz: fallbackSz || (isTitle ? 44 : 18) } };
    }

    function renderPara(p, chain, sp, slide, editable, opts) {
      const pPr = kid(p, 'pPr');
      const lvl = +attr(pPr, 'lvl') || 0;
      const defs = lvlProps(chain, sp, slide, lvl);
      const pp = a => { if (attr(pPr, a) != null) return attr(pPr, a); for (const d of defs) if (attr(d, a) != null) return attr(d, a); return null; };
      const pKid = name => kid(pPr, name) || defs.map(d => kid(d, name)).find(Boolean) || null;
      const defR = a => { for (const d of defs) { const r = kid(d, 'defRPr'); if (r && attr(r, a) != null) return attr(r, a); } return null; };
      const defRKid = name => { for (const d of defs) { const r = kid(d, 'defRPr'); const c = r && kid(r, name); if (c) return c; } return null; };
      const node = el('div', { class: 'ppt-p' });
      if (editable) {
        node.contentEditable = 'true';
        node.spellcheck = true;
        node.addEventListener('keydown', paraKeys);
        node.addEventListener('input', () => ctx.dirty());
      }
      const algn = pp('algn');
      node.style.textAlign = { ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[algn] || 'left';
      const marL = +pp('marL') || 0, indent = +pp('indent') || 0;
      node.style.paddingLeft = marL * k + 'px';
      node.style.textIndent = indent * k + 'px';
      if (opts.wrapNone) node.style.whiteSpace = 'pre';
      const lnPct = pKid('lnSpc') && path(pKid('lnSpc'), 'spcPct');
      const ln = (lnPct ? +attr(lnPct, 'val') / 100000 : 1) * (1 - opts.lnSpcRed);
      node.style.lineHeight = (1.2 * ln).toFixed(2);
      const spcB = pKid('spcBef') && path(pKid('spcBef'), 'spcPts');
      if (spcB) node.style.marginTop = +attr(spcB, 'val') / 100 * EMU_PT * k * opts.fontScale + 'px';

      const firstR = kid(p, 'r');
      const firstRPr = (firstR && kid(firstR, 'rPr')) || kid(p, 'endParaRPr');
      const szOf = rPr => ((+attr(rPr, 'sz') || +defR('sz') || opts.fallbackSz * 100) / 100) * opts.fontScale;
      const pSz = szOf(firstRPr);
      node.style.fontSize = pSz * EMU_PT * k + 'px';
      const defColor = color(defRKid('solidFill')) || color(parseXml(`<a:x xmlns:a="${NS.a}"><a:schemeClr val="tx1"/></a:x>`).documentElement);
      node.style.color = defColor || '#000';
      const face = fontFace(firstRPr, defs) || theme.minor;
      if (face) node.style.fontFamily = `"${face}", Calibri, Carlito, Arial, sans-serif`;
      if (defR('b') === '1') node.style.fontWeight = 'bold';

      // viñeta
      const hasText = pText(p).trim().length > 0;
      if (hasText && !pKid('buNone')) {
        const bc = pKid('buChar');
        const ba = pKid('buAutoNum');
        if (bc) node.dataset.bu = attr(bc, 'char');
        else if (ba) node.dataset.bu = '•';
        if (node.dataset.bu) { node.style.setProperty('--bu', `"${node.dataset.bu.replace(/"/g, '')} "`); node.classList.add('bu'); }
      }

      for (const c of p.children) {
        if (c.localName === 'r' || c.localName === 'fld') {
          const rPr = kid(c, 'rPr');
          const span = el('span', {}, (kid(c, 't') || {}).textContent || '');
          if (attr(rPr, 'sz')) span.style.fontSize = szOf(rPr) * EMU_PT * k + 'px';
          const b = attr(rPr, 'b'), i = attr(rPr, 'i'), u = attr(rPr, 'u');
          if (b === '1') span.style.fontWeight = 'bold'; else if (b === '0') span.style.fontWeight = 'normal';
          if (i === '1') span.style.fontStyle = 'italic';
          if (u && u !== 'none') span.style.textDecoration = 'underline';
          if (attr(rPr, 'strike') && attr(rPr, 'strike') !== 'noStrike') span.style.textDecoration = 'line-through';
          const col = color(kid(rPr, 'solidFill'));
          if (col) span.style.color = col;
          const f = rPr && fontFace(rPr, []);
          if (f) span.style.fontFamily = `"${f}", sans-serif`;
          const base = attr(rPr, 'baseline');
          if (base) { span.style.verticalAlign = +base > 0 ? 'super' : 'sub'; span.style.fontSize = '0.7em'; }
          node.append(span);
        } else if (c.localName === 'br') node.append(document.createElement('br'));
      }
      return node;
    }

    /* Enter crea un párrafo nuevo; Retroceso en un párrafo vacío lo elimina */
    function paraKeys(e) {
      const node = e.currentTarget;
      const shape = node.closest('.ppt-shape');
      const paras = shape._paras;
      const idx = paras.findIndex(x => x.el === node);
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const sel = getSelection();
        let tail = '';
        if (sel.rangeCount) {
          const r = sel.getRangeAt(0);
          r.deleteContents();
          const after = document.createRange();
          after.setStart(r.endContainer, r.endOffset);
          after.setEnd(node, node.childNodes.length);
          const frag = after.extractContents();
          const tmp = document.createElement('div'); tmp.append(frag);
          tail = domText(tmp);
        }
        const src = paras[idx].src.cloneNode(true);
        const { chain, sp, slide, opts } = shape._render;
        // párrafo nuevo con el mismo formato
        for (const c of [...src.children]) if (c.localName !== 'pPr' && c.localName !== 'endParaRPr' && c.localName !== 'r') c.remove();
        const runsX = kids(src, 'r');
        runsX.slice(1).forEach(r => r.remove());
        if (runsX[0]) kid(runsX[0], 't').textContent = tail || 'x';
        const nn = renderPara(src, chain, sp, slide, true, opts);
        nn.textContent = tail;
        node.after(nn);
        paras.splice(idx + 1, 0, { el: nn, src, orig: null });
        nn.focus();
        ctx.dirty();
      } else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        document.execCommand('insertLineBreak');
      } else if (e.key === 'Backspace' && domText(node) === '' && paras.length > 1 && idx > 0) {
        e.preventDefault();
        const prev = paras[idx - 1].el;
        node.remove();
        paras.splice(idx, 1);
        prev.focus();
        const s = getSelection(); s.selectAllChildren(prev); s.collapseToEnd();
        ctx.dirty();
      }
    }

    function domText(node) {
      let t = '';
      (function walk(n) {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) t += c.nodeValue;
          else if (c.nodeName === 'BR') t += '\n';
          else if (c.nodeName === 'DIV' || c.nodeName === 'P') { if (t && !t.endsWith('\n')) t += '\n'; walk(c); }
          else walk(c);
        }
      })(node);
      return t.replace(/​/g, '').replace(/\n$/, '');
    }

    /* ---------- Mover cuadros ---------- */
    function attachMove(div, info) {
      let start = null;
      div.addEventListener('pointerdown', e => {
        if (!moveMode) return;
        e.preventDefault();
        pick(div);
        div.setPointerCapture(e.pointerId);
        const scale = info.slide.dom._root.getBoundingClientRect().width / DESIGN_W;
        start = { x: e.clientX, y: e.clientY, l: parseFloat(div.style.left), t: parseFloat(div.style.top), scale };
      });
      div.addEventListener('pointermove', e => {
        if (!start) return;
        div.style.left = start.l + (e.clientX - start.x) / start.scale + 'px';
        div.style.top = start.t + (e.clientY - start.y) / start.scale + 'px';
      });
      const end = () => {
        if (!start) return;
        start = null;
        info.moved = { x: Math.round(parseFloat(div.style.left) / k), y: Math.round(parseFloat(div.style.top) / k) };
        ctx.dirty();
      };
      div.addEventListener('pointerup', end);
      div.addEventListener('pointercancel', end);
      div.addEventListener('focusin', () => pick(div));
    }
    function pick(div) {
      if (picked) picked.classList.remove('picked');
      picked = div; div.classList.add('picked');
    }

    function setMoveMode(on) {
      moveMode = on;
      ctx.toolbar.querySelector('[data-move]').classList.toggle('on', on);
      list.querySelectorAll('.ppt-p').forEach(p => (p.contentEditable = on ? 'false' : 'true'));
      list.querySelectorAll('.ppt-shape.editable').forEach(d => (d.style.cursor = on ? 'move' : ''));
      list.style.touchAction = on ? 'pan-y' : '';
      if (on) toast('Arrastra un cuadro de texto para moverlo');
    }

    /* ---------- Escalado y navegación ---------- */
    function fit() {
      const avail = Math.max(200, ctx.workspace.clientWidth - 20);
      // la diapositiva completa debe caber en pantalla (importante en celular horizontal)
      const availH = Math.max(160, ctx.workspace.clientHeight - 70);
      const w = Math.min(avail, 1100, availH * slideW / slideH);
      const s = w / DESIGN_W;
      for (const sl of slides) {
        const h = sl.dom;
        h.style.width = w + 'px';
        h.style.height = slideH * k * s + 'px';
        h._root.style.transform = `scale(${s})`;
      }
    }
    function setCurrent(i) {
      current = i;
      slides.forEach((s, j) => s.dom._root.classList.toggle('current', j === i));
    }

    async function buildList() {
      list.innerHTML = '';
      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        s.dom = await renderSlide(s, i);
        list.append(s.dom, el('div', { class: 'ppt-num' }, `${i + 1} / ${slides.length}`));
      }
      fit();
      setCurrent(Math.min(current, slides.length - 1));
      if (moveMode) setMoveMode(true);
    }

    function buildToolbar() {
      const tb = ctx.toolbar;
      tb.innerHTML = '';
      const fmt = (label, title, c) => el('button', { class: 'tb', title, 'aria-label': title, onmousedown: e => e.preventDefault(), onclick: () => { document.execCommand(c); ctx.dirty(); } }, label);
      tb.append(
        UI.tbBtn('play', 'Presentar', present, { label: 'Presentar' }),
        el('span', { class: 'tb-sep' }),
        UI.tbBtn('textbox', 'Agregar cuadro de texto', addTextBox, { label: 'Texto' }),
        UI.tbBtn('move', 'Mover cuadros', () => setMoveMode(!moveMode), { label: 'Mover', attrs: { 'data-move': 1 } }),
        UI.tbBtn('trash', 'Eliminar cuadro seleccionado', deleteBox),
        el('span', { class: 'tb-sep' }),
        fmt(el('b', { class: 'glyph' }, 'B'), 'Negrita', 'bold'), fmt(el('i', { class: 'glyph' }, 'I'), 'Cursiva', 'italic'), fmt(el('u', { class: 'glyph' }, 'U'), 'Subrayado', 'underline'),
        el('span', { class: 'tb-sep' }),
        UI.tbBtn('copy', 'Duplicar diapositiva', duplicateSlide, { label: 'Duplicar' }),
        UI.tbBtn('trash', 'Eliminar diapositiva', deleteSlide, { label: 'Diapositiva' })
      );
    }

    /* ---------- Edición estructural ---------- */
    function newSpXml(id, x, y, w, h, text) {
      const xml = `<p:sp xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:nvSpPr><p:cNvPr id="${id}" name="CuadroTexto ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
        `<p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="es-ES" sz="2400" dirty="0"/><a:t>${UI.xmlEsc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
      return parseXml(xml).documentElement;
    }
    function maxId(doc) { let m = 1; doc.querySelectorAll('*').forEach(n => { if (n.localName === 'cNvPr') m = Math.max(m, +n.getAttribute('id') || 0); }); return m; }

    async function addTextBox() {
      const s = slides[current];
      if (!s) return;
      const tree = path(s.doc.documentElement, 'cSld/spTree');
      const sp = s.doc.importNode(newSpXml(maxId(s.doc) + 1, Math.round(slideW * 0.2), Math.round(slideH * 0.4), Math.round(slideW * 0.6), Math.round(slideH * 0.15), 'Nuevo texto'), true);
      tree.append(sp);
      syncText();
      await rerenderSlide(current);
      const info = s.shapes.find(x => x.sp === sp);
      if (info) { const p = info.div.querySelector('.ppt-p'); p.focus(); getSelection().selectAllChildren(p); }
      ctx.dirty();
    }

    async function deleteBox() {
      if (!picked || !picked._info) return toast('Toca primero un cuadro de texto');
      const info = picked._info;
      if (!(await confirm('Eliminar cuadro', '¿Eliminar este cuadro de texto?', 'Eliminar', true))) return;
      syncText();
      info.sp.remove();
      picked = null;
      const i = slides.indexOf(info.slide);
      await rerenderSlide(i);
      ctx.dirty();
    }

    async function rerenderSlide(i) {
      const s = slides[i];
      const old = s.dom;
      s.dom = await renderSlide(s, i);
      old.replaceWith(s.dom);
      fit(); setCurrent(i);
      if (moveMode) setMoveMode(true);
    }

    async function ctDoc() { return parseXml(await zip.file('[Content_Types].xml').async('string')); }
    async function presRelsDoc() { return parseXml(await zip.file(relsPathOf(presPath)).async('string')); }

    const OWNED = /\/(chart|chartEx|diagramData|diagramLayout|diagramQuickStyle|diagramColors|diagramDrawing|oleObject|package|chartStyle|chartColorStyle|chartUserShapes|themeOverride)$/;
    function relTarget(fromPart, toPart) {
      const a = fromPart.split('/').slice(0, -1), b = toPart.split('/');
      let i = 0; while (i < a.length && a[i] === b[i]) i++;
      return '../'.repeat(a.length - i) + b.slice(i).join('/');
    }
    /** Copia una parte del paquete (y las que le pertenecen) con un nombre nuevo */
    async function copyPart(part, ct) {
      const f = zip.file(part);
      if (!f) return null;
      const m = part.match(/^(.*?)(\d*)(\.[^./]+)$/);
      let n = (+m[2] || 1) + 1, np;
      do np = `${m[1]}${n++}${m[3]}`; while (zip.file(np));
      zip.file(np, await f.async('uint8array'));
      const ov = [...ct.documentElement.children].find(o => o.getAttribute('PartName') === '/' + part);
      if (ov) { const c = ov.cloneNode(); c.setAttribute('PartName', '/' + np); ct.documentElement.append(c); }
      const rf = zip.file(relsPathOf(part));
      if (rf) {
        const rd = parseXml(await rf.async('string'));
        for (const r of [...rd.documentElement.children]) {
          if (r.getAttribute('TargetMode') === 'External' || !OWNED.test(r.getAttribute('Type'))) continue;
          const sub = await copyPart(resolvePath(part, r.getAttribute('Target')), ct);
          if (sub) r.setAttribute('Target', relTarget(np, sub));
        }
        zip.file(relsPathOf(np), serialize(rd));
      }
      return np;
    }

    async function duplicateSlide() {
      syncText();
      const src = slides[current];
      let n = 1; while (zip.file(`ppt/slides/slide${n}.xml`)) n++;
      const newPath = `ppt/slides/slide${n}.xml`;
      const doc = parseXml(serialize(src.doc));
      // rels sin notas
      const rf = zip.file(relsPathOf(src.path));
      let relsXml = rf ? await rf.async('string') : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.pr}"></Relationships>`;
      const rd = parseXml(relsXml);
      [...rd.documentElement.children].forEach(r => { if (/notesSlide$/.test(r.getAttribute('Type'))) r.remove(); });
      const ct = await ctDoc();
      // Gráficos, SmartArt y objetos incrustados no pueden compartirse entre diapositivas: se copian
      for (const r of [...rd.documentElement.children]) {
        if (r.getAttribute('TargetMode') === 'External' || !OWNED.test(r.getAttribute('Type'))) continue;
        const target = resolvePath(src.path, r.getAttribute('Target'));
        const copy = await copyPart(target, ct);
        if (copy) r.setAttribute('Target', relTarget(newPath, copy));
      }
      zip.file(newPath, serialize(doc));
      zip.file(relsPathOf(newPath), serialize(rd));
      // content types
      const ov = ct.createElementNS(NS.ct, 'Override');
      ov.setAttribute('PartName', '/' + newPath);
      ov.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml');
      ct.documentElement.append(ov);
      zip.file('[Content_Types].xml', serialize(ct));
      // relación desde presentation.xml
      const pr = await presRelsDoc();
      let rn = 1; const ids = new Set([...pr.documentElement.children].map(r => r.getAttribute('Id')));
      while (ids.has('rId' + rn)) rn++;
      const rel = pr.createElementNS(NS.pr, 'Relationship');
      rel.setAttribute('Id', 'rId' + rn);
      rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide');
      rel.setAttribute('Target', `slides/slide${n}.xml`);
      pr.documentElement.append(rel);
      zip.file(relsPathOf(presPath), serialize(pr));
      // sldIdLst
      const lst = path(presDoc.documentElement, 'sldIdLst');
      const sldIds = kids(lst, 'sldId');
      const newId = Math.max(255, ...sldIds.map(s => +s.getAttribute('id'))) + 1;
      const srcIdEl = sldIds[current];
      const ne = presDoc.createElementNS(NS.p, 'p:sldId');
      ne.setAttribute('id', newId);
      ne.setAttributeNS(NS.r, 'r:id', 'rId' + rn);
      srcIdEl.after(ne);
      // secciones (PowerPoint 2010+)
      presDoc.querySelectorAll('*').forEach(x => {
        if (x.localName === 'sldId' && x.namespaceURI !== NS.p && x.getAttribute('id') === srcIdEl.getAttribute('id')) {
          const c = x.cloneNode(); c.setAttribute('id', newId); x.after(c);
        }
      });
      const part = { path: newPath, doc, rels: { ...src.rels }, layout: src.layout, master: src.master };
      for (const [id, r] of Object.entries(part.rels)) if (r.type === 'notesSlide') delete part.rels[id];
      partCache[newPath] = part;
      slides.splice(current + 1, 0, part);
      current++;
      await buildList();
      slides[current].dom.scrollIntoView({ behavior: 'smooth', block: 'center' });
      ctx.dirty();
      toast('Diapositiva duplicada');
    }

    async function deleteSlide() {
      if (slides.length <= 1) return toast('La presentación debe tener al menos una diapositiva');
      if (!(await confirm('Eliminar diapositiva', `¿Eliminar la diapositiva ${current + 1}?`, 'Eliminar', true))) return;
      syncText();
      const s = slides[current];
      const lst = path(presDoc.documentElement, 'sldIdLst');
      const idEl = kids(lst, 'sldId')[current];
      const rid = rAttr(idEl, 'id');
      const sid = idEl.getAttribute('id');
      idEl.remove();
      presDoc.querySelectorAll('*').forEach(x => { if (x.localName === 'sldId' && x.namespaceURI !== NS.p && x.getAttribute('id') === sid) x.remove(); });
      const pr = await presRelsDoc();
      [...pr.documentElement.children].forEach(r => { if (r.getAttribute('Id') === rid) r.remove(); });
      zip.file(relsPathOf(presPath), serialize(pr));
      const ct = await ctDoc();
      const drop = [s.path];
      const notes = relOfType(s, 'notesSlide');
      if (notes) drop.push(notes.target);
      for (const d of drop) {
        zip.remove(d); zip.remove(relsPathOf(d));
        [...ct.documentElement.children].forEach(o => { if (o.getAttribute('PartName') === '/' + d) o.remove(); });
      }
      zip.file('[Content_Types].xml', serialize(ct));
      slides.splice(current, 1);
      current = Math.min(current, slides.length - 1);
      await buildList();
      ctx.dirty();
    }

    function present() {
      syncText();
      const ov = el('div', { style: { position: 'fixed', inset: 0, background: '#000', zIndex: 80, display: 'grid', placeItems: 'center' } });
      let i = current;
      const show = () => {
        ov.innerHTML = '';
        const clone = slides[i].dom._root.cloneNode(true);
        clone.classList.remove('current');
        clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
        const s = Math.min(innerWidth / DESIGN_W, innerHeight / (slideH * k));
        clone.style.transform = `scale(${s})`;
        const box = el('div', { style: { width: DESIGN_W * s + 'px', height: slideH * k * s + 'px', overflow: 'hidden' } }, clone);
        ov.append(box, el('div', { style: { position: 'fixed', bottom: '10px', right: '14px', color: '#aaa', fontSize: '13px' } }, `${i + 1}/${slides.length} · toca para avanzar`));
      };
      const close = () => { ov.remove(); document.removeEventListener('keydown', key); document.exitFullscreen && document.fullscreenElement && document.exitFullscreen(); };
      const key = e => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight' || e.key === ' ') next(); else if (e.key === 'ArrowLeft') { i = Math.max(0, i - 1); show(); } };
      const next = () => { if (i < slides.length - 1) { i++; show(); } else close(); };
      ov.addEventListener('click', e => { if (e.clientX < innerWidth * 0.25) { i = Math.max(0, i - 1); show(); } else next(); });
      document.addEventListener('keydown', key);
      document.body.append(ov);
      ov.requestFullscreen && ov.requestFullscreen().catch(() => {});
      show();
    }

    /* ---------- Volcar texto editado al XML ---------- */
    function buildPara(doc, src, text) {
      const p = src.cloneNode(true);
      const firstR = kid(src, 'r');
      let rPr = firstR && kid(firstR, 'rPr');
      const end = kid(src, 'endParaRPr');
      if (!rPr && end) {
        rPr = doc.createElementNS(NS.a, 'a:rPr');
        for (const at of end.attributes) rPr.setAttribute(at.name, at.value);
        for (const c of end.children) rPr.append(c.cloneNode(true));
      }
      for (const c of [...p.children]) if (c.localName !== 'pPr' && c.localName !== 'endParaRPr') c.remove();
      const endEl = kid(p, 'endParaRPr');
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (i > 0) {
          const br = doc.createElementNS(NS.a, 'a:br');
          if (rPr) br.append(rPr.cloneNode(true));
          p.insertBefore(br, endEl);
        }
        if (!line) return;
        const r = doc.createElementNS(NS.a, 'a:r');
        if (rPr) { const rp = rPr.cloneNode(true); rp.removeAttribute('dirty'); r.append(rp); }
        const t = doc.createElementNS(NS.a, 'a:t');
        t.textContent = line;
        r.append(t);
        p.insertBefore(r, endEl);
      });
      return p;
    }

    function syncText() {
      for (const s of slides) {
        for (const info of s.shapes || []) {
          const paras = info.div._paras;
          if (!paras || !info.txBody) continue;
          const doc = info.txBody.ownerDocument;
          const changed = paras.some(x => x.orig === null || domText(x.el) !== x.orig) || paras.length !== kids(info.txBody, 'p').length;
          if (changed) {
            const fresh = paras.map(x => {
              const t = domText(x.el);
              return x.orig !== null && t === x.orig ? x.src : buildPara(doc, x.src, t);
            });
            kids(info.txBody, 'p').forEach(p => p.remove());
            for (const p of fresh) info.txBody.append(p);
            if (!fresh.length) info.txBody.append(doc.createElementNS(NS.a, 'a:p'));
            paras.forEach((x, i) => { x.src = fresh[i]; x.orig = domText(x.el); });
          }
          if (info.moved && info.sp) {
            const spPr = kid(info.sp, 'spPr');
            let x = kid(spPr, 'xfrm');
            if (!x) {
              x = doc.createElementNS(NS.a, 'a:xfrm');
              const off = doc.createElementNS(NS.a, 'a:off'), ext = doc.createElementNS(NS.a, 'a:ext');
              ext.setAttribute('cx', info.raw.w); ext.setAttribute('cy', info.raw.h);
              x.append(off, ext);
              spPr.prepend(x);
            }
            kid(x, 'off').setAttribute('x', info.moved.x);
            kid(x, 'off').setAttribute('y', info.moved.y);
            info.raw.x = info.moved.x; info.raw.y = info.moved.y;
            info.moved = null;
          }
        }
      }
    }

    /* ---------- Abrir / guardar ---------- */
    async function open(data, name) {
      const e = name ? name.split('.').pop().toLowerCase() : 'pptx';
      if (['pptm', 'ppsx', 'ppsm', 'potx', 'potm'].includes(e)) api.ext = e;   // conserva tipo (macros, presentación, plantilla)
      if (!data) data = await (await fetch('assets/blank.pptx')).arrayBuffer();
      zip = await JSZip.loadAsync(data);
      const rootRels = parseXml(await zip.file('_rels/.rels').async('string'));
      const off = [...rootRels.documentElement.children].find(r => /officeDocument$/.test(r.getAttribute('Type')));
      if (off) presPath = off.getAttribute('Target').replace(/^\//, '');
      const pres = await loadPart(presPath);
      presDoc = pres.doc;
      const sz = path(presDoc.documentElement, 'sldSz');
      slideW = +attr(sz, 'cx') || 12192000; slideH = +attr(sz, 'cy') || 6858000;
      k = DESIGN_W / slideW;
      for (const id of kids(path(presDoc.documentElement, 'sldIdLst'), 'sldId')) {
        const rel = pres.rels[rAttr(id, 'id')];
        if (!rel) continue;
        const s = await loadPart(rel.target);
        if (!s) continue;
        const lr = relOfType(s, 'slideLayout');
        s.layout = lr ? await loadPart(lr.target) : null;
        const mr = s.layout && relOfType(s.layout, 'slideMaster');
        s.master = mr ? await loadPart(mr.target) : null;
        slides.push(s);
      }
      if (!slides.length) throw new Error('La presentación no tiene diapositivas');
      // tema y mapa de colores del primer patrón
      const m = slides[0].master;
      if (m) {
        const cm = path(m.doc.documentElement, 'clrMap');
        if (cm) for (const a of cm.attributes) clrMap[a.name] = a.value;
        const tr = relOfType(m, 'theme');
        const th = tr && await loadPart(tr.target);
        if (th) {
          const cs = path(th.doc.documentElement, 'themeElements/clrScheme');
          for (const c of cs ? cs.children : []) {
            const v = c.firstElementChild;
            theme.colors[c.localName] = v && (attr(v, 'val') && v.localName === 'srgbClr' ? attr(v, 'val') : attr(v, 'lastClr') || (attr(v, 'val') === 'window' ? 'FFFFFF' : '000000'));
          }
          const fs = path(th.doc.documentElement, 'themeElements/fontScheme');
          theme.major = attr(path(fs, 'majorFont/latin'), 'typeface') || 'Calibri';
          theme.minor = attr(path(fs, 'minorFont/latin'), 'typeface') || 'Calibri';
        }
      }
      await preloadMedia();
      buildToolbar();
      list = el('div', { class: 'ppt-list' });
      ctx.workspace.append(list);
      await buildList();
      window.addEventListener('resize', fit);
      if (!document.getElementById('ppt-bu-style')) {
        document.head.append(el('style', { id: 'ppt-bu-style' }, '.ppt-p.bu::before{content:var(--bu);}'));
      }
    }

    async function save() {
      syncText();
      for (const s of slides) zip.file(s.path, serialize(s.doc));
      zip.file(presPath, serialize(presDoc));
      return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' });
    }

    function destroy() {
      window.removeEventListener('resize', fit);
      blobUrls.forEach(u => URL.revokeObjectURL(u));
    }

    /* ----- Navegación de diapositivas ----- */
    const pagesApi = {
      label: 'Diapositiva',
      count: () => slides.length,
      current() {
        const best = UI.visiblePage(slides.map(sl => sl.dom), ctx.workspace, pagesApi);
        if (best !== current) setCurrent(best);
        return best;
      },
      goTo(i) {
        i = Math.max(0, Math.min(slides.length - 1, i));
        pagesApi.target = i; pagesApi._settling = true; clearTimeout(pagesApi._t); pagesApi._t = setTimeout(() => { pagesApi._settling = false; }, 900);
        setCurrent(i);
        ctx.workspace.scrollTo({ top: slides[i].dom.offsetTop - 12, behavior: 'smooth' });
      },
      async thumb(i, width) {
        const src = slides[i].dom._root;
        const clone = src.cloneNode(true);
        clone.classList.remove('current');
        clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
        const sc = width / DESIGN_W;
        clone.style.transform = `scale(${sc})`;
        clone.style.boxShadow = 'none';
        return el('div', { class: 'thumb-slide', style: { width: width + 'px', height: slideH * k * sc + 'px' } }, clone);
      }
    };

    /** Contenido para imprimir: una diapositiva por hoja, a página completa */
    async function printable() {
      syncText();
      const wIn = 11, hIn = +(wIn * slideH / slideW).toFixed(3);
      const sc = (wIn * 96) / DESIGN_W;
      const root = el('div', { class: 'print-ppt' });
      for (const sl of slides) {
        const clone = sl.dom._root.cloneNode(true);
        clone.classList.remove('current');
        clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
        clone.querySelectorAll('.picked').forEach(n => n.classList.remove('picked'));
        clone.style.transform = `scale(${sc})`;
        clone.style.boxShadow = 'none';
        clone.style.borderRadius = '0';
        root.append(el('div', { class: 'print-slide', style: { width: wIn + 'in', height: (hIn - 0.01) + 'in' } }, clone));
      }
      return { node: root, page: `@page { size: ${wIn}in ${hIn}in; margin: 0; }` };
    }

    const api = { open, save, destroy, ext: 'pptx', kind: 'ppt', pages: pagesApi, printable };
    return api;
  }
  return { create };
})();
