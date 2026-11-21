// Resolve every season for a series at catalog-edit time; the published site works offline.
const months = 'января февраля марта апреля мая июня июля августа сентября октября ноября декабря'.split(' ');

async function page(path, language) {
  const url = new URL(path, 'https://www.themoviedb.org');
  url.searchParams.set('language', language);
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error('TMDB ' + response.status + ' · ' + url.pathname);
  return response.text();
}

function episodeDate(html) {
  const value = html.match(/<span class="date">\s*([^<]*)<\/span>/)?.[1].trim();
  if (!value) return null;
  const [day, month, year] = value.split(/\s+/);
  const index = months.indexOf(month);
  if (index < 0 || !/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(day)) {
    throw new Error('Не удалось прочитать дату серии: ' + value);
  }
  return [year, String(index + 1).padStart(2, '0'), day.padStart(2, '0')].join('-');
}

function episodeTitle(html) {
  const title = html.match(/<h3>\s*<a\b[^>]*>([^<]*)<\/a>/)?.[1].trim();
  if (!title || /^(?:Episode|Серия|Эпизод)\s+\d+$/i.test(title)) return null;
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return title.replace(/&(amp|quot|apos|lt|gt|nbsp|#\d+|#x[0-9a-f]+);/gi, (_, name) =>
    entities[name] ?? String.fromCodePoint(name.startsWith('#x') ? parseInt(name.slice(2), 16) : Number(name.slice(1))));
}

export async function fetchSeasons(seriesId) {
  const path = '/tv/' + seriesId;
  const list = await page(path + '/seasons', 'en-US');
  const sections = list.split(/<div class="season_wrapper">/).slice(1);
  if (!sections.length) throw new Error('TMDB не вернул список сезонов ' + seriesId);
  const seasons = [];
  for (const section of sections) {
    const numberText = section.match(/<h2>\s*<a [^>]*\/season\/(\d+)[?"\/]/)?.[1];
    const countText = section.match(/(\d+)\s+Episodes?\b/i)?.[1];
    if (numberText == null || countText == null) throw new Error('Не удалось прочитать сезон ' + seriesId);
    const number = Number(numberText);
    const episodes = [];
    if (Number(countText) > 0) {
      const html = await page(path + '/season/' + number, 'ru-RU');
      const cards = html.split(/<div class="card"[^>]*data-url="[^"]*\/episode\/\d+[^"]*"[^>]*>/).slice(1);
      for (const card of cards) {
        const n = card.match(/data-episode-number="(\d+)"/)?.[1];
        if (n == null) throw new Error('Не удалось прочитать номер серии ' + seriesId);
        const episode = { number: Number(n), date: episodeDate(card) };
        const title = episodeTitle(card);
        if (title) episode.title = title;
        episodes.push(episode);
      }
      if (new Set(episodes.map(e => e.number)).size !== Number(countText)) {
        throw new Error('Неполный список серий ' + seriesId + ', сезон ' + number);
      }
    }
    seasons.push({ number, releaseDate: episodes.find(e => e.number === 1)?.date ?? null, episodes });
  }
  return seasons;
}

// Later sources supply verified dates/titles without discarding other known episodes.
export function mergeSeasons(...schedules) {
  const seasons = new Map();
  for (const season of schedules.flat()) {
    const saved = seasons.get(season.number) ?? { number: season.number, releaseDate: null, episodes: new Map() };
    if (season.releaseDate) saved.releaseDate = season.releaseDate;
    for (const episode of season.episodes ?? []) {
      const previous = saved.episodes.get(episode.number);
      const entry = { number: episode.number, date: episode.date ?? previous?.date ?? null };
      const title = episode.title || previous?.title;
      if (title) entry.title = title;
      saved.episodes.set(episode.number, entry);
    }
    seasons.set(season.number, saved);
  }
  const order = (a, b) => a.number - b.number;
  return [...seasons.values()].sort(order).map(s => ({...s, episodes: [...s.episodes.values()].sort(order)}));
}
