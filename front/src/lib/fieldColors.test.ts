import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

type Rgb = [number, number, number];

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
function contrast(a: Rgb, b: Rgb) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
const over = (fg: Rgb, bg: Rgb, alpha: number) => fg.map((v, i) => alpha * v + (1 - alpha) * bg[i]) as Rgb;

/** The colours of each theme of index.css: every rule that gives a text colour is a theme */
function themes() {
  return [...css.matchAll(/([^{}]*)\{([^{}]*--txt:[^{}]*)\}/g)].map(([, head, body]) => {
    const color = (name: string) => {
      const found = new RegExp(`--${name}: (\\d+) (\\d+) (\\d+);`).exec(body);
      return found ? found.slice(1).map(Number) as Rgb : undefined;
    };
    return { name: head.trim(), field: color("field"), text: color("field-txt") ?? color("txt"), card: color("card"), bg: color("bg") };
  });
}

describe("fields of every theme", () => {
  it("finds the eight themes", () => expect(themes()).toHaveLength(8));
  it.each(themes())("$name: what is typed reads well on a background of its own", ({ field, text, card, bg }) => {
    expect(field).toBeDefined();
    expect(contrast(text!, field!)).toBeGreaterThanOrEqual(7);
    expect(contrast(over(text!, field!, 0.75), field!)).toBeGreaterThanOrEqual(4.5);   // placeholder:text-field-txt/75 (lib/forms.ts)
    expect(contrast(field!, card!)).toBeGreaterThanOrEqual(1.1);
    expect(contrast(field!, bg!)).toBeGreaterThanOrEqual(1.1);
  });
});
