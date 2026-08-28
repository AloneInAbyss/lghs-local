import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { idleState, type LghsConfig, type RuntimeState } from "../types.js";

export function statePath(config: LghsConfig): string {
  return path.join(config.paths.runtime, "state.json");
}

export async function loadState(config: LghsConfig): Promise<RuntimeState> {
  try {
    const raw = await readFile(statePath(config), "utf8");
    const parsed = JSON.parse(raw) as RuntimeState;
    if (!parsed.status) return idleState();
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return idleState();
    throw err;
  }
}

export async function saveState(config: LghsConfig, state: RuntimeState): Promise<void> {
  await mkdir(config.paths.runtime, { recursive: true });
  const file = statePath(config);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}
