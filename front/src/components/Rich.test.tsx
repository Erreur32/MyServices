import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { machineTag, plainText, sinceTag } from "../lib/richText";
import { Rich } from "./Rich";

const line = `${machineTag("dev")} disque plein ${sinceTag("depuis 2 h")}\nerreurs noyau, sur ${machineTag("Tower", "machines/10.0.0.9")}`;

describe("Rich", () => {
  it("draws the machine as a badge, a link when it has an address, the duration in grey and one cause per line", () => {
    const html = renderToStaticMarkup(<Rich text={line} />);
    expect(html).toContain("dev</span>");
    expect(html).toContain('href="#machines/10.0.0.9"');
    expect(html).toContain("text-dim\"> · depuis 2 h</span>");
    expect(html).toContain("<br/>");
    expect(html).not.toContain("[[");
  });

  it("gives a tooltip the same words without markup", () => {
    expect(plainText(line)).toBe("dev disque plein, depuis 2 h, erreurs noyau, sur Tower");
    expect(machineTag("a|b]")).toBe("[[m:ab]]");   // a name cannot break the markup
  });
});
