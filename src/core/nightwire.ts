import { EventEmitter } from "node:events";
import WebSocket, { type RawData } from "ws";
import { SessionRecorder } from "./recorder.js";
import { loadReplaySession, type ReplayDirection, type ReplayItem } from "./session-replay.js";
import type { CapturedFrame, ConnectionSnapshot, FrameKind, NightwireOptions } from "./types.js";

export class Nightwire extends EventEmitter {
  private socket: WebSocket | null = null;
  private frameId = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private lastPingAt: number | null = null;
  private manuallyClosed = false;
  private frames: CapturedFrame[] = [];
  private recorder: SessionRecorder | null;
  private replayToken = 0;
  private snapshot: ConnectionSnapshot;

  constructor(private readonly options: NightwireOptions) {
    super();
    this.recorder = options.recordingPath ? new SessionRecorder(options.recordingPath) : null;
    this.snapshot = {
      state: "idle",
      url: options.url,
      reconnects: 0,
      received: 0,
      sent: 0,
      latencyMs: null,
      connectedAt: null
    };
  }

  getSnapshot(): ConnectionSnapshot { return { ...this.snapshot }; }
  getFrames(): CapturedFrame[] { return [...this.frames]; }

  async connect(): Promise<void> {
    this.manuallyClosed = false;
    this.clearReconnect();
    if (this.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket.readyState)) return;

    this.setState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const socket = new WebSocket(this.options.url, this.options.protocols, { headers: this.options.headers });
    this.socket = socket;

