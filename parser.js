// Statement Sieve parser: turns positioned PDF text into transactions.
// Pure functions, no DOM, so the same file runs in the browser and in Node tests.

const MON =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MONTH_NUM = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const DATE_RES = [
  { kind: 'ymd', re: /^(\d{4})-(\d{2})-(\d{2})(?!\d)/ },
  { kind: 'num3', re: /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})(?!\d)/ },
  { kind: 'dMy', re: new RegExp(`^(\\d{1,2})[ \\-](${MON})\\.?,?[ \\-](\\d{4}|\\d{2})(?!\\d)`, 'i') },
  { kind: 'Mdy', re: new RegExp(`^(${MON})\\.? (\\d{1,2}),? (\\d{4})(?!\\d)`, 'i') },
  { kind: 'dM', re: new RegExp(`^(\\d{1,2})[ \\-](${MON})(?![a-z])\\.?`, 'i') },
  { kind: 'Md', re: new RegExp(`^(${MON})\\.? (\\d{1,2})(?![\\d.,/])`, 'i') },
  { kind: 'num2', re: /^(\d{1,2})\/(\d{1,2})(?![\d\/.,])/ },
];

const AMOUNT_EN = /^([-+(]?)[$£€]?([-+]?)((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})(\)?)(-|CR|DR)?$/i;
const AMOUNT_EU = /^([-+(]?)[$£€]?([-+]?)((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})(\)?)(-|CR|DR)?$/i;
const SKIP_ROW =
  /\b(opening|closing|beginning|ending|previous|starting|new) balance\b|balance (brought|carried) forward|^(sub)?totals?\b/i;

function parseAmount(s) {
  let m = AMOUNT_EN.exec(s);
  let num;
  if (m) num = parseFloat(m[3].replace(/,/g, ''));
  else {
    m = AMOUNT_EU.exec(s);
    if (!m) return null;
    num = parseFloat(m[3].replace(/\./g, '').replace(',', '.'));
  }
  const tail = (m[5] || '').toUpperCase();
  const neg = m[1] === '-' || m[1] === '(' || m[2] === '-' || tail === '-' || tail === 'DR';
  const pos = m[1] === '+' || m[2] === '+' || tail === 'CR';
  return { value: neg ? -num : num, signed: neg || pos };
}

function matchDate(text) {
  for (const { kind, re } of DATE_RES) {
    const m = re.exec(text);
    if (m) return { kind, m, len: m[0].length };
  }
  return null;
}

// Split each PDF text run into words with estimated x positions, then group into lines.
function toLines(pages) {
  const lines = [];
  pages.forEach((items, page) => {
    const words = [];
    for (const it of items) {
      const str = it.str;
      if (!str || !str.trim()) continue;
      const per = str.length ? it.w / str.length : 0;
      const re = /\S+/g;
      let m;
      while ((m = re.exec(str))) {
        words.push({ s: m[0], l: it.x + per * m.index, r: it.x + per * (m.index + m[0].length), y: it.y, h: it.h || 10 });
      }
    }
    words.sort((a, b) => b.y - a.y || a.l - b.l);
    let cur = null;
    for (const w of words) {
      if (cur && Math.abs(cur.y - w.y) <= Math.min(3, w.h * 0.4)) cur.tokens.push(w);
      else lines.push((cur = { page, y: w.y, h: w.h, tokens: [w] }));
    }
  });
  for (const ln of lines) ln.tokens.sort((a, b) => a.l - b.l);
  return lines;
}

function headerColumns(line) {
  const cols = [];
  const t = line.tokens;
  let sawDate = false;
  for (let i = 0; i < t.length; i++) {
    const w = t[i].s.toLowerCase().replace(/[^a-z]/g, '');
    const prev = i > 0 ? t[i - 1].s.toLowerCase().replace(/[^a-z]/g, '') : '';
    let kind = null;
    let l = t[i].l;
    if (w === 'date') sawDate = true;
    if (/^(debits?|withdrawals?|withdrawn)$/.test(w)) kind = 'debit';
    else if (/^(credits?|deposits?|receipts)$/.test(w)) kind = 'credit';
    else if (w === 'balance') kind = 'balance';
    else if (w === 'amount') kind = 'amount';
    else if ((w === 'out' || w === 'in') && /^(paid|money|payments)$/.test(prev)) {
      kind = w === 'out' ? 'debit' : 'credit';
      l = t[i - 1].l;
    }
    if (kind && !cols.some((c) => c.kind === kind)) cols.push({ kind, l, r: t[i].r, c: (l + t[i].r) / 2 });
  }
  if (cols.length >= 2 || (cols.length === 1 && sawDate)) return cols;
  return null;
}

