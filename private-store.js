// Personal records are read only through GitHub's authenticated API. Never use a public/raw URL.
const account = 'ITgodSirius';
const repository = '/repos/' + account + '/moy-kinospisok-private';
const api = 'https://api.github.com';
const files = new Set(['training.json', 'quotes.json']);
const unavailable = 'Для сохранения добавьте закрытый репозиторий moy-kinospisok-private в доступ этого ключа GitHub.';

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

export async function openPrivateFile(token, filename, empty) {
  if (!files.has(filename)) throw new Error('Неизвестный файл.');
  const metadata = await request(token, repository);
  if (metadata.status === 404) return { data: empty(), available: false, sha: null };
  if (!metadata.ok) throw new Error('Не удалось проверить доступ к личным записям в GitHub.');
  const repo = await metadata.json();
  if (repo.private !== true || repo.full_name?.toLowerCase() !== repository.slice(7).toLowerCase()) {
    throw new Error('Личные записи можно открывать только из закрытого репозитория владельца.');
  }
  const path = repository + '/contents/' + filename;
  const response = await request(token, path);
  if (response.status === 404) return { data: empty(), available: true, sha: null };
  if (!response.ok) throw new Error('Не удалось прочитать личные записи. Проверьте доступ ключа к содержимому репозитория.');
  const { sha, content, encoding } = await response.json();
  if (!sha || encoding !== 'base64') throw new Error('Не удалось прочитать формат файла.');
  return { data: JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(content), c => c.charCodeAt(0)))), sha, available: true };
}

// The displayed revision is required for a save. A second device can never overwrite a newer revision.
export async function savePrivateFile(token, filename, snapshot, data) {
  const current = await openPrivateFile(token, filename, () => null);
  if (!current.available) throw new Error(unavailable);
  if (snapshot.sha !== current.sha) throw new Error('Записи изменились на другом устройстве. Откройте раздел заново перед сохранением.');
  const bytes = new TextEncoder().encode(JSON.stringify(data) + '\n');
  const content = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  const res = await request(token, repository + '/contents/' + filename, {
    method: 'PUT', body: JSON.stringify({ message: 'Сохранить личную запись', content, ...(current.sha ? { sha: current.sha } : {}) })
  });
  if (res.status === 409 || res.status === 422) throw new Error('Файл изменился. Откройте раздел заново и проверьте запись.');
  if (!res.ok) throw new Error('GitHub не сохранил запись. Проверьте право Contents → Read and write.');
  return { data, available: true, sha: (await res.json()).content.sha };
}
