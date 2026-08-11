---
name: cli-agent-runner
description: >-
  Run Grok, Claude, Codex, or custom CLI workers singly, with brokered descendants, or in parallel with default-on IAB Live Console. Triggers: CLI Agent Runner, local orchestrator, Live Console, CLI LLM, runner JSON, or .cli-agent-runner continuation. Silent/no-console is explicit-only; excludes official subagents.
---

# CLI Agent Runner

この `SKILL.md` は、この skill が選択された場合に適用される局所実行契約である。
Codex は、本書の発火前提、作業手順、ツール境界、ファイル境界、出力形式を、この skill のスコープ内で拘束力のある実行条件として扱う。
本書は、システム指示、開発者指示、ユーザーの明示要求、適用される `AGENTS.md`、より局所の実行契約を上書きしない。

## Trigger Boundary

- Use this skill when the user explicitly names `CLI Agent Runner` or `cli-agent-runner`; asks for its Live Console or IAB viewer; asks for a CLI-spawned Codex, Claude, Grok, or configured worker; asks to capture or watch a CLI worker's stdout, stderr, structured messages, or final message; asks to add or use custom runner JSON; or asks to continue, audit, or repair existing `.cli-agent-runner` workflow state.
- The primary execution routes are `run --runner <id>` for exactly one parent-managed worker, `run --runner <id> --delegation-mode local_orchestrator` for one parent-managed worker that may split bounded internal helper work through the broker, and `orchestrate --runner <id> --jobs-file <json>` for parent-declared independent responsibility leaves. Bundled IDs are `codex-cli`, `claude-cli`, and `grok-cli`; user-defined IDs use the same execution and result-normalization path.
- Do not auto-route this skill for generic coding, ordinary official-subagent work, code review, supervision, or cancellation. Those tasks remain on their normal routes unless the user explicitly requests CLI process execution.
- Do not trigger this skill merely because a repository contains `docs/codex`. Legacy `docs/codex` is a migration source, not proof that the current workflow is active.
- Do not perform legacy migration apply, plugin cache refresh, marketplace updates, or restart/reload actions unless the active user request includes that boundary.

## Core Contract

