import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface Session {
  id: string;
  branch: string;
  project_dir: string;
  started_at: string;
  last_active_at: string;
  observation_count: number;
  observation_tokens: number;
  reflection_count: number;
  is_active: number;
}

export function findOrCreateSession(db: Database.Database, branch: string, projectDir: string): Session {
  const existing = db.prepare(
    'SELECT * FROM sessions WHERE branch = ? AND project_dir = ? AND is_active = 1 ORDER BY last_active_at DESC LIMIT 1',
  ).get(branch, projectDir) as Session | undefined;

  if (existing) {
    db.prepare('UPDATE sessions SET last_active_at = datetime(\'now\') WHERE id = ?').run(existing.id);
    return existing;
  }

  const id = randomUUID();
  db.prepare(
    'INSERT INTO sessions (id, branch, project_dir) VALUES (?, ?, ?)',
  ).run(id, branch, projectDir);

  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session;
}

export function getSession(db: Database.Database, sessionId: string): Session | undefined {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as Session | undefined;
}

export function updateSessionStats(
  db: Database.Database,
  sessionId: string,
  tokensDelta: number,
): void {
  db.prepare(`
    UPDATE sessions
    SET observation_count = observation_count + 1,
        observation_tokens = observation_tokens + ?,
        last_active_at = datetime('now')
    WHERE id = ?
  `).run(tokensDelta, sessionId);
}

export function updateSessionAfterReflection(
  db: Database.Database,
  sessionId: string,
  newTokenCount: number,
): void {
  db.prepare(`
    UPDATE sessions
    SET observation_tokens = ?,
        reflection_count = reflection_count + 1,
        last_active_at = datetime('now')
    WHERE id = ?
  `).run(newTokenCount, sessionId);
}
