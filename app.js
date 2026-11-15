import * as pdfjs from './vendor/pdf.min.mjs';
import { extractPages, parseStatement, toCSV } from './parser.js';
import { CONFIG } from './config.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;

const $ = (id) => document.getElementById(id);
const KEY_STORE = 'statement-sieve-key';
const state = { docs: [], transactions: [], unlocked: false };

const store = {
  get() { try { return localStorage.getItem(KEY_STORE); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY_STORE, v); } catch { /* private mode: unlock lasts for this tab */ } },
};

async function keyIsValid(key) {
  if (!key || !globalThis.crypto?.subtle) return false;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key.trim().toUpperCase()));
  const hex = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === CONFIG.unlockHash;
}

async function tryUnlock(key, { remember = true } = {}) {
  if (!(await keyIsValid(key))) return false;
  state.unlocked = true;
  if (remember) store.set(key.trim().toUpperCase());
  const btn = $('haveKey');
  btn.outerHTML = '<span class="unlocked-badge">Unlocked</span>';
  render();
  return true;
}

function setStatus(msg, isError = false) {
  $('status').textContent = msg;
  $('status').classList.toggle('error', isError);
}

const fmt = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function handleFiles(files) {
  const pdfs = [...files].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!pdfs.length) return setStatus('Those are not PDF files. Choose a statement saved as PDF.', true);
  setStatus(`Reading ${pdfs.length} file${pdfs.length > 1 ? 's' : ''} on your device…`);
  state.docs = [];
  const problems = [];
  for (const f of pdfs) {
    try {
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
      state.docs.push({ name: f.name, pages: await extractPages(pdf) });
    } catch (err) {
      problems.push(err?.name === 'PasswordException'
        ? `${f.name} is password-protected. Save an unprotected copy first.`
        : `${f.name} could not be read as a PDF.`);
    }
  }
  reparse(problems);
}

function reparse(problems = []) {
  const fallbackOrder = /^en-US|^en-CA|^fil/i.test(navigator.language || '') ? 'mdy' : 'dmy';
  const all = [];
  for (const d of state.docs) {
    const res = parseStatement(d.pages, { dateOrder: $('dateOrder').value, fallbackOrder });
    if (!res.hasText) problems.push(`${d.name} looks like a scan (no text inside), so it cannot be converted.`);
    else if (!res.transactions.length) problems.push(`No transactions found in ${d.name}.`);
    all.push(...res.transactions);
  }
  if (state.docs.length > 1) all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  state.transactions = all;
  setStatus(problems.join(' '), problems.length > 0);
  if (!problems.length && all.length) setStatus('Done. Nothing left your device.');
  render();
}

function cell(text, cls) {
  const td = document.createElement('td');
  td.textContent = text;
  if (cls) td.className = cls;
  return td;
}

function render() {
  const tx = state.transactions;
  $('results').hidden = tx.length === 0;
  if (!tx.length) return;
  const visible = state.unlocked ? tx : tx.slice(0, CONFIG.freeRows);
  const locked = tx.length - visible.length;

  const body = $('rows');
  body.replaceChildren();
  for (const t of visible) {
    const tr = document.createElement('tr');
    tr.append(cell(t.date), cell(t.description), cell(fmt(t.amount), 'num ' + (t.amount < 0 ? 'neg' : 'pos')),
      cell(t.balance === null ? '' : fmt(t.balance), 'num'));
    body.append(tr);
  }
  // Locked rows are placeholders: the real values are not put in the page.
  for (let i = 0; i < Math.min(locked, 4); i++) {
    const tr = document.createElement('tr');
    tr.className = 'locked';
    tr.setAttribute('aria-hidden', 'true');
    tr.append(cell('0000-00-00'), cell('XXXXXXXX XXXXXX XXXXXXXXX'), cell('000.00', 'num'), cell('0,000.00', 'num'));
    body.append(tr);
  }

  const out = tx.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const inn = tx.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  $('summary').textContent = `${tx.length} transaction${tx.length === 1 ? '' : 's'} found`;
  $('totals').textContent = `${tx[0].date} to ${tx[tx.length - 1].date} · in ${fmt(inn)} · out ${fmt(Math.abs(out))}`;
  $('paywall').hidden = locked <= 0;
  $('lockedCount').textContent = `${locked} more row${locked === 1 ? '' : 's'} ready to export`;
  $('download').textContent = locked > 0 ? `Download first ${visible.length} rows` : 'Download CSV';
}

