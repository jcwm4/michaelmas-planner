'use strict';

/* ================================================================
   Michaelmas Planner — timetable, supervisions, examples papers, tasks
   Data is saved to a private GitHub repo via the GitHub API (see README),
   or to data/planner.json via server.py when run locally without a key.
   ================================================================ */

const TYPES = { lecture: 'Lecture', lab: 'Lab', supervision: 'Supervision', examples: 'Examples class', other: 'Other', deadline: 'Deadline' };
const LAB_STATUS = { '': 'Not marked', done: 'Completed', followup: 'Needs write-up / follow-up' };
const STATUS = { todo: 'Not started', progress: 'In progress', done: 'Done', submitted: 'Handed in' };
const PRIORITY = { low: 'Low', med: 'Medium', high: 'High' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HOUR_PX = 72;
const LINE_PX = 13;              // line height of text inside timetable boxes
const DEFAULT_QUESTIONS = 10;

const DEFAULT_STATE = () => ({
  version: 1,
  settings: {
    termName: 'Michaelmas 2026',
    week1Start: '2026-10-08',   // Thursday of Week 1 (Cambridge weeks run Thu–Wed)
    numWeeks: 8,
    weekStartDay: 4,            // 4 = Thursday, 1 = Monday
    dayStart: 8,
    dayEnd: 20,
  },
  courses: [
    { id: 'mech', name: 'Mechanics', color: '#e4572e' },
    { id: 'struct', name: 'Structural Mechanics', color: '#2b59c3' },
    { id: 'mat', name: 'Materials', color: '#2e8b57' },
    { id: 'elec', name: 'Digital Circuits', color: '#c77c02' },
    { id: 'maths', name: 'Mathematical Methods', color: '#8e44ad' },
    { id: 'labs', name: 'Labs & Coursework', color: '#16a2b8' },
    { id: 'other', name: 'Other', color: '#7f8c8d' },
  ],
  events: [],
  papers: [],
  tasks: [],
  labs: {},       // lab session key -> { status, notes }
  supNotes: {},   // supervision session key -> notes
});

let state;
const ui = { week: null, ttView: null, day: null, showPast: false, paperFilter: 'outstanding', paperCourse: '', showDoneTasks: false, labFilter: 'active' };
let modalRefresh = null;   // re-draws the open supervision/lab panel after a change

/* ---------------- helpers ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => parseISO(iso(new Date()));
const diffDays = (a, b) => Math.round((parseISO(iso(b)) - parseISO(iso(a))) / 864e5);
const toMin = t => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
const course = id => state.courses.find(c => c.id === id) || { id: '', name: '', color: '#8a93a6' };

function termWeek(d) {
  return Math.floor(diffDays(parseISO(state.settings.week1Start), d) / 7) + 1;
}
function weekLabel(n) {
  const ns = +state.settings.numWeeks;
  if (n < 1) return `Week ${n}`;
  if (n > ns) return `Week ${n} (after term)`;
  return `Week ${n}`;
}
function windowStart(n) {
  const base = addDays(parseISO(state.settings.week1Start), (n - 1) * 7);
  return addDays(base, -((base.getDay() - +state.settings.weekStartDay + 7) % 7));
}
function weekContaining(d) {
  const n = termWeek(d);
  for (const k of [n, n + 1, n - 1]) {
    const s = windowStart(k);
    if (d >= s && d < addDays(s, 7)) return k;
  }
  return n;
}
function parseWeeks(str) {
  if (!str || !String(str).trim()) return null;
  const set = new Set();
  for (const part of String(str).split(/[,\s]+/)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(i);
  }
  return set;
}

/** All event occurrences between two dates (inclusive), sorted. */
function occurrences(from, to) {
  const out = [];
  const ns = +state.settings.numWeeks;
  const weekSets = new Map(state.events.map(e => [e.id, parseWeeks(e.weeks)]));
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    const ds = iso(d), wd = d.getDay(), wk = termWeek(d);
    for (const e of state.events) {
      if (e.repeat === 'weekly') {
        if (+e.day !== wd) continue;
        const ws = weekSets.get(e.id);
        if (ws ? !ws.has(wk) : (wk < 1 || wk > ns)) continue;
      } else if (e.date !== ds) continue;
      out.push({ e, date: ds, d: new Date(d) });
    }
  }
  // tasks with a due date AND a time show on the calendar as deadlines
  const fromS = iso(from), toS = iso(to);
  for (const t of state.tasks) {
    if (!t.due || !t.time || t.due < fromS || t.due > toS) continue;
    const st = toMin(t.time), en = Math.min(st + 30, 24 * 60 - 1);
    out.push({
      e: { id: 'task-' + t.id, taskId: t.id, title: (t.done ? '✓ ' : '⏰ ') + t.title, type: 'deadline', courseId: t.courseId,
        start: t.time, end: `${pad(Math.floor(en / 60))}:${pad(en % 60)}`, location: '', who: t.link ? linkLabel(t, false) : '', done: !!t.done },
      date: t.due, d: parseISO(t.due),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || toMin(a.e.start) - toMin(b.e.start));
}

function dueParts(s) {
  if (!s) return null;
  const [ds, ts] = s.split('T');
  return { d: parseISO(ds), ds, ts: ts || '' };
}
function fmtDue(s) {
  const p = dueParts(s);
  if (!p) return '<span class="muted">—</span>';
  return `${fmtDate(p.d)}${p.ts ? ', ' + p.ts : ''}`;
}
function relDue(s, done) {
  const p = dueParts(s);
  if (!p) return '';
  const n = diffDays(today(), p.d);
  if (n < 0) return done ? '' : `<span class="overdue">${-n}d overdue</span>`;
  if (n === 0) return `<span class="${done ? 'muted' : 'overdue'}">today</span>`;
  if (n === 1) return '<span class="muted">tomorrow</span>';
  return `<span class="muted">in ${n} days</span>`;
}
const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999');

/* ---------------- persistence ---------------- */
function setStatus(text, warn = false) {
  const el = $('#saveStatus');
  el.textContent = text;
  el.classList.toggle('warn', warn);
}

/* Storage: your PRIVATE GitHub data repo (via the GitHub API, using an access key kept only on
   this device), or the local server.py when run on your Mac without a key. */
const GH_KEY = 'planner-github';          // { owner, repo, branch, path, token } — never leaves this device except to api.github.com
const CACHE_KEY = 'michaelmas-planner';   // offline copy on this device
const SHA_KEY = 'michaelmas-planner-sha';
let backend = 'setup';                    // 'github' | 'server' | 'setup'
let gh = null, ghSha = null, dirty = false, saving = false, conflict = false, setupError = '';

function ghCfg() { try { return JSON.parse(localStorage.getItem(GH_KEY) || 'null'); } catch { return null; } }
function cacheGet() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; } }
function cachePut() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); if (ghSha) localStorage.setItem(SHA_KEY, ghSha); } catch { /* storage full/blocked */ }
}
const b64encode = str => {
  const bytes = new TextEncoder().encode(str); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));
