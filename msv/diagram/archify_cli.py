#!/usr/bin/env python3
"""Command line of the infra maps: reads the files of the page and writes the Archify specifications (see archify_map.py).

  python3 -m msv.diagram.archify_cli [web_dir] [output folder] [proposed diagrams to create, comma separated]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from msv.diagram import archify_extra, archify_map


def main() -> int:
    """Écrit les spécifications dans le dossier de sortie et affiche leur chemin, une par ligne."""
    web = Path(sys.argv[1] if len(sys.argv) > 1 else "web")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else ".")
    data = archify_map.read(web / "data.json")
    if data is None:
        sys.exit(f"{web / 'data.json'} illisible")
    health = archify_map.read(web / "health" / "stats.json")
    specs = {"carte": archify_map.build(data, health), "acces": archify_map.build_access(data, health)}
    if (bk := archify_map.read(web / "backups.json")) is not None:
        specs["sauvegardes"] = archify_map.build_backups(bk)
    wanted = [x for x in (sys.argv[3] if len(sys.argv) > 3 else "").split(",") if x]   # schémas proposés que l'on a demandé de créer
    if wanted:
        for key in wanted:
            if key in archify_extra.BUILD and archify_extra.available(key, data):
                specs[key] = archify_extra.BUILD[key](data)
    for old in ("connecteurs.archify.json", "alertes.archify.json", "alerts-summary.json"):   # retired: « Qui lit quoi », the alert chain and the summary it read
        (out / old).unlink(missing_ok=True)   # NOSONAR S8707: command-line tool, the paths are the ones its operator typed
    for name, spec in specs.items():
        f = out / f"{name}.archify.json"
        old = archify_map.read(f)
        changed = old is None or archify_map.stable(old) != archify_map.stable(spec) or not (web / f"{name}.html").exists()
        f.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")  # NOSONAR S8707: command-line tool, the paths are the ones its operator typed
        if changed:   # un schéma inchangé n'est pas regénéré (Archify prend du temps)
            print(f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
