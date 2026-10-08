#!/usr/bin/env bash
# Refuse to push a ref whose tracematch submodule pin is on no published branch or tag.
#
# A pin to a commit that exists only on the pusher's disk pushes without complaint,
# then every CI checkout fails with `upload-pack: not our ref` and a release tag never
# gets a green build. The submodule's own `origin` is no evidence of publication: in a
# worktree it is the local main checkout. So the published repository is the URL the
# pushed commit's own `.gitmodules` names, and the pin counts when a branch or tag
# there contains it.
#
# Usage: check-submodule-pin-pushed.sh < pre-push stdin
#   one `<local ref> <local sha> <remote ref> <remote sha>` line per pushed ref.
#   A deleted ref (local sha all zeros) and a ref with no pin are skipped.

set -euo pipefail

path=modules/veloqrs/rust/tracematch
zero=0000000000000000000000000000000000000000

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
git init -q --bare "$scratch"
published() { GIT_NO_LAZY_FETCH=1 git --git-dir="$scratch" "$@"; }

fetched_url=""

while read -r local_ref local_sha remote_ref remote_sha; do
  [ -n "$local_sha" ] && [ "$local_sha" != "$zero" ] || continue

  pin=$(git ls-tree "$local_sha" -- "$path" | awk '$1 == "160000" { print $3 }')
  [ -n "$pin" ] || continue

  url=$(git config --blob "$local_sha:.gitmodules" --get "submodule.$path.url" || true)
  if [ -z "$url" ]; then
    echo "Refusing to push $local_ref: its .gitmodules names no url for $path." >&2
    exit 1
  fi

  if [ "$url" != "$fetched_url" ]; then
    published for-each-ref --format='delete %(refname)' refs/published | published update-ref --stdin
    if ! published fetch -q --no-tags --filter=tree:0 "$url" \
      '+refs/heads/*:refs/published/heads/*' '+refs/tags/*:refs/published/tags/*'; then
      echo "Refusing to push $local_ref: could not read the published submodule at $url." >&2
      echo "The pin $pin cannot be checked against it." >&2
      exit 1
    fi
    fetched_url=$url
  fi

  if published cat-file -e "$pin^{commit}" 2>/dev/null &&
    [ -n "$(published for-each-ref --count=1 --contains "$pin" --format='%(refname)' refs/published)" ]; then
    continue
  fi

  echo "Refusing to push $local_ref: its $path pin $pin is on no branch or tag at $url." >&2
  echo "A fresh checkout of the pushed ref cannot fetch it. Publish the commit first:" >&2
  echo "  git -C $path push origin $pin:main" >&2
  exit 1
done
