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

CREATE TABLE IF NOT EXISTS macro_theses (
  id INTEGER PRIMARY KEY,
  thesis_date TEXT NOT NULL,
  primary_divergence TEXT NOT NULL,
  thesis_statement TEXT NOT NULL,
  trigger_indicator TEXT NOT NULL,
  trigger_threshold REAL NOT NULL,
  trigger_direction TEXT NOT NULL DEFAULT 'above',
  predicted_cds_bps REAL,
  predicted_usdidr REAL,
  predicted_sbn10y REAL,
  crisis_probability REAL,
  ev_estimate REAL,
  kill_conditions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'armed',
  triggered_at TEXT,
  killed_at TEXT,
  closed_at TEXT,
  actual_cds_bps REAL,
  actual_usdidr REAL,
  actual_sbn10y REAL,
  actual_pnl_pct REAL,
  lead_time_days INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL
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

export async function saveModuleScore(
  module: string,
  score: number,
  alertLevel: string,
  components: Record<string, unknown> = {},
): Promise<void> {
  const db = await openDb();
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  db.query(
    `INSERT OR REPLACE INTO macro_scores (module, score_date, score, alert_level, components, computed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(module, today, score, alertLevel, JSON.stringify(components), now);
}

export async function getLatestModuleScores(): Promise<Record<string, { score: number; alertLevel: string; computedAt: string; flags: string[] }>> {
  const db = await openDb();
  const rows = db.query<{ module: string; score: number; alert_level: string; computed_at: string; components: string }>(
    `SELECT module, score, alert_level, computed_at, components FROM macro_scores
     WHERE (module, score_date) IN (SELECT module, MAX(score_date) FROM macro_scores GROUP BY module)`,
  ).all();
  const result: Record<string, { score: number; alertLevel: string; computedAt: string; flags: string[] }> = {};
  for (const r of rows) {
    let flags: string[] = [];
    try {
      const comp = JSON.parse(r.components || '{}');
      if (Array.isArray(comp.flags)) flags = comp.flags;
    } catch {}
    result[r.module] = { score: r.score, alertLevel: r.alert_level, computedAt: r.computed_at, flags };
  }
  return result;
}

/** Module score history from macro_scores table (not macro_series). Use for kill switch checks. */
export async function getModuleScoreHistory(module: string, days: number): Promise<{ date: string; score: number }[]> {
  const db = await openDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return db.query<{ score_date: string; score: number }>(
    `SELECT score_date, score FROM macro_scores WHERE module = ? AND score_date >= ? ORDER BY score_date ASC`,
  ).all(module, since).map(r => ({ date: r.score_date, score: r.score }));
}

/** Latest stored USDIDR rate + staleness in days. Returns null if no data in DB. */
export async function getLatestUsdIdr(): Promise<{ rate: number; date: string; staleDays: number } | null> {
  const point = await getLatestPoint('usdidr_spot');
  if (!point) return null;
  const staleDays = Math.floor((Date.now() - new Date(point.date).getTime()) / 86_400_000);
  return { rate: point.value, date: point.date, staleDays };
}

// ── Thesis DB ─────────────────────────────────────────────────────────────────

export interface ThesisRecord {
  id?: number;
  thesisDate: string;
  primaryDivergence: string;
  thesisStatement: string;
  triggerIndicator: string;
  triggerThreshold: number;
  triggerDirection: 'above' | 'below';
  predictedCdsBps?: number | null;
  predictedUsdidr?: number | null;
  predictedSbn10y?: number | null;
  crisisProbability?: number | null;
  evEstimate?: number | null;
  killConditions: string[];
  status: 'armed' | 'triggered' | 'confirmed' | 'killed' | 'closed';
  triggeredAt?: string | null;
  killedAt?: string | null;
  closedAt?: string | null;
  actualCdsBps?: number | null;
  actualUsdidr?: number | null;
  actualSbn10y?: number | null;
  actualPnlPct?: number | null;
  leadTimeDays?: number | null;
  notes?: string | null;
  createdAt: string;
}

type ThesisRow = {
  id: number; thesis_date: string; primary_divergence: string; thesis_statement: string;
  trigger_indicator: string; trigger_threshold: number; trigger_direction: string;
  predicted_cds_bps: number | null; predicted_usdidr: number | null; predicted_sbn10y: number | null;
  crisis_probability: number | null; ev_estimate: number | null; kill_conditions: string;
  status: string; triggered_at: string | null; killed_at: string | null; closed_at: string | null;
  actual_cds_bps: number | null; actual_usdidr: number | null; actual_sbn10y: number | null;
  actual_pnl_pct: number | null; lead_time_days: number | null; notes: string | null; created_at: string;
};

function rowToThesis(r: ThesisRow): ThesisRecord {
  return {
    id: r.id,
    thesisDate: r.thesis_date,
    primaryDivergence: r.primary_divergence,
    thesisStatement: r.thesis_statement,
    triggerIndicator: r.trigger_indicator,
    triggerThreshold: r.trigger_threshold,
    triggerDirection: r.trigger_direction as 'above' | 'below',
    predictedCdsBps: r.predicted_cds_bps,
    predictedUsdidr: r.predicted_usdidr,
    predictedSbn10y: r.predicted_sbn10y,
    crisisProbability: r.crisis_probability,
    evEstimate: r.ev_estimate,
    killConditions: JSON.parse(r.kill_conditions || '[]') as string[],
    status: r.status as ThesisRecord['status'],
    triggeredAt: r.triggered_at,
    killedAt: r.killed_at,
    closedAt: r.closed_at,
    actualCdsBps: r.actual_cds_bps,
    actualUsdidr: r.actual_usdidr,
    actualSbn10y: r.actual_sbn10y,
    actualPnlPct: r.actual_pnl_pct,
    leadTimeDays: r.lead_time_days,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

export async function saveThesis(t: Omit<ThesisRecord, 'id'>): Promise<number> {
  const db = await openDb();
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO macro_theses
      (thesis_date, primary_divergence, thesis_statement, trigger_indicator, trigger_threshold,
       trigger_direction, predicted_cds_bps, predicted_usdidr, predicted_sbn10y,
       crisis_probability, ev_estimate, kill_conditions, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    t.thesisDate, t.primaryDivergence, t.thesisStatement, t.triggerIndicator, t.triggerThreshold,
    t.triggerDirection, t.predictedCdsBps ?? null, t.predictedUsdidr ?? null, t.predictedSbn10y ?? null,
    t.crisisProbability ?? null, t.evEstimate ?? null, JSON.stringify(t.killConditions), t.status, now,
  );
  const row = db.query<{ id: number }>('SELECT last_insert_rowid() AS id').get();
  return row?.id ?? 0;
}

export async function updateThesisStatus(
  id: number,
  status: ThesisRecord['status'],
  actuals?: { actualCdsBps?: number; actualUsdidr?: number; actualSbn10y?: number; actualPnlPct?: number; notes?: string },
): Promise<void> {
  const db = await openDb();
  const now = new Date().toISOString();
  const triggeredAt = status === 'triggered' ? now : null;
  const killedAt = status === 'killed' ? now : null;
  const closedAt = (status === 'closed' || status === 'confirmed') ? now : null;
  db.query(
    `UPDATE macro_theses SET status=?, triggered_at=COALESCE(triggered_at,?),
     killed_at=COALESCE(killed_at,?), closed_at=COALESCE(closed_at,?),
     actual_cds_bps=COALESCE(?,actual_cds_bps), actual_usdidr=COALESCE(?,actual_usdidr),
     actual_sbn10y=COALESCE(?,actual_sbn10y), actual_pnl_pct=COALESCE(?,actual_pnl_pct),
     notes=COALESCE(?,notes)
     WHERE id=?`,
  ).run(
    status, triggeredAt, killedAt, closedAt,
    actuals?.actualCdsBps ?? null, actuals?.actualUsdidr ?? null,
    actuals?.actualSbn10y ?? null, actuals?.actualPnlPct ?? null,
    actuals?.notes ?? null, id,
  );
}

export async function getLatestThesis(): Promise<ThesisRecord | null> {
  const db = await openDb();
  const row = db.query<ThesisRow>(
    `SELECT * FROM macro_theses WHERE status IN ('armed','triggered') ORDER BY created_at DESC LIMIT 1`,
  ).get();
  return row ? rowToThesis(row) : null;
}

export async function getAllTheses(limit = 20): Promise<ThesisRecord[]> {
  const db = await openDb();
  const rows = db.query<ThesisRow>(`SELECT * FROM macro_theses ORDER BY created_at DESC LIMIT ?`).all(limit);
  return rows.map(rowToThesis);
}
