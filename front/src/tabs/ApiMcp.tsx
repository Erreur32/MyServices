// Réglages → API et MCP, sur le modèle de MynetworK : jetons d'API (REST) et MCP (assistants IA), séparés.
// Trois niveaux (lecture, lecture + passages, admin) ; jeton montré une seule fois avec la configuration à copier ;
// révocation ; outils MCP activables un par un. Gérés seulement depuis une session admin.
import { Bot, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LOGIN, LoginRequired, read, ROOT, send } from "../api";
import { Field, NoteLine, Switch } from "../components/form";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Dim } from "../components/ui";
import { copyText } from "../lib/clipboard";
import { dateTime } from "../lib/format";
import type { ApiToken, TokensState } from "../types";
import { tx } from "../lib/i18n";

const LEVEL: Record<ApiToken["level"], [string, string]> = {
  read: ["lecture", tx("voir l'état, les machines, les services, l'historique")],
  runs: [tx("lecture + passages"), tx("en plus : demander un passage de la collecte")],
  admin: ["admin", tx("en plus : réglages (alertes, connecteurs, machines) ; jamais les comptes ni les jetons")],
};
const DAYS: [number | null, string][] = [[30, tx("30 jours")], [90, tx("90 jours")], [365, tx("1 an")], [null, tx("sans fin")]];

