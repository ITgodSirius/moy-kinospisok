import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { root, mime, publicFiles } from './public-files.mjs';
const path = name => new URL(name, root);
const catalog = JSON.parse(await readFile(path('catalog.json'), 'utf8'));
const wishlist = JSON.parse(await readFile(path('wishlist.json'), 'utf8'));
const files = await publicFiles();
const ids = new Set();
const trailerUrls = [
  /^https:\/\/(www\.youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}$/,
  /^https:\/\/rutube\.ru\/video\/[a-f0-9]{32}\/?$/
];
for (const item of catalog) {
  if (!item.id || ids.has(item.id) || !['movie','series'].includes(item.type) || !['available','waiting','backlog'].includes(item.status)) throw new Error('Проверьте ID, тип и статус: ' + item.title);
  ids.add(item.id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.addedDate)) throw new Error('Укажите дату добавления: ' + item.title);
  if (item.type === 'series' && !Number.isInteger(item.season)) throw new Error('Укажите номер сезона: ' + item.title);
  for (const img of [item.poster,...(item.gallery || [])].filter(Boolean)) {
    if (!files.includes(img) && !/^https:\/\//.test(img)) throw new Error('Изображение не найдено: ' + img);
  }
  if (item.trailer && !trailerUrls.some(pattern => pattern.test(item.trailer))) throw new Error('Проверьте ссылку на трейлер: ' + item.title);
}
const wishIds = new Set();
for (const item of wishlist) {
  if (!/^wish-[a-z0-9-]+$/.test(item.id) || ids.has(item.id) || wishIds.has(item.id) ||
      typeof item.title !== 'string' || !item.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(item.addedDate) ||
      !['things', 'trips', 'experiences', 'perfume'].includes(item.category)) {
    throw new Error('Проверьте ID, название, дату и категорию желания: ' + item.title);
  }
  if (item.image && (!item.image.startsWith('assets/') || !files.includes(item.image))) throw new Error('Изображение желания не найдено: ' + item.image);
  if (item.url && !/^https:\/\/[^\s/]+/.test(item.url)) throw new Error('Проверьте ссылку желания: ' + item.title);
  if (item.budget != null && (!Number.isFinite(item.budget) || item.budget < 0)) throw new Error('Проверьте бюджет желания: ' + item.title);
  wishIds.add(item.id);
}
// Pages serves the repository root. Update its asset URLs before making the other builds.
const [history, training, workoutStats, nutrition, privateStore, css, originalApp, originalPage] = await Promise.all(
  ['history.js', 'training.js', 'training-stats.js', 'nutrition.js', 'private-store.js', 'style.css', 'app.js', 'index.html'].map(name => readFile(path(name), 'utf8'))
);
function versionedUrl(name, content) {
  return './' + name + '?v=' + createHash('sha256').update(content).digest('hex').slice(0, 12);
}
const modules = new Map([['history.js', history], ['training.js', training], ['training-stats.js', workoutStats], ['nutrition.js', nutrition], ['private-store.js', privateStore]]);
const app = originalApp.replace(/'\.\/(history|training|training-stats|nutrition|private-store)\.js(?:\?v=[a-f0-9]+)?'/g,
  (_, name) => "'" + versionedUrl(name + '.js', modules.get(name + '.js')) + "'");
const styleUrl = versionedUrl('style.css', css);
const appUrl = versionedUrl('app.js', app);
const page = originalPage
  .replace(/href="\.\/style\.css(?:\?v=[a-f0-9]+)?"/, 'href="' + styleUrl + '"')
  .replace(/src="\.\/app\.js(?:\?v=[a-f0-9]+)?"/, 'src="' + appUrl + '"');
if (app !== originalApp) await writeFile(path('app.js'), app);
if (page !== originalPage) await writeFile(path('index.html'), page);
// Bundles can also be opened without HTTP publication metadata.
const builtPage = page.replace('<time id="site-updated">', '<time id="site-updated" datetime="' + new Date().toISOString() + '">');
const assets = Object.create(null);
// Older builds copied the quote collection into the public distribution.
await rm(path('dist/pages/quotes.json'), { force: true });
await mkdir(path('dist/pages/assets/'), {recursive:true});
for (const file of files) {
  let bytes = file === 'index.html' ? Buffer.from(builtPage) : await readFile(path(file));
  await writeFile(path('dist/pages/' + file), bytes);
  if (file === 'index.html') bytes = Buffer.from(bytes.toString().replace('name="history-mode" content="local"', 'name="history-mode" content="server"'));
  assets['/' + file] = [mime(file), bytes.toString('base64')];
}
if (existsSync(path('.openai/hosting.json'))) {
  await mkdir(path('dist/server/'), {recursive:true});
  await mkdir(path('dist/.openai/'), {recursive:true});
  const entry = await readFile(path('server/worker.js'), 'utf8');
  await writeFile(path('dist/server/index.js'), 'const ASSETS = ' + JSON.stringify(assets) + ';\nconst CARD_IDS = ' + JSON.stringify([...ids]) + ';\nconst WISH_IDS = ' + JSON.stringify([...wishIds]) + ';\n' + entry);
  await copyFile(path('.openai/hosting.json'),path('dist/.openai/hosting.json'));
}
await writeFile(path('dist/pages/.nojekyll'), '');
const dataUrl = file => {
  const asset = assets['/' + file];
  return asset ? 'data:' + asset[0] + ';base64,' + asset[1] : file;
};
const offline = catalog.map(item => ({ ...item, poster: dataUrl(item.poster), gallery: (item.gallery || []).map(dataUrl) }));
const offlineWishlist = wishlist.map(item => ({ ...item, image: dataUrl(item.image) }));
const code = app.replace(/'\.\/(history|training|training-stats|nutrition|private-store)\.js\?v=[a-f0-9]+'/g,
  (_, name) => "'" + dataUrl(name + '.js') + "'");
const json = JSON.stringify(offline).replaceAll('<','\\u003c');
const wishJson = JSON.stringify(offlineWishlist).replaceAll('<', '\\u003c');
const offlineCss = css.replace(/url\("\.\/(assets\/[^"]+)"\)/g, (_, file) => 'url("' + dataUrl(file) + '")');
const html = builtPage
  .replace('<link rel="stylesheet" href="' + styleUrl + '">', () => '<style>' + offlineCss + '</style>')
  .replace('<script type="module" src="' + appUrl + '"></script>', () => [
    '<script type="application/json" id="offline-catalog">' + json + '</script>',
    '<script type="application/json" id="offline-wishlist">' + wishJson + '</script>',
    '<script type="module">' + code + '</script>'
  ].join('\n'));
await writeFile(path('dist/Мой киносписок.html'), html);
console.log('Сборка готова. Записей в каталоге: ' + catalog.length);