- Treat `invocation_cwd` as the directory where Codex or the source CLI was launched. Treat `jobsite`, `target cwd`, and `target-cwd` as the repository being planned, repaired, edited, or audited.
- When the user does not name another target, `invocation_cwd` is the jobsite. This preserves the default `cwd is jobsite` intake rule.
- When the user names a different repair/edit target, or the source CLI receives `--target-cwd <path>`, the named target is the jobsite. The invocation repository does not own workflow state for that target.
- Resolve the jobsite's Git root before writing workflow state. The active state root is the jobsite repository's `<git-root>/.cli-agent-runner/`, even when `invocation_cwd` is a plugin, tooling, or parent repository.
- If the jobsite, target cwd, or target Git root is ambiguous, missing, outside the active task scope, or cannot be resolved, stop before state writes or edits. Report the ambiguity and ask for the intended target.
- If no Git root can be resolved for the jobsite, do not invent a state path. Report the blocker or ask for the intended repository root.
- Before creating or updating the jobsite repository's `<git-root>/.cli-agent-runner/`, ensure that repository's `.git/info/exclude` ignores `.cli-agent-runner/`. Add only that local exclude entry when it is missing.
- Do not auto-edit the repository's tracked `.gitignore` to hide CLI Agent Runner state. Edit tracked ignore policy only when the user explicitly requests that repository policy change.
- Resolve `<plugin-root>` as the nearest ancestor of this `SKILL.md` that contains `.codex-plugin/plugin.json`. Use that resolved root for every bundled CLI invocation; do not assume a maintainer-specific home directory or source checkout path.
- Unless the current user explicitly requests silent mode, no console, or Live Console OFF, the first action after trigger is to launch `live-console --port 0` in one persistent owned terminal, read its printed viewer URL, and open it in Codex IAB. Do this before target resolution, project intake, assignment construction, or any Grok, Claude, Codex, or configured runner launch. Lack of a Live Console request is not an OFF instruction.
- After the default console is visibly standing by, determine `invocation_cwd`, resolve the jobsite from the explicit target or default cwd rule, read the local `AGENTS.md` chain that applies to the jobsite when available, inspect the jobsite repository shape, check Git state, resolve `<git-root>`, inspect existing `.cli-agent-runner` state, inspect `.git/info/exclude`, and identify legacy `docs/codex` material only as migration input.
- During source upgrade work, direct execution of the source CLI runs source-tree behavior: `node "<plugin-root>/bin/cli-agent-runner.mjs" ...`. This validates source behavior, not installed plugin activation.
- `run --runner <id>` resolves one validated runner profile and launches exactly one worker with the jobsite as cwd. It captures its configured result source plus process stdout/stderr, applies the declared scope guard, and derives the `process-runner-result` status, summary, exit code, signal, timeout, and failure fields. Direct CLI use starts and retains an owned Live Console by default when no prestarted URL or explicit OFF flag is supplied; `--live-console` remains an optional explicit compatibility spelling.
- Every assignment resolves exactly one executable `delegation_mode`. `leaf` requires `remaining_depth: 0`, exposes no delegation broker, and forbids descendants. `local_orchestrator` requires positive finite `remaining_depth` and exposes a token-protected runner-owned loopback broker. The broker, not the provider CLI, launches every accepted descendant through the same configured runner path.
- `--delegation-mode local_orchestrator` supplies a one-level parent-selected hierarchy when the selected profile has no `defaultHierarchyDepth` and the parent supplied no hierarchy fields. This gives bundled Codex and Claude the same explicit local-orchestrator route as Grok without adding provider-ID branches. A selected profile default remains authoritative unless the existing reasoned override contract is satisfied.
- A local orchestrator delegates only bounded internal helper work that it will integrate into its own complete result. The broker inherits `task_id`, `epoch`, runner profile, authority scope, supervision, Live Console URL, and decremented hierarchy depth. Each descendant receives a unique ID and non-overlapping `focus_scope` inside the immediate delegator's authority; the broker confines concurrent descendants to the collective declared focus set. A descendant returns to its immediate delegating worker rather than becoming a parent-managed sibling job.
- The worker-only `delegate` command accepts only `delegate-id`, role, focus scope, assignment, expected output, and optional feature profile from a process carrying the broker environment. It cannot select a target repository, task identity, runner profile, authority scope, hierarchy ceiling, Live Console URL, or workflow lifecycle.
- `orchestrate --runner <id> --jobs-file <json>` launches the parent-declared independent leaf jobs in the version-1 jobs file concurrently. Task identity remains top-level. Each job must contain `id`, `role`, `ownerScope`, `assignment`, and `expectedOutput`; the parent must derive human responsibility owners and a dependency graph before dispatch.
- Select `orchestrate` only when independent workstreams with stable handoffs and non-overlapping writable scopes materially reduce elapsed time. Keep tightly coupled work with one owner, and use `run` when the split and merge overhead erases the saving. Do not use a hierarchy permission ceiling as a substitute for the parent's explicit sibling-job dispatch.
- The normal plugin-owned run or orchestration reuses the already visible standby console through `--live-console-url <tokenized-loopback-url>`. Do not create a second viewer for the same skill activation: all orchestration jobs share it and emit distinct per-job run IDs.
- The parent Codex session owns the persistent standalone console terminal, immediate supported IAB opening, URL injection into later runs, pause/resume continuity, final observation, and cleanup when the task actually ends or the user explicitly stops it. A question awaiting user permission, approval, clarification, or target selection is an in-progress pause, never a cleanup boundary. Do not call private Codex GUI IPC.
- Only a current explicit silent/no-console/OFF instruction selects console-free execution; pass `--no-live-console` or its `--silent` alias for that run. Do not infer OFF from omission, brevity, batch operation, or lack of an observation request.
- Live Console transport state is separate from child execution; a mid-run viewer transport failure must remain explicit rather than being reported as child failure or hidden by fallback.
- An exit-zero, in-scope `run --runner` result is terminal. A successful `orchestrate` result is terminal after its declared leaf jobs complete. Store the minimal completed process result, then stop verification for that execution.
- Do not evaluate a successful run or orchestration with a separate worker-report conformance contract, mark it parent-acceptance-pending, require a follow-up `collect`, or chain `finalize`, `verify-assignments`, `doctor`, reviewer, or another validator after success. Explicitly requested collection/finalization workflows remain separate commands, not automatic post-success gates.
- The parent owns the assignment, allowed scope, acceptance decision, and user-facing synthesis. The CLI child worker owns only the scoped transformation and its returned result material.
- Installed plugin activation is controlled by refreshing the plugin cache from validated source and then restarting Codex or opening a new thread when required. Do not claim a source CLI run proves cached plugin activation.
- Maintain `<git-root>/.cli-agent-runner/` as the workflow SSOT for the active job.
- When the user confirms a design or operating decision, record it as an accepted decision, convert it into actionable specification, and audit execution against it after implementation.
- `collect` and `finalize` remain available for explicitly requested manual workflow-state collection and task-wide coverage. They are not required after a successful `run --runner` result or successful orchestration.
- The parent agent owns task decomposition, policy decisions, user consultation, conflict resolution, final integration, task-wide Contract Coverage, task finalization, workflow-state lifecycle disposition, any separate runtime action available through exposed runtime tools, and final reporting.
- Subagents own research, implementation material, verification material, and isolated findings. They do not own final policy or final user-facing synthesis.
- For an explicitly managed collection workflow, the parent uses `collect --lifecycle-disposition state_retired --cancel-reason <allowed-reason>` when no further workflow use is expected, or `collect --lifecycle-disposition continuation_expected` when an explicitly scoped continuation remains necessary. This does not apply to a successful `run --runner` result or successful orchestration.
- A worker's explicit completed, blocked, or failed result is not silence. Successful `run --runner` output and successful orchestration stop at their terminal process result; failure or blocker handling remains cause-bound.
- Treat lifecycle fields as workflow state only. The CLI Agent Runner CLI does not interrupt, close, delete, or reclaim runtime threads; interruption and process exit are not runtime-thread closure evidence.

## Runner Registry Contract

