import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LIVE_EVENT_VERSION = 1;

const DEFAULT_MAX_RUNS = 25;
const DEFAULT_MAX_EVENTS_PER_RUN = 500;
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
]);
const DEFAULT_VIEWER_ROOT = fileURLToPath(new URL("../viewer", import.meta.url));

/**
 * Creates and validates the provider-neutral event shape consumed by the Live
 * Console. `data` deliberately remains JSON-compatible but otherwise opaque to
 * this transport layer.
 */
export function createLiveEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Live Console event must be an object");
  }

  const event = {
    version: input.version ?? LIVE_EVENT_VERSION,
    runId: input.runId,
    sequence: input.sequence,
    timestamp: input.timestamp ?? new Date().toISOString(),
    type: input.type,
    stream: input.stream ?? null,
    text: input.text ?? null,
    data: input.data ?? null,
  };

  if (event.version !== LIVE_EVENT_VERSION) {
    throw new TypeError(`Unsupported Live Console event version: ${event.version}`);
  }
  if (typeof event.runId !== "string" || event.runId.trim() === "") {
    throw new TypeError("Live Console event runId must be a non-empty string");
  }
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
    throw new TypeError("Live Console event sequence must be a positive integer");
  }
  if (typeof event.timestamp !== "string" || Number.isNaN(Date.parse(event.timestamp))) {
    throw new TypeError("Live Console event timestamp must be an ISO date string");
  }
  if (typeof event.type !== "string" || event.type.trim() === "") {
    throw new TypeError("Live Console event type must be a non-empty string");
  }
  if (event.stream !== null && typeof event.stream !== "string") {
    throw new TypeError("Live Console event stream must be a string or null");
  }
  if (event.text !== null && typeof event.text !== "string") {
    throw new TypeError("Live Console event text must be a string or null");
  }
  assertJsonValue(event.data, "data");
  return event;
}

/**
 * Starts a loopback-only, token-protected server. The returned `publish`
 * helper is convenient for the process runner; HTTP clients use POST
 * `/api/events` with the same validated envelope.
 */
export async function startLiveConsole(options = {}) {
  const port = normalizePort(options.port ?? 0);
  const viewerRoot = path.resolve(options.viewerRoot ?? DEFAULT_VIEWER_ROOT);
  const maxRuns = positiveInteger(options.maxRuns ?? DEFAULT_MAX_RUNS, "maxRuns");
  const maxEventsPerRun = positiveInteger(
    options.maxEventsPerRun ?? DEFAULT_MAX_EVENTS_PER_RUN,
    "maxEventsPerRun",
  );
  const maxBodyBytes = positiveInteger(options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES, "maxBodyBytes");
  const token = randomBytes(32).toString("base64url");
  const runs = new Map();
  const sseClients = new Set();
  let closed = false;

  const appendEvent = (input) => {
    const event = createLiveEvent(input);
    let run = runs.get(event.runId);
    if (!run) {
      run = {
        runId: event.runId,
        status: "running",
        events: [],
        lastSequence: 0,
        updatedAt: event.timestamp,
      };
      runs.set(event.runId, run);
      while (runs.size > maxRuns) {
        const oldestRunId = runs.keys().next().value;
        runs.delete(oldestRunId);
      }
    }
    if (event.sequence <= run.lastSequence) {
      throw new RangeError(`Live Console event sequence must increase for run ${event.runId}`);
    }

    run.events.push(event);
    run.lastSequence = event.sequence;
    run.updatedAt = event.timestamp;
    updateRunStatus(run, event);
    if (run.events.length > maxEventsPerRun) {
      run.events.splice(0, run.events.length - maxEventsPerRun);
    }
    broadcast(sseClients, { event });
    return event;
  };

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname === "/api/events" && request.method === "POST") {
        if (!isAuthorized(request, requestUrl, token)) return unauthorized(response);
        const event = appendEvent(await readJsonBody(request, maxBodyBytes));
        writeJson(response, 202, { event });
        return;
      }
      if (requestUrl.pathname === "/api/snapshot" && request.method === "GET") {
        if (!isAuthorized(request, requestUrl, token)) return unauthorized(response);
        writeJson(response, 200, makeSnapshot(runs));
        return;
      }
      if (requestUrl.pathname === "/api/events" && request.method === "GET") {
        if (!isAuthorized(request, requestUrl, token)) return unauthorized(response);
        openSse(response, sseClients, makeSnapshot(runs));
        return;
      }
      if (requestUrl.pathname.startsWith("/api/")) {
        writeJson(response, 404, { error: "not_found" });
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }
      await serveStatic(response, requestUrl.pathname, viewerRoot, request.method === "HEAD");
    } catch (error) {
      const statusCode = error?.statusCode ?? 400;
      writeJson(response, statusCode, { error: error?.message ?? "bad_request" });
    }
  });

  await listen(server, port);
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server, sseClients);
    throw new Error("Live Console did not expose a TCP address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const query = new URLSearchParams({ token }).toString();

  return {
    host: "127.0.0.1",
    port: address.port,
    token,
    viewerUrl: `${baseUrl}/?${query}`,
    ingestUrl: `${baseUrl}/api/events`,
    snapshotUrl: `${baseUrl}/api/snapshot?${query}`,
    eventsUrl: `${baseUrl}/api/events?${query}`,
    publish: appendEvent,
    snapshot: () => makeSnapshot(runs),
    close: async () => {
      if (closed) return;
      closed = true;
      await closeServer(server, sseClients);
    },
  };
}

