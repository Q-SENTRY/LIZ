/* Editor de hojas de cálculo (SheetJS) con fórmulas básicas */
const ExcelEditor = (() => {
  const { el, toast, prompt, choose, confirm } = UI;
  const MAX_ROWS = 100000, MAX_COLS = 200;
  const ROW_H = 32, WINDOW_EXTRA = 30;   // filas dibujadas fuera de pantalla

  /* ---------- Evaluador de fórmulas ---------- */
  class FErr { constructor(code) { this.code = code; } }
  const err = c => { throw new FErr(c); };
  const flat = a => (Array.isArray(a) ? a.flat(Infinity) : [a]);
  const nums = a => flat(a).filter(isNum);
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function toNum(x) {
    if (Array.isArray(x)) x = flat(x)[0];
    if (x === '' || x == null) return 0;
    if (typeof x === 'boolean') return +x;
    const n = +x; if (isNaN(n)) err('VALUE'); return n;
  }
  const toStr = x => (Array.isArray(x) ? toStr(flat(x)[0]) : x == null ? '' : typeof x === 'boolean' ? (x ? 'TRUE' : 'FALSE') : String(x));
  function truthy(x) { if (Array.isArray(x)) x = flat(x)[0]; return typeof x === 'string' ? (x.toUpperCase() === 'TRUE' || (x !== '' && x.toUpperCase() !== 'FALSE' && err('VALUE'))) : !!toNum(x); }
  const EPOCH = Date.UTC(1899, 11, 30);
  const serial = (y, m, d) => (Date.UTC(y, m - 1, d) - EPOCH) / 864e5;
  const fromSerial = n => new Date(EPOCH + Math.floor(toNum(n)) * 864e5);
  const rows2d = a => (Array.isArray(a) && Array.isArray(a[0]) ? a : Array.isArray(a) ? [a] : [[a]]);
  function eq(a, b) {
    if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
    return a === b || (a === '' && b === 0) || (a === 0 && b === '');
  }
  function crit(c) {
    const m = /^(<=|>=|<>|=|<|>)?(.*)$/s.exec(toStr(c));
    const op = m[1] || '=', raw = m[2];
    const n = raw !== '' && !isNaN(+raw) ? +raw : null;
    const re = n === null && /[*?]/.test(raw) ? new RegExp('^' + raw.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null;
    return v => {
      if (n !== null && (op !== '=' && op !== '<>' ? !isNum(v) : false)) return false;
      const cmpv = n !== null && isNum(v) ? v - n : n !== null ? NaN : toStr(v).toLowerCase().localeCompare(raw.toLowerCase());
      switch (op) {
        case '=': return re ? re.test(toStr(v)) : n !== null ? v === n || toStr(v) === raw : toStr(v).toLowerCase() === raw.toLowerCase();
        case '<>': return re ? !re.test(toStr(v)) : n !== null ? v !== n : toStr(v).toLowerCase() !== raw.toLowerCase();
        case '<': return cmpv < 0; case '>': return cmpv > 0; case '<=': return cmpv <= 0; case '>=': return cmpv >= 0;
      }
    };
  }
  function lookupExact(arr, key) { return arr.findIndex(v => eq(v, key) || (typeof key === 'string' && typeof v === 'string' && crit(key)(v))); }
  function lookupApprox(arr, key) { let idx = -1; for (let i = 0; i < arr.length; i++) { if (arr[i] === '' || arr[i] == null) continue; if (isNum(key) ? arr[i] <= key : toStr(arr[i]).toLowerCase() <= toStr(key).toLowerCase()) idx = i; else break; } return idx; }
  const round = (x, d, mode) => { const f = 10 ** d; const v = x * f; const r = mode === 'up' ? Math.sign(v) * Math.ceil(Math.abs(v) - 1e-9) : mode === 'down' ? Math.trunc(v) : Math.sign(v) * Math.round(Math.abs(v) + 1e-9); return r / f; };

  const FN = {
    TRUE: () => true, FALSE: () => false,
    SUM: a => nums(a).reduce((s, x) => s + x, 0),
    AVERAGE: a => { const n = nums(a); if (!n.length) err('DIV0'); return n.reduce((s, x) => s + x, 0) / n.length; },
    MIN: a => { const n = nums(a); return n.length ? Math.min(...n) : 0; },
    MAX: a => { const n = nums(a); return n.length ? Math.max(...n) : 0; },
    MEDIAN: a => { const n = nums(a).sort((x, y) => x - y); if (!n.length) err('NUM'); const h = n.length >> 1; return n.length % 2 ? n[h] : (n[h - 1] + n[h]) / 2; },
    COUNT: a => nums(a).length,
    COUNTA: a => flat(a).filter(x => x !== '' && x != null).length,
    COUNTBLANK: a => flat(a).filter(x => x === '' || x == null).length,
    PRODUCT: a => nums(a).reduce((s, x) => s * x, 1),
    ROUND: a => round(toNum(a[0]), toNum(a[1] ?? 0)),
    ROUNDUP: a => round(toNum(a[0]), toNum(a[1] ?? 0), 'up'),
    ROUNDDOWN: a => round(toNum(a[0]), toNum(a[1] ?? 0), 'down'),
    INT: a => Math.floor(toNum(a[0])),
    MOD: a => { const d = toNum(a[1]); if (!d) err('DIV0'); const n = toNum(a[0]); return n - d * Math.floor(n / d); },
    POWER: a => toNum(a[0]) ** toNum(a[1]),
    ABS: a => Math.abs(toNum(a[0])),
    SQRT: a => { const n = toNum(a[0]); if (n < 0) err('NUM'); return Math.sqrt(n); },
    AND: a => flat(a).filter(x => x !== '').every(truthy),
    OR: a => flat(a).filter(x => x !== '').some(truthy),
    NOT: a => !truthy(a[0]),
    CONCATENATE: a => flat(a).map(toStr).join(''),
    CONCAT: a => flat(a).map(toStr).join(''),
    LEN: a => toStr(a[0]).length,
    UPPER: a => toStr(a[0]).toUpperCase(),
    LOWER: a => toStr(a[0]).toLowerCase(),
    TRIM: a => toStr(a[0]).trim().replace(/ +/g, ' '),
    LEFT: a => toStr(a[0]).slice(0, a.length > 1 ? toNum(a[1]) : 1),
    RIGHT: a => { const s = toStr(a[0]), n = a.length > 1 ? toNum(a[1]) : 1; return n ? s.slice(-n) : ''; },
    MID: a => toStr(a[0]).substr(toNum(a[1]) - 1, toNum(a[2])),
    TODAY: () => { const d = new Date(); return serial(d.getFullYear(), d.getMonth() + 1, d.getDate()); },
    NOW: () => { const d = new Date(); return serial(d.getFullYear(), d.getMonth() + 1, d.getDate()) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; },
    DATE: a => serial(toNum(a[0]), toNum(a[1]), toNum(a[2])),
    YEAR: a => fromSerial(a[0]).getUTCFullYear(),
    MONTH: a => fromSerial(a[0]).getUTCMonth() + 1,
    DAY: a => fromSerial(a[0]).getUTCDate(),
    SUMIF: a => { const r = flat(a[0]), s = a.length > 2 ? flat(a[2]) : r, t = crit(a[1]); return r.reduce((acc, v, i) => acc + (t(v) && isNum(s[i]) ? s[i] : 0), 0); },
    COUNTIF: a => { const t = crit(a[1]); return flat(a[0]).filter(t).length; },
    AVERAGEIF: a => { const r = flat(a[0]), s = a.length > 2 ? flat(a[2]) : r, t = crit(a[1]); const v = r.map((x, i) => (t(x) && isNum(s[i]) ? s[i] : null)).filter(x => x !== null); if (!v.length) err('DIV0'); return v.reduce((x, y) => x + y, 0) / v.length; },
    VLOOKUP: a => {
      const rows = rows2d(a[1]), col = toNum(a[2]), approx = a.length < 4 || truthy(a[3]);
      if (col < 1 || col > rows[0].length) err('REF');
      const first = rows.map(r => r[0]);
      const i = approx ? lookupApprox(first, a[0]) : lookupExact(first, a[0]);
      if (i < 0) err('NA'); return rows[i][col - 1];
    },
    HLOOKUP: a => {
      const rows = rows2d(a[1]), row = toNum(a[2]), approx = a.length < 4 || truthy(a[3]);
      if (row < 1 || row > rows.length) err('REF');
      const i = approx ? lookupApprox(rows[0], a[0]) : lookupExact(rows[0], a[0]);
      if (i < 0) err('NA'); return rows[row - 1][i];
    },
    INDEX: a => {
      const rows = rows2d(a[0]); let r = toNum(a[1]), c = a.length > 2 ? toNum(a[2]) : 0;
      if (rows.length === 1 && a.length === 2) { c = r; r = 1; }
      if (!c) c = 1;
      const row = rows[r - 1]; if (!row || row[c - 1] === undefined) err('REF'); return row[c - 1];
    },
    MATCH: a => {
      const arr = flat(a[1]), type = a.length > 2 ? toNum(a[2]) : 1;
      const i = type === 0 ? lookupExact(arr, a[0]) : type > 0 ? lookupApprox(arr, a[0]) : -1;
      if (i < 0) err('NA'); return i + 1;
    }
  };
  // Nombres en español -> inglés (Excel guarda las fórmulas en inglés)
  const ES_EN = {
    SUMA: 'SUM', PROMEDIO: 'AVERAGE', CONTAR: 'COUNT', CONTARA: 'COUNTA', 'CONTAR.BLANCO': 'COUNTBLANK', REDONDEAR: 'ROUND',
    'REDONDEAR.MAS': 'ROUNDUP', 'REDONDEAR.MENOS': 'ROUNDDOWN', RAIZ: 'SQRT', SI: 'IF', 'SI.ERROR': 'IFERROR', CONCATENAR: 'CONCATENATE',
    PRODUCTO: 'PRODUCT', HOY: 'TODAY', AHORA: 'NOW', VERDADERO: 'TRUE', FALSO: 'FALSE', Y: 'AND', O: 'OR', NO: 'NOT', LARGO: 'LEN',
    MAYUSC: 'UPPER', MINUSC: 'LOWER', ESPACIOS: 'TRIM', IZQUIERDA: 'LEFT', DERECHA: 'RIGHT', EXTRAE: 'MID', ENTERO: 'INT',
    RESIDUO: 'MOD', POTENCIA: 'POWER', FECHA: 'DATE', ANO: 'YEAR', MES: 'MONTH', DIA: 'DAY', MEDIANA: 'MEDIAN',
    'SUMAR.SI': 'SUMIF', 'CONTAR.SI': 'COUNTIF', 'PROMEDIO.SI': 'AVERAGEIF', BUSCARV: 'VLOOKUP', BUSCARH: 'HLOOKUP',
    INDICE: 'INDEX', COINCIDIR: 'MATCH', ABS: 'ABS', MIN: 'MIN', MAX: 'MAX'
  };
  const normName = n => n.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function toEnglish(f) {
    let out = '', inStr = false;
    for (let i = 0; i < f.length; i++) {
      const ch = f[i];
      if (ch === '"') { inStr = !inStr; out += ch; continue; }
      if (inStr) { out += ch; continue; }
      if (ch === "'") { const j = f.indexOf("'", i + 1); if (j > i) { out += f.slice(i, j + 1); i = j; continue; } }
      if (ch === ';') { out += ','; continue; }
      const b = /^(VERDADERO|FALSO)(?![\w(.])/i.exec(f.slice(i));
      if (b && (i === 0 || !/[A-Za-z0-9_.$!]/.test(f[i - 1]))) { out += b[1].toUpperCase() === 'FALSO' ? 'FALSE' : 'TRUE'; i += b[0].length - 1; continue; }
      const m = /^[A-Za-zÁÉÍÓÚáéíóúÑñ_][A-Za-zÁÉÍÓÚáéíóúÑñ0-9_.]*(?=\s*\()/.exec(f.slice(i));
      if (m && (i === 0 || !/[A-Za-z0-9_.$]/.test(f[i - 1]))) {
        const up = normName(m[0]);
        out += ES_EN[up] || up;
        i += m[0].length - 1;
        continue;
      }
      out += ch;
    }
    return out;
  }

  const ERR_TEXT = { DIV0: '#¡DIV/0!', VALUE: '#¡VALOR!', NA: '#N/A', REF: '#¡REF!', NUM: '#¡NUM!', NAME: '#¿NOMBRE?' };
  const COL = '\\$?[A-Za-z]{1,3}', ROW = '\\$?\\d+';
  const TOKEN = new RegExp(String.raw`\s*(?:` +
    String.raw`((?:'(?:[^']|'')+'|[A-Za-z_À-ɏ][\w.À-ɏ]*)!)?(${COL}${ROW}(?::${COL}${ROW})?|${COL}:${COL}|${ROW}:${ROW})(?![\w(])` + // 1 hoja, 2 ref
    String.raw`|(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)` +            // 3 número
    String.raw`|("(?:[^"]|"")*")` +                                     // 4 texto
    String.raw`|([A-Za-z_][A-Za-z0-9_.]*)\s*\(` +                       // 5 función
    String.raw`|(TRUE|FALSE|VERDADERO|FALSO)(?![\w(])` +                                // 6 lógico
    String.raw`|(#[A-Z0-9/!?]+)` +                                      // 7 error literal
    String.raw`|(<=|>=|<>|[-+*/^&=<>(),;%]))`, 'iy');                  // 8 operador
  const tokCache = new Map();
  function tokenize(src) {
    if (tokCache.has(src)) return tokCache.get(src);
    const toks = [];
    let i = 0;
    while (i < src.length) {
      TOKEN.lastIndex = i;
      const m = TOKEN.exec(src);
      if (!m) { if (/^\s*$/.test(src.slice(i))) break; throw new FErr('NAME'); }
      i = TOKEN.lastIndex;
      if (m[2]) toks.push({ t: 'ref', sheet: m[1] ? m[1].slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'") : null, v: m[2].replace(/\$/g, '').toUpperCase() });
      else if (m[3]) toks.push({ t: 'num', v: +m[3] });
      else if (m[4]) toks.push({ t: 'str', v: m[4].slice(1, -1).replace(/""/g, '"') });
      else if (m[5]) toks.push({ t: 'fn', v: normName(m[5]) });
      else if (m[6]) toks.push({ t: 'bool', v: /^(TRUE|VERDADERO)$/i.test(m[6]) });
      else if (m[7]) toks.push({ t: 'err', v: m[7] });
      else toks.push({ t: 'op', v: m[8] === ';' ? ',' : m[8] });
    }
    if (tokCache.size > 20000) tokCache.clear();
    tokCache.set(src, toks);
    return toks;
  }

  /**
   * Evalúa una fórmula. env: { get(sheet, r, c), bounds(sheet) -> {rows, cols} }
   * sheet = null significa la hoja actual.
   */
  function evaluate(formula, env) {
    if (typeof env === 'function') { const g = env; env = { get: (s, r, c) => g(r, c), bounds: () => ({ rows: 1e4, cols: 100 }) }; }
    const toks = tokenize(formula.replace(/^=/, ''));
    let k = 0;
    const peek = () => toks[k], next = () => toks[k++];
    const expect = v => { const t = next(); if (!t || t.v !== v) err('NAME'); };
    function refVal(t) {
      const r = t.v;
      if (r.includes(':')) {
        let [a, b] = r.split(':');
        const bd = env.bounds(t.sheet);
        if (/^[A-Z]+$/.test(a)) { a += '1'; b += bd.rows; }
        else if (/^\d+$/.test(a)) { a = 'A' + a; b = XLSX.utils.encode_col(bd.cols - 1) + b; }
        const rg = XLSX.utils.decode_range(a + ':' + b), out = [];
        rg.e.r = Math.min(rg.e.r, rg.s.r + 1e5);
        for (let R = rg.s.r; R <= rg.e.r; R++) { const row = []; for (let C = rg.s.c; C <= rg.e.c; C++) row.push(env.get(t.sheet, R, C)); out.push(row); }
        return out;
      }
      const a = XLSX.utils.decode_cell(r);
      return env.get(t.sheet, a.r, a.c);
    }
    const tryArg = () => { try { return { v: cmp() }; } catch (e) { if (e instanceof FErr) { skipArg(); return { e }; } throw e; } };
    function skipArg() { let depth = 0; while (k < toks.length) { const t = toks[k]; if (t.v === '(' || t.t === 'fn') depth++; else if (t.v === ')') { if (!depth) return; depth--; } else if (t.v === ',' && !depth) return; k++; } }
    function primary() {
      const t = next();
      if (!t) err('NAME');
      if (t.t === 'num' || t.t === 'str' || t.t === 'bool') return t.v;
      if (t.t === 'err') err(Object.keys(ERR_TEXT).find(c => ERR_TEXT[c] === t.v) || 'VALUE');
      if (t.t === 'ref') return refVal(t);
      if (t.t === 'fn') {
        const name = ES_EN[t.v] || t.v;
        if (name === 'IF' || name === 'IFERROR') {
          const args = [];
          if (peek() && peek().v !== ')') { args.push(tryArg()); while (peek() && peek().v === ',') { next(); args.push(tryArg()); } }
          expect(')');
          const pick = x => { if (!x) return name === 'IF' ? false : 0; if (x.e) throw x.e; return x.v; };
          if (name === 'IFERROR') return args[0] && !args[0].e ? args[0].v : pick(args[1]);
          if (args[0].e) throw args[0].e;
          return truthy(args[0].v) ? pick(args[1] || { v: true }) : pick(args[2]);
        }
        const args = [];
        if (peek() && peek().v !== ')') { args.push(cmp()); while (peek() && peek().v === ',') { next(); args.push(cmp()); } }
        expect(')');
        const f = FN[name];
        if (!f) err('NAME');
        return f(args);
      }
      if (t.v === '(') { const v = cmp(); expect(')'); return v; }
      if (t.v === '-') return -toNum(unary());
      if (t.v === '+') return toNum(unary());
      err('NAME');
    }
    function unary() { let v = primary(); while (peek() && peek().v === '%') { next(); v = toNum(v) / 100; } return v; }
    function pow() { let v = unary(); while (peek() && peek().v === '^') { next(); v = toNum(v) ** toNum(unary()); } return v; }
    function mul() {
      let v = pow();
      while (peek() && (peek().v === '*' || peek().v === '/')) {
        const o = next().v, r = toNum(pow());
        if (o === '/' && r === 0) err('DIV0');
        v = o === '*' ? toNum(v) * r : toNum(v) / r;
      }
      return v;
    }
    function add() { let v = mul(); while (peek() && (peek().v === '+' || peek().v === '-')) { const o = next().v; const r = mul(); v = o === '+' ? toNum(v) + toNum(r) : toNum(v) - toNum(r); } return v; }
    function cat() { let v = add(); while (peek() && peek().v === '&') { next(); v = toStr(v) + toStr(add()); } return v; }
    function cmp() {
      let v = cat();
      while (peek() && ['=', '<', '>', '<=', '>=', '<>'].includes(peek().v)) {
        const o = next().v; let r = cat();
        let a = Array.isArray(v) ? flat(v)[0] : v; r = Array.isArray(r) ? flat(r)[0] : r;
        if (typeof a === 'string' && typeof r === 'string') { a = a.toLowerCase(); r = r.toLowerCase(); }
        if (a === '') a = typeof r === 'string' ? '' : 0;
        if (r === '') r = typeof a === 'string' ? '' : 0;
        v = { '=': a === r, '<': a < r, '>': a > r, '<=': a <= r, '>=': a >= r, '<>': a !== r }[o];
      }
      return v;
    }
    const res = cmp();
    if (k < toks.length) err('NAME');
    return Array.isArray(res) ? flat(res)[0] ?? 0 : res;
  }

  function create(ctx) {
    let wb, sheetIdx = 0, sel = { r: 0, c: 0 }, zoom = 1, srcExt = 'xlsx';
    let win = { first: 0, last: -1 }, totalRows = 0, totalCols = 0, scrollRaf = 0;
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

    /* Se dibujan solo las filas visibles (más un margen): hojas enormes no trancan el celular */
    const esc = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    function rowHtml(r) {
      const s = ws();
      let h = `<tr><th class="rh" data-r="${r}">${r + 1}</th>`;
      for (let c = 0; c < totalCols; c++) {
        const cell = s[addr(r, c)];
        let cls = '';
        if (cell) {
          if (cell.t === 'n') cls = 'num';
          if (cell.f && (cell.v === undefined || cell.v === null)) cls += ' formula';
        }
        if (r === sel.r && c === sel.c) cls += ' sel';
        h += `<td data-r="${r}" data-c="${c}"${cls ? ` class="${cls.trim()}"` : ''}>${esc(cellText(cell))}</td>`;
      }
      return h + '</tr>';
    }
    function wantedWindow() {
      const rowPx = ROW_H * zoom;
      const top = Math.max(0, grid.scrollTop / rowPx - 1);
      const visible = Math.ceil(grid.clientHeight / rowPx) + 1;
      const first = Math.max(0, Math.floor(top) - WINDOW_EXTRA);
      const last = Math.min(totalRows - 1, Math.floor(top) + visible + WINDOW_EXTRA);
      return { first, last };
    }
    function renderRows(force) {
      const w = wantedWindow();
      if (!force && w.first >= win.first && w.last <= win.last && w.first - win.first < WINDOW_EXTRA * 1.5) return;
      win = w;
      let h = '';
      if (w.first > 0) h += `<tr class="xl-spacer"><td colspan="${totalCols + 1}" style="height:${w.first * ROW_H}px"></td></tr>`;
      for (let r = w.first; r <= w.last; r++) h += rowHtml(r);
      if (w.last < totalRows - 1) h += `<tr class="xl-spacer"><td colspan="${totalCols + 1}" style="height:${(totalRows - 1 - w.last) * ROW_H}px"></td></tr>`;
      table.tBodies[0].innerHTML = h;
      const rh = table.querySelector(`th[data-r="${sel.r}"]`);
      if (rh) rh.classList.add('hl');
    }
    function render() {
      const d = dims();
      totalRows = d.rows; totalCols = d.cols;
      let h = '<thead><tr><th class="rh"></th>';
      for (let c = 0; c < d.cols; c++) h += `<th data-c="${c}">${XLSX.utils.encode_col(c)}</th>`;
      table.innerHTML = h + '</tr></thead><tbody></tbody>';
      table.style.zoom = zoom;
      win = { first: 0, last: -1 };
      renderRows(true);
      note.textContent = d.truncated ? `Se muestran las primeras ${MAX_ROWS} filas y ${MAX_COLS} columnas (el resto se conserva al guardar).` : '';
      note.hidden = !d.truncated;
      renderTabs();
      select(Math.min(sel.r, d.rows - 1), Math.min(sel.c, d.cols - 1), false);
    }
    function setZoom(z) {
      zoom = Math.max(0.5, Math.min(2.5, z));
      table.style.zoom = zoom;
      renderRows(true);
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
      if (r < win.first || r > win.last) {
        // fila fuera de lo dibujado: desplazar hasta ella y dibujar esa zona
        grid.scrollTop = Math.max(0, (r - 3) * ROW_H * zoom);
        renderRows(true);
      }
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
      input.value = editText(cell);
      input.dataset.orig = input.value;
      if (focusInput) input.focus();
    }

    /** Texto que se muestra al editar una celda: números sin separadores de miles ni símbolos (fáciles de corregir) */
    function editText(cell) {
      if (!cell) return '';
      if (cell.f) return '=' + cell.f;
      if (cell.t === 'b') return cell.v ? 'VERDADERO' : 'FALSO';
      if (cell.v == null) return '';
      if (cell.t === 'n') {
        const z = cell.z || '';
        if (z && XLSX.SSF.is_date(z)) return cellText(cell);                  // fechas: como se ven
        if (/%/.test(z)) return +(cell.v * 100).toPrecision(12) + '%';          // porcentajes
        return String(+cell.v.toPrecision(15));                                // número limpio
      }
      return cellText(cell);
    }

    /** Convierte "1,500" / "1.500,25" / "1,5" / "$2,000.00" en número, o null si no es número */
    function parseNumber(t) {
      let s = t.replace(/[\s\u00a0]/g, '').replace(/^[\$€£¥]|[\$€£¥]$|^(COP|USD|EUR|MXN|ARS|CLP|PEN)|(COP|USD|EUR|MXN|ARS|CLP|PEN)$/gi, '');
      let neg = false;
      if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
      if (/^[-+]?\d+$/.test(s)) return (neg ? -1 : 1) * parseFloat(s);
      if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return (neg ? -1 : 1) * parseFloat(s.replace(/,/g, ''));            // 1,500 · 1,234,567.89
      if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return (neg ? -1 : 1) * parseFloat(s.replace(/\./g, '').replace(',', '.')); // 1.500 · 1.234.567,89
      if (/^[-+]?\d*\.\d+$/.test(s)) return (neg ? -1 : 1) * parseFloat(s);                                                   // 1.5
      if (/^[-+]?\d*,\d+$/.test(s)) return (neg ? -1 : 1) * parseFloat(s.replace(',', '.'));                                  // 1,5 (decimal con coma)
      return null;
    }
    /** "20/04/2026", "2026-04-20", "20-04-2026" -> número de serie de Excel */
    function parseDate(t) {
      let m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/), y, mo, d;
      if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; if (mo > 12 && d <= 12) [d, mo] = [mo, d]; }
      else if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
      else return null;
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCMonth() !== mo - 1) return null;
      return { v: (dt - EPOCH) / 864e5, z: m[0].includes('-') && m[1].length === 4 ? 'yyyy-mm-dd' : 'dd/mm/yyyy' };
    }

    function parseInput(txt) {
      const t = txt.trim();
      if (t === '') return null;
      if (t.startsWith('=') && t.length > 1) return { f: toEnglish(t.slice(1)) };
      if (/^[-+]?[\d.,]+\s*%$/.test(t)) { const n = parseNumber(t.replace('%', '')); if (n !== null) return { t: 'n', v: n / 100, z: '0%' }; }
      const date = parseDate(t);
      if (date) return { t: 'n', v: date.v, z: date.z, isDate: true };
      const n = parseNumber(t);
      if (n !== null) return { t: 'n', v: n, money: /[\$€£¥]|COP|USD|EUR/i.test(t) };
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
        // conservar el formato de la celda (fecha, moneda, porcentaje); si no tenía, usar uno adecuado
        if (cell.t === 'n' && !cell.z && prev && prev.z && prev.z !== 'General') cell.z = prev.z;
        if (cell.isDate && prev && prev.z && XLSX.SSF.is_date(prev.z)) cell.z = prev.z;
        if (cell.money && !cell.z) cell.z = '"$"#,##0.00';
        delete cell.isDate; delete cell.money;
        if (prev && prev.s) cell.s = prev.s;
        if (cell.f) setResult(cell, () => evaluate(cell.f, env()));
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

    /* Códigos de error de SheetJS <-> códigos internos */
    const ERR_CODE = { DIV0: 0x07, VALUE: 0x0F, REF: 0x17, NAME: 0x1D, NUM: 0x24, NA: 0x2A };
    const CODE_ERR = Object.fromEntries(Object.entries(ERR_CODE).map(([k, v]) => [v, k]));
    function env() {
      const cur = wb.SheetNames[sheetIdx];
      const sheetOf = n => { const name = n == null ? env.cur : wb.SheetNames.find(x => x.toLowerCase() === n.toLowerCase()); const sh = name && wb.Sheets[name]; if (!sh) err('REF'); return sh; };
      env.cur = cur;
      return {
        get(n, r, c) {
          const x = sheetOf(n)[addr(r, c)];
          if (!x || x.v == null || x.t === 'z') return '';
          if (x.t === 'e') err(CODE_ERR[x.v] || 'VALUE');
          if (x.t === 'd') return (x.v - EPOCH) / 864e5;
          return x.v;
        },
        bounds(n) { const ref = sheetOf(n)['!ref']; const rg = ref ? XLSX.utils.decode_range(ref) : { e: { r: 0, c: 0 } }; return { rows: rg.e.r + 1, cols: rg.e.c + 1 }; },
        at(name) { env.cur = name; return this; }
      };
    }
    const same = (a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
      if (typeof a === 'string' && typeof b === 'string') return a === b;
      return a === b;
    };
    function setResult(cell, run) {
      try {
        const v = run();
        cell.v = v === '' ? '' : v;
        cell.t = typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : 's';
        delete cell.w;
      } catch (e) {
        if (!(e instanceof FErr)) throw e;
        cell.t = 'e'; cell.v = ERR_CODE[e.code] ?? ERR_CODE.VALUE; cell.w = ERR_TEXT[e.code] || '#¡VALOR!';
      }
    }

    /**
     * Al abrir: compara el evaluador con los valores que guardó Excel.
     * Las fórmulas que no sabemos reproducir se marcan _keep y no se tocan
     * (Excel/LibreOffice las recalculan al abrir el archivo guardado).
     */
    function calibrate() {
      const E = env();
      for (const name of wb.SheetNames) {
        const s = wb.Sheets[name];
        E.at(name);
        for (const k of Object.keys(s)) {
          if (k[0] === '!') continue;
          const cell = s[k];
          if (!cell.f) continue;
          if (cell.F) { cell._keep = true; continue; }        // fórmulas matriciales
          let got, gotErr = null;
          try { got = evaluate(cell.f, E); } catch (e) { if (!(e instanceof FErr)) throw e; gotErr = e.code; }
          if (cell.v === undefined || cell.t === 'z') {         // sin valor guardado: calcular
            if (gotErr === 'NAME') cell._keep = true; else setResult(cell, () => { if (gotErr) err(gotErr); return got; });
            continue;
          }
          const ok = cell.t === 'e' ? gotErr && ERR_CODE[gotErr] === cell.v
            : !gotErr && (same(got, cell.v) || (cell.t === 'd' && same(got, (cell.v - EPOCH) / 864e5)) || (got === '' && cell.v === 0));
          if (!ok) cell._keep = true;
        }
      }
    }

    /** Recalcula las fórmulas de todas las hojas hasta estabilizar */
    function recalc() {
      const E = env();
      for (let pass = 0; pass < 8; pass++) {
        let changed = false;
        for (const name of wb.SheetNames) {
          const s = wb.Sheets[name];
          E.at(name);
          for (const k of Object.keys(s)) {
            if (k[0] === '!') continue;
            const cell = s[k];
            if (!cell.f || cell._keep) continue;
            const before = cell.t + ':' + cell.v;
            setResult(cell, () => evaluate(cell.f, E));
            if (before !== cell.t + ':' + cell.v) changed = true;
          }
        }
        if (!changed) break;
      }
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
        UI.tbBtn('minus', 'Alejar', () => setZoom(zoom / 1.2)),
        UI.tbBtn('plus', 'Acercar', () => setZoom(zoom * 1.2))
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
      refBox.setAttribute('role', 'button');
      refBox.title = 'Ir a celda';
      refBox.addEventListener('click', async () => {
        const v = await prompt('Ir a celda', addr(sel.r, sel.c), { label: 'Ejemplo: B20 o Hoja2!A1' });
        if (!v) return;
        let [sh, ref] = v.includes('!') ? v.split('!') : [null, v];
        if (sh) { const i = wb.SheetNames.findIndex(n => n.toLowerCase() === sh.replace(/'/g, '').toLowerCase()); if (i < 0) return toast('No existe esa hoja'); if (i !== sheetIdx) switchSheet(i); }
        if (!/^[A-Za-z]{1,3}\d+$/.test(ref.trim())) return toast('Escribe una celda como B20');
        const a = XLSX.utils.decode_cell(ref.trim().toUpperCase());
        if (a.r >= dims().rows) { ws()._extraRows = a.r + 20; render(); }
        if (a.c >= dims().cols) { ws()._extraCols = a.c + 5; render(); }
        select(a.r, a.c);
      });
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
      grid.addEventListener('scroll', () => { cancelAnimationFrame(scrollRaf); scrollRaf = requestAnimationFrame(() => renderRows(false)); }, { passive: true });
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
      calibrate();
      api.ext = ['csv', 'prn'].includes(srcExt) ? 'csv' : ['tsv', 'tab'].includes(srcExt) ? 'tsv' : ['ods', 'fods', 'ots'].includes(srcExt) ? 'ods' : 'xlsx';
      if (api.ext === 'tsv') api.formats = [{ label: 'Texto separado por tabulaciones (.tsv)', value: 'tsv' }, ...api.formats];
      buildToolbar();
      buildUI();
      render();
    }

    async function save(fmt) {
      commit();
      const type = fmt || api.ext;
      if (type === 'tsv') return new Blob([XLSX.utils.sheet_to_csv(ws(), { FS: '\t' })], { type: 'text/tab-separated-values;charset=utf-8' });
      if (type === 'csv') {
        const csv = XLSX.utils.sheet_to_csv(ws());
        return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      }
      for (const n of wb.SheetNames) { delete wb.Sheets[n]._extraRows; delete wb.Sheets[n]._extraCols; }
      let out = XLSX.write(wb, { bookType: type, type: 'array', compression: true });
      if (type === 'xlsx') {
        // Pide a Excel/LibreOffice que recalculen todo al abrir (por si alguna fórmula no se pudo calcular aquí)
        const zip = await JSZip.loadAsync(out);
        const x = await zip.file('xl/workbook.xml').async('string');
        if (!/<calcPr/.test(x)) zip.file('xl/workbook.xml', x.replace('</workbook>', '<calcPr calcId="0" fullCalcOnLoad="1"/></workbook>'));
        // SheetJS añade un atributo "level" no válido en <col> (al venir de .xls): se quita
        for (const f of Object.keys(zip.files).filter(n => /^xl\/worksheets\/[^/]+\.xml$/.test(n))) {
          const t = await zip.file(f).async('string');
          if (/<col\b[^>]* level="/.test(t)) zip.file(f, t.replace(/(<col\b[^>]*?) level="\d+"/g, '$1'));
        }
        out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
      }
      return new Blob([out], { type: type === 'ods' ? 'application/vnd.oasis.opendocument.spreadsheet' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    /** Imprime la hoja actual (solo el rango con datos) */
    async function printable() {
      commit();
      const s = ws(), ref = s['!ref'];
      const rg = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
      rg.e.r = Math.min(rg.e.r, rg.s.r + 5000);
      const merges = (s['!merges'] || []);
      const covered = new Set();
      merges.forEach(m => { for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(r + ':' + c); });
      const esc = t => String(t).replace(/[&<>]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x]));
      let h = `<h1>${esc(wb.SheetNames[sheetIdx])}</h1><table><tbody>`;
      for (let r = rg.s.r; r <= rg.e.r; r++) {
        h += '<tr>';
        for (let c = rg.s.c; c <= rg.e.c; c++) {
          if (covered.has(r + ':' + c)) continue;
          const cell = s[addr(r, c)], m = merges.find(x => x.s.r === r && x.s.c === c);
          const span = m ? ` colspan="${m.e.c - m.s.c + 1}" rowspan="${m.e.r - m.s.r + 1}"` : '';
          h += `<td${span}${cell && cell.t === 'n' ? ' class="num"' : ''}>${esc(cellText(cell))}</td>`;
        }
        h += '</tr>';
      }
      const wide = rg.e.c - rg.s.c > 5;
      return { node: el('div', { class: 'print-xls', html: h + '</tbody></table>' }), page: `@page { size: ${wide ? 'letter landscape' : 'letter'}; margin: 1.2cm; }` };
    }

    const api = {
      zoom: { get: () => zoom, set: z => setZoom(z), min: 0.5, max: 2.5, target: () => table, scroller: () => grid, cssZoom: true },
      printable,
      open, save, destroy() { ctx.workspace.style.overflow = ''; }, ext: 'xlsx', kind: 'excel',
      formats: [{ label: 'Excel (.xlsx)', value: 'xlsx' }, { label: 'CSV de la hoja actual (.csv)', value: 'csv' }, { label: 'OpenDocument (.ods)', value: 'ods' }]
    };
    return api;
  }
  return { create, evaluate, toEnglish };
})();
