---
name: cli-agent-runner
description: >-
  Launch scoped Codex CLI workers with codex exec, capture stdout/stderr and the final message, and record process-runner-result in .cli-agent-runner. Trigger on CLI Agent Runner, cli-agent-runner, CLI subagent execution, or continuation/audit/repair of its state. Excludes generic official-subagent work.
---

# CLI Agent Runner

この `SKILL.md` は、この skill が選択された場合に適用される局所実行契約である。
Codex は、本書の発火前提、作業手順、ツール境界、ファイル境界、出力形式を、この skill のスコープ内で拘束力のある実行条件として扱う。
本書は、システム指示、開発者指示、ユーザーの明示要求、適用される `AGENTS.md`、より局所の実行契約を上書きしない。

## Trigger Boundary

- Use this skill when the user explicitly names `CLI Agent Runner` or `cli-agent-runner`; asks for a CLI-spawned Codex worker or CLI subagent; asks to capture a Codex CLI worker's stdout, stderr, or final message; or asks to continue, audit, or repair existing `.cli-agent-runner` workflow state.
- The primary execution route is `run` or `orchestrate` with `--runner codex-cli`. It launches `codex exec` as an OS child process and records a normalized `process-runner-result` packet.
- Do not auto-route this skill for generic coding, ordinary official-subagent work, code review, supervision, or cancellation. Those tasks remain on their normal routes unless the user explicitly requests CLI process execution.
- This initial independent release supports only the `codex-cli` runner. Do not claim Claude CLI, Grok CLI, or another provider is implemented.
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
- The first action after trigger is target resolution followed by project intake. Determine `invocation_cwd`, resolve the jobsite from the explicit target or default cwd rule, read the local `AGENTS.md` chain that applies to the jobsite when available, inspect the jobsite repository shape, check Git state, resolve `<git-root>`, inspect existing `.cli-agent-runner` state, inspect `.git/info/exclude`, and identify legacy `docs/codex` material only as migration input.
- During source upgrade work, direct execution of the source CLI runs source-tree behavior: `node /Users/suzukimakoto/plugins/cli-agent-runner/bin/cli-agent-runner.mjs ...`. This validates source behavior, not installed plugin activation.
- `run --runner codex-cli` invokes `codex exec` with the jobsite as cwd, captures process stdout/stderr and `--output-last-message`, applies the declared scope guard, and derives the `process-runner-result` status, summary, exit code, signal, timeout, and failure fields.
- The parent owns the assignment, allowed scope, acceptance decision, and user-facing synthesis. The CLI child worker owns only the scoped transformation and its returned result material.
- Installed plugin activation is controlled by refreshing the plugin cache from validated source and then restarting Codex or opening a new thread when required. Do not claim a source CLI run proves cached plugin activation.
- Maintain `<git-root>/.cli-agent-runner/` as the workflow SSOT for the active job.
- When the user confirms a design or operating decision, record it as an accepted decision, convert it into actionable specification, and audit execution against it after implementation.
- `collect` records one worker-result collection and its workflow-state lifecycle disposition; it does not require that worker to map every active decision, completion condition, or source/spec check for the task. Task-wide completion is accepted only through the distinct source CLI `finalize` command and its `task-finalization` packet.
- The parent agent owns task decomposition, policy decisions, user consultation, conflict resolution, final integration, task-wide Contract Coverage, task finalization, workflow-state lifecycle disposition, any separate runtime action available through exposed runtime tools, and final reporting.
- Subagents own research, implementation material, verification material, and isolated findings. They do not own final policy or final user-facing synthesis.
- After a subagent result is integrated, after hard-timeout/failure/blocker handling, or after a stale premise or scope change, the parent must use `collect --lifecycle-disposition state_retired --cancel-reason <allowed-reason>` when no further workflow use is expected, or `collect --lifecycle-disposition continuation_expected` when an explicitly scoped continuation remains necessary.
- A subagent's explicit completed, blocked, or failed result is not silence. It must immediately trigger parent collection, integration, and one of those workflow-state dispositions; `heartbeat_deadline` and `no_interrupt_until` protect only quiet workers that have not returned a result.
- Treat lifecycle fields as workflow state only. The CLI Agent Runner CLI does not interrupt, close, delete, or reclaim runtime threads; interruption and process exit are not runtime-thread closure evidence.

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

