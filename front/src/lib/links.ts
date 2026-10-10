export const GITHUB = "https://github.com/Erreur32/MyServices";

/** Version de l'image (« v2.0.0-alpha.2-<sha> » en publication, « dev » en local) : étiquette Git et lien vers sa page, ou null si construite en local. */
export function releaseOf(version: string): { tag: string; url: string } | null {
  const tag = version.replace(/-[0-9a-f]{7,40}$/, ""); // le dernier segment est le commit
  return /^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(tag) ? { tag, url: `${GITHUB}/releases/tag/${tag}` } : null;
}
