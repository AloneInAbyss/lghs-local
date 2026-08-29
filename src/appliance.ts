import type { Client } from "discord.js";
import { configExists, loadConfig, writeSetup, type LoadedConfig, type SetupInput } from "./config.js";
import { startBot } from "./discord/bot.js";
import { startDdnsLoop } from "./dns.js";
import { log, logError, logWarn } from "./log.js";
import { acquirePid } from "./pid.js";
import { Host } from "./runtime/host.js";
import { connectAddress } from "./inventory.js";

export const CONSOLE_ACTOR = { id: null, label: "console local" };

export class Appliance {
  loaded: LoadedConfig | null = null;
  host: Host | null = null;
  discord: Client | null = null;
  discordTag: string | null = null;
  discordOnline = false;
  hostError: string | null = null;
  private stopDdns: (() => void) | null = null;
  private pidTaken = false;

  get configured(): boolean {
    return this.loaded !== null;
  }

  async boot(): Promise<void> {
    if (!(await configExists())) {
      log("lghs", "nenhum lghs.yml — abra o console para o assistente de instalação");
      return;
    }
    await this.startEngine();
  }

  async applySetup(input: SetupInput): Promise<void> {
    const configPath = await writeSetup(input);
    log("lghs", `config gravada em ${configPath}`);
    await this.startEngine();
  }

  private async startEngine(): Promise<void> {
    this.loaded = await loadConfig();
    log("lghs", `config ${this.loaded.configPath}`);
    log("lghs", `instances ${this.loaded.config.paths.instances}`);

    if (!this.pidTaken) {
      await acquirePid(this.loaded.config.paths.runtime);
      this.pidTaken = true;
    }

    const host = new Host(this.loaded.config, this.loaded.secrets);
    this.host = host;
    this.hostError = null;
    try {
      await host.init();
    } catch (err) {
      this.hostError = err instanceof Error ? err.message : String(err);
      logError("lghs", `host init: ${this.hostError}`);
    }

    this.stopDdns?.();
    this.stopDdns = startDdnsLoop(this.loaded.config, this.loaded.secrets);

    if (this.discord) {
      this.discord.destroy();
      this.discord = null;
      this.discordOnline = false;
    }
    try {
      this.discord = await startBot(this.loaded.config, this.loaded.secrets, host);
      this.discordOnline = this.discord.isReady();
      this.discordTag = this.discord.user?.tag ?? null;
    } catch (err) {
      logError("discord", `login: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async status() {
    const instances = this.host ? await this.host.list() : [];
    const snap = this.host?.snapshot ?? null;
    let address: string | null = null;
    if (this.loaded && snap?.instanceId) {
      const inst = instances.find((i) => i.id === snap.instanceId);
      if (inst) address = connectAddress(this.loaded.config, inst);
    }
    return {
      configured: this.configured,
      hostError: this.hostError,
      discord: { online: this.discordOnline, tag: this.discordTag },
      host: snap,
      address,
      instances: instances.map((i) => ({
        id: i.id,
        displayName: i.manifest.displayName,
        game: i.manifest.game,
        java: i.manifest.java,
        memory: i.manifest.memory,
      })),
    };
  }

  shutdown(): void {
    this.stopDdns?.();
    this.discord?.destroy();
  }
}

export function warnUnbound(message: string): void {
  logWarn("lghs", message);
}
