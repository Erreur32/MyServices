// CHANGELOG.md -> sections par version : « ## v0.9.3 (2026-10-11) » ou « ## Unreleased (next version, not tagged yet) ».
export interface ChangelogSection { id: string; title: string; date: string | null; body: string; unreleased: boolean }

export function parseChangelog(raw: string): ChangelogSection[] {
  const out: ChangelogSection[] = [];
  const re = /^##\s+(.+)$/gm;
  const heads: { title: string; at: number; end: number }[] = [];
  for (let m = re.exec(raw); m; m = re.exec(raw)) heads.push({ title: m[1].trim(), at: m.index, end: m.index + m[0].length });
  heads.forEach((h, i) => {
    const date = /\((\d{4}-\d{2}-\d{2})\)/.exec(h.title)?.[1] ?? null;
    const unreleased = /^unreleased/i.test(h.title);
    const id = unreleased ? "unreleased" : (/^v?(\d+\.\d+\.\d+\S*)/.exec(h.title)?.[1] ?? h.title);
    out.push({ id, title: unreleased ? "Unreleased" : h.title.replace(/\s*\(.*\)\s*$/, ""), date, unreleased, body: raw.slice(h.end, heads[i + 1]?.at ?? raw.length).trim() });
  });
  return out;
}
