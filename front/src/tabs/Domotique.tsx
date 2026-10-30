// « Domotique »: one sub-page per brand (Netatmo, Tapo), each shown only when its connector reads something.
import { Plug } from "lucide-react";
import type { Snapshot } from "../api";
import { Empty } from "../components/ui";
import { hasDomotique } from "../lib/domotique";
import { tx } from "../lib/i18n";
import { usePageView } from "../lib/route";
import { hasTapo } from "../lib/tapo";
import { DomotiqueOverview } from "./DomotiqueOverview";
import { Netatmo } from "./Netatmo";
import { Tapo } from "./Tapo";

const VIEWS = ["overview", "netatmo", "tapo"] as const;

const Nothing = ({ children, admin }: Readonly<{ children: React.ReactNode; admin: boolean }>) => (
  <div className="py-4"><Empty>{children}</Empty>
    {admin && <a href="#settings/connectors" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-link hover:underline"><Plug size={14} aria-hidden />{tx("Connecteurs")}</a>}
  </div>
);

export function Domotique({ snap, route }: Readonly<{ snap: Snapshot; route: string }>) {
  const view = usePageView(route, "domotique", VIEWS, "overview"), admin = snap.me.role === "admin";
  if (view === "overview") return <DomotiqueOverview snap={snap} />;
  if (view === "tapo") return hasTapo(snap) ? <Tapo snap={snap} /> : <Nothing admin={admin}>{tx("Aucun appareil Tapo lu : relie le connecteur Tapo dans Connecteurs.")}</Nothing>;
  return hasDomotique(snap) ? <Netatmo snap={snap} /> : <Nothing admin={admin}>{tx("Aucun appareil lu : relie le connecteur Netatmo ou Home Assistant dans Connecteurs.")}</Nothing>;
}