function ghError(status) {
  const e = new Error(status === 401 ? 'GitHub did not accept the access key (wrong or expired)'
    : status === 403 ? 'the access key is not allowed to use this repo'
    : status === 404 ? 'repo or file not found — check the names, and that the key has access to this repo'
    : `GitHub error ${status}`);
  e.status = status; return e;
}
async function ghFetch(cfg, url, opts = {}) {
  return fetch(url, { cache: 'no-store', ...opts, headers: {
    Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
    ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
}
const ghUrl = cfg => `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}`;
async function ghRead(cfg) {
  const r = await ghFetch(cfg, `${ghUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`);
  if (r.status === 404) {   // repo reachable but no file yet?
    const repo = await ghFetch(cfg, `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`);
    if (repo.ok) return { data: null, sha: null };
    throw ghError(repo.status);
  }
  if (!r.ok) throw ghError(r.status);
  const j = await r.json();
  let text = j.content ? b64decode(j.content) : '';
  if (!text && j.size > 0) {   // files over 1 MB come back without content: fetch the blob
    const b = await ghFetch(cfg, j.git_url);
    if (!b.ok) throw ghError(b.status);
    text = b64decode((await b.json()).content);
  }
  return { data: JSON.parse(text), sha: j.sha };
}
async function ghWrite(cfg, text, sha) {
  const r = await ghFetch(cfg, ghUrl(cfg), { method: 'PUT', body: JSON.stringify({
    message: `Planner update ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    content: b64encode(text), branch: cfg.branch, ...(sha ? { sha } : {}) }) });
  if (r.status === 409 || r.status === 422) { const e = new Error('changed on another device'); e.conflict = true; throw e; }
  if (!r.ok) throw ghError(r.status);
  return (await r.json()).content.sha;
}

async function load() {
  gh = ghCfg();
  if (gh && gh.token) {
    backend = 'github';
    try {
      const r = await ghRead(gh);
      ghSha = r.sha;
      if (r.data) { state = r.data; setStatus('Synced ✓'); }
      else { state = cacheGet() || DEFAULT_STATE(); dirty = true; setStatus('Creating your data file…'); }
    } catch (err) {
      if (err.status) { backend = 'setup'; setupError = err.message; state = cacheGet() || DEFAULT_STATE(); migrate(); return; }
      // offline: carry on with this device's copy; changes upload when you're back online
      state = cacheGet() || DEFAULT_STATE();
      ghSha = localStorage.getItem(SHA_KEY);
      setStatus('Offline — using the copy on this device', true);
    }
  } else {
    try {
      const r = await fetch('api/data', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      backend = 'server'; state = d && d.settings ? d : DEFAULT_STATE();
      setStatus('Saved on this Mac (local mode)');
    } catch {
      backend = 'setup'; state = cacheGet() || DEFAULT_STATE();
    }
  }
  if (!state || !state.settings) state = DEFAULT_STATE();
  migrate();
  cachePut();
  if (dirty) save();
}

/** Pull the latest copy when you come back to the app (e.g. after using it on your other device). */
async function syncFromRemote() {
  if (backend !== 'github' || dirty || saving || conflict) return;
  try {
    const r = await ghRead(gh);
    if (r.sha && r.sha !== ghSha && r.data) {
      state = r.data; ghSha = r.sha; migrate(); cachePut();
      if ($('#modal').hidden) render();
      setStatus('Updated from your other device ✓');
    }
  } catch { /* offline — try again later */ }
}

function migrate() {
  const d = DEFAULT_STATE();
  state.settings = { ...d.settings, ...state.settings };
  if (+state.settings.dayEnd === 19) state.settings.dayEnd = 20;   // old default cut off the 7pm slot
  for (const k of ['courses', 'events', 'papers', 'tasks']) if (!Array.isArray(state[k])) state[k] = d[k];
  for (const k of ['labs', 'supNotes']) if (!state[k] || typeof state[k] !== 'object' || Array.isArray(state[k])) state[k] = {};
  for (const p of state.papers) ensureQuestions(p);
  for (const e of state.events) {
    if (e.link) continue;
    const m = (e.notes || '').match(/(?:Info:\s*)?(https?:\/\/\S+)/);
    if (m) { e.link = m[1]; e.notes = e.notes.replace(m[0], '').trim(); }
  }
}
/** Safe external link (only http/https). */
const PAPERS_URL = 'https://www.vle.cam.ac.uk/course/view.php?id=94562';   // Moodle page with all examples papers
function extLink(url, text = 'Moodle ↗', cls = 'ext-link') {
  if (!/^https?:\/\//i.test(url || '')) return '';
  const label = /vle\.cam\.ac\.uk/i.test(url) ? text : text.replace('Moodle', 'Link');
  return `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(url)}">${esc(label)}</a>`;
}

/* ---------------- examples-paper questions ---------------- */
const blankQ = () => ({ done: false, flag: false, note: '' });
function ensureQuestions(p) {
  if (Array.isArray(p.questions)) return syncPaper(p);
  const n = +p.total > 0 ? +p.total : DEFAULT_QUESTIONS;
  const allDone = p.status === 'done' || p.status === 'submitted';
  const done = allDone ? n : Math.min(+p.done || 0, n);
  p.questions = Array.from({ length: n }, (_, i) => ({ ...blankQ(), done: i < done }));
  syncPaper(p);
}
/** Keep total/done (used by the lists) in step with the question list; optionally auto-update status. */
function syncPaper(p, autoStatus = false) {
  p.total = p.questions.length;
  p.done = p.questions.filter(q => q.done).length;
  if (autoStatus && p.status !== 'submitted') {
    p.status = p.done === 0 ? 'todo' : p.done >= p.total ? 'done' : 'progress';
  }
}
const flagged = p => (p.questions || []).map((q, i) => ({ ...q, n: i + 1 })).filter(q => q.flag);
function flagList(p, { withNotes = true } = {}) {
  const f = flagged(p);
  if (!f.length) return '';
  return `<div class="flag-list"><span class="flag-ico">⚑</span> <strong>${paperLabel(p)}:</strong> ${f.map(q =>
    `Q${q.n}${withNotes && q.note ? ` <span class="muted">(${esc(q.note)})</span>` : ''}`).join(', ')}</div>`;
}

let saveTimer;
function save() {
  cachePut();
  if (backend === 'setup') return;
  dirty = true;
  if (!conflict) setStatus('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, backend === 'github' ? 1500 : 300);   // batch quick clicks into one commit
}
async function flushSave() {
  clearTimeout(saveTimer);
  if (conflict || !dirty) return;
  if (saving) { saveTimer = setTimeout(flushSave, 600); return; }
  saving = true; dirty = false;
  let retry = 0;
  try {
    const text = JSON.stringify(state, null, 1);
    if (backend === 'github') ghSha = await ghWrite(gh, text, ghSha);
    else {
      const r = await fetch('api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text });
      if (!r.ok) throw new Error(`server error ${r.status}`);
    }
    cachePut();
    setStatus(dirty ? 'Saving…' : 'Saved ✓');
    if (dirty) retry = 1500;
  } catch (err) {
    if (err.conflict) { conflict = true; showConflict(); }
    else { dirty = true; retry = 15000; setStatus(`Not saved yet (${err.message}) — will retry`, true); }
  } finally { saving = false; }
  if (retry) saveTimer = setTimeout(flushSave, retry);
}
function showConflict() {
  setStatus('Changed on another device', true);
  const bar = $('#conflictBar');
  bar.innerHTML = `<strong>Your planner was changed on another device</strong> while this one had unsaved changes.
    <span class="spacer"></span>
    <button class="btn sm primary" data-cf="load">Load the latest</button>
    <button class="btn sm" data-cf="mine">Keep this device's version</button>`;
  bar.hidden = false;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-cf]');
  if (!b) return;
  const bar = $('#conflictBar');
  try {
    const r = await ghRead(gh);
    if (b.dataset.cf === 'load') { state = r.data || state; ghSha = r.sha; dirty = false; migrate(); }
    else { ghSha = r.sha; dirty = true; }   // overwrite GitHub with this device's copy
    conflict = false; bar.hidden = true; cachePut(); render();
    if (dirty) flushSave(); else setStatus('Synced ✓');
  } catch (err) { setStatus(`Couldn't reach GitHub (${err.message})`, true); }
});
// save straight away when leaving / switching apps; pull other-device changes when coming back
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { if (dirty) flushSave(); }
  else syncFromRemote();
});
window.addEventListener('online', () => { if (dirty) flushSave(); else syncFromRemote(); });
window.addEventListener('beforeunload', e => { if (dirty || saving) { flushSave(); e.preventDefault(); e.returnValue = ''; } });

/* ---------------- connect screen (first run on a device) ---------------- */
function viewConnect() {
  const c = ghCfg() || {};
  const owner = c.owner || (location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '');
  return `<div class="panel connect">
    <h1>Connect your planner</h1>
    <p class="muted">Your planner data lives in a <strong>private</strong> GitHub repo. Enter an access key for that repo once on this device —
      it's stored only on this device and only ever sent to GitHub.</p>
    ${setupError ? `<p class="overdue">Couldn't connect: ${esc(setupError)}</p>` : ''}
    <form id="connectForm" class="form-grid" autocomplete="off">
      <label class="f">GitHub username<input type="text" name="owner" value="${esc(owner)}" required autocapitalize="off" spellcheck="false"></label>
      <label class="f">Private data repo<input type="text" name="repo" value="${esc(c.repo || 'michaelmas-planner-data')}" required autocapitalize="off" spellcheck="false"></label>
      <label class="f full" style="grid-column:1/-1">Access key (fine-grained token)<input type="password" name="token" value="" placeholder="github_pat_…" required autocapitalize="off" spellcheck="false"></label>
      <input type="hidden" name="branch" value="${esc(c.branch || 'main')}"><input type="hidden" name="path" value="${esc(c.path || 'planner.json')}">
      <div style="grid-column:1/-1" class="row"><button class="btn primary">Connect</button><span class="small muted" id="connectMsg"></span></div>
    </form>
    <details class="small muted" style="margin-top:14px"><summary>How do I get an access key?</summary>
      <ol>
        <li>On GitHub: Settings → Developer settings → Personal access tokens → <strong>Fine-grained tokens</strong> → Generate new token.</li>
        <li>Repository access: <strong>Only select repositories</strong> → choose your private data repo.</li>
        <li>Permissions → Repository permissions → <strong>Contents: Read and write</strong>. Nothing else.</li>
        <li>Generate, copy the key and paste it above.</li>
      </ol></details>
  </div>`;
}
document.addEventListener('submit', async e => {
  if (e.target.id !== 'connectForm') return;
  e.preventDefault();
  const f = e.target, msg = $('#connectMsg');
  const cfg = Object.fromEntries(['owner', 'repo', 'token', 'branch', 'path'].map(k => [k, f.elements[k].value.trim()]));
  msg.textContent = 'Checking…';
  try {
    await ghRead(cfg);
    localStorage.setItem(GH_KEY, JSON.stringify(cfg));
    setupError = '';
    location.reload();
  } catch (err) { msg.textContent = `Couldn't connect: ${err.message}`; msg.className = 'small overdue'; }
});
function disconnectDevice() {
  if (!confirm('Remove the access key from this device? Your data stays safe in your private repo; you can reconnect any time.')) return;
  localStorage.removeItem(GH_KEY); localStorage.removeItem(CACHE_KEY); localStorage.removeItem(SHA_KEY);
  location.reload();
}

/* ---------------- modal forms ---------------- */
function fieldHTML(f, v) {
  const val = v[f.key] ?? f.default ?? '';
  const cls = f.full ? 'f full' : 'f';
  const hint = f.hint ? ` <span class="hint">${esc(f.hint)}</span>` : '';
  let input;
  switch (f.type) {
    case 'select':
      input = `<select name="${f.key}">${f.options.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(val) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      break;
    case 'textarea':
      input = `<textarea name="${f.key}" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`;
      break;
    case 'checkbox':
      input = `<input type="checkbox" name="${f.key}"${val ? ' checked' : ''}>`;
      break;
    default:
      input = `<input type="${f.type || 'text'}" name="${f.key}" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}"${f.required ? ' required' : ''}${f.min != null ? ` min="${f.min}"` : ''}${f.step ? ` step="${f.step}"` : ''}>`;
  }
  return `<label class="${cls}" data-field="${f.key}">${esc(f.label)}${hint}${input}</label>`;
}

function openForm({ title, fields, values = {}, onSave, onDelete, extraButtons = '' }) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">
    <h2>${esc(title)}</h2>
    <form novalidate>
      ${fields.map(f => fieldHTML(f, values)).join('')}
      <div class="form-error" hidden></div>
      <div class="modal-actions">
        ${onDelete ? '<button type="button" class="btn danger" data-act="del">Delete</button>' : ''}
        ${extraButtons}
        <span class="spacer"></span>
        <button type="button" class="btn" data-act="cancel">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form></div>`;
  m.hidden = false;
  const form = $('form', m);
  const read = () => {
    const v = {};
    for (const f of fields) {
      const el = form.elements[f.key];
      v[f.key] = f.type === 'checkbox' ? el.checked : f.type === 'number' ? (el.value === '' ? '' : +el.value) : el.value.trim();
    }
    return v;
  };
  const refresh = () => {
    const v = read();
    for (const f of fields) if (f.show) form.querySelector(`[data-field="${f.key}"]`).hidden = !f.show(v);
  };
  form.addEventListener('change', e => {
    const f = fields.find(x => x.key === e.target.name);
    if (f && f.onChange) f.onChange(form, read());
    refresh();
  });
  refresh();
  const showErr = msg => { const el = $('.form-error', form); el.textContent = msg; el.hidden = false; };
  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = read();
    const err = onSave(v);
    if (err) return showErr(err);
    closeModal(); save(); render();
  });
  form.addEventListener('click', e => {
    const act = e.target.dataset.act;
    if (act === 'cancel') closeModal();
    if (act === 'del' && confirm('Delete this item?')) { onDelete(); closeModal(); save(); render(); }
  });
  const first = form.querySelector('input:not([type=checkbox]), select, textarea');
  if (first) first.focus();
  return form;
}
function closeModal() {
  const m = $('#modal'); m.hidden = true; m.innerHTML = ''; modalRefresh = null;
  if (state) render();
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (viewer) closePdf(); else if (!$('#modal').hidden) closeModal();
});
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });

const courseOptions = (blank = true) => [...(blank ? [['', '—']] : []), ...state.courses.map(c => [c.id, c.name])];

/* ---------------- event form ---------------- */
function openEventForm(ev, preset = {}) {
  const isNew = !ev;
  const v = ev ? { ...ev } : {
    title: '', type: 'lecture', courseId: '', repeat: 'once', date: iso(today()), day: today().getDay(),
    weeks: '', start: '09:00', end: '10:00', location: '', who: '', notes: '', ...preset,
  };
  openForm({
    title: isNew ? 'Add event' : 'Edit event',
    values: v,
    fields: [
      { key: 'title', label: 'Title', required: true, full: true, placeholder: 'e.g. Structural Mechanics lecture' },
      { key: 'type', label: 'Type', type: 'select', options: Object.entries(TYPES).filter(([k]) => k !== 'deadline') },
      { key: 'courseId', label: 'Course', type: 'select', options: courseOptions() },
      { key: 'repeat', label: 'Repeats', type: 'select', options: [['once', 'One-off'], ['weekly', 'Weekly in term']] },
      { key: 'date', label: 'Date', type: 'date', show: x => x.repeat === 'once' },
      { key: 'day', label: 'Day', type: 'select', options: DAYS_LONG.map((d, i) => [i, d]), show: x => x.repeat === 'weekly' },
      { key: 'weeks', label: 'Term weeks', hint: 'e.g. 1-8 or 1,3,5 (blank = all)', placeholder: '1-8', show: x => x.repeat === 'weekly', full: true },
      { key: 'start', label: 'Start', type: 'time' },
      { key: 'end', label: 'End', type: 'time' },
      { key: 'location', label: 'Location', placeholder: 'e.g. LT0' },
      { key: 'who', label: 'Supervisor / lecturer', placeholder: 'e.g. Dr Smith' },
      { key: 'link', label: 'Moodle / info link', placeholder: 'https://www.vle.cam.ac.uk/…', full: true },
      { key: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
    onSave: x => {
      if (!x.title) return 'Please give the event a title.';
      if (!x.start || !x.end) return 'Please set start and end times.';
      if (toMin(x.end) <= toMin(x.start)) return 'End time must be after start time.';
      if (x.repeat === 'once' && !x.date) return 'Please pick a date.';
      if (x.link && !/^https?:\/\//i.test(x.link)) return 'The link should start with https://';
      x.day = +x.day;
      if (isNew) state.events.push({ id: uid(), ...x });
      else Object.assign(ev, x);
    },
    onDelete: isNew ? null : () => { state.events = state.events.filter(e => e !== ev); },
  });
}

/* ---------------- paper form ---------------- */
function supervisionOptions(courseId) {
  const t = today();
  const end = addDays(windowStart(+state.settings.numWeeks + 1), 7);
  return occurrences(addDays(t, -14), end)
    .filter(o => o.e.type === 'supervision' && (!courseId || !o.e.courseId || o.e.courseId === courseId))
    .map(o => [`${o.date}T${o.e.start}`, `${fmtDate(o.d)} ${o.e.start} — ${o.e.title}`]);
}

function openPaperForm(p, preset = {}) {
  const isNew = !p;
  const draft = JSON.parse(JSON.stringify(p || {
    courseId: '', number: '', title: '', issued: '', due: '', status: 'todo', notes: '', ...preset,
  }));
  if (!Array.isArray(draft.questions)) draft.questions = Array.from({ length: DEFAULT_QUESTIONS }, blankQ);
  let statusTouched = false;

  const m = $('#modal');
  const opt = (pairs, val) => pairs.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(val) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  m.innerHTML = `<div class="modal-card wide" role="dialog" aria-modal="true">
    <div class="row"><h2 style="margin:0">${isNew ? 'Add examples paper' : 'Examples paper'}</h2><span class="spacer"></span>${extLink(PAPERS_URL, 'Examples papers on Moodle ↗', 'btn sm')}</div>
    <form novalidate>
      <label class="f">Course<select name="courseId">${opt(courseOptions(), draft.courseId)}</select></label>
      <label class="f">Paper<input type="text" name="number" value="${esc(draft.number)}" placeholder="e.g. Examples Paper 3"></label>
      <label class="f full">Topic / title<input type="text" name="title" value="${esc(draft.title)}" placeholder="e.g. Bending of beams"></label>
      <label class="f">Due (supervision)<input type="datetime-local" name="due" value="${esc(draft.due)}"></label>
      <label class="f">Set due date from a supervision<select name="link"></select></label>
      <label class="f">Issued${draft.issuedNote ? ` <span class="hint">${esc(draft.issuedNote)}</span>` : ''}<input type="date" name="issued" value="${esc(draft.issued)}"></label>
      <label class="f">Status<select name="status">${opt(Object.entries(STATUS), draft.status)}</select></label>
      ${isNew ? '' : `<div class="full pdf-attach" id="pdfAttach"></div>`}

      <div class="full q-head">
        <strong>Questions</strong>
        <span class="small muted" id="qSummary"></span>
        <span class="spacer"></span>
        <label class="small muted q-count">Number of questions
          <button type="button" class="btn sm" data-qact="minus" aria-label="One fewer question">−</button>
          <input type="number" name="qcount" min="1" max="60" value="${draft.questions.length}">
          <button type="button" class="btn sm" data-qact="plus" aria-label="One more question">+</button>
        </label>
      </div>
      <div class="full row small">
        <button type="button" class="btn sm" data-qact="all">Tick all</button>
        <button type="button" class="btn sm" data-qact="none">Untick all</button>
        <span class="muted">Tick questions as you finish them. Use ⚑ for ones you struggled with and add a note to raise in the supervision.</span>
      </div>
      <div class="full q-list" id="qList"></div>

      ${isNew ? '' : `<div class="full"><strong>Tasks for this paper</strong>
        <div id="ltWrap">${ltHTML('paper', p.id, { due: (draft.due || '').slice(0, 10) })}</div></div>`}
      <label class="f full">General notes<textarea name="notes" placeholder="Anything else to ask in the supervision…">${esc(draft.notes)}</textarea></label>
      <div class="form-error" hidden></div>
      <div class="modal-actions">
        ${isNew ? '' : '<button type="button" class="btn danger" data-qact="delete">Delete</button>'}
        <span class="spacer"></span>
        <button type="button" class="btn" data-qact="cancel">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form></div>`;
  m.hidden = false;
  const form = $('form', m);
  const qList = $('#qList', form);

  const renderQs = () => {
    qList.innerHTML = draft.questions.map((q, i) => `
      <div class="q ${q.done ? 'done' : ''} ${q.flag ? 'flagged' : ''}" data-i="${i}">
        <label class="q-check"><input type="checkbox" data-q="done" ${q.done ? 'checked' : ''}> Q${i + 1}</label>
        <button type="button" class="q-flag" data-q="flag" aria-pressed="${q.flag}" title="${q.flag ? 'Unflag' : 'Flag: struggled with this'}">⚑</button>
        <input type="text" class="q-note" data-q="note" value="${esc(q.note)}" placeholder="What was tricky? (to ask in the supervision)" ${q.flag ? '' : 'hidden'}>
      </div>`).join('');
    updateSummary();
  };
  const updateSummary = () => {
    const done = draft.questions.filter(q => q.done).length;
    const fl = draft.questions.filter(q => q.flag).length;
    $('#qSummary', form).textContent = `${done}/${draft.questions.length} done${fl ? ` · ${fl} flagged` : ''}`;
    form.elements.qcount.value = draft.questions.length;
  };
  const resize = n => {
    n = Math.max(1, Math.min(60, Math.round(+n) || DEFAULT_QUESTIONS));
    if (n < draft.questions.length) {
      const lost = draft.questions.slice(n).filter(q => q.done || q.flag || q.note).length;
      if (lost && !confirm(`Removing questions ${n + 1}–${draft.questions.length} will discard ${lost} ticked/flagged question(s). Continue?`)) {
        updateSummary(); return;
      }
      draft.questions.length = n;
    } else {
      while (draft.questions.length < n) draft.questions.push(blankQ());
    }
    renderQs();
  };
  const fillLinks = cid => {
    const opts = supervisionOptions(cid);
    form.elements.link.innerHTML = `<option value="">${opts.length ? 'Choose…' : 'No supervisions for this course'}</option>` +
      opts.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('');
  };

  qList.addEventListener('change', e => {
    const row = e.target.closest('.q'); if (!row) return;
    const q = draft.questions[+row.dataset.i];
    if (e.target.dataset.q === 'done') { q.done = e.target.checked; row.classList.toggle('done', q.done); updateSummary(); }
  });
  qList.addEventListener('input', e => {
    const row = e.target.closest('.q');
    if (row && e.target.dataset.q === 'note') draft.questions[+row.dataset.i].note = e.target.value;
  });
  qList.addEventListener('click', e => {
    const btn = e.target.closest('[data-q="flag"]'); if (!btn) return;
    const row = btn.closest('.q'), q = draft.questions[+row.dataset.i];
    q.flag = !q.flag;
    row.classList.toggle('flagged', q.flag);
    btn.setAttribute('aria-pressed', q.flag);
    btn.title = q.flag ? 'Unflag' : 'Flag: struggled with this';
    const note = $('.q-note', row);
    note.hidden = !q.flag;
    if (q.flag) note.focus();
    updateSummary();
  });
  form.addEventListener('change', e => {
    const n = e.target.name;
    if (n === 'courseId') fillLinks(e.target.value);
    if (n === 'link' && e.target.value) form.elements.due.value = e.target.value;
    if (n === 'status') statusTouched = true;
    if (n === 'qcount') resize(e.target.value);
  });
  form.addEventListener('keydown', e => {   // Enter in the count box shouldn't submit the form
    if (e.key === 'Enter' && e.target.name === 'qcount') { e.preventDefault(); resize(e.target.value); }
  });
  form.addEventListener('click', e => {
    const act = e.target.dataset.qact;
    if (!act) return;
    if (act === 'plus') resize(draft.questions.length + 1);
    if (act === 'minus') resize(draft.questions.length - 1);
    if (act === 'all') { draft.questions.forEach(q => { q.done = true; }); renderQs(); }
    if (act === 'none') { draft.questions.forEach(q => { q.done = false; }); renderQs(); }
    if (act === 'cancel') closeModal();
    if (act === 'delete' && confirm('Delete this examples paper?')) {
      state.papers = state.papers.filter(x => x !== p); closeModal(); save(); render();
    }
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = name => form.elements[name].value.trim();
    if (!v('number') && !v('title')) {
      const el = $('.form-error', form); el.textContent = 'Give the paper a number or a title.'; el.hidden = false; return;
    }
    Object.assign(draft, { courseId: v('courseId'), number: v('number'), title: v('title'), due: v('due'),
      issued: v('issued'), status: v('status'), notes: v('notes') });
    draft.questions.forEach(q => { q.note = q.note.trim(); });
    syncPaper(draft, !statusTouched);
    if (isNew) state.papers.push({ id: uid(), ...draft });
    else Object.assign(p, draft);
    closeModal(); save(); render();
  });

  const pdfRow = () => {
    const box = $('#pdfAttach', form);
    if (!box) return;
    box.innerHTML = draft.pdf
      ? `<span>📄 <strong>${esc(draft.pdfName || 'Paper PDF')}</strong></span><span class="spacer"></span>
         <button type="button" class="btn sm primary" data-qact="pdf-view">View paper</button>
         <label class="btn sm">Replace<input type="file" accept="application/pdf,.pdf" data-qact="pdf-file" hidden></label>
         <button type="button" class="btn sm" data-qact="pdf-remove">Remove</button>`
      : `<span class="muted">No PDF attached.</span><span class="spacer"></span>
         <label class="btn sm">📎 Attach PDF<input type="file" accept="application/pdf,.pdf" data-qact="pdf-file" hidden></label>`;
  };
  form.addEventListener('change', async e => {
    if (e.target.dataset.qact !== 'pdf-file' || !e.target.files[0]) return;
    const box = $('#pdfAttach', form);
    box.innerHTML = '<span class="muted">Uploading…</span>';
    try {
      const f = await uploadPdf(p, e.target.files[0]);
      Object.assign(p, f); Object.assign(draft, f); save();
    } catch (err) { alert(`Couldn't attach the PDF: ${err.message}`); }
    pdfRow();
  });
  form.addEventListener('click', e => {
    const a = e.target.dataset.qact;
    if (a === 'pdf-view') openPdf(p);
    if (a === 'pdf-remove' && confirm('Remove the PDF from this paper?')) {
      for (const o of [p, draft]) { delete o.pdf; delete o.pdfSha; delete o.pdfName; }
      save(); pdfRow();
    }
  });
  pdfRow();
  renderQs();
  fillLinks(draft.courseId);
  if (!isNew) wireLinkedTasks($('#ltWrap', form), () => ({ courseId: form.elements.courseId.value, due: form.elements.due.value.slice(0, 10) }));
  form.elements.number.focus();
}

