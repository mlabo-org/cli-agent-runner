# CLI Agent Runner Self-Change And Legacy Cleanup Spec

This document is a tracked source specification for confirmed CLI Agent Runner
behavior. It is not workflow state and must not be treated as a generated
`docs/codex` log.

## Confirmed Boundary

Items 1-11 are CLI Agent Runner self changes. Item 12 is external legacy cleanup.

1. State directory
   - CLI Agent Runner runtime/workflow state belongs under `<git-root>/.cli-agent-runner/`.
   - The state directory is resolved from the jobsite/target repository git root,
     not from the invocation repository or plugin source repository unless that
     repository is also the target.
   - `invocation_cwd` is the directory where Codex or the source CLI was launched.
     `jobsite`, `target cwd`, and `target-cwd` identify the repository being
     planned, repaired, edited, or audited.
   - If no target is named, `invocation_cwd` remains the jobsite. This preserves
     the default `cwd is jobsite` behavior.
   - If the user names another target, or the CLI receives `--target-cwd <path>`,
     the named target becomes the jobsite and owns `.cli-agent-runner/`.
   - If target selection or the target git root is ambiguous, missing, outside
     the active scope, or unresolved, stop before edits or workflow state writes
     and ask for the intended target.

2. Git non-pollution
   - Generated local state must avoid polluting the target repository.
   - Use the target repository's `.git/info/exclude` for local ignore rules.
   - Do not broaden tracked `.gitignore` files just to hide CLI Agent Runner local
     state unless the user explicitly asks for that repository policy change.

3. Conditional runner log
   - `runner.md` is an operational log, not a universal required source document.
   - Create or update it only when runner, assignment dispatch, worker-result
     collection, task-finalization, or process-result activity actually occurs.
   - Existing legacy `parent-integration` packets remain readable for backward
     validation; new commands do not emit that legacy packet type.
   - Do not require `runner.md` for unrelated intake/spec/documentation flows.

4. Subagent workflow-state lifecycle
   - Subagents must return concise worker-result material and must not stay
     open waiting for more work after returning it.
   - `collect` requires `--lifecycle-disposition state_retired` or
     `--lifecycle-disposition continuation_expected`. `state_retired` requires
     exactly one allowed `--cancel-reason`; `continuation_expected` rejects a
     cancel reason and records `cancel_reason: none`.
   - Current task state records `lifecycle_contract_version: workflow_state_v1`
     and `lifecycle_contract_effective_at`. New `worker-result-collection`
     packets record the same lifecycle contract version,
     `lifecycle_scope: workflow_state_only`, the selected
     `lifecycle_disposition`, `cancel_reason`,
     `runtime_thread_disposition: unmanaged_by_workflow_cli`, and
     `runtime_changed: false`.
   - These fields describe workflow state only. The CLI must not emit or accept
     `runtime_thread_closed: true`, and interruption or process exit is not
     runtime-thread closure evidence.
   - Fieldless current packets are invalid. Pre-contract workflow state and
     non-current packets that predate the recorded activation time remain
     `unknown_legacy`; normalization and validation must not synthesize a
     retirement decision for them.
   - Generated assignments, runner prompts, runner packets, and handoff material
     must carry this lifecycle rule so future job state preserves it.

