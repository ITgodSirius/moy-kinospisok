// The original per-card keys preserve marks on the same browser origin.
const prefixes = {
  watching: 'film-list:watching:', watched: 'film-list:watched:', favorite: 'film-list:favorite:',
  fulfilled: 'wish-list:fulfilled:', reaction: 'film-list:reaction:'
};
export const hosted = document.querySelector('meta[name="history-mode"]').content === 'server';
// Device permissions are scoped to the published cinema site.
export const shared = !hosted && location.origin === 'https://itgodsirius.github.io'
  && location.pathname.startsWith('/moy-kinospisok/') && !document.getElementById('offline-catalog');
const historyURL = 'https://moy-kinospisok-history-sync.simpleclay16.chatgpt.site';
const storagePrefix = 'moy-kinospisok:github:';
const remote = new Map();
const inFlight = new Set();
let revision = 0;
let loaded = false;
let queue = Promise.resolve();
function enqueue(operation) {
  const result = queue.then(operation);
  queue = result.catch(() => {});
  return result;
}
function preference(name) {
  try { return localStorage.getItem(storagePrefix + name); } catch { return null; }
}
export const hasDevice = () => Boolean(preference('device'));
let migrated = shared && preference('imported') === '1';
function expected(kind, mark) {
  return Object.hasOwn(prefixes, kind) && typeof mark?.markedAt === 'string' &&
    (kind === 'reaction' ? ['like', 'neutral', 'dislike'].includes(mark.value) : mark.value === true);
}
export function localHistory() {
  const rows = new Map();
  if (!shared || migrated) return rows;
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i);
    for (const [kind, prefix] of Object.entries(prefixes)) {
      if (!name?.startsWith(prefix)) continue;
      const id = name.slice(prefix.length);
      const mark = localMark(id, kind);
      if (id && expected(kind, mark)) rows.set(id + '/' + kind, mark);
    }
  }
  return rows;
}
function decodeRows(data) {
  if (data?.version !== 1 || !Array.isArray(data.marks)) throw new Error('Неизвестный формат файла истории.');
  const rows = new Map();
  for (const { card, kind, value, markedAt } of data.marks) {
    if (!card || typeof card !== 'string' || !expected(kind, { value, markedAt })) throw new Error('Не удалось прочитать отметку в файле истории.');
    rows.set(card + '/' + kind, { value, markedAt });
  }
  return rows;
}
function toRecords(rows) {
  const marks = Array.from(rows, ([key, mark]) => {
    const split = key.lastIndexOf('/');
    return { card: key.slice(0, split), kind: key.slice(split + 1), ...mark };
  });
  return marks;
}
function applySnapshot(rows, cache = true) {
  const changed = !loaded || rows.size !== remote.size || Array.from(rows).some(([key, mark]) =>
    remote.get(key)?.markedAt !== mark.markedAt || remote.get(key)?.value !== mark.value);
  if (changed) {
    remote.clear();
    for (const [key, mark] of rows) remote.set(key, mark);
    if (cache) {
      try { localStorage.setItem(storagePrefix + 'snapshot', JSON.stringify({ version: 1, marks: toRecords(rows) })); }
      catch { /* The shared file is already available even if the local cache is full. */ }
    }
  }
  loaded = true;
  return changed;
}
async function requestHistory(path, body) {
  const headers = {};
  const device = preference('device');
  if (body) headers['Content-Type'] = 'application/json';
  if (body && path !== '/device' && device) headers['X-Kino-Device'] = device;
  let response;
  try {
    response = await fetch(historyURL + path, {
      method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body),
      cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000)
    });
  } catch { throw new Error('Нет связи с общей историей. Повторите позже.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    if (response.status === 401 && path !== '/device' && preference('device') === device) localStorage.removeItem(storagePrefix + 'device');
    throw new Error(data?.message || 'Синхронизация недоступна. Повторите позже.');
  }
  return data;
}
export async function checkDevicePin(pin) {
  const { device } = await requestHistory('/device', { pin });
  if (typeof device !== 'string' || !device) throw new Error('Не удалось подтвердить устройство.');
  return device;
}
export function rememberDevice(device) { localStorage.setItem(storagePrefix + 'device', device); }
export function importLocalHistory() {
  return enqueue(async () => {
    if (migrated) return;
    const records = toRecords(localHistory());
    for (let i = 0; i < records.length; i += 250) {
      const data = await requestHistory('/import', { marks: records.slice(i, i + 250) });
      applySnapshot(decodeRows(data));
    }
    localStorage.setItem(storagePrefix + 'imported', '1');
    migrated = true;
  });
}
if (shared) {
  function restoreSnapshot(raw) {
    try { if (raw) applySnapshot(decodeRows(JSON.parse(raw)), false); }
    catch { /* The next read will replace an invalid cache. */ }
  }
  try { localStorage.removeItem(storagePrefix + 'token'); } catch { /* Read-only browsing is available without storage. */ }
  restoreSnapshot(preference('snapshot'));
  window.addEventListener('storage', event => {
    if (!event.key || event.key === storagePrefix + 'imported') migrated = preference('imported') === '1';
    if (event.key === storagePrefix + 'snapshot') restoreSnapshot(event.newValue);
  });
}

