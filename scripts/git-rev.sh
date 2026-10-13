#!/bin/sh
# Git state of the working copy, for the dev image header (docker build --build-arg GIT_REV=…):
# « branch|commit|commits since the last tag|last tag|dirty », e.g. « main|9f010ab|1|v0.11.7| » or « fix-x|1a2b3c4|3|v0.11.7|dirty ».
cd "$(dirname "$0")/.." || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
branch=$(git rev-parse --abbrev-ref HEAD)
sha=$(git rev-parse --short HEAD)
tag=$(git describe --tags --abbrev=0 2>/dev/null)
ahead=$( [ -n "$tag" ] && git rev-list --count "$tag"..HEAD || echo 0)
dirty=$( [ -n "$(git status --porcelain 2>/dev/null)" ] && echo dirty)
echo "$branch|$sha|$ahead|$tag|$dirty"
