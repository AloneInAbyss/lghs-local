import { randomBytes } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { lghsConfigSchema, secretsSchema, type LghsConfig, type Secrets } from "./types.js";

export interface LoadedConfig {
  configPath: string;
  config: LghsConfig;
  secrets: Secrets;
}

export function configPathFor(cwd = process.cwd()): string {
  return path.resolve(process.env.LGHS_CONFIG ?? path.join(cwd, "lghs.yml"));
}

export async function configExists(cwd = process.cwd()): Promise<boolean> {
  try {
    await readFile(configPathFor(cwd), "utf8");
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export function generateSecret(bytes = 18): string {
  return randomBytes(bytes).toString("base64url");
}

export async function loadConfig(cwd = process.cwd()): Promise<LoadedConfig> {
  loadDotenv({ path: path.join(cwd, ".env"), override: true });

  const configPath = configPathFor(cwd);
  const raw = await readFile(configPath, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      throw new Error(
        `lghs.yml não encontrado em ${configPath}. Abra o console local para o assistente, ou copie lghs.example.yml.`,
      );
    }
    throw err;
  });

  const parsed = lghsConfigSchema.parse(parseYaml(raw));
  const configDir = path.dirname(configPath);

  const config: LghsConfig = {
    ...parsed,
    paths: {
      instances: path.resolve(configDir, parsed.paths.instances),
      runtime: path.resolve(configDir, parsed.paths.runtime),
    },
  };

  const secrets = secretsSchema.parse({
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ?? "",
    RCON_PASSWORD: process.env.RCON_PASSWORD,
  });

  return { configPath, config, secrets };
}

export interface SetupInput {
  discordToken: string;
  guildId: string;
  channelId: string;
  adminRoleId: string;
  hostname: string;
  gamePort: number;
  cloudflareZone: string;
  cloudflareRecord: string;
  cloudflareToken: string;
  rconPassword: string;
  instancesPath: string;
  runtimePath: string;
}

export async function writeSetup(input: SetupInput, cwd = process.cwd()): Promise<string> {
  const configPath = configPathFor(cwd);
  const doc = {
    discord: {
      guildId: input.guildId,
      channelId: input.channelId,
      adminRoleId: input.adminRoleId,
    },
    network: {
      hostname: input.hostname,
      gamePort: input.gamePort,
      cloudflare: {
        zone: input.cloudflareZone || "exemplo.com",
        record: input.cloudflareRecord || "mc",
      },
    },
    paths: {
      instances: input.instancesPath || "./data/instances",
      runtime: input.runtimePath || "./data/runtime",
    },
    timezone: "America/Sao_Paulo",
  };
  lghsConfigSchema.parse(doc);
  await writeFile(configPath, stringifyYaml(doc), "utf8");

  const rcon = input.rconPassword || generateSecret();
  await upsertEnv(path.join(cwd, ".env"), {
    DISCORD_TOKEN: input.discordToken,
    CLOUDFLARE_API_TOKEN: input.cloudflareToken,
    RCON_PASSWORD: rcon,
  });
  process.env.DISCORD_TOKEN = input.discordToken;
  process.env.CLOUDFLARE_API_TOKEN = input.cloudflareToken;
  process.env.RCON_PASSWORD = rcon;

  const runtime = path.resolve(path.dirname(configPath), doc.paths.runtime);
  const instances = path.resolve(path.dirname(configPath), doc.paths.instances);
  await mkdir(runtime, { recursive: true });
  await mkdir(instances, { recursive: true });
  return configPath;
}

async function upsertEnv(file: string, updates: Record<string, string>): Promise<void> {
  let current = "";
  try {
    current = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const map = new Map<string, string>();
  for (const line of current.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    map.set(line.slice(0, eq), line.slice(eq + 1));
  }
  for (const [k, v] of Object.entries(updates)) {
    map.set(k, v);
  }
  const body = [...map.entries()].map(([k, v]) => `${k}=${v}`).join("\n");
  await writeFile(file, `${body}\n`, "utf8");
}
