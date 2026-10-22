// « Changed recently » badge of a service whose target (ip:port) changed less than 7 days ago (last_known.py): the old name is not kept
import type { Host } from "../types";
import { dateTime } from "../lib/format";
import { tx } from "../lib/i18n";
import { Badge } from "./ui";

export function TargetChanged({ r }: Readonly<{ r: Host }>) {
  if (!r.target_changed) return null;
  return <Badge tone="info" outline title={tx("Cible changée le {0} : avant {1}", dateTime(r.target_changed), r.target_before ?? "?")}>{tx("changé récemment")}</Badge>;
}
