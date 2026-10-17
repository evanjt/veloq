#!/usr/bin/env bash
# Run one shard of the scheduled sweep through run-suite.sh.
#
# Usage: run-shard.sh <report.xml> <debug-dir>
#
# PACKS names the shard's pack tags, SHARD_TIERS the tiers it holds, and TIERS
# the tiers the run asked for. Maestro includes a flow carrying any included
# tag, so the packs go in --include-tags and the tiers this shard does not
# hold, or the run did not ask for, go in --exclude-tags. A shard left with no
# tier runs nothing and writes no report.
set -uo pipefail

report="$1"
debug="$2"

exclude=""
held=""
for tier in tier0 tier1 tier2 tier3; do
  case ",$TIERS," in *",$tier,"*) asked=1 ;; *) asked=0 ;; esac
  case ",$SHARD_TIERS," in *",$tier,"*) mine=1 ;; *) mine=0 ;; esac
  if [ "$asked" = 1 ] && [ "$mine" = 1 ]; then
    held=1
  else
    exclude="$exclude${exclude:+,}$tier"
  fi
done
case ",$TIERS," in *",tier4,"* | *",tier5,"*) echo "::warning::Flows past tier3 carry no pack, so no shard runs them." ;; esac
if [ -z "$held" ]; then
  echo "This shard holds none of the tiers asked for ($TIERS)."
  exit 0
fi

args=(--include-tags="$PACKS")
[ -z "$exclude" ] || args+=(--exclude-tags="$exclude")
exec "$(dirname "$0")/run-suite.sh" "$report" "$debug" ${args[@]+"${args[@]}"}