- This gate fires when the active task is source change, code edit, implementation change, config edit, test edit, canonical document edit, refactor, debug, repair, source-of-truth correction, plugin-contract correction, generated-artifact inconsistency investigation, generated state versus source mismatch, cache/runtime versus source mismatch, stale contract repair, or any work where a local fix can change before/after context or cross-feature behavior.
- The source-change trigger is not optional once CLI Agent Runner has been selected for coding work. Do not let keyword judgment, task smallness, immediate token/latency cost, or apparently simple edits classify source/config/test/canonical/refactor work as non-gate work.
- For source-change work, CLI Agent Runner must check whether a mature GitHub/npm solution should be reused before implementing core logic manually. If reuse is not taken, record why.
- `--work-type <id>` is semantic command metadata for the source CLI, not a replacement for this gate or the Debugging Integrity Gate. Known ids are `auto`, `documentation`, `source-change`, and `debug`.
- `--work-type auto` preserves keyword/path inference. `--work-type source-change` and `--work-type debug` force the metacognitive gate for that command. `--work-type documentation` suppresses keyword/path gate inference for that command only; it must not downgrade an existing gate-required workflow state or excuse missing root-cause/debug evidence.
- CLI Agent Runner must treat gate-required work as context-impact work, not only local patch work. Result quality degrades when CLI Agent Runner stays local, so assignments, audits, handoffs, runner packets, and final reports must inspect before/after context effects and cross-feature consequences before claiming completion.
- Gate-required work must separate the intended contract, observed mismatch, affected source/generated/cache/runtime surfaces, changed assumptions, neighboring feature impact, before-context effects, after-context effects, cross-feature consequences, verification performed, skipped checks, unresolved risks, and next investigation.
- The parent must require workers to identify whether the mismatch is in source, generated workflow state, cache copy, runtime output, activation state, user request interpretation, or verification criteria before accepting a repair route.
- The parent must reject local-wrapper fixes that preserve a faulty premise. Before adding an adapter, compatibility branch, defensive return, default filler, or wrapper workflow, reconsider whether the selected route, source-of-truth, plugin contract, data model, generated artifact, cache/runtime surface, or verification target is wrong. Do not add fallback implementations that hide main-flow errors.
- Passive checklists, prose-only `debugging_integrity` text, log-only completion, fallback-only completion, skip-only completion, failure-output-only completion, hidden-fallback completion, avoidable reimplementation of mature OSS, and local-wrapper fixes without premise reconsideration are non-completion for gate-required work.
- If a gate-required assignment cannot inspect neighboring features or before/after context within its scope, it must report the skipped check, why it was skipped, the risk that remains, and the next investigation that would close the gap.

