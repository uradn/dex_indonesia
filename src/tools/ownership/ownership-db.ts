import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dexterPath } from '../../utils/paths.js';

const DB_PATH = dexterPath('macro', 'macro.db');

const OWNERSHIP_SCHEMA = `
CREATE TABLE IF NOT EXISTS idx_shareholders (
  date TEXT NOT NULL,
  share_code TEXT NOT NULL,
  issuer_name TEXT NOT NULL,
  investor_name TEXT NOT NULL,
  investor_type TEXT NOT NULL DEFAULT '',
  local_foreign TEXT NOT NULL DEFAULT '',
  nationality TEXT NOT NULL DEFAULT '',
  domicile TEXT NOT NULL DEFAULT '',
  holdings_scripless INTEGER NOT NULL DEFAULT 0,
  holdings_scrip INTEGER NOT NULL DEFAULT 0,
  total_shares INTEGER NOT NULL DEFAULT 0,
  pct REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (date, share_code, investor_name)
);
CREATE INDEX IF NOT EXISTS idx_sh_date_code ON idx_shareholders(date, share_code);
CREATE INDEX IF NOT EXISTS idx_sh_investor ON idx_shareholders(investor_name);
CREATE INDEX IF NOT EXISTS idx_sh_local_foreign ON idx_shareholders(local_foreign);
CREATE INDEX IF NOT EXISTS idx_sh_nationality ON idx_shareholders(nationality);

CREATE TABLE IF NOT EXISTS ownership_delta (
  date TEXT NOT NULL,
  share_code TEXT NOT NULL,
  investor_name TEXT NOT NULL,
  pct_prev REAL,
  pct_curr REAL,
  delta_pct REAL,
  event TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (date, share_code, investor_name)
);
CREATE INDEX IF NOT EXISTS idx_od_date_code ON ownership_delta(date, share_code);
CREATE INDEX IF NOT EXISTS idx_od_investor ON ownership_delta(investor_name);
CREATE INDEX IF NOT EXISTS idx_od_event ON ownership_delta(event);
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

let _db: SqliteDb | null = null;

async function openOwnershipDb(): Promise<SqliteDb> {
  if (_db) return _db;
  const dir = dexterPath('macro');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  try {
    const sqlite = await import('bun:sqlite');
    const DatabaseCtor = sqlite.Database as new (path: string) => SqliteDb;
    _db = new DatabaseCtor(DB_PATH);
    _db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  } catch {
    const mod = await import('better-sqlite3');
    const Database = mod.default;
    const raw = new Database(DB_PATH);
    raw.pragma('journal_mode=WAL');
    raw.pragma('busy_timeout=5000');
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
  _db.exec(OWNERSHIP_SCHEMA);
  return _db;
}

export type ShareholderRow = {
  date: string;
  share_code: string;
  issuer_name: string;
  investor_name: string;
  investor_type: string;
  local_foreign: string;
  nationality: string;
  domicile: string;
  holdings_scripless: number;
  holdings_scrip: number;
  total_shares: number;
  pct: number;
};

export type DeltaRow = {
  date: string;
  share_code: string;
  investor_name: string;
  pct_prev: number | null;
  pct_curr: number | null;
  delta_pct: number | null;
  event: string;
};

export async function upsertShareholders(rows: ShareholderRow[]): Promise<number> {
  const db = await openOwnershipDb();
  const stmt = db.query<void>(
    `INSERT OR REPLACE INTO idx_shareholders
     (date, share_code, issuer_name, investor_name, investor_type, local_foreign,
      nationality, domicile, holdings_scripless, holdings_scrip, total_shares, pct)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run(r.date, r.share_code, r.issuer_name, r.investor_name, r.investor_type,
      r.local_foreign, r.nationality, r.domicile, r.holdings_scripless,
      r.holdings_scrip, r.total_shares, r.pct);
  }
  return rows.length;
}

