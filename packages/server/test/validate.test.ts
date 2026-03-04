import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validate } from "../src/validate.js";

describe("validate", () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().positive(),
    email: z.string().email().optional(),
  });

  it("returns parsed data for valid input", () => {
    const result = validate(schema, { name: "Alice", age: 30 });
    expect(result).toEqual({ name: "Alice", age: 30 });
  });

  it("returns parsed data with optional fields", () => {
    const result = validate(schema, { name: "Bob", age: 25, email: "bob@example.com" });
    expect(result).toEqual({ name: "Bob", age: 25, email: "bob@example.com" });
  });

  it("strips extra fields", () => {
    const result = validate(schema, { name: "Carol", age: 40, extra: "ignored" });
    expect(result).toEqual({ name: "Carol", age: 40 });
    expect(result).not.toHaveProperty("extra");
  });

  it("throws with statusCode 400 for missing required fields", () => {
    try {
      validate(schema, { age: 30 });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error & { statusCode: number }).statusCode).toBe(400);
      expect((err as Error).message).toBeTruthy();
    }
  });

  it("throws with statusCode 400 for wrong types", () => {
    try {
      validate(schema, { name: "Alice", age: "not-a-number" });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error & { statusCode: number }).statusCode).toBe(400);
    }
  });

  it("throws with statusCode 400 for invalid constraints", () => {
    try {
      validate(schema, { name: "", age: 30 }); // min(1) violated
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error & { statusCode: number }).statusCode).toBe(400);
    }
  });

  it("throws with statusCode 400 for invalid email", () => {
    try {
      validate(schema, { name: "Alice", age: 30, email: "not-an-email" });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error & { statusCode: number }).statusCode).toBe(400);
      expect((err as Error).message).toContain("email");
    }
  });

  it("combines multiple error messages", () => {
    try {
      validate(schema, { name: "", age: -1, email: "bad" });
      expect.fail("should have thrown");
    } catch (err) {
      const msg = (err as Error).message;
      // Should contain multiple issue messages joined by "; "
      expect(msg.split(";").length).toBeGreaterThanOrEqual(2);
    }
  });

  it("handles null input", () => {
    try {
      validate(schema, null);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error & { statusCode: number }).statusCode).toBe(400);
    }
  });

  it("handles undefined input", () => {
    try {
      validate(schema, undefined);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error & { statusCode: number }).statusCode).toBe(400);
    }
  });
});
