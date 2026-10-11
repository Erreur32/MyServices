import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Une page blanche (« Rendered more hooks than during the previous render ») vient d'un hook posé après un `return` anticipé.
// Garde-fou simple : dans chaque composant (fonction à majuscule), aucun useState / useEffect / useMemo… après un `if (…) return`
// écrit sur une ligne à deux espaces d'indentation.
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx$/.test(e.name) ? [join(dir, e.name)] : []));
}

describe("ordre des hooks React", () => {
  it("aucun hook après un return anticipé", () => {
    const bad: string[] = [];
    for (const f of files(join(__dirname, ".."))) {
      let comp = "", early = 0;
      readFileSync(f, "utf-8").split("\n").forEach((l, i) => {
        if (/^(export )?function [A-Z]\w*\(/.test(l)) { comp = l.slice(0, 50); early = 0; }
        else if (comp && /^ {2}if \(.*\) return\b/.test(l)) early ||= i + 1;
        else if (comp && early && /^ {2}(const .*= )?use[A-Z]\w*[<(]|^ {2}(useEffect|useMemo|useCallback)\(/.test(l)) bad.push(`${f.split("/src/")[1]}:${i + 1} (return ligne ${early}, ${comp})`);
      });
    }
    expect(bad).toEqual([]);
  });
});