- `config/runners.default.json` is the source-owned default registry and defines `codex-cli`, `claude-cli`, and `grok-cli` through the same schema used for custom runners.
- `lib/runner-registry.mjs` owns configuration discovery, precedence, schema validation, placeholder expansion, and resolved `command` plus `args[]` production. `bin/cli-agent-runner.mjs` owns workflow routing, process execution, scope enforcement, and normalized result recording; it must not add provider-specific execution branches.
- The `stream` profile field selects `text`, `ndjson`, or `messages-json`. The stream adapter owns decoding and event normalization independently of runner ID. The bundled Grok profile selects `messages-json` with Grok's Anthropic Messages-compatible streaming output; other profiles remain on their declared format.
- User configuration may extend or override profiles through the user config, jobsite `.cli-agent-runner/runners.json`, `CLI_AGENT_RUNNER_CONFIG`, or `--runner-config`. The executable registry validator and its tests own accepted fields, merge order, placeholder rules, and failure predicates; `docs/runner-configuration.md` is the user-facing format reference.
- Runner profiles may declare an executable-validated `defaultHierarchyDepth`. It is a maximum descendant permission, not an instruction to delegate and never a substitute for the parent dispatching independent sibling jobs through `orchestrate --jobs-file`. The parent owns the ownership/dependency decision, concurrency, time, budget, operation scope, and permission-inheritance boundaries. The assigned worker decides only whether permitted descendants materially help within its own assignment. Model suitability belongs in explicit profile configuration, including `defaultHierarchyDepth: 0`, rather than in a hidden per-run parent judgment. The bundled `grok-cli` profile permits one direct-child level, while bundled Codex and Claude profiles retain zero descendant depth.
- Do not replace a selected profile's `defaultHierarchyDepth` merely because the parent prefers fewer agents, considers the task simple, or wants tighter control. Explicit hierarchy fields that change the profile ceiling require `--hierarchy-override-reason user_request|safety_boundary|scope_boundary|capability_boundary`; use a reason only when the current user or concrete task evidence establishes that boundary. The source CLI rejects missing or invalid reasons before assignment append or process launch.
- Launch configured commands directly with an argument array and the jobsite cwd. Do not lower runner JSON into a shell command string.
- Reject missing explicit config, invalid config, unknown runner IDs, and invalid launch specifications before appending runner state or spawning a process.

## Live Console Contract

- At skill selection, start `live-console --port 0` in a persistent terminal and immediately open its printed `live_console_viewer_url` in Codex IAB before project work begins. Use a specific port only when the current request requires one. Do not ask the user to copy the URL, invent a token, echo it into remote output, or call private Codex GUI IPC.
- If the default console cannot start or its viewer cannot be opened, stop before target intake or worker launch and report that boundary. Do not silently continue without a console or reinterpret the failure as an OFF request.
- Keep that one console visible and ready while target intake, assignment construction, and other pre-run work proceed. Launch each later `run` worker and every `orchestrate` job with `--runner <id> --live-console-url <url>` so activity appears in the already open viewer with per-job run IDs.
- Before yielding a user-input question, keep the standalone console process running and finalize its IAB tab with `status: handoff`; do not send Ctrl-C, close the tab, or discard the console URL. This applies to Git-initialization permission, target ambiguity, approval, authentication, scope, and other blocking questions.
- On the resumed turn, restore the Live Console before continuing project work: reuse the persistent terminal session, find and reclaim the handed-off IAB tab, and confirm the viewer is reachable. If the process or tab no longer exists, start a replacement console and open its viewer before intake, edits, or worker launch. Never resume headless merely because a console was opened in an earlier turn.
- After a runner result is recorded, inspect its final view but keep the standalone console available for any remaining work in the same activation. Stop the owned console terminal with Ctrl-C and wait for clean exit only when the task ends, the user stops it, or an explicit OFF transition requires shutdown.
- Direct CLI `run|orchestrate --runner <id>` without a URL starts an owned console by default and retains it after `live_console_run_finished: true` until SIGINT or SIGTERM. `--live-console-port <0-65535>` optionally selects its port, and explicit `--live-console` remains accepted but is unnecessary.
- `--no-live-console` and `--silent` are the only CLI OFF selectors. They are mutually exclusive with `--live-console`, `--live-console-port`, and `--live-console-url`. The external URL must use `http` on `127.0.0.1`, `localhost`, or `::1` and carry the generated token.
- Events use the versioned provider-neutral envelope `version`, `runId`, `sequence`, `timestamp`, `type`, `stream`, `text`, and `data`. The process runner owns child lifecycle and raw byte capture; the stream adapter owns event decoding; the server owns authenticated bounded transport/state; the viewer owns presentation only; the CLI coordinator only connects those outputs.
- Runner-brokered descendants emit `delegation.started`, `delegation.completed`, or `delegation.failed` on their own run IDs. Their event data and bounded snapshot state carry `parentRunId`, `depth`, `delegationMode`, and `focusScope`; the viewer presents them as child runs. Provider-private descendants that bypass the broker are not claimed as tracked lineage.
- `.cli-agent-runner/runner.md` remains the durable workflow/result record. Live Console history is deliberately in memory and bounded; do not promote it into a second workflow-state SSOT or persistent replay journal.
- A provider can expose only the activity it actually emits. Verify the provider-specific stream in the active environment before claiming that provider's live behavior; do not use successful Grok or fixture evidence to claim Claude-specific streaming.

## Debugging Integrity Gate

- When the active task is DEBUG, debug, bug fix, repair, test failure, regression, "not working", "expected result is not produced", or any equivalent failure-correction request, CLI Agent Runner must treat the goal as root-cause discovery and restoration of the intended outcome.
- Bug analysis must start from first principles: expected outcome, actual behavior, invariants, inputs, execution path, evidence, and competing hypotheses before selecting a fix.
- CLI Agent Runner must not accept log-only, error-message-only, exception-catch-only, skip-only, fallback-only, continue-only, return-to-main-loop-only, or failure-output-only changes as completed debug work.
- Error handling, logging, fallback, and graceful return behavior do not replace root-cause analysis. Fallback implementations that hide main-flow errors are prohibited as a repair route; if the user explicitly requests temporary containment, keep the unresolved root cause visible and do not claim completion.
- Debug assignments and handoff material must require the worker to identify the expected outcome, actual failure, reproduction path, failure point, competing hypotheses, root cause, fix, and verification that the intended outcome now works.
- The parent must reject or reassign any subagent result that claims completion without a root cause and outcome verification for a debug or repair task.
- The final CLI Agent Runner report for debug or repair work must separate root cause, fix, and verification. If root cause remains unknown, report the work as unresolved or temporary containment and name the next investigation step.
- Existing `.cli-agent-runner` state created before this gate is stale when `assignments.md`, `handoff.md`, `runner.md`, or runner packets lack the debugging integrity gate. Do not weaken validation to accept it; normalize the state explicitly with `normalize-debugging-integrity --execute` or regenerate it with intake before treating verification as current.

