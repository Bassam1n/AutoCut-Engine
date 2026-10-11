import { describe, it, expect } from "vitest";
import { hashInput, redactedInputSummary } from "./redact";

describe("hashInput", () => {
  it("is deterministic for the same input regardless of key order", () => {
    const a = hashInput({ name: "Sarah", age: 30 });
    const b = hashInput({ age: 30, name: "Sarah" });
    expect(a).toBe(b);
  });

  it("differs for different input values", () => {
    const a = hashInput({ name: "Sarah" });
    const b = hashInput({ name: "Alex" });
    expect(a).not.toBe(b);
  });

  it("never contains the raw input values", () => {
    const hash = hashInput({ secret: "super-sensitive-value-12345" });
    expect(hash).not.toContain("super-sensitive-value-12345");
  });
});

describe("redactedInputSummary", () => {
  it("lists only field names, never values", () => {
    const summary = redactedInputSummary({ email: "real@email.com", name: "Real Name" });
    expect(summary).toBe("{email, name}");
    expect(summary).not.toContain("real@email.com");
    expect(summary).not.toContain("Real Name");
  });
});
