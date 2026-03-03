import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HOOKS_CONFIG = {
  Stop: [
    {
      hooks: [
        {
          type: 'command',
          command: 'npx codewatch-memory --hook',
          timeout: 30,
          async: true,
        },
      ],
    },
  ],
  PreCompact: [
    {
      hooks: [
        {
          type: 'command',
          command: 'npx codewatch-memory --hook',
          timeout: 60,
          async: true,
        },
      ],
    },
  ],
  UserPromptSubmit: [
    {
      hooks: [
        {
          type: 'command',
          command: 'npx codewatch-memory --recall',
        },
      ],
    },
  ],
  SessionStart: [
    {
      matcher: 'startup|resume|compact',
      hooks: [
        {
          type: 'command',
          command: 'npx codewatch-memory --recall',
        },
      ],
    },
  ],
};

export function runSetup(): void {
  const cwd = process.cwd();
  const claudeDir = join(cwd, '.claude');
  const settingsPath = join(claudeDir, 'settings.local.json');

  // Ensure .claude directory exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
    console.log('Created .claude/ directory');
  }

  // Load existing settings or start fresh
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      console.log('Found existing .claude/settings.local.json');
    } catch {
      console.log('Warning: could not parse existing settings, starting fresh');
    }
  }

  // Merge hooks — preserve existing non-codewatch hooks
  const existingHooks = (settings.hooks || {}) as Record<string, unknown[]>;
  const mergedHooks: Record<string, unknown[]> = { ...existingHooks };

  for (const [event, config] of Object.entries(HOOKS_CONFIG)) {
    const existing = existingHooks[event] as unknown[] | undefined;

    if (existing) {
      // Check if codewatch hooks are already present
      const hasCodewatch = JSON.stringify(existing).includes('codewatch-memory');
      if (hasCodewatch) {
        console.log(`  ${event}: already configured, skipping`);
        continue;
      }
      // Append our hooks to existing ones
      mergedHooks[event] = [...existing, ...config];
      console.log(`  ${event}: added codewatch hooks (preserved existing)`);
    } else {
      mergedHooks[event] = config;
      console.log(`  ${event}: configured`);
    }
  }

  settings.hooks = mergedHooks;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  console.log('');
  console.log('codewatch-memory hooks installed in .claude/settings.local.json');
  console.log('');
  console.log('Hooks configured:');
  console.log('  Stop / PreCompact    → auto-save observations (async, no delay)');
  console.log('  UserPromptSubmit     → auto-recall relevant memories on each prompt');
  console.log('  SessionStart         → inject session briefing on start/resume/compact');
  console.log('');
  console.log('You also need an MCP server for manual tools (observe/recall/reflect):');
  console.log('  claude mcp add codewatch -- npx codewatch-memory');
  console.log('');
  console.log('And at least one LLM API key for the Observer agent:');
  console.log('  export GROQ_API_KEY=your-key        # recommended (free tier)');
  console.log('  export GOOGLE_GENERATIVE_AI_API_KEY=your-key');
  console.log('  export OPENAI_API_KEY=your-key');
}
