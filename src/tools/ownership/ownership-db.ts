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

const STATE_KEYWORDS = ['ASABRI','DJS KETENAGAKERJAAN','TASPEN','DANANTARA','INDONESIA INVESTMENT AUTHORITY',
  'GOVERNMENT OF INDONESIA','LEMBAGA PENGELOLA INVESTASI','BPJS'];

function isStateHolder(name: string): boolean {
  const upper = name.toUpperCase();
  return STATE_KEYWORDS.some(k => upper.includes(k));
}

export async function getConcentrationRanking(date?: string, limit = 200): Promise<{
  share_code: string;
  issuer_name: string;
  n_holders: number;
  hhi: number;
  top1_pct: number;
  top3_pct: number;
  top1_name: string;
  top1_lf: string;
  flags: string;
}[]> {
  const db = await openOwnershipDb();
  const d = date ?? (await getAvailableDates()).at(-1);
  if (!d) return [];

  const rows = db.query<{
    share_code: string; issuer_name: string; n_holders: number; hhi: number;
    top1_pct: number; top3_pct: number; top1_name: string; top1_lf: string; foreign_pct: number;
  }>(
    `SELECT share_code, MAX(issuer_name) as issuer_name,
       COUNT(*) as n_holders,
       ROUND(SUM(pct*pct)/10000, 4) as hhi,
       ROUND(MAX(pct), 2) as top1_pct,
       ROUND(SUM(CASE WHEN rn<=3 THEN pct ELSE 0 END), 2) as top3_pct,
       MAX(CASE WHEN rn=1 THEN investor_name ELSE '' END) as top1_name,
       MAX(CASE WHEN rn=1 THEN local_foreign ELSE '' END) as top1_lf,
       ROUND(SUM(CASE WHEN local_foreign='A' THEN pct ELSE 0 END), 2) as foreign_pct
     FROM (
       SELECT share_code, issuer_name, investor_name, local_foreign, pct,
         ROW_NUMBER() OVER (PARTITION BY share_code ORDER BY pct DESC) as rn
       FROM idx_shareholders WHERE date = ?
     )
     GROUP BY share_code
     ORDER BY hhi DESC
     LIMIT ?`,
  ).all(d, limit);

  return rows.map(r => {
    const flags: string[] = [];
    if (r.top1_pct >= 75) flags.push('SINGLE_OWNER');
    if (isStateHolder(r.top1_name)) flags.push('BUMN_DOMINATED');
    if (r.foreign_pct >= 50) flags.push('FOREIGN_BLOC');
    if (r.hhi < 0.1 && r.n_holders >= 5) flags.push('DISPERSED');
    return { ...r, flags: flags.join(',') };
  });
}

export async function getStateHoldings(date?: string): Promise<{
  investor_name: string;
  investor_type: string;
  emiten_count: number;
  total_market_value_proxy: number;
  holdings: { share_code: string; issuer_name: string; pct: number }[];
}[]> {
  const db = await openOwnershipDb();
  const d = date ?? (await getAvailableDates()).at(-1);
  if (!d) return [];

  const all = db.query<{ investor_name: string; investor_type: string; share_code: string; issuer_name: string; pct: number }>(
    `SELECT investor_name, investor_type, share_code, issuer_name, pct
     FROM idx_shareholders WHERE date = ?
     ORDER BY investor_name, pct DESC`,
  ).all(d);

  const grouped = new Map<string, typeof all>();
  for (const r of all) {
    if (!isStateHolder(r.investor_name)) continue;
    if (!grouped.has(r.investor_name)) grouped.set(r.investor_name, []);
    grouped.get(r.investor_name)!.push(r);
  }

  return Array.from(grouped.entries())
    .map(([investor_name, rows]) => ({
      investor_name,
      investor_type: rows[0]?.investor_type ?? '',
      emiten_count: rows.length,
      total_market_value_proxy: Math.round(rows.reduce((s, r) => s + r.pct, 0) * 100) / 100,
      holdings: rows.map(r => ({ share_code: r.share_code, issuer_name: r.issuer_name, pct: r.pct })),
    }))
    .sort((a, b) => b.emiten_count - a.emiten_count);
}

