import { hosted, shared, historySnapshotKey, credential, connectHistory, marked, markTime, reactionValue, busy, refreshHistory, setMark } from './history.js?v=0147301cae10';

import { KeyError, verifyOwner, openPrivateFile, savePrivateFile } from './private-store.js?v=041c70d8f2eb';
import { setupNutrition } from './nutrition.js?v=13f3368483dc';
import { setupTraining, emptyTraining } from './training.js?v=b2351924bdc1';

const el = id => document.getElementById(id);
let pendingActions = 0;
async function withLoading(request) {
  const dialog = el('action-loading');
  if (++pendingActions === 1) dialog.showModal();
  try {
    return await request;
  } finally {
    if (--pendingActions === 0) dialog.close();
  }
}
const viewKey = 'film-list:view:' + location.pathname;
const persistentViewKey = viewKey.replace(/\/index\.html$/, '/');
const layoutKey = viewKey + ':layout';
const wishLayoutKey = persistentViewKey + ':wish-layout';
const sortKeyPrefix = persistentViewKey + ':sort:';
const wishes = { items: null, loading: false, status: 'wanted', category: 'all', layout: 'grid', detail: null };
const formatBudget = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
let layout = 'list';
let detailItem;
const state = { list: 'waiting', type: 'all', genres: new Set(), catalog: [], day: null };
let viewBeforeSearch;
const wishSortChoices = { wanted: 'added', fulfilled: 'added' };
const filterIds = ['origin', 'studio', 'period', 'minimum'];
const animationGenres = new Set(['мультфильм', 'мультсериал', 'анимация', 'мультипликация']);
const originLabels = { russian: 'Российское', foreign: 'Зарубежное' };
const collator = new Intl.Collator('ru', { numeric: true });
const formatDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const formatMarkDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const desktop = window.matchMedia('(min-width: 821px)');
let scheduleItem;
const studioChoices = ['Apple', 'Amazon', 'Netflix', 'Disney', 'HBO'];
// Logo rows in assets/poster-brands.webp use Simple Icons, Wikimedia Commons
// (Disney, Paramount, Universal), and the Lionsgate site wordmark.
const posterBrandNames = [
  ['Amazon', 'Prime Video', 'Amazon Prime', 'Amazon Prime Video', 'Amazon Studios', 'Amazon MGM', 'Amazon MGM Studios', 'Амазон'],
  ['Apple', 'Apple TV', 'Apple TV+', 'Apple Studios', 'Apple Original Films', 'Эппл'],
  ['Disney', 'Disney+', 'Walt Disney', 'Walt Disney Pictures', 'Walt Disney Animation Studios', 'Disney Television Animation', 'Дисней'],
  ['HBO', 'HBO Max', 'Max', 'HBO Films', 'HBO Entertainment', 'Home Box Office'],
  ['Lionsgate', 'Lionsgate Films', 'Lionsgate Television', 'Lionsgate+', 'Lions Gate Films', 'Lionsgate Studios'],
  ['Netflix', 'Netflix Studios', 'Netflix Animation', 'Нетфликс'],
  ['Paramount', 'Paramount+', 'Paramount Pictures', 'Paramount Animation', 'Paramount Television', 'Paramount Television Studios', 'Paramount Players'],
  ['Sony', 'Sony Pictures', 'Sony Pictures Entertainment', 'Sony Pictures Television', 'Sony Pictures Animation', 'Sony Pictures Classics'],
  ['Universal', 'Universal Pictures', 'Universal Television', 'Universal Studios', 'Universal Pictures International'],
  ['Warner Bros.', 'Warner Bros. Pictures', 'Warner Bros. Television', 'Warner Bros. Animation', 'Warner Bros. Pictures Animation', 'WB']
];
function brandKey(name) {
  return name.trim().toLowerCase().replaceAll('.', '').replaceAll('+', ' plus').replace(/\s+/g, ' ');
}
const posterBrandRows = new Map();
posterBrandNames.forEach((aliases, row) => {
  for (const alias of aliases) posterBrandRows.set(brandKey(alias), row);
});
const listNames = { waiting: 'Жду', available: 'Новинки', backlog: 'Старое', watching: 'Смотрю сейчас', watched: 'Просмотрено', favorite: 'Любимые' };
const sortChoices = Object.fromEntries(Object.keys(listNames).map(list => [list, list === 'available' ? 'release-new' : 'added-new']));
const markActions = {
  watched: { add: 'Отметить просмотренным', remove: 'Снять отметку просмотра', icon: 'check' },
  favorite: { add: 'В любимые', remove: 'Убрать из любимых', icon: 'heart' },
  watching: { add: 'Смотрю сейчас', remove: 'Отложить просмотр', icon: 'play' }
};
const iconPaths = {
  barbell: '<path d="M3 10v4m3-7v10m3-12v14m0-7h6m0-7v14m3-12v10m3-7v4"/>',
  thumb: '<path d="M7 10v10H3V10zm0 0 5-6c1-1.3 3-.8 3 1.1L14 9h5.2a2 2 0 0 1 2 2.4l-1.4 6.8a2.2 2.2 0 0 1-2.2 1.8H7"/>',
  neutral: '<path d="M5 12h14"/>',
  quote: '<path d="M3 6h7v7a5 5 0 0 1-5 5m9-12h7v7a5 5 0 0 1-5 5"/>',
  book: '<path d="M12 6c-2.6-2.1-5.6-2.7-9-1.5v14c3.2-1 6.2-.4 9 1.5 2.8-1.9 5.8-2.5 9-1.5v-14c-3.4-1.2-6.4-.6-9 1.5Zm0 0v14"/>',
  ear: '<path d="M6 9a6 6 0 1 1 10.55 3.91c-1.29 1.54-2.3 2.33-2.55 4.09-.25 1.7-1.15 3-3 3-1.66 0-3-1.34-3-3m2-8a2 2 0 1 1 3.35 1.48c-.81.74-1.35 1.43-1.35 2.52"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  swap: '<path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4"/>',
  external: '<path d="M13 5h6v6m0-6-9 9m0-7H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4"/>',
  list: '<rect x="3.5" y="4.5" width="17" height="5" rx="1"/><rect x="3.5" y="14.5" width="17" height="5" rx="1"/>',
  grid: '<rect x="3.5" y="3.5" width="6" height="6" rx="1"/><rect x="14.5" y="3.5" width="6" height="6" rx="1"/><rect x="3.5" y="14.5" width="6" height="6" rx="1"/><rect x="14.5" y="14.5" width="6" height="6" rx="1"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
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
function icon(name) {
  const box = node('span', 'ico');
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + iconPaths[name] + '</svg>';
  return box;
}
function button(label, style, symbol, action, iconOnly = false) {
  const b = node('button', 'btn');
  if (style) b.classList.add(style);
  b.type = 'button';
  if (symbol) b.append(icon(symbol));
  if (iconOnly) {
    b.setAttribute('aria-label', label);
    b.title = label;
  } else b.append(label);
  b.addEventListener('click', action);
  return b;
}
function dateText(value) {
  if (!value) return 'Дата выхода уточняется';
  return formatDate.format(new Date(value + 'T12:00:00Z')).replace(/\s*г\.$/, '');
}
function calendarDay(now) {
  // Catalog dates have no time. Use the same UTC scale for the viewer's local date.
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}
function daysSince(date) {
  return (state.day - Date.parse(date)) / 86_400_000;
}
function favoriteMatchesList(item) {
  return marked(item.id, 'favorite') === (state.list === 'favorite');
}
function itemList(item) {
  if (marked(item.id, 'favorite')) return 'favorite';
  if (marked(item.id, 'watched')) return 'watched';
  if (marked(item.id, 'watching')) return 'watching';
  if (item.status === 'backlog') return 'backlog';
  const released = item.status === 'available' || daysSince(item.releaseDate) >= 0;
  return released ? 'available' : 'waiting';
}
function listMatches(item) {
  return state.list === itemList(item);
}
function isAnimated(item) {
  return item.genres.some(genre => animationGenres.has(genre.trim().toLowerCase()));
}
function matchesCategory(item) {
  if (state.list === 'waiting' && !item.releaseDate) return state.type === 'announcements';
  if (state.type === 'dorama') return item.type === 'series' && item.dorama === true;
  if (state.type === 'animation') return isAnimated(item);
  return state.type === 'all' || item.type === state.type;
}
function matchesFilters(item) {
  const ageDays = daysSince(item.addedDate);
  return listMatches(item) && matchesCategory(item)
    && (!state.genres.size || item.genres.some(genre => state.genres.has(genre)))
    && (!el('origin').value || item.origin === el('origin').value)
    && (!el('studio').value || item.studios.includes(el('studio').value) || item.platforms?.includes(el('studio').value))
    && (!el('minimum').value || (item.rating != null && item.rating >= Number(el('minimum').value)))
    && (!el('period').value || (ageDays >= 0 && ageDays < Number(el('period').value)));
}
function setupPageSort(select, choices, currentPage, feed, refresh) {
  const allowed = new Set([...select.options].map(option => option.value));
  for (const page of Object.keys(choices)) {
    try {
      const saved = localStorage.getItem(sortKeyPrefix + page);
      if (allowed.has(saved)) choices[page] = saved;
    } catch { /* Use the tab's choice when storage is unavailable. */ }
  }
  select.value = choices[currentPage()];
  select.onchange = () => {
    const page = currentPage();
    choices[page] = select.value;
    try { localStorage.setItem(sortKeyPrefix + page, select.value); }
    catch { /* Keep the in-memory choice for this tab. */ }
    refresh();
    feed.scrollTop = 0;
  };
  window.addEventListener('storage', ({ key, newValue }) => {
    if (!key?.startsWith(sortKeyPrefix) || !allowed.has(newValue)) return;
    const page = key.slice(sortKeyPrefix.length);
    if (!Object.hasOwn(choices, page)) return;
    choices[page] = newValue;
    if (page === currentPage()) {
      select.value = newValue;
      refresh();
    }
  });
}
function compare(a, b) {
  let sort = sortChoices[state.list];
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
function renderSeasons(item, openSeason = item.season) {
  const expanded = desktop.matches;
  const blocks = (item.seasons || []).map(season => {
    const block = node(expanded ? 'section' : 'details', 'season');
    const header = node(expanded ? 'h3' : 'summary');
    const label = node('span', '', season.number === 0 ? 'Спецвыпуски' : 'Сезон ' + season.number);
    label.append(node('small', '', (season.releaseDate ? 'Премьера · ' : '') + dateText(season.releaseDate)));
    header.append(label);
    if (!expanded) {
      block.name = 'season-choice';
      block.dataset.season = season.number;
      block.open = season.number === openSeason;
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
    } else {
      block.append(node('p', 'no-dates', 'Расписание серий пока не объявлено.'));
    }
    return block;
  });
  el('seasons').replaceChildren(...(blocks.length ? blocks : [node('p', 'no-dates', 'Расписание серий пока не объявлено.')]));
}
function showSchedule(item, openSeason) {
  scheduleItem = item;
  el('series-title').textContent = item.title;
  renderSeasons(item, openSeason);
  el('seasons').scrollTop = 0;
  el('schedule').showModal();
}
async function requestMarkAccess(ownerOnly = false, reason = '') {
  if (!shared) {
    announce('Редактирование доступно на основном сайте киносписка.');
    return false;
  }
  if (credential() && !reason) return true;
  const dialog = el('sync-dialog');
  if (dialog.open) return false;
  openKeyDialog(ownerOnly, reason);
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'connected'), { once: true }));
}
async function saveMark(id, kind, value, update) {
  try {
    await withLoading(setMark(id, kind, value));
  } finally {
    update();
  }
}
async function toggleMark(item, kind) {
  const value = !marked(item.id, kind);
  if (!await requestMarkAccess() || marked(item.id, kind) === value || busy(item.id, kind)) return;
  if (kind === 'watching' && marked(item.id, 'watched')) return;
  try {
    await saveMark(item.id, kind, value, render);
    announce((value ? 'Добавлено в «' : 'Убрано из «') + listNames[kind] + '»');
  } catch (error) {
    announce(error.message);
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
const synopsisObserver = new ResizeObserver(entries => requestAnimationFrame(() => {
  for (const { target } of entries) {
    if (!target.isConnected) continue;
    const limit = getComputedStyle(target);
    const maxHeight = parseFloat(limit.lineHeight) * Number(limit.getPropertyValue('--synopsis-lines'));
    target.nextElementSibling.hidden = target.scrollHeight <= Math.ceil(maxHeight);
  }
}));
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
function formatLabel(item) {
  const animated = isAnimated(item);
  let format = animated ? 'Мультфильм' : 'Фильм';
  if (item.type === 'series') {
    format = animated ? 'Мультсериал' : 'Сериал';
    if (item.dorama === true) format = 'Дорама';
    format += ' · Сезон ' + item.season;
  }
  return format;
}
function cardHeader(item) {
  const header = node('div', 'card-heading');
  const title = node('div');
  title.append(node('h2', '', item.title), node('p', 'kind', formatLabel(item)));
  header.append(title);
  if (item.rating != null) header.append(cardRating(item));
  return header;
}
function cardRating(item) {
  const score = node('div', 'rating');
  const source = item.ratingSource || 'Рейтинг';
  score.append(node('span', 'rating-source', source === 'IMDb сериала' ? 'IMDb' : source), node('strong', '', item.rating.toLocaleString('ru-RU')));
  if (source === 'IMDb сериала') score.append(node('small', '', 'Оценка сериала'));
  return score;
}
function posterBrand(item) {
  for (const [kind, names] of [['Платформа', item.platforms], ['Студия', item.studios]]) {
    for (const name of names || []) {
      const row = posterBrandRows.get(brandKey(name));
      if (row === undefined) continue;
      const label = kind + ' · ' + name;
      const badge = node('span', 'poster-brand');
      badge.dataset.brand = posterBrandNames[row][0];
      badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', label);
      badge.title = label;
      badge.style.setProperty('--brand-row', row);
      return badge;
    }
  }
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
const opinions = { like: 'Понравилось', neutral: 'Нейтрально', dislike: 'Не понравилось' };
function reactionButtons(item, compact = false) {
  const group = node('div', 'reactions');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Моя оценка');
  const current = reactionValue(item.id);
  for (const [value, label] of Object.entries(opinions)) {
    const control = button(label, '', value === 'neutral' ? 'neutral' : 'thumb', async () => {
      if (!await requestMarkAccess() || !marked(item.id, 'watched') || busy(item.id, 'reaction')) return;
      const next = reactionValue(item.id) === value ? null : value;
      try {
        await saveMark(item.id, 'reaction', next, render);
        announce(next ? 'Моя оценка · ' + label : 'Оценка снята');
      } catch (error) {
        announce(error.message);
      }
    }, compact);
    control.dataset.kind = value;
    control.setAttribute('aria-pressed', String(current === value));
    control.disabled = busy(item.id, 'reaction');
    group.append(control);
  }
  return group;
}
function cardHistory(item) {
  const section = node('section', 'card-history');
  const dates = node('dl');
  row(dates, 'Добавлено в каталог', dated(item.addedDate, dateText(item.addedDate)));
  const watched = marked(item.id, 'watched');
  const events = [['watching', 'Начало просмотра'], ['watched', 'Отмечено просмотренным'], ['favorite', 'Добавлено в любимые']];
  if (watched) events.push(['reaction', 'Дата оценки']);
  for (const [kind, label] of events) {
    const stamp = markTime(item.id, kind);
    if (stamp === null) continue;
    const date = /^\d{4}-\d{2}-\d{2}T/.test(stamp) ? new Date(stamp) : null;
    row(dates, label, date && Number.isFinite(date.getTime()) ? dated(stamp, formatMarkDate.format(date).replace(/\s*г\.$/, '')) : 'Дата неизвестна');
  }
  section.append(node('h3', 'sr', 'История'), dates);
  if (watched) section.append(reactionButtons(item));
  return section;
}
function yandexSearchUrl(item) {
  const series = item.type === 'series';
  const terms = [item.title, series ? 'сериал' : 'фильм'];
  if (item.releaseDate) terms.push(item.releaseDate.slice(0, 4));
  if (series && item.season > 1) terms.push(item.season + ' сезон');
  terms.push('смотреть');
  const url = new URL('https://yandex.ru/search/');
  url.searchParams.set('text', terms.join(' '));
  return url.href;
}
function externalLink(label, symbol, href, title, compact) {
  const link = node('a', 'btn');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = title;
  link.append(icon(symbol));
  if (compact) link.setAttribute('aria-label', title);
  else link.append(label);
  return link;
}
function isRecent(item) {
  const age = daysSince(item.releaseDate);
  return age >= 0 && age < 10;
}
function entryFrame(item, className) {
  const section = node('article', className);
  section.dataset.id = item.id;
  section.classList.toggle('recent-release', isRecent(item));
  return section;
}
function releaseDate(item, compact = false) {
  const date = node('div', compact ? 'poster-date' : 'date');
  date.append(icon('calendar'));
  if (!item.releaseDate) {
    date.append(node(compact ? 'span' : 'strong', '', dateText(null)));
    return date;
  }
  if (isRecent(item)) date.append(node('span', 'sr', 'Недавняя премьера.'));
  const value = node(compact ? 'span' : 'strong');
  value.append(dated(item.releaseDate, dateText(item.releaseDate)));
  date.append(node('span', compact ? 'sr' : '', 'Дата выхода'), value);
  return date;
}
function mediaActions(item) {
  const links = node('div', 'media-actions');
  links.setAttribute('role', 'group');
  links.setAttribute('aria-label', 'Информация о проекте');
  if (item.type === 'series') {
    const calendar = button('Сезоны и серии', '', 'calendar', () => showSchedule(item));
    calendar.setAttribute('aria-haspopup', 'dialog');
    calendar.setAttribute('aria-controls', 'schedule');
    links.append(calendar);
  }
  if (item.trailer) {
    const platform = item.trailer.startsWith('https://rutube.ru/') ? 'Rutube' : 'YouTube';
    links.append(externalLink('Трейлер', 'play', item.trailer, 'Трейлер «' + item.title + '» на ' + platform + ' в новой вкладке'));
  }
  links.append(externalLink('Найти', 'search', yandexSearchUrl(item), 'Найти «' + item.title + '» в Яндексе в новой вкладке'));
  return links;
}
function cardMarks(item, { kinds = Object.keys(markActions), iconsOnly = false } = {}) {
  const marks = node('div', 'card-marks');
  marks.setAttribute('role', 'group');
  marks.setAttribute('aria-label', 'Мои отметки');
  for (const kind of kinds) {
    const { add, remove, icon } = markActions[kind];
    const finished = kind === 'watching' && marked(item.id, 'watched');
    const active = !finished && marked(item.id, kind);
    const compact = iconsOnly || kind !== 'watching';
    const mark = button(active ? remove : add, 'mark', icon, () => toggleMark(item, kind), compact);
    mark.dataset.kind = kind;
    mark.disabled = finished || busy(item.id, kind);
    if (finished) mark.title = 'Сначала снимите отметку «Просмотрено»';
    mark.setAttribute('aria-pressed', String(active));
    marks.append(mark);
  }
  return marks;
}
function card(item) {
  const section = entryFrame(item, 'entry');
  const copy = node('div', 'copy');
  const actions = node('div', 'actions');
  actions.append(mediaActions(item), cardMarks(item));
  copy.append(cardHeader(item), releaseDate(item), synopsis(item), metadata(item), cardHistory(item), actions);
  section.append(gallery(item), copy);
  return section;
}
function posterCard(item) {
  const section = entryFrame(item, 'poster-card');
  const image = node('div', 'poster-image');
  const src = item.poster || item.gallery?.[0];
  if (src) {
    const img = node('img');
    img.alt = '';
    img.decoding = 'async';
    img.src = src;
    image.append(img);
  }
  const brand = posterBrand(item);
  if (brand) image.append(brand);
  if (item.rating != null) image.append(cardRating(item));
  const caption = node('div', 'poster-caption');
  const heading = node('h2');
  const open = node('button', 'poster-open');
  open.type = 'button';
  open.setAttribute('aria-haspopup', 'dialog');
  open.setAttribute('aria-controls', 'film-details');
  if (item.type === 'series') {
    const season = 'Сезон ' + item.season;
    const badge = node('span', 'poster-season', season);
    badge.setAttribute('aria-hidden', 'true');
    image.append(badge);
    open.setAttribute('aria-label', item.title + ' · ' + season);
  }
  open.append(node('span', '', item.title), icon('chevron'));
  open.onclick = () => showDetails(item);
  heading.append(open);
  const meta = node('div', 'poster-meta');
  meta.append(releaseDate(item, true), cardMarks(item, { kinds: ['favorite', 'watched'] }));
  caption.append(heading, node('p', 'poster-genres', item.genres.join(' · ')), meta);
  if (marked(item.id, 'watched')) caption.append(reactionButtons(item, true));
  section.append(image, caption);
  return section;
}

// The catalog objects live for the lifetime of the page. Each layout needs at
// most one card per title, even when a mark moves it to a different section.
const listCards = new WeakMap();
const gridCards = new WeakMap();
const historyKinds = [...Object.keys(markActions), 'reaction'];
function feedCard(item, grid) {
  const cache = grid ? gridCards : listCards;
  const history = JSON.stringify([reactionValue(item.id), ...historyKinds.map(kind =>
    [markTime(item.id, kind), busy(item.id, kind)])]);
  let saved = cache.get(item);
  if (!saved) {
    saved = { element: grid ? posterCard(item) : card(item), history };
    cache.set(item, saved);
  }
  const section = saved.element;
  if (saved.history !== history) {
    section.querySelector('.card-marks').replaceWith(cardMarks(item, grid ? { kinds: ['favorite', 'watched'] } : undefined));
    if (grid) {
      section.querySelector('.reactions')?.remove();
      if (marked(item.id, 'watched')) section.querySelector('.poster-caption').append(reactionButtons(item, true));
    } else {
      section.querySelector('.card-history').replaceWith(cardHistory(item));
    }
    saved.history = history;
  }
  if (section.classList.contains('recent-release') !== isRecent(item)) {
    section.classList.toggle('recent-release', isRecent(item));
    section.querySelector(grid ? '.poster-date' : '.date').replaceWith(releaseDate(item, grid));
  }
  return section;
}

function displayCards(container, cards) {
  const wanted = new Set(cards);
  for (const child of Array.from(container.children)) {
    if (!wanted.has(child)) child.remove();
  }
  let next = container.firstElementChild;
  for (const card of cards) {
    if (card === next) next = next.nextElementSibling;
    else container.insertBefore(card, next);
  }
}

// Leave visited feeds mounted. Only the visible panel is the target of the
// search control, keyboard focus and scroll restoration.
const feedPanels = new Map();
function showFeedPanel(key) {
  const current = el('records');
  if (!feedPanels.size) feedPanels.set(key, current);
  let panel = feedPanels.get(key);
  if (!panel) {
    panel = node('div');
    current.after(panel);
    feedPanels.set(key, panel);
  }
  if (current !== panel) {
    current.hidden = true;
    current.removeAttribute('id');
    panel.id = 'records';
    panel.hidden = false;
  }
  return panel;
}
function showDetails(item) {
  const dialog = el('film-details');
  detailItem = item;
  const head = cardHeader(item);
  head.querySelector('h2').id = 'film-title';
  el('film-heading').replaceChildren(head);
  const copy = node('div', 'copy');
  copy.append(releaseDate(item), node('p', 'synopsis', item.description), metadata(item), cardHistory(item));
  const body = dialog.querySelector('.film-body');
  body.replaceChildren(gallery(item), copy);
  dialog.querySelector('.film-foot').replaceChildren(mediaActions(item), cardMarks(item));
  dialog.showModal();
  body.scrollTop = 0;
}
function wishImage(item) {
  const frame = node('div', 'wish-image');
  if (item.image) {
    const image = node('img');
    image.src = item.image;
    image.alt = '';
    image.decoding = 'async';
    frame.append(image);
  }
  return frame;
}
async function toggleWish(item) {
  const fulfilled = !marked(item.id, 'fulfilled');
  if (!await requestMarkAccess() || marked(item.id, 'fulfilled') === fulfilled || busy(item.id, 'fulfilled')) return;
  try {
    await saveMark(item.id, 'fulfilled', fulfilled, renderWishlist);
    announce(fulfilled ? 'Добавлено в «Сбылось»' : 'Возвращено в «Хочу»');
  } catch (error) {
    announce(error.message);
  }
}
function wishActions(item, compact) {
  const actions = node('div', 'wish-actions');
  const fulfilled = marked(item.id, 'fulfilled');
  if (item.url) actions.append(externalLink('Открыть ссылку', 'external', item.url, 'Открыть ссылку на «' + item.title + '» в новой вкладке', compact));
  const mark = button(fulfilled ? 'Вернуть в «Хочу»' : 'Отметить исполненным', '', 'check', () => toggleWish(item), compact);
  mark.dataset.wishMark = item.id;
  mark.setAttribute('aria-pressed', String(fulfilled));
  mark.disabled = busy(item.id, 'fulfilled');
  actions.append(mark);
  return actions;
}
function wishCard(item) {
  const card = node('article', 'wish-card');
  const caption = node('div', 'wish-caption');
  const title = node('h2');
  const open = node('button', 'wish-open', item.title);
  open.type = 'button';
  open.setAttribute('aria-haspopup', 'dialog');
  open.setAttribute('aria-controls', 'wish-details');
  open.append(icon('chevron'));
  open.onclick = () => showWishDetails(item);
  title.append(open);
  caption.append(title);
  if (item.note) caption.append(node('p', 'wish-note', item.note));
  const meta = node('div', 'wish-meta');
  if (item.budget != null) meta.append(node('p', 'wish-budget', 'До ' + formatBudget.format(item.budget)));
  meta.append(wishActions(item, true));
  caption.append(meta);
  if (item.image) card.append(wishImage(item));
  card.append(caption);
  return card;
}
function showWishDetails(item) {
  const dialog = el('wish-details');
  const opener = document.activeElement;
  wishes.detail = item;
  el('wish-title').textContent = item.title;
  el('wish-category').textContent = el('wish-categories').querySelector('[data-wish-category="' + item.category + '"]').textContent;
  const copy = node('div', 'wish-detail-copy');
  if (item.note) copy.append(node('p', 'wish-detail-note', item.note));
  if (item.description) copy.append(node('p', '', item.description));
  if (item.budget != null) copy.append(node('p', 'wish-budget', 'До ' + formatBudget.format(item.budget)));
  copy.append(node('p', 'wish-added', 'Добавлено ' + dateText(item.addedDate)));
  const body = dialog.querySelector('.wish-detail-body');
  body.replaceChildren(...(item.image ? [wishImage(item), copy] : [copy]));
  dialog.querySelector('.wish-detail-foot').replaceChildren(wishActions(item, false));
  dialog.addEventListener('close', () => {
    const returnTo = opener.isConnected ? opener : el('wish-status').querySelector('[aria-pressed="true"]');
    returnTo.focus({ preventScroll: true });
  }, { once: true });
  dialog.showModal();
  body.scrollTop = 0;
}
function renderWishlist() {
  if (!wishes.items) return;
  const dialog = el('wish-details');
  const focused = document.activeElement;
  const markId = focused?.dataset.wishMark;
  const fulfilled = wishes.status === 'fulfilled';
  const records = el('wish-records');
  const results = wishes.items.filter(item => marked(item.id, 'fulfilled') === fulfilled
    && (wishes.category === 'all' || item.category === wishes.category));
  const sort = el('wish-sort').value;
  results.sort((a, b) => {
    if (sort === 'budget') return (a.budget ?? Infinity) - (b.budget ?? Infinity) || collator.compare(a.title, b.title);
    if (sort === 'title') return collator.compare(a.title, b.title);
    return b.addedDate.localeCompare(a.addedDate);
  });
  records.classList.toggle('wish-list', wishes.layout === 'list');
  const emptyMessage = wishes.category !== 'all' ? 'В этой категории пока нет желаний'
    : fulfilled ? 'Пока нет исполненных желаний' : 'В вишлисте пока пусто';
  records.replaceChildren(...(results.length ? results.map(wishCard) : [node('h2', 'empty wish-message', emptyMessage)]));
  if (dialog.open) dialog.querySelector('.wish-detail-foot').replaceChildren(wishActions(wishes.detail, false));
  if (markId) {
    const scope = dialog.open ? dialog : records;
    const mark = scope.querySelector('[data-wish-mark="' + markId + '"]:not(:disabled)');
    if (mark) mark.focus({ preventScroll: true });
    else if (!dialog.open && !el('wishlist').hidden) el('wish-status').querySelector('[aria-pressed="true"]').focus({ preventScroll: true });
  }
}
async function readCollectionFile(file, controller = new AbortController()) {
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(file, { cache: 'no-cache', signal: controller.signal });
    if (!response.ok) throw new Error('Не удалось загрузить список.');
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
async function loadWishlist() {
  if (wishes.items || wishes.loading) return;
  wishes.loading = true;
  const records = el('wish-records');
  records.replaceChildren(node('p', 'loading wish-message', 'Загрузка вишлиста…'));
  try {
    const embedded = el('offline-wishlist');
    if (embedded) wishes.items = JSON.parse(embedded.textContent);
    else wishes.items = await withLoading(readCollectionFile('./wishlist.json'));
    renderWishlist();
  } catch {
    wishes.items = null;
    const failure = node('section', 'empty wish-message');
    failure.append(node('h2', '', 'Не удалось открыть вишлист'), button('Повторить', '', null, loadWishlist));
    records.replaceChildren(failure);
  } finally {
    wishes.loading = false;
  }
}
function setupWishlist() {
  try { if (localStorage.getItem(wishLayoutKey) === 'list') wishes.layout = 'list'; }
  catch { /* The layout can still be changed for this tab. */ }
  const controls = [
    ['wish-status', 'wishStatus', 'status'],
    ['wish-categories', 'wishCategory', 'category'],
    ['wish-layouts', 'wishLayout', 'layout']
  ];
  for (const [id, attribute, key] of controls) {
    const group = el(id);
    const reflect = () => {
      for (const button of group.children) button.setAttribute('aria-pressed', String(button.dataset[attribute] === wishes[key]));
    };
    reflect();
    group.onclick = event => {
      const value = event.target.closest('button')?.dataset[attribute];
      if (!value || value === wishes[key]) return;
      wishes[key] = value;
      if (key === 'status') el('wish-sort').value = wishSortChoices[value];
      if (key === 'layout') {
        try { localStorage.setItem(wishLayoutKey, value); }
        catch { /* The layout can still be changed for this tab. */ }
      }
      reflect();
      renderWishlist();
      el('wish-feed').scrollTop = 0;
    };
  }
  setupPageSort(el('wish-sort'), wishSortChoices, () => wishes.status, el('wish-feed'), renderWishlist);
}
const quoteKinds = {
  film: ['Фильм', 'play'],
  book: ['Книга', 'book'],
  heard: ['Где-то услышал', 'ear']
};
function quoteCard(quote) {
  const card = node('figure', 'quote-card');
  const [label, symbol] = quoteKinds[quote.category];
  card.dataset.quoteKind = quote.category;
  const type = node('p', 'quote-label');
  type.append(icon(symbol), label);

  const block = node('blockquote');
  const text = quote.text.trim();
  const display = /^[«“"]/.test(text) ? text : text.endsWith('.') ? '«' + text.slice(0, -1) + '».' : '«' + text + '»';
  block.append(node('p', '', display));

  const caption = node('figcaption', 'quote-caption');
  const source = node('div');
  if (quote.url?.startsWith('https://')) {
    const link = node('a', 'quote-source', quote.source || 'Источник');
    link.href = quote.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(icon('external'));
    source.append(link);
    block.cite = quote.url;
  } else if (quote.source) source.append(node('p', 'quote-source', quote.source));
  if (quote.author) source.append(node('p', 'quote-author', quote.author));
  const copy = button('Копировать цитату', 'quote-copy', 'copy', async () => {
    try {
      await navigator.clipboard.writeText(text);
      announce('Цитата скопирована');
    } catch {
      announce('Не удалось скопировать цитату.');
    }
  }, true);
  caption.append(source, copy);
  card.append(type, block, caption);
  return card;
}
function setupQuotes() {
  const search = el('quote-search');
  const categories = el('quote-categories');
  const records = el('quote-records');
  let entries = null;
  let category = 'all';

  function renderQuotes() {
    if (!entries) return;
    const query = search.value.trim().toLocaleLowerCase('ru');
    const result = entries.filter(quote => (category === 'all' || quote.category === category)
      && [quote.text, quote.source, quote.author].join(' ').toLocaleLowerCase('ru').includes(query));
    const message = !entries.length ? 'Пока нет цитат'
      : query ? 'Ничего не найдено' : 'В этой категории пока нет цитат';
    records.replaceChildren(...(result.length ? result.map(quoteCard) : [node('h2', 'empty quote-empty', message)]));
  }
  function chooseCategory(value) {
    category = value;
    for (const option of categories.children) option.setAttribute('aria-pressed', String(option.dataset.quoteCategory === category));
    renderQuotes();
    el('quote-feed').scrollTop = 0;
  }
  categories.onclick = event => {
    const value = event.target.closest('button')?.dataset.quoteCategory;
    if (value) chooseCategory(value);
  };
  search.oninput = () => {
    renderQuotes();
    el('quote-feed').scrollTop = 0;
  };
  return {
    open(quotes) {
      if (!Array.isArray(quotes)) throw new Error('Неверный формат каталога цитат.');
      entries = quotes;
      renderQuotes();
    },
    lock() {
      entries = null;
      search.value = '';
      records.replaceChildren();
      chooseCategory('all');
    }
  };
}
function setupCollections() {
  const feed = el('feed');
  const lists = el('lists');
  const wishFeed = el('wish-feed');
  const skip = document.querySelector('.skip');
  const screens = {
    cinema: { surfaces: [el('cinema-header'), feed], feed, focus: el('open-wishlist'), title: 'Мой киносписок', skipText: 'К фильмам и сериалам' },
    wishlist: { surfaces: [el('wishlist')], feed: wishFeed, focus: el('open-cinema'), title: 'Мой вишлист', skipText: 'К желаниям' },
    training: { surfaces: [el('training')], feed: el('training-feed'), focus: el('training-heading'), title: 'Тренировки', skipText: 'К тренировкам' },
    quotes: { surfaces: [el('quotes')], feed: el('quote-feed'), focus: el('quotes-heading'), title: 'Мои цитаты', skipText: 'К цитатам' }
  };
  const positions = { cinema: 0, wishlist: 0, quotes: 0, training: 0 };
  let current = 'cinema';
  let listScroll = 0;
  const quotes = setupQuotes();
  const workouts = setupTraining({ setupNutrition, el, node, button, announce, withLoading, credential, savePrivateFile });
  let navigation = 0;
  let activeKey;
  function isPrivate(name) { return name === 'quotes' || name === 'training'; }
  async function navigate(next) {
    const attempt = ++navigation;
    if (!isPrivate(next)) return show(next);
    if (!await requestMarkAccess(true) || attempt !== navigation) return;
    const token = credential();
    try {
      const file = await withLoading((async () => {
        await verifyOwner(token);
        return next === 'quotes' ? openPrivateFile(token, 'quotes.json', () => [])
          : openPrivateFile(token, 'training.json', emptyTraining);
      })());
      if (attempt !== navigation || token !== credential()) return;
      if (next === 'quotes') quotes.open(file.data);
      else workouts.open(file);
      show(next);
      activeKey = token;
    } catch (error) {
      if (attempt !== navigation) return;
      if (error instanceof KeyError) {
        if (await requestMarkAccess(true, error.message) && attempt === navigation) return navigate(next);
      } else announce(error.message);
    }
  }
  function show(next) {
    if (current === next) return;
    if (current === 'cinema') {
      if (state.catalog.length) saveView();
      listScroll = lists.scrollLeft;
    }
    const previous = screens[current];
    positions[current] = current === 'quotes' ? 0 : previous.feed.scrollTop;
    for (const surface of previous.surfaces) surface.hidden = true;
    if (current === 'quotes') quotes.lock();
    if (current === 'training') workouts.lock();
    activeKey = null;
    current = next;
    const screen = screens[current];
    for (const surface of screen.surfaces) surface.hidden = false;
    screen.feed.scrollTop = positions[current];
    if (current === 'cinema') lists.scrollLeft = listScroll;
    skip.href = '#' + screen.feed.id;
    skip.textContent = screen.skipText;
    document.title = screen.title;
    screen.focus.focus({ preventScroll: true });
    if (current === 'wishlist') loadWishlist();
  }
  for (const button of document.querySelectorAll('[data-collection]')) {
    const next = button.dataset.collection;
    button.onclick = () => navigate(next);
  }
  function lockPrivate() {
    navigation++;
    if (isPrivate(current)) show('cinema');
  }
  window.addEventListener('pagehide', lockPrivate);
  window.addEventListener('storage', () => { if (activeKey && activeKey !== credential()) lockPrivate(); });
  window.addEventListener('writer-key-removed', lockPrivate);
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !activeKey) return;
    const key = activeKey;
    try {
      if (key !== credential()) return lockPrivate();
      await verifyOwner(key);
    } catch { if (key === activeKey) lockPrivate(); }
  });
}
function resetFilters() {
  for (const id of filterIds) el(id).value = '';
  state.type = 'all';
  state.genres.clear();
  reflectControls();
  render();
}
function empty() {
  const box = node('section', 'empty');
  if (state.type === 'announcements' && !state.catalog.some(item => listMatches(item) && matchesCategory(item))) {
    box.append(node('h2', '', 'Пока нет анонсов'), node('p', '', 'Здесь появятся фильмы и сезоны без точной даты выхода.'));
    return box;
  }
  if (state.type === 'dorama' && !state.catalog.some(item => listMatches(item) && matchesCategory(item))) {
    box.append(node('h2', '', 'В этой ленте пока нет дорам'));
    return box;
  }
  const hints = {
    waiting: 'Здесь появятся будущие премьеры.',
    available: 'Здесь появятся фильмы и сезоны, которые уже вышли.',
    backlog: 'Здесь появятся фильмы и сезоны прошлых лет, отложенные на потом.',
    watching: 'Нажмите «Смотрю сейчас» на карточке фильма или сезона, который начали смотреть.',
    watched: 'Нажмите галочку на карточке просмотренного фильма или сезона.',
    favorite: 'Нажмите сердце на карточке фильма или сезона.'
  };
  const filteredOut = state.catalog.some(listMatches);
  const title = filteredOut ? 'Нет совпадений' : 'В списке пока пусто';
  const hint = filteredOut ? 'Попробуйте изменить фильтры или выбрать другую категорию.' : hints[state.list];
  box.append(node('h2', '', title), node('p', '', hint));
  return box;
}
function reflectControls() {
  const showAnnouncements = state.list === 'waiting';
  el('announcements-type').hidden = !showAnnouncements;
  if (!showAnnouncements && state.type === 'announcements') state.type = 'all';
  for (const b of document.querySelectorAll('[data-list]')) b.setAttribute('aria-pressed', String(b.dataset.list === state.list));
  for (const b of document.querySelectorAll('[data-type]')) b.setAttribute('aria-pressed', String(b.dataset.type === state.type));
  for (const b of document.querySelectorAll('[data-genre]')) {
    const genre = b.dataset.genre;
    const active = genre ? state.genres.has(genre) : !state.genres.size;
    b.setAttribute('aria-pressed', String(active));
    if (b.classList.contains('selected-genre')) b.hidden = !active;
  }
  for (const option of el('genre-select').options) {
    if (option.hidden) continue;
    const active = option.value ? state.genres.has(option.value) : !state.genres.size;
    option.textContent = (active ? '✓ ' : '') + (option.value || 'Все жанры');
  }
  el('selected-genres').hidden = !state.genres.size;
  el('feed').setAttribute('aria-label', 'Лента · ' + listNames[state.list]);
  reflectSort();
}
function reflectSort() {
  const sort = el('sort');
  sort.value = sortChoices[state.list];
  const width = sort.selectedOptions[0].textContent.length * 8.25 + 32;
  sort.style.setProperty('--sort-width', Math.min(236, width) + 'px');
}
let lastSavedFeed;
function saveTabView(view) {
  try { sessionStorage.setItem(viewKey, JSON.stringify(view)); }
  catch { /* The catalog also works without browser storage. */ }
}
function dialogView() {
  const dialog = document.querySelector('#filters[open], #schedule[open]');
  const openSeason = el('seasons').querySelector('details[open]');
  return {
    detail: el('film-details').open ? detailItem.id : undefined,
    detailScroll: el('film-details').querySelector('.film-body').scrollTop,
    dialog: dialog?.id, dialogScroll: dialog?.querySelector('.dialog-body').scrollTop,
    series: dialog?.id === 'schedule' ? scheduleItem.id : undefined,
    season: desktop.matches ? undefined : openSeason ? Number(openSeason.dataset.season) : null
  };
}
function saveView({ initial = false } = {}) {
  const feed = el('feed');
  if (feed.hidden) return;
  if (viewBeforeSearch) {
    saveTabView({ ...viewBeforeSearch, search: { query: el('catalog-query').value, scrollTop: feed.scrollTop, ...dialogView() } });
    return;
  }
  const top = feed.getBoundingClientRect().top;
  const first = [...el('records').children].find(card => card.dataset.id && card.getBoundingClientRect().bottom > top);
  const view = {
    list: state.list, type: state.type, sorts: sortChoices,
    genres: [...state.genres],
    filters: Object.fromEntries(filterIds.map(id => [id, el(id).value])),
    expanded: [...expandedDescriptions], scrollTop: feed.scrollTop, listScroll: el('lists').scrollLeft,
    card: first?.dataset.id, offset: first ? top - first.getBoundingClientRect().top : 0
  };
  const feedJson = JSON.stringify(view);
  if (feedJson !== lastSavedFeed) {
    try {
      // Loading an existing tab should not replace another tab's latest choices.
      if (!initial || localStorage.getItem(persistentViewKey) === null) {
        localStorage.setItem(persistentViewKey, feedJson);
      }
      lastSavedFeed = feedJson;
    } catch { /* A tab snapshot may still be available. */ }
  }
  saveTabView({ ...view, ...dialogView() });
  return view;
}
function readSavedView() {
  let tabView;
  try { tabView = JSON.parse(sessionStorage.getItem(viewKey)); }
  catch { /* Try the browser's saved feed. */ }
  const navigation = performance.getEntriesByType('navigation')[0]?.type;
  if (tabView && navigation !== 'navigate') return tabView;
  try {
    const feed = JSON.parse(localStorage.getItem(persistentViewKey));
    if (feed) return feed;
  } catch { /* Older versions saved the view only in this tab. */ }
  return tabView;
}
function trackView() {
  // These bubble after the controls have applied their changes.
  document.addEventListener('click', saveView);
  document.addEventListener('change', saveView);
  document.addEventListener('close', saveView, true);
  document.addEventListener('toggle', saveView, true);
  let scrollTimer;
  function flush() {
    clearTimeout(scrollTimer);
    scrollTimer = undefined;
    saveView();
  }
  document.addEventListener('scroll', () => {
    if (scrollTimer === undefined) scrollTimer = setTimeout(flush, 180);
  }, { capture: true, passive: true });
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
}
function restoreChoices(view, availableGenres) {
  if (Object.hasOwn(listNames, view.list)) state.list = view.list;
  if ([...el('types').children].some(button => button.dataset.type === view.type)) state.type = view.type;
  const savedGenres = Array.isArray(view.genres) ? view.genres : [view.filters?.genre];
  state.genres = new Set(savedGenres.filter(genre => availableGenres.has(genre)));
  const savedSorts = view.sorts ?? {
    other: view.sort,
    available: view.list === 'available' && view.sort !== 'added-new' ? view.sort : undefined
  };
  const validSorts = new Set([...el('sort').options].map(option => option.value));
  for (const list of Object.keys(sortChoices)) {
    const value = savedSorts[list] ?? (list !== 'available' ? savedSorts.other : undefined);
    if (validSorts.has(value)) sortChoices[list] = value;
  }
  for (const id of filterIds) {
    const select = el(id);
    const value = view.filters?.[id];
    if ([...select.options].some(option => option.value === value)) select.value = value;
  }
  if (Array.isArray(view.expanded)) {
    for (const id of view.expanded) expandedDescriptions.add(id);
  }
}
function restoreFeed(view) {
  const feed = el('feed');
  const records = el('records');
  function align() {
    const card = typeof view.card === 'string' && records.querySelector('[data-id="' + CSS.escape(view.card) + '"]');
    if (card) {
      const delta = card.getBoundingClientRect().top - feed.getBoundingClientRect().top;
      feed.scrollTop += delta + Math.min(view.offset || 0, card.offsetHeight - 1);
    } else feed.scrollTop = view.scrollTop || 0;
  }
  align();
  // Posters and expanded descriptions can change the heights above the saved card.
  const observer = new ResizeObserver(align);
  observer.observe(records);
  const controller = new AbortController();
  function stop() {
    observer.disconnect();
    controller.abort();
  }
  for (const event of ['pointerdown', 'wheel', 'touchstart', 'keydown', 'pagehide']) {
    window.addEventListener(event, stop, { capture: true, passive: true, signal: controller.signal });
  }
}
function restoreDialogs(view) {
  if (view.detail && (viewBeforeSearch || (desktop.matches && layout === 'grid'))) {
    const item = state.catalog.find(item => item.id === view.detail);
    if (item && (viewBeforeSearch || busy(item.id, 'favorite') || favoriteMatchesList(item))) {
      showDetails(item);
      el('film-details').querySelector('.film-body').scrollTop = view.detailScroll || 0;
    }
  }
  if (view.dialog === 'filters') {
    el('filters-open').focus({preventScroll:true});
    el('filters').showModal();
  } else if (view.dialog === 'schedule') {
    const item = state.catalog.find(item => item.id === view.series && item.type === 'series');
    if (item) {
      const section = el('film-details').open ? el('film-details') : el('records').querySelector('[data-id="' + CSS.escape(item.id) + '"]');
      section?.querySelector('[aria-controls="schedule"]')?.focus({preventScroll:true});
      showSchedule(item, view.season);
    }
  }
  const body = el(view.dialog)?.querySelector('.dialog-body');
  if (body) body.scrollTop = view.dialogScroll || 0;
}
function searchText(text) {
  return text.toLowerCase().replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function searchResult(item) {
  const row = node('article', 'search-result');
  row.dataset.id = item.id;
  const src = item.poster || item.gallery?.[0];
  if (src) {
    const img = node('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = src;
    row.append(img);
  }
  const info = node('div', 'search-result-info');
  const list = itemList(item);
  const location = list === 'waiting' && !item.releaseDate ? 'Жду · Анонсы' : listNames[list];
  const heading = node('h2');
  const open = node('button', 'search-result-open', item.title);
  open.type = 'button';
  open.setAttribute('aria-haspopup', 'dialog');
  open.setAttribute('aria-controls', 'film-details');
  const meta = node('p', '', [formatLabel(item), location, dateText(item.releaseDate)].join(' · '));
  meta.id = 'search-meta-' + item.id;
  open.setAttribute('aria-describedby', meta.id);
  open.append(icon('chevron'));
  open.onclick = () => showDetails(item);
  heading.append(open);
  info.append(heading, meta);
  const actions = node('div', 'search-result-actions');
  if (desktop.matches) actions.append(mediaActions(item));
  actions.append(cardMarks(item, { iconsOnly: true }));
  if (desktop.matches && marked(item.id, 'watched')) actions.append(reactionButtons(item, true));
  row.append(info, actions);
  return row;
}
function renderSearch() {
  const query = searchText(el('catalog-query').value);
  const terms = query.split(' ');
  const result = query ? state.catalog.filter(item => {
    const title = searchText(item.title + (item.type === 'series' ? ' сезон ' + item.season : ''));
    return terms.every(term => title.includes(term));
  }).sort((a, b) => collator.compare(a.title, b.title) || (a.season || 0) - (b.season || 0)) : [];
  el('search-status').textContent = !query ? 'Введите название фильма или сериала.' :
    result.length ? 'Найдено совпадений: ' + result.length : 'Ничего не найдено. Попробуйте другое название.';
  const records = showFeedPanel('search');
  const focused = document.activeElement;
  const id = focused.closest('.search-result')?.dataset.id;
  records.replaceChildren(...result.map(searchResult));
  if (id && focused.dataset.kind) {
    const row = records.querySelector('[data-id="' + CSS.escape(id) + '"]');
    const mark = row?.querySelector('[data-kind="' + focused.dataset.kind + '"]:enabled');
    (mark || row?.querySelector('button:enabled') || el('catalog-query')).focus({ preventScroll: true });
  }
}
function setSearchOpen(open) {
  el('catalog-search').hidden = !open;
  el('search-status').hidden = !open;
  el('search-toggle').setAttribute('aria-expanded', String(open));
  const controls = el('cinema-header').querySelectorAll('#list-navigation, #types, #genres, #selected-genres, .tools > :not(#search-toggle)');
  for (const control of controls) control.inert = open;
  el('feed').setAttribute('aria-label', open ? 'Результаты поиска по киносписку' : 'Лента · ' + listNames[state.list]);
}
function openSearch(base = saveView(), search = {}) {
  viewBeforeSearch = base;
  const input = el('catalog-query');
  input.value = search.query || '';
  setSearchOpen(true);
  renderSearch();
  el('feed').scrollTop = search.scrollTop || 0;
  input.focus({ preventScroll: true });
  restoreDialogs(search);
}
function closeSearch() {
  const base = viewBeforeSearch;
  viewBeforeSearch = undefined;
  setSearchOpen(false);
  el('catalog-query').value = '';
  render();
  restoreFeed(base);
  el('search-toggle').focus({ preventScroll: true });
  saveView();
}
function setupSearch() {
  el('search-toggle').onclick = () => viewBeforeSearch ? closeSearch() : openSearch();
  el('search-close').onclick = closeSearch;
  el('catalog-query').oninput = () => {
    renderSearch();
    el('feed').scrollTop = 0;
    saveView();
  };
  document.addEventListener('keydown', event => {
    if (viewBeforeSearch && event.key === 'Escape' && !event.isComposing && !event.defaultPrevented && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      closeSearch();
    }
  });
}
function renderFeed() {
  const focused = document.activeElement;
  const kind = focused?.dataset.kind;
  const id = focused?.closest('.entry, .poster-card')?.dataset.id;
  const result = state.catalog.filter(matchesFilters).sort(compare);
  const count = filterIds.filter(id => el(id).value).length;
  el('filter-count').hidden = !count; el('filter-count').textContent = count;
  el('apply').textContent = 'Показать (' + result.length + ')';
  const grid = desktop.matches && layout === 'grid';
  const records = showFeedPanel([state.list, state.type, grid ? 'grid' : 'list'].join('/'));
  records.classList.toggle('poster-grid', grid && result.length > 0);
  displayCards(records, result.length ? result.map(item => feedCard(item, grid)) : [empty()]);
  if (kind && id) {
    const same = el('records').querySelector('[data-id="' + CSS.escape(id) + '"]');
    const activeList = [...document.querySelectorAll('[data-list][aria-pressed="true"]')].find(button => button.getClientRects().length);
    (same?.querySelector('[data-kind="' + kind + '"]') || activeList)?.focus({ preventScroll: true });
  }
}
function render() {
  state.day = calendarDay(new Date());
  if (viewBeforeSearch) renderSearch();
  else renderFeed();
  const dialog = el('film-details');
  if (!dialog.open) return;
  if (!viewBeforeSearch && !busy(detailItem.id, 'favorite') && !favoriteMatchesList(detailItem)) {
    dialog.close();
    return;
  }
  const kind = dialog.contains(document.activeElement) && document.activeElement.dataset.kind;
  dialog.querySelector('.card-history').replaceWith(cardHistory(detailItem));
  dialog.querySelector('.card-marks').replaceWith(cardMarks(detailItem));
  if (kind) dialog.querySelector('[data-kind="' + kind + '"]:enabled')?.focus({ preventScroll: true });
}
function setupLayouts() {
  try { if (localStorage.getItem(layoutKey) === 'grid') layout = 'grid'; }
  catch { /* The view switch also works without storage. */ }
  const controls = el('layouts');
  function reflectLayout() {
    for (const button of controls.children) button.setAttribute('aria-pressed', String(button.dataset.layout === layout));
  }
  reflectLayout();
  controls.onclick = event => {
    const choice = event.target.closest('button')?.dataset.layout;
    if (!choice || layout === choice) return;
    const feed = el('feed');
    const top = feed.getBoundingClientRect().top;
    const anchor = feed.scrollTop > 0 && [...el('records').children].find(card => card.getBoundingClientRect().bottom > top)?.dataset.id;
    layout = choice;
    try { localStorage.setItem(layoutKey, layout); } catch { /* Use the in-memory choice. */ }
    reflectLayout();
    render();
    if (anchor) {
      const card = el('records').querySelector('[data-id="' + CSS.escape(anchor) + '"]');
      if (card) feed.scrollTop += card.getBoundingClientRect().top - top;
    }
  };
  const dialog = el('film-details');
  dialog.addEventListener('close', () => {
    if (dialog.open || !detailItem) return;
    const tile = el('records').querySelector('[data-id="' + CSS.escape(detailItem.id) + '"] [aria-controls="film-details"]');
    detailItem = undefined;
    if (!document.querySelector('dialog[open]') && (viewBeforeSearch || desktop.matches)) {
      (tile || (viewBeforeSearch ? el('catalog-query') : controls.querySelector('[aria-pressed=true]'))).focus({preventScroll:true});
    }
  });
  desktop.addEventListener('change', () => {
    if (!desktop.matches && dialog.open && !viewBeforeSearch) dialog.close();
    if (layout === 'grid' || viewBeforeSearch) render();
    if (el('schedule').open) renderSeasons(scheduleItem);
  });
}
function trackCalendarDay() {
  let timer;
  function refresh() {
    clearTimeout(timer);
    const now = new Date();
    if (calendarDay(now) !== state.day) render();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    timer = setTimeout(refresh, midnight - now);
  }
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
}
function renderHistory() {
  render();
  renderWishlist();
}
let refreshing;
let lastRefresh = 0;
function refreshViews() {
  if (!refreshing) {
    lastRefresh = Date.now();
    refreshing = refreshHistory().then(changed => { if (changed) renderHistory(); })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}
async function sync() {
  try { await refreshViews(); }
  catch (error) { announce(shared ? error.message : 'Нет связи с историей просмотра. Повторим синхронизацию.'); }
}
function openKeyDialog(ownerOnly, reason) {
  const dialog = el('sync-dialog');
  const input = el('sync-token');
  dialog.dataset.ownerOnly = String(ownerOnly);
  dialog.returnValue = '';
  input.value = '';
  input.removeAttribute('aria-invalid');
  el('sync-error').textContent = reason;
  dialog.showModal();
  input.select();
}
function setupKeyDialog() {
  if (!shared) return;
  const dialog = el('sync-dialog');
  const input = el('sync-token');
  const errorMessage = el('sync-error');
  dialog.addEventListener('close', () => {
    if (!dialog.open) input.value = '';
  });
  input.oninput = () => {
    input.removeAttribute('aria-invalid');
    errorMessage.textContent = '';
  };
  let saving = false;
  el('sync-form').onsubmit = async event => {
    event.preventDefault();
    if (saving) return;
    const token = input.value.trim();
    try {
      if (!/^github_pat_[A-Za-z0-9_]+$/.test(token)) throw new Error('Введите полный ключ GitHub, начинающийся с github_pat_.');
      saving = true;
      await withLoading((async () => {
        if (dialog.dataset.ownerOnly === 'true') await verifyOwner(token);
        await connectHistory(token);
      })());
      renderHistory();
      dialog.close('connected');
    } catch (error) {
      errorMessage.textContent = error.message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      input.select();
    } finally { saving = false; }
  };
}
function wireGroup(id, key) {
  el(id).addEventListener('click', event => {
    const value = event.target.closest('button')?.dataset[key];
    if (!value) return;
    state[key] = value;
    reflectControls(); render(); el('feed').scrollTop = 0;
  });
}
function setupGenres(availableGenres) {
  const group = el('genres');
  const strip = el('genre-strip');
  const select = el('genre-select');
  for (const genre of ['', ...[...availableGenres].sort(collator.compare)]) {
    const label = genre || 'Все жанры';
    const toggle = node('button', 'genre-chip');
    toggle.append(node('span', '', label));
    toggle.type = 'button';
    toggle.dataset.genre = genre;
    strip.append(toggle);
    select.add(new Option(label, genre));
    if (genre) {
      const badge = toggle.cloneNode(true);
      badge.className = 'selected-genre';
      badge.hidden = true;
      badge.setAttribute('aria-label', 'Снять фильтр «' + genre + '»');
      badge.append(icon('close'));
      el('selected-genres').append(badge);
    }
    toggle.title = label;
  }
  function toggleGenre(genre) {
    if (!genre) state.genres.clear();
    else if (state.genres.has(genre)) state.genres.delete(genre);
    else state.genres.add(genre);
    reflectControls();
    render();
    el('feed').scrollTop = 0;
  }
  function selectGenre(event) {
    const toggle = event.target.closest('[data-genre]');
    if (!toggle) return;
    toggleGenre(toggle.dataset.genre);
    if (toggle.classList.contains('selected-genre')) {
      const next = event.currentTarget.querySelector('button:not([hidden])');
      (next || select).focus({preventScroll:true});
    }
  }
  group.addEventListener('click', selectGenre);
  el('selected-genres').addEventListener('click', selectGenre);
  select.onchange = () => {
    const genre = select.value;
    select.selectedIndex = 0;
    toggleGenre(genre);
  };

  function fitGenres() {
    const available = group.getBoundingClientRect().width;
    if (!available) return;
    // The max-content layout width stays at natural size when the strip is scaled.
    const natural = parseFloat(getComputedStyle(strip).width);
    strip.style.setProperty('--genre-fit', Math.min(1, available / natural));
  }
  fitGenres();
  const observer = new ResizeObserver(fitGenres);
  observer.observe(group);
  observer.observe(strip);
}
function showLastUpdate(modified) {
  const time = el('site-updated');
  const published = Date.parse(modified);
  const date = new Date(Number.isFinite(published) ? published : time.dateTime);
  const updateLine = time.closest('.last-update');
  if (!Number.isFinite(date.getTime())) return;
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Moscow'
  });
  time.dateTime = date.toISOString();
  time.textContent = formatter.format(date) + ' МСК';
  updateLine.hidden = false;
  setTimeout(() => updateLine.classList.add('expired'), 5000);
}
async function start() {
  el('action-loading').addEventListener('cancel', event => event.preventDefault());
  document.querySelectorAll('[data-icon]').forEach(holder => holder.replaceWith(icon(holder.dataset.icon)));
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
  setupWishlist();
  setupKeyDialog();
  setupCollections();
  const embedded = document.getElementById('offline-catalog');
  let modified;
  if (embedded) state.catalog = JSON.parse(embedded.textContent);
  else {
    const response = await fetch('./catalog.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Каталог недоступен');
    state.catalog = await response.json();
    modified = response.headers.get('Last-Modified');
  }
  showLastUpdate(modified);
  const studios = new Set([...studioChoices, ...state.catalog.flatMap(i => [...i.studios, ...(i.platforms || [])])]);
  for (const studio of studios) el('studio').add(new Option(studio, studio));
  const availableGenres = new Set(state.catalog.flatMap(item => item.genres).filter(Boolean));
  setupGenres(availableGenres);
  setupLayouts();
  const view = readSavedView();
  if (view) restoreChoices(view, availableGenres);
  setupPageSort(el('sort'), sortChoices, () => state.list, el('feed'), () => {
    reflectSort();
    render();
  });
  reflectControls();
  wireGroup('list-navigation','list'); wireGroup('types','type');
  for (const id of filterIds) el(id).addEventListener('change', render);
  el('filters-open').onclick = () => el('filters').showModal();
  el('clear').onclick = resetFilters;
  el('apply').onclick = () => { el('filters').close(); el('feed').scrollTop = 0; };
  // A restored pair of dialogs can share one native Escape dismissal.
  for (const child of [el('schedule'), el('sync-dialog')]) {
    child.addEventListener('keydown', event => {
      if (event.key === 'Escape' && (el('film-details').open || el('wish-details').open)) {
        event.preventDefault();
        child.close();
      }
    });
  }
  for (const dialog of document.querySelectorAll('dialog:not(#action-loading)')) dialog.addEventListener('click', e => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  });
  if (!hosted) window.addEventListener('storage', event => {
    if (shared && event.key === historySnapshotKey) {
      sync();
      return;
    }
    const wishMark = event.key?.startsWith('wish-list:fulfilled:');
    if (!event.key || wishMark) renderWishlist();
    if (!wishMark && !event.key?.startsWith('film-list:view:')) render();
  });
  trackCalendarDay();
  setupSearch();
  if (view?.search) {
    const { search, ...base } = view;
    el('lists').scrollLeft = base.listScroll || 0;
    openSearch(base, search);
  } else if (view) {
    el('lists').scrollLeft = view.listScroll || 0;
    restoreDialogs(view);
    restoreFeed(view);
  }
  saveView({ initial: true });
  trackView();
  if (hosted || shared) {
    await sync();
    const onReturn = () => { if (!document.hidden && Date.now() - lastRefresh > 3000) sync(); };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('online', sync);
    setInterval(() => { if (!document.hidden) sync(); }, 30000);
  }
}
start().catch(() => {
  const failure = node('section','empty');
  failure.append(node('h2','','Не удалось открыть каталог'),button('Повторить','',null,() => location.reload()));
  el('records').replaceChildren(failure);
});
