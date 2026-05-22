import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dexterPath } from '../../utils/paths.js';
import type { MacroDataPoint } from './types.js';

const DB_PATH = dexterPath('macro', 'macro.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS macro_series (
  id INTEGER PRIMARY KEY,
  indicator TEXT NOT NULL,
  category TEXT NOT NULL,
  date TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  fetched_at TEXT NOT NULL,
  UNIQUE(indicator, date)
);
CREATE INDEX IF NOT EXISTS idx_macro_indicator_date ON macro_series(indicator, date);

CREATE TABLE IF NOT EXISTS macro_scores (
  id INTEGER PRIMARY KEY,
  module TEXT NOT NULL,
  score_date TEXT NOT NULL,
  score REAL NOT NULL,
  alert_level TEXT NOT NULL,
  components TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  UNIQUE(module, score_date)
);
`;

type SqliteQuery<T> = {
  all(...params: unknown[]): T[];
  get(...params: unknown[]): T | null;
  run(...params: unknown[]): void;
};
type SqliteDb = {
  exec(sql: string): void;
  query<T>(sql: string): SqliteQuery<T>;
  close(): void;
};

type SeriesRow = {
  indicator: string;
  category: string;
  date: string;
  value: number;
  unit: string;
  source: string;
  fetched_at: string;
};

let _db: SqliteDb | null = null;

async function openDb(): Promise<SqliteDb> {
  if (_db) return _db;
  const dir = dexterPath('macro');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  try {
    const sqlite = await import('bun:sqlite');
    const DatabaseCtor = sqlite.Database as new (path: string) => SqliteDb;
    _db = new DatabaseCtor(DB_PATH);
  } catch {
    const mod = await import('better-sqlite3');
    const Database = mod.default;
    const raw = new Database(DB_PATH);
    _db = {
      exec: (sql: string) => raw.exec(sql),
      query: <T>(sql: string): SqliteQuery<T> => {
        const stmt = raw.prepare(sql);
        return {
          all: (...params: unknown[]) => stmt.all(...params) as T[],
          get: (...params: unknown[]) => (stmt.get(...params) as T) ?? null,
          run: (...params: unknown[]) => { stmt.run(...params); },
        };
      },
      close: () => raw.close(),
    };
  }
  _db.exec(SCHEMA);
  return _db;
}

export async function upsertPoints(points: MacroDataPoint[]): Promise<void> {
  const db = await openDb();
  const stmt = db.query(
    `INSERT OR REPLACE INTO macro_series (indicator, category, date, value, unit, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const p of points) {
    stmt.run(p.indicator, p.category, p.date, p.value, p.unit, p.source, p.fetchedAt);
  }
}

export async function getLatestPoint(indicator: string): Promise<MacroDataPoint | null> {
  const db = await openDb();
  const row = db.query<SeriesRow>(
    `SELECT * FROM macro_series WHERE indicator = ? ORDER BY date DESC LIMIT 1`,
  ).get(indicator);
  if (!row) return null;
  return rowToPoint(row);
}

export async function getHistory(indicator: string, days: number): Promise<MacroDataPoint[]> {
  const db = await openDb();
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const rows = db.query<SeriesRow>(
    `SELECT * FROM macro_series WHERE indicator = ? AND date >= ? ORDER BY date ASC`,
  ).all(indicator, since);
  return rows.map(rowToPoint);
}

export async function getLastN(indicator: string, n: number): Promise<MacroDataPoint[]> {
  const db = await openDb();
  const rows = db.query<SeriesRow>(
    `SELECT * FROM macro_series WHERE indicator = ? ORDER BY date DESC LIMIT ?`,
  ).all(indicator, n);
  return rows.map(rowToPoint).reverse();
}

function rowToPoint(row: SeriesRow): MacroDataPoint {
  return {
    indicator: row.indicator,
    category: row.category as MacroDataPoint['category'],
    date: row.date,
    value: row.value,
    unit: row.unit,
    source: row.source,
    fetchedAt: row.fetched_at,
  };
}
