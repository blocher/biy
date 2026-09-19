#!/bin/zsh
# Double-click in Finder, or run ./dev-start.command. No importing or deployment.
set -eu
BIY_ROOT="${0:A:h}"
cd "$BIY_ROOT"
if [[ ! -x .venv/bin/python ]]; then
  print -u2 'Create the virtualenv first: uv venv --python 3.13 .venv && uv pip sync backend/requirements.txt'
  exit 1
fi
exec .venv/bin/python scripts/dev_start.py "$@"
