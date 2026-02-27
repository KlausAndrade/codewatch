export function detectDegenerateRepetition(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim().startsWith('-'));

  if (lines.length < 6) {
    return false;
  }

  // Strategy 1: Check for exact duplicate lines
  const uniqueLines = new Set(lines.map((l) => l.trim()));
  const dupeRatio = 1 - uniqueLines.size / lines.length;
  if (dupeRatio > 0.3) {
    return true;
  }

  // Strategy 2: Check for repeating patterns in consecutive lines
  for (let i = 0; i < lines.length - 2; i++) {
    const words1 = new Set(lines[i].toLowerCase().split(/\s+/));
    const words2 = new Set(lines[i + 1].toLowerCase().split(/\s+/));
    const words3 = new Set(lines[i + 2].toLowerCase().split(/\s+/));

    const overlap12 = intersection(words1, words2).size / Math.max(words1.size, 1);
    const overlap23 = intersection(words2, words3).size / Math.max(words2.size, 1);

    if (overlap12 > 0.8 && overlap23 > 0.8) {
      return true;
    }
  }

  // Strategy 3: Check for substring repetition
  const fullText = lines.join(' ');
  for (let windowSize = 50; windowSize <= 200; windowSize += 50) {
    if (fullText.length < windowSize * 3) {
      break;
    }
    const pattern = fullText.substring(0, windowSize);
    let count = 0;
    let pos = 0;
    while ((pos = fullText.indexOf(pattern, pos + 1)) !== -1) {
      count++;
    }
    if (count >= 3) {
      return true;
    }
  }

  return false;
}

function intersection<T>(setA: Set<T>, setB: Set<T>): Set<T> {
  return new Set([...setA].filter((x) => setB.has(x)));
}