5. Subagent supervision and finite delegation depth
   - Delegation hierarchy must be finite. Valid modes are `none`, `one_level`,
     and `n_level`.
   - `none` means no descendant delegation and requires `max_depth: 0`,
     `depth: 0`, and `remaining_depth: 0`.
   - `one_level` permits direct children only. The assigned worker receives
     `max_depth: 1`, `depth: 0`, and `remaining_depth: 1`; its direct children
     receive `depth: 1` and `remaining_depth: 0`.
   - `n_level` permits a bounded descendant chain only when the parent provides
     finite `max_depth`, current `depth`, and calculated `remaining_depth`.
   - Every subagent assignment must include the finite hierarchy fields. Infinite
     or unbounded depth is invalid. Descendants inherit supervision,
     cancellation, scope, depth, and permission limits and may narrow but never
     broaden them.
   - Hierarchy fields define the parent-owned maximum permission ceiling. They
     do not instruct a worker to delegate. A worker with remaining depth decides
     whether descendants materially improve its assigned work; a worker with no
     remaining depth must not delegate.
   - The parent owns permission to delegate, maximum depth, concurrency, time,
     budget, operation scope, and child permission-inheritance boundaries. The
     assigned worker owns the decision whether to delegate inside those limits.
     CLI Agent Runner must transmit the resolved policy without independently
     deciding that delegation is unnecessary.
   - Any runner profile may declare `defaultHierarchyDepth`. When hierarchy
     fields are omitted, that profile value supplies the permission ceiling
     through the common runner path. The bundled Grok profile declares one
     direct-child level; bundled Codex and Claude retain the zero-depth workflow
     default. Model-specific delegation suitability must be expressed as profile
     configuration, including an explicit zero ceiling when appropriate, rather
     than as an unrecorded per-run parent override.
   - Explicit hierarchy fields that replace a declared profile default require
     one admitted `hierarchy_override_reason`: `user_request`,
     `safety_boundary`, `scope_boundary`, or `capability_boundary`. Missing or
     invalid reason evidence must fail before assignment state is appended or a
     child process launches. Restating the same profile ceiling is not an
     override and must not require or accept an override reason.
   - Long-running or delegated assignments must carry supervision fields:
     `heartbeat_interval`, `heartbeat_deadline`, `max_silence`,
     `soft_timeout`, `hard_timeout`, `no_interrupt_until`, and
     `cancel_reason_required: true`.
   - Silence before `heartbeat_deadline` or `no_interrupt_until` is neutral and
     must not trigger cancellation, interruption, workflow `state_retired`,
     replacement, or reassignment by itself.
   - Heartbeats and progress reports are telemetry only. They are not completion
     evidence, verification evidence, root-cause evidence, or permission to
     broaden scope.
   - A `state_retired` workflow disposition must record exactly one allowed
     reason: `completed_retire`, `user_stop`, `safety_stop`, `scope_violation`,
     `stale_timeout`, `blocker_or_failure`, or `stale_premise`.
   - Cancellation for quiet staleness must follow this path: missed heartbeat,
     soft ping or status request, grace wait, stale mark, then cancel or replace
     only if the worker remains silent, returns invalid status, violates scope,
     or crosses the hard timeout.
   - The parent retains policy, cancellation judgment, replacement assignment,
     final result acceptance, and final integration.

6. Debugging integrity
   - Debug or repair work is complete only when the root cause is identified,
     fixed, and verified against the intended outcome.
   - Bug analysis must start from first principles: expected outcome, actual
     behavior, invariants, inputs, execution path, evidence, and competing
     hypotheses before selecting a fix.
   - Log-only, error-message-only, exception-catch-only, skip-only,
     fallback-only, failure-output-only, and return-to-main-loop-only changes are
     temporary containment at most and must not be accepted as debug completion.
   - Fallback implementations that hide main-flow errors are prohibited as a
     repair route. A user-explicit temporary containment may be recorded only as
     containment, with unresolved root cause, failing main flow, residual risk,
     and removal condition visible.
   - Generated assignments, runner prompts, runner packets, audit material, and
     handoff material must carry this debugging integrity rule so delegated work
     preserves it.
   - Existing `.cli-agent-runner` state that predates this rule is stale when
     assignments, handoff material, runner docs, or runner packets lack the
     debugging integrity gate. Validation must not be weakened to accept stale
     state; use an explicit normalization command or regenerate intake state.

7. Meta-Cognitive Debug/Repair Gate
   - Debug, repair, source-of-truth correction, plugin-contract correction,
     generated-artifact inconsistency investigation, generated state versus
     source mismatch, cache/runtime versus source mismatch, and stale contract
     repair are context-impact work, not only local patch work.
   - Assignments, audits, handoffs, runner packets, and final reports for this
     gate must separate the intended contract, observed mismatch, affected
     source/generated/cache/runtime surfaces, changed assumptions, neighboring
     feature impact, before-context effects, after-context effects,
     cross-feature consequences, verification performed, skipped checks,
     unresolved risks, and next investigation.
   - Result quality degrades when CLI Agent Runner stays local. The workflow must
     inspect before/after context effects and cross-feature consequences before
     claiming completion for gate-required work.
   - Passive checklists, prose-only `debugging_integrity`, log-only completion,
     fallback-only completion, skip-only completion, failure-output-only
     completion, hidden-fallback completion, avoidable reimplementation of
     mature OSS, and local-wrapper fixes without premise reconsideration are
     non-completion for gate-required work.
   - If neighboring feature or before/after context checks cannot be completed
     inside the active scope, the skipped checks, reason, remaining risk, and
     next investigation must be recorded instead of treating the gate as passed.

