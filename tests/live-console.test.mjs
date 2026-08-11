import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LIVE_EVENT_VERSION, createLiveEvent, parseCodexCodeFontSize, startLiveConsole } from "../lib/live-console.mjs";

test("Live Console serves its viewer and protects ingest and read APIs with its generated token", async () => {
  const fixture = makeViewerFixture();
  const console = await startLiveConsole({ viewerRoot: fixture.root });
  try {
    assert.match(console.token, /^[A-Za-z0-9_-]{40,}$/);
    assert.match(console.viewerUrl, /^http:\/\/127\.0\.0\.1:/);

    const viewer = await fetch(console.viewerUrl);
    assert.equal(viewer.status, 200);
    assert.equal(await viewer.text(), "<main>Live Console</main>");

    const unauthorized = await fetch(console.snapshotUrl.replace(/\?token=.*/, ""));
    assert.equal(unauthorized.status, 401);
    const unauthorizedStream = await fetch(console.eventsUrl.replace(/\?token=.*/, ""));
    assert.equal(unauthorizedStream.status, 401);

    const accepted = await fetch(console.ingestUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${console.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event("run-a", 1, { text: "ready" })),
    });
    assert.equal(accepted.status, 202);
    assert.deepEqual((await accepted.json()).event, event("run-a", 1, { text: "ready" }));

    const snapshot = await (await fetch(console.snapshotUrl)).json();
    assert.equal(snapshot.version, LIVE_EVENT_VERSION);
    assert.deepEqual(snapshot.runs, [{
      runId: "run-a",
      status: "running",
      parentRunId: null,
      depth: 0,
      delegationMode: "leaf",
      focusScope: null,
      events: [event("run-a", 1, { text: "ready" })],
      lastSequence: 1,
      updatedAt: "2026-08-11T00:00:01.000Z",
    }]);
  } finally {
    await console.close();
    fixture.cleanup();
  }
});

test("Live Console preserves delegated run lineage from provider-neutral event data", async () => {
  const fixture = makeViewerFixture();
  const console = await startLiveConsole({ viewerRoot: fixture.root });
  try {
    console.publish(event("child-run", 1, {
      type: "delegation.started",
      data: {
        status: "running",
        parentRunId: "parent-run",
        depth: 1,
        delegationMode: "leaf",
        focusScope: "scope:v1 paths=tests/",
      },
    }));
    const child = console.snapshot().runs[0];
    assert.equal(child.parentRunId, "parent-run");
    assert.equal(child.depth, 1);
    assert.equal(child.delegationMode, "leaf");
    assert.equal(child.focusScope, "scope:v1 paths=tests/");
  } finally {
    await console.close();
    fixture.cleanup();
  }
});

test("Live Console streams replayed and appended envelopes as default SSE messages", async () => {
  const fixture = makeViewerFixture();
  const console = await startLiveConsole({ viewerRoot: fixture.root });
  try {
    console.publish(event("run-stream", 1, { text: "first" }));
    const response = await fetch(console.eventsUrl);
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const initial = await readUntil(reader, decoder, "data: {\"event\":");
    assert.match(initial, /"sequence":1/);

    console.publish(event("run-stream", 2, { stream: "stderr", text: "second" }));
    const update = await readUntil(reader, decoder, "\"sequence\":2");
    assert.match(update, /"sequence":2/);
    assert.match(update, /"stream":"stderr"/);
    await reader.cancel();
  } finally {
    await console.close();
    fixture.cleanup();
  }
});

test("Live Console bounds run and event history and rejects invalid or out-of-order ingest", async () => {
  const fixture = makeViewerFixture();
  const console = await startLiveConsole({
    viewerRoot: fixture.root,
    maxRuns: 2,
    maxEventsPerRun: 2,
  });
  try {
    console.publish(event("run-a", 1));
    console.publish(event("run-a", 2));
    console.publish(event("run-a", 3));
    assert.deepEqual(console.snapshot().runs[0].events.map((item) => item.sequence), [2, 3]);
    console.publish(event("run-b", 1));
    console.publish(event("run-c", 1, { data: { status: "completed" } }));

    const snapshot = console.snapshot();
    assert.deepEqual(snapshot.runs.map((run) => run.runId), ["run-b", "run-c"]);
    assert.equal(snapshot.runs.at(-1).status, "completed");

    assert.throws(() => console.publish(event("run-c", 1)), /must increase/);
    const invalid = await fetch(`${console.ingestUrl}?token=${console.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-c", sequence: 2, timestamp: "invalid", type: "output" }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await console.close();
    fixture.cleanup();
  }
});

test("Live Console event creation requires the complete versioned envelope", () => {
  assert.deepEqual(createLiveEvent(event("run-valid", 1)), event("run-valid", 1));
  assert.throws(
    () => createLiveEvent({ runId: "run-invalid", sequence: 0, timestamp: "2026-08-11T00:00:00.000Z", type: "output" }),
    /sequence/,
  );
});

test("Live Console exposes a validated Codex desktop code font size to the viewer", async () => {
  const fixture = makeViewerFixture();
  const configPath = path.join(fixture.root, "config.toml");
  writeFileSync(configPath, "[desktop]\ncodeFontSize = 18\n[desktop.appearanceDarkChromeTheme]\ncodeFontSize = 27\n");
  const console = await startLiveConsole({ viewerRoot: fixture.root, codexConfigPath: configPath });
  try {
    assert.equal(console.codeFontSize, 18);
    assert.equal(new URL(console.viewerUrl).searchParams.get("codeFontSize"), "18");
    assert.equal(new URL(console.eventsUrl).searchParams.has("codeFontSize"), false);
  } finally {
    await console.close();
    fixture.cleanup();
  }

  assert.equal(parseCodexCodeFontSize("[desktop]\ncodeFontSize = 9\n"), null);
  assert.equal(parseCodexCodeFontSize("[other]\ncodeFontSize = 22\n"), null);
  assert.equal(parseCodexCodeFontSize("[desktop]\ncodeFontSize = 18.5 # preferred\n"), 18.5);
});

function event(runId, sequence, overrides = {}) {
  return {
    version: LIVE_EVENT_VERSION,
    runId,
    sequence,
    timestamp: `2026-08-11T00:00:0${sequence}.000Z`,
    type: "output",
    stream: null,
    text: null,
    data: null,
    ...overrides,
  };
}

function makeViewerFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-viewer-"));
  writeFileSync(path.join(root, "index.html"), "<main>Live Console</main>");
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

async function readUntil(reader, decoder, pattern) {
  let received = "";
  while (!received.includes(pattern)) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`SSE stream ended before ${pattern}`);
    received += decoder.decode(value, { stream: true });
  }
  return received;
}
