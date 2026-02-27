import type { ServerContext } from '../server.js';
import { runReflectorWithEscalation } from '../agents/reflector.js';
import { getObservationsByBranch, markObservationsReflected } from '../storage/observations.js';
import { insertReflection } from '../storage/reflections.js';
import { upsertCurrentTask } from '../storage/queries.js';
import { updateSessionAfterReflection } from '../storage/sessions.js';
import { estimateTokens } from '../utils/tokens.js';

interface ReflectParams {
  compression_level?: number;
  branch?: string;
}

export async function handleReflect(params: ReflectParams, ctx: ServerContext) {
  const branch = params.branch || ctx.branch;
  const unreflected = getObservationsByBranch(ctx.db, branch, { unreflectedOnly: true });

  if (unreflected.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No unreflected observations to compress.' }],
    };
  }

  const observationText = unreflected.map((o) => `[${o.priority}] [${o.category}] ${o.content}`).join('\n');
  const inputTokens = estimateTokens(observationText);
  const targetTokens = Math.floor(ctx.config.reflectThreshold * 0.6);

  const result = await runReflectorWithEscalation(
    observationText,
    branch,
    targetTokens,
    params.compression_level ?? ctx.config.maxCompressionLevel,
  );

  const observationIds = unreflected.map((o) => o.id);

  insertReflection(ctx.db, {
    sessionId: ctx.sessionId,
    branch,
    compressionLevel: result.compressionLevel,
    content: result.observations,
    observationIds,
    inputTokens,
    outputTokens: result.outputTokens,
  });

  markObservationsReflected(ctx.db, observationIds);
  updateSessionAfterReflection(ctx.db, ctx.sessionId, result.outputTokens);

  if (result.currentTask) {
    upsertCurrentTask(ctx.db, ctx.sessionId, branch, result.currentTask);
  }

  const compressionRatio = inputTokens / Math.max(result.outputTokens, 1);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        observations_compressed: unreflected.length,
        input_tokens: inputTokens,
        output_tokens: result.outputTokens,
        compression_ratio: `${compressionRatio.toFixed(1)}x`,
        compression_level: result.compressionLevel,
        tokens_saved: inputTokens - result.outputTokens,
      }, null, 2),
    }],
  };
}
