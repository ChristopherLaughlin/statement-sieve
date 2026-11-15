// Generates fictional statement PDFs in three layouts for tests and for the site's "try a sample" button.
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPENING, ROWS } from './data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'samples');
fs.mkdirSync(out, { recursive: true });

const money = (n) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (iso) => iso.split('-');

function make(name, draw) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(path.join(out, name));
    doc.pipe(stream);
    draw(doc);
    doc.end();
    stream.on('finish', resolve);
  });
}
const right = (doc, s, xr, y) => doc.text(s, xr - 90, y, { width: 90, align: 'right', lineBreak: false });

// A: US style. MM/DD/YYYY, one signed Amount column, Balance, header row.
const a = make('sample-a-us-signed.pdf', (doc) => {
  doc.fontSize(16).text('Example Bank', 50, 50).fontSize(9);
  doc.text('Statement period 01/01/2026 - 01/31/2026   Account ending 4821', 50, 75);
  doc.text('Fictional sample statement for demonstration.', 50, 88);
  let y = 120;
  doc.font('Helvetica-Bold');
  doc.text('Date', 50, y, { lineBreak: false }).text('Description', 130, y, { lineBreak: false });
  right(doc, 'Amount', 440, y);
  right(doc, 'Balance', 540, y);
  doc.font('Helvetica');
  y += 18;
  doc.text('Beginning balance', 130, y, { lineBreak: false });
  right(doc, '$' + money(OPENING), 540, y);
  for (const r of ROWS) {
    y += 16;
    const [yy, mm, dd] = parts(r.date);
    doc.text(`${mm}/${dd}/${yy}`, 50, y, { lineBreak: false }).text(r.description, 130, y, { lineBreak: false });
    right(doc, (r.amount < 0 ? '-$' : '$') + money(r.amount), 440, y);
    right(doc, '$' + money(r.balance), 540, y);
  }
  y += 30;
  doc.text('Total deposits 3,661.11   Total withdrawals 2,770.31', 50, y, { lineBreak: false });
});

// B: UK style. "02 Jan 2026", Paid out / Paid in / Balance columns, one wrapped description.
const b = make('sample-b-uk-columns.pdf', (doc) => {
  doc.fontSize(16).text('Sample Building Society', 50, 50).fontSize(9);
  doc.text('Statement date 31 January 2026', 50, 75);
  let y = 110;
  doc.font('Helvetica-Bold');
  doc.text('Date', 50, y, { lineBreak: false }).text('Details', 120, y, { lineBreak: false });
  right(doc, 'Paid out', 380, y);
  right(doc, 'Paid in', 460, y);
  right(doc, 'Balance', 545, y);
  doc.font('Helvetica');
  y += 18;
  doc.text('Balance brought forward', 120, y, { lineBreak: false });
  right(doc, money(OPENING), 545, y);
  for (const r of ROWS) {
    y += 16;
    const [yy, mm, dd] = parts(r.date);
    doc.text(`${dd} ${MONTHS[+mm - 1]} ${yy}`, 50, y, { lineBreak: false }).text(r.description, 120, y, { lineBreak: false });
    right(doc, money(r.amount), r.amount < 0 ? 380 : 460, y);
    right(doc, money(r.balance), 545, y);
    if (r.description === 'RENT STANDING ORDER') {
      y += 11;
      doc.text('REF 00123456', 120, y, { lineBreak: false });
    }
  }
});

// C: no header row, DD/MM/YYYY, negatives in parentheses, each line a single text run (monospace).
const c = make('sample-c-headerless.pdf', (doc) => {
  doc.font('Courier').fontSize(8);
  doc.text('ACCOUNT ACTIVITY JANUARY 2026', 40, 50, { lineBreak: false });
  let y = 80;
  for (const r of ROWS) {
    const [yy, mm, dd] = parts(r.date);
    const amt = r.amount < 0 ? `(${money(r.amount)})` : money(r.amount) + ' ';
    const line = `${dd}/${mm}/${yy}  ${r.description.padEnd(40)}${amt.padStart(14)}${money(r.balance).padStart(14)}`;
    doc.text(line, 40, y, { lineBreak: false });
    y += 12;
  }
  doc.text('Page 1 of 1', 40, y + 30, { lineBreak: false });
});

await Promise.all([a, b, c]);
console.log('samples written to', out);
