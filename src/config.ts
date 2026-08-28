import { config as loadDotenv } from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { lghsConfigSchema, secretsSchema, type LghsConfig, type Secrets } from "./types.js";

export interface LoadedConfig {
  configPath: string;
  config: LghsConfig;
  secrets: Secrets;
}

export async function loadConfig(cwd = process.cwd()): Promise<LoadedConfig> {
  loadDotenv({ path: path.join(cwd, ".env") });

  const configPath = path.resolve(process.env.LGHS_CONFIG ?? path.join(cwd, "lghs.yml"));
  const raw = await readFile(configPath, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      throw new Error(
        `lghs.yml não encontrado em ${configPath}. Copie lghs.example.yml e preencha os IDs.`,
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
