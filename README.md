# CLI Agent Runner

CLI Agent Runner launches scoped Codex, Claude, Grok, or JSON-configured command-line workers and records execution, parent artifact acceptance, and result-contract state independently.

## Live Console

The built-in Live Console shows worker activity while the child process is still running. It is a loopback-only web viewer intended for the Codex in-app browser (IAB); AgentScope or a separate viewer application is not required. With the plugin skill, server startup, URL handoff, IAB opening, runner launch, and cleanup are one automatic flow.

Add `--live-console` to the normal scoped runner command:

```sh
node bin/cli-agent-runner.mjs run \
  --target-cwd /path/to/jobsite \
  --role Implementer \
  --task-id my-task \
  --epoch e1 \
  --scope "scope:v1 paths=src/,tests/" \
  --assignment "Implement the scoped change" \
  --expected-output "Changed files and verification" \
  --runner grok-cli \
  --live-console
```

The command starts its own server, prints a tokenized viewer URL, injects the ingest URL, runs the worker, and retains the completed page until Ctrl-C. When this plugin skill owns the run, it opens the printed URL in Codex IAB and stops the owned terminal session automatically after final inspection. The token grants access to local telemetry, so do not paste the URL into logs, commits, or remote messages.

For an advanced shared or externally managed console, start `live-console --port 0` separately and pass its printed URL through `--live-console-url <url>`. Do not combine the owned and external modes.

The bundled Grok profile uses its Anthropic Messages-compatible streaming JSON output. Other profiles still use the same provider-neutral runner path and publish whatever stdout/stderr their CLI emits. The existing process result, timeout, result-contract, and repository scope-guard decisions remain authoritative.

See [docs/live-console.md](docs/live-console.md) for the event and IAB handoff contract, and [docs/runner-configuration.md](docs/runner-configuration.md) for custom profiles.
