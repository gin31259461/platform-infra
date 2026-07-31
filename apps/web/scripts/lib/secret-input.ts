export async function readSecretFromStandardInput(label: string): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(`${label} must be streamed over standard input`);
  }
  let secret = "";
  for await (const chunk of process.stdin) {
    secret += String(chunk);
    if (Buffer.byteLength(secret, "utf8") > 1_024) {
      throw new Error(`${label} input is too large`);
    }
  }
  return secret.trim();
}
