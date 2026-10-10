// Installation neuve : Docker illisible parce que la clé de l'app n'est pas encore autorisée sur la machine.
// Commande à copier, puis « Tester » (vérification de la machine, et nouveau passage de la collecte si elle répond).
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { act, primary, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import type { Connector, SystemState } from "../types";
import { Copyable, NoteLine } from "./form";
import { Card } from "./ui";

export function AuthorizeKey({ failing }: { failing: Connector[] }) {
  const [cmd, setCmd] = useState<string | null>(null), [busy, setBusy] = useState(false), [note, setNote] = useState<Note>(null);
  useEffect(() => {
    read<SystemState>("system").then((s) => setCmd(s.ssh.authorize || null))
      .catch((e) => { if (e instanceof LoginRequired) location.replace(LOGIN); });
  }, []);
  if (!failing.length || !cmd) return null;
  const test = async () => {
    setBusy(true);
    await act(async () => {
      const bad: string[] = [];
      for (const c of failing) {
        const r = await send<{ lines: string[]; failed: number }>("POST", `machines/settings/${c.name}/check`);
        if (r.failed) bad.push(c.name);
      }
      if (bad.length) throw new Error(tx("toujours illisible : {0}", bad.join(", ")));
      await send("POST", "system/tasks/collect/run");
    }, tx("clé acceptée : nouveau passage de la collecte lancé, les conteneurs apparaissent dans un instant"), setNote);
    setBusy(false);
  };
  return (
    <Card className="mb-3 border-warn/50">
      <h2 className="mb-1 flex items-center gap-2 font-bold"><KeyRound size={16} />{tx("Autoriser la clé de MyServices sur cette machine")}</h2>
      <p className="mb-2 text-sm text-muted">
        {tx("Docker n'est pas lisible sur {0} : la clé SSH de l'app n'y est pas encore autorisée. Lancer cette commande sur la machine, avec le compte visé (membre du groupe docker), puis tester.", failing.map((c) => c.name).join(", "))}
      </p>
      <Copyable text={cmd} />
      <div className="mt-2"><button type="button" className={primary} disabled={busy} onClick={() => void test()}>{busy ? tx("Test…") : tx("Tester")}</button></div>
      <NoteLine note={note} />
    </Card>
  );
}
