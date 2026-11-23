// The app gates these sections by owner key. The data branch itself is public.
const account = 'ITgodSirius';
const repository = '/repos/' + account + '/moy-kinospisok';
const branch = 'watch-history';
const api = 'https://api.github.com';
const files = new Set(['training.json', 'quotes.json']);

async function request(token, path, options = {}) {
  if (!token) throw new Error('Введите ключ GitHub.');
  let response;
  try {
    response = await fetch(api + path, {
      ...options, credentials: 'omit', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
  } catch { throw new Error('Нет связи с GitHub. Попробуйте ещё раз.'); }
  if (response.status === 401) throw new KeyError('Ключ GitHub недействителен. Введите новый ключ.');
  return response;
}

export class KeyError extends Error {}

export async function verifyOwner(token) {
  const res = await request(token, '/user');
  if (!res.ok) throw new Error('GitHub не смог проверить ключ. Попробуйте ещё раз.');
  if ((await res.json()).login?.toLowerCase() !== account.toLowerCase()) throw new KeyError('Этот раздел доступен только владельцу киносписка.');
}

function filePath(filename) {
  if (!files.has(filename)) throw new Error('Неизвестный файл.');
  return repository + '/contents/' + filename;
}

export async function openPrivateFile(token, filename, empty) {
  const response = await request(token, filePath(filename) + '?ref=' + branch);
  if (response.status === 404) return { data: empty(), sha: null };
  if (!response.ok) throw new Error('Не удалось прочитать личные записи. Проверьте доступ ключа к содержимому репозитория.');
  const { sha, content, encoding } = await response.json();
  if (!sha || encoding !== 'base64') throw new Error('Не удалось прочитать формат файла.');
  return { data: JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(content), c => c.charCodeAt(0)))), sha };
}

// The displayed revision is required for a save. A second device can never overwrite a newer revision.
export async function savePrivateFile(token, filename, snapshot, data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data) + '\n');
  const content = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  const res = await request(token, filePath(filename), {
    method: 'PUT', body: JSON.stringify({ message: 'Сохранить личную запись', branch, content, ...(snapshot.sha ? { sha: snapshot.sha } : {}) })
  });
  if (res.status === 409 || res.status === 422) throw new Error('Файл изменился. Откройте раздел заново и проверьте запись.');
  if (!res.ok) throw new Error('GitHub не сохранил запись. Проверьте право Contents → Read and write.');
  return { data, sha: (await res.json()).content.sha };
}
