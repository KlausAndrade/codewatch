# codewatch-memory

Code-aware observational memory MCP server for AI coding assistants.

Unlike generic memory solutions, codewatch-memory understands coding context — it categorizes observations into architecture decisions, bug fixes, conventions, dependencies, and more. Memory is scoped per git branch, so feature-branch context stays isolated.

## How it works

1. Your AI coding assistant calls `observe` to store facts, decisions, and context as you work
2. Observations are auto-categorized (architecture, bugfix, convention, dependency, file_pattern, user_preference, task_context, learning)
3. When observations exceed a token threshold, the **Reflector** agent compresses them using a cheap LLM (Gemini Flash)
4. Call `recall` at the start of a session to load relevant memory
5. Everything is stored in a local SQLite database, scoped per git branch

## Installation

### Claude Code

```bash
claude mcp add codewatch -- npx codewatch-memory
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
        "GOOGLE_GENERATIVE_AI_API_KEY": "your-key"
      }
    }
  }
}
```

### From source

```bash
git clone https://github.com/your-username/codewatch-memory.git
cd codewatch-memory
npm install
npm run build
claude mcp add codewatch -- node /path/to/dist/index.js
```

## API Keys

At minimum, one LLM API key is required for the Observer/Reflector compression agents:

```bash
# Recommended (cheapest)
export GOOGLE_GENERATIVE_AI_API_KEY=your-key

# Alternative
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

## Auto-Reflection

When accumulated observation tokens exceed the threshold (default: 40,000), the Reflector agent automatically compresses observations using 4 escalating levels:

- **Level 0**: Reorganize only — merge duplicates, add structure
- **Level 1**: Light compression (8/10 detail) — ~20% reduction
- **Level 2**: Aggressive compression (6/10 detail) — ~40% reduction
- **Level 3**: Critical compression (4/10 detail) — ~60% reduction

Architecture decisions and user preferences are never dropped, regardless of compression level.

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `CODEWATCH_LLM_PROVIDER` | `google` | Primary LLM provider |
| `CODEWATCH_FALLBACK_PROVIDER` | `openai` | Fallback LLM provider |
| `CODEWATCH_GOOGLE_MODEL` | `gemini-2.5-flash` | Google model |
| `CODEWATCH_OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model |
| `CODEWATCH_REFLECT_THRESHOLD` | `40000` | Auto-reflect trigger (tokens) |
| `CODEWATCH_DATA_DIR` | `~/mcp-data/codewatch-memory/` | SQLite storage location |
| `CODEWATCH_AUTO_REFLECT` | `true` | Enable auto-reflection |
| `CODEWATCH_LOG_LEVEL` | `info` | Logging verbosity |

## Storage

Data is stored in `~/mcp-data/codewatch-memory/codewatch.db` (SQLite with WAL mode). The database includes:

- **Sessions**: Scoped to git branch + project directory
- **Observations**: Full-text searchable via FTS5
- **Reflections**: Compressed observation summaries with compression ratios
- **Current Tasks**: Persisted "what am I working on" state

## Development

```bash
npm install
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm test             # Run tests
npm run test:watch   # Watch mode tests
```

## License

MIT
