/** @type {import('tailwindcss').Config} */
// .cjs on purpose: a running Vite never reads an ES module config again, even after a page reload (Node keeps it in its module cache).
// Couleurs de la page actuelle (web/index.html) en variables CSS (src/index.css) : thème sombre par défaut,
// thème clair par la classe « light » sur <html>, autres thèmes sombres par « theme-<id> ».
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"), bg2: v("bg2"), card: v("card"), line: v("line"),
        txt: v("txt"), muted: v("muted"), dim: v("dim"), field: v("field"), "field-txt": v("field-txt"),
        ok: v("ok"), warn: v("warn"), bad: v("bad"), link: v("link"), accent: v("accent"),
        npm: v("npm"), loc: v("loc"), apache: v("apache"),
      },
      fontFamily: { mono: ["ui-monospace", "Menlo", "monospace"] },
    },
  },
  plugins: [],
};
