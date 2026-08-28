import Docker from "dockerode";
import path from "node:path";
import { sleep } from "../duration.js";
import type { Instance } from "../types.js";

export const RCON_PORT = 25575;
export const GAME_CONTAINER_PORT = 25565;

export function createDocker(): Docker {
  if (process.platform === "win32") {
    return new Docker({ socketPath: "//./pipe/docker_engine" });
  }
  return new Docker({ socketPath: process.env.DOCKER_HOST?.replace("unix://", "") ?? "/var/run/docker.sock" });
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
  throw new Error(
    `Docker não respondeu a tempo. No Windows, confirme o Docker Desktop e o auto-logon. ${String(lastError)}`,
  );
}

export function containerName(instanceId: string): string {
  return `lghs-${instanceId}`;
}

export function toDockerBindPath(hostPath: string): string {
  const abs = path.resolve(hostPath);
  return process.platform === "win32" ? abs.replace(/\\/g, "/") : abs;
}

export async function pullImage(docker: Docker, image: string): Promise<void> {
  const stream = await docker.pull(image);
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()));
  });
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
  return container;
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

