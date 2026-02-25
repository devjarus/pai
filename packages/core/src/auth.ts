import { nanoid } from "nanoid";
import { hashSync, compareSync } from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { Storage, Migration } from "./types.js";

export interface Owner {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

interface OwnerRow extends Owner {
  password: string;
}

export const authMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS owner (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];

export function hasOwner(storage: Storage): boolean {
  const row = storage.query<{ count: number }>("SELECT COUNT(*) as count FROM owner");
  return row[0]!.count > 0;
}

export function getOwner(storage: Storage): Owner | null {
  const rows = storage.query<Owner>("SELECT id, email, name, created_at FROM owner LIMIT 1");
  return rows.length > 0 ? rows[0]! : null;
}

export function getOwnerByEmail(storage: Storage, email: string): Owner | null {
  const rows = storage.query<Owner>("SELECT id, email, name, created_at FROM owner WHERE email = ?", [email]);
  return rows.length > 0 ? rows[0]! : null;
}

export async function createOwner(
  storage: Storage,
  input: { email: string; password: string; name?: string },
): Promise<Owner> {
  if (hasOwner(storage)) {
    throw new Error("Owner already exists");
  }
  const id = nanoid();
  const hashed = hashSync(input.password, 12);
  storage.run(
    "INSERT INTO owner (id, email, password, name) VALUES (?, ?, ?, ?)",
    [id, input.email, hashed, input.name ?? null],
  );
  return { id, email: input.email, name: input.name ?? null, created_at: new Date().toISOString() };
}

export async function verifyOwnerPassword(
  storage: Storage,
  email: string,
  password: string,
): Promise<boolean> {
  const rows = storage.query<OwnerRow>("SELECT * FROM owner WHERE email = ?", [email]);
  if (rows.length === 0) return false;
  return compareSync(password, rows[0]!.password);
}

export function resetOwnerPassword(storage: Storage, newPassword: string): boolean {
  if (!hasOwner(storage)) return false;
  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
  const hashed = hashSync(newPassword, 12);
  storage.run("UPDATE owner SET password = ?", [hashed]);
  return true;
}

export function getJwtSecret(storage: Storage, envSecret?: string): string {
  if (envSecret) return envSecret;
  const rows = storage.query<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'jwt_secret'",
  );
  if (rows.length > 0) return rows[0]!.value;
  const secret = randomBytes(48).toString("base64");
  storage.run("INSERT INTO settings (key, value) VALUES ('jwt_secret', ?)", [secret]);
  return secret;
}
