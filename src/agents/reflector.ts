import { callLLM } from '../llm/provider.js';
import { detectDegenerateRepetition } from '../utils/repetition.js';
import { parseXmlBlock, sanitizeObservationLines } from '../utils/sanitize.js';
import { estimateTokens } from '../utils/tokens.js';
import { COMPRESSION_GUIDANCE, REFLECTOR_SYSTEM_PROMPT, REFLECTOR_USER_PROMPT } from './prompts.js';

export interface ReflectorOutput {
  observations: string;
  currentTask: string | null;
  suggestedResponse: string | null;
  outputTokens: number;
}

export async function runReflector(
  observations: string,
  branch: string,
  compressionLevel: number,
  targetTokens: number,
): Promise<ReflectorOutput> {
  const currentTokens = estimateTokens(observations);
  const guidance = COMPRESSION_GUIDANCE[compressionLevel as keyof typeof COMPRESSION_GUIDANCE] || COMPRESSION_GUIDANCE[0];

  const systemPrompt = REFLECTOR_SYSTEM_PROMPT.replace('{compression_guidance}', guidance);
  const userPrompt = REFLECTOR_USER_PROMPT
    .replace('{observations}', observations)
    .replace('{compression_level}', String(compressionLevel))
    .replace('{branch}', branch)
    .replace('{current_tokens}', String(currentTokens))
    .replace('{target_tokens}', String(targetTokens));

  const rawOutput = await callLLM({
    systemPrompt,
    userPrompt,
    temperature: 0,
    maxTokens: Math.max(targetTokens * 2, 4096),
  });

  if (detectDegenerateRepetition(rawOutput)) {
    throw new Error(`Reflector produced degenerate output at compression level ${compressionLevel}`);
  }

  const parsedObservations = parseXmlBlock(rawOutput, 'observations');
  const currentTask = parseXmlBlock(rawOutput, 'current-task');
  const suggestedResponse = parseXmlBlock(rawOutput, 'suggested-response');

  const resultText = parsedObservations ? sanitizeObservationLines(parsedObservations) : rawOutput;
  const outputTokens = estimateTokens(resultText);

  return {
    observations: resultText,
    currentTask: currentTask && currentTask !== 'None' ? currentTask : null,
    suggestedResponse,
    outputTokens,
  };
}

export async function runReflectorWithEscalation(
  observations: string,
  branch: string,
  targetTokens: number,
  maxLevel: number = 3,
): Promise<ReflectorOutput & { compressionLevel: number }> {
  for (let level = 0; level <= maxLevel; level++) {
    try {
      const result = await runReflector(observations, branch, level, targetTokens);
      if (result.outputTokens < targetTokens) {
        return { ...result, compressionLevel: level };
      }
      // Use the result as input for next compression level
      observations = result.observations;
    } catch (error) {
      console.error(`Reflector failed at level ${level}:`, error);
      if (level === maxLevel) {
        throw error;
      }
    }
  }

  // If we exhaust all levels, return the last attempt
  const lastAttempt = await runReflector(observations, branch, maxLevel, targetTokens);
  return { ...lastAttempt, compressionLevel: maxLevel };
}
