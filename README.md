# codewatch-memory

Code-aware observational memory MCP server for AI coding assistants.

AI coding assistants (Claude Code, Cursor, Windsurf) suffer from session amnesia — context is lost on compaction or between sessions. Existing solutions are either framework-locked (Mastra's Observational Memory requires their agent framework) or simplistic (mcp-memory-keeper stores key-value pairs without intelligent compression).

**codewatch-memory** is an MCP-native server that implements observational memory specifically for coding workflows. It uses cheap LLMs (Groq, Gemini Flash) as Observer/Reflector agents to compress conversation context into a structured observation log, stored in SQLite, scoped per git branch.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│            Claude Code / Cursor / Windsurf              │
│                    (MCP Client)                         │
└──────────┬──────────────────────────────────┬───────────┘
           │                                  │
      [Stdout/Stdin]                   [Hook Event]
      (MCP Tools)                    (Stop/PreCompact)
           │                                  │
           v                                  v
  ┌─────────────────┐              ┌──────────────────┐
  │   MCP Server    │              │ Hook Subprocess  │
  │  (stdio mode)   │              │   --hook mode    │
  └────────┬────────┘              └────────┬─────────┘
           │                                │
           │  5 Tools                       │ Transcript
           │  observe/recall/reflect/       │ parsing &
           │  get_session_info/             │ observation
           │  switch_context                │ extraction
           │                                │
           v                                v
  ┌──────────────────────────────────────────────────┐
  │                  Agents Layer                     │
  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
  │  │ Observer  │  │Reflector │  │ Categorizer  │   │
  │  │ extract   │  │ compress │  │ classify     │   │
  │  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │
  └───────┼──────────────┼───────────────┼───────────┘
          │              │               │
          v              v               v
  ┌──────────────┐  ┌────────────────────────────┐
  │ LLM Provider │  │     SQLite Database        │
  │ Groq (free)  │  │  sessions / observations   │
  │ Google       │  │  reflections / tasks       │
  │ OpenAI       │  │  FTS5 full-text search     │
  └──────────────┘  └────────────────────────────┘
```

## How It Works

### The Core Loop

```
Capture → Categorize → Store → Search → Compress
```

**Two modes of operation:**

1. **Hook mode** (`--hook`) — Fires automatically after every AI response (`Stop` event) and before context compaction (`PreCompact`). Reads the last 20 messages from the conversation transcript, sends them to a cheap LLM, and extracts structured observations. No manual tool calls needed.

2. **MCP server mode** — Runs as an MCP server with 5 tools that the AI assistant can call directly for manual observation, recall, and compression.

### Observation Flow

```
Hook fires on Stop/PreCompact
  → Read last 20 transcript messages (JSONL)
  → Skip if < 50 tokens (trivial turn)
  → Skip if already processed (hash dedup)
  → Send to Observer LLM agent
  → Extract observations with priority + category
  → Store each in SQLite (FTS5 auto-indexed)
  → Update session stats
  → Check auto-reflect threshold (default 40K tokens)
     → If over: run Reflector with escalating compression
```

### Recall Flow

```
AI calls recall(query="authentication")
  → FTS5 full-text search on observations
  → Filter by category / priority / files / branch
  → Group by date with priority emojis
  → Include compressed reflections if requested
  → Include current task context
  → Return formatted observation log
```

## Three Agents

### Observer Agent

Extracts facts and decisions from AI-developer conversations. Runs frequently (every Stop event via hooks).

- **Temperature**: 0.3 (some creativity for phrasing, factual)
- **Input**: Last 20 conversation messages
- **Output**: Structured observations with priority emojis, section headers, timestamps

**Priority system:**
- **High** (sacred — survives all compression): Architecture decisions, user preferences, bug root causes, security decisions, breaking changes
- **Medium**: Implementation details, file modifications, dependency additions, test results, API endpoints, schema changes
- **Low** (first to compress): Exploratory questions, minor formatting, temporary debug steps, abandoned approaches

**Critical rules the Observer follows:**
- Distinguishes assertions from questions ("Should I use Redis?" is NOT "We use Redis")
- Preserves specific values: file paths, function names, versions, error messages
- Extracts facts and decisions, not reasoning
- Never fabricates observations

### Reflector Agent

Compresses observations while preserving critical information. Runs rarely (only when tokens exceed threshold).

- **Temperature**: 0 (deterministic, no hallucination)
- **Input**: All unreflected observations
- **Output**: Compressed observation log at target token count

**4 compression levels with escalation:**

| Level | Detail | Reduction | Strategy |
|-------|--------|-----------|----------|
| 0 | 10/10 | 0% | Reorganize only — merge duplicates, fix formatting |
| 1 | 8/10 | ~20% | Remove low-priority, consolidate conventions |
| 2 | 6/10 | ~40% | Drop all low-priority, merge by file/module |
| 3 | 4/10 | ~60% | Paragraph summaries, only recent dates keep individual entries |

**Sacred content that survives ALL levels:**
- Architecture decisions + rationale (never compressed)
- User preferences (permanent)
- Bug fix root causes (symptom drops, fix persists)
- Codebase learnings

**Escalation:** If compression doesn't reach the target token count, the Reflector automatically tries the next level up to level 3.

### Categorizer

Classifies observations into one of 8 categories. Uses heuristic keyword matching first (free, instant). Falls back to LLM only if confidence < 0.7.

## Observation Categories

| Category | Description | Default Priority |
|----------|-------------|-----------------|
| `architecture` | Design decisions, patterns chosen | high |
| `user_preference` | User's coding preferences, workflow choices | high |
| `bugfix` | Bugs found, root causes, fixes | medium |
| `convention` | Code conventions, naming patterns | medium |
| `dependency` | Package choices, version decisions | medium |
| `file_pattern` | Important file locations, project structure | medium |
| `task_context` | Current task goals, progress | medium |
| `learning` | Things learned about the codebase | medium |

## Installation

### Claude Code (CLI)

```bash
claude mcp add codewatch -- npx codewatch-memory
```

### Claude Code (VSCode)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "codewatch-memory": {
      "command": "npx",
      "args": ["codewatch-memory"],
      "env": {
        "GROQ_API_KEY": "${input:groqApiKey}",
        "CODEWATCH_LLM_PROVIDER": "groq"
      }
    }
  }
}
```

### Cursor / Windsurf

Add to your MCP config (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "codewatch-memory": {
      "command": "npx",
      "args": ["codewatch-memory"],
      "env": {
        "GROQ_API_KEY": "your-key",
        "CODEWATCH_LLM_PROVIDER": "groq"
      }
    }
  }
}
```

### From source

```bash
git clone https://github.com/KlausAndrade/codewatch.git
cd codewatch
npm install
npm run build
claude mcp add codewatch -- node /path/to/dist/index.js
```

## Automatic Observation (Claude Code Hooks)

The most powerful mode — observations happen automatically without any manual tool calls.

Add to `.claude/settings.local.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx codewatch-memory --hook",
            "timeout": 30,
            "async": true
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx codewatch-memory --hook",
            "timeout": 60,
            "async": true
          }
        ]
      }
    ]
  }
}
```

**How hooks work:**
- `Stop` fires after every Claude response — the hook reads the transcript and extracts observations
- `PreCompact` fires before context compaction — captures context before it's lost
- Hooks run async so they never block Claude
- Deduplication prevents processing the same messages twice
- Trivial turns (< 50 tokens) are skipped

## API Keys

At minimum, one LLM API key is required for the Observer/Reflector agents:

```bash
# Groq (recommended — fast, free tier available)
export GROQ_API_KEY=your-key

