#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { Nightwire } from "./core/nightwire.js";
import { createDashboardServer } from "./server.js";

const program = new Command();

program
  .name("nightwire")
  .description("Local WebSocket debugger with capture, latency, recording and replay")
  .version("0.1.0")
  .argument("<url>", "WebSocket URL: ws:// or wss://")
  .option("-p, --port <number>", "Dashboard port", int, 7331)
  .option("--host <host>", "Dashboard host", "127.0.0.1")
  .option("-H, --header <header...>", "WebSocket request headers")
  .option("--protocol <protocol...>", "WebSocket subprotocols")
  .option("--no-reconnect", "Disable automatic reconnect")
  .option("--reconnect-delay <ms>", "Initial reconnect delay", int, 500)
  .option("--max-reconnect-delay <ms>", "Maximum reconnect delay", int, 10000)
  .option("--ping-interval <ms>", "Ping/pong interval", int, 5000)
  .option("--record <file>", "Append captured frames to JSONL")
  .option("--max-frames <number>", "Maximum frames retained", int, 2000)
  .action(async (url, options) => {
    try {
      const parsed = new URL(url);
      if (!["ws:", "wss:"].includes(parsed.protocol)) throw new Error("URL must use ws:// or wss://");

      const recordingPath = options.record ? resolve(options.record) : undefined;
      if (recordingPath) await mkdir(dirname(recordingPath), { recursive: true });

      const nightwire = new Nightwire({
        url,
        headers: parseHeaders(options.header ?? []),
        protocols: options.protocol,
        reconnect: options.reconnect,
        reconnectDelayMs: options.reconnectDelay,
        maxReconnectDelayMs: options.maxReconnectDelay,
        pingIntervalMs: options.pingInterval,
        recordingPath,
        maxFrames: options.maxFrames
      });

      const dashboard = createDashboardServer(nightwire, options.host, options.port);
      dashboard.server.listen(options.port, options.host, () => {
        console.log("nightwire\n");
        console.log(`target:    ${url}`);
        console.log(`dashboard: http://${options.host}:${options.port}`);
        console.log(`recording: ${recordingPath ?? "off"}`);
        console.log(`reconnect: ${options.reconnect ? "on" : "off"}`);
        console.log("\nPress Ctrl+C to stop.");
      });

      await nightwire.connect();

      const shutdown = async () => {
        nightwire.disconnect();
        await dashboard.close();
        process.exit(0);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    } catch (error) {
      console.error(`nightwire: ${error instanceof Error ? error.message : "unknown error"}`);
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);

function int(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid integer: ${value}`);
  return n;
}

function parseHeaders(items: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const item of items) {
    const colon = item.indexOf(":");
    if (colon <= 0) throw new Error(`Invalid header "${item}". Use "Name: value".`);
    headers[item.slice(0, colon).trim()] = item.slice(colon + 1).trim();
  }
  return headers;
}
