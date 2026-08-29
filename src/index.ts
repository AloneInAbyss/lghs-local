import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { Appliance } from "./appliance.js";
import { startConsole } from "./console/server.js";
import { log, logError } from "./log.js";

async function main(): Promise<void> {
  loadDotenv({ path: path.join(process.cwd(), ".env") });
  const app = new Appliance();
  await app.boot();
  const consoleServer = startConsole(app);

  const shutdown = (signal: string) => {
    log("lghs", `${signal} — encerrando o console e o Discord (o jogo continua)`);
    consoleServer.close();
    app.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logError("lghs", `fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
