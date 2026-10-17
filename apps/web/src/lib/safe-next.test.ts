import { describe, expect, it } from "vitest";
import { safeNext, sameOriginPath } from "./safe-next";

const origin = "https://studio.example.com";

describe("safeNext", () => {
  it("keeps same-origin paths", () => {
    expect(safeNext("/org/1/ads?x=1#y", origin)).toBe("/org/1/ads?x=1#y");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "@evil.example", ".evil", "javascript:alert(1)", "", null, undefined])(
    "falls back to / for %s",
    (value) => {
      expect(safeNext(value, origin)).toBe("/");
      expect(sameOriginPath(value, origin)).toBeNull();
    }
  );
});
