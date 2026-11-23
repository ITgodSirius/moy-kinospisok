import { readdir } from 'node:fs/promises';
import { extname } from 'node:path';
export const root = new URL('../', import.meta.url);
export const mime = file => ({
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.webp':'image/webp', '.jpeg':'image/jpeg', '.jpg':'image/jpeg',
  '.png':'image/png', '.avif':'image/avif'
})[extname(file)] || 'application/octet-stream';
export async function publicFiles() {
  const images = await readdir(new URL('assets/', root), {withFileTypes: true});
  return ['index.html', 'style.css', 'app.js', 'history.js', 'catalog.json', 'wishlist.json', 'training.js', 'private-store.js',
    ...images.filter(f => f.isFile() && !f.name.startsWith('.')).map(f => 'assets/' + f.name)];
}
