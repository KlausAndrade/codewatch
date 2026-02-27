import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CodewatchConfig } from '../config.js';

const SCHEMA_SQL = `
-- Sessions: tracks active working sessions scoped to git branches
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

CREATE INDEX IF NOT EXISTS idx_sessions_branch ON sessions(branch);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_dir);

-- Observations: individual observed facts from coding sessions
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

CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
CREATE INDEX IF NOT EXISTS idx_observations_branch ON observations(branch);
CREATE INDEX IF NOT EXISTS idx_observations_category ON observations(category);
CREATE INDEX IF NOT EXISTS idx_observations_priority ON observations(priority);
CREATE INDEX IF NOT EXISTS idx_observations_observed_at ON observations(observed_at);
CREATE INDEX IF NOT EXISTS idx_observations_reflected ON observations(is_reflected);

-- Full-text search on observation content
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
    content,
    source_summary,
    referenced_files,
    content=observations,
    content_rowid=rowid
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
    INSERT INTO observations_fts(rowid, content, source_summary, referenced_files)
    VALUES (new.rowid, new.content, new.source_summary, new.referenced_files);
END;

CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, content, source_summary, referenced_files)
    VALUES ('delete', old.rowid, old.content, old.source_summary, old.referenced_files);
END;

CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, content, source_summary, referenced_files)
    VALUES ('delete', old.rowid, old.content, old.source_summary, old.referenced_files);
    INSERT INTO observations_fts(rowid, content, source_summary, referenced_files)
    VALUES (new.rowid, new.content, new.source_summary, new.referenced_files);
END;

-- Reflections: compressed summaries produced by the Reflector agent
CREATE TABLE IF NOT EXISTS reflections (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    branch TEXT NOT NULL,
    compression_level INTEGER NOT NULL DEFAULT 0 CHECK(compression_level BETWEEN 0 AND 3),
    content TEXT NOT NULL,
    observation_ids TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    compression_ratio REAL NOT NULL,
    reflected_at TEXT NOT NULL DEFAULT (datetime('now')),
    metadata TEXT DEFAULT '{}',
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reflections_session ON reflections(session_id);
CREATE INDEX IF NOT EXISTS idx_reflections_branch ON reflections(branch);

-- Current task tracking
CREATE TABLE IF NOT EXISTS current_tasks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    branch TEXT NOT NULL,
    description TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_current_tasks_branch ON current_tasks(branch);

-- Configuration store
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function initializeDatabase(config: CodewatchConfig): Database.Database {
  if (!existsSync(config.dataDir)) {
    mkdirSync(config.dataDir, { recursive: true });
  }

  const dbPath = join(config.dataDir, 'codewatch.db');
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');

  db.exec(SCHEMA_SQL);

  return db;
}
