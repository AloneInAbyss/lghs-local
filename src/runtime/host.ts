import { EventEmitter } from "node:events";
import { parseDuration, sleep } from "../duration.js";
import { createBackup, maybeAnchors } from "../backup.js";
import {
  dockerSpec,
  gracefulStop,
  prepareMinecraft,
  sendCommand,
  waitUntilReady,
  announceAddress,
} from "../adapters/minecraft/index.js";
import { connectAddress, findInstance, scanInstances } from "../inventory.js";
import type { Instance, LghsConfig, RuntimeState, Secrets } from "../types.js";
import { idleState } from "../types.js";
import {
  createAndStart,
  createDocker,
  forceStop,
  inspectRunning,
  removeContainerIfExists,
  waitForDocker,
  waitForExit,
  waitUntilExit,
  containerName,
  followContainerLogs,
  recentContainerLogs,
} from "./docker.js";
import { log, logError, logWarn } from "../log.js";
import { loadState, saveState } from "./state.js";

export interface Actor {
  id: string | null;
  label: string;
}

export type HostEvents = {
  online: [{ instance: Instance; actor: Actor; address: string }];
  offline: [{ instance: Instance; actor: Actor | null }];
  startFailed: [{ instance: Instance; error: string }];
};

export class Host extends EventEmitter {
  private state: RuntimeState = idleState();
  private readyAbort: AbortController | null = null;
  private backupTimer: ReturnType<typeof setInterval> | null = null;
  private stopLogs: (() => void) | null = null;
  private watchGeneration = 0;
  private readonly docker = createDocker();

  constructor(
    private readonly config: LghsConfig,
    private readonly secrets: Secrets,
  ) {
    super();
  }

  get snapshot(): RuntimeState {
    return { ...this.state };
  }

  async init(): Promise<void> {
    await waitForDocker(this.docker);
    this.state = await loadState(this.config);
    await this.reconcile();
  }

  async list(): Promise<Instance[]> {
    return scanInstances(this.config);
  }

  async requestStart(
    instanceId: string,
    actor: Actor,
  ): Promise<{ ok: boolean; message: string }> {
    if (this.state.status === "starting") {
      return {
        ok: false,
        message: `Start já em andamento para **${this.state.instanceId}**.`,
      };
    }
    if (this.state.status === "running") {
      return {
        ok: false,
        message: `**${this.state.instanceId}** já está online.`,
      };
    }
    if (this.state.status === "stopping") {
      return { ok: false, message: "Ainda desligando a instância anterior." };
    }

    const instance = await findInstance(this.config, instanceId);
    if (!instance) {
      return { ok: false, message: `Instância \`${instanceId}\` não encontrada.` };
    }
    if (instance.manifest.game !== "minecraft") {
      return {
        ok: false,
        message: `Adapter \`${instance.manifest.game}\` ainda não existe. MVP é só Minecraft.`,
      };
    }

    this.state = {
      status: "starting",
      instanceId: instance.id,
      requestedBy: actor.id,
      startedAt: new Date().toISOString(),
    };
    await saveState(this.config, this.state);
    log("lghs", `start pedido: ${instance.id} por ${actor.label}`);
    void this.runStart(instance, actor);
    return {
      ok: true,
      message: `Subindo **${instance.manifest.displayName}**. Aviso neste canal quando estiver online.`,
    };
  }

  async requestStop(actor: Actor): Promise<{ ok: boolean; message: string }> {
    if (this.state.status === "idle" || !this.state.instanceId) {
      return { ok: false, message: "Nenhuma instância online." };
    }
    if (this.state.status === "stopping") {
      return { ok: false, message: "Parada já em andamento." };
    }

    const instance = await findInstance(this.config, this.state.instanceId);
    const name = instance?.manifest.displayName ?? this.state.instanceId;
    void this.runStop(actor);
    return { ok: true, message: `Desligando **${name}**…` };
  }