    socket.on("open", () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.snapshot.connectedAt = new Date().toISOString();
      this.snapshot.latencyMs = null;
      this.setState("open");
      this.addSystemFrame("connected");
      this.startPingLoop(socket);
    });

    socket.on("message", (data, isBinary) => {
      if (this.socket !== socket) return;
      const frame = this.capture("in", isBinary ? "binary" : detectKind(data.toString()), data);
      this.snapshot.received++;
      this.emit("frame", frame);
      this.emitState();
    });

    socket.on("pong", () => {
      if (this.socket !== socket) return;
      if (this.lastPingAt !== null) {
        this.snapshot.latencyMs = Math.max(0, Math.round(performance.now() - this.lastPingAt));
        this.lastPingAt = null;
        this.emitState();
      }
    });

    socket.on("error", (error) => {
      if (this.socket !== socket) return;
      this.setState("error");
      this.addSystemFrame(`error: ${error.message}`);
    });

    socket.on("close", (code, reason) => {
      if (this.socket !== socket) return;
      this.stopPingLoop();
      this.snapshot.connectedAt = null;
      this.snapshot.latencyMs = null;
      this.addSystemFrame(`closed: ${code}${reason.length ? ` ${reason.toString()}` : ""}`);
      this.socket = null;
      if (!this.manuallyClosed && this.options.reconnect) this.scheduleReconnect();
      else this.setState("closed");
    });
  }

  disconnect(): void {
    this.cancelSessionReplay();
    this.manuallyClosed = true;
    this.clearReconnect();
    this.stopPingLoop();
    if (this.socket) this.socket.close(1000, "nightwire disconnect");
    else this.setState("closed");
  }

  async reconnect(): Promise<void> {
    this.manuallyClosed = false;
    this.clearReconnect();
    if (this.socket) {
      const old = this.socket;
      this.socket = null;
      old.terminate();
    }
    this.reconnectAttempt = 0;
    await this.connect();
  }

  send(payload: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("WebSocket is not connected.");
    this.socket.send(payload);
    const frame = this.capture("out", detectKind(payload), Buffer.from(payload));
    this.snapshot.sent++;
    this.emit("frame", frame);
    this.emitState();
  }

  replay(frameId: number): void {
    const frame = this.frames.find((item) => item.id === frameId);
    if (!frame) throw new Error(`Frame ${frameId} was not found.`);
    if (frame.kind === "binary") throw new Error("Binary replay is not supported in this version.");
    if (frame.direction === "system") throw new Error("System events cannot be replayed.");
    this.send(frame.payload);
  }


  async startSessionReplay(
    file: string,
    speed = 1,
    direction: ReplayDirection = "out"
  ): Promise<number> {
    const items = await loadReplaySession(file, { speed, direction });

    if (!items.length) {
      throw new Error("Replay session contains no matching frames.");
    }

    const token = ++this.replayToken;

    this.addSystemFrame(
      `session replay started: ${items.length} frame(s) at ${speed}x`
    );

    void this.runSessionReplay(items, token);
    return items.length;
  }

  cancelSessionReplay(): void {
    this.replayToken++;
  }

  private async runSessionReplay(
    items: ReplayItem[],
    token: number
  ): Promise<void> {
    let sent = 0;

    for (const item of items) {
      if (token !== this.replayToken) {
        this.addSystemFrame("session replay cancelled");
        return;
      }

      if (item.delayMs > 0) {
        await wait(item.delayMs);
      }

      if (token !== this.replayToken) {
        this.addSystemFrame("session replay cancelled");
        return;
      }

      if (item.frame.kind === "binary") {
        this.addSystemFrame(
          `session replay skipped binary frame ${item.frame.id}`
        );
        continue;
      }

      try {
        this.send(item.frame.payload);
        sent++;
      } catch (error) {
        this.addSystemFrame(
          `session replay stopped: ${error instanceof Error ? error.message : "send failed"}`
        );
        return;
      }
    }

    if (token === this.replayToken) {
      this.addSystemFrame(`session replay finished: ${sent} frame(s) sent`);
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt++;
    this.snapshot.reconnects++;
    this.setState("reconnecting");
    const delay = Math.min(this.options.reconnectDelayMs * 2 ** (this.reconnectAttempt - 1), this.options.maxReconnectDelayMs);
    this.addSystemFrame(`reconnect in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  private capture(direction: "in" | "out", kind: FrameKind, data: RawData | Buffer): CapturedFrame {
    const buffer = toBuffer(data);
    const payload = kind === "binary" ? buffer.toString("base64") : buffer.toString("utf8");
    const frame: CapturedFrame = {
      id: ++this.frameId,
      at: new Date().toISOString(),
      timestamp: Date.now(),
      direction,
      kind,
      bytes: buffer.byteLength,
      preview: previewPayload(payload),
      payload
    };
    this.remember(frame);
    return frame;
  }

  private addSystemFrame(message: string): void {
    const frame: CapturedFrame = {
      id: ++this.frameId,
      at: new Date().toISOString(),
      timestamp: Date.now(),
      direction: "system",
      kind: "event",
      bytes: Buffer.byteLength(message),
      preview: message,
      payload: message
    };
    this.remember(frame);
    this.emit("frame", frame);
  }

  private remember(frame: CapturedFrame): void {
    this.frames.push(frame);
    if (this.frames.length > this.options.maxFrames) this.frames.splice(0, this.frames.length - this.options.maxFrames);
    if (this.recorder) void this.recorder.record(frame);
  }

  private startPingLoop(socket: WebSocket): void {
    this.stopPingLoop();
    if (this.options.pingIntervalMs <= 0) return;
    this.pingTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      this.lastPingAt = performance.now();
      socket.ping();
    }, this.options.pingIntervalMs);
  }

  private stopPingLoop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.lastPingAt = null;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setState(state: ConnectionSnapshot["state"]): void {
    this.snapshot.state = state;
    this.emitState();
  }

  private emitState(): void { this.emit("state", this.getSnapshot()); }
}

function detectKind(value: string): FrameKind {
  try { JSON.parse(value); return "json"; } catch { return "text"; }
}

function previewPayload(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= 180 ? collapsed : `${collapsed.slice(0, 177)}...`;
}

function toBuffer(data: RawData | Buffer): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data);
}


function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
