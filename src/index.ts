import { loadConfig } from "./config.js";
import { startBot } from "./discord/bot.js";
import { startDdnsLoop } from "./dns.js";
import { acquirePid } from "./pid.js";
import { Host } from "./runtime/host.js";

async function main(): Promise<void> {
  const { config, secrets, configPath } = await loadConfig();
  console.log(`[lghs] config ${configPath}`);
  console.log(`[lghs] instances ${config.paths.instances}`);
  await acquirePid(config.paths.runtime);

  const host = new Host(config, secrets);
  await host.init();

  const stopDdns = startDdnsLoop(config, secrets);
  const client = await startBot(config, secrets, host);

  const shutdown = (signal: string) => {
    console.log(`[lghs] ${signal} — encerrando o bot (o jogo continua)`);
    stopDdns();
    client.destroy();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[lghs] fatal:", err);
  process.exit(1);
});
