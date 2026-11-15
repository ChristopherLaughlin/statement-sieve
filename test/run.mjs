import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPages, parseStatement, toCSV } from '../site/parser.js';
import { ROWS } from './data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;

async function check(file, { hasBalance = true, expect = ROWS } = {}) {
  const data = new Uint8Array(fs.readFileSync(path.join(here, 'samples', file)));
  const pdf = await getDocument({ data, verbosity: 0 }).promise;
  const { transactions } = parseStatement(await extractPages(pdf), { dateOrder: 'auto', fallbackOrder: 'dmy' });
  const problems = [];
  if (transactions.length !== expect.length) problems.push(`row count ${transactions.length}, expected ${expect.length}`);
  expect.forEach((want, i) => {
    const got = transactions[i];
    if (!got) return;
    for (const k of ['date', 'description', 'amount', ...(hasBalance ? ['balance'] : [])])
      if (got[k] !== want[k]) problems.push(`row ${i + 1} ${k}: got ${JSON.stringify(got[k])}, expected ${JSON.stringify(want[k])}`);
  });
  if (problems.length) {
    failed++;
    console.log(`FAIL ${file}\n  ` + problems.slice(0, 12).join('\n  '));
  } else console.log(`ok   ${file} (${transactions.length} rows)`);
  return transactions;
}

await check('sample-a-us-signed.pdf');
const wrapped = ROWS.map((r) => (r.description === 'RENT STANDING ORDER' ? { ...r, description: 'RENT STANDING ORDER REF 00123456' } : r));
await check('sample-b-uk-columns.pdf', { expect: wrapped });
const c = await check('sample-c-headerless.pdf');

const csv = toCSV([{ date: '2026-01-01', description: '=HYPERLINK("x"), "quoted"', amount: -1.5, balance: null }, ...c.slice(0, 1)]);
const wantCsv = 'Date,Description,Amount,Balance\r\n2026-01-01,"\'=HYPERLINK(""x""), ""quoted""",-1.50,\r\n2026-01-02,TESCO STORES 3412 LONDON,-45.20,2454.80\r\n';
if (csv !== wantCsv) {
  failed++;
  console.log('FAIL csv\n' + csv);
} else console.log('ok   csv escaping');

process.exit(failed ? 1 : 0);
