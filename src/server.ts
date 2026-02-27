import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { CodewatchConfig } from './config.js';
import { handleObserve } from './tools/observe.js';
import { handleRecall } from './tools/recall.js';
import { handleReflect } from './tools/reflect.js';
import { handleGetSessionInfo } from './tools/get-session-info.js';
import { handleSwitchContext } from './tools/switch-context.js';

export interface ServerContext {
  db: Database.Database;
  sessionId: string;
  branch: string;
  config: CodewatchConfig;
}

const CATEGORY_ENUM = z.enum([
  'architecture', 'bugfix', 'convention', 'dependency',
  'file_pattern', 'user_preference', 'task_context', 'learning',
]);

export function registerTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'observe',
    {
      title: 'Store Observation',
      description:
        'Record an observation about the current coding session. Call this to store ' +
        'architecture decisions, bug fixes, conventions discovered, file patterns, ' +
        'dependency choices, user preferences, task context, or learnings. Include relevant file paths and context.',
      inputSchema: {
        content: z.string().min(1).describe(
          'The observation text. Be specific: include file paths, function names, package versions, error messages, or decision rationale.',
        ),
        category: CATEGORY_ENUM.optional().describe(
          'Category for the observation. If omitted, auto-categorized from content.',
        ),
        priority: z.enum(['high', 'medium', 'low']).optional().describe(
          'Priority level. high = critical decisions, medium = useful context, low = minor details. Defaults to medium.',
        ),
        files: z.array(z.string()).optional().describe(
          'Array of file paths referenced in this observation.',
        ),
        source_summary: z.string().optional().describe(
          'Brief description of what triggered this observation.',
        ),
      },
    },
    async (params) => handleObserve(params, ctx),
  );

  server.registerTool(
    'recall',
    {
      title: 'Recall Observations',
      description:
        'Retrieve relevant observations for the current context. Use at the start of a session ' +
        'or when switching tasks to load relevant memory. Supports search by category, keyword, file path, or free text.',
      inputSchema: {
        query: z.string().optional().describe('Free-text search query.'),
        categories: z.array(CATEGORY_ENUM).optional().describe('Filter by categories.'),
        files: z.array(z.string()).optional().describe('Filter by referenced file paths.'),
        priority_min: z.enum(['high', 'medium', 'low']).optional().describe(
          'Minimum priority. "high" = only high, "medium" = high+medium, "low" = all. Default: "low".',
        ),
        limit: z.number().int().min(1).max(100).optional().describe('Max results. Default: 50.'),
        include_reflections: z.boolean().optional().describe('Include compressed reflections. Default: true.'),
        branch: z.string().optional().describe('Override branch scope.'),
      },
    },
    async (params) => handleRecall(params, ctx),
  );

  server.registerTool(
    'reflect',
    {
      title: 'Trigger Reflection',
      description:
        'Manually trigger the Reflector agent to compress and consolidate observations. ' +
        'Normally happens automatically when observations exceed the token threshold.',
      inputSchema: {
        compression_level: z.number().int().min(0).max(3).optional().describe(
          'Compression: 0 = reorganize, 1 = light (8/10), 2 = aggressive (6/10), 3 = critical (4/10). Default: 0.',
        ),
        branch: z.string().optional().describe('Branch to reflect. Default: current branch.'),
      },
    },
    async (params) => handleReflect(params, ctx),
  );

  server.registerTool(
    'get_session_info',
    {
      title: 'Session Info',
      description:
        'Get current session statistics: observation count, token usage, branch, compression history, current task.',
      inputSchema: {},
    },
    async () => handleGetSessionInfo(ctx),
  );

  server.registerTool(
    'switch_context',
    {
      title: 'Switch Branch Context',
      description:
        'Switch the observation scope to a different git branch. Observations are scoped per-branch.',
      inputSchema: {
        branch: z.string().min(1).describe('Branch name, or "auto" to re-detect from git.'),
        carry_task: z.boolean().optional().describe('Carry current task to new branch. Default: false.'),
      },
    },
    async (params) => handleSwitchContext(params, ctx),
  );
}
