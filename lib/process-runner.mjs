import { spawn } from "node:child_process";

export const DEFAULT_MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024;
const FORCE_KILL_GRACE_MS = 2000;

export function runStreamingProcess(options) {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_PROCESS_OUTPUT_BYTES;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new TypeError("maxOutputBytes must be a positive integer");
  }

  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    const streamBytes = { stdout: 0, stderr: 0 };
    let error = null;
    let timedOut = false;
    let settled = false;
    let forceKill = null;
    let child;

    try {
      child = spawn(options.command, options.args, {
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (spawnError) {
      resolve(result(null, null, spawnError, stdoutChunks, stderrChunks));
      return;
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      error = processError("ETIMEDOUT", `process timed out after ${options.timeoutMs}ms`);
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), FORCE_KILL_GRACE_MS);
      forceKill.unref();
    }, options.timeoutMs);
    timeout.unref();

    const capture = (stream, chunks, chunk) => {
      streamBytes[stream] += chunk.length;
      if (streamBytes[stream] > maxOutputBytes && !error) {
        error = processError("ENOBUFS", `process output exceeded ${maxOutputBytes} bytes`);
        clearTimeout(timeout);
        child.kill("SIGTERM");
        forceKill = setTimeout(() => child.kill("SIGKILL"), FORCE_KILL_GRACE_MS);
        forceKill.unref();
        return;
      }
      if (streamBytes[stream] <= maxOutputBytes) chunks.push(chunk);
      options.onChunk?.(stream, chunk);
    };
    child.stdout.on("data", (chunk) => capture("stdout", stdoutChunks, chunk));
    child.stderr.on("data", (chunk) => capture("stderr", stderrChunks, chunk));
    child.on("error", (spawnError) => {
      error ??= spawnError;
    });
    child.on("close", (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      options.onEnd?.("stdout");
      options.onEnd?.("stderr");
      if (timedOut && !error) {
        error = processError("ETIMEDOUT", `process timed out after ${options.timeoutMs}ms`);
      }
      resolve(result(status, signal, error, stdoutChunks, stderrChunks));
    });
    child.stdin.on("error", () => {});

    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

function result(status, signal, error, stdoutChunks, stderrChunks) {
  return {
    status,
    signal,
    error,
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
  };
}

function processError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
