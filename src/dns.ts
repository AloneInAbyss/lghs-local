import { log, logWarn } from "./log.js";
import type { LghsConfig, Secrets } from "./types.js";

interface CfEnvelope<T> {
  success: boolean;
  errors: { message: string }[];
  result: T;
}

async function cf<T>(token: string, method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as CfEnvelope<T>;
  if (!res.ok || data.success === false) {
    const msg = data.errors?.map((e) => e.message).join("; ") || res.statusText;
    throw new Error(`Cloudflare: ${msg}`);
  }
  return data.result;
}

async function publicIp(): Promise<string> {
  const res = await fetch("https://cloudflare.com/cdn-cgi/trace");
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("ip="));
  if (!line) throw new Error("Não foi possível obter o IP público");
  return line.slice(3).trim();
}

export async function updateDdns(config: LghsConfig, secrets: Secrets): Promise<void> {
  if (!secrets.CLOUDFLARE_API_TOKEN) {
    logWarn("dns", "CLOUDFLARE_API_TOKEN vazio — DDNS ignorado");
    return;
  }

  const token = secrets.CLOUDFLARE_API_TOKEN;
  const ip = await publicIp();
  const fqdn = `${config.network.cloudflare.record}.${config.network.cloudflare.zone}`;

  const zones = await cf<{ id: string }[]>(
    token,
    "GET",
    `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(config.network.cloudflare.zone)}`,
  );
  const zoneId = zones[0]?.id;
  if (!zoneId) throw new Error(`Zona Cloudflare não encontrada: ${config.network.cloudflare.zone}`);

  const records = await cf<{ id: string; content: string }[]>(
    token,
    "GET",
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(fqdn)}`,
  );
  const record = records[0];
  if (!record) {
    throw new Error(`Registro A ${fqdn} não encontrado na zona`);
  }
  if (record.content === ip) {
    log("dns", `${fqdn} já aponta para ${ip}`);
    return;
  }

  await cf(
    token,
    "PATCH",
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${record.id}`,
    { type: "A", name: fqdn, content: ip, ttl: 120, proxied: false },
  );
  log("dns", `${fqdn} → ${ip}`);
}

export function startDdnsLoop(config: LghsConfig, secrets: Secrets): () => void {
  const tick = () => {
    void updateDdns(config, secrets).catch((err) => {
      logWarn("dns", `falha: ${err instanceof Error ? err.message : String(err)}`);
    });
  };
  tick();
  const handle = setInterval(tick, 5 * 60_000);
  return () => clearInterval(handle);
}