## Contract Coverage Gate

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
- A scoped assignment may also include `--feature-profile <id>`. Treat feature profiles as optional assignment overlays that add routing/debug guidance to that specific assignment instance; they are not additional scaffold roles, resident agents, spawned workers, or a substitute for `task_id`, `epoch`, `scope`, and `lifecycle`.
- Known feature profile ids are `debug.reproducer`, `debug.failure-boundary`, `debug.hypothesis-splitter`, `debug.fix-verifier`, `runner.scope-guard`, `plugin.activation-guard`, `source.cache-boundary`, and `workflow.state-safety`. Unknown ids must fail before `.cli-agent-runner/runner.md` is appended.
- A scoped assignment, worker-result-collection packet, intake, or runner command may also include `--work-type <id>`. Treat work types as command metadata for gate classification only; they are not roles, feature profiles, lifecycle states, or permission to weaken source-change/debug/root-cause requirements.
- Unknown work type ids must fail before `.cli-agent-runner/runner.md` is appended. Missing `work_type` in existing workflow state or packets means `auto`.
- Treat `task_id` as the unit of user-visible work, `epoch` as the restart boundary for stale context, and `scope` as the allowed file, tool, or investigation boundary.
- When a child worker is operating under a parent-managed CLI Agent Runner assignment, the parent has already selected CLI Agent Runner for that scoped assignment. The child worker must not ask `cli-agent-runner を使いますか？ [Y/n]` and must not start an independent nested CLI Agent Runner workflow. It may delegate descendants only when finite hierarchy fields grant `remaining_depth > 0`, while keeping the same `task_id`, `epoch`, `scope` lineage and inherited supervision. It proceeds directly within the assigned `task_id`, `epoch`, and `scope`, while still stopping before scope expansion, destructive operations, external sending, commits, cache refresh, plugin activation, or unrelated edits.
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
- Completed, blocked, failed, or otherwise terminal worker output is an observed result, not heartbeat silence. The parent must collect and integrate that result as soon as it is visible, then record `state_retired` with `completed_retire`, `blocker_or_failure`, or another applicable allowed reason unless an explicitly scoped `continuation_expected` remains necessary.
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
   `node /Users/suzukimakoto/plugins/cli-agent-runner/bin/cli-agent-runner.mjs intake --target-cwd <jobsite> --work-type <auto|documentation|source-change|debug> --task <task> --task-id <id> --epoch <epoch> --scope <scope>`.
6. Run doctor:
   `node /Users/suzukimakoto/plugins/cli-agent-runner/bin/cli-agent-runner.mjs doctor --target-cwd <jobsite>`.
7. Print handoff when needed:
   `node /Users/suzukimakoto/plugins/cli-agent-runner/bin/cli-agent-runner.mjs handoff --target-cwd <jobsite> --task-id <id>`.
8. If pre-existing `.cli-agent-runner` state lacks the debugging integrity gate, run dry-run first:
   `node /Users/suzukimakoto/plugins/cli-agent-runner/bin/cli-agent-runner.mjs normalize-debugging-integrity --target-cwd <jobsite>`.
   Apply only after confirming the target state directory:
   `node /Users/suzukimakoto/plugins/cli-agent-runner/bin/cli-agent-runner.mjs normalize-debugging-integrity --target-cwd <jobsite> --execute`.
9. For `assign`, `collect`, `finalize`, `run`, or `orchestrate`, record operational packets in the jobsite repository's `.cli-agent-runner/runner.md`. Use `--feature-profile <id>` only as an optional scoped overlay for that assignment instance, and keep missing profiles as `feature_profile: none`. Use `--work-type <id>` only as semantic command metadata for gate classification, and keep missing work types as `work_type: auto`.
   For `collect`, pass exactly one lifecycle disposition: use `--lifecycle-disposition state_retired --cancel-reason <allowed-reason>` when the workflow will not continue with that context, or `--lifecycle-disposition continuation_expected` without `--cancel-reason` when explicitly scoped continuation remains necessary. A completed collection records that worker result without task-wide Contract Coverage; pass `--finalization-references <typed-refs>` when result-relevant references are available. Do not pass or infer `runtime_thread_closed`; every CLI command rejects that flag because the workflow CLI cannot establish runtime closure.
   After integrating worker results and assembling complete task-wide coverage, run:
   `node /Users/suzukimakoto/plugins/cli-agent-runner/bin/cli-agent-runner.mjs finalize --target-cwd <jobsite> --task-id <id> --epoch <epoch> --scope <scope> --work-type <auto|documentation|source-change|debug> --contract-coverage required --decision-coverage <D-coverage> --completion-coverage <C-coverage> --source-spec-coverage <typed-ref>`.
   `finalize` validates all active D-*/C-*/source-spec coverage before appending the distinct `task-finalization` packet. If validation fails, stop and correct the evidence; do not treat worker collection as task completion.
   When `run --runner codex-cli` is used, treat `--scope` as runner machine input:
   - Stop before appending `.cli-agent-runner/runner.md` or launching the runner when `--scope` is empty, ambiguous prose, negative/exclusion wording, or otherwise not machine-checkable.
   - Use quoted `--scope "scope:v1 all"` for the whole repo.
   - Use quoted `--scope "scope:v1 paths=README.md,bin/cli-agent-runner.mjs,tests/"` for an affirmative comma-separated repo-relative prefix list.
   - Accept absolute paths only when they resolve inside the target cwd, then normalize them to repo-relative prefixes.
   - Preserve legacy runner compatibility only for simple path-only values such as `README.md`, `allowed/`, `bin/cli-agent-runner.mjs tests/workflow-state.test.mjs`, plus whole-repo aliases `.`, `repo`, and `whole repo`.
   - Keep broader human prose scopes for intake, assign, and collect rather than runner execution.
