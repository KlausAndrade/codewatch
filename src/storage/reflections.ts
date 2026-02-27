import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface Reflection {
  id: string;
  session_id: string;
  branch: string;
  compression_level: number;
  content: string;
  observation_ids: string;
  input_tokens: number;
  output_tokens: number;
  compression_ratio: number;
  reflected_at: string;
}

export interface InsertReflectionParams {
  sessionId: string;
  branch: string;
  compressionLevel: number;
  content: string;
  observationIds: string[];
  inputTokens: number;
  outputTokens: number;
}

export function insertReflection(db: Database.Database, params: InsertReflectionParams): Reflection {
  const id = randomUUID();
  const compressionRatio = params.inputTokens / Math.max(params.outputTokens, 1);

  db.prepare(`
    INSERT INTO reflections (id, session_id, branch, compression_level, content, observation_ids, input_tokens, output_tokens, compression_ratio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.sessionId,
    params.branch,
    params.compressionLevel,
    params.content,
    JSON.stringify(params.observationIds),
    params.inputTokens,
    params.outputTokens,
    compressionRatio,
  );

  return db.prepare('SELECT * FROM reflections WHERE id = ?').get(id) as Reflection;
}

export function getReflectionsByBranch(db: Database.Database, branch: string): Reflection[] {
  return db.prepare(
    'SELECT * FROM reflections WHERE branch = ? ORDER BY reflected_at DESC',
  ).all(branch) as Reflection[];
}

export function getLatestReflection(db: Database.Database, branch: string): Reflection | undefined {
  return db.prepare(
    'SELECT * FROM reflections WHERE branch = ? ORDER BY reflected_at DESC LIMIT 1',
  ).get(branch) as Reflection | undefined;
}
