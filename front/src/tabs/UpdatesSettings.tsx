// Settings → Updates: the version installed, the latest published on GitHub (with its notes), a check now, the automatic check
// (the server asks at most every 6 h) and the notice in the header. The check is one anonymous GET, never data sent.
import { ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { NoteLine, Switch } from "../components/form";
import { Badge, Card, Dim } from "../components/ui";
import { appVersion, dateTime } from "../lib/format";
import { act, primary, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { forgetDismissed } from "../lib/updateNotice";
import { InfoNote } from "../components/InfoNote";

interface Release { tag: string; name: string; url: string; published: string | null; prerelease: boolean; notes: string }
interface About { version: string; released?: string | null; running: string | null; latest: Release | null; checked_at: number | null; error: string | null; enabled: boolean; header: boolean; update_available: boolean }

/** State of the version installed against the latest one published */
function Status({ a }: Readonly<{ a: About }>) {
  if (a.update_available) return <Badge tone="info">{tx("Mise à jour disponible")}</Badge>;
  if (a.running) return <Badge tone="ok">{tx("À jour")}</Badge>;
  return <Badge tone="off" title={tx("Image de développement : pas de numéro de version à comparer")}>{tx("version de développement")}</Badge>;
}

export function UpdatesSettings() {
  const [a, setA] = useState<About | null>(null), [error, setError] = useState(""), [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    read<About>("about").then((r) => { setA(r); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(load, [load]);
  if (!a) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  const check = async () => {
    setBusy(true);
    await act(async () => { setA(await send<About>("POST", "about/check")); }, tx("vérifié"), setNote);
    setBusy(false);
  };
  const saved = (header?: boolean) => {
    if (header) forgetDismissed();   // turned back on: show the notice even for a version hidden before
    load();
  };
  const save = (body: { auto?: boolean; header?: boolean }, done: string) => void act(() => send("PUT", "about/settings", body), done, setNote)
    .then((ok) => ok && saved(body.header));
  const latest = a.latest;
  return (
    <div className="flex flex-col gap-4">
      <Card className={a.update_available ? "border-link/50" : ""}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 font-bold"><RefreshCw size={16} aria-hidden />{tx("Mises à jour")}</h2>
          <Status a={a} />
          <button type="button" className={`${primary} ml-auto`} disabled={busy} onClick={() => void check()} title={tx("Interroger GitHub maintenant (une requête anonyme)")}>
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} aria-hidden />{tx("Vérifier maintenant")}
          </button>
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="text-dim">{tx("Version installée")}</dt><dd><code className="font-mono">{appVersion(a.version, a.released) || a.version}</code></dd>
          <dt className="text-dim">{tx("Dernière publiée")}</dt>
          <dd>{latest ? <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <code className={`font-mono ${a.update_available ? "font-semibold text-link" : ""}`}>{latest.tag}</code>
            {latest.prerelease && <Dim>{tx("préversion")}</Dim>}{latest.published && <Dim>{dateTime(latest.published)}</Dim>}
            <a className="inline-flex items-center gap-1 text-link hover:underline" href={latest.url} target="_blank" rel="noopener noreferrer">{tx("Notes de version")}<ExternalLink size={12} aria-hidden /></a>
          </span> : <Dim>{a.error ?? tx("Pas encore vérifié.")}</Dim>}</dd>
          <dt className="text-dim">{tx("Dernière vérification")}</dt>
          <dd>{a.checked_at ? dateTime(a.checked_at * 1000) : <Dim>-</Dim>}{a.error && latest && <span className="text-warn"> · {a.error}</span>}</dd>
        </dl>
        {a.update_available && (
          <InfoNote className="mt-3">{tx("Pour mettre à jour : sauvegardez config/ et data/, puis récupérez la nouvelle image et relancez le conteneur.")} <code className="font-mono">docker compose pull && docker compose up -d</code></InfoNote>
        )}
        <NoteLine note={note} />
      </Card>

      <Card>
        <h2 className="mb-3 font-bold">{tx("Réglages")}</h2>
        <div className="flex flex-col divide-y divide-line/60">
          <label className="flex items-start justify-between gap-4 py-2.5">
            <span><b className="text-sm">{tx("Vérification automatique")}</b>
              <span className="block text-xs text-muted">{tx("Le serveur regarde la dernière version publiée sur GitHub au plus toutes les 6 h (une requête anonyme, aucune donnée envoyée). Coupée : seulement quand vous cliquez sur « Vérifier maintenant ».")}</span></span>
            <Switch on={a.enabled} label={tx("Vérification automatique")} onChange={(on) => save({ auto: on }, on ? tx("vérification automatique activée") : tx("vérification automatique coupée"))} />
          </label>
          <label className="flex items-start justify-between gap-4 py-2.5">
            <span><b className="text-sm">{tx("Annonce dans l'en-tête")}</b>
              <span className="block text-xs text-muted">{tx("Une pastille dans l'en-tête quand une nouvelle version est publiée. Sa croix la masque pour cette version seulement.")}</span></span>
            <Switch on={a.header} label={tx("Annonce dans l'en-tête")} onChange={(on) => save({ header: on }, on ? tx("annonce affichée") : tx("annonce masquée"))} />
          </label>
        </div>
      </Card>
    </div>
  );
}