## Coding Conduct Gate

- CLI Agent Runner must treat these conduct rules as SSOT-level behavior for coding and debug work. Generated assignments, handoff material, runner prompts, runner packets, and validation must carry `coding_conduct_gate` and `coding_conduct_rules` fields for modern workflow state.
- If a mature open-source solution exists on GitHub or npm and fits the requirement, CLI Agent Runner must reuse it directly instead of reimplementing the solved problem. Dependency installation or package adoption still requires that dependency addition is inside the active scope, permitted by the repository policy, and approved when approval is required.
- When no mature GitHub/npm solution is reused, the worker must record the non-reuse reason: scope restriction, policy restriction, mismatch with requirements, security/licensing concern, dependency approval not granted, or no mature solution found.
- Bug analysis must begin from first principles before patching: intended contract, expected outcome, actual behavior, invariants, inputs, execution path, observations, and competing hypotheses.
- Fallback implementations are prohibited when they hide errors in the main flow, preserve a faulty premise, or allow completion to be claimed without fixing the intended path. The correct result is to fix the main flow or report unresolved status with the next investigation.
- A user-explicit temporary containment may be recorded only as containment, not as completion, and must leave the root cause, failing main flow, residual risk, and removal condition visible.

## Meta-Cognitive Debug/Repair Gate

- This gate is limited to actual debug, repair, failure-correction, source-of-truth correction, plugin-contract correction, or generated/cache/runtime inconsistency investigation. Ordinary source, config, test, canonical-document, and refactor work does not activate it by itself.
- The gate shapes the producer assignment for actual repair work; it is not a post-success report validator and never reopens a successful `run --runner` result or successful orchestration.
- For coding work, CLI Agent Runner still applies the Coding Conduct Gate's mature GitHub/npm reuse decision without turning that decision into a post-run acceptance gate.
- `--work-type <id>` is semantic command metadata for the source CLI, not a replacement for this gate or the Debugging Integrity Gate. Known ids are `auto`, `documentation`, `source-change`, and `debug`.
- `--work-type auto` preserves debug/repair keyword inference. `--work-type source-change` and `--work-type documentation` do not activate this gate; `--work-type debug` forces it for the producer assignment.
- CLI Agent Runner must treat gate-required work as context-impact work, not only local patch work. Result quality degrades when CLI Agent Runner stays local, so assignments, audits, handoffs, runner packets, and final reports must inspect before/after context effects and cross-feature consequences before claiming completion.
- Gate-required work must separate the intended contract, observed mismatch, affected source/generated/cache/runtime surfaces, changed assumptions, neighboring feature impact, before-context effects, after-context effects, cross-feature consequences, verification performed, skipped checks, unresolved risks, and next investigation.
- For an actual repair assignment, the worker identifies whether the mismatch is in source, generated workflow state, cache copy, runtime output, activation state, user request interpretation, or verification criteria before choosing the repair route.
- The parent must reject local-wrapper fixes that preserve a faulty premise. Before adding an adapter, compatibility branch, defensive return, default filler, or wrapper workflow, reconsider whether the selected route, source-of-truth, plugin contract, data model, generated artifact, cache/runtime surface, or verification target is wrong. Do not add fallback implementations that hide main-flow errors.
- Passive checklists, prose-only `debugging_integrity` text, log-only completion, fallback-only completion, skip-only completion, failure-output-only completion, hidden-fallback completion, avoidable reimplementation of mature OSS, and local-wrapper fixes without premise reconsideration are non-completion for gate-required work.
- If a gate-required assignment cannot inspect neighboring features or before/after context within its scope, it must report the skipped check, why it was skipped, the risk that remains, and the next investigation that would close the gap.

## Contract Coverage Gate

- This gate applies only when the parent explicitly invokes the manual `finalize` workflow. It is not part of the normal successful `run --runner` or orchestration path.
- The source CLI enforces `Contract Coverage Gate` on a distinct modern `task-finalization` packet belonging to the active `task_id` / `epoch` / `scope`.
- `collect` writes a `worker-result-collection` packet. A completed collection may include `finalization_references` relevant to that worker result, but it does not require complete task-wide D-*/C-*/source-spec coverage and may be repeated before finalization.
- `finalize` alone writes `task-finalization` and requires `contract_coverage`, `decision_coverage`, `completion_coverage`, and `source_spec_coverage`. The parent maps every active D-* accepted decision, every active C-* completion condition, and the source/spec check before task finalization.
- Accepted language-neutral typed reference forms are `file:<path>` or `path:<path>`, `command:<command> exit:<integer>`, `artifact:<ref>`, `packet:<collected-ref>` or `collected-packet:<ref>`, `role:<collected-role>` or `collected-role:<role>`, and `test:<name> result:<pass|fail|integer>`.
- Placeholder-only `done`, `checked`, or `ok` values remain rejected. `bin/cli-agent-runner.mjs` and its contract tests own all acceptance predicates; this skill names the command, fields, reference forms, and stop boundary without redefining validator logic.
- `verify-assignments` and `doctor` validate current-task `task-finalization` packets against the executable gate while preserving backward validation of legacy `parent-integration` packets. `normalize-debugging-integrity --execute` may add missing gate schema and mark stale completed packets unresolved, but it must not synthesize completion evidence.

## Subagent Operating Model

