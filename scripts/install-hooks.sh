#!/usr/bin/env bash
# Active les hooks versionnés (.githooks) pour ce clone : à lancer une fois après `git clone`.
set -eu
cd "$(dirname "$0")/.."
chmod +x .githooks/* scripts/safety.py
git config core.hooksPath .githooks
echo "hooks actifs : pre-commit et pre-push (.githooks). Liste locale de motifs interdits : .safety-deny (jamais versionnée)."
