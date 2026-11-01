// The Security frame of the home page: the points of Security › Overview, counted the same way, each counter opening its page.
import { ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import type { Snapshot } from "../api";
import { accessFindings } from "../lib/accessFindings";
import { tx } from "../lib/i18n";
import { securityFindings } from "../lib/securityFindings";
import { watchRows } from "../lib/securityWatch";
import type { TabId } from "../lib/summary";
import { useAccessData } from "./SecurityAccess";
import { Group, Mark, type Open } from "./StatGroup";

export function SecurityGroup({ snap, nav }: Readonly<{ tab: TabId; snap: Snapshot; nav: Open }>) {   // tab: read by statGroups to place the frame
  const access = useAccessData(snap.me.role === "admin");
  const rows = useMemo(() => watchRows(securityFindings(snap, access ? accessFindings(access, Math.floor(Date.now() / 1000)) : [])), [snap, access]);
  const OVERVIEW = "security/overview", count = (area: string) => rows.filter((r) => r.area === area).length;
  return (
    <Group mark={<Mark Icon={ShieldCheck} />} title={tx("Sécurité")} sub={tx("{0} points", rows.length)} accent="border-l-bad" tab="security" href={OVERVIEW} nav={nav} cells={[
      ["bad", rows.filter((r) => r.sev === "bad").length, tx("graves"), undefined, OVERVIEW], ["warn", rows.filter((r) => r.sev === "warn").length, tx("à vérifier"), undefined, OVERVIEW],
      ["warn", count("sites"), tx("sites"), undefined, "security/sites"], ["warn", count("certs"), tx("certificats"), undefined, "security/certs"]]} />
  );
}
