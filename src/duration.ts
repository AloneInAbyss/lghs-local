export function parseDuration(input: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/i.exec(input.trim());
  if (!match) {
    throw new Error(`Duração inválida: "${input}" (use 30s, 15m, 6h)`);
  }
  const value = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  switch (unit) {
    case "ms":
      return value;
    case "s":
      return value * 1000;
    case "m":
      return value * 60_000;
    case "h":
      return value * 3_600_000;
    default:
      throw new Error(`Unidade inválida: ${unit}`);
  }
}

export function parseMemoryBytes(input: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(k|m|g|kb|mb|gb)?$/i.exec(input.trim());
  if (!match) {
    throw new Error(`Memória inválida: "${input}" (use 8G, 512M)`);
  }
  const value = Number(match[1]);
  const unit = (match[2] ?? "b").toLowerCase().replace(/b$/, "");
  const factor =
    unit === "k" ? 1024 : unit === "m" ? 1024 ** 2 : unit === "g" ? 1024 ** 3 : 1;
  return Math.round(value * factor);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
