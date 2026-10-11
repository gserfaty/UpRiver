#!/bin/sh
# Trivial BVT: list the workspace, fail if empty, write a manifest artifact.
files=$(find . -type f | sort)
if [ -z "$files" ]; then
  echo "BVT failed: workspace is empty"
  exit 1
fi
echo "$files"
echo "$files" > "$ARTIFACTS_DIR/manifest.txt"
