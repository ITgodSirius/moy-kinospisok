// The original per-card keys preserve marks on the same browser origin.
const prefixes = { watched: 'film-list:watched:', favorite: 'film-list:favorite:' };
export const guest = new URLSearchParams(location.search).get('view') === 'guest';
export const hosted = !guest && document.querySelector('meta[name="history-mode"]').content === 'server';
const remote = new Map();
const inFlight = new Set();
let revision = 0;
let loaded = false;

// null means no mark; an empty string represents an older mark with no known date.
export function markTime(id, kind) {
  if (guest) return null;
  if (hosted) return remote.get(id + '/' + kind) ?? null;
  try { return localStorage.getItem(prefixes[kind] + id); }
  catch { return null; }
}
export function marked(id, kind) {
  return markTime(id, kind) !== null;
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
  const entries = rows.map(row => [row.card + '/' + row.kind, row.markedAt ?? '']);
  const changed = !loaded || remote.size !== entries.length || entries.some(([key, time]) => remote.get(key) !== time);
  if (changed) {
    remote.clear();
    for (const [key, time] of entries) remote.set(key, time);
  }
  loaded = true;
  return changed;
}
export async function setMark(id, kind, value, update) {
  if (guest) throw new Error('Гостевая ссылка доступна только для просмотра.');
  if (!hosted) {
    if (value) localStorage.setItem(prefixes[kind] + id, new Date().toISOString());
    else localStorage.removeItem(prefixes[kind] + id);
    update();
    return;
  }
  const key = id + '/' + kind;
  if (busy(id, kind)) return;
  const before = markTime(id, kind);
  inFlight.add(key);
  revision++;
  if (value) remote.set(key, new Date().toISOString()); else remote.delete(key);
  update();
  try {
    const res = await fetch('./api/history', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card: id, kind, marked: value }), signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error('Отметка не сохранена');
    if (value) remote.set(key, (await res.json()).markedAt ?? '');
  } catch (error) {
    if (before !== null) remote.set(key, before); else remote.delete(key);
    throw error;
  } finally {
    inFlight.delete(key);
    update();
  }
}
