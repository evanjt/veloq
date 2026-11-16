#!/bin/sh
# The paths the landing format check and the landing format commit judge: the
# TypeScript under src/, and the JavaScript and TypeScript under scripts/. One
# owner for the list, so the check and the commit cannot judge different files.
#
# Reads one path per line on stdin and writes the ones in scope, one per line.
# The paths are git's, so the git that produces them runs with core.quotePath=off.
set -e

while IFS= read -r path || [ -n "$path" ]; do
  case $path in
    src/*.ts | src/*.tsx | scripts/*.mjs | scripts/*.cjs | scripts/*.js | scripts/*.ts)
      printf '%s\n' "$path" ;;
  esac
done
