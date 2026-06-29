import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** PIDs of long-running detached children, so shutdown can kill their groups. */
const activeGroups = new Set<number>();

/** SIGKILL every tracked build process group. Used during graceful shutdown. */
export function killAllStreaming(): void {
  for (const pid of activeGroups) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  activeGroups.clear();
}

/**
 * Run a command to completion, capturing output. Always argv-array form with
 * `shell:false` — no user value is ever interpreted by a shell.
 */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export interface StreamOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  onData: (chunk: string) => void;
}

/**
 * Spawn a long-running command, streaming combined stdout/stderr line chunks to
 * `onData`. Runs in its own process group so a timeout can kill the whole tree.
 * Resolves with the exit code (rejects only on spawn error).
 */
export function spawnStreaming(
  cmd: string,
  args: string[],
  opts: StreamOptions,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      detached: true,
    });
    if (child.pid) activeGroups.add(child.pid);

    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          opts.onData(`\n[build timed out after ${opts.timeoutMs}ms — killing]\n`);
          try {
            if (child.pid) process.kill(-child.pid, "SIGKILL");
          } catch {
            /* already gone */
          }
        }, opts.timeoutMs)
      : null;

    child.stdout.on("data", (d) => opts.onData(d.toString()));
    child.stderr.on("data", (d) => opts.onData(d.toString()));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (child.pid) activeGroups.delete(child.pid);
      resolve(timedOut ? 124 : code ?? -1);
    });
  });
}

/** True if a command exists on PATH. */
export async function commandExists(cmd: string): Promise<boolean> {
  try {
    const res = await run("which", [cmd]);
    return res.code === 0 && res.stdout.trim().length > 0;
  } catch {
    return false;
  }
}