  async requestBackup(instanceId?: string): Promise<{ ok: boolean; message: string }> {
    if (this.state.status === "starting" || this.state.status === "stopping") {
      return { ok: false, message: "Espere o start/stop terminar para fazer backup." };
    }

    let id = instanceId ?? this.state.instanceId ?? undefined;
    if (!id) {
      const all = await scanInstances(this.config);
      if (all.length === 1) id = all[0]!.id;
      else {
        return {
          ok: false,
          message: "Diga a instância: `/backup instancia:…`",
        };
      }
    }
    const instance = await findInstance(this.config, id);
    if (!instance) {
      return { ok: false, message: `Instância \`${id}\` não encontrada.` };
    }

    try {
      const running = this.state.status === "running" && this.state.instanceId === instance.id;
      const result = await createBackup(this.config, instance, this.secrets, { running });
      await maybeAnchors(this.config, instance, this.secrets, running);
      return { ok: true, message: `Backup salvo: \`${result.file}\`` };
    } catch (err) {
      return { ok: false, message: `Backup falhou: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async requestCmd(command: string): Promise<{ ok: boolean; message: string }> {
    if (this.state.status !== "running") {
      return { ok: false, message: "Nenhuma instância online para receber comando." };
    }
    try {
      const out = await sendCommand(this.secrets, command);
      const trimmed = out.trim() || "(sem saída)";
      const clipped = trimmed.length > 1800 ? `${trimmed.slice(0, 1800)}…` : trimmed;
      return { ok: true, message: `\`\`\`\n${clipped}\n\`\`\`` };
    } catch (err) {
      return { ok: false, message: `RCON falhou: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async describeStatus(): Promise<string> {
    const s = this.state;
    if (s.status === "idle" || !s.instanceId) {
      return "Nenhuma instância online.";
    }
    const instance = await findInstance(this.config, s.instanceId);
    const name = instance?.manifest.displayName ?? s.instanceId;
    if (s.status === "starting") return `Subindo **${name}**…`;
    if (s.status === "stopping") return `Desligando **${name}**…`;
    const address = instance ? connectAddress(this.config, instance) : this.config.network.hostname;
    return `**${name}** online — \`${address}\``;
  }

  private async reconcile(): Promise<void> {
    const s = this.state;
    if (s.status === "idle" || !s.instanceId) return;

    const instance = await findInstance(this.config, s.instanceId);
    if (!instance) {
      logWarn("lghs", `estado aponta para ${s.instanceId}, pasta sumiu — idle`);
      this.state = idleState();
      await saveState(this.config, this.state);
      return;
    }

    const actor: Actor = { id: null, label: "sistema (revive)" };

    if (s.status === "stopping") {
      await this.finishStop(instance, actor);
      return;
    }

    const up = await inspectRunning(this.docker, containerName(instance.id));
    if (up && s.status === "running") {
      log("lghs", `${instance.id} ainda no Docker — reassumindo`);
      this.attachWatch(instance);
      this.startBackupTimer(instance);
      return;
    }

    log("lghs", `revive ${instance.id}`);
    this.state = {
      ...s,
      status: "starting",
      requestedBy: null,
    };
    await saveState(this.config, this.state);
    await this.runStart(instance, actor);
  }

  private async runStart(instance: Instance, actor: Actor): Promise<void> {
    this.readyAbort?.abort();
    this.readyAbort = new AbortController();
    const signal = this.readyAbort.signal;

    try {
      log("lghs", `preparando ${instance.id}`);
      await prepareMinecraft(instance, this.secrets);
      const spec = dockerSpec(this.config, instance);
      await createAndStart(this.docker, instance, spec);
      if (signal.aborted) {
        this.clearLogFollow();
        await removeContainerIfExists(this.docker, containerName(instance.id)).catch(() => undefined);
        return;
      }
      this.clearLogFollow();
      this.stopLogs = await followContainerLogs(this.docker, instance.id);
      this.attachWatch(instance);

      const timeoutMs = parseDuration(instance.manifest.readyTimeout);
      log("lghs", `aguardando Server List Ping (timeout ${instance.manifest.readyTimeout})`);

      let readySettled = false;
      const ready = waitUntilReady(this.config, instance, timeoutMs, signal).then(() => {
        readySettled = true;
      });
      ready.catch(() => undefined);
      const died = waitUntilExit(this.docker, instance.id).then(async () => {
        if (readySettled || signal.aborted) return;
        const tail = await recentContainerLogs(this.docker, instance.id);
        const extra = tail.trim() ? `\n--- logs ---\n${tail.trim()}` : "";
        throw new Error(`O container encerrou antes do servidor ficar pronto.${extra}`);
      });
      await Promise.race([ready, died]);

      this.state = {
        status: "running",
        instanceId: instance.id,
        requestedBy: actor.id,
        startedAt: new Date().toISOString(),
      };
      await saveState(this.config, this.state);
      this.startBackupTimer(instance);
      this.emit("online", {
        instance,
        actor,
        address: announceAddress(this.config, instance),
      });
    } catch (err) {
      const userCancel = signal.aborted;
      this.readyAbort?.abort();
      if (userCancel) {
        this.clearLogFollow();
        await removeContainerIfExists(this.docker, containerName(instance.id)).catch(() => undefined);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      logError("lghs", `falha no start de ${instance.id}: ${message}`);
      this.clearLogFollow();
      this.clearBackupTimer();
      this.watchGeneration += 1;
      await removeContainerIfExists(this.docker, containerName(instance.id)).catch(() => undefined);
      this.state = idleState();
      await saveState(this.config, this.state);
      this.emit("startFailed", { instance, error: message });
    }
  }

  private async runStop(actor: Actor): Promise<void> {
    const id = this.state.instanceId;
    if (!id) return;
    const instance = await findInstance(this.config, id);
    this.watchGeneration += 1;
    this.readyAbort?.abort();
    this.clearLogFollow();
    this.clearBackupTimer();
    this.state = { ...this.state, status: "stopping" };
    await saveState(this.config, this.state);

    try {
      try {
        await gracefulStop(this.secrets);
      } catch (err) {
        logWarn("lghs", `RCON stop falhou, encerrando container: ${err instanceof Error ? err.message : String(err)}`);
      }
      const exited = await waitForExit(this.docker, id, 90_000);
      if (!exited) {
        await forceStop(this.docker, id);
      }
    } finally {
      await removeContainerIfExists(this.docker, containerName(id)).catch(() => undefined);
      const gone = instance;
      this.state = idleState();
      await saveState(this.config, this.state);
      if (gone) this.emit("offline", { instance: gone, actor });
    }
  }

  private async finishStop(instance: Instance, actor: Actor): Promise<void> {
    await forceStop(this.docker, instance.id).catch(() => undefined);
    await removeContainerIfExists(this.docker, containerName(instance.id)).catch(() => undefined);
    this.state = idleState();
    await saveState(this.config, this.state);
    this.emit("offline", { instance, actor });
  }

  private attachWatch(instance: Instance): void {
    const generation = ++this.watchGeneration;
    void (async () => {
      try {
        await waitUntilExit(this.docker, instance.id);
      } catch {
        return;
      }
      if (generation !== this.watchGeneration) return;
      if (this.state.status !== "running" || this.state.instanceId !== instance.id) return;

      logWarn("lghs", `container de ${instance.id} caiu — revive`);
      this.state = { ...this.state, status: "starting" };
      await saveState(this.config, this.state);
      await sleep(5000);
      if (generation !== this.watchGeneration) return;
      await this.runStart(instance, { id: null, label: "sistema (revive)" });
    })();
  }

  private startBackupTimer(instance: Instance): void {
    this.clearBackupTimer();
    const ms = parseDuration(instance.manifest.backup.interval);
    this.backupTimer = setInterval(() => {
      void (async () => {
        if (this.state.status !== "running" || this.state.instanceId !== instance.id) return;
        try {
          await createBackup(this.config, instance, this.secrets, { running: true });
          await maybeAnchors(this.config, instance, this.secrets, true);
          log("backup", `snapshot de ${instance.id}`);
        } catch (err) {
          logWarn("backup", `falha agendada: ${err instanceof Error ? err.message : String(err)}`);
        }
      })();
    }, ms);
  }

  private clearBackupTimer(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = null;
    }
  }

  private clearLogFollow(): void {
    this.stopLogs?.();
    this.stopLogs = null;
  }
}
