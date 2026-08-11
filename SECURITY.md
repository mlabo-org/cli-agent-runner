# Security Policy / セキュリティポリシー

## Reporting a vulnerability / 脆弱性の報告

Please use GitHub's private vulnerability reporting or Security Advisory flow for this repository. Do not publish exploit details, Live Console tokens, local paths containing private data, provider credentials, or runner configuration secrets in a public issue.

このrepositoryのGitHub private vulnerability reportingまたはSecurity Advisoryを使ってください。exploit詳細、Live Console token、private dataを含むlocal path、provider credential、runner設定secretをpublic issueへ投稿しないでください。

Include the affected version, operating system, selected runner profile, minimal reproduction, expected result, actual result, and whether the issue requires a tokenized loopback URL or third-party runner configuration.

影響version、OS、選択runner profile、最小reproduction、期待結果、実結果、token付きloopback URLまたはthird-party runner設定が必要かを記載してください。

## Runtime trust boundary / Runtimeの信頼境界

- CLI Agent Runner executes local commands from bundled or user-supplied runner profiles. Review custom JSON before use.
- The Live Console is loopback-only and token-protected, but its URL exposes local telemetry to any local process or person that receives the token.
- Machine-checkable scope detects repository changes outside the declared paths; it is not an operating-system sandbox and does not replace provider permissions.
- Provider installation, authentication, billing, and data handling remain the responsibility of the selected provider CLI.

- CLI Agent Runnerはbundledまたはuser-supplied runner profileのlocal commandを実行します。custom JSONは使用前に確認してください。
- Live Consoleはloopback専用かつtoken保護ですが、URLを受け取ったlocal processまたは人物はlocal telemetryへ到達できます。
- machine-checkable scopeは宣言path外のrepository変更を検出しますが、OS sandboxではなくprovider permissionの代替でもありません。
- providerの導入、認証、課金、data handlingは選択したprovider CLI側の責任範囲です。

Only the current `main` branch is supported before the first public release. / 初回public releaseまではcurrent `main` branchのみをsupport対象とします。
