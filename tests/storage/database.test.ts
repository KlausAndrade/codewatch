import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'codewatch-test-' + Date.now());

function createTestDb(): Database.Database {
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }

  const db = new Database(join(TEST_DIR, 'test.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create schema inline (same as database.ts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      branch TEXT NOT NULL DEFAULT 'unknown',
      project_dir TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
      observation_count INTEGER NOT NULL DEFAULT 0,
      observation_tokens INTEGER NOT NULL DEFAULT 0,
      reflection_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      metadata TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      branch TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN (
        'architecture', 'bugfix', 'convention', 'dependency',
        'file_pattern', 'user_preference', 'task_context', 'learning'
      )),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high', 'medium', 'low')),
      content TEXT NOT NULL,
      source_summary TEXT,
      referenced_files TEXT,
      observed_at TEXT NOT NULL DEFAULT (datetime('now')),
      referenced_at TEXT,
      token_count INTEGER NOT NULL DEFAULT 0,
      is_reflected INTEGER NOT NULL DEFAULT 0,
      metadata TEXT DEFAULT '{}',
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
      content,
      source_summary,
      referenced_files,
      content=observations,
      content_rowid=rowid
    );

    CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
      INSERT INTO observations_fts(rowid, content, source_summary, referenced_files)
      VALUES (new.rowid, new.content, new.source_summary, new.referenced_files);
    END;

    CREATE TABLE IF NOT EXISTS reflections (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      branch TEXT NOT NULL,
      compression_level INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      observation_ids TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      compression_ratio REAL NOT NULL,
      reflected_at TEXT NOT NULL DEFAULT (datetime('now')),
      metadata TEXT DEFAULT '{}',
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS current_tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      branch TEXT NOT NULL,
      description TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

describe('Database', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('creates all tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite%' ORDER BY name",
    ).pluck().all() as string[];

    expect(tables).toContain('sessions');
    expect(tables).toContain('observations');
    expect(tables).toContain('reflections');
    expect(tables).toContain('current_tasks');
    expect(tables).toContain('config');
  });

  it('creates FTS5 virtual table', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%fts%'",
    ).pluck().all() as string[];

    expect(tables).toContain('observations_fts');
  });

  it('can insert and query a session', () => {
    const id = 'test-session-1';
    db.prepare('INSERT INTO sessions (id, branch, project_dir) VALUES (?, ?, ?)').run(id, 'main', '/test');

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    expect(session.branch).toBe('main');
    expect(session.project_dir).toBe('/test');
    expect(session.observation_count).toBe(0);
  });

  it('can insert observations with category validation', () => {
    db.prepare('INSERT INTO sessions (id, branch, project_dir) VALUES (?, ?, ?)').run('s1', 'main', '/test');

    db.prepare(
      'INSERT INTO observations (id, session_id, branch, category, content, token_count) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('o1', 's1', 'main', 'bugfix', 'Fixed N+1 query in OrderController', 10);

    const obs = db.prepare('SELECT * FROM observations WHERE id = ?').get('o1') as any;
    expect(obs.category).toBe('bugfix');
    expect(obs.content).toContain('OrderController');
  });

  it('rejects invalid category', () => {
    db.prepare('INSERT INTO sessions (id, branch, project_dir) VALUES (?, ?, ?)').run('s1', 'main', '/test');

    expect(() => {
      db.prepare(
        'INSERT INTO observations (id, session_id, branch, category, content, token_count) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('o1', 's1', 'main', 'invalid_category', 'test', 1);
    }).toThrow();
  });

  it('FTS5 search finds observations by content', () => {
    db.prepare('INSERT INTO sessions (id, branch, project_dir) VALUES (?, ?, ?)').run('s1', 'main', '/test');

    db.prepare(
      'INSERT INTO observations (id, session_id, branch, category, content, token_count) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('o1', 's1', 'main', 'bugfix', 'Fixed authentication bypass in middleware', 10);

    db.prepare(
      'INSERT INTO observations (id, session_id, branch, category, content, token_count) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('o2', 's1', 'main', 'architecture', 'Chose repository pattern for data access', 10);

    const results = db.prepare(`
      SELECT o.* FROM observations o
      JOIN observations_fts fts ON o.rowid = fts.rowid
      WHERE fts.observations_fts MATCH ?
    `).all('authentication') as any[];

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('o1');
  });

  it('enforces foreign key on observations → sessions', () => {
    expect(() => {
      db.prepare(
        'INSERT INTO observations (id, session_id, branch, category, content, token_count) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('o1', 'nonexistent', 'main', 'bugfix', 'test', 1);
    }).toThrow();
  });
});
