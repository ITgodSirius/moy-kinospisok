// The original per-card keys preserve marks on the same browser origin.
const prefixes = {
  watching: 'film-list:watching:', watched: 'film-list:watched:', favorite: 'film-list:favorite:',
  fulfilled: 'wish-list:fulfilled:', reaction: 'film-list:reaction:'
};
export const hosted = document.querySelector('meta[name="history-mode"]').content === 'server';
// Only the owner's Pages site can use a saved repository credential.
export const shared = !hosted && location.origin === 'https://itgodsirius.github.io'
  && location.pathname.startsWith('/moy-kinospisok/') && !document.getElementById('offline-catalog');
const historyURL = 'https://api.github.com/repos/ITgodSirius/moy-kinospisok/contents/watch-history.json';
const historyBranch = 'watch-history';
const storagePrefix = 'moy-kinospisok:github:';
export const historySnapshotKey = storagePrefix + 'snapshot-v2';
const remote = new Map();
const inFlight = new Set();
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
export const credential = () => preference('writer-token') || '';
let migrated = shared && preference('imported') === '1';
function expected(kind, mark) {
  return Object.hasOwn(prefixes, kind) && typeof mark?.markedAt === 'string' &&
    (kind === 'reaction' ? ['like', 'neutral', 'dislike'].includes(mark.value) : mark.value === true);
}
function localHistory() {
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
function encodeRows(rows, removed = new Set()) {
  const marks = Array.from(rows, ([key, mark]) => {
    const split = key.lastIndexOf('/');
    return { card: key.slice(0, split), kind: key.slice(split + 1), ...mark };
  });
  return JSON.stringify({ version: 1, marks, ...(removed.size ? { removed: [...removed].sort() } : {}) }, null, 2) + '\n';
}
function applySnapshot(rows, cache = true) {
  const changed = !loaded || rows.size !== remote.size || Array.from(rows).some(([key, mark]) =>
    remote.get(key)?.markedAt !== mark.markedAt || remote.get(key)?.value !== mark.value);
  if (changed) {
    remote.clear();
    for (const [key, mark] of rows) remote.set(key, mark);
    if (cache) {
      try { localStorage.setItem(historySnapshotKey, encodeRows(rows)); }
      catch { /* The shared file is already available even if the local cache is full. */ }
    }
  }
  loaded = true;
  return changed;
}
async function githubRequest(token, body) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(historyURL + (body ? '' : '?ref=' + historyBranch + '&sync=' + Date.now()), {
      method: body ? 'PUT' : 'GET', headers, body: body && JSON.stringify(body),
      cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000)
    });
  } catch { throw new Error('Нет связи с GitHub. Повторите синхронизацию.'); }
  if (response.ok || (body && response.status === 409)) return response;
  if (response.status === 401) {
    if (token === credential()) forgetCredential();
    throw new Error('Ключ GitHub недействителен. Подключите новый ключ.');
  }
  if (response.status === 403 || response.status === 429) {
    if (response.headers.get('x-ratelimit-remaining') === '0' || response.status === 429) throw new Error('GitHub временно ограничил запросы. Попробуйте позже.');
    if (body && token === credential()) forgetCredential();
    throw new Error('GitHub отказал в доступе. Проверьте у ключа право Contents — Read and write.');
  }
  throw new Error('Не удалось синхронизировать историю с GitHub (код ' + response.status + ').');
}
async function readPublicHistory() {
  const url = 'https://raw.githubusercontent.com/ITgodSirius/moy-kinospisok/' + historyBranch + '/watch-history.json';
  let response;
  try {
    response = await fetch(url + '?sync=' + Date.now(), {
      cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15000)
    });
  } catch { throw new Error('Нет связи с GitHub. Повторите синхронизацию.'); }
  if (!response.ok) throw new Error('Не удалось загрузить общую историю (код ' + response.status + ').');
  return decodeRows(await response.json());
}
async function readFile(token) {
  const response = await githubRequest(token);
  const { sha, content, encoding } = await response.json();
  if (!sha || encoding !== 'base64' || !content) throw new Error('GitHub не вернул файл истории.');
  const bytes = Uint8Array.from(atob(content), ch => ch.charCodeAt(0));
  const data = JSON.parse(new TextDecoder().decode(bytes));
  const rows = decodeRows(data);
  const removed = data.removed ?? [];
  if (!Array.isArray(removed) || removed.some(key => typeof key !== 'string' || rows.has(key))) {
    throw new Error('Не удалось прочитать историю снятых отметок.');
  }
  return { sha, rows, removed: new Set(removed) };
}
// Reapply only this device's change when another device saves first.
async function changeFile(token, change) {
  if (!token) throw new Error('Подключите ключ GitHub для записи истории.');
  for (let attempt = 0; attempt < 4; attempt++) {
    const { sha, rows, removed } = await readFile(token);
    if (change(rows, removed)) {
      const bytes = new TextEncoder().encode(encodeRows(rows, removed));
      const content = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
      const saved = await githubRequest(token, { message: 'Обновить отметки киносписка', branch: historyBranch, sha, content });
      if (saved.status === 409) continue;
    }
    applySnapshot(rows);
    return;
  }
  throw new Error('История менялась на другом устройстве. Повторите синхронизацию.');
}
export async function connectHistory(token) {
  if (!shared) throw new Error('Подключение ключа доступно на основном сайте киносписка.');
  return enqueue(async () => {
    const local = localHistory();
    await changeFile(token, (rows, removed) => {
      let changed = false;
      for (const [key, mark] of local) {
        if (!rows.has(key) && !removed.has(key)) { rows.set(key, mark); changed = true; }
      }
      return changed;
    });
    localStorage.setItem(storagePrefix + 'writer-token', token);
    localStorage.setItem(storagePrefix + 'imported', '1');
    migrated = true;
  });
}
export function forgetCredential() {
  localStorage.removeItem(storagePrefix + 'writer-token');
}
if (shared) {
  function restoreSnapshot(raw) {
    try { if (raw) applySnapshot(decodeRows(JSON.parse(raw)), false); }
    catch { /* The next read will replace an invalid cache. */ }
  }
  try { localStorage.removeItem(storagePrefix + 'device'); } catch { /* Storage may be disabled. */ }
  restoreSnapshot(preference('snapshot-v2') ?? preference('snapshot'));
  window.addEventListener('storage', event => {
    if (!event.key || event.key === storagePrefix + 'imported') migrated = preference('imported') === '1';
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
  if (hosted || (shared && (loaded || migrated))) return saved ?? null;
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
  if (shared) return enqueue(async () => {
    const token = credential();
    // Read from the same branch API that accepted the edit. The public CDN can lag behind.
    const rows = token ? (await readFile(token)).rows : await readPublicHistory();
    if (credential() !== token) return false;
    return applySnapshot(rows);
  });
  if (!hosted) return false;
  const response = await fetch('./api/history', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('История недоступна');
  const rows = await response.json();
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
export async function setMark(id, kind, value) {
  if (!shared) throw new Error('Редактирование доступно на основном сайте киносписка.');
  const mark = { value, markedAt: new Date().toISOString() };
  const key = id + '/' + kind;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    await enqueue(() => changeFile(credential(), (rows, removed) => {
      if (kind === 'reaction' && value && !rows.has(id + '/watched')) throw new Error('Сначала отметьте просмотр.');
      if (!value) {
        if (!rows.delete(key)) return false;
        removed.add(key);
        return true;
      }
      if (kind === 'watching' && rows.has(id + '/watched')) throw new Error('Карточка уже отмечена просмотренной.');
      removed.delete(key);
      if (rows.get(key)?.value === value) return false;
      rows.set(key, mark);
      return true;
    }));
  } finally {
    inFlight.delete(key);
  }
}