/* ---------------- task form ---------------- */
function openTaskForm(t) {
  openForm({
    title: t.link ? `Edit task — ${linkLabel(t, false)}` : 'Edit task',
    values: t,
    fields: [
      { key: 'title', label: 'Task', full: true, required: true },
      { key: 'due', label: 'Due', type: 'date' },
      { key: 'time', label: 'Time', hint: 'optional — shows it on the calendar', type: 'time' },
      { key: 'courseId', label: 'Course', type: 'select', options: courseOptions() },
      { key: 'priority', label: 'Priority', type: 'select', options: Object.entries(PRIORITY) },
      { key: 'done', label: 'Done', type: 'checkbox' },
      { key: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
    onSave: x => { if (!x.title) return 'Task needs a name.'; Object.assign(t, x); },
    onDelete: () => { state.tasks = state.tasks.filter(x => x !== t); },
  });
}

/* ---------------- examples-paper release dates ---------------- */
const shortPaper = p => `${(p.title || '').split(' (')[0].split(' – ')[0]} ${(p.number || '').replace('Examples Paper ', 'EP').replace('Prep sheet', 'prep')}`.trim();
/** Paper issue dates falling between two dates (inclusive). */
function releasesBetween(from, to) {
  const a = iso(from), b = iso(to), out = [];
  for (const p of state.papers) {
    if (p.issued && p.issued >= a && p.issued <= b) out.push({ date: p.issued, kind: 'issued', p });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.kind.localeCompare(y.kind));
}
function relChip(r, withDate = false) {
  const c = course(r.p.courseId);
  const what = 'issued';
  return `<a class="tt-rel ${r.kind}" href="${esc(PAPERS_URL)}" target="_blank" rel="noopener noreferrer" style="--c:${c.color}" title="${esc(shortPaper(r.p))} ${what} — open on Moodle">
    <span class="ico">📄</span><span class="txt">${withDate ? `<strong>${fmtDate(parseISO(r.date))}</strong> · ` : ''}${esc(shortPaper(r.p))} ${what}</span><span class="ico">↗</span></a>`;
}
function releaseCell(p) {
  const d = x => x ? fmtDate(parseISO(x)) : '';
  const t = iso(today());
  const iss = p.issued ? (p.issued <= t ? `Issued ${d(p.issued)}` : `<strong>Out ${d(p.issued)}</strong>`) : (p.issuedNote ? 'Issued pre-term' : '');
  return `<div class="small">${iss}</div>`;
}

/* ---------------- sessions, links & linked tasks ---------------- */
const occKey = o => `${o.e.id}|${o.date}`;
function findOcc(key) {
  const [id, date] = key.split('|');
  const e = state.events.find(x => x.id === id);
  return e && date ? { e, date, d: parseISO(date) } : null;
}
function evAttr(o) {
  if (o.e.taskId) return `data-task="${o.e.taskId}"`;
  if (o.e.type === 'supervision') return `data-sup="${esc(occKey(o))}"`;
  if (o.e.type === 'lab') return `data-lab="${esc(occKey(o))}"`;
  return `data-ev="${o.e.id}"`;
}
const papersForSup = o => state.papers.filter(p => p.due && p.due.startsWith(o.date) && (!o.e.courseId || p.courseId === o.e.courseId));
const linkedTasks = (kind, key) => state.tasks.filter(t => t.link && t.link.kind === kind && t.link.key === key);

function linkLabel(t, icon = true) {
  const { kind, key } = t.link || {};
  if (kind === 'paper') {
    const p = state.papers.find(x => x.id === key);
    return (icon ? '📄 ' : '') + (p ? [p.number, p.title].filter(Boolean).join(' — ') : '(deleted paper)');
  }
  const o = findOcc(key || '');
  const ico = kind === 'lab' ? '🔬 ' : '👥 ';
  return (icon ? ico : '') + (o ? `${o.e.title} · ${fmtDate(o.d)}` : '(deleted session)');
}
function openLinked(kind, key) {
  if (kind === 'paper') { const p = state.papers.find(x => x.id === key); if (p) openPaperForm(p); }
  else if (kind === 'sup') openSupModal(key);
  else if (kind === 'lab') openLabModal(key);
}

/** Clickable question boxes: click = tick, right-click / ⌥-click = flag. */
function qStrip(p) {
  return `<div class="q-strip-wrap"><div class="q-strip" role="group" aria-label="Questions for ${paperLabel(p)}">${p.questions.map((q, i) =>
    `<button type="button" class="qs ${q.done ? 'done' : ''} ${q.flag ? 'flag' : ''}" data-action="q-toggle" data-id="${p.id}" data-i="${i}"
      title="Q${i + 1}${q.done ? ' ✓ done' : ''}${q.flag ? ' ⚑ flagged' + (q.note ? ': ' + esc(q.note) : '') : ''}\nClick to tick · right-click, ⌥-click or press-and-hold to flag"
      aria-pressed="${q.done}">${i + 1}</button>`).join('')}</div>
    <span class="small muted q-count-label">${p.done}/${p.total}</span>${flagBadge(p)}</div>`;
}
function toggleQ(btn, flag) {
  const p = state.papers.find(x => x.id === btn.dataset.id);
  const q = p && p.questions[+btn.dataset.i];
  if (!q) return;
  if (flag) q.flag = !q.flag; else q.done = !q.done;
  syncPaper(p, true); save();
  if (btn.closest('#modal') && modalRefresh) modalRefresh(); else render();
  pdfStrip();
}
document.addEventListener('contextmenu', e => {
  const b = e.target.closest('[data-action="q-toggle"]');
  if (!b) return;
  e.preventDefault();
  if (Date.now() - lastTouch > 1500) toggleQ(b, true);   // touch long-press is handled separately
});

/** Task list + quick-add box attached to a paper / supervision / lab. */
function ltHTML(kind, key, defs = {}) {
  const list = linkedTasks(kind, key).sort(byDue);
  return `<div class="lt" data-kind="${kind}" data-key="${esc(key)}">
    ${list.length ? list.map(t => `<div class="lt-row ${t.done ? 'done' : ''}" data-tid="${t.id}">
        <input type="checkbox" data-lt="toggle" ${t.done ? 'checked' : ''} aria-label="Done">
        <span class="lt-title">${esc(t.title)}</span>
        <span class="small ${!t.done && t.due && t.due < iso(today()) ? 'overdue' : 'muted'}">${t.due ? fmtDate(parseISO(t.due)) + (t.time ? ', ' + t.time : '') : 'no date'}${t.time ? ' 📅' : ''}</span>
        <button type="button" class="btn sm" data-lt="del" aria-label="Delete task">✕</button></div>`).join('')
      : '<div class="empty small">No tasks yet.</div>'}
    <div class="lt-add">
      <input type="text" data-lt-in="title" value="${esc(defs.title || '')}" placeholder="${esc(defs.placeholder || 'Add a task…')}">
      <input type="date" data-lt-in="due" value="${esc(defs.due || '')}" aria-label="Due date">
      <input type="time" data-lt-in="time" value="${esc(defs.time || '')}" aria-label="Time" title="Optional: add a time to put it on the calendar">
      <button type="button" class="btn sm primary" data-lt="add">Add</button>
    </div>
    <div class="small muted">Tasks with a time appear on the calendar and in the Planner.</div></div>`;
}
function wireLinkedTasks(root, getDefs = () => ({})) {
  const redraw = () => {
    const lt = root.querySelector('.lt');
    lt.outerHTML = ltHTML(lt.dataset.kind, lt.dataset.key, { ...getDefs(), title: '' });
    save();
  };
  const add = () => {
    const lt = root.querySelector('.lt');
    const val = n => lt.querySelector(`[data-lt-in="${n}"]`).value.trim();
    if (!val('title')) { lt.querySelector('[data-lt-in="title"]').focus(); return; }
    state.tasks.push({ id: uid(), title: val('title'), due: val('due'), time: val('time'), courseId: getDefs().courseId || '',
      priority: 'med', done: false, notes: '', link: { kind: lt.dataset.kind, key: lt.dataset.key } });
    redraw();
    root.querySelector('[data-lt-in="title"]').focus();
  };
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-lt]');
    if (!b || b.dataset.lt === 'toggle') return;
    if (b.dataset.lt === 'add') add();
    if (b.dataset.lt === 'del') {
      const id = b.closest('[data-tid]').dataset.tid;
      state.tasks = state.tasks.filter(t => t.id !== id); redraw();
    }
  });
  root.addEventListener('change', e => {
    if (e.target.dataset.lt !== 'toggle') return;
    const t = state.tasks.find(x => x.id === e.target.closest('[data-tid]').dataset.tid);
    t.done = e.target.checked; redraw();
  });
  root.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset.ltIn) { e.preventDefault(); add(); }
  });
}

