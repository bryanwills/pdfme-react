#!/bin/sh

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <workspace> [workspace...]" >&2
  exit 1
fi

pids=""
status=0

for workspace in "$@"; do
  npm run build -w "$workspace" &
  pids="${pids}${pids:+ }$!:$workspace"
done

for entry in $pids; do
  pid=${entry%%:*}
  workspace=${entry#*:}

  wait "$pid"
  exit_code=$?
  if [ "$exit_code" -ne 0 ]; then
    echo "build failed for $workspace" >&2
    if [ "$status" -eq 0 ]; then
      status=$exit_code
    fi
  fi
done

exit "$status"
