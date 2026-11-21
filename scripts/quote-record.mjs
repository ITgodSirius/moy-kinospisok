export function quoteFields(entry) {
  if (typeof entry?.id !== 'string' || !/^quote-[a-z0-9-]+$/.test(entry.id) ||
      !['film', 'book', 'heard'].includes(entry.category) ||
      typeof entry.text !== 'string' || !entry.text.trim() ||
      ['source', 'author', 'url'].some(field => entry[field] != null && typeof entry[field] !== 'string')) {
    throw new Error('Укажите ID с префиксом quote-, категорию и текст цитаты.');
  }
  const { id, category, text, source, author, url } = entry;
  if (url && new URL(url).protocol !== 'https:') throw new Error('Ссылка на источник должна использовать HTTPS.');
  return { id, category, text, source, author, url };
}
