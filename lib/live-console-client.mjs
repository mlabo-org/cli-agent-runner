const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

export function resolveLiveConsoleIngestUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new TypeError("Live Console URL must be a valid absolute URL");
  }
  if (url.protocol !== "http:") {
    throw new TypeError("Live Console URL must use http on loopback");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new TypeError("Live Console URL must use 127.0.0.1, localhost, or ::1");
  }
  if (!url.searchParams.get("token")) {
    throw new TypeError("Live Console URL must include its generated token");
  }
  if (url.username || url.password) {
    throw new TypeError("Live Console URL must not contain credentials");
  }
  url.pathname = "/api/events";
  url.hash = "";
  return url;
}

export function createLiveConsolePublisher(options) {
  const ingestUrl = resolveLiveConsoleIngestUrl(options.url);
  const runId = requireRunId(options.runId);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Live Console publishing requires fetch");
  }
  const requestTimeoutMs = positiveInteger(
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    "requestTimeoutMs",
  );
  let sequence = 0;
  let queue = Promise.resolve();
  let failure = null;

  const publish = (input) => {
    if (failure) return Promise.reject(failure);
    const event = {
      version: 1,
      runId,
      sequence: ++sequence,
      timestamp: new Date().toISOString(),
      type: requireType(input?.type),
      stream: input?.stream ?? null,
      text: input?.text ?? null,
      data: input?.data ?? null,
    };
    queue = queue.then(async () => {
      const response = await fetchImpl(ingestUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Live Console ingest rejected event with HTTP ${response.status}`);
      }
      return event;
    }).catch((error) => {
      failure = error instanceof Error ? error : new Error(String(error));
      throw failure;
    });
    return queue;
  };

  return {
    runId,
    ingestUrl: ingestUrl.toString(),
    publish,
    drain: async () => queue,
    failure: () => failure,
  };
}

function requireRunId(value) {
  const runId = String(value || "").trim();
  if (!runId || /[\r\n\0]/.test(runId)) {
    throw new TypeError("Live Console runId must be a non-empty single-line string");
  }
  return runId;
}

function requireType(value) {
  const type = String(value || "").trim();
  if (!type || /[\r\n\0]/.test(type)) {
    throw new TypeError("Live Console event type must be a non-empty single-line string");
  }
  return type;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}