# Google Gemini (cheapest paid option)
export GOOGLE_GENERATIVE_AI_API_KEY=your-key

# OpenAI
export OPENAI_API_KEY=your-key
```

## MCP Tools

### `observe` — Store an observation

```
content: "Chose repository pattern over active record for User module because team needs to swap DB later"
category?: "architecture"  # auto-detected if omitted
priority?: "high"          # auto-assigned if omitted
files?: ["src/repositories/UserRepository.ts"]
source_summary?: "user asked to refactor data access"
```

### `recall` — Retrieve relevant observations

```
query?: "authentication"       # FTS5 full-text search
categories?: ["bugfix", "architecture"]
files?: ["src/auth/middleware.ts"]
priority_min?: "medium"        # high, medium, or low
limit?: 50
include_reflections?: true
branch?: "feature/auth"        # defaults to current branch
```

### `reflect` — Manual compression trigger

```
compression_level?: 0  # 0=reorganize, 1=light, 2=aggressive, 3=critical
branch?: "main"
```

### `get_session_info` — Session statistics

Returns observation count, token usage, categories breakdown, current task, and compression history.

### `switch_context` — Change branch scope

```
branch: "feature/new-ui"  # or "auto" to re-detect from git
carry_task?: true          # carry current task description to new branch
```

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `CODEWATCH_LLM_PROVIDER` | `google` | Primary LLM (google, openai, groq) |
| `CODEWATCH_FALLBACK_PROVIDER` | `openai` | Fallback LLM (google, openai, groq, none) |
| `CODEWATCH_GOOGLE_MODEL` | `gemini-2.5-flash` | Google model |
| `CODEWATCH_OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model |
| `CODEWATCH_GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model |
| `GROQ_API_KEY` | — | Groq API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | — | Google API key |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `CODEWATCH_REFLECT_THRESHOLD` | `40000` | Auto-reflect trigger (tokens) |
| `CODEWATCH_DATA_DIR` | `~/mcp-data/codewatch-memory/` | SQLite storage location |
| `CODEWATCH_AUTO_REFLECT` | `true` | Enable auto-reflection |
| `CODEWATCH_MAX_COMPRESSION` | `3` | Max compression level (0-3) |
| `CODEWATCH_LOG_LEVEL` | `info` | Logging verbosity |

## Choosing an LLM Provider

The Observer and Reflector agents use cheap/fast LLMs — not your main coding model. Here's what to consider:

| Provider | Cost | Speed | Quality for this task |
|----------|------|-------|-----------------------|
| **Groq** (llama-3.3-70b) | Free tier | Fastest | Good — handles structured extraction well |
| **Google** (gemini-2.5-flash) | ~$0.001/call | Fast | Good — cheapest paid option |
| **OpenAI** (gpt-4o-mini) | ~$0.003/call | Moderate | Good — reliable fallback |

**Recommendation:** Use Groq as primary (free, fast) with Google or OpenAI as fallback.

A more expensive model (GPT-4o, Claude Sonnet) would provide marginal improvement for the Observer — structured extraction works well with smaller models. The Reflector benefits more from model quality, but it runs rarely. The real quality gains come from prompt tuning, not model upgrades.

## Storage

Data is stored in `~/mcp-data/codewatch-memory/codewatch.db` (SQLite with WAL mode). The database includes:

- **Sessions**: Scoped to git branch + project directory
- **Observations**: Individual facts/decisions, full-text searchable via FTS5
- **Reflections**: Compressed observation summaries with compression ratios
- **Current Tasks**: Persisted "what am I working on" state
- **Config**: Deduplication hashes and user settings

### Schema Highlights

- FTS5 virtual table on observation content, source summary, and referenced files — kept in sync via INSERT/UPDATE/DELETE triggers
- WAL mode for concurrent read/write (hook + MCP server can coexist)
- Foreign keys enforced, 64MB cache, 5s busy timeout
- Git branch scoping isolates memory per feature branch

## Degenerate Output Detection

The Reflector includes 3 strategies to detect broken LLM output (repetitive/degenerate text):

1. **Exact duplicate lines** — if >30% of lines are duplicates, reject and escalate
2. **Word overlap** — if 3 consecutive lines share >80% of words, reject and escalate
3. **Substring repetition** — if any 50-200 char substring appears 3+ times, reject and escalate

When degenerate output is detected, the Reflector automatically retries at the next compression level.

## How It Compares to Mastra

| Feature | codewatch-memory | Mastra Observational Memory |
|---------|-----------------|----------------------------|
| Protocol | MCP (works with any MCP client) | Mastra framework only |
| Capture | Hook-based (last 20 messages per trigger) | Middleware (100% of messages) |
| Branch scoping | Per git branch | Not git-aware |
| Categories | 8 code-specific categories | Generic |
| Storage | Local SQLite + FTS5 | Configurable (Postgres, etc.) |
| Compression | 4-level escalation with sacred rules | 2-agent compression |
| Cost | Free (Groq) or near-free | Depends on provider |
| Setup | `npx codewatch-memory` | Requires Mastra framework |

**Trade-off:** Mastra's middleware approach captures 100% of messages automatically. codewatch-memory's hook approach captures the last 20 messages per trigger — effective for most coding sessions but can miss observations from very early in long sessions.

## Development

```bash
npm install
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm test             # Run tests
npm run test:watch   # Watch mode tests
```

### Project Structure

```
src/
├── index.ts              # Entry point (MCP server or hook mode)
├── server.ts             # MCP tool registration
├── config.ts             # Environment config loading
├── hook.ts               # Claude Code hook integration
├── transcript.ts         # JSONL transcript parser
├── agents/
│   ├── observer.ts       # Observer agent (extract observations)
│   ├── reflector.ts      # Reflector agent (compress observations)
│   ├── categorizer.ts    # Heuristic + LLM categorization
│   └── prompts.ts        # All agent prompt templates
├── storage/
│   ├── database.ts       # SQLite schema + initialization
│   ├── observations.ts   # Observation CRUD + FTS5 queries
│   ├── reflections.ts    # Reflection storage
│   ├── sessions.ts       # Session management
│   └── queries.ts        # Current task queries
├── tools/
│   ├── observe.ts        # MCP tool handler
│   ├── recall.ts         # MCP tool handler
│   ├── reflect.ts        # MCP tool handler
│   ├── get-session-info.ts
│   └── switch-context.ts
├── llm/
│   └── provider.ts       # Multi-provider LLM with fallback
├── git/
│   └── branch.ts         # Branch detection with 10s cache
└── utils/
    ├── tokens.ts         # Token estimation (chars/4)
    ├── sanitize.ts       # XML parsing, line truncation
    └── repetition.ts     # Degenerate output detection
```

## License

MIT
