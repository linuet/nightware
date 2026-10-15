import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CapturedFrame } from "./types.js";

export class SessionRecorder {
  constructor(private readonly path: string) {}

  async record(frame: CapturedFrame): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(frame) + "\n", "utf8");
  }
}
