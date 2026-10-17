import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * Client for the render engine's API (`concat-cli api`): JSON-RPC 2.0,
 * one request per line on stdin, one reply or event per line on stdout.
 * One process holds the open project, so a whole edit runs through one
 * engine instance. The engine is only ever driven through this API.
 *
 * EngineRpc is the seam the executor tests mock.
 */
export interface EngineRpc {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** Subscribes to notifications; returns an unsubscribe function. */
  onEvent(listener: (method: string, params: Record<string, unknown>) => void): () => void;
  close(): Promise<void>;
}

export class EngineError extends Error {
  constructor(message: string, readonly rpc?: unknown) {
    super(message);
    this.name = "EngineError";
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; method: string };

export class EngineProcess implements EngineRpc {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(method: string, params: Record<string, unknown>) => void>();
  private stderr = "";
  private exited: Promise<number | null>;

  constructor({ bin, env, cwd }: { bin: string; env: NodeJS.ProcessEnv; cwd?: string }) {
    this.proc = spawn(bin, ["api"], { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stderr.on("data", (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-8000);
    });
    createInterface({ input: this.proc.stdout }).on("line", (line) => this.onLine(line));
    this.exited = new Promise((res) => {
      this.proc.on("exit", (code) => {
        for (const p of this.pending.values()) p.reject(new EngineError(`render engine exited (${code}): ${this.stderr.slice(-2000)}`));
        this.pending.clear();
        res(code);
      });
      this.proc.on("error", (err) => {
        for (const p of this.pending.values()) p.reject(new EngineError(`render engine failed to start: ${err.message}`));
        this.pending.clear();
        res(null);
      });
    });
  }

  private onLine(line: string) {
    if (!line.trim()) return;
    let msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new EngineError(`${p.method}: ${msg.error.message ?? "error"}`, msg.error));
      else p.resolve(msg.result);
    } else if (msg.method) {
      for (const l of this.listeners) l(msg.method, msg.params ?? {});
    }
  }

  call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, method });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  onEvent(listener: (method: string, params: Record<string, unknown>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.proc.stdin.end();
    const timer = setTimeout(() => this.proc.kill("SIGKILL"), 10_000);
    await this.exited;
    clearTimeout(timer);
  }
}

type EditorView = {
  project: {
    activeTimelineId?: string;
    timelines: { id: string; clips: { id: string; duration: number }[] }[];
  };
};

/** Typed helpers over the raw RPC calls the executor uses. */
export class Engine {
  constructor(readonly rpc: EngineRpc) {}

  apply(path: string, command: Record<string, unknown>): Promise<{ createdId?: string }> {
    return this.rpc.call("edit.apply", { path, command });
  }

  async clipDuration(path: string, clipId: string): Promise<number> {
    const view = await this.rpc.call<EditorView>("project.get", { path });
    const tl = view.project.timelines.find((t) => t.id === view.project.activeTimelineId) ?? view.project.timelines[0];
    const clip = tl?.clips.find((c) => c.id === clipId);
    if (!clip) throw new EngineError(`clip ${clipId} not found after adding it`);
    return clip.duration;
  }

  /** Runs an export; resolves on export.done, rejects on export.failed or after timeoutMs. */
  async export(
    params: Record<string, unknown>,
    { onProgress, timeoutMs }: { onProgress?: (frame: number, total: number) => void; timeoutMs: number }
  ): Promise<{ output: string }> {
    const { job } = await this.rpc.call<{ job: string }>("export.run", params);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new EngineError(`export timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      const off = this.rpc.onEvent((method, p) => {
        if (p.job !== job) return;
        if (method === "export.progress") onProgress?.(Number(p.frame ?? 0), Number(p.total ?? 0));
        else if (method === "export.done") {
          clearTimeout(timer);
          off();
          resolve({ output: String(p.output) });
        } else if (method === "export.failed") {
          clearTimeout(timer);
          off();
          reject(new EngineError(`export failed: ${JSON.stringify(p.error)}`));
        }
      });
    });
  }
}
