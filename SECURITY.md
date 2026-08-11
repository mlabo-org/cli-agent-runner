# Security Policy / セキュリティポリシー

## Reporting a vulnerability / 脆弱性の報告

Please use GitHub's private vulnerability reporting or Security Advisory flow for this repository. Do not publish exploit details, Live Console tokens, local paths containing private data, provider credentials, or runner configuration secrets in a public issue.

このrepositoryのGitHub private vulnerability reportingまたはSecurity Advisoryを使ってください。exploit詳細、Live Console token、private dataを含むlocal path、provider credential、runner設定secretをpublic issueへ投稿しないでください。

Include the affected version, operating system, selected runner profile, minimal reproduction, expected result, actual result, and whether the issue requires a tokenized loopback URL or third-party runner configuration.

影響version、OS、選択runner profile、最小reproduction、期待結果、実結果、token付きloopback URLまたはthird-party runner設定が必要かを記載してください。

## Runtime trust boundary / Runtimeの信頼境界

- CLI Agent Runner executes local commands from bundled or user-supplied runner profiles and passes the current environment to them. Treat custom JSON as executable code, review it before use, and keep it outside worker-writable jobsites. Jobsite `.cli-agent-runner/` state is never an executable configuration source.
- The Live Console is loopback-only and token-protected, but its URL exposes local telemetry to any local process or person that receives the token.
- Machine-checkable scope fails closed when Git inspection is unavailable and detects visible repository changes outside the declared paths after execution. It is not write containment: ignored paths, paths outside the repository, and writes performed before detection remain the responsibility of provider permissions or a separate operating-system sandbox.
- Concurrent orchestration validates a non-overlapping declared owner scope for each job, but its shared-worktree Git check cannot attribute an in-scope write to one particular process; strict per-process isolation requires separate worktrees or an operating-system sandbox.
- Provider installation, authentication, billing, and data handling remain the responsibility of the selected provider CLI.

- CLI Agent Runnerはbundledまたはuser-supplied runner profileのlocal commandを現在のenvironment付きで実行します。custom JSONは実行可能codeとして使用前に確認し、workerが書き込めるjobsite外へ置いてください。jobsiteの`.cli-agent-runner/` stateを実行可能な設定sourceとして読み込むことはありません。
- Live Consoleはloopback専用かつtoken保護ですが、URLを受け取ったlocal processまたは人物はlocal telemetryへ到達できます。
- machine-checkable scopeはGit検査不能時にfail closedとなり、実行後に宣言path外の可視repository変更を検出します。ただしwrite containmentではなく、ignored path、repository外のpath、検出前に行われたwriteはprovider permissionまたは別のOS sandboxの責任範囲です。
- concurrent orchestrationはjobごとの非重複owner scopeを検証しますが、shared worktreeのGit検査ではscope内writeを特定processへ帰属できません。厳密なprocess単位隔離にはseparate worktreeまたはOS sandboxが必要です。
- providerの導入、認証、課金、data handlingは選択したprovider CLI側の責任範囲です。

Only the current `main` branch is supported before the first public release. / 初回public releaseまではcurrent `main` branchのみをsupport対象とします。