- Before assigning real work, initialize a fixed 14-role assignment scaffold for the job. This scaffold is a validation and routing structure, not proof that 14 resident agents or spawned workers are active.
- Treat actual specialist execution as assignment instances created later by the parent through available subagent tools or explicit runner packets.
- Every subagent assignment must include `task_id`, `epoch`, `scope`, `lifecycle`, and a finite hierarchy contract:
  - `hierarchy_mode: none` means the worker may not delegate or spawn descendants. Set `max_depth: 0`, `depth: 0`, and `remaining_depth: 0`.
  - `hierarchy_mode: one_level` means the assigned worker may create direct children only. Set `max_depth: 1`, `depth: 0`, and `remaining_depth: 1` for that worker; any direct child receives `depth: 1` and `remaining_depth: 0`.
  - `hierarchy_mode: n_level` means a bounded descendant chain is permitted. The parent must set a positive finite `max_depth`; the assigned worker receives the current `depth` and calculated `remaining_depth`, and each descendant receives incremented `depth` plus decremented `remaining_depth`.
  - Infinite or unbounded delegation depth is invalid. Missing or non-finite `max_depth`, `depth`, or `remaining_depth` is non-completion for delegated assignment material.
- For `run|orchestrate --runner grok-cli`, omission of all hierarchy fields resolves through the bundled profile to `hierarchy_mode: one_level`, `max_depth: 1`, `depth: 0`, and `remaining_depth: 1`. These fields permit Grok to create direct children; Grok owns the decision whether doing so materially helps, and its direct children receive no further delegation depth. Other bundled runners retain the zero-depth default.
- Treat this as a profile-generic responsibility boundary: the parent owns the maximum permitted depth; the assigned worker owns actual delegation within that ceiling. Preserve a declared profile default unless an admitted override reason is supplied. A current user request to disable descendants maps to `--hierarchy-mode none --hierarchy-override-reason user_request`; concrete safety, scope, or capability evidence uses its corresponding reason. Do not invent an override reason from task size, convenience, latency preference, or generic caution.
- A scoped assignment may also include `--feature-profile <id>`. Treat feature profiles as optional assignment overlays that add routing/debug guidance to that specific assignment instance; they are not additional scaffold roles, resident agents, spawned workers, or a substitute for `task_id`, `epoch`, `scope`, and `lifecycle`.
- Known feature profile ids are `debug.reproducer`, `debug.failure-boundary`, `debug.hypothesis-splitter`, `debug.fix-verifier`, `runner.scope-guard`, `plugin.activation-guard`, `source.cache-boundary`, and `workflow.state-safety`. Unknown ids must fail before `.cli-agent-runner/runner.md` is appended.
- A scoped assignment, worker-result-collection packet, intake, or runner command may also include `--work-type <id>`. Treat work types as command metadata for gate classification only; they are not roles, feature profiles, lifecycle states, or permission to weaken source-change/debug/root-cause requirements.
- Unknown work type ids must fail before `.cli-agent-runner/runner.md` is appended. Missing `work_type` in existing workflow state or packets means `auto`.
- Treat `task_id` as the unit of user-visible work, `epoch` as the restart boundary for stale context, and `scope` as the allowed file, tool, or investigation boundary.
- When a child worker is operating under a parent-managed CLI Agent Runner assignment, the parent has already selected CLI Agent Runner for that scoped assignment. The child worker must not ask `cli-agent-runner を使いますか？ [Y/n]` and must not start an independent nested CLI Agent Runner workflow. It may delegate descendants only when finite hierarchy fields grant `remaining_depth > 0`, while keeping the same `task_id`, `epoch`, `scope` lineage and inherited supervision. It proceeds directly within the assigned `task_id`, `epoch`, and `scope`, while still stopping before scope expansion, destructive operations, external sending, commits, cache refresh, plugin activation, or unrelated edits.
- A worker with `delegation_mode: local_orchestrator` must use the supplied broker command for descendant execution and wait for each requested result before returning its integrated output. It must not directly spawn another Codex, Claude, Grok, custom runner, or independent CLI Agent Runner workflow. A worker with `delegation_mode: leaf` has no broker access and must complete the assignment without descendants.
- Nested descendants inherit the parent supervision and cancellation rules and cannot broaden scope, depth, permissions, allowed tools, external side effects, cache refresh, plugin activation, destructive operations, or Git history permissions. A descendant may narrow scope or use less depth; it must not increase `remaining_depth` or claim a broader `max_depth` than the parent granted.
- Reuse of a subagent context is an exception. The default workflow-state action after a meaningful task boundary, stale premise, scope change, or failed verification is a fresh assignment or `state_retired`.
- A subagent must return concise worker-result material: findings, changed files or proposed changes, verification notes, blockers, and unresolved assumptions.
- Generated assignments and runner prompts require the worker to return concise typed references relevant to its own result for parent finalization. The worker does not own complete task-wide D-*/C-*/source-spec coverage.
- A subagent must stop after returning integration material. It must not stay open waiting for more work; any continuation requires a fresh explicit assignment or an intentional parent-managed reuse decision.
- When a subagent reaches `hard_timeout` after the stale path, fails, reports a blocker, violates scope, or becomes stale because the premise or scope changed, record `state_retired` with an allowed `cancel_reason` before issuing any replacement assignment.
- If the current environment has no callable subagent mechanism, state that limitation in the work log, keep the role scaffold in the plan, and proceed only with parent-side work that the user requested or that the active environment can perform.

## Subagent Supervision And Cancellation