function exportRows() {
  return state.unlocked ? state.transactions : state.transactions.slice(0, CONFIG.freeRows);
}

function download() {
  const blob = new Blob(['﻿' + toCSV(exportRows())], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const base = state.docs.length === 1 ? state.docs[0].name.replace(/\.pdf$/i, '') : 'statements';
  a.download = `${base}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function copy() {
  const tsv = [['Date', 'Description', 'Amount', 'Balance'],
    ...exportRows().map((t) => [t.date, t.description.replace(/[\t\n]/g, ' '), t.amount.toFixed(2), t.balance === null ? '' : t.balance.toFixed(2)])]
    .map((r) => r.join('\t')).join('\n');
  try {
    await navigator.clipboard.writeText(tsv);
    $('copy').textContent = 'Copied';
  } catch {
    $('copy').textContent = 'Copy blocked by browser';
  }
  setTimeout(() => ($('copy').textContent = 'Copy for Sheets'), 1800);
}

function wire() {
  const drop = $('drop');
  const input = $('file');
  drop.addEventListener('click', (e) => { if (e.target.id !== 'trySample') input.click(); });
  drop.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === drop) { e.preventDefault(); input.click(); }
  });
  input.addEventListener('change', () => { if (input.files.length) handleFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
  // Dropping a PDF outside the box should not navigate away from the page.
  ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));

  $('trySample').addEventListener('click', async () => {
    const res = await fetch('./sample-statement.pdf');
    handleFiles([new File([await res.blob()], 'sample-statement.pdf', { type: 'application/pdf' })]);
  });
  $('dateOrder').addEventListener('change', () => reparse());
  $('download').addEventListener('click', download);
  $('copy').addEventListener('click', copy);

  const dialog = $('keyDialog');
  $('haveKey').addEventListener('click', () => { $('keyMsg').textContent = ''; dialog.showModal(); });
  $('keyCancel').addEventListener('click', () => dialog.close());
  $('keyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await tryUnlock($('keyInput').value)) dialog.close();
    else $('keyMsg').textContent = 'That key was not recognised. Check for typos and try again.';
  });

  document.querySelectorAll('.price').forEach((el) => (el.textContent = CONFIG.price));
  document.querySelectorAll('.freeRows').forEach((el) => (el.textContent = CONFIG.freeRows));
  const buy = $('buy');
  if (CONFIG.checkoutUrl) {
    buy.href = CONFIG.checkoutUrl;
  } else {
    buy.setAttribute('aria-disabled', 'true');
    buy.title = 'Checkout is not open yet';
  }
  if (CONFIG.supportEmail) {
    const a = document.createElement('a');
    a.href = `mailto:${CONFIG.supportEmail}`;
    a.textContent = CONFIG.supportEmail;
    $('supportLine').append(' Email ', a, '.');
  }
}

// After payment the checkout redirects back here with #key=...
async function unlockFromHash() {
  const m = /[#&]key=([^&]+)/.exec(location.hash);
  if (!m || state.unlocked) return false;
  const key = decodeURIComponent(m[1]);
  history.replaceState(null, '', location.pathname + location.search);
  if (!(await tryUnlock(key))) return false;
  setStatus(`Unlocked. Thank you! Save your key in case you switch browsers: ${key.toUpperCase()}`);
  return true;
}

async function init() {
  wire();
  window.addEventListener('hashchange', unlockFromHash);
  if (!(await unlockFromHash())) await tryUnlock(store.get(), { remember: false }); // saved key from an earlier visit
}

init();