export async function getEmitenHistory(code: string): Promise<{
  date: string;
  foreign_pct: number;
  local_pct: number;
  holders: number;
}[]> {
  const db = await openOwnershipDb();
  return db.query<{ date: string; foreign_pct: number; local_pct: number; holders: number }>(
    `SELECT date,
       ROUND(SUM(CASE WHEN local_foreign='A' THEN pct ELSE 0 END), 2) as foreign_pct,
       ROUND(SUM(CASE WHEN local_foreign='L' THEN pct ELSE 0 END), 2) as local_pct,
       COUNT(*) as holders
     FROM idx_shareholders WHERE share_code = ? GROUP BY date ORDER BY date`,
  ).all(code.toUpperCase());
}

export async function getForeignMovers(minDelta = 1.0, date?: string): Promise<{
  share_code: string;
  issuer_name: string;
  curr_fpct: number;
  prev_fpct: number;
  delta: number;
}[]> {
  const db = await openOwnershipDb();
  const dates = await getAvailableDates();
  const curr = date ?? dates.at(-1);
  const prev = date ? dates[dates.indexOf(date) - 1] : dates.at(-2);
  if (!curr || !prev) return [];
  return db.query<{ share_code: string; issuer_name: string; curr_fpct: number; prev_fpct: number; delta: number }>(
    `WITH curr AS (
       SELECT share_code, MAX(issuer_name) as issuer_name,
         ROUND(SUM(CASE WHEN local_foreign='A' THEN pct ELSE 0 END),2) as fpct
       FROM idx_shareholders WHERE date = ? GROUP BY share_code
     ),
     prev AS (
       SELECT share_code,
         ROUND(SUM(CASE WHEN local_foreign='A' THEN pct ELSE 0 END),2) as fpct
       FROM idx_shareholders WHERE date = ? GROUP BY share_code
     )
     SELECT c.share_code, c.issuer_name,
       c.fpct as curr_fpct, p.fpct as prev_fpct,
       ROUND(c.fpct - p.fpct, 2) as delta
     FROM curr c JOIN prev p ON c.share_code = p.share_code
     WHERE ABS(c.fpct - p.fpct) >= ?
     ORDER BY ABS(c.fpct - p.fpct) DESC`,
  ).all(curr, prev, minDelta);
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

// Initialization month: all NEW events are artifacts (first data load), not real new entrants.
const FIRST_MONTH = '2026-02-27';
// Custodian / broker types: nominees for underlying clients, not suspicious actors.
const CUSTODIAN_TYPES = ['SE', 'BR', 'IB'];

export async function getVelocityFlippers(excludeTypes: string[] = CUSTODIAN_TYPES): Promise<{
  share_code: string;
  issuer_name: string;
  investor_name: string;
  investor_type: string;
  entry_date: string;
  exit_date: string;
  pct_peak: number;
}[]> {
  const db = await openOwnershipDb();

  const allDates = db.query<{ date: string }>(
    `SELECT DISTINCT date FROM ownership_delta ORDER BY date`,
  ).all().map(r => r.date);

  const dateIdx = new Map(allDates.map((d, i) => [d, i]));

  // All NEW events (excluding initialization month)
  const newEvents = db.query<{
    share_code: string; issuer_name: string; investor_name: string;
    investor_type: string; date: string; pct_curr: number;
  }>(
    `SELECT d.share_code, MAX(s.issuer_name) as issuer_name, d.investor_name,
            MAX(s.investor_type) as investor_type, d.date, MAX(d.pct_curr) as pct_curr
     FROM ownership_delta d
     JOIN idx_shareholders s ON s.share_code = d.share_code
       AND s.investor_name = d.investor_name AND s.date = d.date
     WHERE d.event = 'NEW' AND d.date != ?
     GROUP BY d.share_code, d.investor_name, d.date`,
  ).all(FIRST_MONTH);

  // Build exit lookup set: "share_code|investor_name|date"
  const exitSet = new Set(
    db.query<{ key: string }>(
      `SELECT (share_code || '|' || investor_name || '|' || date) as key
       FROM ownership_delta WHERE event = 'EXIT'`,
    ).all().map(r => r.key),
  );

  const result: {
    share_code: string; issuer_name: string; investor_name: string;
    investor_type: string; entry_date: string; exit_date: string; pct_peak: number;
  }[] = [];

  for (const ne of newEvents) {
    if (excludeTypes.includes(ne.investor_type)) continue;
    const idx = dateIdx.get(ne.date);
    if (idx === undefined) continue;
    const nextDate = allDates[idx + 1];
    if (!nextDate) continue;
    if (exitSet.has(`${ne.share_code}|${ne.investor_name}|${nextDate}`)) {
      result.push({
        share_code: ne.share_code,
        issuer_name: ne.issuer_name,
        investor_name: ne.investor_name,
        investor_type: ne.investor_type,
        entry_date: ne.date,
        exit_date: nextDate,
        pct_peak: ne.pct_curr ?? 0,
      });
    }
  }

  return result.sort((a, b) =>
    b.exit_date.localeCompare(a.exit_date) || b.pct_peak - a.pct_peak,
  );
}

function normalizeGroupKey(name: string): string {
  const stripped = name
    .toUpperCase()
    // strip jurisdiction/country suffixes last
    .replace(/\b(HONG KONG|SINGAPORE|MAURITIUS|INDONESIA|MALAYSIA|THAILAND|VIETNAM|CAYMAN|BRITISH|LUXEMBOURG|IRELAND|JERSEY)\b/g, '')
    .replace(/\b(PT|TBK|CO|LTD|LLC|INC|CORP|PTE|SA|AG|BV|NV|SDN|BHD|BERHAD|PERSERO|CV|UD|YAYASAN|LIMITED|TBKP)\b/g, '')
    .replace(/[.,\-'/\\():]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Use first 24 chars as group key to cluster jurisdiction/program variants
  // (e.g. DJS KETENAGAKERJAAN JHT vs PENSIUN; CGS HK vs SG vs MU)
  return stripped.length > 24 ? stripped.slice(0, 24).trimEnd() : stripped;
}

export async function getEntityGroups(date?: string): Promise<{
  group_key: string;
  names: string[];
  emiten_count: number;
  total_pct: number;
}[]> {
  const db = await openOwnershipDb();
  const d = date ?? (await getAvailableDates()).at(-1);
  if (!d) return [];

  const investors = db.query<{
    investor_name: string; share_codes: string; total_pct: number;
  }>(
    `SELECT investor_name,
            GROUP_CONCAT(DISTINCT share_code) as share_codes,
            SUM(pct) as total_pct
     FROM idx_shareholders WHERE date = ? GROUP BY investor_name`,
  ).all(d);

  const groups = new Map<string, {
    names: string[]; share_codes: Set<string>; total_pct: number;
  }>();

  for (const inv of investors) {
    const key = normalizeGroupKey(inv.investor_name);
    if (!key || key.length < 4) continue;
    if (!groups.has(key)) groups.set(key, { names: [], share_codes: new Set(), total_pct: 0 });
    const g = groups.get(key)!;
    g.names.push(inv.investor_name);
    for (const c of (inv.share_codes ?? '').split(',')) if (c) g.share_codes.add(c);
    g.total_pct += inv.total_pct;
  }

  return Array.from(groups.entries())
    .filter(([, g]) => g.names.length >= 2)
    .map(([group_key, g]) => ({
      group_key,
      names: g.names,
      emiten_count: g.share_codes.size,
      total_pct: Math.round(g.total_pct * 100) / 100,
    }))
    .sort((a, b) => b.names.length - a.names.length || b.emiten_count - a.emiten_count);
}

export async function getWashScreener(date?: string, minScore = 15): Promise<{
  share_code: string;
  issuer_name: string;
  wash_score: number;
  churn_rate: number;
  flip_count: number;
  coord_count: number;
  flags: string;
}[]> {
  const db = await openOwnershipDb();

  // Per-emiten per-month churn (excluding initialization month)
  const churnRows = db.query<{
    share_code: string; issuer_name: string; date: string;
    total: number; new_count: number; exit_count: number;
  }>(
    `SELECT d.share_code,
            (SELECT issuer_name FROM idx_shareholders WHERE share_code=d.share_code LIMIT 1) as issuer_name,
            d.date,
            COUNT(*) as total,
            SUM(CASE WHEN d.event='NEW' THEN 1 ELSE 0 END) as new_count,
            SUM(CASE WHEN d.event='EXIT' THEN 1 ELSE 0 END) as exit_count
     FROM ownership_delta d
     WHERE d.date != ?
     GROUP BY d.share_code, d.date`,
  ).all(FIRST_MONTH);

  // Velocity flippers per emiten
  const flippers = await getVelocityFlippers();
  const flipCount = new Map<string, number>();
  for (const f of flippers) {
    flipCount.set(f.share_code, (flipCount.get(f.share_code) ?? 0) + 1);
  }

  // Coordinated entry: months with ≥3 new CP/ID investors per emiten
  const coordRows = db.query<{ share_code: string; date: string; coord_new: number }>(
    `SELECT d.share_code, d.date,
            SUM(CASE WHEN s.investor_type IN ('CP','ID') THEN 1 ELSE 0 END) as coord_new
     FROM ownership_delta d
     LEFT JOIN idx_shareholders s
       ON s.share_code=d.share_code AND s.investor_name=d.investor_name AND s.date=d.date
     WHERE d.event='NEW' AND d.date != ?
     GROUP BY d.share_code, d.date
     HAVING coord_new >= 3`,
  ).all(FIRST_MONTH);

  const coordCount = new Map<string, number>();
  for (const r of coordRows) {
    coordCount.set(r.share_code, (coordCount.get(r.share_code) ?? 0) + 1);
  }

  // Aggregate churn per emiten
  type Stats = { issuer_name: string; churn_values: number[] };
  const emitenMap = new Map<string, Stats>();
  for (const r of churnRows) {
    if (!emitenMap.has(r.share_code)) {
      emitenMap.set(r.share_code, { issuer_name: r.issuer_name ?? r.share_code, churn_values: [] });
    }
    const churn = r.total > 0 ? (r.new_count + r.exit_count) / r.total : 0;
    emitenMap.get(r.share_code)!.churn_values.push(churn);
  }

  const results: {
    share_code: string; issuer_name: string; wash_score: number;
    churn_rate: number; flip_count: number; coord_count: number; flags: string;
  }[] = [];

  for (const [share_code, stats] of emitenMap) {
    const avg_churn = stats.churn_values.reduce((s, v) => s + v, 0) / stats.churn_values.length;
    const flips = flipCount.get(share_code) ?? 0;
    const coords = coordCount.get(share_code) ?? 0;

    // Score components (each 0–100):
    // churn_score: 20% avg churn rate → 100 (high turnover signal)
    // flip_score: 7 velocity flippers → 100 (fast money in/out)
    // coord_score: 4 coordinated-entry months → 100 (synchronized accumulation)
    const churn_score = Math.min(avg_churn * 500, 100);
    const flip_score = Math.min(flips * 15, 100);
    const coord_score = Math.min(coords * 25, 100);

    const wash_score = Math.round(churn_score * 0.4 + flip_score * 0.4 + coord_score * 0.2);
    if (wash_score < minScore) continue;

    const flags: string[] = [];
    if (avg_churn > 0.3) flags.push('HIGH_CHURN');
    if (flips >= 3) flags.push('FAST_FLIP');
    if (coords >= 2) flags.push('COORD_ENTRY');

    results.push({
      share_code,
      issuer_name: stats.issuer_name,
      wash_score,
      churn_rate: Math.round(avg_churn * 10000) / 100,
      flip_count: flips,
      coord_count: coords,
      flags: flags.join(','),
    });
  }

  return results.sort((a, b) => b.wash_score - a.wash_score).slice(0, 100);
}

// ── Institutional Foreign Tracker ─────────────────────────────────────────────

export type InstitutionTier = 'SWF' | 'AM' | 'CUSTODIAN';

export type InstitutionDef = {
  key: string;
  label: string;
  keywords: string[];
  tier: InstitutionTier;
};

// Priority order matters: AM matched before CUSTODIAN so "JPMCB NA RE - VANGUARD…" → VANGUARD, not JPMCB.
export const TRACKED_INSTITUTIONS: InstitutionDef[] = [
  { key: 'GIC', label: 'GIC Singapore', keywords: ['GOVERNMENT OF SINGAPORE'], tier: 'SWF' },
  { key: 'VANGUARD', label: 'Vanguard', keywords: ['VANGUARD'], tier: 'AM' },
  { key: 'FIDELITY', label: 'Fidelity', keywords: ['FIDELITY'], tier: 'AM' },
  { key: 'FRANKLIN', label: 'Franklin Templeton', keywords: ['FRANKLIN TEMPLETON'], tier: 'AM' },
  { key: 'ABERDEEN', label: 'Aberdeen / abrdn', keywords: ['ABERDEEN', 'ABRDN'], tier: 'AM' },
  { key: 'LAZARD', label: 'Lazard', keywords: ['LAZARD'], tier: 'AM' },
  { key: 'WELLINGTON', label: 'Wellington', keywords: ['WELLINGTON INVESTMENTS'], tier: 'AM' },
  { key: 'INVESCO', label: 'Invesco', keywords: ['INVESCO ASIAN', 'INVESCO FUNDS', 'INVESCO CONTINENTAL'], tier: 'AM' },
  { key: 'MAYBANK_AM', label: 'Maybank AM', keywords: ['MAYBANK GLOBAL GROWTH', 'MAYBANK OFFSHORE CORPORATE'], tier: 'AM' },
  { key: 'CIMB_INVEST', label: 'CIMB Investment', keywords: ['CIMB GROUP SDN', 'CIMB PRIVATE EQUITY'], tier: 'AM' },
  { key: 'ALLIANZ_G', label: 'Allianz Global', keywords: ['ALLIANZ GLOBAL LIMITED'], tier: 'AM' },
  { key: 'PICTET', label: 'Pictet', keywords: ['BANQUE PICTET'], tier: 'CUSTODIAN' },
  { key: 'JPMCB', label: 'JPMorgan Custody', keywords: ['JPMCB NA ', 'JPMORGAN CHASE BANK'], tier: 'CUSTODIAN' },
  { key: 'UBS', label: 'UBS Custody', keywords: ['UBS AG'], tier: 'CUSTODIAN' },
  { key: 'HSBC', label: 'HSBC Custody', keywords: ['HSBC BANK', 'HSBC LTD'], tier: 'CUSTODIAN' },
  { key: 'SCB', label: 'Standard Chartered', keywords: ['STANDARD CHARTERED BANK'], tier: 'CUSTODIAN' },
  { key: 'CGS', label: 'CGS International', keywords: ['CGS INTERNATIONAL'], tier: 'CUSTODIAN' },
  { key: 'PHILLIP', label: 'Phillip Securities', keywords: ['PHILLIP SECURITIES'], tier: 'CUSTODIAN' },
];

function matchInstitution(investorName: string): string | null {
  const upper = investorName.toUpperCase();
  for (const inst of TRACKED_INSTITUTIONS) {
    if (inst.keywords.some(kw => upper.includes(kw))) return inst.key;
  }
  return null;
}

export async function getInstitutionalSummary(date?: string): Promise<{
  key: string;
  label: string;
  tier: InstitutionTier;
  total_pct: number;
  emiten_count: number;
  prev_total_pct: number | null;
  delta_pct: number | null;
  names: string[];
}[]> {
  const db = await openOwnershipDb();
  const dates = await getAvailableDates();
  const curr = date ?? dates.at(-1);
  const prev = date ? dates[dates.indexOf(date) - 1] : dates.at(-2);
  if (!curr) return [];

  const rows = db.query<{ investor_name: string; pct: number }>(
    `SELECT investor_name, SUM(pct) as pct FROM idx_shareholders WHERE date=? AND local_foreign='A' GROUP BY investor_name`,
  ).all(curr);

  const prevRows = prev
    ? db.query<{ investor_name: string; pct: number }>(
        `SELECT investor_name, SUM(pct) as pct FROM idx_shareholders WHERE date=? AND local_foreign='A' GROUP BY investor_name`,
      ).all(prev)
    : [];

  const prevMap = new Map<string, number>(prevRows.map(r => [r.investor_name, r.pct]));

  type AccEntry = {
    label: string; tier: InstitutionTier; total_pct: number;
    prev_total_pct: number; emiten_set: Set<string>; names: string[];
  };
  const acc = new Map<string, AccEntry>();

  for (const inst of TRACKED_INSTITUTIONS) {
    acc.set(inst.key, { label: inst.label, tier: inst.tier, total_pct: 0, prev_total_pct: 0, emiten_set: new Set(), names: [] });
  }

  for (const r of rows) {
    const key = matchInstitution(r.investor_name);
    if (!key) continue;
    const e = acc.get(key)!;
    e.total_pct += r.pct;
    e.prev_total_pct += prevMap.get(r.investor_name) ?? 0;
    e.names.push(r.investor_name);
  }

  // Count emiten separately
  const emitenRows = db.query<{ investor_name: string; share_code: string }>(
    `SELECT investor_name, share_code FROM idx_shareholders WHERE date=? AND local_foreign='A'`,
  ).all(curr);
  for (const r of emitenRows) {
    const key = matchInstitution(r.investor_name);
    if (!key) continue;
    acc.get(key)!.emiten_set.add(r.share_code);
  }

  return Array.from(acc.entries())
    .map(([key, e]) => ({
      key,
      label: e.label,
      tier: e.tier,
      total_pct: Math.round(e.total_pct * 100) / 100,
      emiten_count: e.emiten_set.size,
      prev_total_pct: prev ? Math.round(e.prev_total_pct * 100) / 100 : null,
      delta_pct: prev ? Math.round((e.total_pct - e.prev_total_pct) * 100) / 100 : null,
      names: [...new Set(e.names)],
    }))
    .filter(e => e.total_pct > 0 || (e.prev_total_pct ?? 0) > 0)
    .sort((a, b) => b.total_pct - a.total_pct);
}

export async function getInstitutionalTimeline(key: string): Promise<{
  date: string;
  total_pct: number;
  emiten_count: number;
}[]> {
  const db = await openOwnershipDb();
  const dates = await getAvailableDates();
  const result: { date: string; total_pct: number; emiten_count: number }[] = [];

  for (const d of dates) {
    const rows = db.query<{ investor_name: string; pct: number; share_code: string }>(
      `SELECT investor_name, pct, share_code FROM idx_shareholders WHERE date=? AND local_foreign='A'`,
    ).all(d);
    let total = 0;
    const emitenSet = new Set<string>();
    for (const r of rows) {
      if (matchInstitution(r.investor_name) === key) {
        total += r.pct;
        emitenSet.add(r.share_code);
      }
    }
    result.push({ date: d, total_pct: Math.round(total * 100) / 100, emiten_count: emitenSet.size });
  }
  return result;
}

export async function getInstitutionalHoldings(key: string, date?: string): Promise<{
  share_code: string;
  issuer_name: string;
  investor_name: string;
  pct: number;
  local_foreign: string;
}[]> {
  const db = await openOwnershipDb();
  const d = date ?? (await getAvailableDates()).at(-1);
  if (!d) return [];

  const rows = db.query<{ investor_name: string; pct: number; share_code: string; issuer_name: string }>(
    `SELECT investor_name, pct, share_code, issuer_name FROM idx_shareholders WHERE date=? AND local_foreign='A' ORDER BY pct DESC`,
  ).all(d);

  return rows
    .filter(r => matchInstitution(r.investor_name) === key)
    .map(r => ({ ...r, local_foreign: 'A' }));
}

export async function getKnownVsDarkForeign(): Promise<{
  date: string;
  known_pct: number;
  dark_pct: number;
  total_foreign_pct: number;
  dark_ratio: number;
}[]> {
  const db = await openOwnershipDb();
  const dates = await getAvailableDates();
  const result: { date: string; known_pct: number; dark_pct: number; total_foreign_pct: number; dark_ratio: number }[] = [];

  for (const d of dates) {
    const rows = db.query<{ investor_name: string; pct: number }>(
      `SELECT investor_name, SUM(pct) as pct FROM idx_shareholders WHERE date=? AND local_foreign='A' GROUP BY investor_name`,
    ).all(d);

    let known = 0;
    let total = 0;
    for (const r of rows) {
      total += r.pct;
      if (matchInstitution(r.investor_name)) known += r.pct;
    }
    const dark = total - known;
    result.push({
      date: d,
      known_pct: Math.round(known * 100) / 100,
      dark_pct: Math.round(dark * 100) / 100,
      total_foreign_pct: Math.round(total * 100) / 100,
      dark_ratio: total > 0 ? Math.round(dark / total * 1000) / 10 : 0,
    });
  }
  return result;
}

// M5 supplementary signal: institutional foreign flow quality score 0-100.
// Higher = more concerning (dark foreign rising, known AM exiting).
export async function getInstitutionalFlowSignal(): Promise<{
  score: number;
  dark_ratio_latest: number;
  dark_ratio_prev: number;
  dark_rising: boolean;
  am_net_direction: 'BUYING' | 'SELLING' | 'NEUTRAL';
  swf_direction: 'BUYING' | 'SELLING' | 'NEUTRAL';
  summary: string;
}> {
  const kvd = await getKnownVsDarkForeign();
  const latest = kvd.at(-1);
  const prev = kvd.at(-2);

  const dark_ratio_latest = latest?.dark_ratio ?? 0;
  const dark_ratio_prev = prev?.dark_ratio ?? 0;
  const dark_rising = dark_ratio_latest > dark_ratio_prev + 1;

  const summary_data = await getInstitutionalSummary();
  const amDelta = summary_data
    .filter(e => e.tier === 'AM')
    .reduce((s, e) => s + (e.delta_pct ?? 0), 0);
  const swfDelta = summary_data
    .filter(e => e.tier === 'SWF')
    .reduce((s, e) => s + (e.delta_pct ?? 0), 0);

  const am_net_direction: 'BUYING' | 'SELLING' | 'NEUTRAL' =
    amDelta > 0.1 ? 'BUYING' : amDelta < -0.1 ? 'SELLING' : 'NEUTRAL';
  const swf_direction: 'BUYING' | 'SELLING' | 'NEUTRAL' =
    swfDelta > 0.1 ? 'BUYING' : swfDelta < -0.1 ? 'SELLING' : 'NEUTRAL';

  // Score: dark_ratio contributes 0-60, AM exit contributes 0-25, SWF exit 0-15
  const dark_score = Math.min(dark_ratio_latest * 0.6, 60);
  const am_score = am_net_direction === 'SELLING' ? Math.min(Math.abs(amDelta) * 10, 25) : 0;
  const swf_score = swf_direction === 'SELLING' ? Math.min(Math.abs(swfDelta) * 10, 15) : 0;
  const score = Math.round(dark_score + am_score + swf_score + (dark_rising ? 5 : 0));

  const parts: string[] = [];
  if (dark_rising) parts.push(`dark foreign ↑${(dark_ratio_latest - dark_ratio_prev).toFixed(1)}pp`);
  if (am_net_direction === 'SELLING') parts.push(`AM net sell ${amDelta.toFixed(2)}%`);
  if (swf_direction === 'SELLING') parts.push(`SWF net sell ${swfDelta.toFixed(2)}%`);
  if (!parts.length) parts.push('institutional flow stable');

  return {
    score,
    dark_ratio_latest,
    dark_ratio_prev,
    dark_rising,
    am_net_direction,
    swf_direction,
    summary: parts.join('; '),
  };
}