8. Coding Conduct Gate
   - Coding and debug work must carry a machine-visible Coding Conduct Gate in
     generated assignments, runner prompts, runner packets, handoff material,
     and validation for modern workflow state.
   - If a mature open-source solution exists on GitHub or npm and fits the
     requirement, CLI Agent Runner must reuse it directly instead of
     reimplementing the solved problem.
   - Dependency installation or package adoption still requires that dependency
     addition is inside the active scope, permitted by repository policy, and
     approved when approval is required.
   - When no mature GitHub/npm solution is reused, the worker must record the
     non-reuse reason: scope restriction, policy restriction, mismatch with
     requirements, security/licensing concern, dependency approval not granted,
     or no mature solution found.
   - Bug analysis must begin from first principles before patching: intended
     contract, expected outcome, actual behavior, invariants, inputs, execution
     path, observations, and competing hypotheses.
   - Fallback implementations are prohibited when they hide errors in the main
     flow, preserve a faulty premise, or allow completion to be claimed without
     fixing the intended path. The correct result is to fix the main flow or
     report unresolved status with the next investigation.
   - User-explicit temporary containment remains allowed only as containment,
     not completion, and must leave the failing main flow and removal condition
     visible.

9. Worker-result collection and task finalization
   - `expected_output` owns any explicitly declared worker-response shape. The
     generated sectioned worker-result format is a fallback only when
     `expected_output` does not define a response format. Applicable gate content
     and result-relevant typed references must be represented within an explicit
     response shape; an impossible combination is a reported contract blocker,
     not permission to choose silently between competing formats.
   - `collect` records a `worker-result-collection` packet plus its
     workflow-state-only lifecycle disposition. Completed collection does not
     require complete task-wide D-*/C-*/source-spec coverage, and multiple
     worker results may be collected before the task is finalized.
   - A collection may carry `finalization_references` relevant to that worker's
     result. Generated assignment and runner prompts ask workers for concise
     typed references, while the parent owns the complete task-wide map.
   - `finalize` is the only command that records a modern
     `task-finalization` packet. It requires the current `task_id`, `epoch`, and
     `scope`, validates complete active decision, completion-condition, and
     source/spec coverage, and appends the packet only after validation passes.
   - Language-neutral typed references accepted by this contract are
     `file:<path>` or `path:<path>`, `command:<command> exit:<integer>`,
     `artifact:<ref>`, `packet:<collected-ref>` or
     `collected-packet:<ref>`, `role:<collected-role>` or
     `collected-role:<role>`, and
     `test:<name> result:<pass|fail|integer>`.
   - Placeholder-only `done`, `checked`, and `ok` values remain invalid.
     `bin/cli-agent-runner.mjs` and its contract tests own the acceptance
     predicates; this specification records the command boundary and artifact
     contract rather than replacing executable validation.
   - `verify-assignments` and `doctor` validate modern task-finalization
     packets. Legacy `parent-integration` packets remain readable for backward
     validation, and the strict lifecycle rules remain attached to modern
     worker-result collections rather than task-finalization packets.

