/** @type {import('tailwindcss').Config} */
// Couleurs de la page actuelle (web/index.html) en variables CSS (src/index.css) : thème sombre par défaut,
// thème clair par la classe « light » sur <html>. Les couleurs d'état restent les mêmes dans les deux.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"), bg2: v("bg2"), card: v("card"), line: v("line"),
        txt: v("txt"), muted: v("muted"), dim: v("dim"),
        ok: v("ok"), warn: v("warn"), bad: v("bad"), link: v("link"),
        npm: v("npm"), loc: v("loc"), apache: v("apache"),
      },
      fontFamily: { mono: ["ui-monospace", "Menlo", "monospace"] },
    },
  },
  plugins: [],
};
