// Accept a researched card as JSON on standard input, preserving its original added date.
import { readFile, rename, writeFile, open, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { root } from './public-files.mjs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const entry = JSON.parse(input);
if (!/^tmdb-(movie-\d+|tv-\d+-s\d+)$/.test(entry.id) || !entry.title || !entry.description ||
    !['series','movie'].includes(entry.type) || !['waiting','available'].includes(entry.status) ||
    !Array.isArray(entry.genres) || !Array.isArray(entry.studios) || !entry.poster ||
    (entry.type === 'series' && (!Number.isInteger(entry.season) || !entry.id.endsWith('-s' + entry.season)))) {
  throw new Error('Проверьте обязательные поля и стабильный ID карточки.');
}
const file = new URL('catalog.json', root);
const lock = new URL('catalog.json.lock', root);
const guard = await open(lock, 'wx');
const temp = new URL('catalog.' + randomUUID() + '.tmp', root);
try {
  const entries = JSON.parse(await readFile(file, 'utf8'));
  const ix = entries.findIndex(i => i.id === entry.id);
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,10);
  entry.addedDate = ix < 0 ? localDate : entries[ix].addedDate;
  if (ix < 0) entries.unshift(entry); else entries[ix] = entry;
  await writeFile(temp, JSON.stringify(entries, null, 2) + '\n', {flag:'wx'});
  await rename(temp,file);
} finally {
  await guard.close();
  await unlink(lock);
  await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
