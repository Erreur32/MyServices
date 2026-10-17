// Fenêtre de réglage de l'assistant : tout se règle ici, sans quitter la page. Elle ne contient aucune logique propre : elle assemble les
// composants qui servent déjà dans Réglages (guide SSH, installation d'agent, formulaire de connecteur, de canal d'alerte, ajout de machine).
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { read } from "../api";
import type { Snapshot } from "../api";
import { ChannelForm } from "../tabs/Alerts";
import { ConnectorForm } from "../tabs/Connectors";
import { Detect } from "../tabs/MachinesSettings";
import { AgentInstall, type AgentKind } from "./AgentInstall";
import { Overlay } from "./Overlay";
import { SshGuide } from "./SshGuide";
import { Dim } from "./ui";
import { saveSshAlias } from "../lib/machineAccess";
import { connectorsFor } from "../lib/access";
import { quiet } from "../lib/forms";
import { tx } from "../lib/i18n";
import type { ConnectorsState, MachinesSettings, Proposal } from "../types";

export type Setup =
  | { kind: "ssh"; ip: string; name: string }
  | { kind: "agent"; ip: string; name: string; agent: AgentKind | null }
  | { kind: "connector"; ip: string; name: string; proposal?: Proposal }
  | { kind: "channel" }
  | { kind: "machine" };

const TITLE: Record<Setup["kind"], () => string> = {
  ssh: () => tx("Accès SSH"), agent: () => tx("Agent"), connector: () => tx("Connecteur"),
  channel: () => tx("Ajouter un canal d'alerte"), machine: () => tx("Ajouter une machine"),
};

export function SetupModal({ setup, snap, onClose, onSwitch }: { setup: Setup; snap: Snapshot; onClose: () => void; onSwitch: (s: Setup) => void }) {
  const named = "name" in setup ? ` · ${setup.name}` : "";
  return (
    <Overlay title={<>{TITLE[setup.kind]()}{named && <Dim>{named}</Dim>}</>} onClose={onClose}>
      <div className="mt-3">
        {setup.kind === "ssh" && <SshSetup ip={setup.ip} onClose={onClose} />}
        {setup.kind === "agent" && (
          <AgentInstall target={{ ip: setup.ip, name: setup.name, kind: setup.agent ?? "linux", choose: true }} onClose={onClose}
            onSsh={() => onSwitch({ kind: "ssh", ip: setup.ip, name: setup.name })} />
        )}
        {setup.kind === "connector" && <ConnectorSetup setup={setup} snap={snap} onClose={onClose} />}
        {setup.kind === "channel" && <ChannelForm onDone={onClose} onCancel={onClose} />}
        {setup.kind === "machine" && <MachineSetup onClose={onClose} />}
      </div>
    </Overlay>
  );
}

const Loading = () => <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" aria-hidden />{tx("Chargement…")}</p>;

/** Guide SSH (compte, commande à lancer sur la machine, test), puis enregistrement de l'accès */
function SshSetup({ ip, onClose }: { ip: string; onClose: () => void }) {
  const [st, setSt] = useState<MachinesSettings | null>(null);
  useEffect(() => { read<MachinesSettings>("machines/settings").then(setSt).catch(() => undefined); }, []);
  if (!st) return <Loading />;
  const known = st.aliases.find((a) => a.ip === ip);
  return <SshGuide ip={ip} user={known?.user} port={known?.port} guess={st.machines[ip]?.os === "windows" ? "windows" : "linux"}
    onReady={async (alias) => { await saveSshAlias(ip, alias); onClose(); }} onCancel={onClose} />;
}

/** Formulaire du connecteur de l'outil reconnu ; sans outil précis, les outils reconnus sur cette machine */
function ConnectorSetup({ setup, snap, onClose }: { setup: Extract<Setup, { kind: "connector" }>; snap: Snapshot; onClose: () => void }) {
  const [types, setTypes] = useState<ConnectorsState["types"] | null>(null), [picked, setPicked] = useState<{ type: string; url: string } | undefined>(setup.proposal && { type: setup.proposal.connector, url: setup.proposal.url });
  useEffect(() => { read<ConnectorsState>("connectors/settings").then((c) => setTypes(c.types)).catch(() => setTypes([])); }, []);
  if (!types) return <Loading />;
  const type = picked && types.find((t) => t.type === picked.type);
  if (picked && type) {
    return <ConnectorForm type={type} prefill={{ type: picked.type, name: picked.type, url: picked.url }} hosts={snap.data.hosts} onDone={onClose} onCancel={onClose} />;
  }
  // Outils reconnus sur cette adresse (un clic, adresse déjà remplie), puis les outils qui savent lire ce genre d'équipement (box, passerelle…)
  const m = snap.data.machine_list.find((x) => x.ip === setup.ip);
  const seen = (snap.data.proposals ?? []).filter((p) => p.ip === setup.ip).map((p) => ({ type: p.connector, label: p.label, url: p.url, why: tx("reconnu sur cette machine") }));
  const fits = connectorsFor(m ?? { name: setup.name }, types).filter((t) => !seen.some((s) => s.type === t.type))
    .map((t) => ({ type: t.type, label: t.label, url: "", why: t.kinds.includes("network") ? tx("lit les équipements du réseau (box, bornes, passerelles)") : tx("adapté à cet équipement") }));
  const list = [...seen, ...fits];
  return list.length === 0
    ? <p className="text-sm text-muted">{tx("Aucun connecteur adapté à cette machine.")}</p>
    : (
      <>
        <p className="mb-3 text-sm text-muted">{tx("Un outil que vous utilisez déjà peut lire cette machine. Choisissez-le, MyServices demande ensuite son adresse et une clé en lecture seule.")}</p>
        <ul className="flex flex-col gap-2">{list.map((c) => (
          <li key={c.type} className="flex flex-wrap items-center gap-2 rounded-lg bg-bg2/60 px-3 py-2">
            <b className="text-sm">{c.label}</b><Dim>{c.why}</Dim>
            <button type="button" className={`${quiet} ml-auto`} onClick={() => setPicked({ type: c.type, url: c.url })}>{tx("Configurer")}</button>
          </li>
        ))}</ul>
      </>
    );
}

/** Ajout manuel : IP, nom ou alias, détection, puis enregistrement */
function MachineSetup({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<MachinesSettings | null>(null);
  useEffect(() => { read<MachinesSettings>("machines/settings").then(setSt).catch(() => undefined); }, []);
  return st ? <Detect st={st} onDone={onClose} onCancel={onClose} /> : <Loading />;
}
