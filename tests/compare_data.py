#!/usr/bin/env python3
"""Non-régression : compare deux data.json du collecteur (ex. version classique et version Docker,
sur la même config), en ignorant ce qui change d'un passage à l'autre (horodatages, latences, âges).

  python3 tests/compare_data.py <référence/data.json> <nouveau/data.json> [--ignore-ip IP ...]

Code de sortie 0 = mêmes services, mêmes machines, mêmes champs et mêmes valeurs stables.
"""
from __future__ import annotations

import argparse
import json
import re
import sys

# Champs qui changent d'un passage à l'autre sans que le résultat change
VOLATILE = {"generated", "next_run", "docker_cache_age", "ms", "latency", "age", "checked", "ts", "uptime",
            "last_seen", "load", "since", "now", "uptime_s"}


EXPECTED_NEW: set[str] = set()  # champs internes ajoutés exprès par la nouvelle version (--new-field a.b)


def stable(v):
    """Valeur sans ses champs volatils (récursif) ; durées docker (« Up 8 minutes ») ramenées à « Up »."""
    if isinstance(v, str) and re.match(r"(Up|Exited \(\d+\)) ", v):
        return re.sub(r" \d+ \w+( ago)?| About an? \w+( ago)?| Less than a second( ago)?", "", v)
    if isinstance(v, dict):
        return {k: stable(x) for k, x in v.items() if k not in VOLATILE}
    if isinstance(v, list):
        return [stable(x) for x in v]
    return v


def diff(a, b, path: str, out: list[str], limit: int = 200) -> None:
    if len(out) >= limit:
        return
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in b:
                out.append(f"{path}.{k} : absent du nouveau")
            elif k not in a:
                if f"{path}.{k}".lstrip(".") not in EXPECTED_NEW:
                    out.append(f"{path}.{k} : nouveau champ")
            else:
                diff(a[k], b[k], f"{path}.{k}", out, limit)
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, f"{path}[{i}]", out, limit)
    elif a != b:
        out.append(f"{path} : {json.dumps(a, ensure_ascii=False)[:120]} -> {json.dumps(b, ensure_ascii=False)[:120]}")


def by_id(rows: list, key: str) -> dict:
    return {r[key]: r for r in rows}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ref")
    ap.add_argument("new")
    ap.add_argument("--ignore-ip", action="append", default=[], help="machine à ne pas comparer (différence attendue)")
    ap.add_argument("--new-field", action="append", default=["connectors", "page.map"],
                    help="champ ajouté exprès par la nouvelle version (défaut : connectors, page.map), signalé sans échec")
    a = ap.parse_args()
    EXPECTED_NEW.update(f for f in a.new_field if "." in f)
    ref, new = (json.load(open(p, encoding="utf-8")) for p in (a.ref, a.new))
    skip = set(a.ignore_ip)
    out: list[str] = []

    def keep(r):
        return not ({r.get("ip"), r.get("host_ip")} & skip)
    hr, hn = by_id([h for h in ref["hosts"] if keep(h)], "id"), by_id([h for h in new["hosts"] if keep(h)], "id")
    for i in sorted(set(hr) - set(hn), key=str):
        out.append(f"service {i} : absent du nouveau")
    for i in sorted(set(hn) - set(hr), key=str):
        out.append(f"service {i} : seulement dans le nouveau")
    for i in sorted(set(hr) & set(hn), key=str):
        diff(stable(hr[i]), stable(hn[i]), f"hosts[{i}]", out)
    mr = by_id([m for m in ref["machine_list"] if m["ip"] not in skip], "ip")
    mn = by_id([m for m in new["machine_list"] if m["ip"] not in skip], "ip")
    diff(stable(mr), stable(mn), "machine_list", out)
    for k in sorted(set(new) - set(ref) & set(a.new_field)):
        print(f"  + {k} : nouveau champ attendu")
    for k in sorted((set(ref) | set(new)) - {"hosts", "machine_list"} - VOLATILE - (set(new) - set(ref) & set(a.new_field))):
        a_, b_ = ref.get(k), new.get(k)
        if k == "machines":
            a_, b_ = ({ip: m for ip, m in (x or {}).items() if ip not in skip} for x in (a_, b_))
        diff(stable(a_), stable(b_), k, out)

    print(f"référence : {len(ref['hosts'])} services, {len(ref['machine_list'])} machines ; "
          f"nouveau : {len(new['hosts'])} services, {len(new['machine_list'])} machines"
          + (f" (ignorées : {', '.join(sorted(skip))})" if skip else ""))
    for line in out:
        print("  ≠ " + line)
    print("✓ identiques (hors champs volatils)" if not out else f"✗ {len(out)} différence(s)")
    return 0 if not out else 1


if __name__ == "__main__":
    sys.exit(main())
