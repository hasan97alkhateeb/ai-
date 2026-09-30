#!/usr/bin/env bash
# Never use the caller's DATABASE_URL or provider credentials.
set -Eeuo pipefail

api_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for command in initdb pg_ctl pnpm node; do
  command -v "$command" >/dev/null || {
    echo "API tests require $command on PATH (Node.js, pnpm and PostgreSQL 16+)." >&2
    exit 1
  }
done
if [[ "$(id -u)" == 0 ]]; then
  echo "Run API tests as a non-root user; PostgreSQL initdb refuses root." >&2
  exit 1
fi

# A short, unique socket path avoids port races and Unix socket path limits.
test_dir="$(mktemp -d /tmp/api-tests.XXXXXXXX)"
child=""
playwright_browsers_path="${PLAYWRIGHT_BROWSERS_PATH:-${HOME:-/tmp}/.cache/ms-playwright}"
clean_env=(
  env -i
  "PATH=$PATH"
  "HOME=$test_dir"
  "LC_ALL=C"
  "NODE_ENV=test"
  "PLAYWRIGHT_BROWSERS_PATH=$playwright_browsers_path"
)
if [[ -n "${CHROMIUM_PATH:-}" ]]; then
  clean_env+=("CHROMIUM_PATH=$CHROMIUM_PATH")
fi

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$child" ]]; then
    kill -TERM -- "-$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  if [[ -f "$test_dir/data/postmaster.pid" ]]; then
    if ! "${clean_env[@]}" pg_ctl -D "$test_dir/data" -m immediate -w stop; then
      echo "Could not stop test PostgreSQL; preserved $test_dir for cleanup." >&2
      exit 1
    fi
  fi
  rm -rf "$test_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Job control gives each child its own process group, including pnpm/Node
# descendants, so interruption cannot leave tests running against a removed DB.
set -m
run() {
  "${clean_env[@]}" "$@" &
  child=$!
  local status=0
  wait "$child" || status=$?
  child=""
  return "$status"
}

echo "Using disposable API test database: $test_dir"
run initdb -D "$test_dir/data" -U api_test --auth=trust --no-locale --encoding=UTF8 >"$test_dir/initdb.log" 2>&1 || {
  cat "$test_dir/initdb.log" >&2
  exit 1
}
mkdir "$test_dir/socket" "$test_dir/output"
run pg_ctl -D "$test_dir/data" -l "$test_dir/postgres.log" \
  -o "-c listen_addresses='' -c unix_socket_directories='$test_dir/socket' -c unix_socket_permissions=0700" -w start || {
  cat "$test_dir/postgres.log" >&2
  exit 1
}

clean_env+=(
  "DATABASE_URL=postgresql://api_test@localhost/postgres?host=$test_dir/socket"
  "API_TEST_OUTPUT_DIR=$test_dir/output"
)
cd "$api_dir"
run pnpm --filter @workspace/db run push
run node "$api_dir/run-tests.mjs"