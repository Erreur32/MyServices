#!/bin/sh
# Git state of the working copy, for the dev image header (docker build --build-arg GIT_REV=…):
# « branch|commit|commits since the last tag|last tag|dirty|other branches », e.g. « main|9f010ab|1|v0.11.7|| » or « fix-x|1a2b3c4|3|v0.11.7|dirty|routers+2,y+1 ».
cd "$(dirname "$0")/.." || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
branch=$(git rev-parse --abbrev-ref HEAD)
sha=$(git rev-parse --short HEAD)
tag=$(git tag --list 'v*' --sort=-v:refname | head -n 1)   # not git describe: a release is tagged on main, out of reach from next
ahead=$( [ -n "$tag" ] && git rev-list --count "$tag"..HEAD || echo 0)
dirty=$( [ -n "$(git status --porcelain 2>/dev/null)" ] && echo dirty)
# Branches holding work this one has not, « name+commits »; main is where work ends up, not work under way
others=$(git for-each-ref --format='%(refname:short)' --no-merged HEAD refs/heads | grep -vx main | while read -r b; do printf '%s+%s,' "$b" "$(git rev-list --count "HEAD..$b")"; done)
echo "$branch|$sha|$ahead|$tag|$dirty|${others%,}"
