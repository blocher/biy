#!/bin/zsh
# Launch from source so the port cleanup is always current.
set -eu
BIY_ROOT="${0:A:h}"
exec osascript "$BIY_ROOT/StartBIYDev.applescript"
