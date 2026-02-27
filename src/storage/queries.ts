import Database from 'better-sqlite3';

export interface CurrentTask {
  id: string;
  session_id: string;
  branch: string;
  description: string;
  started_at: string;
  updated_at: string;
}

export function getCurrentTask(db: Database.Database, sessionId: string): CurrentTask | undefined {
  return db.prepare(
    'SELECT * FROM current_tasks WHERE session_id = ?',
  ).get(sessionId) as CurrentTask | undefined;
}

export function upsertCurrentTask(db: Database.Database, sessionId: string, branch: string, description: string): void {
  db.prepare(`
    INSERT INTO current_tasks (id, session_id, branch, description)
    VALUES (hex(randomblob(16)), ?, ?, ?)
    ON CONFLICT(session_id)
    DO UPDATE SET description = excluded.description, updated_at = datetime('now')
  `).run(sessionId, branch, description);
}

export function deleteCurrentTask(db: Database.Database, sessionId: string): void {
  db.prepare('DELETE FROM current_tasks WHERE session_id = ?').run(sessionId);
}
