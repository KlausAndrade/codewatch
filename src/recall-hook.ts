import type Database from 'better-sqlite3';
import { loadConfig } from './config.js';
import { initializeDatabase } from './storage/database.js';
import { findOrCreateSession } from './storage/sessions.js';
import {
  searchObservations,
  getObservationsByBranch,
  type Observation,
} from './storage/observations.js';
import { getLatestReflection } from './storage/reflections.js';
import { getCurrentTask } from './storage/queries.js';
import { getCurrentBranch } from './git/branch.js';
import { readStdin } from './utils/stdin.js';

// --- Constants ---

const MAX_OUTPUT_CHARS = 4000;   // ~1K tokens for prompt-driven recall
const MAX_BRIEFING_CHARS = 6000; // ~1.5K tokens for session briefings
const MAX_OBSERVATIONS = 15;
const MAX_BRIEFING_OBSERVATIONS = 20;
const MAX_KEYWORDS = 8;

// --- Interfaces ---

interface RecallHookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  prompt?: string;
}

// --- Stop words (no search value) ---

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'i', 'me', 'my', 'you', 'your', 'we', 'our', 'they', 'them', 'their',
  'he', 'she', 'it', 'his', 'her', 'its',
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
  'how', 'when', 'where', 'why',
  'and', 'or', 'but', 'not', 'no', 'nor', 'so', 'if', 'then',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by', 'as',
  'into', 'about', 'up', 'out', 'off', 'over', 'under', 'between',
  'all', 'each', 'every', 'any', 'some', 'more', 'most', 'other',
  'just', 'also', 'very', 'really', 'already', 'still', 'even',
  'here', 'there', 'now', 'then', 'again', 'once',
  'please', 'thanks', 'help', 'want', 'like', 'make', 'get', 'let',
  'go', 'going', 'take', 'put', 'see', 'look', 'give', 'use', 'using',
  'think', 'know', 'thing', 'something', 'anything',
  'yes', 'yeah', 'yep', 'sure', 'okay', 'done', 'right', 'hey', 'hello',
  'nope', 'great', 'good', 'nice', 'fine', 'cool', 'continue', 'next',
  'show', 'tell', 'change', 'add', 'remove', 'delete', 'update', 'create',
  'new', 'old', 'first', 'last', 'try', 'run', 'start', 'stop', 'keep',
]);

// Short coding terms that should always pass through stop-word filtering
const CODING_TERMS = new Set([
  'api', 'bug', 'fix', 'test', 'error', 'auth', 'db', 'sql', 'css',
  'dom', 'app', 'cli', 'npm', 'git', 'env', 'url', 'jwt', 'ssr',
  'sdk', 'aws', 'gcp', 'tsx', 'jsx', 'vue', 'php', 'pip', 'orm',
]);

// --- Entry point ---