- Long-running assignments, delegated assignments, and any assignment that may remain quiet while doing valid work must include a supervision block with `heartbeat_interval`, `heartbeat_deadline`, `max_silence`, `soft_timeout`, `hard_timeout`, `no_interrupt_until`, and `cancel_reason_required: true`.
- `heartbeat_interval` is the expected cadence for status telemetry. `heartbeat_deadline` is the first time a missing heartbeat becomes actionable. `max_silence` is the longest allowed silence after grace handling. `soft_timeout` starts status inquiry and reassessment. `hard_timeout` is the outer stop boundary. `no_interrupt_until` is the earliest time the parent may interrupt, mark workflow `state_retired`, replace, or cancel for silence unless a higher-priority safety, user, or scope violation reason applies.
- A long-running worker that is still running at `heartbeat_interval` must self-report progress without waiting for parent polling. The report must include completed work, current step, blocker status using `blocker: none` when unblocked, and ETA using `ETA: unknown` when unknown.
- Silence before `heartbeat_deadline` or before `no_interrupt_until` is neutral. It must not trigger cancellation, interruption, workflow `state_retired`, replacement, reassignment, or negative scoring by itself.
- Completed, blocked, failed, or otherwise terminal worker output is an observed result, not heartbeat silence. A successful `run --runner` result or successful orchestration stops immediately; explicitly managed collection workflows record lifecycle disposition only for their own collected results.
- Heartbeats and progress reports are telemetry only. They are not completion evidence, verification evidence, root-cause evidence, or permission to broaden scope.
- `state_retired` must record exactly one allowed `cancel_reason`: `completed_retire`, `user_stop`, `safety_stop`, `scope_violation`, `stale_timeout`, `blocker_or_failure`, or `stale_premise`. `continuation_expected` must record `cancel_reason: none`; the CLI rejects a supplied cancel reason for that disposition.
- `completed_retire` is valid only after the parent has integrated the worker's result or explicitly decided no further use is expected. Use `user_stop` only for explicit user stop or redirect. Use `safety_stop` for policy, privacy, destructive, external-send, authentication, cost, or permission risk. Use `scope_violation` when the worker exceeds assignment boundaries. Use `stale_timeout` only after the stale path below has completed. Use `blocker_or_failure` when the worker reports an actionable blocker or failed result. Use `stale_premise` when the parent premise, scope, or accepted decision changed and continuing that context would mislead the task.
- Before cancelling or replacing a quiet worker for staleness, the parent must follow this path: missed heartbeat after `heartbeat_deadline` -> soft ping or status request -> grace wait until the configured grace point or `max_silence` boundary -> mark stale -> cancel or replace only if the worker is still silent, returns invalid status, violates scope, or is past `hard_timeout`.
- A missed heartbeat, sparse progress, or long-running silence is not a blocker and not a failed result until the stale path or another allowed cancellation reason establishes that state.
- Parent ownership remains intact throughout supervision. The parent owns policy, cancellation judgment, workflow-state disposition, any separate runtime action, replacement assignment, result acceptance, and final integration; workers and descendants provide telemetry and integration material but do not set final lifecycle policy themselves.

## Workflow State Files

- `<git-root>/.cli-agent-runner/README.md`: reader order and role map for Codex-facing workflow files.
- `<git-root>/.cli-agent-runner/project.md`: project intake summary for the jobsite itself.
- `<git-root>/.cli-agent-runner/task.md`: current task SSOT, including purpose, scope, semantic `work_type`, non-goals, completion conditions, permitted hierarchy mode, and supervision defaults when the task uses long-running or delegated assignments.
- `<git-root>/.cli-agent-runner/todo.md`: executable checklist with stable task IDs.
- `<git-root>/.cli-agent-runner/decisions.md`: accepted decisions with IDs and implementation impact.
- `<git-root>/.cli-agent-runner/audit.md`: audit log, completed checks, skipped checks, next audit needs, debug root-cause verification when the task is a debug or repair task, context-impact or cross-feature checks when the Meta-Cognitive Debug/Repair Gate fires, and any subagent cancellation with its allowed reason and stale-path evidence.
- `<git-root>/.cli-agent-runner/assignments.md`: fixed 14-role assignment scaffold. Each scaffold section must include `role`, `status`, `task_id`, `epoch`, `scope`, `assignment`, `expected_output`, `coding_conduct_gate`, `coding_conduct_rules`, Contract Coverage Gate schema, and `lifecycle`; it is not proof that 14 workers are active and must not grow dynamic roles for feature profiles. Long-running or delegated assignment sections must include finite hierarchy fields and supervision fields. Debug or repair tasks must also carry the debugging integrity gate, and gate-required work must carry the Meta-Cognitive Debug/Repair Gate.
- `<git-root>/.cli-agent-runner/handoff.md`: prompt material for the next worker to continue the task, including the subagent rule to return concise integration material and result-relevant typed references, preserve finite delegation depth, inherit supervision and cancellation rules, avoid interrupting quiet workers before heartbeat deadlines, record workflow-state lifecycle disposition on collection, leave task-wide Contract Coverage and `finalize` to the parent, enforce the Coding Conduct Gate, reject log-only or fallback-only debug completion, and include context-impact inspection plus cross-feature checks for gate-required work.
- `<git-root>/.cli-agent-runner/runner.md`: conditional operational log for `assign`, `collect`, `finalize`, `run`, `orchestrate`, worker-result-collection packets, task-finalization packets, process results, and backward-readable legacy parent-integration packets. Current task state and new worker-result-collection packets record `lifecycle_contract_version: workflow_state_v1`; collection packets also record `lifecycle_scope: workflow_state_only`, `lifecycle_disposition`, `cancel_reason`, `runtime_thread_disposition: unmanaged_by_workflow_cli`, and `runtime_changed: false`. The validator rejects fieldless current collection packets and accepts `unknown_legacy` only for verifiably pre-contract state without synthesizing retirement. Create or update `runner.md` only when runner activity occurs; do not require it for intake, specification, documentation-only, or audit flows with no runner activity.

