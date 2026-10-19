import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("test harness", () => {
  it("runs in the workerd runtime", () => {
    expect(navigator.userAgent).toBe("Cloudflare-Workers");
  });

  it("resolves the @/* alias and imports project modules", () => {
    expect(cn("px-2 py-1", { hidden: false }, "px-4")).toBe("py-1 px-4");
  });
});
