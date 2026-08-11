# Live Console

Live Console is part of CLI Agent Runner. It replaces the old wait-for-exit observation gap with a local event stream and a dependency-free browser viewer; it does not embed or depend on AgentScope.

Live Console is default-on. Omission is not an OFF signal; only an explicit silent/no-console/OFF selection disables it.

## Responsibility boundaries

- The process runner owns child launch, stdin, timeout, output limits, exit state, and raw stdout/stderr capture.
- The stream adapter owns `text`, `ndjson`, and `messages-json` decoding plus provider-neutral event production.
- The Live Console server owns token authentication, bounded in-memory run state, snapshot/SSE delivery, and viewer assets.
- The viewer owns presentation only. It does not launch, mutate, accept, or repair worker output.
- The CLI coordinator connects these owners and continues to record the normalized `process-runner-result` and apply the repository scope guard.

## IAB workflow

1. When the plugin skill is selected, launch `live-console --port 0` in a persistent terminal before target intake, assignment construction, or worker launch.
2. Read `live_console_viewer_url` and open it in Codex IAB immediately. The empty viewer is the ready/standby state.
3. Launch each later scoped worker with `run --runner <id> --live-console-url <url>` so it publishes into the console that is already open.
4. Watch the selected run's ordered activity and details. The page can pause automatic scrolling without pausing the worker.
5. After each runner result, inspect the final state and keep the console ready for later work in the same task. Send Ctrl-C to the standalone console session and wait for exit when the task ends or the user stops it.

The CLI deliberately prints a normal localhost URL rather than calling private Codex GUI IPC. The parent Codex session owns opening that URL in IAB.

For direct CLI use, `run|orchestrate --runner <id>` starts an owned console by default, before the assignment is appended or the worker launches. It prints the viewer URL, retains the completed page after `live_console_run_finished: true`, and stops on SIGINT or SIGTERM. `--live-console` remains an optional compatibility spelling and is no longer required.

Use `--no-live-console` or `--silent` only for explicit OFF operation. Either flag disables console startup for that runner while preserving its normal process-result record. OFF flags are mutually exclusive with `--live-console`, `--live-console-port`, and `--live-console-url`.

Failure to start or open the default console is a stop condition, not an implicit OFF transition. The plugin must report the console boundary before target intake or worker launch instead of continuing invisibly.

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

An invalid or non-loopback external Live Console URL, or a conflicting ON/OFF selection, is rejected before child launch. Owned-server setup also completes before assignment state is appended or the worker launches. If the console becomes unavailable during a run, the child result is still recorded with its own execution status, while `live_console_status: failed` is reported separately and the CLI exits unsuccessfully after the retained observation session is stopped. Viewer telemetry never decides artifact acceptance.
