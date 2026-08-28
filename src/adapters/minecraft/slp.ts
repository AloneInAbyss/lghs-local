import net from "node:net";

function varInt(value: number): Buffer {
  const bytes: number[] = [];
  let n = value;
  do {
    let temp = n & 0x7f;
    n >>>= 7;
    if (n !== 0) temp |= 0x80;
    bytes.push(temp);
  } while (n !== 0);
  return Buffer.from(bytes);
}

function stringField(value: string): Buffer {
  const data = Buffer.from(value, "utf8");
  return Buffer.concat([varInt(data.length), data]);
}

function packet(id: number, payload: Buffer): Buffer {
  const inner = Buffer.concat([varInt(id), payload]);
  return Buffer.concat([varInt(inner.length), inner]);
}

function readVarInt(buf: Buffer, offset: number): { value: number; size: number } {
  let value = 0;
  let size = 0;
  let byte: number;
  do {
    byte = buf[offset + size]!;
    value |= (byte & 0x7f) << (7 * size);
    size += 1;
  } while (byte & 0x80);
  return { value, size };
}

async function readExact(socket: net.Socket, length: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let remaining = length;
  while (remaining > 0) {
    const chunk: Buffer = await new Promise((resolve, reject) => {
      const onData = (data: Buffer) => {
        cleanup();
        resolve(data);
      };
      const onErr = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onEnd = () => {
        cleanup();
        reject(new Error("conexão encerrada no Server List Ping"));
      };
      const cleanup = () => {
        socket.off("data", onData);
        socket.off("error", onErr);
        socket.off("end", onEnd);
      };
      socket.once("data", onData);
      socket.once("error", onErr);
      socket.once("end", onEnd);
    });
    chunks.push(chunk);
    remaining -= chunk.length;
    if (remaining < 0) {
      const extra = chunk.subarray(chunk.length + remaining);
      socket.unshift(extra);
      chunks[chunks.length - 1] = chunk.subarray(0, chunk.length + remaining);
    }
  }
  return Buffer.concat(chunks);
}

export async function serverListPing(host: string, port: number, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });

    socket.once("connect", async () => {
      try {
        const handshake = packet(
          0x00,
          Buffer.concat([varInt(760), stringField(host), Buffer.from([port >> 8, port & 0xff]), varInt(1)]),
        );
        const status = packet(0x00, Buffer.alloc(0));
        socket.write(Buffer.concat([handshake, status]));

        const first = await readExact(socket, 5);
        const length = readVarInt(first, 0);
        const already = first.length - length.size;
        const rest = await readExact(socket, Math.max(0, length.value - already));
        const body = Buffer.concat([first.subarray(length.size), rest]);
        const packetId = readVarInt(body, 0);
        if (packetId.value !== 0x00) {
          clearTimeout(timer);
          socket.destroy();
          resolve(false);
          return;
        }
        const str = readVarInt(body, packetId.size);
        const json = body.subarray(packetId.size + str.size, packetId.size + str.size + str.value).toString("utf8");
        JSON.parse(json);
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      } catch {
        clearTimeout(timer);
        socket.destroy();
        resolve(false);
      }
    });
  });
}

export async function waitForPing(
  host: string,
  port: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("wait abortado");
    if (await serverListPing(host, port)) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Servidor não respondeu ao ping em ${Math.round(timeoutMs / 60000)} min`);
}
