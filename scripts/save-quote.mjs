import { randomUUID } from 'node:crypto';
import { open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './public-files.mjs';
import { quoteFields } from './quote-record.mjs';

if (!process.env.KINO_PRIVATE_DIR) throw new Error('Укажите папку закрытого репозитория через KINO_PRIVATE_DIR.');
const directory = await realpath(resolve(process.env.KINO_PRIVATE_DIR));
const rel = relative(await realpath(fileURLToPath(root)), directory);
if (!rel || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))) throw new Error('Выберите папку вне публичного сайта.');
const file = join(directory, 'quotes.json');
const lock = join(directory, 'quotes.json.lock');

let input = '';
for await (const chunk of process.stdin) input += chunk;
const entry = quoteFields(JSON.parse(input));
const guard = await open(lock, 'wx');
const temporary = join(directory, 'quotes.' + randomUUID() + '.tmp');
try {
  const quotes = JSON.parse(await readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '[]';
    throw error;
  }));
  const index = quotes.findIndex(quote => quote.id === entry.id);
  const addedDate = index < 0
    ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date())
    : quotes[index].addedDate;
  const quote = { ...entry, addedDate };
  if (index < 0) quotes.unshift(quote);
  else quotes[index] = quote;
  await writeFile(temporary, JSON.stringify(quotes, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, file);
  console.log('Цитата сохранена.');
} finally {
  await guard.close();
  await unlink(lock);
  await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
