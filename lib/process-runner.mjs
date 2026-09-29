import { spawn } from "node:child_process";

// Captured output per stream is bounded by keeping its most recent bytes: a
// worker's final report comes last, and streaming consumers still receive
// every chunk through onChunk.
export const DEFAULT_MAX_PROCESS_OUTPUT_BYTES = 8 * 1024 * 1024;
const FORCE_KILL_GRACE_MS = 2000;

/**
 * Runs one worker as the leader of its own process group.  The group, not
 * just the direct child, is stopped on timeout or abort, and any process the
 * worker left behind is stopped once the worker exits, so a background
 * process holding the output pipes cannot keep the run open.
 */
export function runStreamingProcess(options) {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_PROCESS_OUTPUT_BYTES;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new TypeError("maxOutputBytes must be a positive integer");
  }

  return new Promise((resolve) => {
    const captured = { stdout: createTail(maxOutputBytes), stderr: createTail(maxOutputBytes) };
    let error = null;
    let settled = false;
    let exited = false;
    const timers = [];
    let child;

    if (options.abortSignal?.aborted) {
      resolve(result(null, null, interruptError(options.abortSignal.reason), captured));
      return;
    }
    try {
      child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });
    } catch (spawnError) {
      resolve(result(null, null, spawnError, captured));
      return;
    }

    const later = (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref();
      timers.push(timer);
    };
    const signalGroup = (signal) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (killError) {
        if (killError.code !== "ESRCH" && !exited) child.kill(signal);
      }
    };
    // SIGTERM, then SIGKILL; if a process that escaped the group still holds
    // the pipes, stop reading them so the run can finish.
    const stopGroup = () => {
      signalGroup("SIGTERM");
      later(() => {
        signalGroup("SIGKILL");
        later(() => {
          child.stdout.destroy();
          child.stderr.destroy();
        }, FORCE_KILL_GRACE_MS);
      }, FORCE_KILL_GRACE_MS);
    };
    const fail = (failure) => {
      if (error || settled) return;
      error = failure;
      stopGroup();
    };

    later(() => fail(processError("ETIMEDOUT", `process timed out after ${options.timeoutMs}ms`)), options.timeoutMs);
    const onAbort = () => fail(interruptError(options.abortSignal.reason));
    options.abortSignal?.addEventListener("abort", onAbort, { once: true });

    const capture = (stream, chunk) => {
      captured[stream].push(chunk);
      options.onChunk?.(stream, chunk);
    };
    child.stdout.on("data", (chunk) => capture("stdout", chunk));
    child.stderr.on("data", (chunk) => capture("stderr", chunk));
    child.on("error", (spawnError) => {
      error ??= spawnError;
    });
    child.on("exit", () => {
      exited = true;
      if (!error) stopGroup();
    });
    child.on("close", (status, signal) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      options.abortSignal?.removeEventListener("abort", onAbort);
      options.onEnd?.("stdout");
      options.onEnd?.("stderr");
      resolve(result(status, signal, error, captured));
    });
    child.stdin.on("error", () => {});

    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

function createTail(maxBytes) {
  const chunks = [];
  let size = 0;
  let dropped = 0;
  return {
    push(chunk) {
      chunks.push(chunk);
      size += chunk.length;
      while (size > maxBytes) {
        const excess = size - maxBytes;
        const head = chunks[0];
        if (head.length <= excess) {
          chunks.shift();
          size -= head.length;
          dropped += head.length;
        } else {
          chunks[0] = head.subarray(excess);
          size -= excess;
          dropped += excess;
        }
      }
    },
    text(stream) {
      let buffer = Buffer.concat(chunks);
      if (!dropped) return buffer.toString("utf8");
      // Do not start in the middle of a UTF-8 sequence.
      let skip = 0;
      while (skip < buffer.length && skip < 3 && (buffer[skip] & 0xc0) === 0x80) skip += 1;
      buffer = buffer.subarray(skip);
      return `[cli-agent-runner: ${dropped + skip} earlier bytes of ${stream} truncated]\n${buffer.toString("utf8")}`;
    },
  };
}

function result(status, signal, error, captured) {
  return {
    status,
    signal,
    error,
    stdout: captured.stdout.text("stdout"),
    stderr: captured.stderr.text("stderr"),
  };
}

function interruptError(reason) {
  return processError("EINTERRUPTED", `interrupted by ${reason ?? "abort"}`);
}

function processError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
