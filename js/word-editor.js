/* Editor de Word: abre .docx con mammoth y guarda un .docx nuevo generado desde el HTML */
const WordEditor = (() => {
  const { el, toast, xmlEsc, prompt } = UI;

  /* ---------- HTML -> DOCX ---------- */
  async function htmlToDocx(root, base) {
    const media = [];       // {name, data(Uint8Array), ext, rid}
    const links = [];       // {rid, url}
    let numId = 0;           // contador de listas numeradas (cada lista reinicia)
    const numDefs = [];      // {id, ordered}
    let rel = 10, docPr = 5001;

    const runProps = st => {
      let p = '';
      if (st.font) p += `<w:rFonts w:ascii="${xmlEsc(st.font)}" w:hAnsi="${xmlEsc(st.font)}" w:cs="${xmlEsc(st.font)}"/>`;
      if (st.b) p += '<w:b/>';
      if (st.i) p += '<w:i/>';
      if (st.strike) p += '<w:strike/>';
      if (st.color) p += `<w:color w:val="${st.color}"/>`;
      if (st.size) p += `<w:sz w:val="${st.size}"/><w:szCs w:val="${st.size}"/>`;
      if (st.hl) p += `<w:shd w:val="clear" w:color="auto" w:fill="${st.hl}"/>`;
      if (st.u) p += '<w:u w:val="single"/>';
      if (st.sup) p += '<w:vertAlign w:val="superscript"/>';
      if (st.sub) p += '<w:vertAlign w:val="subscript"/>';
      return p ? `<w:rPr>${p}</w:rPr>` : '';
    };

    const cssColor = v => {
      if (!v) return null;
      v = v.trim();
      let m = v.match(/^#([0-9a-f]{6})$/i); if (m) return m[1].toUpperCase();
      m = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i); if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
      m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
      if (m) { if (m[4] !== undefined && +m[4] === 0) return null; return [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase(); }
      const named = { black: '000000', white: 'FFFFFF', red: 'FF0000', blue: '0000FF', green: '008000', yellow: 'FFFF00' };
      return named[v.toLowerCase()] || null;
    };

    const fontSizePx = { 1: 10, 2: 13, 3: 16, 4: 18, 5: 24, 6: 32, 7: 48 };

    function styleOf(node, st) {
      const s = { ...st };
      const tag = node.tagName;
      if (tag === 'B' || tag === 'STRONG') s.b = true;
      if (tag === 'I' || tag === 'EM') s.i = true;
      if (tag === 'U' || tag === 'INS') s.u = true;
      if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s.strike = true;
      if (tag === 'SUP') s.sup = true;
      if (tag === 'SUB') s.sub = true;
      if (tag === 'A') { s.u = true; s.color = s.color || '0563C1'; }
      if (tag === 'MARK') s.hl = 'FFFF00';
      if (tag === 'FONT') {
        if (node.getAttribute('color')) s.color = cssColor(node.getAttribute('color')) || s.color;
        if (node.getAttribute('size')) s.size = Math.round((fontSizePx[node.getAttribute('size')] || 16) * 0.75 * 2);
        if (node.getAttribute('face')) s.font = node.getAttribute('face').split(',')[0].replace(/['"]/g, '').trim();
      }
      const css = node.style;
      if (css) {
        if (css.fontWeight === 'bold' || +css.fontWeight >= 600) s.b = true;
        if (css.fontStyle === 'italic') s.i = true;
        if (css.textDecoration.includes('underline') || css.textDecorationLine.includes('underline')) s.u = true;
        if (css.textDecoration.includes('line-through') || css.textDecorationLine.includes('line-through')) s.strike = true;
        if (css.color) s.color = cssColor(css.color) || s.color;
        if (css.backgroundColor) s.hl = cssColor(css.backgroundColor) || s.hl;
        if (css.fontSize && css.fontSize.endsWith('px')) s.size = Math.round(parseFloat(css.fontSize) * 0.75 * 2);
        if (css.fontSize && css.fontSize.endsWith('pt')) s.size = Math.round(parseFloat(css.fontSize) * 2);
        if (css.fontFamily) s.font = css.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      }
      return s;
    }

    function dataUrlToBytes(url) {
      const m = url.match(/^data:([^;,]+)(;base64)?,(.*)$/);
      if (!m) return null;
      const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/gif': 'gif', 'image/bmp': 'bmp' }[m[1]];
      return ext ? { data: out, ext } : null;
    }

    function imageRun(img) {
      const src = img.getAttribute('src') || '';
      const d = dataUrlToBytes(src);
      if (!d) return '';
      const rid = 'rId' + rel++;
      const name = `image${media.length + 1}.${d.ext}`;
      media.push({ name, data: d.data, ext: d.ext, rid });
      let w = img.naturalWidth || img.width || 300, h = img.naturalHeight || img.height || 200;
      const maxW = 600; // ~ ancho de página en px
      if (img.width && img.height && img.width <= maxW) { w = img.width; h = img.height; }
      if (w > maxW) { h = h * maxW / w; w = maxW; }
      const cx = Math.round(w * 9525), cy = Math.round(h * 9525), id = docPr++;
      return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Imagen ${id}"/>` +
        `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
        `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
        `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    }

    // Recorre nodos inline y devuelve XML de runs
    function runs(node, st) {
      let x = '';
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          const t = n.nodeValue.replace(/[\r\n\t]+/g, ' ');
          if (t) x += `<w:r>${runProps(st)}<w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`;
        } else if (n.nodeType === 1) {
          if (n.tagName === 'BR') x += '<w:r><w:br/></w:r>';
          else if (n.tagName === 'IMG') x += imageRun(n);
          else if (isBlock(n)) x += runs(n, styleOf(n, st)); // bloque anidado dentro de inline: se aplana
          else if (n.tagName === 'A' && n.getAttribute('href') && !n.getAttribute('href').startsWith('#')) {
            const rid = 'rId' + rel++;
            links.push({ rid, url: n.getAttribute('href') });
            x += `<w:hyperlink r:id="${rid}">${runs(n, styleOf(n, st))}</w:hyperlink>`;
          } else x += runs(n, styleOf(n, st));
        }
      }
      return x;
    }

    const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'BLOCKQUOTE', 'PRE', 'HR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER']);
    const isBlock = n => n.nodeType === 1 && BLOCKS.has(n.tagName);

    function pProps(node, extra = '') {
      let p = extra;
      const al = (node.style && node.style.textAlign) || node.getAttribute('align');
      const map = { center: 'center', right: 'right', justify: 'both', left: 'left', start: 'left', end: 'right' };
      if (al && map[al]) p += `<w:jc w:val="${map[al]}"/>`;
      return p ? `<w:pPr>${p}</w:pPr>` : '';
    }

    function para(node, st, extra = '') {
      return `<w:p>${pProps(node, extra)}${runs(node, st)}</w:p>`;
    }

    function hasBlockChild(n) { for (const c of n.childNodes) if (isBlock(c)) return true; return false; }

    function blocks(node, st, listCtx) {
      let x = '';
      let inline = null; // nodos inline sueltos se agrupan en un párrafo
      const flush = () => {
        if (inline && inline.childNodes.length && (inline.textContent.trim() || inline.querySelector('img,br'))) x += para(inline, st);
        inline = null;
      };
      for (const n of node.childNodes) {
        if (!isBlock(n)) {
          if (n.nodeType === 3 && !n.nodeValue.trim() && !inline) continue;
          inline = inline || document.createElement('span');
          inline.append(n.cloneNode(true));
          continue;
        }
        flush();
        const tag = n.tagName;
        const s = styleOf(n, st);
        if (/^H[1-6]$/.test(tag)) {
          const sid = n.classList.contains('doc-title') ? 'Title' : n.classList.contains('doc-subtitle') ? 'Subtitle' : `Heading${tag[1]}`;
          x += para(n, s, `<w:pStyle w:val="${sid}"/>`);
        } else if (tag === 'UL' || tag === 'OL') {
          const ordered = tag === 'OL';
          const level = listCtx ? listCtx.level + 1 : 0;
          let id;
          if (listCtx && listCtx.ordered === ordered) id = listCtx.id;
          else { id = ++numId; numDefs.push({ id, ordered }); }
          x += blocks(n, s, { id, ordered, level: Math.min(level, 8) });
        } else if (tag === 'LI') {
          const lc = listCtx || { id: (numDefs.push({ id: ++numId, ordered: false }), numId), level: 0 };
          const numPr = `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${lc.level}"/><w:numId w:val="${lc.id}"/></w:numPr>`;
          // contenido inline del li -> un párrafo; listas anidadas -> recursión
          const inl = document.createElement('span');
          let wrote = false;
          for (const c of n.childNodes) {
            if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) {
              if (!wrote) { x += para(inl, s, numPr); wrote = true; }
              x += blocks(el('div', {}, c.cloneNode(true)), s, lc);
            } else if (c.nodeType === 1 && c.tagName === 'P') {
              inl.append(...[...c.childNodes].map(z => z.cloneNode(true)), document.createElement('br'));
            } else inl.append(c.cloneNode(true));
          }
          if (inl.lastChild && inl.lastChild.tagName === 'BR') inl.lastChild.remove();
          if (!wrote) x += para(inl, s, numPr);
        } else if (tag === 'TABLE') {
          x += table(n, s);
        } else if (tag === 'HR') {
          x += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>';
        } else if (tag === 'BLOCKQUOTE') {
          x += hasBlockChild(n) ? blocks(n, { ...s, i: true }) : para(n, { ...s, i: true }, '<w:ind w:left="720"/>');
        } else if (hasBlockChild(n)) {
          x += blocks(n, s, listCtx);
        } else {
          x += para(n, s);
        }
      }
      flush();
      return x;
    }

    function table(t, st) {
      const rows = [...t.rows];
      if (!rows.length) return '';
      const cols = Math.max(...rows.map(r => [...r.cells].reduce((s, c) => s + (c.colSpan || 1), 0)));
      const w = Math.floor(9000 / cols);
      let x = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>` +
        ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('') +
        `</w:tblBorders></w:tblPr><w:tblGrid>${`<w:gridCol w:w="${w}"/>`.repeat(cols)}</w:tblGrid>`;
      for (const r of rows) {
        x += '<w:tr>';
        for (const c of r.cells) {
          const span = c.colSpan > 1 ? `<w:gridSpan w:val="${c.colSpan}"/>` : '';
          const cs = styleOf(c, c.tagName === 'TH' ? { ...st, b: true } : st);
          let inner = hasBlockChild(c) ? blocks(c, cs) : para(c, cs);
          if (!inner) inner = '<w:p/>';
          x += `<w:tc><w:tcPr><w:tcW w:w="${w * (c.colSpan || 1)}" w:type="dxa"/>${span}</w:tcPr>${inner}</w:tc>`;
        }
        x += '</w:tr>';
      }
      return x + '</w:tbl><w:p/>';
    }

    const body = blocks(root, {}) || '<w:p/>';

    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
    const document_xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}` +
      `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

    const bulletChars = ['•', '◦', '▪'];
    const abstract = (id, ordered) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>` +
      Array.from({ length: 9 }, (_, l) => ordered
        ? `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${['decimal', 'lowerLetter', 'lowerRoman'][l % 3]}"/><w:lvlText w:val="%${l + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
        : `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${bulletChars[l % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
      ).join('') + '</w:abstractNum>';
    const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      numDefs.map(d => abstract(d.id, d.ordered)).join('') +
      numDefs.map(d => `<w:num w:numId="${d.id}"><w:abstractNumId w:val="${d.id}"/></w:num>`).join('') + '</w:numbering>';

    const heading = (n, sz, color) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
      `<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`;
    const TITLE_XML = '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>';
    const SUBTITLE_XML = '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="595959"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>';
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="es-ES"/></w:rPr></w:rPrDefault>` +
      `<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
      TITLE_XML + SUBTITLE_XML + heading(1, 32, '1F3864') + heading(2, 26, '2F5496') + heading(3, 24, '2F5496') + heading(4, 22, '2F5496') + heading(5, 22, '2F5496') + heading(6, 22, '2F5496') +
      `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="40"/><w:contextualSpacing/></w:pPr></w:style>` +
      `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>` +
      '</w:styles>';

    if (base) return mergeInto(base);

    /**
     * Reutiliza el .docx original: conserva encabezados, pies, márgenes, tamaño de página,
     * tema, fuentes y estilos; solo se reemplaza el cuerpo del documento.
     */
    async function mergeInto(zip) {
      const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const docPath = 'word/document.xml';
      const orig = await zip.file(docPath).async('string');
      const rootTag = (orig.match(/<w:document\b[^>]*>/) || [])[0];
      if (!rootTag) throw new Error('documento sin cuerpo');
      let root = rootTag;
      for (const [pfx, uri] of [['w', W], ['r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'],
        ['wp', 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'], ['a', 'http://schemas.openxmlformats.org/drawingml/2006/main'],
        ['pic', 'http://schemas.openxmlformats.org/drawingml/2006/picture']]) {
        if (!new RegExp(`xmlns:${pfx}=`).test(root)) root = root.replace(/>$/, ` xmlns:${pfx}="${uri}">`);
      }
      const bodyEnd = orig.lastIndexOf('</w:body>');
      const sectMatch = orig.slice(0, bodyEnd).match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>\s*$/) || orig.slice(0, bodyEnd).match(/<w:sectPr\b[^>]*\/>\s*$/);
      const sect = sectMatch ? sectMatch[0] : '';

      // estilos: usar los ids del documento (en Word en español "heading 1" puede llamarse "Ttulo1")
      const stylesPath = 'word/styles.xml';
      let styles = zip.file(stylesPath) ? await zip.file(stylesPath).async('string') : null;
      const styleId = (name, fallbackXml, fallbackId) => {
        if (styles) {
          const re = new RegExp(`<w:style\\b[^>]*w:styleId="([^"]+)"[^>]*>(?:(?!</w:style>)[\\s\\S])*?<w:name w:val="${name}"`, 'i');
          const m = styles.match(re);
          if (m) return m[1];
          if (!styles.includes(`w:styleId="${fallbackId}"`)) styles = styles.replace('</w:styles>', fallbackXml + '</w:styles>');
          return fallbackId;
        }
        return fallbackId;
      };
      const H = [1, 2, 3, 4, 5, 6].map(n => styleId(`heading ${n}`, heading(n, [32, 26, 24, 22, 22, 22][n - 1], n === 1 ? '1F3864' : '2F5496'), `Heading${n}`));
      const TI = styleId('Title', TITLE_XML, 'Title'), SU = styleId('Subtitle', SUBTITLE_XML, 'Subtitle');
      const LP = styleId('List Paragraph', `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>`, 'ListParagraph');
      const TG = styleId('Table Grid', `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>`, 'TableGrid');
      if (styles) zip.file(stylesPath, styles);

      // numeración: añadir nuestras listas con ids que no choquen
      const relsPath = 'word/_rels/document.xml.rels';
      let rels = zip.file(relsPath) ? await zip.file(relsPath).async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      let types = await zip.file('[Content_Types].xml').async('string');
      const OFF = 9000;
      if (numDefs.length) {
        const numRel = rels.match(/<Relationship\b[^>]*Type="[^"]*\/numbering"[^>]*>/);
        let numPath = numRel ? 'word/' + numRel[0].match(/Target="([^"]+)"/)[1].replace(/^\/?word\//, '').replace(/^\.\//, '') : 'word/numbering.xml';
        let num = zip.file(numPath) ? await zip.file(numPath).async('string') : null;
        const abs = numDefs.map(d => abstract(d.id + OFF, d.ordered)).join('');
        const nums = numDefs.map(d => `<w:num w:numId="${d.id + OFF}"><w:abstractNumId w:val="${d.id + OFF}"/></w:num>`).join('');
        if (num) {
          const firstNum = num.search(/<w:num\b/);
          num = firstNum >= 0 ? num.slice(0, firstNum) + abs + num.slice(firstNum) : num.replace('</w:numbering>', abs + '</w:numbering>');
          num = num.replace('</w:numbering>', nums + '</w:numbering>');
        } else {
          num = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="${W}">${abs}${nums}</w:numbering>`;
          numPath = 'word/numbering.xml';
          rels = rels.replace('</Relationships>', '<Relationship Id="rIdFolioNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>');
          if (!types.includes('/word/numbering.xml')) types = types.replace('</Types>', '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>');
        }
        zip.file(numPath, num);
      }

      // cuerpo con ids adaptados
      let b = body
        .replace(/<w:pStyle w:val="Heading(\d)"\/>/g, (_, n) => `<w:pStyle w:val="${H[n - 1]}"/>`)
        .replace(/<w:pStyle w:val="ListParagraph"\/>/g, `<w:pStyle w:val="${LP}"/>`)
        .replace(/<w:pStyle w:val="Title"\/>/g, `<w:pStyle w:val="${TI}"/>`)
        .replace(/<w:pStyle w:val="Subtitle"\/>/g, `<w:pStyle w:val="${SU}"/>`)
        .replace(/<w:tblStyle w:val="TableGrid"\/>/g, `<w:tblStyle w:val="${TG}"/>`)
        .replace(/<w:numId w:val="(\d+)"\/>/g, (_, n) => `<w:numId w:val="${+n + OFF}"/>`)
        .replace(/r:(embed|id)="rId(\d+)"/g, 'r:$1="rIdFolio$2"');

      // imágenes y enlaces nuevos
      for (const m of media) {
        const name = 'folio_' + m.name;
        zip.file('word/media/' + name, m.data);
        rels = rels.replace('</Relationships>', `<Relationship Id="${m.rid.replace('rId', 'rIdFolio')}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/></Relationships>`);
        if (!new RegExp(`Extension="${m.ext}"`, 'i').test(types)) types = types.replace('</Types>', `<Default Extension="${m.ext}" ContentType="image/${m.ext}"/></Types>`);
      }
      for (const l of links) rels = rels.replace('</Relationships>', `<Relationship Id="${l.rid.replace('rId', 'rIdFolio')}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEsc(l.url)}" TargetMode="External"/></Relationships>`);

      zip.file(docPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${root}<w:body>${b}${sect}</w:body></w:document>`);
      zip.file(relsPath, rels);
      zip.file('[Content_Types].xml', types);
      return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
    }

    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
      media.map(m => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('') +
      links.map(l => `<Relationship Id="${l.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEsc(l.url)}" TargetMode="External"/>`).join('') +
      '</Relationships>';

    const exts = [...new Set(media.map(m => m.ext))];
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      exts.map(e => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('') +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      '</Types>';

    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:creator>Folio</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;

    const zip = new JSZip();
    zip.file('[Content_Types].xml', types);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
    zip.file('docProps/core.xml', core);
    zip.file('word/document.xml', document_xml);
    zip.file('word/styles.xml', styles);
    zip.file('word/numbering.xml', numbering);
    zip.file('word/_rels/document.xml.rels', rels);
    for (const m of media) zip.file('word/media/' + m.name, m.data);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  }


  /* ---------- Recuperar formato que mammoth descarta (alineación, color, tamaño, fuente, resaltado) ---------- */
  const HL = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000' };
  async function enrichFromDocx(page, data) {
    const zip = await JSZip.loadAsync(data);
    const f = zip.file('word/document.xml');
    if (!f) return;
    const xml = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const wa = (n, a) => n && (n.getAttributeNS(W, a) || n.getAttribute('w:' + a));
    const child = (n, name) => n && [...n.children].find(c => c.localName === name);
    const strip = t => t.replace(/\s+/g, '');
    const body = xml.getElementsByTagNameNS(W, 'body')[0];
    if (!body) return;
    // párrafos del XML en orden (sin los de cuadros de texto)
    const xps = [...body.getElementsByTagNameNS(W, 'p')].filter(p => !p.parentNode.closest || !p.parentElement.closest('txbxContent'));
    const info = xps.map(p => {
      const runs = [];
      let text = '';
      for (const r of p.getElementsByTagNameNS(W, 'r')) {
        if (r.closest('p') !== p) continue;
        let t = '';
        for (const c of r.children) { if (c.localName === 't') t += c.textContent; else if (c.localName === 'tab') t += '\t'; }
        const rPr = child(r, 'rPr');
        const st = {};
        if (rPr) {
          const col = wa(child(rPr, 'color'), 'val'); if (col && col !== 'auto' && col.toUpperCase() !== '000000') st.color = '#' + col;
          const sz = wa(child(rPr, 'sz'), 'val'); if (sz) st.fontSize = +sz / 2 + 'pt';
          const fn = wa(child(rPr, 'rFonts'), 'ascii'); if (fn) st.fontFamily = fn;
          const hl = wa(child(rPr, 'highlight'), 'val'); if (hl && HL[hl]) st.backgroundColor = HL[hl];
          const shd = wa(child(rPr, 'shd'), 'fill'); if (!st.backgroundColor && shd && /^[0-9A-F]{6}$/i.test(shd) && shd.toUpperCase() !== 'FFFFFF') st.backgroundColor = '#' + shd;
        }
        const s0 = strip(text).length; text += t;
        if (Object.keys(st).length && strip(t)) runs.push({ from: s0, to: strip(text).length, st });
      }
      const jc = wa(child(child(p, 'pPr'), 'jc'), 'val');
      return { text: strip(text), runs, align: { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[jc] };
    }).filter(x => x.text || x.align);
    // bloques del HTML en orden
    const blocks = [...page.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li')].filter(b => !b.querySelector('p, li'));
    let j = 0;
    for (const b of blocks) {
      const bt = strip(b.textContent);
      if (!bt) continue;
      let k = j;
      while (k < info.length && info[k].text !== bt) k++;
      if (k >= info.length || k - j > 30) continue;   // sin coincidencia cercana: no tocar
      j = k + 1;
      const x = info[k];
      if (x.align) b.style.textAlign = x.align;
      for (const run of x.runs.slice().reverse()) wrapRange(b, run.from, run.to, run.st);
    }
  }
  // Envuelve los caracteres [from, to) (contando sin espacios) en un <span> con estilo
  function wrapRange(rootEl, from, to, st) {
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    let idx = 0, start = null, end = null, n;
    while ((n = walker.nextNode())) {
      const v = n.nodeValue;
      for (let i = 0; i < v.length; i++) {
        if (/\s/.test(v[i])) continue;
        if (idx === from && !start) start = [n, i];
        if (idx === to - 1) { end = [n, i + 1]; break; }
        idx++;
      }
      if (end) break;
    }
    if (!start || !end) return;
    const r = document.createRange();
    r.setStart(start[0], start[1]); r.setEnd(end[0], end[1]);
    const span = document.createElement('span');
    Object.assign(span.style, st);
    span.append(r.extractContents());
    r.insertNode(span);
  }

  /* ---------- Editor ---------- */
  function create(ctx) {
    let page, base = null;

    const cmd = (c, v = null) => { page.focus(); document.execCommand(c, false, v); ctx.dirty(); updateState(); };

    function updateState() {
      ctx.toolbar.querySelectorAll('[data-state]').forEach(b => {
        try { b.classList.toggle('on', document.queryCommandState(b.dataset.state)); } catch {}
      });
    }

    function buildToolbar() {
      const tb = ctx.toolbar;
      tb.innerHTML = '';
      const block = el('select', { class: 'tb', title: 'Estilo de párrafo' },
        el('option', { value: 'P' }, 'Normal'), el('option', { value: 'H1' }, 'Título 1'),
        el('option', { value: 'H2' }, 'Título 2'), el('option', { value: 'H3' }, 'Título 3'));
      block.addEventListener('change', () => { cmd('formatBlock', '<' + block.value + '>'); });
      const size = el('select', { class: 'tb', title: 'Tamaño' },
        ...[['2', 'Pequeño'], ['3', 'Normal'], ['4', 'Mediano'], ['5', 'Grande'], ['6', 'Muy grande']].map(([v, l]) => el('option', { value: v, selected: v === '3' }, l)));
      size.addEventListener('change', () => cmd('fontSize', size.value));
      const color = el('input', { type: 'color', class: 'tb-color', value: '#c00000', title: 'Color de texto' });
      color.addEventListener('input', () => cmd('foreColor', color.value));
      const imgIn = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif', hidden: true });
      imgIn.addEventListener('change', async () => {
        const f = imgIn.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => cmd('insertHTML', `<img src="${r.result}">`);
        r.readAsDataURL(f);
        imgIn.value = '';
      });
      // evita que los botones roben la selección del documento
      const b = (label, title, fn, state) => {
        const btn = el('button', { class: 'tb', title, 'aria-label': title, 'data-state': state, onmousedown: e => e.preventDefault(), onclick: fn }, typeof label === 'string' ? UI.icon(label) : label);
        btn.addEventListener('touchstart', () => saveSel(), { passive: true });
        return btn;
      };
      tb.append(
        b('undo', 'Deshacer', () => cmd('undo')), b('redo', 'Rehacer', () => cmd('redo')),
        el('span', { class: 'tb-sep' }), block,
        b(el('b', { class: 'glyph' }, 'B'), 'Negrita', () => cmd('bold'), 'bold'),
        b(el('i', { class: 'glyph' }, 'I'), 'Cursiva', () => cmd('italic'), 'italic'),
        b(el('u', { class: 'glyph' }, 'U'), 'Subrayado', () => cmd('underline'), 'underline'),
        b(el('s', { class: 'glyph' }, 'S'), 'Tachado', () => cmd('strikeThrough'), 'strikeThrough'),
        size, color,
        b('marker', 'Resaltar', () => cmd('hiliteColor', '#ffff00')),
        el('span', { class: 'tb-sep' }),
        b('list', 'Viñetas', () => cmd('insertUnorderedList'), 'insertUnorderedList'),
        b('listOl', 'Numeración', () => cmd('insertOrderedList'), 'insertOrderedList'),
        b('alignL', 'Alinear a la izquierda', () => cmd('justifyLeft'), 'justifyLeft'),
        b('alignC', 'Centrar', () => cmd('justifyCenter'), 'justifyCenter'),
        b('alignR', 'Alinear a la derecha', () => cmd('justifyRight'), 'justifyRight'),
        el('span', { class: 'tb-sep' }),
        b('image', 'Insertar imagen', () => imgIn.click()),
        b('table', 'Insertar tabla', insertTable),
        b('link', 'Enlace', insertLink),
        b('unformat', 'Quitar formato', () => cmd('removeFormat')),
        imgIn
      );
    }

    let savedRange = null;
    function saveSel() { const s = getSelection(); if (s.rangeCount && page.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange(); }
    function restoreSel() { if (savedRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); } }

    async function insertTable() {
      saveSel();
      const v = await prompt('Insertar tabla', '3x3', { label: 'Columnas x filas (ej. 3x4)' });
      if (!v) return;
      const [c, r] = v.toLowerCase().split(/[x×*, ]+/).map(n => Math.min(20, Math.max(1, parseInt(n) || 2)));
      let h = '<table><tbody>';
      for (let i = 0; i < (r || c); i++) h += '<tr>' + '<td><br></td>'.repeat(c) + '</tr>';
      restoreSel();
      cmd('insertHTML', h + '</tbody></table><p><br></p>');
    }

    async function insertLink() {
      saveSel();
      const url = await prompt('Insertar enlace', 'https://');
      if (!url || url === 'https://') return;
      restoreSel();
      const s = getSelection();
      if (s.isCollapsed) cmd('insertHTML', `<a href="${UI.xmlEsc(url)}">${UI.xmlEsc(url)}</a>`);
      else cmd('createLink', url);
    }

    async function open(data, name) {
      buildToolbar();
      page = el('div', { class: 'word-page', contenteditable: 'true', spellcheck: 'true' });
      ctx.workspace.append(el('div', { class: 'word-scroll' }, page));
      const ext = name.split('.').pop().toLowerCase();
      if (!data) page.innerHTML = '<p><br></p>';
      else if (ext === 'txt') {
        const text = new TextDecoder().decode(data);
        page.innerHTML = text.split(/\r?\n/).map(l => `<p>${UI.xmlEsc(l) || '<br>'}</p>`).join('');
      } else {
        const res = await mammoth.convertToHtml({ arrayBuffer: data }, {
          styleMap: ['u => u', 'strike => s', 'highlight => mark', "p[style-name='Title'] => h1.doc-title:fresh", "p[style-name='Subtitle'] => h2.doc-subtitle:fresh"],
          includeDefaultStyleMap: true
        });
        page.innerHTML = res.value || '<p><br></p>';
        try { await enrichFromDocx(page, data); } catch (e) { console.warn('formato extra no disponible', e); }
        try { base = await JSZip.loadAsync(data); } catch { base = null; }
        const lost = res.messages.filter(m => m.type === 'warning').length;
        if (lost) console.info('mammoth:', res.messages);
      }
      try { document.execCommand('styleWithCSS', false, false); } catch {}
      page.addEventListener('input', () => ctx.dirty());
      document.addEventListener('selectionchange', onSel);
      if (!data) setTimeout(() => page.focus(), 100);
      api.ext = 'docx';
    }
    function onSel() { if (page && page.contains(getSelection().anchorNode)) { saveSel(); updateState(); } }

    async function save(fmt) {
      if (fmt === 'txt') return new Blob([page.innerText], { type: 'text/plain;charset=utf-8' });
      if (fmt === 'html') return new Blob([`<!doctype html><meta charset="utf-8"><body>${page.innerHTML}</body>`], { type: 'text/html' });
      // Si el documento vino de un .docx se reutiliza el original (encabezados, pies, márgenes, estilos)
      if (base) {
        try { return await htmlToDocx(page, await JSZip.loadAsync(await base.generateAsync({ type: 'uint8array' }))); }
        catch (e) { console.warn('No se pudo reutilizar el original; se genera un .docx nuevo', e); }
      }
      return htmlToDocx(page);
    }

    const api = {
      open, save, ext: 'docx', kind: 'word',
      destroy() { document.removeEventListener('selectionchange', onSel); },
      formats: [{ label: 'Word (.docx)', value: 'docx' }, { label: 'Texto (.txt)', value: 'txt' }, { label: 'Página web (.html)', value: 'html' }]
    };
    return api;
  }

  return { create, htmlToDocx };
})();