10. Nested CLI Agent Runner preflight suppression
   - Parent-managed child workers operate under a CLI Agent Runner assignment that
     the parent already selected.
   - Generated assignments, runner prompts, runner packets, and handoff material
     must tell child workers not to ask `cli-agent-runner を使いますか？ [Y/n]` and
     not to start independent nested CLI Agent Runner workflows inside the assigned
     `task_id`/`epoch`/`scope`.
   - Descendant delegation is allowed only when finite hierarchy fields grant
     `remaining_depth > 0`, and it must preserve the same task, epoch, scope
     lineage, inherited supervision, and cancellation rules.
   - This suppression does not authorize scope expansion, destructive
     operations, external sending, commits, cache refresh, plugin activation, or
     unrelated edits.
   - Nested descendants also inherit the finite delegation depth and supervision
     contract. They cannot broaden scope, depth, permissions, or cancellation
     authority.
   - Every assignment resolves `delegation_mode` to exactly `leaf` or
     `local_orchestrator`. `leaf` requires zero remaining depth and exposes no
     descendant route. `local_orchestrator` requires positive remaining depth
     and receives a runner-owned, token-protected loopback broker.
   - Descendants must be launched through the broker rather than through a
     provider-specific execution branch or an independent nested workflow. The
     broker inherits task identity, epoch, configured runner profile, authority
     scope, supervision, Live Console transport, and decremented hierarchy
     fields. Every descendant ID is unique within its immediate orchestrator;
     sibling `focus_scope` values must remain within the immediate delegator's
     authority and must not overlap. The broker confines concurrent descendants
     to the collective declared focus set in the repository scope guard.
   - The worker-only `delegate` client cannot select a target cwd, task identity,
     runner profile, authority scope, hierarchy ceiling, or Live Console URL.
     It fails closed outside a broker-injected worker process.

11. Configurable CLI runner registry and Live Console
   - Standard runner profiles are `codex-cli`, `claude-cli`, and `grok-cli`.
     Their source-owned definitions live in `config/runners.default.json`; the
     process executor must not hard-code provider branches.
   - Users may add new runner IDs or override standard profile fields through
     versioned runner JSON. Configuration precedence is bundled defaults, user
     config, `CLI_AGENT_RUNNER_CONFIG`, then `--runner-config`. Jobsite
     `.cli-agent-runner/` remains workflow state and must never be loaded as an
     executable configuration source.
   - A resolved profile consists of a direct executable, an argument array,
     prompt transport, result source, stream format, optional timeout, and
     optional validated `defaultHierarchyDepth` permission ceiling.
     Supported stream formats are `text`, `ndjson`, and `messages-json`.
     Supported argument placeholders and config validity are enforced by
     `lib/runner-registry.mjs` and its contract tests.
   - Runner commands are spawned asynchronously without a shell, always use the
     jobsite as process cwd, inherit the current environment, and share the
     existing timeout, bounded-output, fail-closed post-run Git scope check,
     and normalized
     `process-runner-result` path.
   - The local delegation broker is profile-generic. Explicit
     `--delegation-mode local_orchestrator` supplies one direct-child level when
     a selected profile has no hierarchy default, so Codex, Claude, Grok, and
     custom runners use the same mechanism without provider-ID branches.
   - Stream decoding is selected by the profile, never by a provider-ID branch.
     The bundled Grok profile uses its Anthropic Messages-compatible streaming
     JSON output and the `messages-json` adapter reconstructs assistant text for
     the existing stdout result source.
   - `live-console` starts a plugin-owned HTTP server bound to `127.0.0.1` and
     prints a tokenized viewer URL suitable for Codex IAB. The server owns
     authenticated ingest, snapshot and SSE delivery, static viewer assets, and
     bounded ephemeral run history. It must not depend on AgentScope or private
     Codex GUI IPC.
   - Live Console is default-on. At skill selection, before target intake,
     assignment construction, or worker launch, the parent plugin skill starts
     one standalone `live-console --port 0` session, opens its tokenized viewer
     URL in supported Codex IAB, and keeps the server ready for later runners.
   - The normal plugin-owned runner path uses
     `run --runner <id> --live-console-url <url>` to reuse that already visible
     console. The parent owns persistent-terminal launch, supported IAB opening,
     pause/resume continuity, final observation, and cleanup when the task
     actually ends or the user stops it.
   - A blocking permission, approval, clarification, or target-selection
     question is an in-progress pause. The parent keeps the console process
     running and hands off the IAB tab instead of closing either surface.
   - On resume, the parent reclaims and checks the handed-off viewer before
     continuing. If the process or tab was lost, it starts and opens a
     replacement before intake, edits, or worker launch; resuming headless is
     not allowed.
   - Direct `run|orchestrate --runner <id>` owns a Live Console by default when
     no prestarted URL or explicit OFF selector is supplied. It starts the secure
     server before assignment append or worker launch, injects its ingest URL,
     emits stable viewer and completion markers, retains the final view, and
     closes the server after SIGINT or SIGTERM. `--live-console` remains accepted
     as an optional explicit compatibility spelling.
   - `--no-live-console` and `--silent` are the only CLI OFF selectors. They are
     mutually exclusive with `--live-console`, `--live-console-port`, and
     `--live-console-url`. Absence of a console request never selects OFF.
   - Failure to start or open the default console blocks target intake and worker
     launch. It must remain visible as a console failure and must not be treated
     as an implicit OFF request or hidden fallback.
   - `run --runner <id> --live-console-url <url>` publishes a versioned,
     provider-neutral envelope with `version`, `runId`, `sequence`, `timestamp`,
     `type`, `stream`, `text`, and `data`. The parent Codex session owns opening
     the printed localhost URL in IAB.
     This is the default plugin standby-console handoff and remains available for
     manually managed consoles; it is mutually exclusive with explicit owned or
     OFF selectors. The CLI must not use private Codex GUI IPC.
   - Live Console transport is observation, not workflow state or artifact
     acceptance. `.cli-agent-runner/runner.md` remains the durable result record;
     a transport failure is reported separately from child execution status.
   - Brokered descendants publish on independent run IDs with
     `delegation.started`, `delegation.completed`, or `delegation.failed` events.
     Their event data and snapshot metadata carry `parentRunId`, `depth`,
     `delegationMode`, and `focusScope`. Provider-private descendants that bypass
     the broker are not tracked lineage.
   - An exit-zero, in-scope process runner result is terminal. Record one
     minimal `process-runner-result` with `status: completed`, runner identity,
     exit code, and summary.
   - Successful process results do not have a second worker-report conformance
     status, parent-acceptance-pending state, mandatory follow-up collection,
     task finalization, or post-success validator chain.
   - Missing explicitly selected config, invalid JSON or profiles, unknown
     runner IDs, invalid timeout, and non-machine-checkable runner scope must
     fail before assignment state is appended or the child process launches.
   - A profile-default hierarchy replacement without an admitted override reason
     must fail at the same pre-append and pre-launch boundary. This enforcement
     is profile-generic and must not introduce a Grok provider-ID branch.
   - Authentication remains owned by each installed CLI. Runner JSON must not be
     treated as a credential store.

