#!/bin/sh
# Trivial FVT: echo params, sleep, fail when UPRIVER_PARAM_FORCE_FAIL=yes.
env | grep '^UPRIVER_PARAM_' | sort
sleep 2
[ "$UPRIVER_PARAM_FORCE_FAIL" = "yes" ] && { echo "FVT failed: FORCE_FAIL=yes"; exit 1; }
exit 0
