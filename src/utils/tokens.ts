const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateObservationTokens(observations: Array<{ content: string }>): number {
  return observations.reduce((sum, obs) => sum + estimateTokens(obs.content), 0);
}
