// Réglages → À propos, sur le modèle de GpuViewR : identité du projet, version installée et dernière version publiée sur GitHub,
// puis le journal des changements (une version à la fois, choisie par un bouton).
import { ExternalLink, Github, RefreshCw, ScrollText } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LOGIN, LoginRequired, read, type Snapshot } from "../api";
import { SystemSettings } from "./SystemSettings";
import { Markdown } from "../components/Markdown";
import { Badge, Card, Dim } from "../components/ui";
import { parseChangelog } from "../lib/changelog";
import { appVersion } from "../lib/format";
import { quiet } from "../lib/forms";
import { tx } from "../lib/i18n";
import { GITHUB } from "../lib/links";

interface Release { tag: string; name: string; url: string; published: string | null; prerelease: boolean; notes: string }
interface About {
  version: string; released?: string | null; running: string | null; latest: Release | null; checked_at: number | null; error: string | null; enabled: boolean;
  update_available: boolean; changelog: string; repo: string;
}

export function AboutSettings({ snap }: Readonly<{ snap: Snapshot }>) {
  const [a, setA] = useState<About | null>(null), [error, setError] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const load = useCallback(() => {
    read<About>("about").then((r) => { setA(r); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(load, [load]);
  const sections = useMemo(() => parseChangelog(a?.changelog ?? ""), [a?.changelog]);
  if (!a) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;

  const cur = sections.find((s) => s.id === (picked ?? sections.find((x) => !x.unreleased)?.id)) ?? sections[0];
  const latest = a.latest;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={64} height={64} className="rounded-xl" />
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold leading-tight">MyServices</h2>
            <p className="text-sm text-muted">{tx("L'état de vos services et de vos machines, au même endroit, en lecture seule.")}</p>
            <p className="mt-1 text-xs text-dim">
              {tx("Version installée")} : <code className="font-mono text-txt">{appVersion(a.version, a.released) || a.version}</code>
              {a.update_available && latest && <> · {tx("Dernière publiée")} : <code className="font-mono font-semibold text-link">{latest.tag}</code></>}
            </p>
          </div>
          {snap.me.role === "admin" && <a href="#settings/updates" className={`${quiet} no-underline`}><RefreshCw size={14} aria-hidden />{tx("Mises à jour")} ›</a>}{/* the check and its setting: Application → Updates */}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge tone="warn" title={tx("Version en ligne, à un stade précoce : des écrans et des réglages peuvent encore changer")}>BETA</Badge>
          <Badge tone="ok">{tx("lecture seule")}</Badge>
          <Badge tone="info">Docker · amd64 · arm64</Badge>
          <Badge tone="off">{tx("licence MIT")}</Badge>
        </div>
      </Card>

      {snap.me.role === "admin" && <SystemSettings part="info" snap={snap} />}{/* the former « Informations » of Settings: one page with About */}
      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-bold"><ScrollText size={16} aria-hidden />{tx("Journal des changements")}</h2>
        {sections.length === 0 ? <Dim>{tx("Journal indisponible dans cette image.")}</Dim> : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label={tx("Version")}>
              {sections.slice(0, 12).map((s) => (
                <button key={s.id} type="button" role="tab" aria-selected={s.id === cur?.id} onClick={() => setPicked(s.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${s.id === cur?.id ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}>
                  {s.unreleased ? tx("En cours") : s.title}{s.date && <span className="ml-1.5 font-mono text-[10px] text-dim">{s.date}</span>}
                </button>
              ))}
            </div>
            {cur && <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-line/60 bg-bg2/40 p-4">{cur.unreleased && <p className="mb-2 text-xs text-warn">{tx("Pas encore publié : ce qui arrive dans la prochaine version.")}</p>}<Markdown text={cur.body} /></div>}
          </>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-dim">{tx("Auteur")}</span>
          <a className="inline-flex items-center gap-1 text-link hover:underline" href="https://github.com/Erreur32" target="_blank" rel="noopener noreferrer"><Github size={14} aria-hidden />Erreur32</a>
          <span className="text-dim">·</span>
          <a className="inline-flex items-center gap-1 text-link hover:underline" href={GITHUB} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden />{tx("Dépôt du projet")}</a>
          <span className="text-dim">·</span>
          <a className="inline-flex items-center gap-1 text-link hover:underline" href={`${GITHUB}/issues`} target="_blank" rel="noopener noreferrer">{tx("Signaler un problème")}</a>
          <span className="text-dim">·</span>
          <span className="text-muted">{tx("Schémas générés avec")} <a className="text-link hover:underline" href="https://github.com/tt-a1i/archify" target="_blank" rel="noopener noreferrer">Archify</a></span>
        </div>
      </Card>
    </div>
  );
}
