import { loadConfig } from './config.js';
import { initializeDatabase } from './storage/database.js';
import { findOrCreateSession } from './storage/sessions.js';
import { insertObservation } from './storage/observations.js';
import { updateSessionStats } from './storage/sessions.js';
import { getCurrentBranch } from './git/branch.js';
import { runObserver } from './agents/observer.js';
import { upsertCurrentTask } from './storage/queries.js';
import { parseTranscript, formatMessagesForObserver } from './transcript.js';
import { estimateTokens } from './utils/tokens.js';

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
}

/**
 * Hook entry point. Called by Claude Code hooks on Stop/PreCompact events.
 * Reads stdin for hook input, processes the transcript, extracts observations.
 */
export async function runHook(): Promise<void> {
  // Read stdin for hook input
  const input = await readStdin();
  let hookInput: HookInput;

  try {
    hookInput = JSON.parse(input);
  } catch {
    console.error('codewatch-hook: Failed to parse hook input');
    process.exit(0); // Exit cleanly so we don't block Claude
  }

  if (!hookInput.transcript_path) {
    console.error('codewatch-hook: No transcript_path in hook input');
    process.exit(0);
  }

  const config = loadConfig();

  // Use the cwd from the hook input as the project dir
  if (hookInput.cwd) {
    config.projectDir = hookInput.cwd;
  }

  const db = initializeDatabase(config);
  const branch = await getCurrentBranch(config);
  const session = findOrCreateSession(db, branch, config.projectDir);

  // Parse transcript — get last 20 messages
  const messages = parseTranscript(hookInput.transcript_path, 20);

  if (messages.length === 0) {
    process.exit(0);
  }

  // Check if we've already processed these messages
  const lastProcessedKey = `last_transcript_lines_${session.id}`;
  const lastProcessed = db.prepare('SELECT value FROM config WHERE key = ?').get(lastProcessedKey) as { value: string } | undefined;
  const messageHash = simpleHash(messages.map((m) => m.content).join(''));

  if (lastProcessed && lastProcessed.value === messageHash) {
    process.exit(0); // Already processed
  }

  const formattedMessages = formatMessagesForObserver(messages);
  const messageTokens = estimateTokens(formattedMessages);

  // Skip if too few tokens (trivial turn like "hi" or "ok")
  if (messageTokens < 50) {
    process.exit(0);
  }

  try {
    // Use the Observer LLM to extract observations
    const observerOutput = await runObserver(formattedMessages, branch, config.projectDir);

    if (observerOutput.observations && observerOutput.observations.trim()) {
      // Parse observations into individual entries and store them
      const observationLines = extractObservationLines(observerOutput.observations);

      for (const line of observationLines) {
        const { priority, category, content } = parseObservationLine(line);

        if (content.length > 10) {
          const obs = insertObservation(db, {
            sessionId: session.id,
            branch,
            category,
            priority,
            content,
            sourceSummary: `auto-observed from hook (${hookInput.hook_event_name || 'Stop'})`,
          });
          updateSessionStats(db, session.id, obs.token_count);
        }
      }

      // Update current task if found
      if (observerOutput.currentTask) {
        upsertCurrentTask(db, session.id, branch, observerOutput.currentTask);
      }
    }

    // Mark as processed
    db.prepare(`
      INSERT INTO config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(lastProcessedKey, messageHash);

  } catch (error) {
    // Don't crash — just log and exit cleanly
    console.error('codewatch-hook: Observer failed:', error);
  }

  process.exit(0);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));

    // Timeout after 5 seconds if no stdin
    setTimeout(() => resolve(data), 5000);
  });
}

function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return String(hash);
}

function extractObservationLines(observationsText: string): string[] {
  return observationsText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-') || line.startsWith('🔴') || line.startsWith('🟡') || line.startsWith('🟢'));
}

function parseObservationLine(line: string): { priority: string; category: string; content: string } {
  let priority = 'medium';
  let content = line;

  // Extract priority from emoji
  if (line.includes('🔴')) {
    priority = 'high';
    content = content.replace('🔴', '').trim();
  } else if (line.includes('🟡')) {
    priority = 'medium';
    content = content.replace('🟡', '').trim();
  } else if (line.includes('🟢')) {
    priority = 'low';
    content = content.replace('🟢', '').trim();
  }

  // Remove leading "- " and timestamp
  content = content.replace(/^-\s*/, '').replace(/^\d{2}:\d{2}\s*/, '').trim();

  // Detect category from content patterns
  const category = detectCategory(content);

  return { priority, category, content };
}

function detectCategory(content: string): string {
  const lower = content.toLowerCase();

  if (lower.includes('decided') || lower.includes('chose') || lower.includes('architecture') || lower.includes('pattern')) {
    return 'architecture';
  }
  if (lower.includes('fix') || lower.includes('bug') || lower.includes('error') || lower.includes('crash')) {
    return 'bugfix';
  }
  if (lower.includes('prefer') || lower.includes('always') || lower.includes('never') || lower.includes('user wants')) {
    return 'user_preference';
  }
  if (lower.includes('convention') || lower.includes('naming') || lower.includes('style')) {
    return 'convention';
  }
  if (lower.includes('install') || lower.includes('package') || lower.includes('dependency') || lower.includes('version')) {
    return 'dependency';
  }
  if (lower.includes('file') || lower.includes('directory') || lower.includes('path') || lower.includes('.ts') || lower.includes('.php')) {
    return 'file_pattern';
  }
  if (lower.includes('task') || lower.includes('working on') || lower.includes('building') || lower.includes('implementing')) {
    return 'task_context';
  }

  return 'learning';
}
