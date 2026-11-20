const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

// Sites strips client-supplied identity headers and supplies the authenticated account.
async function history(request, env, url) {
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner) return json({ error: 'Требуется доступ владельца сайта.' }, 401);
  if (request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT card, kind, marked_at AS markedAt FROM marks WHERE owner = ? AND marked = 1').bind(owner).all();
    return json(rows.results);
  }
  if (request.method !== 'PUT') return json({ error: 'Метод не поддерживается.' }, 405);
  if (request.headers.get('Origin') !== url.origin) return json({ error: 'Недопустимый источник запроса.' }, 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'Ожидается JSON.' }, 415);
  let change;
  try { change = await request.json(); } catch { return json({ error: 'Некорректные данные.' }, 400); }
  if (!change || !CARD_IDS.includes(change.card) || !['watching', 'watched', 'favorite'].includes(change.kind) || typeof change.marked !== 'boolean') {
    return json({ error: 'Некорректная отметка.' }, 400);
  }
  const row = await env.DB.prepare(`
    INSERT INTO marks (owner, card, kind, marked, marked_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (owner, card, kind) DO UPDATE SET
      marked_at = CASE WHEN marks.marked = excluded.marked THEN marks.marked_at ELSE excluded.marked_at END,
      marked = excluded.marked
    RETURNING marked_at AS markedAt
  `).bind(owner, change.card, change.kind, Number(change.marked), change.marked ? new Date().toISOString() : null).first();
  return json({ saved: true, markedAt: row.markedAt });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/history') return history(request, env, url);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const asset = ASSETS[path];
    if (!asset) return new Response('Страница не найдена', { status: 404 });
    const [type, data] = asset;
    const bytes = request.method === 'HEAD' ? null : Uint8Array.from(atob(data), c => c.charCodeAt(0));
    return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' } });
  }
};