function clusterColumns(rows) {
  const clusters = [];
  for (const row of rows)
    for (const a of row.amounts) {
      const c = clusters.find((k) => Math.abs(k.r - a.r) <= 6);
      if (c) {
        c.r = (c.r * c.n + a.r) / (c.n + 1);
        c.n++;
      } else clusters.push({ r: a.r, n: 1 });
    }
  const min = Math.max(1, Math.ceil(rows.length * 0.1));
  const kept = clusters.filter((c) => c.n >= min).sort((a, b) => a.r - b.r).slice(-3);
  let kinds;
  if (kept.length === 3) kinds = ['debit', 'credit', 'balance'];
  else if (kept.length === 2) {
    const both = rows.filter((row) => kept.every((k) => row.amounts.some((a) => Math.abs(a.r - k.r) <= 8))).length;
    kinds = both > rows.length / 2 ? ['amount', 'balance'] : ['debit', 'credit'];
  } else kinds = ['amount'];
  return kept.map((k, i) => ({ kind: kinds[i], l: k.r, r: k.r, c: k.r, exact: true }));
}

function assign(amount, cols) {
  let best = null;
  let bestD = Infinity;
  for (const c of cols) {
    const d = c.exact
      ? Math.abs(amount.r - c.r)
      : Math.min(Math.abs(amount.l - c.l), Math.abs(amount.r - c.r), Math.abs((amount.l + amount.r) / 2 - c.c));
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best && bestD <= (best.exact ? 8 : 45) ? best.kind : null;
}

const pad = (n) => String(n).padStart(2, '0');

function resolveDates(rows, allText, dateOrder, fallbackOrder) {
  let order = dateOrder;
  if (order !== 'dmy' && order !== 'mdy') {
    const nums = rows.filter((r) => r.date.kind === 'num3' || r.date.kind === 'num2').map((r) => r.date.m);
    if (nums.some((m) => +m[1] > 12)) order = 'dmy';
    else if (nums.some((m) => +m[2] > 12)) order = 'mdy';
    else order = fallbackOrder === 'mdy' ? 'mdy' : 'dmy';
  }
  const counts = {};
  for (const y of allText.match(/\b20\d{2}\b/g) || []) counts[y] = (counts[y] || 0) + 1;
  const docYear = +(Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || new Date().getFullYear());
  const yr = (s) => (s === undefined ? docYear : s.length === 2 ? 2000 + +s : +s);
  const mon = (s) => MONTH_NUM[s.slice(0, 3).toLowerCase()];
  for (const row of rows) {
    const { kind, m } = row.date;
    let y, mo, d;
    if (kind === 'ymd') [y, mo, d] = [+m[1], +m[2], +m[3]];
    else if (kind === 'num3' || kind === 'num2') {
      y = yr(m[3]);
      [d, mo] = order === 'dmy' ? [+m[1], +m[2]] : [+m[2], +m[1]];
    } else if (kind === 'dMy' || kind === 'dM') [y, mo, d] = [yr(m[3]), mon(m[2]), +m[1]];
    else [y, mo, d] = [yr(m[3]), mon(m[1]), +m[2]];
    row.iso = mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(mo)}-${pad(d)}` : m[0];
  }
  return order;
}

/**
 * @param pages  Array (one per page) of text runs: { str, x, y, w, h } in PDF points.
 * @param opts   { dateOrder: 'auto'|'dmy'|'mdy', fallbackOrder: 'dmy'|'mdy' }
 */
export function parseStatement(pages, opts = {}) {
  const lines = toLines(pages);
  const allText = lines.map((l) => l.tokens.map((t) => t.s).join(' ')).join('\n');
  let headerCols = null;
  let prevRow = null;
  let prevLine = null;
  const rows = [];

  for (const line of lines) {
    const text = line.tokens.map((t) => t.s).join(' ');
    const amountsInLine = line.tokens.some((t) => parseAmount(t.s));
    let date = matchDate(text);

    if (!date) {
      const hc = !amountsInLine && headerColumns(line);
      if (hc) {
        headerCols = hc;
        prevRow = null;
      } else if (
        prevRow && !amountsInLine && prevRow.extra < 2 && line.page === prevLine.page &&
        prevLine.y - line.y <= prevLine.h * 1.7 && line.tokens[0].l >= prevRow.descX - 3
      ) {
        prevRow.desc.push(text);
        prevRow.extra++;
        prevLine = line;
        continue;
      } else if (amountsInLine && SKIP_ROW.test(text)) {
        rows.push({ marker: true, tokens: line.tokens, cols: headerCols, amounts: collectAmounts(line.tokens) });
      }
      prevRow = null;
      continue;
    }

    // Consume the date tokens (and a second "posting date" if one follows).
    let rest = line.tokens.slice();
    const consume = (len) => {
      let used = 0;
      while (rest.length && used < len) used += rest.shift().s.length + 1;
    };
    consume(date.len);
    const second = matchDate(rest.map((t) => t.s).join(' '));
    if (second) consume(second.len);

    const amounts = collectAmounts(rest);
    if (!amounts.length) {
      prevRow = null;
      continue;
    }
    const row = { date, tokens: rest, amounts, cols: headerCols, desc: [], extra: 0, descX: rest[0] ? rest[0].l : 0 };
    if (SKIP_ROW.test(rest.map((t) => t.s).join(' '))) row.marker = true;
    rows.push(row);
    prevRow = row.marker ? null : row;
    prevLine = line;
  }

  const txRows = rows.filter((r) => !r.marker);
  const fallbackCols = clusterColumns(txRows);
  const order = resolveDates(txRows, allText, opts.dateOrder, opts.fallbackOrder);

  const transactions = [];
  let lastBalance = null;
  for (const row of rows) {
    const cols = row.cols || fallbackCols;
    const got = {};
    const used = new Set();
    for (const a of row.amounts) {
      const kind = assign(a, cols);
      if (kind && !(kind in got)) {
        got[kind] = a;
        a.idx.forEach((i) => used.add(i));
      }
    }
    if (row.marker) {
      const b = got.balance || row.amounts[row.amounts.length - 1];
      if (b) lastBalance = b.value;
      continue;
    }
    let amount = null;
    if (got.debit) amount = -Math.abs(got.debit.value);
    else if (got.credit) amount = Math.abs(got.credit.value);
    else if (got.amount) {
      amount = got.amount.value;
      if (!got.amount.signed && got.balance && lastBalance !== null) {
        const delta = got.balance.value - lastBalance;
        if (Math.abs(Math.abs(delta) - Math.abs(amount)) < 0.006 && delta < 0) amount = -Math.abs(amount);
      }
    }
    if (amount === null) continue;
    const balance = got.balance ? got.balance.value : null;
    if (balance !== null) lastBalance = balance;
    const first = row.tokens.filter((t, i) => !used.has(i) && !/^[$£€]$/.test(t.s)).map((t) => t.s).join(' ');
    const description = [first, ...row.desc].join(' ').replace(/\s+/g, ' ').trim();
    transactions.push({ date: row.iso, description, amount: round2(amount), balance: balance === null ? null : round2(balance) });
  }

  return { transactions, dateOrder: order, hasText: lines.length > 0, pages: pages.length };
}

const round2 = (n) => Math.round(n * 100) / 100;

function collectAmounts(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (next && /^(CR|DR)$/i.test(next.s)) {
      const p = parseAmount(t.s + next.s);
      if (p) {
        out.push({ ...p, l: t.l, r: t.r, idx: [i, i + 1] });
        i++;
        continue;
      }
    }
    const p = parseAmount(t.s);
    if (p) out.push({ ...p, l: t.l, r: t.r, idx: [i] });
    else if (/^[$£€]$/.test(t.s)) out.push({ skip: true, idx: [i] });
  }
  // Lone currency symbols are dropped from the description but are not amounts.
  const real = out.filter((a) => !a.skip);
  real.symbolIdx = out.filter((a) => a.skip).flatMap((a) => a.idx);
  return real;
}

/** Pull positioned text out of a pdf.js document. */
export async function extractPages(pdf) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .filter((it) => typeof it.str === 'string')
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) }))
    );
  }
  return pages;
}

export function toCSV(transactions) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && isNaN(Number(s)))) s = "'" + s; // block spreadsheet formula injection
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = [['Date', 'Description', 'Amount', 'Balance']];
  for (const t of transactions) rows.push([t.date, t.description, t.amount.toFixed(2), t.balance === null ? '' : t.balance.toFixed(2)]);
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}
