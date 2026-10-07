#!/bin/bash
# Forwards to the one generator, `npm run ffi:generate`. Kept only so an old
# caller keeps working, and removed once none is left.
set -euo pipefail

cd "$(dirname "$0")/.."
exec npm run --silent ffi:generate
