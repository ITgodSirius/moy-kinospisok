// The original per-card keys preserve marks on the same browser origin.
const prefixes = {
  watching: 'film-list:watching:', watched: 'film-list:watched:', favorite: 'film-list:favorite:',
  fulfilled: 'wish-list:fulfilled:', reaction: 'film-list:reaction:'
};
export const hosted = document.querySelector('meta[name="history-mode"]').content === 'server';
const remote = new Map();
const inFlight = new Set();
let revision = 0;
let loaded = false;

function readMark(id, kind) {
  if (hosted) return remote.get(id + '/' + kind) ?? null;
  try {
    const raw = localStorage.getItem(prefixes[kind] + id);
    if (raw === null) return null;
    return kind === 'reaction' ? JSON.parse(raw) : { value: true, markedAt: raw };
  }
  catch { return null; }
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
  return hosted && (!loaded || inFlight.has(id + '/' + kind));
}
export async function refreshHistory() {
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
