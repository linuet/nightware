import { readFile } from "node:fs/promises";
import type { CapturedFrame } from "./types.js";

export type ReplayDirection = "out" | "in" | "both";

export interface ReplayOptions {
  speed: number;
  direction: ReplayDirection;
}

export interface ReplayItem {
  delayMs: number;
  frame: CapturedFrame;
}

export async function loadReplaySession(
  file: string,
  options: ReplayOptions
): Promise<ReplayItem[]> {
  if (!Number.isFinite(options.speed) || options.speed <= 0) {
    throw new Error("Replay speed must be greater than 0.");
  }

  const raw = await readFile(file, "utf8");
  const frames: CapturedFrame[] = [];

  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let value: unknown;

    try {
      value = JSON.parse(trimmed);
    } catch {
      throw new Error(`Invalid JSONL at line ${index + 1}.`);
    }

    if (!isCapturedFrame(value)) {
      throw new Error(`Invalid Nightwire frame at line ${index + 1}.`);
    }

    if (value.direction === "system") continue;

    if (
      options.direction === "both" ||
      value.direction === options.direction
    ) {
      frames.push(value);
    }
  }

  frames.sort((a, b) => a.timestamp - b.timestamp);

  let previous: number | null = null;

  return frames.map((frame) => {
    const delay = previous === null
      ? 0
      : Math.max(0, frame.timestamp - previous);

    previous = frame.timestamp;

    return {
      delayMs: Math.round(delay / options.speed),
      frame
    };
  });
}

function isCapturedFrame(value: unknown): value is CapturedFrame {
  if (typeof value !== "object" || value === null) return false;

  const frame = value as Partial<CapturedFrame>;

  return (
    typeof frame.id === "number" &&
    typeof frame.at === "string" &&
    typeof frame.timestamp === "number" &&
    ["in", "out", "system"].includes(String(frame.direction)) &&
    ["text", "json", "binary", "event"].includes(String(frame.kind)) &&
    typeof frame.bytes === "number" &&
    typeof frame.preview === "string" &&
    typeof frame.payload === "string"
  );
}
