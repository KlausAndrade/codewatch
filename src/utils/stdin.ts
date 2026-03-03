/**
 * Read all data from stdin with a timeout safety net.
 * Claude Code pipes hook input synchronously, so this completes near-instantly.
 */
export function readStdin(timeoutMs: number = 5000): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));

    // Safety timeout — stdin should arrive immediately from Claude Code
    setTimeout(() => resolve(data), timeoutMs);
  });
}