10. Ensure generated assignments, runner prompts, runner packets, and handoff material carry the nested CLI Agent Runner preflight suppression rule, finite hierarchy rule, supervision and cancellation rule, workflow-state lifecycle rule, Coding Conduct Gate, worker-reference prompt for parent finalization, debugging integrity gate, and Meta-Cognitive Debug/Repair Gate when it fires. Explicit completed, blocked, or failed output bypasses the quiet-worker stale path and triggers immediate collection, integration, and recorded workflow-state disposition. Heartbeat/progress telemetry, interruption, and process exit are not completion or runtime-thread closure evidence. Keep the remaining nested-scope, stale-path, OSS reuse, first-principles debugging, no-hidden-fallback, task-finalization Contract Coverage, and context-impact gates enforced by the source CLI and its validators.
11. Treat marketplace registration, `~/.codex/plugins/cache/` refresh, and Codex restart/new-thread activation as separate work unless the user explicitly includes them.

If source CLI output still names legacy `docs/codex`, treat that as source implementation drift to report or fix under the active task scope. Do not let legacy output redefine the current skill contract.

## Workflow

1. Record `invocation_cwd`, then resolve the jobsite from the explicit target (`--target-cwd`, user-named project root, or task-owned target path) or from cwd when no target is named.
2. If target selection remains ambiguous, stop before edits or workflow state writes and ask for the intended jobsite.
3. Resolve the jobsite repository's `<git-root>` and run project intake before editing: repository status, applicable instructions, current `.cli-agent-runner` state, `.git/info/exclude` status, legacy `docs/codex` migration input, source/cache boundaries, and risk level.
4. Before workflow state writes, create or update the jobsite repository's local `.git/info/exclude` entry for `.cli-agent-runner/` when missing. Do not update tracked `.gitignore`.
5. Create or update the active `.cli-agent-runner` files before implementation when workflow state is missing or stale.
6. Initialize the fixed 14-role assignment scaffold with `task_id`, `epoch`, `scope`, `lifecycle`, finite hierarchy fields, and supervision defaults for long-running or delegated work; create actual specialist assignments only when scoped work is dispatched. Do not add roles for feature profiles.
7. Execute or coordinate work according to `.cli-agent-runner/todo.md`.
8. Record user-confirmed decisions in `.cli-agent-runner/decisions.md` and update `.cli-agent-runner/task.md` when scope changes.
9. Create or update `.cli-agent-runner/runner.md` only for `assign`, `collect`, `finalize`, `run`, `orchestrate`, worker-result collection, task finalization, or process-result activity. Keep existing legacy `parent-integration` packets readable for backward validation; do not describe them as newly emitted packets.
10. Normalize stale pre-gate `.cli-agent-runner` state with `normalize-debugging-integrity` before relying on `verify-assignments` or `doctor` results.
11. After every completed result integration, `hard_timeout`/failure/blocker handling, stale premise, or scope change, record `state_retired` with one allowed reason when no further workflow use is expected, or `continuation_expected` without a reason when a continuation is explicitly scoped. Do not cancel, interrupt, mark `state_retired`, or replace a quiet long-running worker before `heartbeat_deadline` and `no_interrupt_until` unless `user_stop`, `safety_stop`, or `scope_violation` applies. Do not apply the quiet-worker wait rule to a worker that has already returned completed, blocked, failed, or otherwise terminal integration material.
12. Verify implementation against the accepted decisions and completion conditions. When the task is ready to complete, aggregate typed Contract Coverage evidence for every active D-* decision, every active C-* completion condition, and the source/spec check, then run `finalize`; do not require each completed worker collection to carry the entire task map. Verification must also include Coding Conduct Gate evidence: mature OSS reuse or non-reuse rationale, first-principles analysis for bugs, and confirmation that no fallback implementation hides main-flow errors. For debug or repair work, verification must include root cause, fix, and evidence that the intended outcome now succeeds; otherwise mark the task unresolved or temporarily contained. For Meta-Cognitive Debug/Repair Gate work, verification must also include intended contract, observed mismatch, affected source/generated/cache/runtime surfaces, changed assumptions, neighboring feature impact, before-context effects, after-context effects, cross-feature consequences, verification performed, skipped checks, unresolved risks, and next investigation.
13. Before the final report, confirm every collected result has a recorded workflow-state disposition and, when claiming task completion, confirm that `finalize`, `verify-assignments`, and `doctor` accepted the distinct task-finalization packet. If `continuation_expected` remains, report the scoped continuation or valid supervision window. Do not claim that the workflow record closed or reclaimed a runtime thread.
14. Append audit results to `.cli-agent-runner/audit.md`, including checks not run and why. Include Coding Conduct Gate checks. For gate-required work, include context-impact inspection and cross-feature checks or explicitly record why those checks were skipped.
15. Report final status with changed files, verification, open risks, and next TODOs.