## Legacy `docs/codex`

- Treat `docs/codex` as legacy workflow material and migration source only.
- Read legacy `docs/codex` during intake when present so existing task, decision, assignment, audit, and runner context can be preserved intentionally.
- Do not silently delete, move, rewrite, or continue active workflow state in `docs/codex`.
- Migration apply is a separate workflow. Default to dry-run, create a preflight backup before destructive or move-like actions, and apply only after explicit user confirmation.

## Source CLI MVP Workflow

Use the source CLI when the user wants to test source-tree behavior before plugin cache activation, or when the active task is a source upgrade of the CLI Agent Runner plugin itself.

1. Record `invocation_cwd` as the launch directory.
2. Resolve the target jobsite path. Use `--target-cwd <jobsite>` for explicit cross-repo target selection; if no target is provided, use `invocation_cwd` as the jobsite.
3. Resolve the jobsite Git root. Confirm the jobsite repository's `<git-root>/.cli-agent-runner/` as the workflow state root before state writes.
4. Ensure the jobsite repository's `.git/info/exclude` ignores `.cli-agent-runner/`; do not edit tracked `.gitignore` unless explicitly requested.
5. Run intake with explicit isolation keys and optional semantic work metadata:
   `node "<plugin-root>/bin/cli-agent-runner.mjs" intake --target-cwd <jobsite> --work-type <auto|documentation|source-change|debug> --task <task> --task-id <id> --epoch <epoch> --scope <scope>`.
6. Run doctor:
   `node "<plugin-root>/bin/cli-agent-runner.mjs" doctor --target-cwd <jobsite>`.
7. Print handoff when needed:
   `node "<plugin-root>/bin/cli-agent-runner.mjs" handoff --target-cwd <jobsite> --task-id <id>`.
8. If pre-existing `.cli-agent-runner` state lacks the debugging integrity gate, run dry-run first:
   `node "<plugin-root>/bin/cli-agent-runner.mjs" normalize-debugging-integrity --target-cwd <jobsite>`.
   Apply only after confirming the target state directory:
   `node "<plugin-root>/bin/cli-agent-runner.mjs" normalize-debugging-integrity --target-cwd <jobsite> --execute`.
9. For `assign`, `collect`, `finalize`, `run`, or `orchestrate`, record operational packets in the jobsite repository's `.cli-agent-runner/runner.md`. Use `--feature-profile <id>` only as an optional scoped overlay for that assignment instance, and keep missing profiles as `feature_profile: none`. Use `--work-type <id>` only as semantic command metadata for gate classification, and keep missing work types as `work_type: auto`.
   For `collect`, pass exactly one lifecycle disposition: use `--lifecycle-disposition state_retired --cancel-reason <allowed-reason>` when the workflow will not continue with that context, or `--lifecycle-disposition continuation_expected` without `--cancel-reason` when explicitly scoped continuation remains necessary. A completed collection records that worker result without task-wide Contract Coverage; pass `--finalization-references <typed-refs>` when result-relevant references are available. Do not pass or infer `runtime_thread_closed`; every CLI command rejects that flag because the workflow CLI cannot establish runtime closure.
   After integrating worker results and assembling complete task-wide coverage, run:
   `node "<plugin-root>/bin/cli-agent-runner.mjs" finalize --target-cwd <jobsite> --task-id <id> --epoch <epoch> --scope <scope> --work-type <auto|documentation|source-change|debug> --contract-coverage required --decision-coverage <D-coverage> --completion-coverage <C-coverage> --source-spec-coverage <typed-ref>`.
   `finalize` validates all active D-*/C-*/source-spec coverage before appending the distinct `task-finalization` packet. If validation fails, stop and correct the evidence; do not treat worker collection as task completion.
   When `run --runner <id>` is used, treat `--scope` as runner machine input:
   - Stop before appending `.cli-agent-runner/runner.md` or launching the runner when `--scope` is empty, ambiguous prose, negative/exclusion wording, or otherwise not machine-checkable.
   - Use quoted `--scope "scope:v1 all"` for the whole repo.
   - Use quoted `--scope "scope:v1 paths=README.md,bin/cli-agent-runner.mjs,tests/"` for an affirmative comma-separated repo-relative prefix list.
   - Accept absolute paths only when they resolve inside the target cwd, then normalize them to repo-relative prefixes.
   - Preserve legacy runner compatibility only for simple path-only values such as `README.md`, `allowed/`, `bin/cli-agent-runner.mjs tests/workflow-state.test.mjs`, plus whole-repo aliases `.`, `repo`, and `whole repo`.
   - Keep broader human prose scopes for intake, assign, and collect rather than runner execution.
   For `orchestrate --runner <id> --jobs-file <json>`, keep task identity at the top level and require a version-1 jobs file. Every job's `ownerScope` must be machine-checkable, non-overlapping with every concurrently writable job, and paired with a stable handoff; do not encode task identity or hierarchy permission as a job substitute.
   Unless the user explicitly selected silent/no-console/OFF operation, the standalone `live-console --port 0` session and IAB viewer must already be active from skill selection. Reuse its tokenized URL with `run --runner <id> --live-console-url <url>` or `orchestrate --runner <id> --jobs-file <json> --live-console-url <url>` and keep the console available until the task ends. Orchestration jobs share that console and emit per-job run IDs. For direct CLI use without a prestarted URL, `run` and `orchestrate` own a console by default. Use `--no-live-console` or `--silent` only for the explicit OFF path. This is a plugin-owned route, not a separate AgentScope dependency.
   When `run --runner <id>` exits zero and the scope guard passes, or all declared orchestration jobs succeed in scope, the process result is complete and terminal. Store the minimal completed result and do not invoke `collect`, `finalize`, `verify-assignments`, `doctor`, reviewer, or another post-success validator.
   Use `--delegation-mode local_orchestrator` only when the assigned worker owns a coherent responsibility whose bounded internal helper split remains local to that worker. The prompt exposes the worker-only `delegate` command. Do not invoke `delegate` from the parent shell; it fails closed without the runner-owned broker environment.