12. Legacy migration and cleanup
   - Existing legacy locations are cleaned through an explicit migration workflow,
     not by silent deletion or broad automatic rewriting.
   - The migration workflow must perform a preflight backup before destructive or
     move-like actions.
   - Dry-run is the default.
   - Apply mode runs only when the user explicitly requests it.
   - Broad migration apply requires user confirmation.

## Cache Refresh Timing

- Refreshing the plugin cache is separate from source editing.
- Cache refresh must be cautious and happen only after source validation.
- When the source change is intended for publication, commit the validated source
  change before refreshing cache.
- Broad cache refresh requires user confirmation.
- Do not edit `~/.codex/plugins/cache/` as the primary source of truth.

## Operational Instruction

Future implementation work should preserve this split:

- Source self-change work may update the CLI Agent Runner source repository.
- Cross-repo source invocation must keep source/cache files separate from the
  target repository's generated `.cli-agent-runner/` state. Running the source CLI
  from the plugin repository does not make the plugin repository the state owner
  when `--target-cwd` or an explicit target points elsewhere.
- Generated job state must preserve nested CLI Agent Runner preflight suppression,
  finite delegation depth, subagent supervision and cancellation rules,
  workflow-state lifecycle disposition without runtime-thread closure claims,
  concise worker-result and result-reference rules, parent-owned task
  finalization with typed Contract Coverage, the Coding Conduct Gate, debug
  root-cause completion requirements, and metacognitive context-impact checks
  for gate-required work.
- Stale generated state must be normalized explicitly before verification is
  treated as current.
- Legacy cleanup work may inspect external target repositories but must remain
  dry-run until the user explicitly requests apply.
- Migration apply and plugin cache refresh are separate user-confirmed steps.
