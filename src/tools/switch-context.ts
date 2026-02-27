import type { ServerContext } from '../server.js';
import { getCurrentBranch, invalidateBranchCache } from '../git/branch.js';
import { findOrCreateSession } from '../storage/sessions.js';
import { getCurrentTask, upsertCurrentTask } from '../storage/queries.js';
import { getObservationsByBranch, getCategoryBreakdown } from '../storage/observations.js';

interface SwitchContextParams {
  branch: string;
  carry_task?: boolean;
}

export async function handleSwitchContext(params: SwitchContextParams, ctx: ServerContext) {
  const previousBranch = ctx.branch;
  const previousTask = params.carry_task ? getCurrentTask(ctx.db, ctx.sessionId) : null;

  // Determine new branch
  let newBranch: string;
  if (params.branch === 'auto') {
    invalidateBranchCache();
    newBranch = await getCurrentBranch(ctx.config);
  } else {
    newBranch = params.branch;
  }

  // Find or create session for new branch
  const newSession = findOrCreateSession(ctx.db, newBranch, ctx.config.projectDir);

  // Update server context
  ctx.sessionId = newSession.id;
  ctx.branch = newBranch;

  // Carry task if requested
  if (previousTask && params.carry_task) {
    upsertCurrentTask(ctx.db, newSession.id, newBranch, previousTask.description);
  }

  // Get overview of new branch's observations
  const observations = getObservationsByBranch(ctx.db, newBranch, { limit: 5 });
  const categoryBreakdown = getCategoryBreakdown(ctx.db, newBranch);

  const response = {
    switched_from: previousBranch,
    switched_to: newBranch,
    session_id: newSession.id,
    observation_count: newSession.observation_count,
    observation_tokens: newSession.observation_tokens,
    categories: categoryBreakdown,
    recent_observations: observations.map((o) => ({
      category: o.category,
      priority: o.priority,
      content: o.content.substring(0, 100) + (o.content.length > 100 ? '...' : ''),
      observed_at: o.observed_at,
    })),
    task_carried: params.carry_task ? previousTask?.description || null : null,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
  };
}
