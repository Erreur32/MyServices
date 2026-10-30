// « Domotique »: one sub-page per brand (Netatmo, Tapo), each shown only when its connector reads something.
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

const Nothing = ({ children }: Readonly<{ children: React.ReactNode }>) => <div className="py-4"><Empty>{children}</Empty></div>;

export function Domotique({ snap, route }: Readonly<{ snap: Snapshot; route: string }>) {
  const view = usePageView(route, "domotique", VIEWS, "overview");
  if (view === "overview") return <DomotiqueOverview snap={snap} />;
  if (view === "tapo") return hasTapo(snap) ? <Tapo snap={snap} /> : <Nothing>{tx("Aucun appareil Tapo lu : relie le connecteur Tapo dans Connecteurs.")}</Nothing>;
  return hasDomotique(snap) ? <Netatmo snap={snap} /> : <Nothing>{tx("Aucun appareil lu : relie le connecteur Netatmo ou Home Assistant dans Connecteurs.")}</Nothing>;
}
