// Chaque texte passé à tx("…") dans le front a sa traduction anglaise (ou figure dans SAME : noms, chemins),
// et garde les mêmes paramètres {0}, {1}… ; aucune traduction orpheline.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EN, SAME } from "./en";

const SRC = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/(\.test\.tsx?|i18n\.ts|en\.ts)$/.test(f) ? [p] : [];
  });
}

/** Premier argument littéral de chaque tx(…) */
function keys(): Set<string> {
  const out = new Set<string>();
  const re = /\btx\(\s*("(?:[^"\\]|\\.)*")/g;
  // plural(n, "mot", "mots") : les deux formes sont traduites
  const pl = /\bplural\([^,]+,\s*("(?:[^"\\]|\\.)*")(?:,\s*("(?:[^"\\]|\\.)*"))?/g;
  for (const f of files(SRC)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(re)) out.add(JSON.parse(m[1]));
    for (const m of src.matchAll(pl)) {
      const one = JSON.parse(m[1]);
      out.add(one).add(m[2] ? JSON.parse(m[2]) : `${one}s`);
    }
  }
  return out;
}

const params = (s: string) => [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort().join();

describe("i18n", () => {
  const used = keys();
  it("chaque texte a sa traduction anglaise", () => {
    expect([...used].filter((k) => !(k in EN) && !SAME.has(k))).toEqual([]);
  });
  it("mêmes paramètres en anglais qu'en français", () => {
    const bad = Object.entries(EN).filter(([fr, en]) => params(fr) !== params(en) && !/\{1\}/.test(fr)).map(([fr]) => fr);
    expect(bad).toEqual([]);
  });
  it("pas de traduction orpheline", () => {
    expect(Object.keys(EN).filter((k) => !used.has(k))).toEqual([]);
  });
});
