/* HtmlPdf: convierte el HTML de un documento en un PDF con texto real (seleccionable y liviano) usando pdf-lib */
const HtmlPdf = (() => {
  const SIZES = { letter: [612, 792], a4: [595.28, 841.89] };
  const HEAD = { 1: 20, 2: 16, 3: 13.5, 4: 12, 5: 11, 6: 11 };
  const BASE = 11;

  const hex = c => {
    if (!c) return null;
    let m = c.match(/^#([0-9a-f]{6})$/i); if (m) { const n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
    m = c.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i); if (m) return [m[1], m[2], m[3]].map(x => parseInt(x + x, 16) / 255);
    m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/); if (m) { if (m[4] !== undefined && +m[4] === 0) return null; return [m[1], m[2], m[3]].map(x => +x / 255); }
    const named = { black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], blue: [0, 0, 1], green: [0, 0.5, 0], yellow: [1, 1, 0], gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5] };
    return named[c.toLowerCase()] || null;
  };

  /**
   * root: elemento con el contenido. opts: { size: 'letter'|'a4', margin: pt }
   * Devuelve { bytes, replaced } (replaced = caracteres que la fuente no tiene)
   */
  async function render(root, opts = {}) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const [PW, PH] = SIZES[opts.size] || SIZES.letter;
    const M = opts.margin ?? 72;
    const CW = PW - M * 2;
    const doc = await PDFDocument.create();
    doc.setProducer('Folio');
    if (opts.title) doc.setTitle(opts.title);
    const F = {
      r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold),
      i: await doc.embedFont(StandardFonts.HelveticaOblique), bi: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
      m: await doc.embedFont(StandardFonts.Courier), mb: await doc.embedFont(StandardFonts.CourierBold)
    };
    let replaced = 0;
    const fontOf = s => (s.mono ? (s.bold ? F.mb : F.m) : s.bold ? (s.italic ? F.bi : F.b) : s.italic ? F.i : F.r);
    const safe = (font, str) => [...str].map(ch => {
      if (ch === '\t') return '    ';
      try { font.encodeText(ch); return ch; } catch {
        const alt = { '‐': '-', '‑': '-', '‒': '-', '−': '-', ' ': ' ', '​': '', '→': '->', '←': '<-', '✓': 'v', '✔': 'v', '☐': '[ ]', '☑': '[x]', '◦': '-', '▪': '-' }[ch];
        if (alt !== undefined) return alt;
        replaced++; return '?';
      }
    }).join('');

    /* ---------- estilos ---------- */
    function styleOf(node, st) {
      const s = { ...st };
      const t = node.tagName;
      if (t === 'B' || t === 'STRONG' || t === 'TH') s.bold = true;
      if (t === 'I' || t === 'EM' || t === 'CITE') s.italic = true;
      if (t === 'U' || t === 'INS') s.underline = true;
      if (t === 'S' || t === 'STRIKE' || t === 'DEL') s.strike = true;
      if (t === 'CODE' || t === 'KBD' || t === 'SAMP') s.mono = true;
      if (t === 'MARK') s.bg = [1, 1, 0];
      if (t === 'A' && node.getAttribute('href')) { s.underline = true; s.color = [0.17, 0.31, 0.54]; }
      if (t === 'SUP' || t === 'SUB' || t === 'SMALL') s.size = s.size * 0.75;
      if (t === 'FONT') {
        const c = hex(node.getAttribute('color') || ''); if (c) s.color = c;
        const sz = { 1: 7.5, 2: 9.75, 3: 12, 4: 13.5, 5: 18, 6: 24, 7: 36 }[node.getAttribute('size')]; if (sz) s.size = sz;
      }
      const css = node.style;
      if (css) {
        if (css.fontWeight === 'bold' || +css.fontWeight >= 600) s.bold = true;
        if (css.fontWeight === 'normal' || (+css.fontWeight && +css.fontWeight < 600)) s.bold = false;
        if (css.fontStyle === 'italic') s.italic = true;
        const td = css.textDecoration + ' ' + css.textDecorationLine;
        if (td.includes('underline')) s.underline = true;
        if (td.includes('line-through')) s.strike = true;
        const c = hex(css.color); if (c) s.color = c;
        const bg = hex(css.backgroundColor); if (bg) s.bg = bg;
        if (css.fontSize) {
          const v = parseFloat(css.fontSize);
          if (css.fontSize.endsWith('pt')) s.size = v; else if (css.fontSize.endsWith('px')) s.size = v * 0.75; else if (css.fontSize.endsWith('em')) s.size = s.size * v;
        }
        if (/mono|courier|consol/i.test(css.fontFamily || '')) s.mono = true;
      }
      return s;
    }
    const alignOf = n => { const a = (n.style && n.style.textAlign) || n.getAttribute && n.getAttribute('align') || ''; return { center: 'center', right: 'right', end: 'right', justify: 'justify' }[a] || 'left'; };

    /* ---------- imágenes ---------- */
    const imgCache = new Map();
    async function embedImage(src) {
      if (imgCache.has(src)) return imgCache.get(src);
      let out = null;
      try {
        const m = src.match(/^data:(image\/[a-z+.-]+);base64,(.*)$/i);
        if (m) {
          const bin = atob(m[2]); const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          if (/jpe?g/i.test(m[1])) out = await doc.embedJpg(bytes);
          else if (/png/i.test(m[1])) out = await doc.embedPng(bytes);
          else {
            const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
            const c = document.createElement('canvas'); c.width = img.naturalWidth || 300; c.height = img.naturalHeight || 200;
            c.getContext('2d').drawImage(img, 0, 0);
            const blob = await new Promise(r => c.toBlob(r, 'image/png'));
            out = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
          }
        }
      } catch { out = null; }
      imgCache.set(src, out);
      return out;
    }

    /* ---------- texto en líneas ---------- */
    // tokens: { text, s } | { br: true } | { img: element }
    function collect(node, st, out, pre) {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) {
          let t = c.nodeValue;
          if (!pre) t = t.replace(/[\r\n\t ]+/g, ' ');
          if (t) out.push({ text: t, s: st });
        } else if (c.nodeType === 1) {
          if (c.tagName === 'BR') out.push({ br: true });
          else if (c.tagName === 'IMG') out.push({ img: c });
          else if (/^(UL|OL|TABLE)$/.test(c.tagName)) { /* bloques anidados: se procesan aparte */ }
          else collect(c, styleOf(c, st), out, pre || c.tagName === 'PRE');
        }
      }
      return out;
    }

    /** Parte tokens en líneas que caben en width. Devuelve [{ words:[{text,s,w,font}], width, maxSize, br }] */
    function breakLines(tokens, width, pre) {
      const lines = [];
      let cur = { words: [], width: 0, maxSize: 0 };
      const push = () => { lines.push(cur); cur = { words: [], width: 0, maxSize: 0 }; };
      const addWord = (text, s) => {
        const font = fontOf(s);
        const t = safe(font, text);
        if (!t) return;
        const isSpace = /^\s+$/.test(t);
        if (isSpace && !cur.words.length && !pre) return;
        let w = font.widthOfTextAtSize(t, s.size);
        if (!isSpace && cur.width + w > width && cur.words.length) {
          while (cur.words.length && /^\s+$/.test(cur.words[cur.words.length - 1].text)) cur.width -= cur.words.pop().w;
          push();
        }
        if (!isSpace && w > width) {
          // palabra más larga que la línea: se corta por letras
          let piece = '';
          for (const ch of t) {
            const pw = font.widthOfTextAtSize(piece + ch, s.size);
            if (pw > width && piece) { cur.words.push({ text: piece, s, font, w: font.widthOfTextAtSize(piece, s.size) }); cur.maxSize = Math.max(cur.maxSize, s.size); push(); piece = ch; }
            else piece += ch;
          }
          if (piece) { const pw = font.widthOfTextAtSize(piece, s.size); cur.words.push({ text: piece, s, font, w: pw }); cur.width += pw; cur.maxSize = Math.max(cur.maxSize, s.size); }
          return;
        }
        cur.words.push({ text: t, s, font, w });
        cur.width += w;
        cur.maxSize = Math.max(cur.maxSize, s.size);
      };
      for (const tk of tokens) {
        if (tk.br) { cur.br = true; if (!cur.maxSize) cur.maxSize = BASE; push(); continue; }
        const parts = pre ? tk.text.split(/(\n)/) : [tk.text];
        for (const part of parts) {
          if (part === '\n') { if (!cur.maxSize) cur.maxSize = tk.s.size; cur.br = true; push(); continue; }
          for (const w of part.split(/(\s+)/)) if (w) addWord(w, tk.s);
        }
      }
      if (cur.words.length) push();
      return lines;
    }

    /* ---------- elementos de diseño (items atómicos que se paginan) ---------- */
    // item: { h, draw(page, x, yTop), keepNext?, spacer? }
    function lineItem(line, x0, width, align, isLast, marker) {
      const size = line.maxSize || BASE;
      const h = size * 1.32;
      return {
        h,
        draw(page, x, yTop) {
          const base = PH - (yTop + h * 0.5 + size * 0.36);
          const words = line.words.slice();
          while (words.length && /^\s+$/.test(words[words.length - 1].text)) words.pop();
          const used = words.reduce((a, w) => a + w.w, 0);
          let cx = x + x0, extra = 0;
          if (align === 'center') cx += (width - used) / 2;
          else if (align === 'right') cx += width - used;
          else if (align === 'justify' && !isLast && !line.br) {
            const gaps = words.filter(w => /^\s+$/.test(w.text)).length;
            if (gaps) extra = (width - used) / gaps;
          }
          if (marker) page.drawText(marker.text, { x: x + x0 - marker.w - 5, y: base, size: marker.size, font: marker.font, color: rgb(0.15, 0.15, 0.15) });
          if (!extra) {
            // palabras seguidas con el mismo estilo se escriben juntas (al copiar texto del PDF sale en una línea)
            const segs = [];
            for (const w of words) {
              const last = segs[segs.length - 1];
              if (last && last.s === w.s && last.font === w.font) { last.text += w.text; last.w += w.w; }
              else segs.push({ text: w.text, s: w.s, font: w.font, w: w.w });
            }
            words.length = 0;
            words.push(...segs);
          }
          for (const w of words) {
            const s = w.s, isSpace = /^\s+$/.test(w.text);
            const ww = w.w + (isSpace ? extra : 0);
            if (s.bg && !isSpace) page.drawRectangle({ x: cx, y: base - s.size * 0.22, width: ww, height: s.size * 1.08, color: rgb(...s.bg) });
            if (!isSpace) page.drawText(w.text, { x: cx, y: base, size: s.size, font: w.font, color: rgb(...(s.color || [0.07, 0.07, 0.07])) });
            if (s.underline) page.drawLine({ start: { x: cx, y: base - s.size * 0.13 }, end: { x: cx + ww, y: base - s.size * 0.13 }, thickness: Math.max(0.5, s.size * 0.05), color: rgb(...(s.color || [0, 0, 0])) });
            if (s.strike && !isSpace) page.drawLine({ start: { x: cx, y: base + s.size * 0.28 }, end: { x: cx + ww, y: base + s.size * 0.28 }, thickness: Math.max(0.5, s.size * 0.05), color: rgb(...(s.color || [0, 0, 0])) });
            cx += ww;
          }
        }
      };
    }
    const spacer = h => ({ h, spacer: true, draw() {} });

    async function imageItem(imgEl, width) {
      const emb = await embedImage(imgEl.getAttribute('src') || '');
      if (!emb) return null;
      let w = (imgEl.naturalWidth || emb.width) * 0.75, h = (imgEl.naturalHeight || emb.height) * 0.75;
      const attrW = parseFloat(imgEl.getAttribute('width') || imgEl.style.width);
      if (attrW && attrW > 0) { const k = attrW * 0.75 / w; w *= k; h *= k; }
      if (w > width) { h = h * width / w; w = width; }
      const maxH = (PH - M * 2) * 0.92;
      if (h > maxH) { w = w * maxH / h; h = maxH; }
      return { h: h + 6, draw(page, x, yTop) { page.drawImage(emb, { x, y: PH - yTop - h - 3, width: w, height: h }); } };
    }

    /** Párrafo (o celda, o ítem de lista) → items */
    async function paragraphItems(node, st, width, x0, opts = {}) {
      const items = [];
      const tokens = collect(node, st, [], opts.pre);
      // imágenes como bloques propios
      let run = [];
      const flush = (isLastChunk) => {
        if (!run.length) return;
        const lines = breakLines(run, width - (x0 || 0), opts.pre);
        lines.forEach((l, i) => items.push(lineItem(l, x0 || 0, width - (x0 || 0), opts.align || 'left', i === lines.length - 1, i === 0 && !items.length ? opts.marker : null)));
        run = [];
      };
      for (const tk of tokens) {
        if (tk.img) { flush(); const it = await imageItem(tk.img, width - (x0 || 0)); if (it) { const dx = x0 || 0; items.push({ h: it.h, draw: (p, x, y) => it.draw(p, x + dx, y) }); } }
        else run.push(tk);
      }
      flush();
      if (!items.length && opts.keepEmpty) items.push(spacer(st.size * 1.32));
      if (opts.marker && items.length && !items[0].h) items.unshift(lineItem({ words: [], width: 0, maxSize: st.size }, x0, width, 'left', true, opts.marker));
      return items;
    }

    const isBlock = n => n.nodeType === 1 && /^(P|DIV|H[1-6]|UL|OL|LI|TABLE|BLOCKQUOTE|PRE|HR|SECTION|ARTICLE|HEADER|FOOTER|FIGURE)$/.test(n.tagName);
    const hasBlock = n => [...n.childNodes].some(isBlock);

    async function blockItems(node, st, width, x0 = 0, level = 0) {
      const items = [];
      let inline = null;
      const flushInline = async () => {
        if (inline && inline.textContent.trim() || (inline && inline.querySelector('img'))) items.push(...await paragraphItems(inline, st, width, x0), spacer(st.size * 0.5));
        inline = null;
      };
      for (const c of node.childNodes) {
        if (!isBlock(c)) {
          if (c.nodeType === 3 && !c.nodeValue.trim() && !inline) continue;
          inline = inline || document.createElement('span');
          inline.append(c.cloneNode(true));
          continue;
        }
        await flushInline();
        const t = c.tagName, s = styleOf(c, st);
        if (/^H[1-6]$/.test(t)) {
          const title = c.classList.contains('doc-title'), sub = c.classList.contains('doc-subtitle');
          const hs = { ...s, size: title ? 26 : sub ? 14 : HEAD[t[1]], bold: !(title || sub), color: s.color !== st.color ? s.color : title ? [0.07, 0.07, 0.07] : sub ? [0.35, 0.35, 0.35] : t === 'H1' ? [0.12, 0.17, 0.25] : [0.16, 0.23, 0.34] };
          items.push(spacer(hs.size * 0.55));
          const lines = await paragraphItems(c, hs, width, x0, { align: alignOf(c) });
          if (lines.length) lines[lines.length - 1].keepNext = true;
          items.push(...lines, spacer(hs.size * 0.3));
        } else if (t === 'UL' || t === 'OL') {
          let n = parseInt(c.getAttribute('start')) || 1;
          for (const li of c.children) {
            if (li.tagName !== 'LI') continue;
            const font = F.r;
            const markText = t === 'OL' ? `${n++}.` : ['•', '–', '·'][level % 3];
            const marker = { text: markText, size: s.size, font, w: font.widthOfTextAtSize(markText, s.size) };
            const indent = x0 + 18;
            const own = li.cloneNode(true);
            own.querySelectorAll(':scope > ul, :scope > ol').forEach(x => x.remove());
            if (hasBlock(own)) {
              const sub = await blockItems(own, s, width, indent, level);
              const firstLine = sub.findIndex(x => !x.spacer);
              if (firstLine >= 0) { const orig = sub[firstLine]; sub[firstLine] = { ...orig, draw: (p, x, y) => { orig.draw(p, x, y); const size = marker.size; p.drawText(marker.text, { x: x + indent - marker.w - 5, y: PH - (y + orig.h * 0.5 + size * 0.36), size, font, color: rgb(0.15, 0.15, 0.15) }); } }; }
              items.push(...sub);
            } else items.push(...await paragraphItems(own, s, width, indent, { marker, keepEmpty: true }));
            items.push(spacer(s.size * 0.15));
            for (const nested of li.querySelectorAll(':scope > ul, :scope > ol')) items.push(...await blockItems({ childNodes: [nested] }, s, width, indent, level + 1));
          }
          items.push(spacer(s.size * 0.45));
        } else if (t === 'TABLE') {
          items.push(...await tableItems(c, s, width, x0), spacer(s.size * 0.6));
        } else if (t === 'HR') {
          items.push({ h: 14, draw: (p, x, y) => p.drawLine({ start: { x: x + x0, y: PH - y - 7 }, end: { x: x + width, y: PH - y - 7 }, thickness: 0.7, color: rgb(0.75, 0.75, 0.72) }) });
        } else if (t === 'BLOCKQUOTE') {
          const bq = await blockItems(hasBlock(c) ? c : { childNodes: [c.cloneNode(true)].map(x => { const d = document.createElement('p'); d.innerHTML = x.innerHTML; return d; }) }, { ...s, italic: true, color: [0.33, 0.33, 0.33] }, width, x0 + 16, level);
          items.push(...bq.map(it => it.spacer ? it : { ...it, draw: (p, x, y) => { p.drawRectangle({ x: x + x0 + 3, y: PH - y - it.h, width: 2, height: it.h, color: rgb(0.83, 0.82, 0.78) }); it.draw(p, x, y); } }));
        } else if (t === 'PRE' || (c.classList && c.classList.contains('code'))) {
          items.push(...await paragraphItems(c, { ...s, mono: true, size: Math.min(s.size, 9.5) }, width, x0, { pre: true, keepEmpty: true }));
          if (t === 'PRE') items.push(spacer(s.size * 0.5));
        } else if (hasBlock(c)) {
          items.push(...await blockItems(c, s, width, x0, level));
        } else {
          const p = await paragraphItems(c, s, width, x0, { align: alignOf(c), keepEmpty: true });
          items.push(...p, spacer(s.size * 0.55));
        }
      }
      await flushInline();
      return items;
    }

    async function tableItems(tbl, st, width, x0) {
      const rows = [...tbl.rows];
      if (!rows.length) return [];
      const cols = Math.max(...rows.map(r => [...r.cells].reduce((a, c) => a + (c.colSpan || 1), 0)));
      const tw = width - x0, colW = tw / cols, pad = 4;
      const items = [];
      for (const r of rows) {
        const cells = [];
        let ci = 0;
        for (const cell of r.cells) {
          const span = cell.colSpan || 1;
          const cw = colW * span;
          const cs = styleOf(cell, { ...st, size: Math.min(st.size, 10) });
          const content = hasBlock(cell) ? await blockItems(cell, cs, cw - pad * 2, 0) : await paragraphItems(cell, cs, cw - pad * 2, 0, { align: alignOf(cell), keepEmpty: true });
          while (content.length && content[content.length - 1].spacer) content.pop();
          const h = content.reduce((a, it) => a + it.h, 0) + pad * 2;
          cells.push({ x: ci * colW, w: cw, content, h, bg: hex(cell.style.backgroundColor) || (cell.tagName === 'TH' ? [0.95, 0.95, 0.93] : null) });
          ci += span;
        }
        const rh = Math.max(14, ...cells.map(c => c.h));
        items.push({
          h: rh,
          draw(page, x, yTop) {
            for (const c of cells) {
              const cx = x + x0 + c.x;
              page.drawRectangle({ x: cx, y: PH - yTop - rh, width: c.w, height: rh, borderColor: rgb(0.62, 0.62, 0.6), borderWidth: 0.6, ...(c.bg ? { color: rgb(...c.bg) } : {}) });
              let yy = yTop + pad;
              for (const it of c.content) { it.draw(page, cx + pad, yy); yy += it.h; }
            }
          }
        });
      }
      return items;
    }

    /* ---------- paginación ---------- */
    const items = await blockItems(root, { size: BASE, color: [0.07, 0.07, 0.07] }, CW, 0, 0);
    let page = doc.addPage([PW, PH]), y = M;
    const bottom = PH - M;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.spacer) { if (y > M) y += it.h; continue; }
      let need = it.h;
      if (it.keepNext) { const nx = items.slice(i + 1).find(x => !x.spacer); if (nx) need += nx.h; }
      if (y + need > bottom && y > M) { page = doc.addPage([PW, PH]); y = M; }
      it.draw(page, M, y);
      y += it.h;
    }
    return { bytes: await doc.save(), replaced, pages: doc.getPageCount() };
  }

  return { render, SIZES };
})();
