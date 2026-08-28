import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { manifestSchema, type Instance, type LghsConfig } from "./types.js";

const FOLDER_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export async function scanInstances(config: LghsConfig): Promise<Instance[]> {
  let entries: string[];
  try {
    entries = await readdir(config.paths.instances);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }

  const instances: Instance[] = [];

  for (const id of entries) {
    if (!FOLDER_ID.test(id)) continue;
    const dir = path.join(config.paths.instances, id);
    const manifestPath = path.join(dir, "manifest.yml");
    try {
      const raw = await readFile(manifestPath, "utf8");
      const manifest = manifestSchema.parse(parseYaml(raw));
      instances.push({ id, dir, manifest });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      console.warn(`[scan] ignorando ${id}:`, err instanceof Error ? err.message : err);
    }
  }

  return instances.sort((a, b) => a.id.localeCompare(b.id));
}

export async function findInstance(config: LghsConfig, id: string): Promise<Instance | undefined> {
  const all = await scanInstances(config);
  return all.find((item) => item.id === id);
}

export function gamePort(config: LghsConfig, instance: Instance): number {
  return instance.manifest.port ?? config.network.gamePort;
}

export function connectAddress(config: LghsConfig, instance: Instance): string {
  return `${config.network.hostname}:${gamePort(config, instance)}`;
}
