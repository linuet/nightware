import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { dashboardHtml } from "./dashboard/html.js";
import type { Nightwire } from "./core/nightwire.js";

export function createDashboardServer(nightwire: Nightwire, host: string, port: number) {
  const clients = new Set<ServerResponse>();

  const event = (res: ServerResponse, name: string, data: unknown) => {
    res.write(`event: ${name}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const broadcast = (name: string, data: unknown) => {
    for (const client of clients) event(client, name, data);
  };

  nightwire.on("frame", (frame) => broadcast("frame", frame));
  nightwire.on("state", (snapshot) => broadcast("snapshot", snapshot));

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);

      if (req.method === "GET" && url.pathname === "/") {
        const html = dashboardHtml();
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-length": Buffer.byteLength(html),
          "cache-control": "no-store"
        });
        res.end(html);
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive"
        });
        clients.add(res);
        event(res, "initial", {
          snapshot: nightwire.getSnapshot(),
          frames: nightwire.getFrames()
        });
        req.on("close", () => clients.delete(res));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/send") {
        const body = await readJson(req);
        nightwire.send(String(body.payload ?? ""));
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/replay") {
        const body = await readJson(req);
        const id = Number(body.id);
        if (!Number.isInteger(id)) throw new Error("Frame id must be an integer.");
        nightwire.replay(id);
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/reconnect") {
        await nightwire.reconnect();
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/disconnect") {
        nightwire.disconnect();
        json(res, 200, { ok: true });
        return;
      }

      json(res, 404, { error: "not_found" });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "unknown error" });
    }
  });

  return {
    server,
    close: () => new Promise<void>((resolve, reject) => {
      for (const client of clients) client.end();
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 1024 * 1024) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("JSON body must be an object.");
  return parsed as Record<string, unknown>;
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}