export async function computeAndSaveDelta(date: string): Promise<number> {
  const db = await openOwnershipDb();

  const prevMonth = getPrevMonthDateFromDb(db, date);

  const curr = db.query<ShareholderRow>(
    `SELECT share_code, investor_name, pct FROM idx_shareholders WHERE date = ?`,
  ).all(date);

  const prevMap = new Map<string, number>();
  if (prevMonth) {
    const prev = db.query<{ share_code: string; investor_name: string; pct: number }>(
      `SELECT share_code, investor_name, pct FROM idx_shareholders WHERE date = ?`,
    ).all(prevMonth);
    for (const r of prev) prevMap.set(`${r.share_code}|${r.investor_name}`, r.pct);
  }

  const currMap = new Map<string, number>();
  for (const r of curr) currMap.set(`${r.share_code}|${r.investor_name}`, r.pct);

  const deltas: DeltaRow[] = [];

  for (const r of curr) {
    const key = `${r.share_code}|${r.investor_name}`;
    const prev = prevMap.get(key) ?? null;
    const delta = prev !== null ? r.pct - prev : null;
    let event = '';
    if (prev === null) event = 'NEW';
    else if (delta !== null && Math.abs(delta) < 0.001) event = 'UNCHANGED';
    else if (delta !== null && delta > 0) event = 'INCREASE';
    else event = 'DECREASE';
    deltas.push({ date, share_code: r.share_code, investor_name: r.investor_name, pct_prev: prev, pct_curr: r.pct, delta_pct: delta, event });
  }

  for (const [key, pct] of prevMap) {
    if (!currMap.has(key)) {
      const [share_code, investor_name] = key.split('|');
      deltas.push({ date, share_code, investor_name, pct_prev: pct, pct_curr: null, delta_pct: null, event: 'EXIT' });
    }
  }

  const stmt = db.query<void>(
    `INSERT OR REPLACE INTO ownership_delta
     (date, share_code, investor_name, pct_prev, pct_curr, delta_pct, event)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const d of deltas) {
    stmt.run(d.date, d.share_code, d.investor_name, d.pct_prev, d.pct_curr, d.delta_pct, d.event);
  }
  return deltas.length;
}

function getPrevMonthDateFromDb(db: SqliteDb, date: string): string | null {
  const d = new Date(date);
  d.setMonth(d.getMonth() - 1);
  const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const row = db.query<{ date: string }>(
    `SELECT DISTINCT date FROM idx_shareholders WHERE date LIKE ? ORDER BY date LIMIT 1`,
  ).get(prefix + '%');
  return row?.date ?? null;
}

let _cachedDates: string[] | null = null;

export async function getAvailableDates(): Promise<string[]> {
  const db = await openOwnershipDb();
  const rows = db.query<{ date: string }>(
    `SELECT DISTINCT date FROM idx_shareholders ORDER BY date`,
  ).all();
  _cachedDates = rows.map(r => r.date);
  return _cachedDates;
}

export async function getHoldersForEmiten(code: string, date?: string): Promise<ShareholderRow[]> {
  const db = await openOwnershipDb();
  const d = date ?? (await getAvailableDates()).at(-1);
  if (!d) return [];
  return db.query<ShareholderRow>(
    `SELECT * FROM idx_shareholders WHERE share_code = ? AND date = ? ORDER BY pct DESC`,
  ).all(code.toUpperCase(), d);
}

export async function getEmitenForInvestor(investorName: string, date?: string): Promise<ShareholderRow[]> {
  const db = await openOwnershipDb();
  const d = date ?? (await getAvailableDates()).at(-1);
  if (!d) return [];
  return db.query<ShareholderRow>(
    `SELECT * FROM idx_shareholders WHERE UPPER(investor_name) LIKE ? AND date = ? ORDER BY pct DESC`,
  ).all(`%${investorName.toUpperCase()}%`, d);
}

export async function getForeignOwnershipSummary(date?: string): Promise<{
  share_code: string;
  issuer_name: string;
  foreign_pct: number;
  local_pct: number;
  top_foreign_investor: string;
}[]> {
  const db = await openOwnershipDb();
  const d = date ?? (await getAvailableDates()).at(-1);
  if (!d) return [];
  return db.query<{ share_code: string; issuer_name: string; foreign_pct: number; local_pct: number; top_foreign_investor: string }>(
    `SELECT
       share_code,
       MAX(issuer_name) as issuer_name,
       ROUND(SUM(CASE WHEN local_foreign = 'A' THEN pct ELSE 0 END), 2) as foreign_pct,
       ROUND(SUM(CASE WHEN local_foreign = 'L' THEN pct ELSE 0 END), 2) as local_pct,
       MAX(CASE WHEN local_foreign = 'A' THEN investor_name ELSE '' END) as top_foreign_investor
     FROM idx_shareholders
     WHERE date = ?
     GROUP BY share_code
     ORDER BY foreign_pct DESC`,
  ).all(d);
}

export async function getDeltaForEmiten(code: string, date?: string): Promise<DeltaRow[]> {
  const db = await openOwnershipDb();
  const d = date ?? (await getAvailableDates()).at(-1);
  if (!d) return [];
  return db.query<DeltaRow>(
    `SELECT * FROM ownership_delta WHERE share_code = ? AND date = ? ORDER BY ABS(COALESCE(delta_pct, 0)) DESC`,
  ).all(code.toUpperCase(), d);
}

export async function getAnomalies(date?: string, minDelta = 2.0): Promise<{
  date: string;
  share_code: string;
  investor_name: string;
  event: string;
  delta_pct: number | null;
  pct_curr: number | null;
}[]> {
  const db = await openOwnershipDb();
  const d = date ?? (await getAvailableDates()).at(-1);
  if (!d) return [];
  return db.query<{ date: string; share_code: string; investor_name: string; event: string; delta_pct: number | null; pct_curr: number | null }>(
    `SELECT date, share_code, investor_name, event, delta_pct, pct_curr
     FROM ownership_delta
     WHERE date = ? AND (event IN ('NEW','EXIT') OR ABS(COALESCE(delta_pct,0)) >= ?)
     ORDER BY ABS(COALESCE(delta_pct,0)) DESC
     LIMIT 200`,
  ).all(d, minDelta);
}

export async function getCrossHolderNetwork(date?: string, minEmiten = 2): Promise<{
  investor_name: string;
  local_foreign: string;
  nationality: string;
  emiten_count: number;
  codes: string;
  avg_pct: number;
}[]> {
  const db = await openOwnershipDb();
  const d = date ?? (await getAvailableDates()).at(-1);
  if (!d) return [];
  return db.query<{ investor_name: string; local_foreign: string; nationality: string; emiten_count: number; codes: string; avg_pct: number }>(
    `SELECT
       s.investor_name,
       MAX(s.local_foreign) as local_foreign,
       MAX(s.nationality) as nationality,
       COUNT(DISTINCT s.share_code) as emiten_count,
       GROUP_CONCAT(s.share_code, ',') as codes,
       ROUND(AVG(s.pct), 2) as avg_pct
     FROM idx_shareholders s
     WHERE s.date = ?
     GROUP BY s.investor_name
     HAVING emiten_count >= ?
     ORDER BY emiten_count DESC`,
  ).all(d, minEmiten);
}

export async function getOwnershipStats(): Promise<{
  total_rows: number;
  emiten_count: number;
  investor_count: number;
  months: string[];
  latest_date: string;
}> {
  const db = await openOwnershipDb();
  const months = await getAvailableDates();
  const stats = db.query<{ total_rows: number; emiten_count: number; investor_count: number }>(
    `SELECT COUNT(*) as total_rows,
            COUNT(DISTINCT share_code) as emiten_count,
            COUNT(DISTINCT investor_name) as investor_count
     FROM idx_shareholders`,
  ).get();
  return {
    total_rows: stats?.total_rows ?? 0,
    emiten_count: stats?.emiten_count ?? 0,
    investor_count: stats?.investor_count ?? 0,
    months,
    latest_date: months.at(-1) ?? '',
  };
}
