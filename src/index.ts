#!/usr/bin/env node

const isHookMode = process.argv.includes('--hook');

if (isHookMode) {
  const { runHook } = await import('./hook.js');
  await runHook();
} else {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { loadConfig } = await import('./config.js');
  const { initializeDatabase } = await import('./storage/database.js');
  const { findOrCreateSession } = await import('./storage/sessions.js');
  const { getCurrentBranch } = await import('./git/branch.js');
  const { registerTools } = await import('./server.js');

  const config = loadConfig();
  const db = initializeDatabase(config);
  const branch = await getCurrentBranch(config);
  const session = findOrCreateSession(db, branch, config.projectDir);

  const server = new McpServer({
    name: 'codewatch-memory',
    version: '0.2.0',
  });

  const ctx = { db, sessionId: session.id, branch, config };
  registerTools(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('codewatch-memory MCP server running on stdio');
}
