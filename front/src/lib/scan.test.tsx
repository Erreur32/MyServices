import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setScan, useScan } from "./scan";

const status = (tasks: string[]) => ({ running: false, progress: null, tasks });
const Shown = () => <>{useScan()?.tasks?.join()}</>;
const shown = () => renderToStaticMarkup(<Shown />);

describe("short tasks in the header", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { setScan(status([])); vi.advanceTimersByTime(10_000); vi.useRealTimers(); });

  it("keeps a task of a second on show for a few seconds, then lets it go alone", () => {
    setScan(status(["health"]));
    vi.advanceTimersByTime(1_000);
    setScan(status([]));
    expect(shown()).toBe("health");
    vi.advanceTimersByTime(3_500);
    expect(shown()).toBe("");
  });

  it("does not hold a task that was shown long enough", () => {
    setScan(status(["watch"]));
    vi.advanceTimersByTime(5_000);
    setScan(status([]));
    expect(shown()).toBe("");
  });
});
