import type { ServerContext } from '../server.js';
import {
  getObservationsByBranch,
  searchObservations,
  searchObservationsByFiles,
  type Observation,
} from '../storage/observations.js';
import { getReflectionsByBranch } from '../storage/reflections.js';
import { getCurrentTask } from '../storage/queries.js';

interface RecallParams {
  query?: string;
  categories?: string[];
  files?: string[];
  priority_min?: string;
  limit?: number;
  include_reflections?: boolean;
  branch?: string;
}

function formatObservation(obs: Observation): string {
  const emoji = obs.priority === 'high' ? '🔴' : obs.priority === 'medium' ? '🟡' : '🟢';
  const time = obs.observed_at.substring(11, 16) || '??:??';
  const files = obs.referenced_files ? ` [${JSON.parse(obs.referenced_files).join(', ')}]` : '';
  return `- ${emoji} ${time} [${obs.category}] ${obs.content}${files}`;
}

function groupByDate(observations: Observation[]): Map<string, Observation[]> {
  const groups = new Map<string, Observation[]>();
  for (const obs of observations) {
    const date = obs.observed_at.substring(0, 10);
    if (!groups.has(date)) {
      groups.set(date, []);
    }
    groups.get(date)!.push(obs);
  }
  return groups;
}

export async function handleRecall(params: RecallParams, ctx: ServerContext) {
  const branch = params.branch || ctx.branch;
  const limit = params.limit || 50;
  const includeReflections = params.include_reflections !== false;

  let observations: Observation[] = [];

  // Search by query (FTS5)
  if (params.query) {
    observations = searchObservations(ctx.db, branch, params.query, limit);
  }
  // Search by files
  else if (params.files && params.files.length > 0) {
    observations = searchObservationsByFiles(ctx.db, branch, params.files, limit);
  }
  // Filter by categories and/or priority
  else {
    observations = getObservationsByBranch(ctx.db, branch, {
      categories: params.categories,
      priorityMin: params.priority_min,
      limit,
    });
  }

  // Format observations grouped by date
  const grouped = groupByDate(observations);
  let output = '<observations>\n';

  for (const [date, obs] of grouped) {
    output += `## Date: ${date}\n`;
    for (const o of obs) {
      output += formatObservation(o) + '\n';
    }
    output += '\n';
  }

  output += '</observations>\n';

  // Include reflections if requested
  if (includeReflections) {
    const reflections = getReflectionsByBranch(ctx.db, branch);
    if (reflections.length > 0) {
      output += '\n<reflections>\n';
      for (const r of reflections) {
        output += `## Reflection (level ${r.compression_level}, ${r.compression_ratio.toFixed(1)}x compression)\n`;
        output += r.content + '\n\n';
      }
      output += '</reflections>\n';
    }
  }

  // Current task
  const task = getCurrentTask(ctx.db, ctx.sessionId);
  if (task) {
    output += `\n<current-task>\n${task.description}\n</current-task>\n`;
  }

  // Stats
  output += `\n--- ${observations.length} observations recalled from branch "${branch}" ---`;

  return {
    content: [{ type: 'text' as const, text: output }],
  };
}
