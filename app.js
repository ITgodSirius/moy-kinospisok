import { hosted, marked, markTime, busy, refreshHistory, setMark } from './history.js?v=fcd635e64bcc';

const el = id => document.getElementById(id);
const editAccessKey = 'film-list:edit-unlocked';
const state = { list: 'waiting', type: 'all', catalog: [] };
const filterIds = ['origin', 'genre', 'studio', 'period', 'minimum'];
const originLabels = { russian: 'Российское', foreign: 'Зарубежное' };
const collator = new Intl.Collator('ru', { numeric: true });
const formatDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const formatMarkDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const desktopSchedule = window.matchMedia('(min-width: 821px)');
let scheduleItem;
const studioChoices = ['Apple', 'Amazon', 'Netflix', 'Disney', 'HBO'];
const listNames = { waiting: 'Жду', available: 'Новинки', backlog: 'Старое', watching: 'Смотрю сейчас', watched: 'Просмотрено', favorite: 'Любимые' };
const markActions = [
  { kind: 'watched', add: 'Отметить просмотренным', remove: 'Снять отметку', icon: 'check', style: 'primary' },
  { kind: 'favorite', add: 'В любимые', remove: 'Убрать из любимых', icon: 'heart', style: 'outline' },
  { kind: 'watching', add: 'Смотрю сейчас', remove: 'Отложить просмотр', icon: 'play', style: 'utility' }
];
const iconPaths = {
  sliders: '<path d="M3 7h4m5 0h9M3 17h10m5 0h3"/><circle cx="9.5" cy="7" r="2.5"/><circle cx="15.5" cy="17" r="2.5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  play: '<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/>',
  heart: '<path d="M20.5 4.8a5.2 5.2 0 0 0-7.3 0L12 6l-1.2-1.2a5.2 5.2 0 0 0-7.3 7.4L12 21l8.5-8.8a5.2 5.2 0 0 0 0-7.4Z"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>'
};
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function icon(name, filled = false) {
  const box = node('span', 'ico');
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = '<svg viewBox="0 0 24 24" fill="' + (filled ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + iconPaths[name] + '</svg>';
  return box;
}
function button(label, style, symbol, action) {
  const b = node('button', 'btn ' + style);
  b.type = 'button';
  if (symbol) b.append(icon(symbol, symbol === 'heart' && style.includes('chosen')));
  b.append(label);
  b.addEventListener('click', action);
  return b;
}
function dateText(value) {
  if (!value) return 'Дата выхода уточняется';
  return formatDate.format(new Date(value + 'T12:00:00Z')).replace(/\s*г\.$/, '');
}
function today() {
  const t = new Date();
  return [t.getFullYear(), String(t.getMonth() + 1).padStart(2, '0'), String(t.getDate()).padStart(2, '0')].join('-');
}
function listMatches(item) {
  const watched = marked(item.id, 'watched');
  const favorite = marked(item.id, 'favorite');
  if (state.list === 'watched') return watched;
  if (state.list === 'favorite') return favorite;
  if (watched) return false;
  if (marked(item.id, 'watching')) return state.list === 'watching';
  if (item.status === 'backlog') return state.list === 'backlog';
  const released = item.status === 'available' || (item.releaseDate && item.releaseDate <= today());
  return released ? state.list === 'available' : state.list === 'waiting' && !favorite;
}
function matches(item) {
  const ageDays = (Date.parse(today()) - Date.parse(item.addedDate)) / 86400000;
  return listMatches(item) && (state.type === 'all' || item.type === state.type)
    && (!el('origin').value || item.origin === el('origin').value)
    && (!el('genre').value || item.genres.includes(el('genre').value))
    && (!el('studio').value || item.studios.includes(el('studio').value) || item.platforms?.includes(el('studio').value))
    && (!el('minimum').value || (item.rating != null && item.rating >= Number(el('minimum').value)))
    && (!el('period').value || (ageDays >= 0 && ageDays < Number(el('period').value)));
}
function compare(a, b) {
  let sort = el('sort').value;
  if (sort === 'russian-first' || sort === 'foreign-first') {
    const first = sort === 'russian-first' ? 'russian' : 'foreign';
    const rank = origin => origin == null ? 2 : Number(origin !== first);
    const difference = rank(a.origin) - rank(b.origin);
    if (difference) return difference;
    sort = 'added-new';
  }
  const field = { 'added-new': 'addedDate', 'added-old': 'addedDate', 'release-new': 'releaseDate', 'release-old': 'releaseDate', rating: 'rating' }[sort];
  if (field) {
    if ((a[field] == null) !== (b[field] == null)) return a[field] == null ? 1 : -1;
    const dir = sort.endsWith('old') ? 1 : -1;
    if (a[field] !== b[field]) return (a[field] > b[field] ? 1 : -1) * dir;
  }
  return collator.compare(a.title, b.title) || (a.season ?? 0) - (b.season ?? 0) || collator.compare(a.id, b.id);
}
let toastTimer;
function announce(msg) {
  clearTimeout(toastTimer);
  el('notice').textContent = msg;
  toastTimer = setTimeout(() => { el('notice').textContent = ''; }, 4500);
}
function renderSeasons(item) {
  const desktop = desktopSchedule.matches;
  const blocks = (item.seasons || []).map(season => {
    const block = node(desktop ? 'section' : 'details', 'season');
    const header = node(desktop ? 'h3' : 'summary');
    const label = node('span', '', 'Сезон ' + season.number);
    label.append(node('small', '', (season.releaseDate ? 'Премьера · ' : '') + dateText(season.releaseDate)));
    header.append(label);
    if (!desktop) {
      block.name = 'season-choice';
      block.open = season.number === item.season;
      header.append(icon('chevron'));
    }
    block.append(header);
    if (season.episodes?.length) {
      const list = node('ol', 'episodes');
      for (const episode of season.episodes) {
        const li = node('li');
        const date = node(episode.date ? 'time' : 'span', episode.date ? '' : 'episode-unknown', episode.date ? dateText(episode.date) : 'Дата уточняется');
        if (episode.date) date.dateTime = episode.date;
        if (episode.title) li.append(node('span', 'num', episode.number));
        else li.className = 'untitled';
        li.append(node('span', '', episode.title || 'Серия ' + episode.number), date);
        list.append(li);
      }
      block.append(list);
    } else if (season.releaseDate || !desktop) {
      block.append(node('p', 'no-dates', 'Расписание серий пока не объявлено.'));
    }
    return block;
  });
  el('seasons').replaceChildren(...(blocks.length ? blocks : [node('p', 'no-dates', 'Расписание серий пока не объявлено.')]));
}
function showSchedule(item) {
  scheduleItem = item;
  el('series-title').textContent = item.title;
  renderSeasons(item);
  el('seasons').scrollTop = 0;
  el('schedule').showModal();
}
function requestEditAccess() {
  if (hosted) return true;
  try {
    if (localStorage.getItem(editAccessKey) === '1') return true;
  } catch { /* The dialog will report a storage error on confirmation. */ }

  const dialog = el('edit-dialog');
  if (dialog.open) return false;
  dialog.returnValue = '';
  dialog.showModal();
  el('edit-pin').focus();
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      el('edit-form').reset();
      el('edit-error').textContent = '';
      el('edit-pin').removeAttribute('aria-invalid');
      resolve(dialog.returnValue === 'confirmed');
    }, { once: true });
  });
}
function confirmEdit(event) {
  event.preventDefault();
  const pin = el('edit-pin');
  if (pin.value !== '5972') {
    el('edit-error').textContent = pin.value ? 'Неверный пароль. Попробуй ещё раз.' : 'Введи пароль.';
    pin.setAttribute('aria-invalid', 'true');
    pin.focus();
    pin.select();
    return;
  }
  try {
    localStorage.setItem(editAccessKey, '1');
  } catch {
    el('edit-error').textContent = 'Браузеру нужен доступ к данным сайта, чтобы сохранить отметку.';
    return;
  }
  el('edit-dialog').close('confirmed');
}
async function toggleMark(item, kind) {
  const value = !marked(item.id, kind);
  if (!await requestEditAccess() || marked(item.id, kind) === value || busy(item.id, kind)) return;
  if (kind === 'watching' && marked(item.id, 'watched')) return;
  try {
    await setMark(item.id, kind, value, render);
    announce((value ? 'Добавлено в «' : 'Убрано из «') + listNames[kind] + '»');
  } catch {
    announce(hosted ? 'Не удалось подтвердить сохранение. Проверьте соединение.' : 'Не удалось сохранить отметку в этом браузере.');
    if (hosted) sync();
  }
}
function gallery(item) {
  const images = [item.poster, ...(item.gallery || [])].filter(Boolean).slice(0, 3);
  const gallery = node('div', 'gallery' + (images.length < 2 ? ' single' : images.length === 2 ? ' two' : ''));
  images.forEach((src, i) => {
    const img = node('img');
    if (i === 0 && images.length > 1) img.addEventListener('load', () => {
      gallery.style.aspectRatio = String(img.naturalWidth / img.naturalHeight * (2.44 / 1.44));
    }, { once: true });
    img.src = src; img.alt = i === 0 ? 'Постер «' + item.title + '»' : '';
    img.decoding = 'async';
    gallery.append(img);
  });
  return gallery;
}
const expandedDescriptions = new Set();
const synopsisObserver = new ResizeObserver(entries => {
  for (const { target } of entries) {
    const limit = getComputedStyle(target);
    const maxHeight = parseFloat(limit.lineHeight) * Number(limit.getPropertyValue('--synopsis-lines'));
    target.nextElementSibling.hidden = target.scrollHeight <= Math.ceil(maxHeight);
  }
});
function synopsis(item) {
  const box = node('div', 'synopsis');
  const paragraph = node('p', '', item.description);
  paragraph.id = 'description-' + item.id;
  const toggle = button('', 'read-more', null, () => {
    if (expandedDescriptions.has(item.id)) expandedDescriptions.delete(item.id);
    else expandedDescriptions.add(item.id);
    reflect();
  });
  function reflect() {
    const expanded = expandedDescriptions.has(item.id);
    paragraph.classList.toggle('clamped', !expanded);
    toggle.textContent = expanded ? 'Свернуть' : 'Читать полностью';
    toggle.setAttribute('aria-expanded', String(expanded));
  }
  toggle.setAttribute('aria-controls', paragraph.id);
  toggle.hidden = true;
  reflect();
  box.append(paragraph, toggle);
  synopsisObserver.observe(paragraph);
  return box;
}
function cardHeader(item) {
  const header = node('div', 'card-heading');
  const title = node('div');
  title.append(node('h2', '', item.title), node('p', 'kind', item.type === 'series' ? 'Сериал · Сезон ' + item.season : 'Фильм'));
  header.append(title);
  if (item.rating != null) {
    const score = node('div', 'rating');
    const source = item.ratingSource || 'Рейтинг';
    const imdb = source.startsWith('IMDb');
    score.append(node('span', 'rating-source', imdb ? 'IMDb' : source), node('strong', '', item.rating.toLocaleString('ru-RU')));
    if (source === 'IMDb сериала') score.append(node('small', '', 'Оценка сериала'));
    header.append(score);
  }
  return header;
}
function row(list, label, value) {
  const dd = node('dd');
  dd.append(value);
  list.append(node('dt', '', label), dd);
}
function metadata(item) {
  const list = node('dl', 'metadata');
  if (item.genres.length) {
    const badges = node('div', 'badges');
    for (const genre of item.genres) badges.append(node('span', 'badge', genre));
    row(list, 'Жанры', badges);
  }
  row(list, 'Производство', originLabels[item.origin] ?? 'Уточняется');
  if (item.platforms?.length) row(list, item.platforms.length > 1 ? 'Платформы' : 'Платформа', item.platforms.map(name => name === 'Apple' ? 'Apple TV' : name).join(', '));
  if (item.studios.length) {
    const label = item.platforms ? (item.studios.length > 1 ? 'Студии' : 'Студия') : 'Студии и платформы';
    row(list, label, item.studios.join(', '));
  }
  return list;
}
function dated(value, text) {
  const time = node('time', '', text);
  time.dateTime = value;
  return time;
}
function cardHistory(item) {
  const section = node('section', 'card-history');
  const dates = node('dl');
  row(dates, 'Добавлено в каталог', dated(item.addedDate, dateText(item.addedDate)));
  for (const [kind, label] of [['watching', 'Начало просмотра'], ['watched', 'Отмечено просмотренным'], ['favorite', 'Добавлено в любимые']]) {
    const stamp = markTime(item.id, kind);
    if (stamp === null) continue;
    const date = /^\d{4}-\d{2}-\d{2}T/.test(stamp) ? new Date(stamp) : null;
    row(dates, label, date && Number.isFinite(date.getTime()) ? dated(stamp, formatMarkDate.format(date).replace(/\s*г\.$/, '')) : 'Дата неизвестна');
  }
  section.append(node('h3', '', 'История'), dates);
  return section;
}
function card(item) {
  const section = node('article', 'entry');
  section.dataset.id = item.id;
  const copy = node('div', 'copy');
  copy.append(cardHeader(item));
  const date = node('div', 'date');
  date.append(icon('calendar'));
  if (item.releaseDate) {
    const time = node('time', '', dateText(item.releaseDate));
    time.dateTime = item.releaseDate;
    const strong = node('strong'); strong.append(time);
    date.append(node('span', '', 'Дата выхода'), strong);
  } else date.append(node('strong', '', 'Дата выхода уточняется'));
  const actions = node('div', 'actions');
  if (item.type === 'series') {
    const calendar = button('Сезоны и серии', 'utility', 'calendar', () => showSchedule(item));
    calendar.setAttribute('aria-haspopup', 'dialog');
    actions.append(calendar);
  }
  if (item.trailer) {
    const trailer = node('a', 'btn trailer'); trailer.href = item.trailer;
    trailer.target = '_blank'; trailer.rel = 'noopener noreferrer';
    trailer.title = 'Открыть трейлер на YouTube в новой вкладке';
    trailer.append(icon('play'), 'Посмотреть трейлер'); actions.append(trailer);
  }
  for (const { kind, add, remove, icon, style } of markActions) {
    if (kind === 'watching' && marked(item.id, 'watched')) continue;
    const active = marked(item.id, kind);
    const mark = button(active ? remove : add, 'mark ' + (active ? 'chosen' : style), icon, () => toggleMark(item, kind));
    mark.dataset.kind = kind; mark.disabled = busy(item.id, kind);
    mark.setAttribute('aria-pressed', String(active)); actions.append(mark);
  }
  copy.append(date, synopsis(item), metadata(item), cardHistory(item), actions);
  section.append(gallery(item), copy);
  return section;
}
function resetFilters() {
  for (const id of filterIds) el(id).value = '';
  state.type = 'all';
  reflectControls();
  render();
}
function empty(hasFilters) {
  if (hasFilters || state.list === 'backlog' || state.list === 'watching') return node('p', 'empty', 'пусто');
  const box = node('section', 'empty');
  const text = {waiting:'Здесь появятся будущие премьеры.',available:'Здесь появятся фильмы и сезоны, которые уже вышли.',watched:'Отметьте фильм или сезон просмотренным, и он появится здесь.',favorite:'Нажмите «В любимые» на карточке фильма или сезона.'};
  box.append(node('h2', '', 'В списке пока пусто'), node('p', '', text[state.list]));
  return box;
}
function reflectControls() {
  for (const b of document.querySelectorAll('[data-list]')) b.setAttribute('aria-pressed', String(b.dataset.list === state.list));
  for (const b of document.querySelectorAll('[data-type]')) b.setAttribute('aria-pressed', String(b.dataset.type === state.type));
}
function render() {
  const focused = document.activeElement;
  const kind = focused?.dataset.kind;
  const id = focused?.closest('.entry')?.dataset.id;
  const result = state.catalog.filter(matches).sort(compare);
  const count = filterIds.filter(id => el(id).value).length;
  el('filter-count').hidden = !count; el('filter-count').textContent = count;
  el('apply').textContent = 'Показать (' + result.length + ')';
  synopsisObserver.disconnect();
  el('records').replaceChildren(...(result.length ? result.map(card) : [empty(Boolean(count || state.type !== 'all'))]));
  if (kind && id) {
    const same = [...el('records').querySelectorAll('.entry')].find(entry => entry.dataset.id === id);
    const activeList = [...document.querySelectorAll('[data-list][aria-pressed="true"]')].find(button => button.getClientRects().length);
    (same?.querySelector('[data-kind="' + kind + '"]') || activeList)?.focus({ preventScroll: true });
  }
}
async function sync() {
  if (!hosted) return;
  try { if (await refreshHistory()) render(); }
  catch { announce('Нет связи с историей просмотра. Повторим синхронизацию.'); }
}
function wireGroup(id, key) {
  el(id).addEventListener('click', event => {
    const value = event.target.closest('button')?.dataset[key];
    if (!value) return;
    state[key] = value;
    reflectControls(); render(); el('feed').scrollTop = 0;
    el('feed').setAttribute('aria-label','Лента · ' + listNames[state.list]);
  });
}
async function start() {
  document.querySelectorAll('[data-icon]').forEach(holder => holder.replaceWith(icon(holder.dataset.icon)));
  el('edit-form').onsubmit = confirmEdit;
  el('edit-pin').oninput = () => {
    el('edit-error').textContent = '';
    el('edit-pin').removeAttribute('aria-invalid');
  };
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
  const embedded = document.getElementById('offline-catalog');
  if (embedded) state.catalog = JSON.parse(embedded.textContent);
  else {
    const response = await fetch('./catalog.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Каталог недоступен');
    state.catalog = await response.json();
  }
  for (const [id, values] of [['genre', state.catalog.flatMap(i => i.genres)], ['studio', [...studioChoices,...state.catalog.flatMap(i => [...i.studios, ...(i.platforms || [])])]]]) {
    for (const s of new Set(values)) el(id).add(new Option(s,s));
  }
  wireGroup('list-navigation','list'); wireGroup('types','type');
  for (const id of filterIds) el(id).addEventListener('change', render);
  el('sort').onchange = () => {
    const chosen = el('sort').selectedOptions[0].textContent;
    el('sort').style.setProperty('--sort-width', Math.min(236, chosen.length * 8.25 + 32) + 'px');
    render(); el('feed').scrollTop = 0;
  };
  el('filters-open').onclick = () => el('filters').showModal();
  desktopSchedule.addEventListener('change', () => {
    if (el('schedule').open) renderSeasons(scheduleItem);
  });
  el('clear').onclick = resetFilters;
  el('apply').onclick = () => { el('filters').close(); el('feed').scrollTop = 0; };
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', e => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  });
  if (!hosted) window.addEventListener('storage', render);
  render();
  if (hosted) {
    await sync();
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
    window.addEventListener('online', sync);
    setInterval(() => { if (!document.hidden) sync(); }, 30000);
  }
}
start().catch(() => {
  const failure = node('section','empty');
  failure.append(node('h2','','Не удалось открыть каталог'),button('Повторить','outline',null,() => location.reload()));
  el('records').replaceChildren(failure);
});