10. Ensure generated assignments and runner prompts carry the known producer requirements before launch. A successful `run --runner` result or successful orchestration bypasses every collection, lifecycle, Contract Coverage, and metacognitive post-success gate. Failed or blocked output bypasses the quiet-worker stale path and enters only cause-bound failure handling.
11. Treat marketplace registration, `~/.codex/plugins/cache/` refresh, and Codex restart/new-thread activation as separate work unless the user explicitly includes them.

If source CLI output still names legacy `docs/codex`, treat that as source implementation drift to report or fix under the active task scope. Do not let legacy output redefine the current skill contract.

## Workflow

1. Unless the current user explicitly selected silent/no-console/OFF operation, start one standalone Live Console in a persistent terminal and open its viewer in Codex IAB. Only after it is visibly standing by, record `invocation_cwd` and resolve the jobsite from the explicit target (`--target-cwd`, user-named project root, or task-owned target path) or from cwd when no target is named. A user-input pause keeps both the process and tab alive with an IAB handoff disposition.
2. If target selection or authorization remains ambiguous, stop before edits or workflow state writes and ask the user while the console stays open. When the user answers, reclaim and verify that console first; reopen it before continuing if either the process or tab was lost.
3. Resolve the jobsite repository's `<git-root>` and run project intake before editing: repository status, applicable instructions, current `.cli-agent-runner` state, `.git/info/exclude` status, legacy `docs/codex` migration input, source/cache boundaries, and risk level.
4. Before workflow state writes, create or update the jobsite repository's local `.git/info/exclude` entry for `.cli-agent-runner/` when missing. Do not update tracked `.gitignore`.
5. Create or update the active `.cli-agent-runner` files before implementation when workflow state is missing or stale.
6. Initialize the fixed 14-role assignment scaffold with `task_id`, `epoch`, `scope`, `lifecycle`, finite hierarchy fields, and supervision defaults for long-running or delegated work; create actual specialist assignments only when scoped work is dispatched. Do not add roles for feature profiles.
7. Execute or coordinate work according to `.cli-agent-runner/todo.md`.
8. Record user-confirmed decisions in `.cli-agent-runner/decisions.md` and update `.cli-agent-runner/task.md` when scope changes.
9. Create or update `.cli-agent-runner/runner.md` only for `assign`, `collect`, `finalize`, `run`, `orchestrate`, worker-result collection, task finalization, or process-result activity. Keep existing legacy `parent-integration` packets readable for backward validation; do not describe them as newly emitted packets.
10. Normalize stale pre-gate `.cli-agent-runner` state with `normalize-debugging-integrity` before relying on `verify-assignments` or `doctor` results.
11. For failure, blocker, stale-premise, or scope-change handling in an explicitly managed collection workflow, record `state_retired` or `continuation_expected` as appropriate. Do not apply this step after a successful `run --runner` result or successful orchestration.
12. Run only the verification required by the current user request or the selected explicit manual workflow. A successful `run --runner` result or successful orchestration does not authorize task-finalization Contract Coverage or another acceptance pass.
13. Before the final report for an explicit collection/finalization workflow, confirm only the lifecycle and coverage packets that workflow requested. Skip this step for the normal successful runner path.
14. Update `.cli-agent-runner/audit.md` only when the user or an explicit audit workflow requires it; do not create a post-success audit automatically.
15. Report final status with changed files, verification, open risks, and next TODOs.

## File Boundaries

- Edit jobsite files only inside the active task scope.
- In cross-repo invocation, do not edit the invocation repository merely because Codex or the source CLI was launched there. Edit the invocation repository only when it is also the resolved jobsite or is explicitly inside the active task scope.
- Treat plugin source directories as source of truth. Do not patch `~/.codex/plugins/cache/` as the primary edit target.
- Do not edit `~/.codex/plugins/cache/`, marketplace files, or plugin activation state unless the user explicitly includes that in the active task scope.
- Do not auto-edit tracked `.gitignore` to hide `.cli-agent-runner/`. Use target `.git/info/exclude` for the local workflow-state ignore rule.
- Do not edit legacy `docs/codex` as active workflow state. Edit it only when the active task is an explicit migration, cleanup, or legacy-document maintenance task.
- Preserve unrelated user or worker changes. If another change appears in scope, work around it or report the conflict; do not revert it.
- The CLI uses Node.js standard libraries only. Do not add dependencies to run intake, runner configuration, handoff, or doctor.

## Source And Cache Boundary

- Source repository changes take effect for direct source CLI runs immediately.
- Installed plugin behavior uses the cached plugin copy under `~/.codex/plugins/cache/` and may require a refresh plus Codex restart or a new thread before the updated skill, agent metadata, CLI, or assets are active.
- Refresh cache only from validated source and only for the named plugin in scope. Do not refresh broadly or edit cache files directly.
- When cache activation is out of scope, report that source is updated but plugin activation is pending cache refresh/restart.

## Output Shape

Return concise parent-facing status in the user's language. For a successful `run --runner` result or successful orchestration, report completion from the terminal process result without a second validator narrative. For failed or explicitly managed collection/finalization workflows, include only the relevant changed files, verification, blockers, and unresolved work. Keep raw worker logs out of the final answer unless the user asks for them.
