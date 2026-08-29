import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Appliance, CONSOLE_ACTOR } from "../appliance.js";
import { catalogGuide, installCatalogGame, loadCatalog } from "../catalog.js";
import { generateSecret, type SetupInput } from "../config.js";
import { inspectBotToken, inspectGuild } from "../discord/setup.js";
import { log, logError, logHistory, LOG_STREAMS, onLogLine, type LogStream } from "../log.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function publicDir(): string {
  const near = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
  if (existsSync(near)) return near;
  return path.join(process.cwd(), "src/console/public");
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8"): void {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(data);
}

function authorized(req: IncomingMessage, url: URL): boolean {
  const expected = process.env.CONSOLE_TOKEN?.trim();
  if (!expected) return true;
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const query = url.searchParams.get("token") ?? "";
  return bearer === expected || query === expected;
}

function needHost(app: Appliance, res: ServerResponse): boolean {
  if (app.host && app.loaded) return true;
  send(res, 409, { ok: false, message: "Configure o appliance no assistente primeiro." });
  return false;
}

export function startConsole(app: Appliance): { close: () => void; url: string } {
  const bind = process.env.CONSOLE_BIND ?? "127.0.0.1";
  const port = Number(process.env.CONSOLE_PORT ?? 8787);
  const root = publicDir();

  const server = createServer((req, res) => {
    void handle(app, req, res, root);
  });

  server.listen(port, bind, () => {
    log("lghs", `console local em http://${bind}:${port}`);
  });

  return {
    url: `http://${bind}:${port}`,
    close: () => server.close(),
  };
}

async function handle(
  app: Appliance,
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://console.local");
    if (!authorized(req, url)) {
      send(res, 401, { ok: false, message: "CONSOLE_TOKEN inválido." });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      send(res, 200, await app.status());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/logs") {
      const stream = (url.searchParams.get("stream") ?? "all") as LogStream | "all";
      if (stream !== "all" && !LOG_STREAMS.includes(stream)) {
        send(res, 400, { ok: false, message: "stream inválido" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      for (const line of logHistory(stream, 400)) {
        res.write(`data: ${JSON.stringify(line)}\n\n`);
      }
      const off = onLogLine((line) => {
        if (stream !== "all" && line.stream !== stream) return;
        res.write(`data: ${JSON.stringify(line)}\n\n`);
      });
      req.on("close", off);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/start") {
      if (!needHost(app, res)) return;
      const body = await readJson(req);
      const id = String(body.instanceId ?? "");
      send(res, 200, await app.host!.requestStart(id, CONSOLE_ACTOR));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/stop") {
      if (!needHost(app, res)) return;
      send(res, 200, await app.host!.requestStop(CONSOLE_ACTOR));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/backup") {
      if (!needHost(app, res)) return;
      const body = await readJson(req);
      const id = body.instanceId ? String(body.instanceId) : undefined;
      send(res, 200, await app.host!.requestBackup(id));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/cmd") {
      if (!needHost(app, res)) return;
      const body = await readJson(req);
      send(res, 200, await app.host!.requestCmd(String(body.command ?? "")));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/catalog") {
      const instances = app.loaded?.config.paths.instances;
      send(res, 200, { games: await loadCatalog(process.cwd(), instances) });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/catalog/")) {
      const id = url.pathname.slice("/api/catalog/".length);
      const guide = await catalogGuide(id);
      send(res, 200, guide);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/catalog/install") {
      if (!needHost(app, res)) return;
      const body = await readJson(req);
      const id = String(body.id ?? "");
      const result = await installCatalogGame(id, app.loaded!.config.paths.instances);
      send(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/setup/secret") {
      send(res, 200, { secret: generateSecret() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/setup/discord") {
      const body = await readJson(req);
      send(res, 200, await inspectBotToken(String(body.token ?? "")));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/setup/guild") {
      const body = await readJson(req);
      send(res, 200, await inspectGuild(String(body.token ?? ""), String(body.guildId ?? "")));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/setup") {
      const body = (await readJson(req)) as unknown as SetupInput;
      await app.applySetup(body);
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(res, root, url.pathname);
      return;
    }
    send(res, 404, { ok: false, message: "não encontrado" });
  } catch (err) {
    logError("lghs", `console: ${err instanceof Error ? err.message : String(err)}`);
    if (!res.headersSent) {
      send(res, 500, { ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }
}

async function serveStatic(res: ServerResponse, root: string, pathname: string): Promise<void> {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";
  const abs = path.normalize(path.join(root, rel));
  if (!abs.startsWith(path.normalize(root))) {
    send(res, 403, { ok: false, message: "forbidden" });
    return;
  }
  try {
    const data = await readFile(abs);
    const ext = path.extname(abs);
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    if (pathname !== "/" && !path.extname(pathname)) {
      await serveStatic(res, root, "/index.html");
      return;
    }
    send(res, 404, { ok: false, message: "não encontrado" });
  }
}
