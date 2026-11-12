# Sourced by land-branch.sh. Needs LANDING (the landing tree) and TARGET set.
#
# Two branches that each add a link method change the same lines of the method
# table, the page schema and the bindings, and git keeps one side of each (the
# `regenerated` driver), so the merged files can lack a method the merged Rust
# sources export without differing from the base at all. The generated files
# are therefore regenerated over every merged tree, and any change becomes a
# commit on the candidate. A generator that fails stops the landing: the
# freshness guards would only say the files are stale.
GENERATED_LINK_FILES=(web/connect/methods.json web/connect/schema.d.ts modules/veloqrs/src/generated/veloqrs.ts)
regenerate_link_files() {
  [ -e "$LANDING/scripts/regenerate-link-files.mjs" ] || return 0
  if ! (cd "$LANDING" && node scripts/regenerate-link-files.mjs); then
    echo "land-branch: regenerating the link files failed, so no gate ran and $TARGET was not moved." >&2
    exit 1
  fi
  git -C "$LANDING" add -- "${GENERATED_LINK_FILES[@]}"
  git -C "$LANDING" diff --cached --quiet && return 0
  git -C "$LANDING" -c core.hooksPath=/dev/null commit -q -m "Regenerate the link files over the merged method table"
  echo "land-branch: the generated link files were stale, regenerated at $(git -C "$LANDING" rev-parse --short HEAD)"
}
