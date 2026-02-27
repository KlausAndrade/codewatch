import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { estimateTokens } from '../utils/tokens.js';

export interface Observation {
  id: string;
  session_id: string;
  branch: string;
  category: string;
  priority: string;
  content: string;
  source_summary: string | null;
  referenced_files: string | null;
  observed_at: string;
  referenced_at: string | null;
  token_count: number;
  is_reflected: number;
}

export interface InsertObservationParams {
  sessionId: string;
  branch: string;
  category: string;
  priority: string;
  content: string;
  sourceSummary?: string;
  files?: string[];
}

export function insertObservation(db: Database.Database, params: InsertObservationParams): Observation {
  const id = randomUUID();
  const tokenCount = estimateTokens(params.content);
  const referencedFiles = params.files ? JSON.stringify(params.files) : null;

  db.prepare(`
    INSERT INTO observations (id, session_id, branch, category, priority, content, source_summary, referenced_files, token_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.sessionId, params.branch, params.category, params.priority, params.content, params.sourceSummary ?? null, referencedFiles, tokenCount);

  return db.prepare('SELECT * FROM observations WHERE id = ?').get(id) as Observation;
}

export function getObservationsByBranch(
  db: Database.Database,
  branch: string,
  options?: {
    unreflectedOnly?: boolean;
    categories?: string[];
    priorityMin?: string;
    limit?: number;
  },
): Observation[] {
  let query = 'SELECT * FROM observations WHERE branch = ?';
  const queryParams: unknown[] = [branch];

  if (options?.unreflectedOnly) {
    query += ' AND is_reflected = 0';
  }

  if (options?.categories && options.categories.length > 0) {
    const placeholders = options.categories.map(() => '?').join(',');
    query += ` AND category IN (${placeholders})`;
    queryParams.push(...options.categories);
  }

  if (options?.priorityMin) {
    const priorityMap: Record<string, string[]> = {
      high: ['high'],
      medium: ['high', 'medium'],
      low: ['high', 'medium', 'low'],
    };
    const allowed = priorityMap[options.priorityMin] || ['high', 'medium', 'low'];
    const placeholders = allowed.map(() => '?').join(',');
    query += ` AND priority IN (${placeholders})`;
    queryParams.push(...allowed);
  }

  query += ' ORDER BY observed_at DESC';

  if (options?.limit) {
    query += ' LIMIT ?';
    queryParams.push(options.limit);
  }

  return db.prepare(query).all(...queryParams) as Observation[];
}

export function searchObservations(
  db: Database.Database,
  branch: string,
  query: string,
  limit: number = 50,
): Observation[] {
  return db.prepare(`
    SELECT o.* FROM observations o
    JOIN observations_fts fts ON o.rowid = fts.rowid
    WHERE fts.observations_fts MATCH ?
      AND o.branch = ?
    ORDER BY rank
    LIMIT ?
  `).all(query, branch, limit) as Observation[];
}

export function searchObservationsByFiles(
  db: Database.Database,
  branch: string,
  files: string[],
  limit: number = 50,
): Observation[] {
  const conditions = files.map(() => 'o.referenced_files LIKE ?').join(' OR ');
  const params = files.map((f) => `%${f}%`);

  return db.prepare(`
    SELECT o.* FROM observations o
    WHERE o.branch = ?
      AND (${conditions})
    ORDER BY o.observed_at DESC
    LIMIT ?
  `).all(branch, ...params, limit) as Observation[];
}

export function markObservationsReflected(db: Database.Database, ids: string[]): void {
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE observations SET is_reflected = 1 WHERE id IN (${placeholders})`).run(...ids);
}

export function getUnreflectedTokenCount(db: Database.Database, branch: string): number {
  const result = db.prepare(
    'SELECT COALESCE(SUM(token_count), 0) as total FROM observations WHERE branch = ? AND is_reflected = 0',
  ).get(branch) as { total: number };
  return result.total;
}

export function getCategoryBreakdown(db: Database.Database, branch: string): Record<string, number> {
  const rows = db.prepare(
    'SELECT category, COUNT(*) as count FROM observations WHERE branch = ? AND is_reflected = 0 GROUP BY category',
  ).all(branch) as Array<{ category: string; count: number }>;

  const breakdown: Record<string, number> = {};
  for (const row of rows) {
    breakdown[row.category] = row.count;
  }
  return breakdown;
}
