# CLI Agent Runner

CLI Agent Runner launches scoped Codex, Claude, Grok, or JSON-configured command-line workers. `run` launches exactly one worker. `orchestrate` launches the parent-declared independent leaf jobs in one jobs file concurrently. A successful in-scope run or orchestration records its minimal completed result and stops; failure and scope violations remain explicit.

## Execution Modes

Use `run --runner <id>` when one owner can complete the scoped work without a useful split. It accepts one role, owner scope, assignment, and expected output, then launches one worker.

Use `orchestrate --runner <id> --jobs-file <json>` only after the parent has modelled the human responsibility owners and their dependency graph. The command keeps task identity at the top level; its version-1 JSON file supplies the independently executable leaves:

```json
{
  "version": 1,
  "jobs": [
    {
      "id": "docs",
      "role": "Documentation owner",
      "ownerScope": "README.md",
      "assignment": "Update the public contract.",
      "expectedOutput": "Changed documentation."
    }
  ]
}
```

Choose orchestration when independent workstreams materially reduce total elapsed time. Each job must have a stable handoff and a non-overlapping writable scope. Keep tightly coupled work with one owner, and use one worker when split and merge overhead erases the time saving. A hierarchy permission ceiling only controls a worker's descendants; it never creates or substitutes for the parent's explicit sibling-job dispatch. After a successful orchestration, do not launch a reviewer, validator, or other post-success gate.

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

When the plugin skill owns the workflow, it starts `live-console --port 0` first, opens the URL in Codex IAB, and later passes that same console through `--live-console-url <url>` to every `run` worker and every `orchestrate` job. This keeps the viewer ready long before a worker starts, avoids spawning a second console, and shows separate run IDs for the parallel jobs.

A permission, approval, clarification, or target-selection question pauses the task without ending the console session. The IAB tab is handed off and kept open across the user turn. On resume, the parent reclaims and checks that viewer first, or starts and opens a replacement before continuing if the process or tab was lost.

Console-free operation is explicit-only. Use `--no-live-console` or its `--silent` alias only after the user has asked for silent mode, no console, or Live Console OFF. These flags cannot be combined with positive Live Console options.

Runner-profile hierarchy is a permission ceiling, not a delegation command or sibling-job mechanism. Any profile may declare `defaultHierarchyDepth`; it limits descendants only. The parent alone decides whether to create an `orchestrate` jobs file, using elapsed-time savings and independent ownership rather than hierarchy permission. The bundled Grok profile sets the descendant ceiling to one direct-child level, and those children cannot delegate again. Bundled Codex and Claude profiles retain the no-descendant workflow default. Explicit hierarchy fields that replace a declared profile default require `--hierarchy-override-reason user_request|safety_boundary|scope_boundary|capability_boundary`; an unreasoned replacement is rejected before assignment state or process launch. Every profile still uses the same provider-neutral runner path; timeout and repository scope-guard failures remain authoritative, while successful execution is terminal.

See [docs/live-console.md](docs/live-console.md) for the event and IAB handoff contract, and [docs/runner-configuration.md](docs/runner-configuration.md) for custom profiles.
