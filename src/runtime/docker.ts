import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable, type Readable } from "node:stream";
import Docker from "dockerode";
import { sleep } from "../duration.js";
import { log } from "../log.js";
import type { Instance } from "../types.js";

export const RCON_PORT = 25575;
export const GAME_CONTAINER_PORT = 25565;

function isWsl(): boolean {
  return Boolean(process.env.WSL_DISTRO_NAME) || os.release().toLowerCase().includes("microsoft");
}

function unixSocketCandidates(): string[] {
  const fromEnv = process.env.DOCKER_HOST?.replace(/^unix:\/\//, "");
  return [...new Set([fromEnv, "/var/run/docker.sock", "/run/docker.sock"].filter((p): p is string => Boolean(p)))];
}

function missingDockerMessage(tried: string[]): string {
  const distro = process.env.WSL_DISTRO_NAME ?? "Ubuntu";
  if (isWsl()) {
    return [
      `Docker não está acessível no WSL (${distro}): nenhum socket (${tried.join(", ")}).`,
      "O cliente `docker` no WSL não basta — o engine do Docker Desktop precisa estar ligado a esta distro.",
      "",
      "1. Abra o Docker Desktop no Windows e espere ficar verde (Engine running).",
      "2. Settings → Resources → WSL Integration.",
      `3. Ative a integração para “${distro}” (Enable integration with additional distros).`,
      "4. Apply & Restart.",
      "5. Neste terminal: `docker version` — tem que aparecer Client e Server.",
      "",
      "Alternativa: `npm run dev` no PowerShell do Windows, com o Desktop aberto.",
    ].join("\n");
  }
  if (process.platform === "win32") {
    return "Docker não respondeu. Abra o Docker Desktop e espere Engine running (named pipe docker_engine).";
  }
  return `Docker não está acessível (sockets ${tried.join(", ")}). Suba o daemon ou defina DOCKER_HOST.`;
}

export function createDocker(): Docker {
  const hostEnv = process.env.DOCKER_HOST;
  if (hostEnv?.startsWith("tcp://")) {
    const u = new URL(hostEnv);
    return new Docker({ host: u.hostname, port: Number(u.port || 2375) });
  }
  if (process.platform === "win32") {
    return new Docker({ socketPath: "//./pipe/docker_engine" });
  }
  const tried = unixSocketCandidates();
  const socketPath = tried.find((p) => existsSync(p));
  if (!socketPath) {
    throw new Error(missingDockerMessage(tried));
  }
  return new Docker({ socketPath });
}

export async function waitForDocker(docker: Docker, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await docker.ping();
      return;
    } catch (err) {
      lastError = err;
      await sleep(2000);
    }
  }
  const hint = isWsl()
    ? "No WSL, `docker version` precisa mostrar Server. Veja Settings → WSL Integration no Docker Desktop."
    : "No Windows, confirme o Docker Desktop (Engine running) e o auto-logon.";
  throw new Error(`Docker não respondeu a tempo. ${hint} ${String(lastError)}`);
}

export function containerName(instanceId: string): string {
  return `lghs-${instanceId}`;
}

export function toDockerBindPath(hostPath: string): string {
  const abs = path.resolve(hostPath);
  return process.platform === "win32" ? abs.replace(/\\/g, "/") : abs;
}

export async function pullImage(docker: Docker, image: string): Promise<void> {
  log("docker", `puxando imagem ${image}…`);
  const stream = await docker.pull(image);
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()));
  });
  log("docker", `imagem ${image} ok`);
}

export async function removeContainerIfExists(docker: Docker, name: string): Promise<void> {
  const container = docker.getContainer(name);
  try {
    await container.inspect();
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404) return;
    throw err;
  }
  try {
    await container.stop({ t: 5 });
  } catch {
    // already stopped
  }
  await container.remove({ force: true });
}

export async function inspectRunning(docker: Docker, name: string): Promise<boolean> {
  try {
    const info = await docker.getContainer(name).inspect();
    return Boolean(info.State.Running);
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404) return false;
    throw err;
  }
}

export interface RunSpec {
  image: string;
  workingDir: string;
  cmd: string[];
  env: string[];
  binds: string[];
  memoryBytes: number;
  gamePort: number;
}

export async function createAndStart(
  docker: Docker,
  instance: Instance,
  spec: RunSpec,
): Promise<Docker.Container> {
  const name = containerName(instance.id);
  await removeContainerIfExists(docker, name);
  await pullImage(docker, spec.image);

  const container = await docker.createContainer({
    name,
    Image: spec.image,
    WorkingDir: spec.workingDir,
    Cmd: spec.cmd,
    Env: spec.env,
    ExposedPorts: {
      [`${GAME_CONTAINER_PORT}/tcp`]: {},
      [`${RCON_PORT}/tcp`]: {},
    },
    HostConfig: {
      Binds: spec.binds,
      Memory: spec.memoryBytes,
      PortBindings: {
        [`${GAME_CONTAINER_PORT}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: String(spec.gamePort) }],
        [`${RCON_PORT}/tcp`]: [{ HostIp: "127.0.0.1", HostPort: String(RCON_PORT) }],
      },
      RestartPolicy: { Name: "no" },
    },
    Labels: {
      "lghs.instance": instance.id,
    },
  });

  await container.start();
  log("docker", `container ${name} no ar`);
  return container;
}

function prefixWriter(prefix: string): Writable {
  let leftover = "";
  return new Writable({
    write(chunk, _enc, cb) {
      leftover += chunk.toString("utf8");
      const lines = leftover.split("\n");
      leftover = lines.pop() ?? "";
      for (const line of lines) {
        log("minecraft", line);
      }
      cb();
    },
    final(cb) {
      if (leftover) log("minecraft", leftover);
      cb();
    },
  });
}

export async function followContainerLogs(docker: Docker, instanceId: string): Promise<() => void> {
  const container = docker.getContainer(containerName(instanceId));
  const stream = (await container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    timestamps: false,
  })) as unknown as Readable;

  docker.modem.demuxStream(stream, prefixWriter("[mc] "), prefixWriter("[mc] "));
  stream.on("error", () => undefined);

  return () => {
    stream.destroy();
  };
}

function decodeDockerLogs(buf: Buffer): string {
  const parts: string[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    const end = offset + 8 + size;
    if (end > buf.length) break;
    parts.push(buf.subarray(offset + 8, end).toString("utf8"));
    offset = end;
  }
  return parts.join("") || buf.toString("utf8");
}

export async function recentContainerLogs(docker: Docker, instanceId: string): Promise<string> {
  try {
    const buf = (await docker.getContainer(containerName(instanceId)).logs({
      stdout: true,
      stderr: true,
      tail: 80,
    })) as Buffer;
    return decodeDockerLogs(Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf)));
  } catch {
    return "";
  }
}

export async function waitUntilExit(docker: Docker, instanceId: string): Promise<void> {
  const name = containerName(instanceId);
  try {
    await docker.getContainer(name).wait();
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status !== 404) throw err;
  }
}

export async function waitForExit(
  docker: Docker,
  instanceId: string,
  timeoutMs: number,
): Promise<boolean> {
  const result = await Promise.race([
    waitUntilExit(docker, instanceId).then(() => true),
    sleep(timeoutMs).then(() => false),
  ]);
  return result;
}

export async function forceStop(docker: Docker, instanceId: string): Promise<void> {
  const name = containerName(instanceId);
  try {
    await docker.getContainer(name).stop({ t: 15 });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status !== 404 && status !== 304) throw err;
  }
}