export async function runRecallHook(): Promise<void> {
  const input = await readStdin(2000); // Shorter timeout — this is latency-critical
  let hookInput: RecallHookInput;

  try {
    hookInput = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const config = loadConfig();
  if (hookInput.cwd) {
    config.projectDir = hookInput.cwd;
  }

  let db: Database.Database;
  try {
    db = initializeDatabase(config);
  } catch {
    process.exit(0); // No DB — nothing to recall
  }

  const branch = await getCurrentBranch(config);
  const session = findOrCreateSession(db, branch, config.projectDir);

  let output = '';

  if (hookInput.hook_event_name === 'UserPromptSubmit' && hookInput.prompt) {
    output = handleUserPromptRecall(db, session.id, branch, hookInput.prompt);
  } else if (
    hookInput.hook_event_name === 'SessionStart' ||
    hookInput.hook_event_name === 'startup' ||
    hookInput.hook_event_name === 'resume' ||
    hookInput.hook_event_name === 'compact'
  ) {
    output = handleSessionStartRecall(db, session.id, branch);
  }

  if (output.trim()) {
    process.stdout.write(output);
  }

  process.exit(0);
}

// --- Prompt-driven recall (UserPromptSubmit) ---

function handleUserPromptRecall(
  db: Database.Database,
  sessionId: string,
  branch: string,
  prompt: string,
): string {
  const keywords = extractKeywords(prompt);

  if (keywords.length === 0) {
    return '';
  }

  let observations: Observation[] = [];

  // Strategy 1: FTS5 search with all keywords (OR)
  try {
    const ftsQuery = buildFtsQuery(keywords);
    if (ftsQuery) {
      observations = searchObservations(db, branch, ftsQuery, MAX_OBSERVATIONS);
    }
  } catch {
    // FTS query failed — fall through to next strategy
  }

  // Strategy 2: Individual keyword search if combined query returned nothing
  if (observations.length === 0 && keywords.length > 1) {
    for (const keyword of keywords.slice(0, 3)) {
      try {
        const results = searchObservations(db, branch, keyword, 5);
        observations.push(...results);
      } catch {
        // Skip failed keyword
      }
    }
    observations = deduplicateById(observations);
  }

  // Strategy 3: Category-based heuristic if FTS found nothing
  if (observations.length === 0) {
    const inferredCategories = inferCategories(prompt);
    if (inferredCategories.length > 0) {
      observations = getObservationsByBranch(db, branch, {
        categories: inferredCategories,
        priorityMin: 'medium',
        limit: MAX_OBSERVATIONS,
      });
    }
  }

  if (observations.length === 0) {
    return '';
  }

  return formatRecallOutput(observations, sessionId, db);
}

// --- Session briefing (SessionStart) ---

function handleSessionStartRecall(
  db: Database.Database,
  sessionId: string,
  branch: string,
): string {
  const sections: string[] = [];

  // 1. Current task
  const task = getCurrentTask(db, sessionId);
  if (task) {
    sections.push(`<current-task>\n${task.description}\n</current-task>`);
  }

  // 2. Latest reflection (compressed summary of past observations)
  const reflection = getLatestReflection(db, branch);
  if (reflection) {
    const truncated = truncateToCharLimit(reflection.content, MAX_BRIEFING_CHARS / 2);
    sections.push(`<session-reflection>\n${truncated}\n</session-reflection>`);
  }

  // 3. High-priority unreflected observations (new since last reflection)
  const highPriority = getObservationsByBranch(db, branch, {
    priorityMin: 'high',
    unreflectedOnly: true,
    limit: MAX_BRIEFING_OBSERVATIONS,
  });

  if (highPriority.length > 0) {
    const lines = highPriority.map(formatObservationLine).join('\n');
    sections.push(`<key-observations>\n${lines}\n</key-observations>`);
  }

  // 4. Fallback: if no reflection and no high-priority, show recent observations
  if (!reflection && highPriority.length === 0) {
    const recent = getObservationsByBranch(db, branch, { limit: 10 });
    if (recent.length > 0) {
      const lines = recent.map(formatObservationLine).join('\n');
      sections.push(`<recent-observations>\n${lines}\n</recent-observations>`);
    }
  }

  if (sections.length === 0) {
    return '';
  }

  let output = '<codewatch-memory-briefing>\n';
  output += sections.join('\n\n');
  output += '\n</codewatch-memory-briefing>';

  return truncateToCharLimit(output, MAX_BRIEFING_CHARS);
}

// --- Keyword extraction ---

export function extractKeywords(prompt: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  // 1. Extract file paths (highest signal)
  const pathRegex = /[\w./-]+\.\w{1,10}/g;
  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(prompt)) !== null) {
    const fp = match[0];
    if ((fp.includes('/') || fp.includes('.')) && !seen.has(fp)) {
      seen.add(fp);
      result.push(fp);
    }
  }

  // 2. Extract quoted phrases
  const quoteRegex = /["']([^"']+)["']/g;
  while ((match = quoteRegex.exec(prompt)) !== null) {
    const phrase = match[1].trim();
    if (phrase && !seen.has(phrase.toLowerCase())) {
      seen.add(phrase.toLowerCase());
      result.push(phrase);
    }
  }

  // 3. Tokenize remaining words, filter stop words
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9_\-.]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .filter((w) => !STOP_WORDS.has(w) || CODING_TERMS.has(w));

  for (const word of words) {
    if (!seen.has(word) && word.length >= 3) {
      seen.add(word);
      result.push(word);
    }
    // Short coding terms (2 chars) also pass
    if (!seen.has(word) && word.length === 2 && CODING_TERMS.has(word)) {
      seen.add(word);
      result.push(word);
    }
  }

  return result.slice(0, MAX_KEYWORDS);
}

