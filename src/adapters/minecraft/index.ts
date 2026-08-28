import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseMemoryBytes } from "../../duration.js";
import { connectAddress, gamePort } from "../../inventory.js";
import {
  GAME_CONTAINER_PORT,
  RCON_PORT,
  toDockerBindPath,
  type RunSpec,
} from "../../runtime/docker.js";
import type { Instance, LghsConfig, Secrets } from "../../types.js";
import { rconFlushWorld, rconResumeWorld, rconSend, rconStop } from "./rcon.js";
import { waitForPing } from "./slp.js";

const JAVA_IMAGES: Record<number, string> = {
  8: "eclipse-temurin:8-jre",
  17: "eclipse-temurin:17-jre",
  21: "eclipse-temurin:21-jre",
};

export function javaImage(version: number): string {
  const image = JAVA_IMAGES[version];
  if (!image) {
    throw new Error(`Java ${version} não mapeado. Use 8, 17 ou 21 no manifest.`);
  }
  return image;
}

function upsertProperties(raw: string, patch: Record<string, string>): string {
  const keys = new Set(Object.keys(patch));
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      out.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    const key = eq === -1 ? trimmed : trimmed.slice(0, eq);
    if (key in patch) {
      out.push(`${key}=${patch[key]}`);
      keys.delete(key);
    } else {
      out.push(line);
    }
  }
  for (const key of keys) {
    out.push(`${key}=${patch[key]}`);
  }
  return `${out.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n")}\n`;
}

async function upsertJvmArgs(file: string, memory: string): Promise<void> {
  let current = "";
  try {
    current = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const kept = current
    .split(/\r?\n/)
    .filter((line) => !/^\s*-Xm[sx]/.test(line));
  const next = [...kept.filter((l) => l.length > 0), `-Xms${memory}`, `-Xmx${memory}`].join("\n");
  await writeFile(file, `${next}\n`, "utf8");
}

export async function prepareMinecraft(
  instance: Instance,
  secrets: Secrets,
): Promise<void> {
  const serverDir = path.join(instance.dir, "server");
  const worldDir = path.join(instance.dir, "world");
  const backupsDir = path.join(instance.dir, "backups");
  await mkdir(serverDir, { recursive: true });
  await mkdir(worldDir, { recursive: true });
  await mkdir(backupsDir, { recursive: true });

  await writeFile(path.join(serverDir, "eula.txt"), "eula=true\n", "utf8");

  const propsPath = path.join(serverDir, "server.properties");
  let current = "";
  try {
    current = await readFile(propsPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const next = upsertProperties(current, {
    "enable-rcon": "true",
    "rcon.port": String(RCON_PORT),
    "rcon.password": secrets.RCON_PASSWORD,
    "broadcast-rcon-to-ops": "false",
    "server-port": String(GAME_CONTAINER_PORT),
  });
  await writeFile(propsPath, next, "utf8");

  await upsertJvmArgs(path.join(serverDir, "user_jvm_args.txt"), instance.manifest.memory);
}

export function dockerSpec(config: LghsConfig, instance: Instance): RunSpec {
  const serverDir = path.join(instance.dir, "server");
  const worldDir = path.join(instance.dir, "world");
  const memory = instance.manifest.memory;
  return {
    image: javaImage(instance.manifest.java),
    workingDir: "/data/server",
    cmd: ["bash", "-lc", instance.manifest.startCommand],
    env: [
      `TZ=${config.timezone}`,
    ],
    binds: [
      `${toDockerBindPath(serverDir)}:/data/server`,
      `${toDockerBindPath(worldDir)}:/data/server/world`,
    ],
    memoryBytes: Math.round(parseMemoryBytes(memory) * 1.25),
    gamePort: gamePort(config, instance),
  };
}

export async function waitUntilReady(
  config: LghsConfig,
  instance: Instance,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  await waitForPing("127.0.0.1", gamePort(config, instance), timeoutMs, signal);
}

export async function gracefulStop(secrets: Secrets): Promise<void> {
  await rconStop(secrets.RCON_PASSWORD);
}

export async function sendCommand(secrets: Secrets, command: string): Promise<string> {
  return rconSend(secrets.RCON_PASSWORD, command);
}

export async function flushWorld(secrets: Secrets): Promise<void> {
  await rconFlushWorld(secrets.RCON_PASSWORD);
}

export async function resumeWorld(secrets: Secrets): Promise<void> {
  await rconResumeWorld(secrets.RCON_PASSWORD);
}

export function announceAddress(config: LghsConfig, instance: Instance): string {
  return connectAddress(config, instance);
}
