/* Importadores: convierten formatos adicionales en HTML (para el editor de documentos) o en PDF (imágenes) */
const Importers = (() => {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const para = t => `<p>${esc(t) || '<br>'}</p>`;
  const td = new TextDecoder('utf-8');

  /* ---------- Tipos de archivo ---------- */
  const TEXT_EXTS = ['txt', 'text', 'log', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'env', 'properties', 'toml',
    'js', 'mjs', 'ts', 'jsx', 'tsx', 'py', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'go', 'rs', 'swift',
    'sql', 'sh', 'bat', 'ps1', 'css', 'scss', 'vue', 'srt', 'vtt', 'tex'];
  const FORMATS = {
    pdf: ['pdf'],
    excel: ['xlsx', 'xlsm', 'xlsb', 'xls', 'xltx', 'xltm', 'xlw', 'ods', 'fods', 'ots', 'csv', 'tsv', 'tab', 'prn', 'numbers',
      'dif', 'slk', 'sylk', 'dbf', 'wk1', 'wk2', 'wk3', 'wk4', 'wks', 'wq1', '123', 'qpw', 'et', 'ett', 'uos'],
    word: ['docx', 'docm', 'dotx', 'dotm', 'doc', 'dot', 'odt', 'ott', 'fodt', 'rtf', 'md', 'markdown', 'html', 'htm', 'xhtml', ...TEXT_EXTS],
    ppt: ['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm'],
    outline: ['ppt', 'pps', 'pot', 'odp', 'otp'],         // presentaciones que se abren como texto
    image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'avif', 'ico']
  };
  const extOf = name => (name.split('.').pop() || '').toLowerCase();
  function kindOf(name) {
    const e = extOf(name);
    for (const [k, list] of Object.entries(FORMATS)) if (list.includes(e)) return k;
    return null;
  }
  const allExtensions = () => Object.values(FORMATS).flat();

  /* ---------- Texto plano y código ---------- */
  function decodeText(data) {
    const u8 = new Uint8Array(data);
    if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    const t = td.decode(u8);
    // si no es UTF-8 válido, probar Windows-1252 (archivos antiguos)
    return t.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(u8) : t;
  }
  function textToHtml(text, code) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    return lines.map(l => (code ? `<p class="code">${esc(l).replace(/\t/g, '    ').replace(/ {2}/g, ' &nbsp;') || '<br>'}</p>` : para(l))).join('');
  }

  /* ---------- Markdown ---------- */
  function inlineMd(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, a, u) => (/^(https?:|data:image\/)/.test(u) ? `<img alt="${a}" src="${u}">` : a))
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m, t, u) => (/^(https?:|mailto:)/.test(u) ? `<a href="${u}">${t}</a>` : t))
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (m, a, b) => `<b>${a || b}</b>`)
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<i>$2</i>')
      .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<i>$2</i>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>');
  }
  function markdownToHtml(md) {
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    let html = '', list = null, para = [], i = 0;
    const flushP = () => { if (para.length) { html += `<p>${inlineMd(para.join(' '))}</p>`; para = []; } };
    const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
    while (i < lines.length) {
      const l = lines[i];
      let m;
      if (/^```/.test(l)) {
        flushP(); closeList();
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { html += `<p class="code">${esc(lines[i]) || '<br>'}</p>`; i++; }
      } else if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { flushP(); closeList(); html += `<h${m[1].length}>${inlineMd(m[2].replace(/\s#+$/, ''))}</h${m[1].length}>`; }
      else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flushP(); closeList(); html += '<hr>'; }
      else if ((m = l.match(/^\s*[-*+]\s+(.*)$/))) { flushP(); if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += `<li>${inlineMd(m[1].replace(/^\[[ x]\]\s*/i, s => (/x/i.test(s) ? '☑ ' : '☐ ')))}</li>`; }
      else if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += `<li>${inlineMd(m[1])}</li>`; }
      else if ((m = l.match(/^>\s?(.*)$/))) { flushP(); closeList(); html += `<blockquote>${inlineMd(m[1])}</blockquote>`; }
      else if (/^\|.*\|\s*$/.test(l)) {
        flushP(); closeList();
        const rows = [];
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { if (!/^\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split('|')); i++; }
        html += '<table>' + rows.map((r, ri) => '<tr>' + r.map(c => `<${ri ? 'td' : 'th'}>${inlineMd(c.trim())}</${ri ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</table>';
        continue;
      } else if (!l.trim()) { flushP(); closeList(); }
      else { closeList(); para.push(l.trim()); }
      i++;
    }
    flushP(); closeList();
    return html || '<p><br></p>';
  }
  function htmlToMarkdown(root) {
    const out = [];
    const inline = n => [...n.childNodes].map(c => {
      if (c.nodeType === 3) return c.nodeValue.replace(/\s+/g, ' ');
      if (c.nodeType !== 1) return '';
      const t = inline(c), tag = c.tagName;
      if (tag === 'B' || tag === 'STRONG') return t.trim() ? `**${t}**` : t;
      if (tag === 'I' || tag === 'EM') return t.trim() ? `*${t}*` : t;
      if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') return `~~${t}~~`;
      if (tag === 'CODE') return '`' + t + '`';
      if (tag === 'A') return `[${t}](${c.getAttribute('href') || ''})`;
      if (tag === 'BR') return '  \n';
      if (tag === 'IMG') return /^https?:/.test(c.getAttribute('src') || '') ? `![${c.alt || ''}](${c.getAttribute('src')})` : '';
      return t;
    }).join('');
    const walk = (n, depth = 0) => {
      for (const c of n.children) {
        const tag = c.tagName;
        if (/^H[1-6]$/.test(tag)) out.push('#'.repeat(+tag[1]) + ' ' + inline(c).trim(), '');
        else if (tag === 'UL' || tag === 'OL') {
          [...c.children].forEach((li, k) => {
            const nested = [...li.children].filter(x => x.tagName === 'UL' || x.tagName === 'OL');
            const clone = li.cloneNode(true); clone.querySelectorAll('ul,ol').forEach(x => x.remove());
            out.push('  '.repeat(depth) + (tag === 'OL' ? `${k + 1}. ` : '- ') + inline(clone).trim());
            nested.forEach(x => walk({ children: [x] }, depth + 1));
          });
          if (!depth) out.push('');
        } else if (tag === 'TABLE') {
          const rows = [...c.rows].map(r => '| ' + [...r.cells].map(x => inline(x).trim().replace(/\|/g, '\\|')).join(' | ') + ' |');
          if (rows.length) { rows.splice(1, 0, '|' + ' --- |'.repeat(c.rows[0].cells.length)); out.push(...rows, ''); }
        } else if (tag === 'HR') out.push('---', '');
        else if (tag === 'BLOCKQUOTE') out.push('> ' + inline(c).trim(), '');
        else if (c.classList && c.classList.contains('code')) out.push('    ' + c.textContent);
        else if (tag === 'DIV' && c.children.length && [...c.children].some(x => /^(P|H\d|UL|OL|TABLE|DIV)$/.test(x.tagName))) walk(c, depth);
        else { const t = inline(c).trim(); out.push(t, ''); }
      }
    };
    walk(root);
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /* ---------- HTML (limpieza de seguridad) ---------- */
  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, link, meta, iframe, frame, frameset, object, embed, form, input, button, select, textarea, noscript, template, svg, math, base').forEach(n => n.remove());
    doc.querySelectorAll('*').forEach(n => {
      for (const a of [...n.attributes]) {
        const name = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction' || ((name === 'href' || name === 'src' || name === 'xlink:href') && (v.startsWith('javascript:') || (v.startsWith('data:') && !v.startsWith('data:image/'))))) n.removeAttribute(a.name);
        if (name === 'class' || name === 'id' || name === 'contenteditable') n.removeAttribute(a.name);
      }
    });
    return doc.body ? doc.body.innerHTML : '';
  }

  /* ---------- RTF ---------- */
  function rtfToHtml(rtf) {
    const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'object', 'fldinst', 'filetbl', 'revtbl', 'mmathPr', 'pgdsctbl', 'footnote']);
    const cp1252 = new TextDecoder('windows-1252');
    let html = '', p = '', i = 0, uc = 1;
    let st = { b: false, i: false, u: false, skip: false };
    const stack = [];
    const open = () => {
      let s = ''; if (st.b) s += '<b>'; if (st.i) s += '<i>'; if (st.u) s += '<u>'; return s;
    };
    const close = () => { let s = ''; if (st.u) s += '</u>'; if (st.i) s += '</i>'; if (st.b) s += '</b>'; return s; };
    const emit = t => { if (!st.skip && t) p += open() + esc(t) + close(); };
    const endPara = () => { html += `<p>${p || '<br>'}</p>`; p = ''; };
    while (i < rtf.length) {
      const c = rtf[i];
      if (c === '{') { stack.push({ ...st }); i++; if (rtf.startsWith('\\*', i)) { st.skip = true; } continue; }
      if (c === '}') { st = stack.pop() || st; i++; continue; }
      if (c === '\\') {
        const m = /^\\([a-zA-Z]+)(-?\d+)? ?|^\\'([0-9a-fA-F]{2})|^\\([^a-zA-Z])/.exec(rtf.slice(i, i + 40));
        if (!m) { i++; continue; }
        i += m[0].length;
        if (m[3]) { emit(cp1252.decode(new Uint8Array([parseInt(m[3], 16)]))); continue; }
        if (m[4]) { if (m[4] === '~') emit('\u00a0'); else if (m[4] === '\n' || m[4] === '\r') { if (!st.skip) endPara(); } else if ('\\{}'.includes(m[4])) emit(m[4]); continue; }
        const w = m[1], n = m[2] !== undefined ? +m[2] : null;
        if (SKIP.has(w)) { st.skip = true; continue; }
        switch (w) {
          case 'par': case 'sect': if (!st.skip) endPara(); break;
          case 'line': if (!st.skip) p += '<br>'; break;
          case 'tab': emit('\t'); break;
          case 'cell': emit('\t'); break;
          case 'row': if (!st.skip) endPara(); break;
          case 'page': if (!st.skip) endPara(); break;
          case 'b': st.b = n !== 0; break;
          case 'i': st.i = n !== 0; break;
          case 'ul': st.u = n !== 0; break;
          case 'ulnone': st.u = false; break;
          case 'plain': st.b = st.i = st.u = false; break;
          case 'uc': uc = n || 0; break;
          case 'u': emit(String.fromCharCode(n < 0 ? n + 65536 : n)); for (let k = 0; k < uc && i < rtf.length; k++) { if (rtf[i] === '\\' && rtf[i + 1] === "'") i += 4; else i++; } break;
          case 'emdash': emit('—'); break; case 'endash': emit('–'); break;
          case 'lquote': emit('‘'); break; case 'rquote': emit('’'); break;
          case 'ldblquote': emit('“'); break; case 'rdblquote': emit('”'); break;
          case 'bullet': emit('•'); break;
        }
        continue;
      }
      if (c === '\r' || c === '\n') { i++; continue; }
      let j = i;
      while (j < rtf.length && !'\\{}\r\n'.includes(rtf[j])) j++;
      emit(rtf.slice(i, j));
      i = j;
    }
    if (p) endPara();
    return html || '<p><br></p>';
  }

  /* ---------- OpenDocument (.odt / .odp) ---------- */
  async function odfToHtml(data, presentation) {
    const zip = await JSZip.loadAsync(data);
    const f = zip.file('content.xml');
    if (!f) throw new Error('No es un documento OpenDocument válido');
    const doc = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
    const NS = { text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0', style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0', fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0', draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', xlink: 'http://www.w3.org/1999/xlink', table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0', pres: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0' };
    // estilos automáticos -> css
    const css = {};
    const stylesXml = zip.file('styles.xml') ? new DOMParser().parseFromString(await zip.file('styles.xml').async('string'), 'application/xml') : null;
    for (const d of [stylesXml, doc]) {
      if (!d) continue;
      for (const s of d.getElementsByTagNameNS(NS.style, 'style')) {
        const name = s.getAttributeNS(NS.style, 'name');
        const tp = s.getElementsByTagNameNS(NS.style, 'text-properties')[0], pp = s.getElementsByTagNameNS(NS.style, 'paragraph-properties')[0];
        const st = {};
        if (tp) {
          if (tp.getAttributeNS(NS.fo, 'font-weight') === 'bold') st.fontWeight = 'bold';
          if (tp.getAttributeNS(NS.fo, 'font-style') === 'italic') st.fontStyle = 'italic';
          const ul = tp.getAttributeNS(NS.style, 'text-underline-style'); if (ul && ul !== 'none') st.textDecoration = 'underline';
          const col = tp.getAttributeNS(NS.fo, 'color'); if (col && col !== '#000000') st.color = col;
          const sz = tp.getAttributeNS(NS.fo, 'font-size'); if (sz && /pt$/.test(sz)) st.fontSize = sz;
          const bg = tp.getAttributeNS(NS.fo, 'background-color'); if (bg && bg !== 'transparent') st.backgroundColor = bg;
        }
        if (pp) { const al = pp.getAttributeNS(NS.fo, 'text-align'); if (al && /center|end|right|justify/.test(al)) st.textAlign = al === 'end' ? 'right' : al; }
        css[name] = st;
      }
    }
    const styleAttr = n => {
      const st = css[n.getAttributeNS(NS.text, 'style-name') || n.getAttributeNS(NS.draw, 'style-name') || n.getAttributeNS(NS.table, 'style-name')];
      if (!st) return '';
      const s = Object.entries(st).map(([k, v]) => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + ':' + v).join(';');
      return s ? ` style="${esc(s)}"` : '';
    };
    const images = {};
    async function img(href) {
      if (!href || images[href] !== undefined) return images[href];
      const file = zip.file(href.replace(/^\.\//, ''));
      const ext = href.split('.').pop().toLowerCase();
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml' }[ext];
      images[href] = file && mime ? `data:${mime};base64,${await file.async('base64')}` : null;
      return images[href];
    }
    async function inline(n) {
      let h = '';
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { h += esc(c.nodeValue); continue; }
        if (c.nodeType !== 1) continue;
        const ln = c.localName;
        if (ln === 's') h += ' '.repeat(+(c.getAttributeNS(NS.text, 'c') || 1)).replace(/ /g, '&nbsp;');
        else if (ln === 'tab') h += '&emsp;';
        else if (ln === 'line-break') h += '<br>';
        else if (ln === 'span') h += `<span${styleAttr(c)}>${await inline(c)}</span>`;
        else if (ln === 'a') { const u = c.getAttributeNS(NS.xlink, 'href') || ''; h += /^(https?:|mailto:)/.test(u) ? `<a href="${esc(u)}">${await inline(c)}</a>` : await inline(c); }
        else if (ln === 'frame') {
          const im = c.getElementsByTagNameNS(NS.draw, 'image')[0];
          const src = im && await img(im.getAttributeNS(NS.xlink, 'href'));
          if (src) h += `<img src="${src}">`;
          else { const tb = c.getElementsByTagNameNS(NS.draw, 'text-box')[0]; if (tb) h += await inline(tb); }
        } else if (ln === 'note' || ln === 'annotation' || ln === 'bookmark-ref' || ln === 'soft-page-break' || ln === 'sequence-decls') { /* omitir */ }
        else h += await inline(c);
      }
      return h;
    }
    async function blocks(n) {
      let h = '';
      for (const c of n.children) {
        const ln = c.localName;
        if (ln === 'p') h += `<p${styleAttr(c)}>${(await inline(c)) || '<br>'}</p>`;
        else if (ln === 'h') { const lv = Math.min(6, +(c.getAttributeNS(NS.text, 'outline-level') || 1)); h += `<h${lv}>${await inline(c)}</h${lv}>`; }
        else if (ln === 'list') {
          const ordered = /num/i.test(c.getAttributeNS(NS.text, 'style-name') || '');
          h += ordered ? '<ol>' : '<ul>';
          for (const it of c.children) if (it.localName === 'list-item' || it.localName === 'list-header') h += `<li>${(await blocks(it)).replace(/^<p[^>]*>([\s\S]*?)<\/p>/, '$1')}</li>`;
          h += ordered ? '</ol>' : '</ul>';
        } else if (ln === 'table') {
          h += '<table>';
          for (const row of c.getElementsByTagNameNS(NS.table, 'table-row')) {
            h += '<tr>';
            for (const cell of row.children) {
              if (cell.localName === 'covered-table-cell') continue;
              if (cell.localName !== 'table-cell') continue;
              const span = cell.getAttributeNS(NS.table, 'number-columns-spanned');
              h += `<td${span > 1 ? ` colspan="${span}"` : ''}>${await blocks(cell)}</td>`;
            }
            h += '</tr>';
          }
          h += '</table>';
        } else if (ln === 'section' || ln === 'index-body' || ln === 'table-of-content') h += await blocks(c);
        else if (ln === 'frame') h += `<p>${await inline({ childNodes: [c] })}</p>`;
      }
      return h;
    }
    if (presentation) {
      let h = '', k = 0;
      for (const page of doc.getElementsByTagNameNS(NS.draw, 'page')) {
        k++;
        let title = '', body = '';
        for (const fr of page.getElementsByTagNameNS(NS.draw, 'frame')) {
          const cls = fr.getAttributeNS(NS.pres, 'class');
          const tb = fr.getElementsByTagNameNS(NS.draw, 'text-box')[0];
          if (fr.closest && fr.parentElement && fr.parentElement.localName === 'notes') continue;
          if (cls === 'notes') continue;
          if (tb) { const t = await blocks(tb); if (cls === 'title' && !title) title = t.replace(/<[^>]+>/g, ' ').trim(); else body += t; }
          const im = fr.getElementsByTagNameNS(NS.draw, 'image')[0];
          if (im && !tb) { const src = await img(im.getAttributeNS(NS.xlink, 'href')); if (src) body += `<p><img src="${src}"></p>`; }
        }
        h += `<h2>Diapositiva ${k}${title ? ': ' + esc(title) : ''}</h2>${body}`;
      }
      return h || '<p><br></p>';
    }
    const office = doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0', 'text')[0];
    return office ? (await blocks(office)) || '<p><br></p>' : '<p><br></p>';
  }

  /* ---------- Word 97-2003 (.doc): extracción de texto ---------- */
  function cfbStream(cfb, name) {
    const e = cfb.FileIndex.find(f => f.name === name && f.type === 2);
    return e && e.content ? new Uint8Array(e.content) : null;
  }
  function docToHtml(data) {
    const cfb = XLSX.CFB.read(new Uint8Array(data), { type: 'array' });
    const wd = cfbStream(cfb, 'WordDocument');
    if (!wd) throw new Error('No es un documento de Word válido');
    const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    if (dv.getUint16(0, true) !== 0xA5EC) throw new Error('Formato de Word no reconocido (¿Word 6/95?)');
    const flags = dv.getUint16(0x0A, true);
    if (flags & 0x0100) throw new Error('El documento está protegido con contraseña');
    const table = cfbStream(cfb, flags & 0x0200 ? '1Table' : '0Table');
    if (!table) throw new Error('Documento incompleto');
    let pos = 32;
    const csw = dv.getUint16(pos, true); pos += 2 + csw * 2;
    const cslw = dv.getUint16(pos, true); const lw = pos + 2; pos += 2 + cslw * 4;
    const ccpText = dv.getInt32(lw + 3 * 4, true);
    pos += 2; // cbRgFcLcb
    const fcClx = dv.getUint32(pos + 33 * 8, true), lcbClx = dv.getUint32(pos + 33 * 8 + 4, true);
    const tv = new DataView(table.buffer, table.byteOffset, table.byteLength);
    let p = fcClx;
    const end = fcClx + lcbClx;
    while (p < end && table[p] === 0x01) p += 3 + tv.getUint16(p + 1, true);   // Prc
    if (table[p] !== 0x02) throw new Error('No se encontró el texto del documento');
    const lcb = tv.getUint32(p + 1, true); p += 5;
    const n = (lcb - 4) / 12;
    const cps = [], cp1252 = new TextDecoder('windows-1252'), u16 = new TextDecoder('utf-16le');
    for (let k = 0; k <= n; k++) cps.push(tv.getUint32(p + k * 4, true));
    let text = '';
    for (let k = 0; k < n; k++) {
      const pcd = p + (n + 1) * 4 + k * 8;
      const fcRaw = tv.getUint32(pcd + 2, true);
      const compressed = (fcRaw & 0x40000000) !== 0, fc = fcRaw & 0x3FFFFFFF;
      const count = cps[k + 1] - cps[k];
      text += compressed ? cp1252.decode(wd.subarray(fc / 2, fc / 2 + count)) : u16.decode(wd.subarray(fc, fc + count * 2));
      if (text.length >= ccpText) break;
    }
    text = text.slice(0, ccpText > 0 ? ccpText : text.length);
    // campos: mostrar solo el resultado
    text = text.replace(/\x13[^\x13\x14\x15]*\x14/g, '').replace(/\x13[^\x13\x14\x15]*\x15/g, '').replace(/[\x14\x15]/g, '');
    const paras = text.replace(/[\x01\x08]/g, '').split(/[\r\x0c]/);
    let html = '', row = [];
    for (const raw of paras) {
      if (raw.includes('\x07')) {
        // celdas de tabla: \x07 separa celdas; un \x07 solo cierra la fila
        const cells = raw.split('\x07');
        if (raw === '\x07' || (cells.length === 2 && !cells[0])) { if (row.length) { html += '<tr>' + row.map(c => `<td>${esc(c)}</td>`).join('') + '</tr>'; row = []; } continue; }
        row.push(...cells.filter((c, ci) => ci < cells.length - 1 || c));
        continue;
      }
      if (row.length) { html += '<tr>' + row.map(c => `<td>${esc(c)}</td>`).join('') + '</tr>'; row = []; }
      html += `<p>${esc(raw).replace(/\x0b/g, '<br>') || '<br>'}</p>`;
    }
    html = html.replace(/(<tr>.*?<\/tr>)+/g, m => `<table>${m}</table>`);
    return html;
  }

  /* ---------- PowerPoint 97-2003 (.ppt): extracción de texto ---------- */
  function pptToHtml(data) {
    const cfb = XLSX.CFB.read(new Uint8Array(data), { type: 'array' });
    const s = cfbStream(cfb, 'PowerPoint Document');
    if (!s) throw new Error('No es una presentación de PowerPoint válida');
    const dv = new DataView(s.buffer, s.byteOffset, s.byteLength);
    const u16 = new TextDecoder('utf-16le'), cp = new TextDecoder('windows-1252');
    const slwt = [];        // texto por diapositiva desde SlideListWithText
    const slides = [];      // texto por contenedor de diapositiva (cuadros de texto)
    function walk(start, end, ctx) {
      let p = start;
      while (p + 8 <= end) {
        const verInst = dv.getUint16(p, true), type = dv.getUint16(p + 2, true), len = dv.getUint32(p + 4, true);
        const body = p + 8, next = body + len;
        if (next > end || len < 0) break;
        const ver = verInst & 0xF, inst = verInst >> 4;
        if (ver === 0xF) {
          if (type === 0x0FF0 && inst === 0) walk(body, next, { list: true });
          else if (type === 0x03EE) { const sl = []; slides.push(sl); walk(body, next, { slide: sl }); }
          else if (type === 0x0FF0 || type === 0x03F0 || type === 0x0FD9 || type === 0x03F8) { /* patrones, notas */ }
          else walk(body, next, ctx);
        } else if (ctx.list && type === 0x03F3) slwt.push([]);
        else if (type === 0x0F9F) ctx.ttype = dv.getUint32(body, true);
        else if (type === 0x0FA0 || type === 0x0FA8) {
          const t = (type === 0x0FA0 ? u16.decode(s.subarray(body, next)) : cp.decode(s.subarray(body, next))).replace(/\r|\x0b/g, '\n').trim();
          if (t && t !== '*') {
            const item = { t, title: ctx.ttype === 0 || ctx.ttype === 6 };
            if (ctx.list && slwt.length) slwt[slwt.length - 1].push(item);
            else if (ctx.slide) ctx.slide.push(item);
          }
        }
        p = next;
      }
    }
    walk(0, s.length, {});
    const chars = arr => arr.reduce((a, sl) => a + sl.reduce((b, x) => b + x.t.length, 0), 0);
    const use = chars(slides) > chars(slwt) ? slides : slwt;
    let html = '';
    use.forEach((sl, i) => {
      const title = sl.find(x => x.title);
      html += `<h2>Diapositiva ${i + 1}${title ? ': ' + esc(title.t.split('\n')[0]) : ''}</h2>`;
      for (const x of sl) if (x !== title) html += x.t.split('\n').map(para).join('');
    });
    if (!html) throw new Error('No se encontró texto en la presentación');
    return html;
  }

  /* ---------- Imágenes -> PDF de una página ---------- */
  async function imageToPdf(data, name) {
    const ext = extOf(name);
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon' }[ext] || 'image/*';
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la imagen')); i.src = url; });
      let w = img.naturalWidth || 1000, h = img.naturalHeight || 1000;
      const doc = await PDFLib.PDFDocument.create();
      let embedded;
      if (ext === 'jpg' || ext === 'jpeg') embedded = await doc.embedJpg(data);
      else if (ext === 'png') embedded = await doc.embedPng(data);
      else {
        const c = document.createElement('canvas');
        const k = Math.min(1, 4000 / Math.max(w, h));
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        embedded = await doc.embedJpg(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92))).arrayBuffer());
      }
      const k = Math.min(1, 842 / Math.max(w, h)) || 1;     // como mucho A4 en su lado largo
      const pw = w * k, ph = h * k;
      doc.addPage([pw, ph]).drawImage(embedded, { x: 0, y: 0, width: pw, height: ph });
      return (await doc.save()).buffer;
    } finally { URL.revokeObjectURL(url); }
  }

  /**
   * Convierte un archivo que no es .docx en HTML para el editor de documentos.
   * Devuelve { html, saveExt, formats, note, code }
   */
  async function toDocument(data, name) {
    const e = extOf(name);
    const fmtDocx = { label: 'Word (.docx)', value: 'docx' };
    const common = [fmtDocx, { label: 'Texto (.txt)', value: 'txt' }, { label: 'Página web (.html)', value: 'html' }, { label: 'Markdown (.md)', value: 'md' }];
    if (e === 'doc' || e === 'dot') return { html: docToHtml(data), saveExt: 'docx', formats: common, note: 'Documento de Word antiguo (.doc): se muestra el texto. Se guardará como .docx.' };
    if (['ppt', 'pps', 'pot'].includes(e)) return { html: pptToHtml(data), saveExt: 'docx', formats: common, note: 'Presentación antigua (.ppt): se muestra el texto de cada diapositiva.' };
    if (e === 'odp' || e === 'otp') return { html: await odfToHtml(data, true), saveExt: 'docx', formats: common, note: 'Presentación OpenDocument: se muestra el texto y las imágenes de cada diapositiva.' };
    if (e === 'odt' || e === 'ott') return { html: await odfToHtml(data, false), saveExt: 'docx', formats: common };
    if (e === 'fodt') return { html: sanitizeHtml(new TextDecoder().decode(data).replace(/<\/?office:[^>]*>/g, '')), saveExt: 'docx', formats: common };
    if (e === 'rtf') return { html: rtfToHtml(decodeText(data)), saveExt: 'docx', formats: common };
    if (e === 'md' || e === 'markdown') return { html: markdownToHtml(decodeText(data)), saveExt: 'md', formats: [{ label: 'Markdown (.md)', value: 'md' }, fmtDocx, { label: 'Página web (.html)', value: 'html' }, { label: 'Texto (.txt)', value: 'txt' }] };
    if (e === 'html' || e === 'htm' || e === 'xhtml') return { html: sanitizeHtml(decodeText(data)) || '<p><br></p>', saveExt: 'html', formats: [{ label: 'Página web (.html)', value: 'html' }, fmtDocx, { label: 'Texto (.txt)', value: 'txt' }, { label: 'Markdown (.md)', value: 'md' }] };
    const code = e !== 'txt' && e !== 'text';
    return { html: textToHtml(decodeText(data), code), saveExt: e, code, formats: [{ label: `Texto (.${e})`, value: e }, fmtDocx, { label: 'Página web (.html)', value: 'html' }] };
  }

  return { FORMATS, TEXT_EXTS, kindOf, extOf, allExtensions, toDocument, imageToPdf, markdownToHtml, htmlToMarkdown, rtfToHtml, docToHtml, pptToHtml, odfToHtml, sanitizeHtml };
})();