// --- FTS5 query building ---

function buildFtsQuery(keywords: string[]): string {
  const sanitized = keywords
    .map((kw) => {
      // Strip FTS5 special characters
      const clean = kw.replace(/['"()*^]/g, '').trim();
      if (!clean) return null;
      // Multi-word or path-like terms get quoted
      if (clean.includes('/') || clean.includes('.') || clean.includes(' ')) {
        return `"${clean}"`;
      }
      return clean;
    })
    .filter(Boolean) as string[];

  if (sanitized.length === 0) return '';

  // OR gives broader recall; FTS5 rank (BM25) handles relevance ordering
  return sanitized.join(' OR ');
}

// --- Category inference (fallback when FTS returns nothing) ---

function inferCategories(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  const categories: string[] = [];

  if (/\b(bug|fix|error|crash|broken|issue|fail)\b/.test(lower)) {
    categories.push('bugfix');
  }
  if (/\b(architect|design|pattern|refactor|structure)\b/.test(lower)) {
    categories.push('architecture');
  }
  if (/\b(convention|naming|style|format|lint)\b/.test(lower)) {
    categories.push('convention');
  }
  if (/\b(package|dependency|install|upgrade|version)\b/.test(lower)) {
    categories.push('dependency');
  }
  if (/\b(prefer|always|never|workflow)\b/.test(lower)) {
    categories.push('user_preference');
  }
  if (/\b(file|directory|path|folder|structure)\b/.test(lower)) {
    categories.push('file_pattern');
  }

  return categories;
}

// --- Output formatting ---

function formatObservationLine(obs: Observation): string {
  const marker = obs.priority === 'high' ? '!' : obs.priority === 'medium' ? '*' : '-';
  const date = obs.observed_at.substring(0, 10);
  return `${marker} [${obs.category}] ${obs.content} (${date})`;
}

function formatRecallOutput(
  observations: Observation[],
  sessionId: string,
  db: Database.Database,
): string {
  const sections: string[] = [];

  const highObs = observations.filter((o) => o.priority === 'high');
  const otherObs = observations.filter((o) => o.priority !== 'high');

  if (highObs.length > 0) {
    const lines = highObs.map(formatObservationLine).join('\n');
    sections.push(`<key-observations>\n${lines}\n</key-observations>`);
  }

  if (otherObs.length > 0) {
    const lines = otherObs.map(formatObservationLine).join('\n');
    sections.push(`<related-observations>\n${lines}\n</related-observations>`);
  }

  const task = getCurrentTask(db, sessionId);
  if (task) {
    sections.push(`<current-task>\n${task.description}\n</current-task>`);
  }

  if (sections.length === 0) {
    return '';
  }

  let output = '<codewatch-memory>\n';
  output += sections.join('\n\n');
  output += '\n</codewatch-memory>';

  return truncateToCharLimit(output, MAX_OUTPUT_CHARS);
}

// --- Utilities ---

function deduplicateById(observations: Observation[]): Observation[] {
  const seen = new Set<string>();
  return observations.filter((obs) => {
    if (seen.has(obs.id)) return false;
    seen.add(obs.id);
    return true;
  });
}

function truncateToCharLimit(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const truncated = text.substring(0, limit);
  const lastNewline = truncated.lastIndexOf('\n');
  if (lastNewline > limit * 0.5) {
    return truncated.substring(0, lastNewline) + '\n[...truncated]';
  }
  return truncated + '...';
}