function makeSnapshot(runs) {
  return {
    version: LIVE_EVENT_VERSION,
    runs: Array.from(runs.values(), (run) => ({
      runId: run.runId,
      status: run.status,
      events: [...run.events],
      lastSequence: run.lastSequence,
      updatedAt: run.updatedAt,
    })),
  };
}

function updateRunStatus(run, event) {
  if (event.data && typeof event.data === "object" && typeof event.data.status === "string") {
    run.status = event.data.status;
  } else if (event.type === "run.completed" || event.type === "run-completed") {
    run.status = "completed";
  } else if (event.type === "run.failed" || event.type === "run-failed") {
    run.status = "failed";
  }
}

function isAuthorized(request, requestUrl, token) {
  const header = request.headers.authorization;
  const bearer = typeof header === "string" && header.match(/^Bearer (.+)$/i)?.[1];
  return tokenMatches(bearer, token) || tokenMatches(requestUrl.searchParams.get("token"), token);
}

function tokenMatches(candidate, token) {
  if (typeof candidate !== "string") return false;
  const expected = Buffer.from(token);
  const supplied = Buffer.from(candidate);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function unauthorized(response) {
  writeJson(response, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
}

function writeJson(response, statusCode, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(body);
}

function openSse(response, clients, snapshot) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  const client = { response, heartbeat: null };
  clients.add(client);
  // EventSource.onmessage receives only default messages. Replaying the bounded
  // snapshot as envelope wrappers also closes the fetch-to-SSE connection gap.
  for (const run of snapshot.runs) {
    for (const event of run.events) sendSse(response, { event });
  }
  client.heartbeat = setInterval(() => response.write(": keepalive\n\n"), 15_000);
  client.heartbeat.unref();
  response.on("close", () => {
    clearInterval(client.heartbeat);
    clients.delete(client);
  });
}

function broadcast(clients, value) {
  for (const client of clients) sendSse(client.response, value);
}

function sendSse(response, value) {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

async function serveStatic(response, pathname, viewerRoot, headOnly) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    writeJson(response, 400, { error: "invalid_path" });
    return;
  }
  const filePath = path.resolve(viewerRoot, `.${decodedPath}`);
  if (filePath !== viewerRoot && !filePath.startsWith(`${viewerRoot}${path.sep}`)) {
    writeJson(response, 403, { error: "forbidden" });
    return;
  }
  let metadata;
  try {
    metadata = await stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      writeJson(response, 404, { error: "not_found" });
      return;
    }
    throw error;
  }
  if (!metadata.isFile()) {
    writeJson(response, 404, { error: "not_found" });
    return;
  }
  response.writeHead(200, {
    "Content-Type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream",
    "Content-Length": metadata.size,
    "Cache-Control": "no-store",
  });
  if (headOnly) return response.end();
  response.end(await readFile(filePath));
}

function readJsonBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        const error = new Error("request body is too large");
        error.statusCode = 413;
        reject(error);
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        const error = new Error("request body must be valid JSON");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function normalizePort(port) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new TypeError("port must be an integer from 0 to 65535");
  }
  return port;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function assertJsonValue(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Live Console event ${label} must be JSON-compatible`);
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`Live Console event ${label} must not be circular`);
    seen.add(value);
    value.forEach((item, index) => assertJsonValue(item, `${label}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  if (typeof value === "object") {
    if (seen.has(value)) throw new TypeError(`Live Console event ${label} must not be circular`);
    seen.add(value);
    for (const [key, item] of Object.entries(value)) assertJsonValue(item, `${label}.${key}`, seen);
    seen.delete(value);
    return;
  }
  throw new TypeError(`Live Console event ${label} must be JSON-compatible`);
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server, clients) {
  for (const client of clients) {
    clearInterval(client.heartbeat);
    client.response.end();
  }
  clients.clear();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
