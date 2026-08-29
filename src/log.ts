import { EventEmitter } from "node:events";

export const LOG_STREAMS = ["lghs", "docker", "minecraft", "discord", "dns", "backup"] as const;
export type LogStream = (typeof LOG_STREAMS)[number];

export interface LogLine {
  ts: number;
  stream: LogStream;
  text: string;
}

const MAX = 2000;
const TAG: Record<LogStream, string> = {
  lghs: "lghs",
  docker: "docker",
  minecraft: "mc",
  discord: "discord",
  dns: "dns",
  backup: "backup",
};

const buffers: Record<LogStream, LogLine[]> = {
  lghs: [],
  docker: [],
  minecraft: [],
  discord: [],
  dns: [],
  backup: [],
};
const all: LogLine[] = [];
const bus = new EventEmitter();
bus.setMaxListeners(50);

function push(stream: LogStream, text: string): LogLine {
  const line: LogLine = { ts: Date.now(), stream, text };
  const buf = buffers[stream];
  buf.push(line);
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);
  all.push(line);
  if (all.length > MAX * 2) all.splice(0, all.length - MAX * 2);
  bus.emit("line", line);
  return line;
}

export function log(stream: LogStream, text: string): void {
  push(stream, text);
  console.log(`[${TAG[stream]}] ${text}`);
}

export function logWarn(stream: LogStream, text: string): void {
  push(stream, text);
  console.warn(`[${TAG[stream]}] ${text}`);
}

export function logError(stream: LogStream, text: string): void {
  push(stream, text);
  console.error(`[${TAG[stream]}] ${text}`);
}

export function onLogLine(fn: (line: LogLine) => void): () => void {
  bus.on("line", fn);
  return () => {
    bus.off("line", fn);
  };
}

export function logHistory(stream: LogStream | "all" = "all", limit = 500): LogLine[] {
  const src = stream === "all" ? all : buffers[stream];
  return src.slice(-limit);
}
