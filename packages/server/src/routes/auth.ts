import type { FastifyInstance, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import type { ServerContext } from "../index.js";
import {
  hasOwner,
  createOwner,
  getOwner,
  verifyOwnerPassword,
  getJwtSecret,
} from "@personal-ai/core";

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";

function signTokens(payload: { sub: string; email: string }, secret: string) {
  const accessToken = jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_EXPIRY });
  const refreshToken = jwt.sign({ ...payload, type: "refresh" }, secret, { expiresIn: REFRESH_TOKEN_EXPIRY });
  return { accessToken, refreshToken };
}

interface CookieSetter {
  setCookie(name: string, value: string, opts: Record<string, unknown>): unknown;
  clearCookie(name: string, opts: Record<string, unknown>): unknown;
}

function setCookies(reply: CookieSetter, accessToken: string, refreshToken: string, isProd: boolean) {
  const cookieOpts = {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
  };
  reply.setCookie("pai_access", accessToken, { ...cookieOpts, maxAge: 15 * 60 });
  reply.setCookie("pai_refresh", refreshToken, { ...cookieOpts, maxAge: 7 * 24 * 60 * 60 });
}

/** Extract JWT from cookie or Authorization header */
export function extractToken(request: FastifyRequest): string | null {
  // 1. httpOnly cookie (browser)
  const cookie = request.cookies?.["pai_access"];
  if (cookie) return cookie;
  // 2. Authorization: Bearer header (API clients)
  const auth = request.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

export function registerAuthRoutes(app: FastifyInstance, serverCtx: ServerContext): void {
  const isProd = !!process.env.PORT;

  app.get("/api/auth/status", async (request) => {
    // On localhost, auth is not enforced — but still require setup for owner identity
    if (!serverCtx.authEnabled) {
      const needsSetup = !hasOwner(serverCtx.ctx.storage);
      return { setup: needsSetup, authenticated: !needsSetup };
    }

    const needsSetup = !hasOwner(serverCtx.ctx.storage);
    let authenticated = false;
    const secret = getJwtSecret(serverCtx.ctx.storage, process.env.PAI_JWT_SECRET);
    const token = extractToken(request);
    if (token) {
      try {
        jwt.verify(token, secret);
        authenticated = true;
      } catch { /* invalid token */ }
    }
    return { setup: needsSetup, authenticated };
  });

  app.post("/api/auth/setup", async (request, reply) => {
    if (hasOwner(serverCtx.ctx.storage)) {
      return reply.status(400).send({ error: "Owner already exists" });
    }
    const body = request.body as { email?: string; password?: string; name?: string };
    if (!body.name?.trim() || !body.email || !body.password) {
      return reply.status(400).send({ error: "Name, email, and password are required" });
    }
    if (body.password.length < 8) {
      return reply.status(400).send({ error: "Password must be at least 8 characters" });
    }

    const owner = await createOwner(serverCtx.ctx.storage, {
      email: body.email,
      password: body.password,
      name: body.name,
    });

    const secret = getJwtSecret(serverCtx.ctx.storage, process.env.PAI_JWT_SECRET);
    const { accessToken, refreshToken } = signTokens({ sub: owner.id, email: owner.email }, secret);
    setCookies(reply, accessToken, refreshToken, isProd);
    return { ok: true, owner: { id: owner.id, email: owner.email, name: owner.name } };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return reply.status(400).send({ error: "Email and password are required" });
    }

    const valid = await verifyOwnerPassword(serverCtx.ctx.storage, body.email, body.password);
    if (!valid) {
      return reply.status(401).send({ error: "Invalid email or password" });
    }

    const owner = getOwner(serverCtx.ctx.storage);
    if (!owner) {
      return reply.status(401).send({ error: "Invalid email or password" });
    }

    const secret = getJwtSecret(serverCtx.ctx.storage, process.env.PAI_JWT_SECRET);
    const { accessToken, refreshToken } = signTokens({ sub: owner.id, email: owner.email }, secret);
    setCookies(reply, accessToken, refreshToken, isProd);
    return { ok: true, owner: { id: owner.id, email: owner.email, name: owner.name } };
  });

  app.post("/api/auth/refresh", async (request, reply) => {
    const refreshCookie = request.cookies?.["pai_refresh"];
    if (!refreshCookie) {
      return reply.status(401).send({ error: "No refresh token" });
    }

    const secret = getJwtSecret(serverCtx.ctx.storage, process.env.PAI_JWT_SECRET);
    try {
      const decoded = jwt.verify(refreshCookie, secret) as { sub: string; email: string; type?: string };
      if (decoded.type !== "refresh") {
        return reply.status(401).send({ error: "Invalid token type" });
      }
      const { accessToken, refreshToken } = signTokens({ sub: decoded.sub, email: decoded.email }, secret);
      setCookies(reply, accessToken, refreshToken, isProd);
      return { ok: true };
    } catch {
      return reply.status(401).send({ error: "Invalid or expired refresh token" });
    }
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie("pai_access", { path: "/" });
    reply.clearCookie("pai_refresh", { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (request, reply) => {
    // Localhost bypass — return owner if exists, or a placeholder
    if (!serverCtx.authEnabled) {
      const owner = getOwner(serverCtx.ctx.storage);
      return { owner: owner ? { id: owner.id, email: owner.email, name: owner.name } : { id: "local", email: "local@localhost", name: "Local User" } };
    }

    const secret = getJwtSecret(serverCtx.ctx.storage, process.env.PAI_JWT_SECRET);
    const token = extractToken(request);
    if (!token) return reply.status(401).send({ error: "Not authenticated" });

    try {
      const decoded = jwt.verify(token, secret) as { sub: string; email: string };
      const owner = getOwner(serverCtx.ctx.storage);
      if (!owner || owner.id !== decoded.sub) {
        return reply.status(401).send({ error: "Not authenticated" });
      }
      return { owner: { id: owner.id, email: owner.email, name: owner.name } };
    } catch {
      return reply.status(401).send({ error: "Not authenticated" });
    }
  });
}
