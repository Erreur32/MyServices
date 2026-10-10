#!/usr/bin/env python3
"""Hook Claude Code (PreToolUse, Bash) : empêche de contourner le garde-fou commit / push (règle n° 1 : rien de sensible).
Refuse --no-verify, `git commit -n`, un changement de core.hooksPath, `git add -f` (qui outrepasse .gitignore) et les
variables qui coupent les hooks. Code 2 = refus, message renvoyé à Claude."""
import json
import re
import sys

cmd = json.load(sys.stdin).get("tool_input", {}).get("command", "")
RULES = [
    (r"\bgit\b[^;&|\n]*\b(commit|push|merge|rebase|cherry-pick|am)\b[^;&|\n]*--no-verify", "--no-verify"),
    (r"\bgit\s+commit\b[^;&|\n]*\s-[a-zA-Z]*n[a-zA-Z]*(\s|$)", "git commit -n (= --no-verify)"),
    (r"\bgit\s+(?:-c\s+core\.hooksPath|config\b[^;&|\n]*core\.hooksPath)", "changement de core.hooksPath"),
    (r"\bgit\s+add\b[^;&|\n]*(\s-f\b|--force)", "git add -f (outrepasse .gitignore)"),
    (r"\b(HUSKY|SKIP|GIT_HOOKS?)\w*=\s*(0|1|true)\b[^;&|\n]*\bgit\b", "variable qui coupe les hooks"),
    (r"\brm\b[^;&|\n]*\.githooks|\brm\b[^;&|\n]*\.git/hooks", "suppression des hooks"),
]
for rx, what in RULES:
    if re.search(rx, cmd):
        print(f"Refusé : {what}. Le garde-fou commit / push (scripts/safety.py) ne se contourne pas : corriger la cause, "
              "ou marquer un faux positif « safety:allow » dans la ligne.", file=sys.stderr)
        sys.exit(2)
