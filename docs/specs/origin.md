# CLI Agent Runner Origin

CLI Agent Runner is an independent plugin source repository created from the last
verified source tree that still contained the Codex CLI process-runner route.
It is not a fork, mirror, worktree, or remote-tracking checkout of the source
project.

## Extracted Source

- source repository: `/Users/suzukimakoto/plugins/coding-agents`
- source commit: `6cb9ecf35ee3dcc875c8c0bbf61bcce3a6eeaba0`
- source commit date: `2026-07-10 11:31:19 +0900`
- source commit subject: `Make Coding Agents explicit-only`
- source tree: `6de3e4d6547b5b6eed3e380e1314ddf17806b580`
- next source commit: `a68c1b6585c79c11d0a5d89673659cd4d3c4c050`
- next commit subject: `Remove CLI subagent exec route`

The source tree was selected because it is the direct parent of the removal
commit. An archive of that exact tree passed all 74 source tests before the
independent project was created. Those tests cover `spawnSync("codex", ... )`,
`codex exec`, final-message capture, normalized `process-runner-result` packets,
and the machine-checkable scope guard.

## Independent Identity

The extracted tree was imported into a new Git repository with no inherited
commits, branches, tags, remotes, or GitHub relationship. The following active
identities were renamed together so this plugin can coexist without sharing
runtime state:

- plugin and skill: `cli-agent-runner`
- source root: `/Users/suzukimakoto/plugins/cli-agent-runner`
- CLI: `bin/cli-agent-runner.mjs`
- workflow state: `.cli-agent-runner/`
- migration script: `scripts/migrate-legacy-cli-agent-runner-state.mjs`

The initial independent release intentionally preserved the historical
`codex-cli` provider behavior. The current source subsequently added Claude,
Grok, and user-defined runner profiles through a shared JSON registry; that
later feature does not change the extraction provenance recorded above.
