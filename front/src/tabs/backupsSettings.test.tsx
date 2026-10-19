import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BackupsSettings, sourceOf, type SetRow } from "./BackupsSettings";

const base: SetRow = { id: "a", label: "x", origin: "srv", path: null, veeam_job: null, pbs_group: null, max_age_days: 2, ha: false, editable: false, expect_offsite: false };

describe("Réglages › Sauvegardes", () => {
  it("names the source of a set from its first location", () => {
    expect(sourceOf({ ...base, path: "/home/backup" })).toBe("folders");
    expect(sourceOf({ ...base, path: "/x", remote: true })).toBe("remote");
    expect(sourceOf({ ...base, veeam_job: "Docs" })).toBe("veeam");
    expect(sourceOf({ ...base, pbs_group: "vm/100" })).toBe("pbs");
    expect(sourceOf({ ...base, synology_task: "1" })).toBe("synology");
    expect(sourceOf({ ...base, path: "/dump", vzdump: "100" })).toBe("vzdump");
    expect(sourceOf({ ...base, ha: true })).toBe("ha");
  });
  it("says it is loading before the settings arrive", () => {
    (globalThis as { location?: unknown }).location = { hash: "#settings/backups" };
    expect(renderToStaticMarkup(<BackupsSettings />)).toContain("Chargement");
  });
});
