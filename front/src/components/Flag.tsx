import type { Lang } from "../lib/i18n";

/** Drapeau en SVG (les émojis de drapeau ne s'affichent pas sous Windows) */
export function Flag({ lang, className = "h-5 w-7" }: { lang: Lang; className?: string }) {
  return (
    <svg viewBox="0 0 30 20" className={`${className} shrink-0 rounded-[3px] shadow-sm ring-1 ring-black/20`} aria-hidden>
      {lang === "fr" ? (
        <>
          <rect width="10" height="20" fill="#0055a4" /><rect x="10" width="10" height="20" fill="#fff" /><rect x="20" width="10" height="20" fill="#ef4135" />
        </>
      ) : (
        <>
          <rect width="30" height="20" fill="#012169" />
          <path d="M0 0 30 20M30 0 0 20" stroke="#fff" strokeWidth="4" />
          <path d="M0 0 30 20M30 0 0 20" stroke="#c8102e" strokeWidth="1.6" />
          <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6.5" />
          <path d="M15 0v20M0 10h30" stroke="#c8102e" strokeWidth="3.6" />
        </>
      )}
    </svg>
  );
}
