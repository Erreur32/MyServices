// Schémas de l'infra (Archify) : liste commune à l'onglet Schémas et au menu du compte (GET /diagrams).
import { useEffect, useState } from "react";
import { LoginRequired, read } from "../api";

export interface Diagram { id: string; title: string; what: string; file: string; exists: boolean; updated: number | null; bytes: number; available: boolean; optional: boolean; enabled: boolean }
export interface DiagramList { diagrams: Diagram[]; archify: boolean; archify_url: string }

export function useDiagrams(enabled = true): [DiagramList | null, () => void] {
  const [d, setD] = useState<DiagramList | null>(null);
  const load = () => { read<DiagramList>("diagrams").then(setD).catch((e) => { if (!(e instanceof LoginRequired)) setD(null); }); };
  useEffect(() => { if (enabled) load(); }, [enabled]);  // eslint-disable-line react-hooks/exhaustive-deps
  return [d, load];
}
