#!/bin/bash
# Installs the pstack plugin that .claude/settings.json enables. Cloud
# containers start without it, so /pstack:* skills and agents are missing.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if claude plugin list 2>/dev/null | grep -q 'pstack@cursor-plugins'; then
  exit 0
fi

claude plugin marketplace add cursor/plugins
claude plugin install pstack@cursor-plugins --scope user
