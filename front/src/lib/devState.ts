/** The git state shown in the header of the dev server (scripts/git-rev.sh, vite.config.ts). */

/** Version under way: the top of the changelog while it is not tagged yet (a version commit waiting for its tag), else the next patch. */
export function plannedVersion(changelog: string, lastTag?: string): string | null {
  if (!/^## Unreleased/m.test(changelog)) return null;
  const top = /^## v(\d+)\.(\d+)\.(\d+)\b/m.exec(changelog);
  if (!top) return null;
  const version = `${top[1]}.${top[2]}.${top[3]}`;
  return lastTag === `v${version}` ? `${top[1]}.${top[2]}.${Number(top[3]) + 1}` : version;
}

/** « routers+2,fix+1 » -> the branches with work not merged here, the fullest first. */
export function otherBranches(field?: string): { name: string; commits: number }[] {
  return (field ?? "").split(",").filter(Boolean)
    .map((b) => { const at = b.lastIndexOf("+"); return { name: b.slice(0, at), commits: Number(b.slice(at + 1)) }; })
    .sort((a, b) => b.commits - a.commits);
}
