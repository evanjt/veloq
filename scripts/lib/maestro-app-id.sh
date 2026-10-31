# Source this. `veloq_maestro_app_id <scripts dir>` prints the application id a
# Maestro run passes to the flows as `-e APP_ID=...`: the caller's APP_ID, or
# the development build's id from scripts/lib/app-identity.js, which is the app
# a run on a workstation drives. The E2E gate sets APP_ID to the id that ships.

veloq_maestro_app_id() {
  if [ -n "${APP_ID:-}" ]; then
    printf '%s\n' "$APP_ID"
    return
  fi
  APP_VARIANT=dev node "$1/lib/app-identity.js" appId
}
