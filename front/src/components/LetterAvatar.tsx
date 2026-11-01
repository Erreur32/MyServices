// Stands in for a service that has neither a logo nor a favicon: its domain's first letter, in a colour that stays the same for that domain.

export function hueOf(domain: string): number {
  let h = 0;
  for (const c of domain) h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return h % 360;
}

export function letterOf(domain: string): string {
  return (domain.replace(/^(www|m)\./, "")[0] ?? "?").toUpperCase();
}

export function LetterAvatar({ domain, size }: Readonly<{ domain: string; size: number }>) {
  const hue = hueOf(domain);
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="shrink-0" aria-hidden>
      <rect width="14" height="14" rx="3" fill={`hsl(${hue},45%,28%)`} />
      <text x="7" y="10.5" textAnchor="middle" fontSize="8" fontWeight="700" fontFamily="system-ui,sans-serif" fill={`hsl(${hue},70%,80%)`}>{letterOf(domain)}</text>
    </svg>
  );
}
