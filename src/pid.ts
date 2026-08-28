import { mkdir, readFile, writeFile } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import path from "node:path";

export async function acquirePid(runtimeDir: string): Promise<void> {
  await mkdir(runtimeDir, { recursive: true });
  const file = path.join(runtimeDir, "bot.pid");
  try {
    const pid = Number((await readFile(file, "utf8")).trim());
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        throw new Error(`Já existe um bot rodando (pid ${pid}). Pare o outro processo antes.`);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ESRCH") throw err;
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await writeFile(file, `${process.pid}\n`, "utf8");
  process.on("exit", () => {
    try {
      unlinkSync(file);
    } catch {
      // ignore
    }
  });
}
