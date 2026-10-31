// The rows of Availability as people name them: a service reached by its domain is a domain; machines, services, domains and Uptime Kuma probes.
export type RowKind = "machine" | "service" | "domain" | "kuma";
interface Row { kind: "service" | "machine" | "kuma"; label: string | null; target: string | null }

const DOMAIN = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;

export const rowKind = (x: Row): RowKind => (x.kind === "service" && DOMAIN.test(x.label ?? "") ? "domain" : x.kind);

/** The domain a row belongs to, « » when it has none; shortcut: the last two labels, so a « .co.uk » name groups under « co.uk », use a suffix list if a user needs it */
export function rootDomain(x: Row): string {
  const name = [x.label, x.target].find((v) => DOMAIN.test(v ?? ""));
  return name ? name.toLowerCase().split(".").slice(-2).join(".") : "";
}
