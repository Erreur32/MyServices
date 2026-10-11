// Installation neuve : Docker illisible parce que la clé de l'app n'est pas encore autorisée sur la machine.
// Commande à copier, puis « Tester » (vérification de la machine, et nouveau passage de la collecte si elle répond).
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { act, primary, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { rereadMachines } from "../lib/scan";
import { authorizeFor } from "../lib/ssh";
import type { Connector, SystemState } from "../types";
import { Copyable, NoteLine } from "./form";
import { Card } from "./ui";

export function AuthorizeKey({ failing, bare = false, onAccepted, user, userOf }: { failing: Connector[]; bare?: boolean; onAccepted?: () => void; user?: string; userOf?: (c: Connector) => string }) {  // user : compte SSH commun ; userOf : compte de chaque machine (une commande par compte)  // user : compte SSH commun aux machines visées (chemin complet de authorized_keys)
  const [cmd, setCmd] = useState<string | null>(null), [busy, setBusy] = useState(false), [note, setNote] = useState<Note>(null);
  useEffect(() => {
    read<SystemState>("system").then((s) => setCmd(s.ssh.authorize || null))
      .catch((e) => { if (e instanceof LoginRequired) location.replace(LOGIN); });
  }, []);
  if (!failing.length || !cmd) return null;
  const keyOf = (c: Connector) => c.ip ?? c.name;   // l'IP : le nom d'un connecteur est celui de la machine, pas son adresse
  const test = async () => {
    setBusy(true);
    await act(async () => {
      const bad: string[] = [];
      for (const c of failing) {
        const r = await send<{ lines: string[]; failed: number }>("POST", `machines/settings/${encodeURIComponent(keyOf(c))}/check`);
        const why = r.lines.find((l) => l.startsWith("✗")) ?? r.lines.find((l) => l.startsWith("⚠"));
        if (r.failed || r.lines.some((l) => l.startsWith("✗") || l.startsWith("⚠"))) bad.push(why ? `${c.name} (${why.replace(/^[✗⚠]\s*/, "")})` : c.name);
      }
      if (bad.length) throw new Error(tx("toujours illisible : {0}", bad.join(" ; ")));
      onAccepted?.();
      await rereadMachines(failing.map(keyOf));
    }, tx("clé acceptée : relecture lancée, les conteneurs apparaissent dans un instant"), setNote);
    setBusy(false);
  };
  const groups = new Map<string, Connector[]>();   // compte SSH -> machines : une commande par compte
  for (const c of failing) { const u = userOf?.(c) ?? user ?? ""; groups.set(u, [...(groups.get(u) ?? []), c]); }
  const names = failing.map((c) => c.name).join(", ");
  const body = (
    <div className="flex flex-col gap-3">
      <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-muted">
        <b className="text-warn">{tx("Pourquoi cette carte ?")}</b>{" "}
        {tx("L'accès SSH de {0} est activé, mais la connexion par clé échoue : la clé de l'app n'est pas encore autorisée sur la machine. Tant que ce n'est pas fait, ses conteneurs, ses services et sa santé ne sont pas lus.", names)}
      </p>
      <div className="grid gap-x-6 gap-y-2 text-sm text-muted lg:grid-cols-2">
        <p>
          {tx("MyServices lit vos machines par SSH, en lecture seule, sans accès au socket Docker : c'est ce qui garde la main sur Docker hors de la page. Autoriser sa clé sur une machine lui permet de lire ses conteneurs, ses services et sa santé. La clé n'ouvre que le compte visé et se retire en supprimant sa ligne de authorized_keys.")}
        </p>
        <p>
          {tx("À faire : lancer cette commande sur {0}, avec le compte visé (membre du groupe docker), puis tester.", names)}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {[...groups].map(([u, cs]) => (
          <div key={u}>
            {groups.size > 1 && <p className="mb-1 text-sm text-muted">{tx("Sur")} <b className="text-txt">{cs.map((c) => c.name).join(", ")}</b>{tx(", connecté en")} <b className="text-txt">{u || "root"}</b> :</p>}
            <Copyable text={u ? authorizeFor(cmd, u) : cmd} oneLine />
          </div>
        ))}
        <div><button type="button" className={primary} disabled={busy} onClick={() => void test()}>{busy ? tx("Test…") : tx("Tester")}</button></div>
        <NoteLine note={note} />
      </div>
    </div>
  );
  if (bare) return body;
  return (
    <Card tone="warn">
      <h2 className="mb-1 flex items-center gap-2 font-bold"><KeyRound size={16} />{tx("Autoriser la clé de MyServices sur {0}", names)}</h2>
      {body}
    </Card>
  );
}
