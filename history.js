// The original per-card keys preserve marks on the same browser origin.
const prefixes = { watched: 'film-list:watched:', favorite: 'film-list:favorite:' };
export const hosted = document.querySelector('meta[name="history-mode"]').content === 'server';
const remote = new Map();
const inFlight = new Set();
let revision = 0;
let loaded = false;

export function marked(id, kind) {
  if (hosted) return remote.get(id + '/' + kind) === true;
  try { return localStorage.getItem(prefixes[kind] + id) !== null; }
  catch { return false; }
}
export function busy(id, kind) {
  return hosted && (!loaded || inFlight.has(id + '/' + kind));
}
export async function refreshHistory() {
  if (!hosted || inFlight.size) return false;
  const version = ++revision;
  const response = await fetch('./api/history', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('История недоступна');
  const rows = await response.json();
  if (version !== revision || inFlight.size) return false;
  const keys = rows.map(row => row.card + '/' + row.kind);
  const changed = !loaded || remote.size !== keys.length || keys.some(key => !remote.has(key));
  if (changed) {
    remote.clear();
    for (const key of keys) remote.set(key, true);
  }
  loaded = true;
  return changed;
}
export async function setMark(id, kind, value, update) {
  if (!hosted) {
    if (value) localStorage.setItem(prefixes[kind] + id, new Date().toISOString());
    else localStorage.removeItem(prefixes[kind] + id);
    update();
    return;
  }
  const key = id + '/' + kind;
  if (busy(id, kind)) return;
  const before = marked(id, kind);
  inFlight.add(key);
  revision++;
  if (value) remote.set(key, true); else remote.delete(key);
  update();
  try {
    const res = await fetch('./api/history', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card: id, kind, marked: value }), signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error('Отметка не сохранена');
  } catch (error) {
    if (before) remote.set(key, true); else remote.delete(key);
    throw error;
  } finally {
    inFlight.delete(key);
    update();
  }
}
