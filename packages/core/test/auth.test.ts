import { describe, it, expect, beforeEach } from "vitest";
import { createStorage } from "../src/storage.js";
import {
  authMigrations,
  createOwner,
  getOwner,
  getOwnerByEmail,
  verifyOwnerPassword,
  hasOwner,
  getJwtSecret,
} from "../src/auth.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("auth", () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "pai-auth-test-"));
    storage = createStorage(dir);
    storage.migrate("auth", authMigrations);
  });

  it("hasOwner returns false when no owner exists", () => {
    expect(hasOwner(storage)).toBe(false);
  });

  it("createOwner creates an owner and hasOwner returns true", async () => {
    const owner = await createOwner(storage, {
      email: "test@example.com",
      password: "securepassword123",
      name: "Test User",
    });
    expect(owner.id).toBeDefined();
    expect(owner.email).toBe("test@example.com");
    expect(owner.name).toBe("Test User");
    expect(hasOwner(storage)).toBe(true);
  });

  it("createOwner throws if owner already exists", async () => {
    await createOwner(storage, { email: "a@b.com", password: "pass123456" });
    await expect(
      createOwner(storage, { email: "c@d.com", password: "pass123456" }),
    ).rejects.toThrow("Owner already exists");
  });

  it("getOwner returns the owner", async () => {
    await createOwner(storage, { email: "test@example.com", password: "pass123456" });
    const owner = getOwner(storage);
    expect(owner).not.toBeNull();
    expect(owner!.email).toBe("test@example.com");
  });

  it("getOwnerByEmail returns the owner", async () => {
    await createOwner(storage, { email: "test@example.com", password: "pass123456" });
    const owner = getOwnerByEmail(storage, "test@example.com");
    expect(owner).not.toBeNull();
    expect(owner!.email).toBe("test@example.com");
  });

  it("getOwnerByEmail returns null for unknown email", () => {
    expect(getOwnerByEmail(storage, "nope@example.com")).toBeNull();
  });

  it("verifyOwnerPassword returns true for correct password", async () => {
    await createOwner(storage, { email: "test@example.com", password: "correcthorse" });
    const result = await verifyOwnerPassword(storage, "test@example.com", "correcthorse");
    expect(result).toBe(true);
  });

  it("verifyOwnerPassword returns false for wrong password", async () => {
    await createOwner(storage, { email: "test@example.com", password: "correcthorse" });
    const result = await verifyOwnerPassword(storage, "test@example.com", "wrongpassword");
    expect(result).toBe(false);
  });

  it("verifyOwnerPassword returns false for unknown email", async () => {
    const result = await verifyOwnerPassword(storage, "nope@example.com", "whatever");
    expect(result).toBe(false);
  });

  it("getJwtSecret generates and persists a secret", () => {
    const secret = getJwtSecret(storage);
    expect(secret).toBeDefined();
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(getJwtSecret(storage)).toBe(secret);
  });
});
