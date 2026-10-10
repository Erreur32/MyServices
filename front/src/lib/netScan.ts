// Recherche réseau (netscan.py) côté page : état relu à chaque mise à jour de la barre du haut.
import { useCallback, useEffect, useState } from "react";
import { LOGIN, LoginRequired, read } from "../api";
import type { NetScan } from "../types";
import { useScan } from "./scan";

export type NetState = "idle" | "run" | "found";

export function useNetScan(): { net: NetScan | null; reload: () => void } {
  const [net, setNet] = useState<NetScan | null>(null);
  const scan = useScan();
  const reload = useCallback(() => {
    read<NetScan>("network/scan").then(setNet).catch((e) => { if (e instanceof LoginRequired) location.replace(LOGIN); });
  }, []);
  useEffect(reload, [reload]);
  const n = scan?.network;
  useEffect(() => { if (n) reload(); }, [n?.running, n?.done, n?.found, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  return { net, reload };
}

export function netState(net: NetScan | null): NetState {
  return net && (net.phase === "ping" || net.phase === "identify") ? "run" : net && net.found.length ? "found" : "idle";
}
