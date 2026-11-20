import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const marks = sqliteTable('marks', {
  owner: text('owner').notNull(),
  card: text('card').notNull(),
  kind: text('kind').notNull(),
  marked: integer('marked').notNull(),
  markedAt: text('marked_at')
}, table => [primaryKey({ columns: [table.owner, table.card, table.kind] })]);
