# CLI Agent Runner

CLI Agent Runner launches scoped Codex, Claude, Grok, or JSON-configured command-line workers and records execution, parent artifact acceptance, and result-contract state independently.

## Live Console

The built-in Live Console shows worker activity while the child process is still running. It is a loopback-only web viewer intended for the Codex in-app browser (IAB); AgentScope or a separate viewer application is not required. Live Console is default-on. The plugin skill starts and opens one standby console before target intake or worker preparation, then reuses it for later runs. Direct CLI runner use owns a console automatically when no prestarted URL or explicit OFF flag is supplied.

No Live Console flag is required for a direct scoped runner command:

```sh
node bin/cli-agent-runner.mjs run \
  --target-cwd /path/to/jobsite \
  --role Implementer \
  --task-id my-task \
  --epoch e1 \
  --scope "scope:v1 paths=src/,tests/" \
  --assignment "Implement the scoped change" \
  --expected-output "Changed files and verification" \
  --runner grok-cli
```

The command starts its own server, prints a tokenized viewer URL, injects the ingest URL, runs the worker, and retains the completed page until Ctrl-C. `--live-console` remains accepted as an optional explicit spelling, and `--live-console-port` can select a port. The token grants access to local telemetry, so do not paste the URL into logs, commits, or remote messages.

When the plugin skill owns the workflow, it starts `live-console --port 0` first, opens the URL in Codex IAB, and later passes that same console through `--live-console-url <url>` to every runner. This keeps the viewer ready long before Grok or another worker starts and avoids spawning a second console.

Console-free operation is explicit-only. Use `--no-live-console` or its `--silent` alias only after the user has asked for silent mode, no console, or Live Console OFF. These flags cannot be combined with positive Live Console options.

Runner-profile hierarchy is a permission ceiling, not a delegation command. Any profile may declare `defaultHierarchyDepth`; the parent owns the allowed depth and the surrounding concurrency, time, budget, operation-scope, and permission-inheritance boundaries, while the assigned worker decides whether descendants materially help inside them. Model-specific suitability belongs in explicit profile configuration, including `defaultHierarchyDepth: 0`, rather than an unrecorded parent decision. The bundled Grok profile sets the ceiling to one direct-child level, and those children cannot delegate again. Bundled Codex and Claude profiles retain the no-descendant workflow default. Explicit hierarchy fields that replace a declared profile default require `--hierarchy-override-reason user_request|safety_boundary|scope_boundary|capability_boundary`; an unreasoned replacement is rejected before assignment state or process launch. CLI Agent Runner passes the resolved policy through without independently deciding that a worker should or should not delegate. Every profile still uses the same provider-neutral runner path, and the existing process result, timeout, result-contract, and repository scope-guard decisions remain authoritative.

See [docs/live-console.md](docs/live-console.md) for the event and IAB handoff contract, and [docs/runner-configuration.md](docs/runner-configuration.md) for custom profiles.
