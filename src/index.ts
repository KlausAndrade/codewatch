#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { initializeDatabase } from './storage/database.js';
import { findOrCreateSession } from './storage/sessions.js';
import { getCurrentBranch } from './git/branch.js';
import { registerTools } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = initializeDatabase(config);
  const branch = await getCurrentBranch(config);
  const session = findOrCreateSession(db, branch, config.projectDir);

  const server = new McpServer({
    name: 'codewatch-memory',
    version: '0.1.0',
  });

  const ctx = { db, sessionId: session.id, branch, config };
  registerTools(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('codewatch-memory MCP server running on stdio');
}

main().catch((error) => {
  console.error('codewatch-memory failed to start:', error);
  process.exit(1);
});
