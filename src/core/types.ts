export type FrameDirection = "in" | "out" | "system";
export type FrameKind = "text" | "json" | "binary" | "event";

export interface CapturedFrame {
  id: number;
  at: string;
  timestamp: number;
  direction: FrameDirection;
  kind: FrameKind;
  bytes: number;
  preview: string;
  payload: string;
}

export interface ConnectionSnapshot {
  state: "idle" | "connecting" | "open" | "closed" | "reconnecting" | "error";
  url: string;
  reconnects: number;
  received: number;
  sent: number;
  latencyMs: number | null;
  connectedAt: string | null;
}

export interface NightwireOptions {
  url: string;
  headers: Record<string, string>;
  protocols?: string[];
  reconnect: boolean;
  reconnectDelayMs: number;
  maxReconnectDelayMs: number;
  pingIntervalMs: number;
  recordingPath?: string;
  maxFrames: number;
}