export function ApiMcp() {
  const [st, setSt] = useState<TokensState | null>(null);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ token: string; info: ApiToken } | null>(null);
  const reload = useCallback(() => {
    read<TokensState>("tokens")
      .then((s) => { setSt(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(reload, [reload]);
  if (!st) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  const origin = location.origin;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="flex items-center gap-2 font-bold"><KeyRound size={16} />{tx("API et MCP")}</h2>
        <p className="mt-1 text-sm text-muted">
          {tx("Deux sortes de jetons, chacune refusée chez l'autre :")} <b className="text-txt">{tx("API")}</b> {tx("(scripts, tableaux de bord : REST sous")} <code className="font-mono text-xs">{st.api_path}/</code>{tx(", doc")}{" "}
          <a className="text-link hover:underline" href={`${ROOT}api/v1/docs`} target="_blank" rel="noopener">{tx("OpenAPI")}</a>{tx(") et")}{" "}
          <b className="text-txt">{tx("MCP")}</b> {tx("(assistants IA : Claude, Cursor…). Réseau local et Tailscale seulement. Un jeton est montré")} <b className="text-txt">{tx("une seule fois")}</b> {tx("; seule son empreinte est gardée.")}
        </p>
      </Card>
      {created && <Created c={created} origin={origin} mcpPath={st.mcp_path} onClose={() => setCreated(null)} />}
      <NewToken onCreated={(c) => { setCreated(c); reload(); }} />
      <TokenList tokens={st.tokens} reload={reload} />
      <Tools st={st} reload={reload} />
    </div>
  );
}

function NewToken({ onCreated }: { onCreated: (c: { token: string; info: ApiToken }) => void }) {
  const [kind, setKind] = useState<"api" | "mcp">("mcp");
  const [name, setName] = useState(""), [level, setLevel] = useState<ApiToken["level"]>("read");
  const [days, setDays] = useState<number | null>(90), [pw, setPw] = useState("");
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const admin = level === "admin";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setNote(null);
    try {
      onCreated(await send<{ token: string; info: ApiToken }>("POST", "tokens", { kind, name, level, days: admin && !days ? 30 : days, password: admin ? pw : null }));
      setName(""); setPw("");
    } catch (err) {
      if (err instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (err as Error).message });
    }
    setBusy(false);
  };
  return (
    <Card>
      <h2 className="mb-3 font-bold">{tx("Nouveau jeton")}</h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={tx("Sorte")}>
            <select className={input} value={kind} onChange={(e) => setKind(e.target.value as "api" | "mcp")}>
              <option value="mcp">{tx("MCP (assistant IA)")}</option>
              <option value="api">{tx("API (REST)")}</option>
            </select>
          </Field>
          <Field label={tx("Nom (qui l'utilise)")}>
            <input className={input} required minLength={2} maxLength={64} placeholder={tx("ex. Claude Code portable")} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={tx("Durée de validité")}>
            <select className={input} value={String(days)} onChange={(e) => setDays(e.target.value === "null" ? null : Number(e.target.value))}>
              {DAYS.filter(([d]) => !(admin && d === null)).map(([d, l]) => <option key={String(d)} value={String(d)}>{l}</option>)}
            </select>
          </Field>
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm text-muted">{tx("Niveau")}</legend>
          {(Object.keys(LEVEL) as ApiToken["level"][]).map((l) => (
            <label key={l} className="flex items-start gap-2 text-sm">
              <input type="radio" name="level" className="mt-1" checked={level === l} onChange={() => setLevel(l)} />
              <span><b>{LEVEL[l][0]}</b> <Dim>· {LEVEL[l][1]}</Dim></span>
            </label>
          ))}
        </fieldset>
        {admin && (
          <Field label={tx("Ton mot de passe (requis pour un jeton admin)")}>
            <input className={`${input} max-w-xs`} type="password" required autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
        )}
        <div><button className={primary} disabled={busy}><Plus size={14} />{tx("Créer le jeton")}</button></div>
        <NoteLine note={note} />
      </form>
    </Card>
  );
}

function CopyBlock({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-dim">
        <span>{label}</span>
        <button type="button" className="inline-flex items-center gap-1 text-link hover:underline"
          onClick={() => void copyText(text).then((ok) => { setDone(ok); setTimeout(() => setDone(false), 1500); })}>
          <Copy size={12} />{done ? tx("copié") : tx("copier")}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-bg2 p-2.5 font-mono text-xs">{text}</pre>
    </div>
  );
}

function Created({ c, origin, mcpPath, onClose }: { c: { token: string; info: ApiToken }; origin: string; mcpPath: string; onClose: () => void }) {
  const url = `${origin}${mcpPath}`;
  return (
    <Card className="border-ok/50">
      <h2 className="mb-1 font-bold text-ok">{tx("Jeton «")} {c.info.name} {tx("» créé")}</h2>
      <p className="mb-3 text-sm text-warn">{tx("À copier maintenant : il ne sera plus jamais affiché.")}</p>
      <div className="flex flex-col gap-3">
        <CopyBlock label={tx("Jeton")} text={c.token} />
        {c.info.kind === "mcp" ? <>
          <CopyBlock label={tx("Claude Code")} text={`claude mcp add --transport http myservices ${url} --header "Authorization: Bearer ${c.token}"`} />
          <CopyBlock label={tx("Configuration JSON (Claude Desktop, Cursor… : mcpServers)")}
            text={JSON.stringify({ mcpServers: { myservices: { type: "http", url, headers: { Authorization: `Bearer ${c.token}` } } } }, null, 2)} />
        </> : (
          <CopyBlock label={tx("Essai")} text={`curl -H "Authorization: Bearer ${c.token}" ${origin}${ROOT}api/v1/status`} />
        )}
      </div>
      <button type="button" className={`${quiet} mt-3`} onClick={onClose}>{tx("C'est copié, fermer")}</button>
    </Card>
  );
}

function TokenList({ tokens, reload }: { tokens: ApiToken[]; reload: () => void }) {
  return (
    <Card>
      <h2 className="mb-2 font-bold">{tx("Jetons")} <Dim>· {tokens.filter((t) => t.state === "actif").length} {tx("actifs")}</Dim></h2>
      {tokens.length === 0 ? <p className="text-sm text-muted">{tx("Aucun jeton.")}</p> : (
        <ul className="flex flex-col divide-y divide-line/60">{tokens.map((t) => <TokenRow key={t.id} t={t} reload={reload} />)}</ul>
      )}
    </Card>
  );
}

function TokenRow({ t, reload }: { t: ApiToken; reload: () => void }) {
  const [confirm, setConfirm] = useState(false), [note, setNote] = useState<Note>(null);
  const live = t.state === "actif";
  return (
    <li className={`py-2.5 text-sm ${live ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={t.kind === "mcp" ? "info" : "off"}>{t.kind === "mcp" ? <><Bot size={12} />{tx("MCP")}</> : tx("API")}</Badge>
        <b>{t.name}</b><code className="font-mono text-xs text-dim">{tx("msv_")}{t.kind}_…{t.hint}</code>
        <Badge tone={t.level === "admin" ? "warn" : "off"}>{LEVEL[t.level][0]}</Badge>
        <Badge tone={live ? "ok" : "off"}>{t.state}</Badge>
        <span className="ml-auto">
          {live && (confirm ? <>
            <button type="button" className={danger} onClick={() => void act(() => send("DELETE", `tokens/${t.id}`), tx("révoqué"), setNote).then((ok) => ok && reload())}>{tx("Confirmer")}</button>
            <button type="button" className={`${quiet} ml-1.5`} onClick={() => setConfirm(false)}>{tx("Annuler")}</button>
          </> : <button type="button" className={danger} onClick={() => setConfirm(true)}><Trash2 size={14} />{tx("Révoquer")}</button>)}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-dim">
        {tx("créé le")} {dateTime(t.created * 1000)}{t.created_by && ` par ${t.created_by}`}
        {" · "}{t.expires ? tx("expire le {0}", dateTime(t.expires * 1000)) : tx("sans fin")}
        {" · "}{t.last_used ? tx("dernier usage {0} ({1})", dateTime(t.last_used * 1000), t.last_ip) : tx("jamais utilisé")}
        {t.revoked && tx(" · révoqué le {0}", dateTime(t.revoked * 1000))}
      </div>
      <NoteLine note={note} />
    </li>
  );
}

function Tools({ st, reload }: { st: TokensState; reload: () => void }) {
  const [note, setNote] = useState<Note>(null);
  return (
    <Card>
      <h2 className="mb-1 font-bold">{tx("Outils MCP")}</h2>
      <p className="mb-3 text-sm text-muted">{tx("Ce qu'un assistant peut faire avec un jeton MCP. Un outil coupé n'est plus proposé ni accepté, quel que soit le jeton.")}</p>
      <ul className="flex flex-col gap-2">
        {st.tools.map((t) => (
          <li key={t.name} className="flex items-start gap-3 text-sm">
            <Switch on={t.enabled} label={`${t.enabled ? tx("Couper") : tx("Activer")} ${t.name}`}
              onChange={(on) => void act(() => send("PATCH", `tokens/tools/${t.name}`, { enabled: on }), on ? `${t.name} activé` : `${t.name} coupé`, setNote).then((ok) => ok && reload())} />
            <div>
              <code className="font-mono text-xs">{t.name}</code> <Badge tone={t.level === "read" ? "off" : "warn"}>{LEVEL[t.level as ApiToken["level"]]?.[0] || t.level}</Badge>
              <div className="text-xs text-dim">{t.description}</div>
            </div>
          </li>
        ))}
      </ul>
      <NoteLine note={note} />
    </Card>
  );
}
