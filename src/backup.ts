import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { create as createTar } from "tar";
import { flushWorld, resumeWorld } from "./adapters/minecraft/index.js";
import type { Instance, LghsConfig, Secrets } from "./types.js";

const EXTRA_FILES = [
  "server/whitelist.json",
  "server/ops.json",
  "server/server.properties",
  "server/banned-ips.json",
  "server/banned-players.json",
];

function partsInZone(timeZone: string, date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return bag;
}

function isoWeek(timeZone: string, date = new Date()): string {
  const bag = partsInZone(timeZone, date);
  const local = new Date(`${bag.year}-${bag.month}-${bag.day}T00:00:00Z`);
  const utc = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export interface BackupResult {
  file: string;
  kind: "rolling" | "daily" | "weekly";
}

export async function createBackup(
  config: LghsConfig,
  instance: Instance,
  secrets: Secrets,
  opts: { running: boolean; kind?: BackupResult["kind"] } ,
): Promise<BackupResult> {
  const backupsDir = path.join(instance.dir, "backups");
  await mkdir(backupsDir, { recursive: true });

  if (opts.running) {
    await flushWorld(secrets);
  }

  try {
    const bag = partsInZone(config.timezone);
    const kind = opts.kind ?? "rolling";
    const stamp =
      kind === "daily"
        ? `${bag.year}-${bag.month}-${bag.day}`
        : kind === "weekly"
          ? isoWeek(config.timezone)
          : `${bag.year}-${bag.month}-${bag.day}T${bag.hour}-${bag.minute}-${bag.second}`;
    const fileName = `${instance.id}-${kind === "rolling" ? "" : `${kind}-`}${stamp}.tar.gz`.replace(
      "--",
      "-",
    );
    const dest = path.join(backupsDir, fileName);

    const entries: string[] = [];
    if (await exists(path.join(instance.dir, "world"))) entries.push("world");
    for (const rel of EXTRA_FILES) {
      if (await exists(path.join(instance.dir, rel))) entries.push(rel);
    }
    if (entries.length === 0) {
      throw new Error("Nada para incluir no backup (world/ vazio e sem arquivos extras).");
    }

    await createTar({ gzip: true, file: dest, cwd: instance.dir }, entries);
    await pruneRolling(instance);
    return { file: dest, kind };
  } finally {
    if (opts.running) {
      await resumeWorld(secrets);
    }
  }
}

async function pruneRolling(instance: Instance): Promise<void> {
  const backupsDir = path.join(instance.dir, "backups");
  const retain = instance.manifest.backup.retain;
  const names = await readdir(backupsDir);
  const rolling = names
    .filter((n) => n.startsWith(`${instance.id}-`) && !n.includes("-daily-") && !n.includes("-weekly-"))
    .sort();
  const extra = rolling.length - retain;
  if (extra <= 0) return;
  for (const name of rolling.slice(0, extra)) {
    await unlink(path.join(backupsDir, name));
  }
}

export async function maybeAnchors(
  config: LghsConfig,
  instance: Instance,
  secrets: Secrets,
  running: boolean,
): Promise<void> {
  const backupsDir = path.join(instance.dir, "backups");
  await mkdir(backupsDir, { recursive: true });
  const names = await readdir(backupsDir);
  const bag = partsInZone(config.timezone);
  const dailyName = `${instance.id}-daily-${bag.year}-${bag.month}-${bag.day}.tar.gz`;
  const weeklyName = `${instance.id}-weekly-${isoWeek(config.timezone)}.tar.gz`;
  if (!names.includes(dailyName)) {
    await createBackup(config, instance, secrets, { running, kind: "daily" });
  }
  if (!names.includes(weeklyName)) {
    await createBackup(config, instance, secrets, { running, kind: "weekly" });
  }
}