function localMark(id, kind) {
  try {
    const raw = localStorage.getItem(prefixes[kind] + id);
    if (raw === null) return null;
    return kind === 'reaction' ? JSON.parse(raw) : { value: true, markedAt: raw };
  }
  catch { return null; }
}
function readMark(id, kind) {
  const saved = remote.get(id + '/' + kind);
  if (hosted || (shared && (saved || migrated))) return saved ?? null;
  return localMark(id, kind);
}
// null means no mark; an empty string represents an older mark with no known date.
export function markTime(id, kind) {
  return readMark(id, kind)?.markedAt ?? null;
}
export function reactionValue(id) {
  return readMark(id, 'reaction')?.value ?? null;
}
export function marked(id, kind) {
  return markTime(id, kind) !== null;
}
export function busy(id, kind) {
  return (hosted && !loaded) || inFlight.has(id + '/' + kind);
}
export async function refreshHistory() {
  if (shared) return enqueue(async () => applySnapshot(decodeRows(await requestHistory('/history'))));
  if (!hosted || inFlight.size) return false;
  const version = ++revision;
  const response = await fetch('./api/history', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('История недоступна');
  const rows = await response.json();
  if (version !== revision || inFlight.size) return false;
  const entries = rows.map(row => [row.card + '/' + row.kind, { value: row.reaction ?? true, markedAt: row.markedAt ?? '' }]);
  const changed = !loaded || remote.size !== entries.length || entries.some(([key, mark]) =>
    remote.get(key)?.markedAt !== mark.markedAt || remote.get(key)?.value !== mark.value);
  if (changed) {
    remote.clear();
    for (const [key, time] of entries) remote.set(key, time);
  }
  loaded = true;
  return changed;
}
export async function setMark(id, kind, value, update) {
  const mark = { value, markedAt: new Date().toISOString() };
  if (shared) {
    const key = id + '/' + kind;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    update();
    try {
      await enqueue(async () => {
        const data = await requestHistory('/mark', { card: id, kind, value });
        applySnapshot(decodeRows(data));
      });
    } finally {
      inFlight.delete(key);
      update();
    }
    return;
  }
  if (!hosted) {
    if (value) localStorage.setItem(prefixes[kind] + id, kind === 'reaction' ? JSON.stringify(mark) : mark.markedAt);
    else localStorage.removeItem(prefixes[kind] + id);
    update();
    return;
  }
  const key = id + '/' + kind;
  if (busy(id, kind)) return;
  const before = remote.get(key);
  inFlight.add(key);
  revision++;
  if (value) remote.set(key, mark); else remote.delete(key);
  update();
  try {
    const res = await fetch('./api/history', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card: id, kind, ...(kind === 'reaction' ? { reaction: value } : { marked: value }) }), signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error('Отметка не сохранена');
    if (value) mark.markedAt = (await res.json()).markedAt ?? '';
  } catch (error) {
    if (before) remote.set(key, before); else remote.delete(key);
    throw error;
  } finally {
    inFlight.delete(key);
    update();
  }
}
