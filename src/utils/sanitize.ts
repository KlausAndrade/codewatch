const MAX_LINE_LENGTH = 10_000;
const MAX_OBSERVATION_LENGTH = 500;

export function sanitizeObservationLines(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + '...' : line))
    .join('\n');
}

export function truncateObservation(text: string): string {
  if (text.length <= MAX_OBSERVATION_LENGTH) {
    return text;
  }
  return text.substring(0, MAX_OBSERVATION_LENGTH - 3) + '...';
}

export function parseXmlBlock(text: string, tagName: string): string | null {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  const startIdx = text.indexOf(openTag);
  const endIdx = text.indexOf(closeTag);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return null;
  }

  return text.substring(startIdx + openTag.length, endIdx).trim();
}
