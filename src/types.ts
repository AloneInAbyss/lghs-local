import { z } from "zod";

export const secretsSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN é obrigatório"),
  CLOUDFLARE_API_TOKEN: z.string().optional().default(""),
  RCON_PASSWORD: z.string().min(1, "RCON_PASSWORD é obrigatório"),
});

export const lghsConfigSchema = z.object({
  discord: z.object({
    guildId: z.string().min(1),
    channelId: z.string().min(1),
    adminRoleId: z.string().min(1),
  }),
  network: z.object({
    hostname: z.string().min(1),
    gamePort: z.number().int().positive().default(25565),
    cloudflare: z.object({
      zone: z.string().min(1),
      record: z.string().min(1),
    }),
  }),
  paths: z.object({
    instances: z.string().min(1),
    runtime: z.string().min(1),
  }),
  timezone: z.string().min(1).default("America/Sao_Paulo"),
});

export const manifestSchema = z.object({
  displayName: z.string().min(1),
  game: z.string().min(1).default("minecraft"),
  java: z.number().int().positive(),
  memory: z.string().min(1),
  startCommand: z.string().min(1),
  port: z.number().int().positive().optional(),
  readyTimeout: z.string().default("15m"),
  backup: z
    .object({
      interval: z.string().default("6h"),
      retain: z.number().int().positive().default(7),
    })
    .default({ interval: "6h", retain: 7 }),
});

export type Secrets = z.infer<typeof secretsSchema>;
export type LghsConfig = z.infer<typeof lghsConfigSchema>;
export type Manifest = z.infer<typeof manifestSchema>;

export interface Instance {
  id: string;
  dir: string;
  manifest: Manifest;
}

export type HostStatus = "idle" | "starting" | "running" | "stopping";

export interface RuntimeState {
  status: HostStatus;
  instanceId: string | null;
  requestedBy: string | null;
  startedAt: string | null;
}

export const idleState = (): RuntimeState => ({
  status: "idle",
  instanceId: null,
  requestedBy: null,
  startedAt: null,
});
