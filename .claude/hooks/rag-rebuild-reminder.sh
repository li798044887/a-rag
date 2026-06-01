#!/usr/bin/env bash
# PostToolUse hook: rag/ 配下を編集したら「Docker 再ビルドが必要」をリマインドする。
# rag は焼き込み済みイメージ（ソースマウント/リロードなし）のため、編集だけでは反映されない。
set -euo pipefail

input=$(cat)
fp=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

case "$fp" in
  */rag/*|rag/*)
    msg="⚠️ rag/ 配下を編集しました。rag は焼き込み済み Docker イメージ（ソースマウントなし）なので、変更を反映するには再ビルドが必要です: \`docker compose up -d --build rag\`（worker も触った場合は rag-worker も再ビルド）。"
    jq -n --arg m "$msg" '{
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: $m
      }
    }'
    exit 0
    ;;
esac

exit 0
