// Minimal client for `concat-cli api`: JSON-RPC 2.0, one request per line on
// stdin, one reply or event per line on stdout. One process holds the open
// project sessions, so a whole edit runs through one Concat instance.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export class Concat {
  constructor({ bin, env = process.env, cwd, log = () => {} }) {
    this.proc = spawn(bin, ["api"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.log = log;
    this.stderr = "";
    this.proc.stderr.on("data", (d) => { this.stderr += d; });
    createInterface({ input: this.proc.stdout }).on("line", (line) => this.#onLine(line));
    this.exited = new Promise((res) => this.proc.on("exit", (code) => {
      for (const { reject } of this.pending.values()) reject(new Error(`concat-cli exited (${code}): ${this.stderr.slice(-2000)}`));
      this.pending.clear();
      res(code);
    }));
  }

  #onLine(line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { this.log(`unparsed: ${line}`); return; }
    if (msg.id != null && this.pending.has(msg.id)) {
      const { resolve, reject, method } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(Object.assign(new Error(`${method}: ${msg.error.message}`), { rpc: msg.error }));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of this.listeners) l(msg.method, msg.params);
    }
  }

  call(method, params = {}) {
    const id = this.nextId++;
    this.log(`-> ${method} ${JSON.stringify(params).slice(0, 300)}`);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  /** edit.apply one command; returns the EditorView (createdId holds a minted id). */
  apply(path, command) { return this.call("edit.apply", { path, command }); }

  /** Runs an export and resolves when export.done / rejects on export.failed. */
  async export(params, onProgress = () => {}) {
    const { job } = await this.call("export.run", params);
    return new Promise((resolve, reject) => {
      const l = (method, p) => {
        if (p?.job !== job) return;
        if (method === "export.progress") onProgress(p);
        else if (method === "export.done") { this.listeners.delete(l); resolve(p); }
        else if (method === "export.failed") { this.listeners.delete(l); reject(new Error(`export failed: ${JSON.stringify(p.error)}`)); }
      };
      this.listeners.add(l);
    });
  }

  async close() { this.proc.stdin.end(); return this.exited; }
}

/** Find a clip in the EditorView by id. */
export function findClip(view, clipId) {
  const tl = view.project.timelines.find((t) => t.id === view.project.activeTimelineId) ?? view.project.timelines[0];
  return tl.clips.find((c) => c.id === clipId) ?? null;
}
