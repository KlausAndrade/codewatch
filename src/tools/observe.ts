import type { ServerContext } from '../server.js';
import { categorize, getDefaultPriority } from '../agents/categorizer.js';
import { runReflectorWithEscalation } from '../agents/reflector.js';
import { insertObservation, getObservationsByBranch, getUnreflectedTokenCount, markObservationsReflected } from '../storage/observations.js';
import { insertReflection } from '../storage/reflections.js';
import { upsertCurrentTask } from '../storage/queries.js';
import { updateSessionStats, updateSessionAfterReflection, getSession } from '../storage/sessions.js';
import { estimateTokens } from '../utils/tokens.js';

interface ObserveParams {
  content: string;
  category?: string;
  priority?: string;
  files?: string[];
  source_summary?: string;
}

export async function handleObserve(params: ObserveParams, ctx: ServerContext) {
  // Auto-categorize if not provided
  let category = params.category;
  if (!category) {
    category = await categorize(params.content, true);
  }

  // Auto-prioritize if not provided
  let priority = params.priority;
  if (!priority) {
    priority = getDefaultPriority(category as any);

    // Boost priority for content with strong signals
    const lower = params.content.toLowerCase();
    if (lower.includes('critical') || lower.includes('important') || lower.includes('breaking')) {
      priority = 'high';
    }
  }

  // Store observation
  const observation = insertObservation(ctx.db, {
    sessionId: ctx.sessionId,
    branch: ctx.branch,
    category,
    priority,
    content: params.content,
    sourceSummary: params.source_summary,
    files: params.files,
  });

  // Update session stats
  updateSessionStats(ctx.db, ctx.sessionId, observation.token_count);

  // Update current task if this is task context
  if (category === 'task_context') {
    upsertCurrentTask(ctx.db, ctx.sessionId, ctx.branch, params.content);
  }

  // Check auto-reflect threshold
  let reflected = false;
  let compressionInfo: string | null = null;

  if (ctx.config.autoReflect) {
    const session = getSession(ctx.db, ctx.sessionId);
    if (session && session.observation_tokens >= ctx.config.reflectThreshold) {
      try {
        const unreflected = getObservationsByBranch(ctx.db, ctx.branch, { unreflectedOnly: true });
        const observationText = unreflected.map((o) => `[${o.priority}] ${o.content}`).join('\n');
        const inputTokens = estimateTokens(observationText);

        const result = await runReflectorWithEscalation(
          observationText,
          ctx.branch,
          Math.floor(ctx.config.reflectThreshold * 0.6),
          ctx.config.maxCompressionLevel,
        );

        // Store reflection
        const observationIds = unreflected.map((o) => o.id);
        insertReflection(ctx.db, {
          sessionId: ctx.sessionId,
          branch: ctx.branch,
          compressionLevel: result.compressionLevel,
          content: result.observations,
          observationIds,
          inputTokens,
          outputTokens: result.outputTokens,
        });

        // Mark observations as reflected
        markObservationsReflected(ctx.db, observationIds);

        // Update session token count
        updateSessionAfterReflection(ctx.db, ctx.sessionId, result.outputTokens);

        // Update current task if reflector found one
        if (result.currentTask) {
          upsertCurrentTask(ctx.db, ctx.sessionId, ctx.branch, result.currentTask);
        }

        reflected = true;
        compressionInfo = `Compressed ${inputTokens} → ${result.outputTokens} tokens (${(inputTokens / result.outputTokens).toFixed(1)}x) at level ${result.compressionLevel}`;
      } catch (error) {
        console.error('Auto-reflect failed:', error);
      }
    }
  }

  const session = getSession(ctx.db, ctx.sessionId);

  const response: Record<string, unknown> = {
    id: observation.id,
    category,
    priority,
    token_count: observation.token_count,
    session_observation_count: session?.observation_count ?? 0,
    session_observation_tokens: session?.observation_tokens ?? 0,
    tokens_until_reflect: Math.max(0, ctx.config.reflectThreshold - (session?.observation_tokens ?? 0)),
  };

  if (reflected && compressionInfo) {
    response.auto_reflected = true;
    response.compression = compressionInfo;
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
  };
}
