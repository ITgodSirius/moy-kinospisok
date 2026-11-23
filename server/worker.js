const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
// For a reaction row, the existing integer column stores one exclusive choice.
const reactionCodes = [null, 'like', 'neutral', 'dislike'];

// Sites strips client-supplied identity headers and supplies the authenticated account.
async function history(request, env) {
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner) return json({ error: 'Требуется доступ владельца сайта.' }, 401);
  if (request.method !== 'GET') return json({ error: 'Метод не поддерживается.' }, 405);
  const rows = await env.DB.prepare('SELECT card, kind, marked, marked_at AS markedAt FROM marks WHERE owner = ? AND marked > 0').bind(owner).all();
  return json(rows.results.map(({card, kind, marked, markedAt}) =>
    kind === 'reaction' ? {card, kind, markedAt, reaction: reactionCodes[marked]} : {card, kind, markedAt}));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/history') return history(request, env);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const asset = ASSETS[path];
    if (!asset) return new Response('Страница не найдена', { status: 404 });
    const [type, data] = asset;
    const bytes = request.method === 'HEAD' ? null : Uint8Array.from(atob(data), c => c.charCodeAt(0));
    return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' } });
  }
};
