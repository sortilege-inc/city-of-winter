#!/usr/bin/env bash
# All gates for titterpig-dsl-city-of-winter. Exits non-zero if any fails.
#   usage: build/gates.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TITTERPIG="${TITTERPIG_ROOT:-$HOME/Sortilege/Titterpig}"
DSL="$TITTERPIG/DSL/titterpig-dsl"
MASTRA="$TITTERPIG/Utilities/titterpig-mastra"
fail=0

run() {  # run <label> <cmd...>
  echo
  echo "── $1"
  shift
  "$@"
  local rc=$?
  [ $rc -eq 0 ] || { echo "   ^ FAILED (exit $rc)"; fail=1; }
}

# The corpus is generated; regenerate first so the gates never test stale output.
run "regenerate corpus"   python3 "$REPO/build/gen_corpus.py"
run "validator (lint + coherence)" python3 "$DSL/ttrpg_validator.py" "$REPO/0.5/"
run "v0.5 REFERENCES"     python3 "$DSL/check_references.py" "$REPO/0.5/"
run "v0.5 constructs"     python3 "$DSL/check_constructs.py" "$REPO/0.5/"
run "verbatim"            python3 "$REPO/build/check_verbatim.py"
run "app feed ↔ corpus"   python3 "$REPO/build/check_feed.py"
run "source inventory"    python3 "$REPO/build/make_inventory.py"
run "coverage gate"       env -C "$MASTRA" npx tsx scripts/coverageAudit.ts \
                              "$REPO/build/cityofwinter.manifest.json"

echo
if [ $fail -eq 0 ]; then echo "ALL GATES PASS"; else echo "GATES FAILED"; fi
exit $fail
