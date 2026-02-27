import type { ServerContext } from '../server.js';
import { getSession } from '../storage/sessions.js';
import { getCategoryBreakdown } from '../storage/observations.js';
import { getLatestReflection } from '../storage/reflections.js';
import { getCurrentTask } from '../storage/queries.js';

export async function handleGetSessionInfo(ctx: ServerContext) {
  const session = getSession(ctx.db, ctx.sessionId);
  if (!session) {
    return {
      content: [{ type: 'text' as const, text: 'No active session found.' }],
    };
  }

  const categoryBreakdown = getCategoryBreakdown(ctx.db, ctx.branch);
  const latestReflection = getLatestReflection(ctx.db, ctx.branch);
  const currentTask = getCurrentTask(ctx.db, ctx.sessionId);

  const info = {
    session_id: session.id,
    branch: session.branch,
    project_dir: session.project_dir,
    started_at: session.started_at,
    last_active_at: session.last_active_at,
    observation_count: session.observation_count,
    observation_tokens: session.observation_tokens,
    reflection_count: session.reflection_count,
    reflect_threshold: ctx.config.reflectThreshold,
    tokens_until_reflect: Math.max(0, ctx.config.reflectThreshold - session.observation_tokens),
    auto_reflect: ctx.config.autoReflect,
    categories: categoryBreakdown,
    current_task: currentTask?.description || null,
    last_reflection: latestReflection ? {
      compression_level: latestReflection.compression_level,
      compression_ratio: `${latestReflection.compression_ratio.toFixed(1)}x`,
      reflected_at: latestReflection.reflected_at,
    } : null,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }],
  };
}
