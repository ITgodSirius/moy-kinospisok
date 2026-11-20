import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { root, mime, publicFiles } from './public-files.mjs';
const path = name => new URL(name, root);
const catalog = JSON.parse(await readFile(path('catalog.json'), 'utf8'));
const files = await publicFiles();
const ids = new Set();
for (const item of catalog) {
  if (!item.id || ids.has(item.id) || !['movie','series'].includes(item.type) || !['available','waiting'].includes(item.status)) throw new Error('Проверьте ID, тип и статус: ' + item.title);
  ids.add(item.id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.addedDate)) throw new Error('Укажите дату добавления: ' + item.title);
  if (item.type === 'series' && !Number.isInteger(item.season)) throw new Error('Укажите номер сезона: ' + item.title);
  for (const img of [item.poster,...(item.gallery || [])].filter(Boolean)) {
    if (!files.includes(img) && !/^https:\/\//.test(img)) throw new Error('Изображение не найдено: ' + img);
  }
  if (item.trailer && !/^https:\/\/(www\.youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}$/.test(item.trailer)) throw new Error('Проверьте ссылку на трейлер: ' + item.title);
}
const assets = Object.create(null);
await mkdir(path('dist/pages/assets/'), {recursive:true});
for (const file of files) {
  let bytes = await readFile(path(file));
  await writeFile(path('dist/pages/' + file), bytes);
  if (file === 'index.html') bytes = Buffer.from(bytes.toString().replace('name="history-mode" content="local"', 'name="history-mode" content="server"'));
  assets['/' + file] = [mime(file), bytes.toString('base64')];
}
if (existsSync(path('.openai/hosting.json'))) {
  await mkdir(path('dist/server/'), {recursive:true});
  await mkdir(path('dist/.openai/'), {recursive:true});
  const entry = await readFile(path('server/worker.js'), 'utf8');
  await writeFile(path('dist/server/index.js'), 'const ASSETS = ' + JSON.stringify(assets) + ';\nconst CARD_IDS = ' + JSON.stringify([...ids]) + ';\n' + entry);
  await copyFile(path('.openai/hosting.json'),path('dist/.openai/hosting.json'));
}
await writeFile(path('dist/pages/.nojekyll'), '');
const dataUrl = file => {
  const asset = assets['/' + file];
  return asset ? 'data:' + asset[0] + ';base64,' + asset[1] : file;
};
const offline = catalog.map(item => ({ ...item, poster: dataUrl(item.poster), gallery: (item.gallery || []).map(dataUrl) }));
const css = await readFile(path('style.css'), 'utf8');
const code = (await readFile(path('app.js'), 'utf8')).replace("'./history.js'", () => "'" + dataUrl('history.js') + "'");
const json = JSON.stringify(offline).replaceAll('<','\\u003c');
const html = (await readFile(path('index.html'), 'utf8'))
  .replace('<link rel="stylesheet" href="./style.css">', () => '<style>' + css + '</style>')
  .replace('<script type="module" src="./app.js"></script>', () => '<script type="application/json" id="offline-catalog">' + json + '</script>\n<script type="module">' + code + '</script>');
await writeFile(path('dist/Мой киносписок.html'), html);
console.log('Сборка готова. Записей в каталоге: ' + catalog.length);
