# Live Console

Live Console is part of CLI Agent Runner. It replaces the old wait-for-exit observation gap with a local event stream and a dependency-free browser viewer; it does not embed or depend on AgentScope.

## Responsibility boundaries

- The process runner owns child launch, stdin, timeout, output limits, exit state, and raw stdout/stderr capture.
- The stream adapter owns `text`, `ndjson`, and `messages-json` decoding plus provider-neutral event production.
- The Live Console server owns token authentication, bounded in-memory run state, snapshot/SSE delivery, and viewer assets.
- The viewer owns presentation only. It does not launch, mutate, accept, or repair worker output.
- The CLI coordinator connects these owners and continues to record the normalized `process-runner-result` and apply the repository scope guard.

## IAB workflow

1. Launch the normal scoped runner command once with `run --runner <id> --live-console` in a persistent terminal session.
2. The CLI starts its own server, prints `live_console_viewer_url`, injects the ingest URL, and launches the configured worker. The plugin skill reads that URL and opens it in Codex IAB automatically.
3. Watch the selected run's ordered activity and details. The page can pause automatic scrolling without pausing the worker.
4. After the runner result is recorded, the CLI prints `live_console_run_finished: true` and retains the completed page.
5. The plugin skill inspects the final state, sends Ctrl-C to its owned terminal session, and waits for the server and command to exit.

The CLI deliberately prints a normal localhost URL rather than calling private Codex GUI IPC. The parent Codex session owns opening that URL in IAB.

For advanced use, `live-console --port <port>` may still run as a separate server while one or more runner commands publish through `--live-console-url <url>`. The owned and external modes are mutually exclusive for one run.

## Event contract

Every event is a versioned JSON envelope:

```json
{
  "version": 1,
  "runId": "task:epoch:uuid",
  "sequence": 1,
  "timestamp": "2026-08-11T00:00:00.000Z",
  "type": "run.started",
  "stream": null,
  "text": "Runner grok-cli started",
  "data": { "status": "running" }
}
```

The primary event types are `run.started`, `runner.output`, `runner.message`, `run.completed`, and `run.failed`. `data` may hold the structured provider event but is otherwise opaque to the transport. Sequence numbers increase within one run.

The server binds `127.0.0.1`, generates a random token for each start, and requires that token for ingest, snapshot, and SSE. State is ephemeral and bounded; it is not a replacement for `.cli-agent-runner/runner.md`.

## Runner stream formats

- `text`: emit stdout/stderr chunks as `runner.output` while preserving raw output for result selection.
- `ndjson`: decode stdout one JSON object per line and emit `runner.message`; non-JSON lines remain visible as raw output.
- `messages-json`: decode Anthropic Messages wire events, emit their structured envelopes, and reconstruct assistant text from text deltas for the existing stdout result contract.

The default Grok profile declares `messages-json` and launches Grok with `--output-format streaming-messages-json --include-partial-messages`. The executor does not branch on a runner ID; custom profiles select the same behavior through their `stream` field.

## Failure boundary

An invalid or non-loopback external Live Console URL is rejected before child launch. Owned-server setup also completes before assignment state is appended or the worker launches. If the console becomes unavailable during a run, the child result is still recorded with its own execution status, while `live_console_status: failed` is reported separately and the CLI exits unsuccessfully after the retained observation session is stopped. Viewer telemetry never decides artifact acceptance.