/* ---------------- supervision panel ---------------- */
function openSupModal(key) {
  const o = findOcc(key);
  if (!o) return;
  const c = course(o.e.courseId);
  const papers = papersForSup(o);
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card wide" role="dialog" aria-modal="true">
    <div class="row"><h2 style="margin:0">${esc(o.e.title)}</h2><span class="spacer"></span>
      ${o.e.link ? extLink(o.e.link, 'Moodle ↗', 'btn sm') : ''}
      <button type="button" class="btn sm" data-m="edit">Edit event</button>
      <button type="button" class="btn sm" data-m="close">Close</button></div>
    <p class="muted">${fmtDate(o.d)}, ${esc(o.e.start)}–${esc(o.e.end)} · ${[c.name, o.e.location, o.e.who].filter(Boolean).map(esc).join(' · ')}</p>
    <h3>Examples papers</h3>
    ${papers.length ? papers.map(p => `<div class="sup-paper">
        <div class="row"><strong>${paperLabel(p)}</strong><span class="spacer"></span><span class="small status-${p.status}">${STATUS[p.status]}</span>
          <button type="button" class="btn sm edit-btn" data-m="paper" data-id="${p.id}">✎ Edit</button></div>
        ${qStrip(p)}${flagList(p)}</div>`).join('')
      : '<div class="empty small">No papers due at this supervision (papers are matched by their due date).</div>'}
    <button type="button" class="btn sm" data-m="add-paper">+ Add paper for this supervision</button>
    <h3>Notes</h3>
    <textarea id="sessNotes" rows="4" placeholder="Questions to ask, what was covered, things to revisit…">${esc(state.supNotes[key] || '')}</textarea>
    <h3>Tasks</h3>
    <div id="ltWrap">${ltHTML('sup', key, { due: o.date, placeholder: 'e.g. Redo Q4 using the method from the supervision' })}</div>
  </div>`;
  m.hidden = false;
  modalRefresh = () => openSupModal(key);
  const card = $('.modal-card', m);
  card.addEventListener('click', e => {
    const q = e.target.closest('[data-action="q-toggle"]');
    if (q) return toggleQ(q, e.altKey);
    const b = e.target.closest('[data-m]');
    if (!b) return;
    e.preventDefault();
    const act = b.dataset.m;
    if (act === 'close') closeModal();
    if (act === 'edit') { closeModal(); openEventForm(o.e); }
    if (act === 'paper') { const p = state.papers.find(x => x.id === b.dataset.id); closeModal(); openPaperForm(p); }
    if (act === 'add-paper') { closeModal(); openPaperForm(null, { due: `${o.date}T${o.e.start}`, courseId: o.e.courseId || '' }); }
  });
  $('#sessNotes', m).addEventListener('input', e => {
    if (e.target.value.trim()) state.supNotes[key] = e.target.value; else delete state.supNotes[key];
    save();
  });
  wireLinkedTasks($('#ltWrap', m), () => ({ courseId: o.e.courseId, due: o.date }));
}

/* ---------------- examples paper PDFs ----------------
   PDFs live in the private data repo (papers/<paperId>.pdf). They are fetched with the
   same access key as the data, kept in this browser's cache keyed by the file's hash,
   and drawn with pdf.js so every page shows on iPhone too. */
const PDF_CACHE = 'planner-pdfs';
const pdfCacheKey = d => `https://planner.invalid/${d.path}?v=${d.sha || ''}`;
const pdfApiUrl = path => ghUrl({ ...gh, path });

async function pdfBytes(p) {   // p = { path, sha }
  let cache = null;
  try { cache = await caches.open(PDF_CACHE); const hit = await cache.match(pdfCacheKey(p)); if (hit) return await hit.arrayBuffer(); } catch { /* no Cache API */ }
  let r;
  if (backend === 'github') {
    r = await fetch(`${pdfApiUrl(p.path)}?ref=${encodeURIComponent(gh.branch)}`, { cache: 'no-store', headers: {
      Authorization: `Bearer ${gh.token}`, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!r.ok) throw ghError(r.status);
  } else {
    r = await fetch(`api/file?path=${encodeURIComponent(p.path)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`couldn't load the PDF (${r.status})`);
  }
  const buf = await r.arrayBuffer();
  if (cache) {
    try {   // drop older versions of this file, keep the new one
      for (const k of await cache.keys()) if (k.url.startsWith(`https://planner.invalid/${p.path}?`)) await cache.delete(k);
      await cache.put(pdfCacheKey(p), new Response(buf.slice(0), { headers: { 'Content-Type': 'application/pdf' } }));
    } catch { /* storage full: just don't cache */ }
  }
  return buf;
}

let pdfjsLib = null;
async function loadPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('./vendor/pdfjs/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
  }
  return pdfjsLib;
}

let viewer = null;   // { d, doc, zoom, io, el }
function closePdf() {
  if (!viewer) return;
  viewer.io && viewer.io.disconnect();
  viewer.doc && viewer.doc.destroy();
  viewer.el.remove();
  document.body.classList.remove('pdf-open');
  viewer = null;
}
function pdfStrip() {
  if (!viewer) return;
  const p = viewer.d.paperId && state.papers.find(x => x.id === viewer.d.paperId);
  const s = $('.pdf-qs', viewer.el);
  if (s) s.innerHTML = p && p.questions && p.questions.length ? qStrip(p) : '';
}
function openPdf(p) {
  return openDoc({ path: p.pdf, sha: p.pdfSha, title: [p.number, p.title].filter(Boolean).join(' — '),
    sub: course(p.courseId).name, fileName: p.pdfName, paperId: p.id });
}
/** d = { path, sha, title, sub, fileName, paperId? } */
async function openDoc(d) {
  closePdf();
  const el = document.createElement('div');
  el.id = 'pdfView';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', d.title);
  el.innerHTML = `<div class="pdf-bar">
      <button type="button" class="btn sm" data-pdf="close" aria-label="Close">✕</button>
      <div class="pdf-title"><strong>${esc(d.title)}</strong><span class="small">${esc(d.sub || '')}</span></div>
      <span class="spacer"></span>
      <button type="button" class="btn sm" data-pdf="out" aria-label="Zoom out">−</button>
      <button type="button" class="btn sm" data-pdf="fit" aria-label="Fit width">Fit</button>
      <button type="button" class="btn sm" data-pdf="in" aria-label="Zoom in">+</button>
      <button type="button" class="btn sm" data-pdf="save" title="Save / open in another app">⇩</button>
    </div>
    <div class="pdf-qs"></div>
    <div class="pdf-pages"><div class="pdf-msg">Loading ${esc(d.title)}…</div></div>`;
  document.body.appendChild(el);
  document.body.classList.add('pdf-open');
  viewer = { d, doc: null, zoom: 1, io: null, el, buf: null };
  const me = viewer;
  pdfStrip();
  $('[data-pdf="close"]', el).focus();
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-pdf]');
    if (!b) return;
    const a = b.dataset.pdf;
    if (a === 'close') closePdf();
    if (a === 'in' || a === 'out' || a === 'fit') {
      me.zoom = a === 'fit' ? 1 : Math.min(3, Math.max(0.5, me.zoom * (a === 'in' ? 1.25 : 0.8)));
      if (me.doc) layoutPages(me);
    }
    if (a === 'save' && me.buf) {
      const url = URL.createObjectURL(new Blob([me.buf], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url; link.download = d.fileName || `${d.title}.pdf`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  });
  try {
    const [lib, buf] = await Promise.all([loadPdfJs(), pdfBytes(d)]);
    if (viewer !== me) return;
    me.buf = buf;
    me.doc = await lib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise;
    if (viewer !== me) { me.doc.destroy(); return; }
    layoutPages(me);
  } catch (err) {
    if (viewer !== me) return;
    $('.pdf-pages', el).innerHTML = `<div class="pdf-msg">Couldn't open this PDF: ${esc(err.message || String(err))}.<br>
      ${navigator.onLine ? '' : "You're offline and it hasn't been opened on this device before. "}</div>`;
  }
}
async function layoutPages(v) {
  const box = $('.pdf-pages', v.el);
  v.io && v.io.disconnect();
  const width = Math.min(box.clientWidth - 16, 900) * v.zoom;
  const first = await v.doc.getPage(1);
  const base = first.getViewport({ scale: 1 });
  box.innerHTML = Array.from({ length: v.doc.numPages }, (_, i) =>
    `<div class="pdf-page" data-n="${i + 1}" style="width:${width}px;height:${width * base.height / base.width}px"><canvas></canvas></div>`).join('');
  v.io = new IntersectionObserver(entries => entries.forEach(en => {
    const div = en.target;
    if (en.isIntersecting && !div.dataset.done) { div.dataset.done = '1'; drawPage(v, div, width); }
    else if (!en.isIntersecting && div.dataset.done) {   // free memory for pages far off screen
      delete div.dataset.done; const c = $('canvas', div); c.width = c.height = 0;
    }
  }), { root: box, rootMargin: '1200px 0px' });
  box.querySelectorAll('.pdf-page').forEach(d => v.io.observe(d));
}
async function drawPage(v, div, width) {
  try {
    const page = await v.doc.getPage(+div.dataset.n);
    const vp1 = page.getViewport({ scale: 1 });
    const css = width / vp1.width;
    div.style.height = `${vp1.height * css}px`;
    // keep canvases within iOS memory limits
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8e6 / (vp1.width * vp1.height * css * css)));
    const vp = page.getViewport({ scale: css * dpr });
    const c = $('canvas', div);
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    c.style.width = `${width}px`; c.style.height = `${vp1.height * css}px`;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  } catch { /* page closed mid-render */ }
}

/** Upload a file to the private repo at path; returns its new git sha. */
async function uploadFile(path, file, message, knownSha) {
  if (backend !== 'github') throw new Error('uploading files needs the GitHub connection');
  if (file.size > 25e6) throw new Error('that file is over 25 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const url = pdfApiUrl(path);
  const put = sha => ghFetch(gh, url, { method: 'PUT', body: JSON.stringify({
    message, content: btoa(bin), branch: gh.branch, ...(sha ? { sha } : {}) }) });
  let r = await put(knownSha || null);
  if (r.status === 409 || r.status === 422) {   // a file is already there: replace it
    const meta = await ghFetch(gh, `${url}?ref=${encodeURIComponent(gh.branch)}`);
    if (meta.ok) r = await put((await meta.json()).sha);
  }
  if (!r.ok) throw ghError(r.status);
  return (await r.json()).content.sha;
}
async function deleteFile(path, sha) {
  if (backend !== 'github' || !sha) return;
  await ghFetch(gh, pdfApiUrl(path), { method: 'DELETE', body: JSON.stringify({ message: `Remove ${path}`, sha, branch: gh.branch }) }).catch(() => {});
}
async function uploadPdf(p, file) {
  const path = `papers/${p.id}.pdf`;
  const sha = await uploadFile(path, file, `Attach PDF: ${[p.number, p.title].filter(Boolean).join(' — ')}`, p.pdf === path ? p.pdfSha : null);
  return { pdf: path, pdfSha: sha, pdfName: file.name };
}
const pdfBtn = (p, cls = 'btn sm') => p.pdf ? `<button type="button" class="${cls} pdf-btn" data-action="view-pdf" data-id="${p.id}" aria-label="View ${paperLabel(p)}">📄 View</button>` : '';

/* ---------------- labs ---------------- */
const labRec = key => state.labs[key] || { status: '', notes: '' };
function setLab(key, patch) {
  const r = { ...labRec(key), ...patch };
  if (!r.status && !r.notes && !r.pre) delete state.labs[key]; else state.labs[key] = r;
  save();
}
/** Overall state of a lab session for display. */
function labInfo(o) {
  const key = occKey(o), rec = labRec(key);
  const tasks = linkedTasks('lab', key);
  const open = tasks.filter(t => !t.done).sort(byDue);
  const nowM = nowMin(), isToday = o.date === iso(today());
  const isPast = o.date < iso(today()) || (isToday && toMin(o.e.end) <= nowM);
  const started = isPast || (isToday && toMin(o.e.start) <= nowM);
  let label, cls;
  if (rec.status === 'done') { label = 'Completed'; cls = 'ok'; }
  else if (rec.status === 'followup') {
    if (tasks.length && !open.length) { label = 'Follow-up done'; cls = 'ok'; }
    else { label = open.length ? `Follow-up due ${fmtDate(parseISO(open[0].due || o.date))}` : 'Needs follow-up — add a deadline'; cls = 'warn'; }
  } else if (isPast) { label = 'Not marked'; cls = 'todo'; }
  else if (started) { label = 'In progress'; cls = 'live'; }
  else { label = 'Upcoming'; cls = 'upcoming'; }
  const preDue = rec.pre === 'required' && !isPast;   // pre-work still to do before the lab
  return { key, rec, tasks, open, isPast, started, label, cls, preDue };
}
function labButtons(key, status) {
  const b = (st, text, title) => `<button type="button" class="seg ${status === st ? 'on ' + (st === 'done' ? 'ok' : 'warn') : ''}" data-action="lab-status" data-key="${esc(key)}" data-status="${st}" title="${title}" aria-pressed="${status === st}">${text}</button>`;
  return `<div class="seg-group">${b('done', '✓ Completed', 'Lab completed, nothing more to do')}${b('followup', '✎ Write-up / follow-up', 'Lab done but needs a write-up or follow-up work')}</div>`;
}
function labPreButtons(key, pre) {
  const b = (st, text, title, on) => `<button type="button" class="seg ${pre === st ? 'on ' + on : ''}" data-action="lab-pre" data-key="${esc(key)}" data-pre="${st}" title="${title}" aria-pressed="${pre === st}">${text}</button>`;
  return `<div class="seg-group">${b('required', '📋 Pre-work required', 'This lab has pre-work to do beforehand', 'warn')}${b('done', '✓ Pre-work done', 'Pre-work finished', 'ok')}</div>`;
}
function applyLabPre(btn) {
  const key = btn.dataset.key, v = btn.dataset.pre;
  setLab(key, { pre: labRec(key).pre === v ? '' : v });   // clicking the active option clears it
}
function openLabModal(key) {
  const o = findOcc(key);
  if (!o) return;
  const info = labInfo(o);
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card wide" role="dialog" aria-modal="true">
    <div class="row"><h2 style="margin:0">🔬 ${esc(o.e.title)}</h2><span class="spacer"></span>
      ${o.e.link ? extLink(o.e.link, 'Open on Moodle ↗', 'btn sm primary') : ''}
      <button type="button" class="btn sm" data-m="edit">Edit event</button>
      <button type="button" class="btn sm" data-m="close">Close</button></div>
    <p class="muted">${fmtDate(o.d)}, ${esc(o.e.start)}–${esc(o.e.end)}${o.e.location ? ' · ' + esc(o.e.location) : ''} · Week ${termWeek(o.d)}</p>
    <h3>Status <span class="lab-pill ${info.cls}">${esc(info.label)}</span></h3>
    ${labButtons(key, info.rec.status)}
    ${!info.isPast || info.rec.pre ? `<h3>Pre-work ${info.preDue ? '<span class="lab-pill warn">To do</span>' : info.rec.pre === 'done' ? '<span class="lab-pill ok">Done</span>' : ''}</h3>
    ${labPreButtons(key, info.rec.pre)}
    ${info.preDue ? '<p class="small muted">Add the pre-work below as a task with a deadline to see it on your calendar.</p>' : ''}` : ''}
    ${info.rec.status === 'followup' ? '<p class="small muted">Add the write-up / follow-up work below with its deadline. Give it a time and it appears on your calendar.</p>' : ''}
    <h3>${info.rec.status === 'followup' ? 'Write-up & follow-up work' : 'Tasks'}</h3>
    <div id="ltWrap">${ltHTML('lab', key, info.rec.status === 'followup' && !info.tasks.length
      ? { title: `Write-up: ${o.e.title}`, due: iso(addDays(o.d, 7)), time: '17:00' }
      : info.preDue && !info.tasks.length ? { title: `Pre-work: ${o.e.title}`, due: iso(addDays(o.d, -1)), time: '20:00' }
      : { due: iso(addDays(o.d, 7)), time: '17:00', placeholder: 'e.g. Lab report, finish calculations…' })}</div>
    <h3>Notes</h3>
    <textarea id="sessNotes" rows="4" placeholder="Results, things to remember for the write-up…">${esc(info.rec.notes || '')}</textarea>
    ${o.e.notes ? `<p class="small muted">${esc(o.e.notes)}</p>` : ''}
  </div>`;
  m.hidden = false;
  modalRefresh = () => openLabModal(key);
  $('.modal-card', m).addEventListener('click', e => {
    const s = e.target.closest('[data-action="lab-status"]');
    if (s) { applyLabStatus(s); return openLabModal(key); }
    const pw = e.target.closest('[data-action="lab-pre"]');
    if (pw) { applyLabPre(pw); return openLabModal(key); }
    const b = e.target.closest('[data-m]');
    if (!b) return;
    if (b.dataset.m === 'close') closeModal();
    if (b.dataset.m === 'edit') { closeModal(); openEventForm(o.e); }
  });
  $('#sessNotes', m).addEventListener('input', e => setLab(key, { notes: e.target.value }));
  wireLinkedTasks($('#ltWrap', m), () => ({ courseId: o.e.courseId || 'labs' }));
  if (info.rec.status === 'followup' && !info.tasks.length) $('[data-lt-in="title"]', m).focus();
}
function applyLabStatus(btn) {
  const key = btn.dataset.key, st = btn.dataset.status;
  const cur = labRec(key).status;
  setLab(key, { status: cur === st ? '' : st });   // clicking the active option un-marks it
  return cur !== st && st === 'followup';
}

/* ---------------- shared bits ---------------- */
function evRow(o, { showDate = false, extra = '' } = {}) {
  const c = course(o.e.courseId);
  const isToday = o.date === iso(today());
  const nm = nowMin();
  const past = o.d < today() || (isToday && toMin(o.e.end) <= nm) || (o.e.type === 'lab' && labInfo(o).cls === 'ok');
  const now = !past && isToday && toMin(o.e.start) <= nm && nm < toMin(o.e.end);
  const meta = [TYPES[o.e.type], c.name, o.e.location, o.e.who].filter(Boolean).map(esc).join(' · ');
  return `<li class="${past ? 'past' : ''} ${now ? 'now' : ''}" ${evAttr(o)}>
    <div class="ev-time">${showDate ? `<div>${fmtDate(o.d)}</div>` : ''}${esc(o.e.start)}–${esc(o.e.end)}</div>
    <div class="ev-bar" style="background:${c.color}"></div>
    <div class="ev-main"><div class="ev-title">${esc(o.e.title)}</div><div class="ev-meta">${meta}${o.e.link ? ' · ' + extLink(o.e.link) : ''}</div>${extra}</div>
  </li>`;
}

function flagBadge(p) {
  const n = flagged(p).length;
  return n ? `<span class="flag-badge" title="${n} question(s) flagged to discuss">⚑ ${n}</span>` : '';
}

function paperLabel(p) {
  return esc([p.number, p.title].filter(Boolean).join(' — '));
}

/* ================================================================
   VIEWS
   ================================================================ */
function viewDashboard() {
  const t = today(), wk = termWeek(t), ns = +state.settings.numWeeks;
  const todayOcc = occurrences(t, t);
  const tmrw = addDays(t, 1), tmrwOcc = occurrences(tmrw, tmrw);
  const sups = occurrences(t, addDays(t, 14)).filter(o => o.e.type === 'supervision'
    && !(o.date === iso(t) && toMin(o.e.end) <= nowMin()));
  const papers = state.papers.filter(p => p.status !== 'done' && p.status !== 'submitted').sort(byDue).slice(0, 8);
  const tasks = state.tasks.filter(x => !x.done).sort(byDue).slice(0, 8);

  let termText;
  if (wk < 1) termText = `Term starts in ${diffDays(t, parseISO(state.settings.week1Start))} days`;
  else if (wk > ns) termText = 'Full term has finished — enjoy the break!';
  else termText = `Week ${wk} of ${ns}`;
  const pct = Math.max(0, Math.min(100, (diffDays(parseISO(state.settings.week1Start), t) + 1) / (ns * 7) * 100));
  const dots = Array.from({ length: ns }, (_, i) => `<span class="${i + 1 < wk ? 'past' : i + 1 === wk ? 'now' : ''}">${i + 1}</span>`).join('');

  const noEvents = state.events.length === 0;
  return `
  <div class="panel term-banner">
    <div><h1>${esc(DAYS_LONG[t.getDay()])} ${t.getDate()} ${MONTHS[t.getMonth()]}</h1>
      <div class="muted">${esc(state.settings.termName)} · ${termText}</div></div>
    <div class="term-progress"><div class="bar"><span style="width:${pct}%"></span></div><div class="week-dots">${dots}</div></div>
  </div>
  ${noEvents ? `<div class="panel" style="margin-bottom:16px"><strong>Your timetable is empty.</strong>
    <span class="muted">Add events in the <a href="#timetable">Timetable</a> tab (click any slot), or import your lecture/lab and supervision spreadsheets.</span></div>` : ''}
  <div class="grid-cards">
    <section class="panel">
      <div class="section-head"><h2>Today</h2><span class="spacer"></span><a href="#timetable" class="small">Full week →</a></div>
      ${todayOcc.length ? `<ul class="ev-list">${todayOcc.map(o => evRow(o)).join('')}</ul>` : '<div class="empty">Nothing timetabled today.</div>'}
      <h2 style="margin-top:16px">Tomorrow <span class="muted small">${fmtDate(tmrw)}</span></h2>
      ${tmrwOcc.length ? `<ul class="ev-list">${tmrwOcc.map(o => evRow(o)).join('')}</ul>` : '<div class="empty">Nothing timetabled.</div>'}
    </section>
    <section class="panel">
      <div class="section-head"><h2>Upcoming supervisions</h2><span class="muted small">next 14 days</span><span class="spacer"></span><a href="#supervisions" class="small">All →</a></div>
      ${sups.length ? `<ul class="ev-list">${sups.map(o => {
        const linked = state.papers.filter(p => p.due && p.due.startsWith(o.date) && (!o.e.courseId || p.courseId === o.e.courseId));
        const nT = linkedTasks('sup', occKey(o)).filter(x => !x.done).length;
        return evRow(o, { showDate: true, extra: linked.map(p => `<div class="small"><span class="status-${p.status}">●</span> ${paperLabel(p)} <span class="muted">(${p.done || 0}/${p.total || '?'})</span></div>${flagList(p)}`).join('')
          + (nT ? `<div class="small">☐ ${nT} task${nT > 1 ? 's' : ''}</div>` : '') + (state.supNotes[occKey(o)] ? '<div class="small muted">📝 has notes</div>' : '') });
      }).join('')}</ul>` : '<div class="empty">No supervisions in the next two weeks.</div>'}
    </section>
    <section class="panel">
      <div class="section-head"><h2>Examples papers to do</h2><span class="spacer"></span>${extLink(PAPERS_URL, 'Moodle ↗', 'small')}<a href="#papers" class="small">All papers →</a></div>
      ${(() => { const r = releasesBetween(t, addDays(t, 6)); return r.length ? `<h3 class="sub">Papers out in the next 7 days</h3><div class="rel-list">${r.map(x => relChip(x, true)).join('')}</div><h3 class="sub">To do</h3>` : ''; })()}
      ${papers.length ? `<ul class="ev-list">${papers.map(p => {
        const c = course(p.courseId);
        return `<li class="static"><div class="ev-bar" style="background:${c.color}"></div>
          <div class="ev-main"><div class="ev-title row" style="gap:8px">${paperLabel(p)}<span class="spacer"></span>${pdfBtn(p)}<button type="button" class="btn sm edit-btn" data-action="edit-paper" data-id="${p.id}" aria-label="Edit ${paperLabel(p)}">✎ Edit</button></div>
          <div class="ev-meta">${esc(c.name)} · due ${fmtDue(p.due)} ${relDue(p.due)}</div>
          ${qStrip(p)}
          </div></li>`;
      }).join('')}</ul>` : '<div class="empty">All caught up 🎉</div>'}
    </section>
    ${dashLabs()}
    <section class="panel">
      <div class="section-head"><h2>Tasks</h2><span class="spacer"></span><a href="#tasks" class="small">Planner →</a></div>
      ${tasks.length ? tasks.map(taskRow).join('') : '<div class="empty">No open tasks.</div>'}
    </section>
  </div>`;
}

const isNarrow = () => window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
const ttView = () => ui.ttView || (isNarrow() ? 'day' : 'week');

function viewTimetable() {
  const s = state.settings;
  if (ui.week == null) ui.week = weekContaining(today());
  const dayMode = ttView() === 'day';
  if (dayMode && !ui.day) ui.day = iso(today());
  const start = dayMode ? parseISO(ui.day) : windowStart(ui.week);
  const end = dayMode ? start : addDays(start, 6);
  const nDays = dayMode ? 1 : 7;
  const occ = occurrences(start, end);
  let h0 = +s.dayStart, h1 = +s.dayEnd;
  for (const o of occ) {
    h0 = Math.min(h0, Math.floor(toMin(o.e.start) / 60));
    h1 = Math.max(h1, Math.ceil(toMin(o.e.end) / 60));
  }
  const hours = h1 - h0;
  const todayStr = iso(today());
  const rels = releasesBetween(start, end);
  const relRows = Math.max(0, ...Array.from({ length: nDays }, (_, i) => rels.filter(r => r.date === iso(addDays(start, i))).length));
  const relH = relRows ? relRows * 22 + 8 : 0;

  let cols = '';
  for (let i = 0; i < nDays; i++) {
    const d = addDays(start, i), ds = iso(d);
    const dayOcc = occ.filter(o => o.date === ds);
    const laid = layout(dayOcc);
    const evs = laid.map(({ o, s: sm, en, col, n }) => {
      const c = course(o.e.courseId);
      const top = (sm - h0 * 60) / 60 * HOUR_PX;
      const h = Math.max((en - sm) / 60 * HOUR_PX - 2, 18);
      const w = 100 / n;
      // how many text lines fit: give the title up to 3, then time/location, then person
      const avail = Math.max(1, Math.floor((h - 5) / LINE_PX));
      const meta = [`${o.e.start}–${o.e.end}`, o.e.location, o.e.who].filter(Boolean);
      const metaRoom = avail <= 3 ? 1 : avail <= 5 ? 2 : 3;
      const titleLines = Math.max(1, Math.min(3, avail - Math.min(meta.length, metaRoom)));
      const metaShown = meta.slice(0, Math.max(0, avail - titleLines));
      const tip = [o.e.title, `${o.e.start}–${o.e.end}`, o.e.location, o.e.who, course(o.e.courseId).name].filter(Boolean).join('\n');
      const labSt = o.e.type === 'lab' ? labInfo(o) : null;
      const isDone = o.e.done || (labSt && labSt.cls === 'ok');
      return `<div class="tt-ev ${o.e.type} ${isDone ? 'is-done' : ''} ${labSt && labSt.cls === 'warn' ? 'needs-follow' : ''} ${labSt && labSt.cls === 'live' ? 'is-live' : ''} ${labSt && labSt.preDue ? 'needs-pre' : ''}" ${evAttr(o)} style="--c:${c.color};top:${top}px;height:${h}px;left:calc(${col * w}% + 2px);width:calc(${w}% - 4px)"
        title="${esc(tip)}">
        ${o.e.link ? extLink(o.e.link, '↗', 'tt-link') : ''}
        <div class="t" style="-webkit-line-clamp:${titleLines}">${isDone && labSt ? '✓ ' : labSt && labSt.cls === 'warn' ? '✎ ' : ''}${esc(o.e.title)}</div>
        ${labSt && labSt.cls === 'live' ? '<div class="live-tag">● In progress</div>' : ''}${labSt && labSt.preDue && labSt.cls !== 'live' ? '<div class="pre-tag">📋 Pre-work</div>' : ''}
        ${metaShown.map(x => `<div class="m">${esc(x)}</div>`).join('')}
      </div>`;
    }).join('');
    const nowLine = ds === todayStr && nowMin() >= h0 * 60 && nowMin() <= h1 * 60
      ? `<div class="tt-now" style="top:${(nowMin() - h0 * 60) / 60 * HOUR_PX}px"></div>` : '';
    const wk = termWeek(d);
    cols += `<div class="tt-day ${ds === todayStr ? 'today' : ''}">
      <div class="tt-head"><div class="d">${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}</div><div class="s">Week ${wk}</div></div>
      ${relH ? `<div class="tt-allday" style="height:${relH}px">${rels.filter(r => r.date === ds).map(r => relChip(r)).join('')}</div>` : ''}
      <div class="tt-body" data-date="${ds}" data-h0="${h0}" style="height:${hours * HOUR_PX}px">${evs}${nowLine}</div>
    </div>`;
  }
  const times = (relH ? `<div class="tt-allday tt-allday-label" style="height:${relH}px">Papers</div>` : '') + '<div class="tt-gap"></div>'
    + Array.from({ length: hours }, (_, i) => `<div class="tt-time">${pad(h0 + i)}:00</div>`).join('')
    + `<div class="tt-time end">${pad(h1)}:00</div>`;
  const legend = state.courses.map(c => `<span><i class="dot" style="background:${c.color}"></i>${esc(c.name)}</span>`).join('');

  const viewSwitch = `<div class="seg-group" role="group" aria-label="Timetable view">
      <button class="seg ${dayMode ? '' : 'on ok'}" data-action="tt-view" data-v="week" aria-pressed="${!dayMode}">Week</button>
      <button class="seg ${dayMode ? 'on ok' : ''}" data-action="tt-view" data-v="day" aria-pressed="${dayMode}">Day</button></div>`;
  const nav = dayMode ? `
    <button class="btn icon" data-action="day-prev" aria-label="Previous day">‹</button>
    <div class="wk day-label">${DAYS[start.getDay()]} ${start.getDate()} ${MONTHS[start.getMonth()]}<div class="small muted">Week ${termWeek(start)}</div></div>
    <button class="btn icon" data-action="day-next" aria-label="Next day">›</button>
    <button class="btn" data-action="day-today">Today</button>` : `
    <button class="btn icon" data-action="week-prev" aria-label="Previous week">‹</button>
    <div class="wk">${weekLabel(ui.week)}</div>
    <button class="btn icon" data-action="week-next" aria-label="Next week">›</button>
    <button class="btn" data-action="week-today">This week</button>
    <span class="muted hide-narrow">${fmtDate(start)} – ${fmtDate(end)}</span>`;

  return `
  <div class="tt-toolbar">${nav}
    <span class="spacer"></span>
    ${viewSwitch}
    <button class="btn primary" data-action="add-event">+ Add<span class="hide-narrow"> event</span></button>
  </div>
  <div class="legend" style="margin-bottom:6px">${legend}</div>
  <p class="muted small hide-narrow" style="margin:0 0 10px">Click an empty slot to add an event; click an event to open it. ⏰ boxes are task deadlines (any task with a time).</p>
  <div class="tt-wrap ${dayMode ? 'day-mode' : ''}" style="--hour:${HOUR_PX}px">
    <div class="tt" style="grid-template-columns: 54px repeat(${nDays}, minmax(${dayMode ? 0 : 128}px, 1fr)); min-width: ${dayMode ? 0 : 950}px">
      <div class="tt-times"><div class="tt-head"></div>${times}</div>
      ${cols}
    </div>
  </div>
  `;
}

/** Column layout for overlapping events within a day. */
function layout(list) {
  const res = [];
  let cluster = [], clusterEnd = -1, cols = [];
  const flush = () => {
    const n = Math.max(...cluster.map(c => c.col)) + 1;
    cluster.forEach(c => { c.n = n; });
    cluster = []; cols = [];
  };
  for (const o of list) {
    const s = toMin(o.e.start), en = Math.max(toMin(o.e.end), s + 15);
    if (cluster.length && s >= clusterEnd) flush();
    let c = cols.findIndex(e => e <= s);
    if (c < 0) { c = cols.length; cols.push(en); } else cols[c] = en;
    const item = { o, s, en, col: c, n: 1 };
    cluster.push(item); res.push(item);
    clusterEnd = Math.max(clusterEnd, en);
  }
  if (cluster.length) flush();
  return res;
}

function viewSupervisions() {
  const t = today();
  const s = state.settings;
  const from = ui.showPast ? windowStart(1) : t;
  const to = addDays(windowStart(+s.numWeeks), 6);
  const sups = occurrences(from, to).filter(o => o.e.type === 'supervision');
  const supCards = sups.map(o => {
    const c = course(o.e.courseId);
    const key = occKey(o);
    const past = o.d < t;
    const linked = papersForSup(o);
    const tasks = linkedTasks('sup', key), openT = tasks.filter(x => !x.done);
    const note = state.supNotes[key];
    return `<div class="sup-card ${past ? 'past' : ''}" style="--c:${c.color}" data-sup="${esc(key)}">
      <div class="row"><span class="when">${fmtDate(o.d)}, ${esc(o.e.start)}</span><span class="spacer"></span><span class="muted small">Week ${termWeek(o.d)}</span></div>
      <div>${esc(o.e.title)}</div>
      <div class="muted small">${[c.name, o.e.location, o.e.who].filter(Boolean).map(esc).join(' · ')}</div>
      ${linked.map(p => `<div class="sup-paper"><div class="small row" style="gap:6px"><span><strong>${paperLabel(p)}</strong> <span class="status-${p.status}">· ${STATUS[p.status]}</span></span><span class="spacer"></span>${pdfBtn(p)}<button type="button" class="btn sm edit-btn" data-action="edit-paper" data-id="${p.id}" aria-label="Edit ${paperLabel(p)}">✎ Edit</button></div>${qStrip(p)}${flagList(p)}</div>`).join('')}
      ${note ? `<div class="note-preview small">📝 ${esc(note.length > 90 ? note.slice(0, 90) + '…' : note)}</div>` : ''}
      ${tasks.length ? `<div class="small">${openT.length ? `☐ ${openT.length} open task${openT.length > 1 ? 's' : ''}` : '✓ tasks done'}</div>` : ''}
      <div class="card-hint small">Open for papers, notes &amp; tasks →</div>
    </div>`;
  }).join('');

  return `
  <section>
    <div class="section-head"><h2>Supervisions</h2>
      <label class="small muted"><input type="checkbox" data-action="toggle-past" ${ui.showPast ? 'checked' : ''}> show past</label>
      <span class="spacer"></span>
      <button class="btn" data-action="add-supervision">+ Add supervision</button></div>
    ${sups.length ? `<div class="sup-list">${supCards}</div>` : '<div class="panel empty">No supervisions for the rest of term yet. Add them here, or as “Supervision” events in the timetable.</div>'}
  </section>`;
}

function viewPapers() {
  let papers = state.papers.slice().sort(byDue);
  if (ui.paperFilter === 'outstanding') papers = papers.filter(p => p.status !== 'done' && p.status !== 'submitted');
  else if (ui.paperFilter === 'progress') papers = papers.filter(p => p.status === 'progress');
  if (ui.paperCourse) papers = papers.filter(p => p.courseId === ui.paperCourse);
  const rows = papers.map(p => {
    const c = course(p.courseId);
    const done = p.status === 'done' || p.status === 'submitted';
    return `<tr class="${done ? 'done' : ''}">
      <td><span class="row" style="gap:6px"><i class="dot" style="background:${c.color}"></i>${esc(c.name) || '<span class="muted">—</span>'}</span></td>
      <td><strong>${esc(p.number)}</strong>${p.title ? `<div class="small muted">${esc(p.title)}</div>` : ''}</td>
      <td>${releaseCell(p)}</td>
      <td>${fmtDue(p.due)}<div class="small">${relDue(p.due, done)}</div></td>
      <td>${qStrip(p)}${(() => { const n = linkedTasks('paper', p.id).filter(x => !x.done).length; return n ? `<div class="small muted">☐ ${n} task${n > 1 ? 's' : ''}</div>` : ''; })()}</td>
      <td><select data-action="paper-status" data-id="${p.id}" class="status-${p.status}">
        ${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${k === p.status ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
      <td>${pdfBtn(p)}<button type="button" class="btn sm edit-btn" data-action="edit-paper" data-id="${p.id}" aria-label="Edit ${paperLabel(p)}">✎ Edit</button></td>
    </tr>`;
  }).join('');

  return `
  <section class="panel">
    <div class="section-head"><h2>Examples papers</h2>
      <select data-action="paper-filter"><option value="outstanding"${ui.paperFilter === 'outstanding' ? ' selected' : ''}>Outstanding</option><option value="progress"${ui.paperFilter === 'progress' ? ' selected' : ''}>In progress</option><option value="all"${ui.paperFilter === 'all' ? ' selected' : ''}>All papers</option></select>
      <select data-action="paper-course"><option value="">All courses</option>${state.courses.map(c => `<option value="${c.id}"${c.id === ui.paperCourse ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <span class="spacer"></span>
      ${extLink(PAPERS_URL, 'Examples papers on Moodle ↗', 'btn')}
      <button class="btn primary" data-action="add-paper">+ Add paper</button></div>
    <p class="small muted" style="margin-top:0">Tap a number to tick that question · right-click, ⌥-click or press-and-hold to flag one you struggled with · use ✎ Edit for question count, notes, flags &amp; tasks.</p>
    ${rows ? `<div class="table-wrap"><table><thead><tr><th>Course</th><th>Paper</th><th>Released</th><th>Due</th><th>Progress</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="empty">No examples papers here yet.</div>'}
  </section>`;
}

function taskRow(t) {
  const c = course(t.courseId);
  return `<div class="task ${t.done ? 'done' : ''} prio-${t.priority || 'low'}">
    <input type="checkbox" data-action="task-toggle" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="Done">
    <span class="title" data-task="${t.id}">${esc(t.title)}</span>
    ${t.link ? `<span class="chip link-chip" data-link-kind="${t.link.kind}" data-link-key="${esc(t.link.key)}" title="Open">${esc(linkLabel(t))}</span>` : ''}
    ${t.courseId ? `<span class="row small muted" style="gap:4px"><i class="dot" style="background:${c.color}"></i>${esc(c.name)}</span>` : ''}
    <span class="small" style="min-width:110px;text-align:right">${t.due ? fmtDate(parseISO(t.due)) + (t.time ? ', ' + esc(t.time) : '') + ' ' + relDue(t.due, t.done) : ''}</span>
  </div>`;
}

function viewTasks() {
  const t = today(), tStr = iso(t);
  const wkEnd = iso(addDays(t, 7));
  const open = state.tasks.filter(x => !x.done).sort(byDue);
  const groups = [
    ['Overdue', open.filter(x => x.due && x.due < tStr)],
    ['Today', open.filter(x => x.due === tStr)],
    ['Next 7 days', open.filter(x => x.due && x.due > tStr && x.due <= wkEnd)],
    ['Later', open.filter(x => x.due && x.due > wkEnd)],
    ['No date', open.filter(x => !x.due)],
  ];
  const done = state.tasks.filter(x => x.done);
  return `
  <div class="panel">
    <h2>Planner</h2>
    <form class="task-add" id="taskAdd">
      <input type="text" name="title" placeholder="Add a task… e.g. Write up Lab 2, read Materials notes" required>
      <input type="date" name="due" value="${tStr}">
      <input type="time" name="time" title="Optional: add a time to show it on the calendar">
      <select name="courseId">${courseOptions().map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
      <select name="priority">${Object.entries(PRIORITY).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <button class="btn primary">Add</button>
    </form>
    ${groups.filter(g => g[1].length).map(([name, items]) => `<div class="task-group"><h3>${name} (${items.length})</h3>${items.map(taskRow).join('')}</div>`).join('')
      || '<div class="empty">No open tasks — add one above.</div>'}
    ${done.length ? `<div class="task-group"><h3><a href="#" data-action="toggle-done-tasks">${ui.showDoneTasks ? 'Hide' : 'Show'} completed (${done.length})</a>
      ${ui.showDoneTasks ? ' · <a href="#" data-action="clear-done-tasks">clear completed</a>' : ''}</h3>
      ${ui.showDoneTasks ? done.map(taskRow).join('') : ''}</div>` : ''}
  </div>`;
}

function allLabs() {
  const s = state.settings;
  return occurrences(windowStart(0), addDays(windowStart(+s.numWeeks + 1), 6)).filter(o => o.e.type === 'lab').map(o => ({ o, ...labInfo(o) }));
}

function dashLabs() {
  const labs = allLabs();
  const unmarked = labs.filter(l => l.cls === 'todo');
  const live = labs.find(l => l.cls === 'live');
  const next = labs.find(l => l.cls === 'upcoming');
  const follow = state.tasks.filter(t => t.link && t.link.kind === 'lab' && !t.done).sort(byDue).slice(0, 5);
  return `<section class="panel">
    <div class="section-head"><h2>Labs</h2><span class="spacer"></span><a href="#labs" class="small">All labs →</a></div>
    ${labs.some(l => l.preDue) ? `<h3 class="sub">Pre-work to do</h3>${labs.filter(l => l.preDue).map(labRow).join('')}` : ''}
    ${follow.length ? `<h3 class="sub">Write-ups / follow-up due</h3>${follow.map(taskRow).join('')}` : ''}
    ${unmarked.length ? `<h3 class="sub">Not marked yet (${unmarked.length})</h3>${unmarked.slice(-4).reverse().map(labRow).join('')}` : ''}
    ${live ? `<h3 class="sub">Happening now</h3>${labRow(live)}` : ''}
    ${next ? `<h3 class="sub">Next lab</h3>${labRow(next)}` : ''}
    ${!follow.length && !unmarked.length && !next && !live ? '<div class="empty">No labs.</div>' : ''}
  </section>`;
}

function labRow(l) {
  const { o } = l;
  return `<div class="lab-row ${l.cls}" data-lab="${esc(l.key)}">
    <div class="lab-when"><strong>${fmtDate(o.d)}</strong><div class="small muted">${esc(o.e.start)}–${esc(o.e.end)}</div></div>
    <div class="lab-main"><div class="ev-title">${esc(o.e.title)}</div>
      <div class="small muted">${esc(o.e.location || '')}${o.e.link ? ' · ' + extLink(o.e.link) : ''}${l.rec.notes ? ' · 📝 notes' : ''}${l.tasks.length ? ` · ${l.tasks.length - l.open.length}/${l.tasks.length} tasks done` : ''}</div></div>
    ${l.preDue ? '<span class="lab-pill warn">📋 Pre-work to do</span>' : l.rec.pre === 'done' && !l.isPast ? '<span class="lab-pill ok">✓ Pre-work done</span>' : ''}
    <span class="lab-pill ${l.cls}">${esc(l.label)}</span>
    ${l.started || l.rec.status ? labButtons(l.key, l.rec.status) : labPreButtons(l.key, l.rec.pre)}
  </div>`;
}

function viewLabs() {
  const labs = allLabs();
  const past = labs.filter(l => l.isPast || l.rec.status);
  const n = c => labs.filter(l => l.cls === c).length;
  const filters = { active: 'Upcoming & needs attention', all: 'All sessions', todo: 'Needs attention', upcoming: 'Upcoming', prework: 'Pre-work to do', followup: 'Write-ups / follow-up', done: 'Completed' };
  const shown = labs.filter(l => ui.labFilter === 'all' ? true
    : ui.labFilter === 'active' ? ((!l.isPast && l.cls !== 'ok') || l.cls === 'todo' || l.cls === 'warn')
    : ui.labFilter === 'todo' ? (l.cls === 'todo' || l.cls === 'warn' || l.preDue)
    : ui.labFilter === 'prework' ? l.preDue
    : ui.labFilter === 'upcoming' ? (l.cls === 'upcoming' || l.cls === 'live')
    : ui.labFilter === 'followup' ? l.rec.status === 'followup'
    : l.cls === 'ok');
  const weeks = [...new Set(shown.map(l => termWeek(l.o.d)))];
  const follow = state.tasks.filter(t => t.link && t.link.kind === 'lab' && !t.done).sort(byDue);
  return `
  <div class="stat-row">
    <div class="stat"><div class="v">${n('ok')}<span class="muted small"> / ${past.length}</span></div><div class="l">Completed (of past labs)</div></div>
    <div class="stat warn"><div class="v">${n('warn')}</div><div class="l">Write-up / follow-up pending</div></div>
    <div class="stat todo"><div class="v">${n('todo')}</div><div class="l">Past labs not marked</div></div>
    <div class="stat"><div class="v">${n('upcoming') + n('live')}</div><div class="l">Upcoming${labs.some(l => l.preDue) ? ` <span class="lab-pill warn">${labs.filter(l => l.preDue).length} pre-work</span>` : ''}${n('live') ? ` <span class="lab-pill live">${n('live')} in progress</span>` : ''}</div></div>
  </div>
  <div class="grid-cards labs-grid">
    <section class="panel">
      <div class="section-head"><h2>Lab sessions</h2>
        <select data-action="lab-filter">${Object.entries(filters).map(([k, v]) => `<option value="${k}"${ui.labFilter === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <span class="spacer"></span><span class="small muted">Click a lab for notes &amp; deadlines</span></div>
      ${weeks.length ? weeks.map(w => `<div class="task-group"><h3>Week ${w}</h3>${shown.filter(l => termWeek(l.o.d) === w).map(labRow).join('')}</div>`).join('')
        : '<div class="empty">No lab sessions match.</div>'}
    </section>
    <section class="panel">
      <h2>Write-ups &amp; follow-up due</h2>
      ${follow.length ? follow.map(taskRow).join('') : '<div class="empty">Nothing outstanding. Mark a lab “Write-up / follow-up” to add a deadline.</div>'}
    </section>
  </div>`;
}

function viewSettings() {
  const s = state.settings;
  return `
  <div class="grid-cards">
    <section class="panel">
      <h2>Term</h2>
      <div class="form-grid" id="termForm">
        <label class="f">Term name<input type="text" name="termName" value="${esc(s.termName)}"></label>
        <label class="f">Thursday of Week 1<input type="date" name="week1Start" value="${esc(s.week1Start)}"></label>
        <label class="f">Number of weeks<input type="number" name="numWeeks" min="1" max="12" value="${s.numWeeks}"></label>
        <label class="f">Timetable week starts on<select name="weekStartDay">
          <option value="4"${+s.weekStartDay === 4 ? ' selected' : ''}>Thursday (Cambridge weeks)</option>
          <option value="1"${+s.weekStartDay === 1 ? ' selected' : ''}>Monday</option></select></label>
        <label class="f">Day starts (hour)<input type="number" name="dayStart" min="0" max="23" value="${s.dayStart}"></label>
        <label class="f">Day ends (hour)<input type="number" name="dayEnd" min="1" max="24" value="${s.dayEnd}"></label>
      </div>
      <p class="muted small">Cambridge term weeks run Thursday–Wednesday. Michaelmas 2026 full term is Tue 6 Oct – Fri 4 Dec, so Week 1 starts Thu 8 Oct.</p>
    </section>
    <section class="panel">
      <div class="section-head"><h2>Courses</h2><span class="spacer"></span><button class="btn sm" data-action="add-course">+ Course</button></div>
      <div id="courseList">${state.courses.map(c => `<div class="course-row">
        <input type="color" value="${c.color}" data-course-color="${c.id}">
        <input type="text" value="${esc(c.name)}" data-course-name="${c.id}">
        <button class="btn sm danger" data-action="del-course" data-id="${c.id}">✕</button></div>`).join('')}</div>
    </section>
    <section class="panel">
      <h2>Data</h2>
      <p class="muted small">${backend === 'github'
        ? `Saved automatically to your <strong>private</strong> repo <code>${esc(gh.owner)}/${esc(gh.repo)}</code> (every save is kept in its history). A copy is kept on this device for offline use.`
        : 'Local mode: saved to <code>data/planner.json</code> on this Mac.'}</p>
      ${backend === 'github' ? '<div class="row" style="margin-bottom:12px"><button class="btn" data-action="sync-now">Sync now</button><button class="btn danger" data-action="disconnect">Disconnect this device</button></div>' : ''}
      <div class="row">
        <button class="btn" data-action="export">Export backup (.json)</button>
        <label class="btn">Import backup<input type="file" accept="application/json,.json" id="importFile" hidden></label>
        <button class="btn" data-action="export-ics">Export timetable (.ics)</button>
      </div>
      <p class="muted small">The .ics file can be imported into Apple Calendar / Google Calendar.</p>
      <div class="row" style="margin-top:16px"><button class="btn danger" data-action="reset">Reset everything</button></div>
    </section>
  </div>`;
}

/* ================================================================
   RENDER + EVENTS
   ================================================================ */

/* ---------------- library: lecture handouts & data books ---------------- */
// handout folder name -> which timetabled lectures it belongs to
const LECTURE_GROUPS = [
  ['Circuit Analysis', /analysis of circuits/i, 'Analysis of Circuits and Devices'],
  ['PPE', /physical principles/i, 'Physical Principles of Electronics'],
  ['Digital Circuits', /digital/i],
  ['Dimensional Analysis', /dimensional analysis/i],
  ['Materials', /materials/i],
  ['Maths', /mathematical methods|\bmaths\b/i, 'Mathematical Methods'],
  ['Mechanical Vibrations', /vibration/i],
  ['Mechanics', /\bmechanics\b/i],
  ['Structures', /structures/i],
  ['Thermofluids', /thermo/i],
];
const libDocs = (kind, group) => (state.library || []).filter(d => d.kind === kind && (group == null || d.group === group));
const docRef = d => ({ path: d.path, sha: d.sha, title: d.title, sub: d.kind === 'databook' ? 'Data book' : `${groupName(d.group)} · lecture handout`, fileName: d.name });
const fmtSize = n => n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
const groupRule = g => LECTURE_GROUPS.find(r => r[0].toLowerCase() === String(g).toLowerCase());
const groupName = g => { const r = groupRule(g); return r && r[2] ? `${r[2]}` : g; };
const fileTitle = name => name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

function lectureGroups() {
  const s = state.settings;
  const lectures = state.events.filter(e => e.type === 'lecture');
  const names = [...new Set([...(state.handoutGroups || []), ...libDocs('handout').map(d => d.group)])];
  const groups = names.map(g => {
    const r = groupRule(g);
    return { g, events: lectures.filter(e => r ? r[1].test(e.title) : e.title === g) };
  });
  // timetabled lectures with no handout folder get their own card
  const used = new Set(groups.flatMap(x => x.events));
  for (const e of lectures) {
    if (used.has(e)) continue;
    let grp = groups.find(x => x.g === e.title);
    if (!grp) groups.push(grp = { g: e.title, events: [] });
    grp.events.push(e);
  }
  const from = today(), to = addDays(windowStart(+s.numWeeks + 1), 6), nowM = nowMin(), t = iso(today());
  const occ = occurrences(from, to).filter(o => o.e.type === 'lecture');
  for (const x of groups) {
    const mine = occ.filter(o => x.events.includes(o.e) && (o.date > t || toMin(o.e.end) > nowM));
    x.next = mine[0] || null;
    x.left = mine.length;
    x.docs = libDocs('handout', x.g);
    x.courseId = (x.events[0] && x.events[0].courseId) || '';
    x.who = [...new Set(x.events.map(e => e.who).filter(Boolean))].join(', ');
    x.link = (x.events.find(e => e.link) || {}).link || '';
    x.code = ((x.events[0] && x.events[0].title.match(/^\d\w{1,3}\b/)) || [''])[0];
  }
  return groups.sort((a, b) => (!!b.next - !!a.next) || (a.next && b.next ? (a.next.date + a.next.e.start).localeCompare(b.next.date + b.next.e.start) : 0)
    || (b.docs.length - a.docs.length) || a.g.localeCompare(b.g));
}

function docRow(d) {
  return `<div class="doc-row" data-action="view-doc" data-path="${esc(d.path)}" role="button" tabindex="0" title="${esc(d.name || d.title)}">
    <span class="doc-ico" aria-hidden="true">${d.kind === 'databook' ? '📘' : '📄'}</span>
    <span class="doc-title">${esc(d.title)}</span>
    <span class="doc-size small muted">${d.size ? fmtSize(d.size) : ''}</span>
    <button type="button" class="icon-btn" data-action="doc-rename" data-path="${esc(d.path)}" aria-label="Rename ${esc(d.title)}" title="Rename">✎</button>
    <button type="button" class="icon-btn" data-action="doc-remove" data-path="${esc(d.path)}" aria-label="Remove ${esc(d.title)}" title="Remove">✕</button>
  </div>`;
}
const uploadBtn = (kind, group, label) => `<label class="btn sm upload-btn">${label}<input type="file" accept="application/pdf,.pdf" multiple hidden data-lib-upload="${kind}" data-group="${esc(group)}"></label>`;

function viewLectures() {
  const groups = lectureGroups();
  const card = x => {
    const c = course(x.courseId);
    const n = x.next;
    return `<section class="panel lec-card" style="--c:${c.color || 'var(--gold)'}">
      <div class="lec-head"><div><div class="small muted">${esc(x.code || c.name || '')}</div><h2>${esc(groupName(x.g))}</h2></div>
        <span class="spacer"></span>${x.link ? extLink(x.link, 'Moodle ↗', 'btn sm') : ''}</div>
      <div class="lec-meta small">
        ${x.who ? `<span>👤 ${esc(x.who)}</span>` : ''}
        ${n ? `<span>⏭ Next: <strong>${n.date === iso(today()) ? 'Today' : fmtDate(n.d)} ${esc(n.e.start)}</strong>${n.e.location ? ' · ' + esc(n.e.location) : ''}</span>
              <span class="muted">${x.left} lecture${x.left === 1 ? '' : 's'} left this term</span>`
          : `<span class="muted">${x.events.length ? 'No more lectures this term' : 'Not lectured this term'}</span>`}
      </div>
      <div class="doc-list">${x.docs.length ? x.docs.map(docRow).join('') : '<div class="empty small">No handouts yet.</div>'}</div>
      <div class="row">${uploadBtn('handout', x.g, '📎 Add handout')}</div>
    </section>`;
  };
  const active = groups.filter(x => x.next || x.docs.length);
  const later = groups.filter(x => !x.next && !x.docs.length);
  return `
  <div class="section-head"><h2>Lectures</h2><span class="spacer"></span>
    <span class="small muted">${libDocs('handout').length} handouts · tap one to open it</span></div>
  <div class="grid-cards">${active.map(card).join('')}</div>
  ${later.length ? `<details class="panel later"><summary><strong>Other courses</strong> <span class="small muted">— not lectured this term / no handouts yet (${later.length})</span></summary>
    <div class="grid-cards" style="margin-top:14px">${later.map(card).join('')}</div></details>` : ''}`;
}

function viewDatabooks() {
  const docs = libDocs('databook');
  return `<section class="panel">
    <div class="section-head"><h2>Data books</h2><span class="spacer"></span>${uploadBtn('databook', 'Data books', '📎 Add data book')}</div>
    <div class="doc-list books">${docs.length ? docs.map(docRow).join('') : '<div class="empty">No data books yet. Add them here, or put them in your Data Books folder and sync.</div>'}</div>
  </section>`;
}

async function libUpload(input) {
  const kind = input.dataset.libUpload, group = input.dataset.group;
  const files = [...input.files];
  input.value = '';
  if (!files.length) return;
  const slug = s => s.toLowerCase().replace(/\.pdf$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'file';
  state.library = state.library || [];
  for (const f of files) {
    const path = `library/${kind}s/${kind === 'handout' ? slug(group) + '/' : ''}${slug(f.name)}.pdf`;
    const existing = state.library.find(d => d.path === path);
    setStatus(`Uploading ${f.name}…`);
    try {
      const sha = await uploadFile(path, f, `Add ${kind}: ${f.name}`, existing && existing.sha);
      if (existing) Object.assign(existing, { sha, name: f.name, size: f.size });
      else state.library.push({ id: path, kind, group, title: fileTitle(f.name), path, sha, name: f.name, size: f.size, src: 'app' });
      save(); render();
    } catch (err) { alert(`Couldn't upload ${f.name}: ${err.message}`); }
  }
  setStatus('Synced ✓');
}
document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.libUpload) libUpload(e.target); });
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.doc-row')) { e.preventDefault(); e.target.click(); }
});

const VIEWS = { dashboard: viewDashboard, timetable: viewTimetable, supervisions: viewSupervisions, papers: viewPapers, labs: viewLabs, lectures: viewLectures, databooks: viewDatabooks, tasks: viewTasks, settings: viewSettings };
const currentTab = () => { const h = location.hash.slice(1); return VIEWS[h] ? h : 'dashboard'; };

function render() {
  const tab = currentTab();
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  const wk = termWeek(today());
  $('#termLabel').textContent = `${state.settings.termName} · ${wk >= 1 && wk <= state.settings.numWeeks ? 'Week ' + wk : weekLabel(wk)}`;
  if (backend === 'setup') { $('#view').innerHTML = viewConnect(); return; }
  const keepScroll = $('.tt-wrap') ? $('.tt-wrap').scrollTop : null;
  $('#view').innerHTML = VIEWS[tab]();
  if (tab === 'timetable') fitTimetable(keepScroll);
}

/** Size the timetable to the window so the whole day (top and bottom) is reachable by scrolling inside it. */
function fitTimetable(scrollTop) {
  const wrap = $('.tt-wrap');
  if (!wrap) return;
  const top = wrap.getBoundingClientRect().top + window.scrollY;
  wrap.style.maxHeight = Math.max(380, window.innerHeight - top - 24) + 'px';
  if (scrollTop != null) wrap.scrollTop = scrollTop;
}
let wasNarrow = null;
window.addEventListener('resize', () => {
  if (currentTab() !== 'timetable') return;
  const n = isNarrow();
  if (wasNarrow !== null && n !== wasNarrow && !ui.ttView) render(); else fitTimetable();
  wasNarrow = n;
});

function shiftDay(n) {
  const d = addDays(parseISO(ui.day || iso(today())), n);
  ui.day = iso(d); ui.week = weekContaining(d);
  render(); animateView();
}
// swipe left/right on the day timetable to change day
let touchStart = null;
document.addEventListener('touchstart', e => {
  const t = e.touches[0];
  touchStart = e.target.closest('.tt-wrap.day-mode') ? { x: t.clientX, y: t.clientY } : null;
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!touchStart) return;
  const t = e.changedTouches[0], dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 70 && Math.abs(dy) < 45) shiftDay(dx < 0 ? 1 : -1);
}, { passive: true });

// press-and-hold a question box to flag it (phones have no right-click)
let holdTimer = null, holdBtn = null, holdPos = null, lastTouch = 0, swallowClick = false;
const cancelHold = () => {
  clearTimeout(holdTimer); holdTimer = null;
  if (holdBtn) holdBtn.classList.remove('holding');
  holdBtn = null;
};
document.addEventListener('touchstart', e => {
  lastTouch = Date.now();
  const b = e.target.closest('.qs');
  cancelHold();
  if (!b) return;
  const t = e.touches[0];
  holdBtn = b; holdPos = { x: t.clientX, y: t.clientY };
  b.classList.add('holding');            // red ring grows while you hold
  holdTimer = setTimeout(() => {
    const btn = holdBtn;
    cancelHold();
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 700);   // iOS may not send a click after a long press
    if (navigator.vibrate) navigator.vibrate(15);
    toggleQ(btn, true);
  }, 450);
}, { passive: true });
// small finger wobble shouldn't cancel the hold; a real drag/scroll should
document.addEventListener('touchmove', e => {
  if (!holdBtn) return;
  const t = e.touches[0];
  if (Math.hypot(t.clientX - holdPos.x, t.clientY - holdPos.y) > 12) cancelHold();
}, { passive: true });
document.addEventListener('touchend', cancelHold, { passive: true });   // a short tap falls through to the normal click (tick)
document.addEventListener('touchcancel', cancelHold, { passive: true });
// stop iOS/Android from opening a selection or menu on the question boxes
document.addEventListener('selectstart', e => {
  const el = e.target.nodeType === 3 ? e.target.parentElement : e.target;   // text inside the box
  if (el && el.closest && el.closest('.qs')) e.preventDefault();
});
document.addEventListener('click', e => {
  if (swallowClick && e.target.closest('.qs')) { e.preventDefault(); e.stopPropagation(); }
  swallowClick = false;
}, true);

/** Gentle fade when switching tab or week. */
function animateView() {
  const v = $('#view');
  v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
}
window.addEventListener('hashchange', () => { render(); animateView(); });

document.addEventListener('click', e => {
  const target = e.target;
  if (target.closest('a[target="_blank"]')) return;
  if (target.closest('#modal')) return;

  const actEl = target.closest('[data-action]');
  if (actEl && actEl.tagName !== 'SELECT' && actEl.type !== 'checkbox') {
    const act = actEl.dataset.action;
    const actions = {
      'week-prev': () => { ui.week--; render(); animateView(); },
      'week-next': () => { ui.week++; render(); animateView(); },
      'week-today': () => { ui.week = weekContaining(today()); render(); animateView(); },
      'day-prev': () => shiftDay(-1),
      'day-next': () => shiftDay(1),
      'day-today': () => { ui.day = iso(today()); ui.week = weekContaining(today()); render(); animateView(); },
      'tt-view': () => {
        const v = actEl.dataset.v;
        if (v === 'week' && ui.day) ui.week = weekContaining(parseISO(ui.day));
        if (v === 'day') {
          const s0 = windowStart(ui.week), t = today();
          ui.day = iso(t >= s0 && t < addDays(s0, 7) ? t : s0);
        }
        ui.ttView = v; render(); animateView();
      },
      'add-event': () => openEventForm(null),
      'add-supervision': () => openEventForm(null, { type: 'supervision', title: 'Supervision' }),
      'add-paper': () => openPaperForm(null),
      'q-toggle': () => toggleQ(actEl, e.altKey),
      'view-doc': () => { const d = (state.library || []).find(x => x.path === actEl.dataset.path); if (d) openDoc(docRef(d)); },
      'doc-rename': () => {
        const d = (state.library || []).find(x => x.path === actEl.dataset.path);
        const t = d && prompt('Rename', d.title);
        if (t && t.trim()) { d.title = t.trim(); save(); render(); }
      },
      'doc-remove': () => {
        const d = (state.library || []).find(x => x.path === actEl.dataset.path);
        if (!d || !confirm(`Remove "${d.title}" from the planner?` + (d.src === 'folder' ? '\n\nIt will come back next time you sync unless you also delete it from your IA Engineering folder.' : ''))) return;
        state.library = state.library.filter(x => x !== d); save(); render(); deleteFile(d.path, d.sha);
      },
      'view-pdf': () => { const p = state.papers.find(x => x.id === actEl.dataset.id); if (p) openPdf(p); },
      'edit-paper': () => { const p = state.papers.find(x => x.id === actEl.dataset.id); if (p) openPaperForm(p); },
      'lab-pre': () => { applyLabPre(actEl); render(); },
      'lab-status': () => {
        const needsDeadline = applyLabStatus(actEl);
        if (needsDeadline) openLabModal(actEl.dataset.key); else render();
      },
      'toggle-done-tasks': () => { ui.showDoneTasks = !ui.showDoneTasks; render(); },
      'clear-done-tasks': () => { if (confirm('Delete all completed tasks?')) { state.tasks = state.tasks.filter(x => !x.done); save(); render(); } },
      'add-course': () => { state.courses.push({ id: uid(), name: 'New course', color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') }); save(); render(); },
      'del-course': () => {
        const id = actEl.dataset.id;
        const used = state.events.some(x => x.courseId === id) || state.papers.some(x => x.courseId === id);
        if (used && !confirm('This course is used by events or papers. Delete anyway?')) return;
        state.courses = state.courses.filter(c => c.id !== id); save(); render();
      },
      'sync-now': async () => { if (dirty) await flushSave(); else { ghSha = ghSha || ''; await syncFromRemote(); setStatus('Synced ✓'); } },
      'disconnect': () => disconnectDevice(),
      'export': () => download(`planner-backup-${iso(today())}.json`, JSON.stringify(state, null, 2), 'application/json'),
      'export-ics': () => download('michaelmas-timetable.ics', buildICS(), 'text/calendar'),
      'reset': () => { if (confirm('Delete ALL events, papers and tasks? (Export a backup first!)')) { state = DEFAULT_STATE(); save(); render(); } },
    };
    if (actions[act]) { e.preventDefault(); actions[act](); }
    return;
  }

  const linkEl = target.closest('[data-link-kind]');
  if (linkEl) return openLinked(linkEl.dataset.linkKind, linkEl.dataset.linkKey);
  const supEl = target.closest('[data-sup]');
  if (supEl && !target.closest('[data-paper]')) return openSupModal(supEl.dataset.sup);
  const labEl = target.closest('[data-lab]');
  if (labEl) return openLabModal(labEl.dataset.lab);
  const paperEl = target.closest('[data-paper]');
  if (paperEl && !target.closest('select, button')) {
    const p = state.papers.find(x => x.id === paperEl.dataset.paper);
    if (p) { e.stopPropagation(); return openPaperForm(p); }
  }
  const evEl = target.closest('[data-ev]');
  if (evEl) {
    const ev = state.events.find(x => x.id === evEl.dataset.ev);
    if (ev) return openEventForm(ev);
  }
  const taskEl = target.closest('[data-task]');
  if (taskEl) {
    const t = state.tasks.find(x => x.id === taskEl.dataset.task);
    if (t) return openTaskForm(t);
  }
  const body = target.closest('.tt-body');
  if (body && target === body) {
    const y = e.offsetY;
    const h0 = +body.dataset.h0;
    const startMin = Math.floor((h0 * 60 + y / HOUR_PX * 60) / 60) * 60;
    const d = parseISO(body.dataset.date);
    const fmt = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    openEventForm(null, { date: body.dataset.date, day: d.getDay(), start: fmt(startMin), end: fmt(Math.min(startMin + 60, 23 * 60 + 59)) });
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.closest('#modal')) return;
  const act = t.dataset.action;
  if (act === 'paper-status') {
    const p = state.papers.find(x => x.id === t.dataset.id);
    p.status = t.value; save(); render();
  } else if (act === 'task-toggle') {
    const task = state.tasks.find(x => x.id === t.dataset.id);
    task.done = t.checked; save(); render();
  } else if (act === 'toggle-past') { ui.showPast = t.checked; render(); }
  else if (act === 'paper-filter') { ui.paperFilter = t.value; render(); }
  else if (act === 'paper-course') { ui.paperCourse = t.value; render(); }
  else if (act === 'lab-filter') { ui.labFilter = t.value; render(); }
  else if (t.closest('#termForm')) {
    const v = t.type === 'number' ? +t.value : t.value;
    if (t.name === 'week1Start' && !t.value) return;
    state.settings[t.name] = v;
    if (t.name === 'week1Start' || t.name === 'weekStartDay') ui.week = null;
    save(); render();
  } else if (t.dataset.courseName) {
    course(t.dataset.courseName).name = t.value.trim() || 'Untitled'; save(); render();
  } else if (t.dataset.courseColor) {
    course(t.dataset.courseColor).color = t.value; save(); render();
  } else if (t.id === 'importFile' && t.files[0]) {
    t.files[0].text().then(txt => {
      try {
        const d = JSON.parse(txt);
        if (!d.settings) throw new Error('Not a planner backup');
        if (!confirm('Replace all current data with this backup?')) return;
        state = d; migrate(); save(); render();
      } catch (err) { alert('Could not import: ' + err.message); }
    });
  }
});

document.addEventListener('submit', e => {
  if (e.target.id !== 'taskAdd') return;
  e.preventDefault();
  const f = e.target;
  const title = f.elements.title.value.trim();
  if (!title) return;
  state.tasks.push({ id: uid(), title, due: f.elements.due.value, time: f.elements.time.value, courseId: f.elements.courseId.value, priority: f.elements.priority.value, done: false, notes: '' });
  save(); render();
  $('#taskAdd input[name=title]').focus();
});

/* ---------------- export helpers ---------------- */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildICS() {
  const s = state.settings;
  const occ = occurrences(windowStart(0), addDays(windowStart(+s.numWeeks + 1), 6));
  const icsEsc = x => String(x || '').replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Michaelmas Planner//EN', 'CALSCALE:GREGORIAN'];
  for (const o of occ) {
    const d = o.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT',
      `UID:${o.e.id}-${d}@michaelmas-planner`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/London:${d}T${o.e.start.replace(':', '')}00`,
      `DTEND;TZID=Europe/London:${d}T${o.e.end.replace(':', '')}00`,
      `SUMMARY:${icsEsc(o.e.title)}`,
      `LOCATION:${icsEsc(o.e.location)}`,
      ...(o.e.link ? [`URL:${o.e.link}`] : []),
      `DESCRIPTION:${icsEsc([TYPES[o.e.type], course(o.e.courseId).name, o.e.who, o.e.notes].filter(Boolean).join(' · '))}`,
      'END:VEVENT');
  }
  for (const r of releasesBetween(windowStart(0), addDays(windowStart(+s.numWeeks + 1), 60))) {
    const d = r.date.replace(/-/g, ''), d2 = iso(addDays(parseISO(r.date), 1)).replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:rel-${r.kind}-${r.p.id}@michaelmas-planner`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${d2}`,
      `SUMMARY:${icsEsc(`${shortPaper(r.p)} issued`)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/* ---------------- boot ---------------- */
(async () => {
  await load();
  if (!location.hash) location.hash = '#dashboard';
  render();
  // keep the "now" markers fresh
  setInterval(() => { if ($('#modal').hidden && ['dashboard', 'timetable'].includes(currentTab())) render(); }, 60_000);
})();
