/* Editor de hojas de cálculo (SheetJS) con fórmulas básicas */
const ExcelEditor = (() => {
  const { el, toast, prompt, choose, confirm } = UI;
  const MAX_ROWS = 3000, MAX_COLS = 120;

  /* ---------- Mini evaluador de fórmulas ---------- */
  const FN = {
    SUM: a => a.flat(Infinity).filter(isNum).reduce((s, x) => s + x, 0),
    AVERAGE: a => { const n = a.flat(Infinity).filter(isNum); if (!n.length) throw 'DIV0'; return FN.SUM(n) / n.length; },
    MIN: a => { const n = a.flat(Infinity).filter(isNum); return n.length ? Math.min(...n) : 0; },
    MAX: a => { const n = a.flat(Infinity).filter(isNum); return n.length ? Math.max(...n) : 0; },
    COUNT: a => a.flat(Infinity).filter(isNum).length,
    COUNTA: a => a.flat(Infinity).filter(x => x !== '' && x != null).length,
    ROUND: a => { const [x, d = 0] = a.map(toNum); const f = 10 ** d; return Math.round(x * f) / f; },
    ABS: a => Math.abs(toNum(a[0])),
    SQRT: a => Math.sqrt(toNum(a[0])),
    IF: a => (truthy(a[0]) ? a[1] : a[2] ?? false),
    CONCATENATE: a => a.flat(Infinity).map(x => x ?? '').join(''),
    PRODUCT: a => a.flat(Infinity).filter(isNum).reduce((s, x) => s * x, 1),
    TODAY: () => { const d = new Date(); return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 864e5); }
  };
  // Nombres en español
  Object.assign(FN, { SUMA: FN.SUM, PROMEDIO: FN.AVERAGE, CONTAR: FN.COUNT, CONTARA: FN.COUNTA, REDONDEAR: FN.ROUND, RAIZ: FN.SQRT, SI: FN.IF, CONCATENAR: FN.CONCATENATE, PRODUCTO: FN.PRODUCT, HOY: FN.TODAY });
  // Excel guarda las fórmulas en inglés con coma como separador
  const ES_EN = { SUMA: 'SUM', PROMEDIO: 'AVERAGE', CONTAR: 'COUNT', CONTARA: 'COUNTA', REDONDEAR: 'ROUND', RAIZ: 'SQRT', SI: 'IF', CONCATENAR: 'CONCATENATE', PRODUCTO: 'PRODUCT', HOY: 'TODAY', VERDADERO: 'TRUE', FALSO: 'FALSE' };
  function toEnglish(f) {
    let out = '', inStr = false;
    for (let i = 0; i < f.length; i++) {
      const ch = f[i];
      if (ch === '"') { inStr = !inStr; out += ch; continue; }
      if (inStr) { out += ch; continue; }
      if (ch === ';') { out += ','; continue; }
      const m = /^[A-Za-zÁÉÍÓÚáéíóúÑñ_][A-Za-zÁÉÍÓÚáéíóúÑñ0-9_.]*(?=\s*\()/.exec(f.slice(i));
      if (m && (i === 0 || !/[A-Za-z0-9_.$]/.test(f[i - 1]))) {
        const up = m[0].toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        out += ES_EN[up] || m[0].toUpperCase();
        i += m[0].length - 1;
        continue;
      }
      out += ch;
    }
    return out;
  }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function toNum(x) { if (Array.isArray(x)) x = x.flat(Infinity)[0]; if (x === '' || x == null) return 0; if (typeof x === 'boolean') return +x; const n = +x; if (isNaN(n)) throw 'VALUE'; return n; }
  function truthy(x) { return typeof x === 'string' ? x !== '' : !!toNum(x); }

  function evaluate(formula, getCell) {
    const src = formula.replace(/^=/, '');
    let i = 0;
    const toks = [];
    const re = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|("(?:[^"]|"")*")|(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)|([A-Za-z_][A-Za-z0-9_.]*)\s*\(|(<=|>=|<>|[-+*/^&=<>(),;:%]))/y;
    while (i < src.length) {
      re.lastIndex = i;
      const m = re.exec(src);
      if (!m) { if (/^\s*$/.test(src.slice(i))) break; throw 'NAME'; }
      i = re.lastIndex;
      if (m[1]) toks.push({ t: 'num', v: +m[1] });
      else if (m[2]) toks.push({ t: 'str', v: m[2].slice(1, -1).replace(/""/g, '"') });
      else if (m[3]) toks.push({ t: 'ref', v: m[3].replace(/\$/g, '').toUpperCase() });
      else if (m[4]) toks.push({ t: 'fn', v: m[4].toUpperCase() });
      else toks.push({ t: 'op', v: m[5] === ';' ? ',' : m[5] });
    }
    let k = 0;
    const peek = () => toks[k], next = () => toks[k++];
    const expect = v => { const t = next(); if (!t || t.v !== v) throw 'PARSE'; };
    const refVal = r => {
      if (r.includes(':')) {
        const rg = XLSX.utils.decode_range(r), out = [];
        for (let R = rg.s.r; R <= rg.e.r; R++) for (let C = rg.s.c; C <= rg.e.c; C++) out.push(getCell(R, C));
        return out;
      }
      const a = XLSX.utils.decode_cell(r);
      return getCell(a.r, a.c);
    };
    function primary() {
      const t = next();
      if (!t) throw 'PARSE';
      if (t.t === 'num' || t.t === 'str') return t.v;
      if (t.t === 'ref') return refVal(t.v);
      if (t.t === 'fn') {
        const args = [];
        if (peek() && peek().v !== ')') { args.push(cmp()); while (peek() && peek().v === ',') { next(); args.push(cmp()); } }
        expect(')');
        if (t.v === 'TRUE' || t.v === 'VERDADERO') return true;
        if (t.v === 'FALSE' || t.v === 'FALSO') return false;
        const f = FN[t.v];
        if (!f) throw 'NAME';
        return f(args);
      }
      if (t.v === '(') { const v = cmp(); expect(')'); return v; }
      if (t.v === '-') return -toNum(unary());
      if (t.v === '+') return toNum(unary());
      throw 'PARSE';
    }
    function unary() { let v = primary(); while (peek() && peek().v === '%') { next(); v = toNum(v) / 100; } return v; }
    function pow() { let v = unary(); while (peek() && peek().v === '^') { next(); v = toNum(v) ** toNum(unary()); } return v; }
    function mul() {
      let v = pow();
      while (peek() && (peek().v === '*' || peek().v === '/')) {
        const o = next().v, r = toNum(pow());
        if (o === '/' && r === 0) throw 'DIV0';
        v = o === '*' ? toNum(v) * r : toNum(v) / r;
      }
      return v;
    }
    function add() { let v = mul(); while (peek() && (peek().v === '+' || peek().v === '-')) { const o = next().v; const r = mul(); v = o === '+' ? toNum(v) + toNum(r) : toNum(v) - toNum(r); } return v; }
    function cat() { let v = add(); while (peek() && peek().v === '&') { next(); v = String(v ?? '') + String(add() ?? ''); } return v; }
    function cmp() {
      let v = cat();
      while (peek() && ['=', '<', '>', '<=', '>=', '<>'].includes(peek().v)) {
        const o = next().v, r = cat();
        v = { '=': v == r, '<': v < r, '>': v > r, '<=': v <= r, '>=': v >= r, '<>': v != r }[o];
      }
      return v;
    }
    const res = cmp();
    if (k < toks.length) throw 'PARSE';
    return Array.isArray(res) ? res[0] : res;
  }

  function create(ctx) {
    let wb, sheetIdx = 0, sel = { r: 0, c: 0 }, fontScale = 1, srcExt = 'xlsx';
    let grid, table, refBox, input, tabs, note;

    const ws = () => wb.Sheets[wb.SheetNames[sheetIdx]];
    const addr = (r, c) => XLSX.utils.encode_cell({ r, c });

    function cellText(cell) {
      if (!cell) return '';
      if (cell.v === undefined || cell.v === null) return cell.f ? '=' + cell.f : '';
      if (cell.w !== undefined) return cell.w;
      if (cell.t === 'b') return cell.v ? 'VERDADERO' : 'FALSO';
      if (cell.t === 'e') return '#ERROR';
      if (cell.t === 'n' && cell.z) { try { return XLSX.SSF.format(cell.z, cell.v); } catch {} }
      if (cell.t === 'n') return String(Math.round(cell.v * 1e10) / 1e10);
      return String(cell.v);
    }

    function dims() {
      const ref = ws()['!ref'];
      const rg = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
      return {
        rows: Math.min(MAX_ROWS, Math.max(rg.e.r + 1 + 20, 50, ws()._extraRows || 0)),
        cols: Math.min(MAX_COLS, Math.max(rg.e.c + 1 + 3, 10, ws()._extraCols || 0)),
        truncated: rg.e.r + 1 > MAX_ROWS || rg.e.c + 1 > MAX_COLS
      };
    }

    function render() {
      const d = dims(), s = ws();
      const esc = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      let h = '<thead><tr><th class="rh"></th>';
      for (let c = 0; c < d.cols; c++) h += `<th data-c="${c}">${XLSX.utils.encode_col(c)}</th>`;
      h += '</tr></thead><tbody>';
      for (let r = 0; r < d.rows; r++) {
        h += `<tr><th class="rh" data-r="${r}">${r + 1}</th>`;
        for (let c = 0; c < d.cols; c++) {
          const cell = s[addr(r, c)];
          let cls = '';
          if (cell) {
            if (cell.t === 'n') cls = 'num';
            if (cell.f && (cell.v === undefined || cell.v === null)) cls += ' formula';
          }
          h += `<td data-r="${r}" data-c="${c}"${cls ? ` class="${cls.trim()}"` : ''}>${esc(cellText(cell))}</td>`;
        }
        h += '</tr>';
      }
      table.innerHTML = h + '</tbody>';
      table.style.fontSize = 14 * fontScale + 'px';
      note.textContent = d.truncated ? `Se muestran las primeras ${MAX_ROWS} filas y ${MAX_COLS} columnas (el resto se conserva al guardar).` : '';
      note.hidden = !d.truncated;
      renderTabs();
      select(Math.min(sel.r, d.rows - 1), Math.min(sel.c, d.cols - 1), false);
    }

    function renderTabs() {
      tabs.innerHTML = '';
      wb.SheetNames.forEach((n, i) => {
        tabs.append(el('button', { class: 'xl-tab' + (i === sheetIdx ? ' on' : ''), onclick: () => (i === sheetIdx ? sheetMenu() : switchSheet(i)) }, n, i === sheetIdx ? UI.icon('more', 14) : null));
      });
      tabs.append(el('button', { class: 'xl-tab xl-add', onclick: addSheet, title: 'Nueva hoja', 'aria-label': 'Nueva hoja' }, UI.icon('plus', 16)));
    }

    function switchSheet(i) { commit(); sheetIdx = i; sel = { r: 0, c: 0 }; render(); grid.scrollTo(0, 0); }

    async function addSheet() {
      let n = wb.SheetNames.length + 1, name;
      do name = 'Hoja' + n++; while (wb.SheetNames.includes(name));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), name);
      ctx.dirty();
      switchSheet(wb.SheetNames.length - 1);
    }

    async function sheetMenu() {
      const v = await choose('Hoja "' + wb.SheetNames[sheetIdx] + '"', [
        { label: 'Cambiar nombre', value: 'rename', icon: 'type' },
        { label: 'Eliminar hoja', value: 'delete', icon: 'trash' }
      ]);
      if (v === 'rename') {
        const old = wb.SheetNames[sheetIdx];
        let name = await prompt('Nombre de la hoja', old);
        if (!name) return;
        name = name.replace(/[\\/?*[\]:]/g, '').slice(0, 31).trim();
        if (!name || (name !== old && wb.SheetNames.includes(name))) return toast('Nombre no válido o repetido');
        wb.Sheets[name] = wb.Sheets[old];
        if (name !== old) delete wb.Sheets[old];
        wb.SheetNames[sheetIdx] = name;
        ctx.dirty(); renderTabs();
      } else if (v === 'delete') {
        if (wb.SheetNames.length === 1) return toast('El libro debe tener al menos una hoja');
        if (!(await confirm('Eliminar hoja', `¿Eliminar "${wb.SheetNames[sheetIdx]}"?`, 'Eliminar', true))) return;
        delete wb.Sheets[wb.SheetNames[sheetIdx]];
        wb.SheetNames.splice(sheetIdx, 1);
        if (wb.Workbook && wb.Workbook.Sheets) wb.Workbook.Sheets.splice(sheetIdx, 1);
        sheetIdx = Math.max(0, sheetIdx - 1);
        ctx.dirty(); render();
      }
    }

    function tdAt(r, c) { return table.querySelector(`td[data-r="${r}"][data-c="${c}"]`); }

    function select(r, c, focusInput = false) {
      table.querySelectorAll('.sel').forEach(x => x.classList.remove('sel'));
      table.querySelectorAll('.hl').forEach(x => x.classList.remove('hl'));
      sel = { r, c };
      const td = tdAt(r, c);
      if (td) {
        td.classList.add('sel');
        const ch = table.querySelector(`thead th[data-c="${c}"]`), rh = table.querySelector(`th[data-r="${r}"]`);
        ch && ch.classList.add('hl'); rh && rh.classList.add('hl');
        // mantener visible
        const g = grid.getBoundingClientRect(), b = td.getBoundingClientRect();
        if (b.bottom > g.bottom) grid.scrollTop += b.bottom - g.bottom + 4;
        if (b.top < g.top + 30) grid.scrollTop -= g.top + 30 - b.top;
        if (b.right > g.right) grid.scrollLeft += b.right - g.right + 4;
        if (b.left < g.left + 42) grid.scrollLeft -= g.left + 42 - b.left;
      }
      refBox.textContent = addr(r, c);
      const cell = ws()[addr(r, c)];
      input.value = !cell ? '' : cell.f ? '=' + cell.f : cell.t === 'b' ? (cell.v ? 'VERDADERO' : 'FALSO') : cell.v != null ? (cell.t === 'n' && !cell.z ? String(cell.v) : cellText(cell)) : '';
      input.dataset.orig = input.value;
      if (focusInput) input.focus();
    }

    function parseInput(txt) {
      const t = txt.trim();
      if (t === '') return null;
      if (t.startsWith('=') && t.length > 1) return { f: toEnglish(t.slice(1)) };
      if (/^-?\d+([.,]\d+)?$/.test(t)) return { t: 'n', v: parseFloat(t.replace(',', '.')) };
      if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return { t: 'n', v: parseFloat(t.replace(/\./g, '').replace(',', '.')) };
      if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return { t: 'n', v: parseFloat(t.replace(/,/g, '')) };
      if (/^-?\d+([.,]\d+)?\s*%$/.test(t)) return { t: 'n', v: parseFloat(t.replace(',', '.')) / 100, z: '0%' };
      const up = t.toUpperCase();
      if (up === 'VERDADERO' || up === 'TRUE') return { t: 'b', v: true };
      if (up === 'FALSO' || up === 'FALSE') return { t: 'b', v: false };
      return { t: 's', v: txt };
    }

    function commit() {
      if (!input || input.value === input.dataset.orig) return false;
      const s = ws(), a = addr(sel.r, sel.c), parsed = parseInput(input.value);
      const prev = s[a];
      if (!parsed) delete s[a];
      else {
        const cell = { ...parsed };
        if (prev && prev.z && cell.t === 'n' && !cell.z) cell.z = prev.z;
        if (prev && prev.s) cell.s = prev.s;
        s[a] = cell;
        // ampliar rango
        const rg = s['!ref'] ? XLSX.utils.decode_range(s['!ref']) : { s: { r: sel.r, c: sel.c }, e: { r: sel.r, c: sel.c } };
        rg.s.r = Math.min(rg.s.r, sel.r); rg.s.c = Math.min(rg.s.c, sel.c);
        rg.e.r = Math.max(rg.e.r, sel.r); rg.e.c = Math.max(rg.e.c, sel.c);
        s['!ref'] = XLSX.utils.encode_range(rg);
      }
      input.dataset.orig = input.value;
      recalc();
      ctx.dirty();
      return true;
    }

    /** Recalcula las fórmulas de todas las hojas (varias pasadas para dependencias) */
    function recalc() {
      for (let pass = 0; pass < 4; pass++) {
        for (const name of wb.SheetNames) {
          const s = wb.Sheets[name];
          const getCell = (r, c) => { const x = s[addr(r, c)]; return !x || x.v == null ? '' : x.v; };
          for (const k of Object.keys(s)) {
            if (k[0] === '!') continue;
            const cell = s[k];
            if (!cell.f) continue;
            try {
              const v = evaluate(cell.f, getCell);
              cell.v = v; cell.t = typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : 's';
              delete cell.w;
            } catch (e) {
              if (e === 'DIV0' || e === 'VALUE') { cell.t = 'e'; cell.v = 0; cell.w = e === 'DIV0' ? '#¡DIV/0!' : '#¡VALOR!'; }
              // fórmulas no soportadas: se conserva el valor del archivo y Excel la recalcula al abrir
            }
          }
        }
      }
      render.pending = true;
    }

    function refreshCells() {
      const s = ws();
      table.querySelectorAll('td').forEach(td => {
        const cell = s[addr(+td.dataset.r, +td.dataset.c)];
        const txt = cellText(cell);
        if (td.textContent !== txt) td.textContent = txt;
        td.classList.toggle('num', !!cell && cell.t === 'n');
        td.classList.toggle('formula', !!cell && !!cell.f && cell.v == null);
      });
    }

    function buildToolbar() {
      const tb = ctx.toolbar;
      tb.innerHTML = '';
      tb.append(
        UI.tbBtn('sigma', 'Suma automática', autoSum, { label: 'Suma' }),
        UI.tbBtn('clear', 'Borrar celda', () => { input.value = ''; commit(); refreshCells(); select(sel.r, sel.c); }, { label: 'Borrar' }),
        el('span', { class: 'tb-sep' }),
        UI.tbBtn('rows', 'Más filas', () => { ws()._extraRows = dims().rows + 20; render(); }, { label: 'Filas' }),
        UI.tbBtn('cols', 'Más columnas', () => { ws()._extraCols = dims().cols + 5; render(); }, { label: 'Columnas' }),
        el('span', { class: 'tb-sep' }),
        UI.tbBtn('textDown', 'Texto más pequeño', () => { fontScale = Math.max(0.6, fontScale - 0.15); table.style.fontSize = 14 * fontScale + 'px'; }),
        UI.tbBtn('textUp', 'Texto más grande', () => { fontScale = Math.min(2, fontScale + 0.15); table.style.fontSize = 14 * fontScale + 'px'; })
      );
    }

    function autoSum() {
      const s = ws();
      let r = sel.r - 1;
      while (r >= 0 && s[addr(r, sel.c)] && s[addr(r, sel.c)].t === 'n') r--;
      if (r === sel.r - 1) return toast('Selecciona la celda debajo de una columna de números');
      input.value = `=SUM(${addr(r + 1, sel.c)}:${addr(sel.r - 1, sel.c)})`;
      commit(); refreshCells(); select(sel.r, sel.c);
    }

    function buildUI() {
      refBox = el('div', { class: 'xl-ref' }, 'A1');
      input = el('input', { class: 'xl-input', placeholder: 'Escribe un valor o una fórmula (=SUMA(A1:A5))', enterkeyhint: 'next', autocomplete: 'off' });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); refreshCells(); select(sel.r + 1, sel.c, true); }
        else if (e.key === 'Tab') { e.preventDefault(); commit(); refreshCells(); select(sel.r, sel.c + 1, true); }
        else if (e.key === 'Escape') { input.value = input.dataset.orig; input.blur(); }
      });
      input.addEventListener('blur', () => { if (commit()) refreshCells(); });
      const ok = el('button', { class: 'xl-ok', 'aria-label': 'Confirmar', onclick: () => { commit(); refreshCells(); select(Math.min(sel.r + 1, dims().rows - 1), sel.c); } }, UI.icon('check', 18));
      table = el('table', { class: 'xl' });
      table.addEventListener('click', e => {
        const td = e.target.closest('td');
        if (!td) return;
        if (commit()) refreshCells();
        const r = +td.dataset.r, c = +td.dataset.c;
        const again = r === sel.r && c === sel.c;
        select(r, c, again);
      });
      table.addEventListener('dblclick', () => input.focus());
      grid = el('div', { class: 'xl-grid-wrap' }, table);
      tabs = el('div', { class: 'xl-tabs' });
      note = el('div', { class: 'xl-note' });
      ctx.workspace.append(el('div', { class: 'xl-wrap' }, el('div', { class: 'xl-bar' }, refBox, input, ok), note, grid, tabs));
      ctx.workspace.style.overflow = 'hidden';
    }

    async function open(data, name) {
      srcExt = (name.split('.').pop() || 'xlsx').toLowerCase();
      if (data) {
        wb = XLSX.read(new Uint8Array(data), { type: 'array', cellFormula: true, cellNF: true, cellStyles: true, codepage: 65001 });
      } else {
        wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Hoja1');
      }
      if (!wb.SheetNames.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Hoja1');
      api.ext = srcExt === 'csv' ? 'csv' : srcExt === 'ods' ? 'ods' : 'xlsx';
      buildToolbar();
      buildUI();
      render();
    }

    async function save(fmt) {
      commit();
      const type = fmt || api.ext;
      if (type === 'csv') {
        const csv = XLSX.utils.sheet_to_csv(ws());
        return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      }
      for (const n of wb.SheetNames) { delete wb.Sheets[n]._extraRows; delete wb.Sheets[n]._extraCols; }
      const out = XLSX.write(wb, { bookType: type, type: 'array', compression: true });
      return new Blob([out], { type: type === 'ods' ? 'application/vnd.oasis.opendocument.spreadsheet' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    const api = {
      open, save, destroy() { ctx.workspace.style.overflow = ''; }, ext: 'xlsx', kind: 'excel',
      formats: [{ label: 'Excel (.xlsx)', value: 'xlsx' }, { label: 'CSV de la hoja actual (.csv)', value: 'csv' }, { label: 'OpenDocument (.ods)', value: 'ods' }]
    };
    return api;
  }
  return { create, evaluate };
})();
