// Home page counters for the network: the UniFi equipment read through MynetworK, and the findings of the Diagnostic (read here, once a minute)
import { Router } from "lucide-react";
import { useCallback, useState } from "react";
import type { Snapshot } from "../api";
import { read } from "../api";
import { usePoll } from "../lib/polling";
import { tx } from "../lib/i18n";
import type { TabId } from "../lib/summary";
import { Group, Mark, type Open } from "./StatGroup";

interface Found { summary: { bad: number; warn: number; info: number } }

export function NetworkGroup({ snap, nav, counts }: Readonly<{ snap: Snapshot; nav: Open; counts: { devices: number; online: number }; tab: TabId }>) {
  const [found, setFound] = useState<Found | null>(null);
  const load = useCallback(() => { read<Found>("network/diagnostics").then(setFound).catch(() => setFound(null)); }, []);
  usePoll(load, 60_000);
  const lanDevices = (snap.data.network ?? []).reduce((n, c) => n + (c.devices?.length ?? 0), 0);
  const total = counts.devices || lanDevices;
  return (
    <Group mark={<Mark Icon={Router} />} title={tx("Réseau")} sub={tx("{0} équipements", total)} accent="border-l-link" tab="network" nav={nav} cells={[
      ["ok", counts.online, tx("en ligne")], ["bad", counts.devices - counts.online, tx("hors ligne")],
      ["bad", found?.summary.bad ?? 0, tx("à corriger")], ["warn", found?.summary.warn ?? 0, tx("à vérifier")]]} />
  );
}
