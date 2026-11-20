import { hosted, marked, markTime, busy, refreshHistory, setMark } from './history.js?v=fcd635e64bcc';

const el = id => document.getElementById(id);
const editAccessKey = 'film-list:edit-unlocked';
const viewKey = 'film-list:view:' + location.pathname;
const persistentViewKey = viewKey.replace(/\/index\.html$/, '/');
const layoutKey = viewKey + ':layout';
let layout = 'list';
let detailItem;
const state = { list: 'waiting', type: 'all', genres: new Set(), catalog: [], day: null };
const sortChoices = { available: 'release-new', other: 'added-new' };
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
const markActions = [
  { kind: 'watched', add: 'Отметить просмотренным', remove: 'Снять отметку просмотра', icon: 'check' },
  { kind: 'favorite', add: 'В любимые', remove: 'Убрать из любимых', icon: 'heart' },
  { kind: 'watching', add: 'Смотрю сейчас', remove: 'Отложить просмотр', icon: 'play' }
];
const iconPaths = {
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
function listMatches(item) {
  const watched = marked(item.id, 'watched');
  const favorite = marked(item.id, 'favorite');
  if (state.list === 'watched') return watched;
  if (state.list === 'favorite') return favorite;
  if (watched) return false;
  if (marked(item.id, 'watching')) return state.list === 'watching';
  if (item.status === 'backlog') return state.list === 'backlog';
  const released = item.status === 'available' || daysSince(item.releaseDate) >= 0;
  return released ? state.list === 'available' : state.list === 'waiting' && !favorite;
}
function isAnimated(item) {
  return item.genres.some(genre => animationGenres.has(genre.trim().toLowerCase()));
}
function matchesCategory(item) {
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
function sortScope() {
  return state.list === 'available' ? 'available' : 'other';
}
function compare(a, b) {
  let sort = sortChoices[sortScope()];
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
    const label = node('span', '', 'Сезон ' + season.number);
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
    } else if (season.releaseDate || !expanded) {
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
function cardHeader(item) {
  const header = node('div', 'card-heading');
  const title = node('div');
  const animated = isAnimated(item);
  let format = animated ? 'Мультфильм' : 'Фильм';
  if (item.type === 'series') {
    format = animated ? 'Мультсериал' : 'Сериал';
    if (item.dorama === true) format = 'Дорама';
    format += ' · Сезон ' + item.season;
  }
  title.append(node('h2', '', item.title), node('p', 'kind', format));
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
  section.append(node('h3', 'sr', 'История'), dates);
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
function mediaActions(item, compact = false) {
  const links = node('div', compact ? 'poster-actions' : 'media-actions');
  links.setAttribute('role', 'group');
  links.setAttribute('aria-label', 'Информация о проекте');
  if (!compact && item.type === 'series') {
    const calendar = button('Сезоны и серии', '', 'calendar', () => showSchedule(item));
    calendar.setAttribute('aria-haspopup', 'dialog');
    calendar.setAttribute('aria-controls', 'schedule');
    links.append(calendar);
  }
  if (item.trailer) {
    links.append(externalLink('Трейлер', 'play', item.trailer, 'Трейлер «' + item.title + '» на YouTube в новой вкладке', compact));
  }
  links.append(externalLink('Найти', 'search', yandexSearchUrl(item), 'Найти «' + item.title + '» в Яндексе в новой вкладке', compact));
  return links;
}
function cardMarks(item) {
  const marks = node('div', 'card-marks');
  marks.setAttribute('role', 'group');
  marks.setAttribute('aria-label', 'Мои отметки');
  for (const { kind, add, remove, icon } of markActions) {
    const finished = kind === 'watching' && marked(item.id, 'watched');
    const active = !finished && marked(item.id, kind);
    const compact = kind !== 'watching';
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
  const title = item.type === 'series' ? item.title + ' · Сезон ' + item.season : item.title;
  open.append(node('span', '', title), icon('chevron'));
  open.onclick = () => showDetails(item);
  heading.append(open);
  const meta = node('div', 'poster-meta');
  meta.append(releaseDate(item, true), mediaActions(item, true));
  caption.append(heading, node('p', 'poster-genres', item.genres.join(' · ')), meta);
  section.append(image, caption);
  return section;
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
function resetFilters() {
  for (const id of filterIds) el(id).value = '';
  state.type = 'all';
  state.genres.clear();
  reflectControls();
  render();
}
function empty() {
  const box = node('section', 'empty');
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
  sort.value = sortChoices[sortScope()];
  const width = sort.selectedOptions[0].textContent.length * 8.25 + 32;
  sort.style.setProperty('--sort-width', Math.min(236, width) + 'px');
}
let lastSavedFeed;
function saveView({ initial = false } = {}) {
  const feed = el('feed');
  const top = feed.getBoundingClientRect().top;
  const first = [...el('records').children].find(card => card.dataset.id && card.getBoundingClientRect().bottom > top);
  const dialog = document.querySelector('#filters[open], #schedule[open]');
  const openSeason = el('seasons').querySelector('details[open]');
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
  const tabView = {
    ...view,
    detail: el('film-details').open ? detailItem.id : undefined,
    detailScroll: el('film-details').querySelector('.film-body').scrollTop,
    dialog: dialog?.id, dialogScroll: dialog?.querySelector('.dialog-body').scrollTop,
    series: dialog?.id === 'schedule' ? scheduleItem.id : undefined,
    season: desktop.matches ? undefined : Number(openSeason?.dataset.season) || null
  };
  try { sessionStorage.setItem(viewKey, JSON.stringify(tabView)); }
  catch { /* The catalog also works without browser storage. */ }
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
  for (const scope of Object.keys(sortChoices)) {
    if (validSorts.has(savedSorts[scope])) sortChoices[scope] = savedSorts[scope];
  }
  for (const id of filterIds) {
    const select = el(id);
    const value = view.filters?.[id];
    if ([...select.options].some(option => option.value === value)) select.value = value;
  }
  if (Array.isArray(view.expanded)) {
    for (const id of view.expanded) expandedDescriptions.add(id);
  }
  reflectControls();
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
function restorePosition(view) {
  el('lists').scrollLeft = view.listScroll || 0;
  if (view.detail && desktop.matches && layout === 'grid') {
    const item = state.catalog.find(item => item.id === view.detail);
    if (item) {
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
  restoreFeed(view);
}
function render() {
  state.day = calendarDay(new Date());
  const focused = document.activeElement;
  const kind = focused?.dataset.kind;
  const id = focused?.closest('.entry')?.dataset.id;
  const result = state.catalog.filter(matchesFilters).sort(compare);
  const count = filterIds.filter(id => el(id).value).length;
  el('filter-count').hidden = !count; el('filter-count').textContent = count;
  el('apply').textContent = 'Показать (' + result.length + ')';
  synopsisObserver.disconnect();
  const grid = desktop.matches && layout === 'grid';
  const records = el('records');
  records.classList.toggle('poster-grid', grid && result.length > 0);
  records.replaceChildren(...(result.length ? result.map(grid ? posterCard : card) : [empty()]));
  const dialog = el('film-details');
  if (dialog.open) {
    dialog.querySelector('.card-history').replaceWith(cardHistory(detailItem));
    const marks = cardMarks(detailItem);
    dialog.querySelector('.card-marks').replaceWith(marks);
    if (kind && focused.closest('dialog') === dialog) {
      marks.querySelector('[data-kind="' + kind + '"]:not(:disabled)')?.focus({preventScroll:true});
    }
  }
  if (kind && id) {
    const same = [...el('records').querySelectorAll('.entry')].find(entry => entry.dataset.id === id);
    const activeList = [...document.querySelectorAll('[data-list][aria-pressed="true"]')].find(button => button.getClientRects().length);
    (same?.querySelector('[data-kind="' + kind + '"]') || activeList)?.focus({ preventScroll: true });
  }
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
    const tile = el('records').querySelector('[data-id="' + CSS.escape(detailItem.id) + '"] .poster-open');
    detailItem = undefined;
    if (!document.querySelector('dialog[open]') && desktop.matches) {
      (tile || controls.querySelector('[aria-pressed=true]')).focus({preventScroll:true});
    }
  });
  desktop.addEventListener('change', () => {
    if (!desktop.matches && dialog.open) dialog.close();
    if (layout === 'grid') render();
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
  if (!Number.isFinite(date.getTime())) return;
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Moscow'
  });
  time.dateTime = date.toISOString();
  time.textContent = formatter.format(date) + ' МСК';
  const updateLine = time.parentElement;
  updateLine.hidden = false;
  setTimeout(() => updateLine.classList.add('expired'), 5000);
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
  else reflectControls();
  wireGroup('list-navigation','list'); wireGroup('types','type');
  for (const id of filterIds) el(id).addEventListener('change', render);
  el('sort').onchange = () => {
    sortChoices[sortScope()] = el('sort').value;
    reflectSort();
    render(); el('feed').scrollTop = 0;
  };
  el('filters-open').onclick = () => el('filters').showModal();
  el('clear').onclick = resetFilters;
  el('apply').onclick = () => { el('filters').close(); el('feed').scrollTop = 0; };
  // A restored pair of dialogs can share one native Escape dismissal.
  for (const child of [el('schedule'), el('edit-dialog')]) {
    child.addEventListener('keydown', event => {
      if (event.key === 'Escape' && el('film-details').open) {
        event.preventDefault();
        child.close();
      }
    });
  }
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', e => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  });
  if (!hosted) window.addEventListener('storage', event => {
    if (!event.key?.startsWith('film-list:view:')) render();
  });
  trackCalendarDay();
  if (view) restorePosition(view);
  saveView({ initial: true });
  trackView();
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
  failure.append(node('h2','','Не удалось открыть каталог'),button('Повторить','',null,() => location.reload()));
  el('records').replaceChildren(failure);
});
