import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export const DELEGATION_BROKER_ENV = "CLI_AGENT_RUNNER_DELEGATION_BROKER_URL";

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

export async function startDelegationBroker(options = {}) {
  if (typeof options.onDelegate !== "function") {
    throw new TypeError("delegation broker requires onDelegate");
  }
  const maxBodyBytes = positiveInteger(options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES, "maxBodyBytes");
  const token = randomBytes(32).toString("base64url");
  const active = new Set();
  let closed = false;

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname !== "/delegate" || request.method !== "POST") {
        writeJson(response, 404, { error: "not_found" });
        return;
      }
      if (!tokenMatches(requestUrl.searchParams.get("token"), token)) {
        writeJson(response, 401, { error: "unauthorized" });
        return;
      }

      const pending = Promise.resolve(options.onDelegate(await readJsonBody(request, maxBodyBytes)));
      active.add(pending);
      try {
        writeJson(response, 200, { result: await pending });
      } finally {
        active.delete(pending);
      }
    } catch (error) {
      writeJson(response, error?.statusCode ?? 400, { error: error?.message ?? "delegation_failed" });
    }
  });

  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("delegation broker did not expose a TCP address");
  }

  return {
    url: `http://127.0.0.1:${address.port}/delegate?token=${token}`,
    close: async () => {
      if (closed) return;
      closed = true;
      await closeServer(server);
      await Promise.allSettled([...active]);
    },
  };
}

export async function requestDelegation(options = {}) {
  const url = requireBrokerUrl(options.url);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options.payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `delegation broker rejected request with HTTP ${response.status}`);
  }
  return body.result;
}

function requireBrokerUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new TypeError("local delegation requires the runner-owned broker URL");
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/delegate") {
    throw new TypeError("delegation broker URL must use its 127.0.0.1 /delegate endpoint");
  }
  if (!url.searchParams.get("token") || url.username || url.password) {
    throw new TypeError("delegation broker URL must carry its generated token without credentials");
  }
  return url;
}

function readJsonBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        const error = new Error("delegation request body is too large");
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
        const error = new Error("delegation request body must be valid JSON");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function tokenMatches(candidate, token) {
  if (typeof candidate !== "string") return false;
  const expected = Buffer.from(token);
  const supplied = Buffer.from(candidate);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function writeJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}
