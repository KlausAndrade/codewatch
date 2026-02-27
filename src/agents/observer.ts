import { callLLM } from '../llm/provider.js';
import { detectDegenerateRepetition } from '../utils/repetition.js';
import { parseXmlBlock, sanitizeObservationLines } from '../utils/sanitize.js';
import { OBSERVER_SYSTEM_PROMPT, OBSERVER_USER_PROMPT } from './prompts.js';

export interface ObserverOutput {
  observations: string;
  currentTask: string | null;
  suggestedResponse: string | null;
}

export async function runObserver(
  messages: string,
  branch: string,
  projectDir: string,
): Promise<ObserverOutput> {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const userPrompt = OBSERVER_USER_PROMPT
    .replace('{messages}', messages)
    .replace('{current_datetime}', now)
    .replace('{project_dir}', projectDir)
    .replace('{branch}', branch);

  const rawOutput = await callLLM({
    systemPrompt: OBSERVER_SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.3,
    maxTokens: 4096,
  });

  if (detectDegenerateRepetition(rawOutput)) {
    console.error('Observer produced degenerate output, returning raw observations');
    return {
      observations: messages.substring(0, 2000),
      currentTask: null,
      suggestedResponse: null,
    };
  }

  const observations = parseXmlBlock(rawOutput, 'observations');
  const currentTask = parseXmlBlock(rawOutput, 'current-task');
  const suggestedResponse = parseXmlBlock(rawOutput, 'suggested-response');

  return {
    observations: observations ? sanitizeObservationLines(observations) : rawOutput,
    currentTask: currentTask && currentTask !== 'None' ? currentTask : null,
    suggestedResponse,
  };
}
