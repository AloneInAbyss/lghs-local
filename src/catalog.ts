import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { log, logWarn } from "./log.js";
import { manifestSchema } from "./types.js";

export interface CatalogGame {
  id: string;
  displayName: string;
  game: string;
  summary: string;
  installed: boolean;
}

interface CatalogIndex {
  games: Omit<CatalogGame, "installed">[];
}

function localRoot(cwd = process.cwd()): string {
  return path.join(cwd, "catalog");
}

function remoteBase(): string | undefined {
  const url = process.env.CATALOG_URL?.trim();
  return url ? url.replace(/\/$/, "") : undefined;
}

async function readIndexLocal(cwd: string): Promise<CatalogIndex> {
  const raw = await readFile(path.join(localRoot(cwd), "index.yml"), "utf8");
  return parseYaml(raw) as CatalogIndex;
}

async function readIndexRemote(base: string): Promise<CatalogIndex> {
  const res = await fetch(`${base}/index.yml`);
  if (!res.ok) throw new Error(`Catálogo remoto HTTP ${res.status}`);
  return parseYaml(await res.text()) as CatalogIndex;
}

export async function loadCatalog(cwd = process.cwd(), instanceDir?: string): Promise<CatalogGame[]> {
  let index: CatalogIndex;
  const remote = remoteBase();
  try {
    index = remote ? await readIndexRemote(remote) : await readIndexLocal(cwd);
  } catch (err) {
    if (remote) {
      logWarn("lghs", `catálogo remoto falhou, usando o local: ${err instanceof Error ? err.message : err}`);
      index = await readIndexLocal(cwd);
    } else {
      throw err;
    }
  }

  const games = index.games ?? [];
  const installed = new Set<string>();
  if (instanceDir) {
    try {
      const { readdir } = await import("node:fs/promises");
      for (const name of await readdir(instanceDir)) installed.add(name);
    } catch {
      // empty
    }
  }
  return games.map((g) => ({ ...g, installed: installed.has(g.id) }));
}

export async function catalogGuide(id: string, cwd = process.cwd()): Promise<{ manifest: string; install: string }> {
  const remote = remoteBase();
  if (remote) {
    try {
      const [manifest, install] = await Promise.all([
        fetch(`${remote}/games/${id}/manifest.yml`).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        }),
        fetch(`${remote}/games/${id}/INSTALL.md`).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        }),
      ]);
      return { manifest, install };
    } catch (err) {
      logWarn("lghs", `guia remoto de ${id} falhou: ${err instanceof Error ? err.message : err}`);
    }
  }
  const dir = path.join(localRoot(cwd), "games", id);
  const [manifest, install] = await Promise.all([
    readFile(path.join(dir, "manifest.yml"), "utf8"),
    readFile(path.join(dir, "INSTALL.md"), "utf8"),
  ]);
  return { manifest, install };
}

export async function installCatalogGame(
  id: string,
  instancesDir: string,
  cwd = process.cwd(),
): Promise<{ dir: string }> {
  const { manifest, install } = await catalogGuide(id, cwd);
  manifestSchema.parse(parseYaml(manifest));
  const dir = path.join(instancesDir, id);
  await mkdir(path.join(dir, "server"), { recursive: true });
  await mkdir(path.join(dir, "world"), { recursive: true });
  await mkdir(path.join(dir, "backups"), { recursive: true });
  await writeFile(path.join(dir, "manifest.yml"), manifest, "utf8");
  await writeFile(path.join(dir, "INSTALL.md"), install, "utf8");
  log("lghs", `catálogo: instância ${id} criada em ${dir} (pack ainda precisa ser copiado para server/)`);
  return { dir };
}