## File Boundaries

- Edit jobsite files only inside the active task scope.
- In cross-repo invocation, do not edit the invocation repository merely because Codex or the source CLI was launched there. Edit the invocation repository only when it is also the resolved jobsite or is explicitly inside the active task scope.
- Treat plugin source directories as source of truth. Do not patch `~/.codex/plugins/cache/` as the primary edit target.
- Do not edit `~/.codex/plugins/cache/`, marketplace files, or plugin activation state unless the user explicitly includes that in the active task scope.
- Do not auto-edit tracked `.gitignore` to hide `.cli-agent-runner/`. Use target `.git/info/exclude` for the local workflow-state ignore rule.
- Do not edit legacy `docs/codex` as active workflow state. Edit it only when the active task is an explicit migration, cleanup, or legacy-document maintenance task.
- Preserve unrelated user or worker changes. If another change appears in scope, work around it or report the conflict; do not revert it.
- The MVP CLI uses Node.js standard libraries only. Do not add dependencies to run intake, handoff, or doctor.

## Source And Cache Boundary

- Source repository changes take effect for direct source CLI runs immediately.
- Installed plugin behavior uses the cached plugin copy under `~/.codex/plugins/cache/` and may require a refresh plus Codex restart or a new thread before the updated skill, agent metadata, CLI, or assets are active.
- Refresh cache only from validated source and only for the named plugin in scope. Do not refresh broadly or edit cache files directly.
- When cache activation is out of scope, report that source is updated but plugin activation is pending cache refresh/restart.

## Output Shape

Return concise parent-facing status in the user's language. Include changed files, verification or audit results, remaining blockers, unresolved TODOs, and any subagent lifecycle exception that remains open. Distinguish collected worker results from task finalization. Before claiming task completion, include the `finalize`/Contract Coverage validation plus `verify-assignments` and `doctor` results. Include Coding Conduct Gate evidence when coding or debug work is in scope: OSS reuse/non-reuse rationale, first-principles bug analysis when applicable, and no-hidden-fallback status. For debug or repair work, explicitly separate root cause, fix, and verification; do not report completion when only logging, fallback, skipping, hidden fallback, or failure-return behavior was added. For Meta-Cognitive Debug/Repair Gate work, include context-impact inspection, cross-feature checks, skipped checks, unresolved risks, and next investigation. Keep raw subagent logs out of the final answer unless the user asks for them.
