import { Rcon } from "rcon-client";
import { RCON_PORT } from "../../runtime/docker.js";

export async function withRcon<T>(password: string, fn: (rcon: Rcon) => Promise<T>): Promise<T> {
  const rcon = await Rcon.connect({
    host: "127.0.0.1",
    port: RCON_PORT,
    password,
    timeout: 10_000,
  });
  try {
    return await fn(rcon);
  } finally {
    rcon.end();
  }
}

export async function rconSend(password: string, command: string): Promise<string> {
  return withRcon(password, (rcon) => rcon.send(command));
}

export async function rconStop(password: string): Promise<void> {
  await rconSend(password, "stop");
}

export async function rconFlushWorld(password: string): Promise<void> {
  await rconSend(password, "save-all flush");
  await rconSend(password, "save-off");
}

export async function rconResumeWorld(password: string): Promise<void> {
  try {
    await rconSend(password, "save-on");
  } catch {
    // server may already be down
  }
}
