#!/usr/bin/env bash
# PreToolUse hook: 壊れやすい環境ファイル(.env / .env.local 等)への直接編集をブロックする。
# .env.example は許可（参照用テンプレなので編集してよい）。
set -euo pipefail

input=$(cat)
fp=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
base=$(basename "$fp")

case "$base" in
  .env.example)
    exit 0
    ;;
  .env|.env.*)
    jq -n --arg base "$base" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: ($base + " はローカル構成が壊れやすい環境ファイルです（Postgres host 5433 オーバーライド、HF オフライン設定、内部トークンなど）。フックにより直接編集をブロックしました。テンプレを変えたい場合は .env.example を編集し、実値はユーザーに依頼してください。")
      }
    }'
    exit 0
    ;;
esac

exit 0
