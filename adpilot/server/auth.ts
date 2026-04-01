import type { Express, NextFunction, Request, Response } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { db } from "./db";
import { users, type User, type NewUser } from "@shared/schema";
import { eq } from "drizzle-orm";

const PostgresSessionStore = connectPg(session);

type UserRole = "admin" | "member";
type UserStatus = "active" | "blocked";

interface StoredUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

declare module "express-session" {
  interface SessionData {
    authUserId?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      authUser?: SafeUser;
    }
  }
}

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
const USERS_FILE = path.join(DATA_BASE, "access_users.json");
const SESSION_SECRET = process.env.SESSION_SECRET || "adpilot-local-session-secret";
const BOOTSTRAP_EMAIL = (process.env.AUTH_BOOTSTRAP_EMAIL || "admin@adpilot.local").trim().toLowerCase();
const BOOTSTRAP_PASSWORD = process.env.AUTH_BOOTSTRAP_PASSWORD || "change-me-123";
const BOOTSTRAP_NAME = process.env.AUTH_BOOTSTRAP_NAME || "Administrator";

function ensureDataDir() {
  if (!fs.existsSync(DATA_BASE)) fs.mkdirSync(DATA_BASE, { recursive: true });
}

function createPasswordHash(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expected] = storedHash.split(":");
  if (!salt || !expected) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return derived.length === expectedBuffer.length && crypto.timingSafeEqual(derived, expectedBuffer);
}

function sanitizeUser(user: User): SafeUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  // Convert timestamps to ISO strings for frontend compatibility if needed
  return {
    ...safe,
    createdAt: (safe.createdAt as any)?.toISOString?.() || String(safe.createdAt),
    updatedAt: (safe.updatedAt as any)?.toISOString?.() || String(safe.updatedAt),
    lastLoginAt: (safe.lastLoginAt as any)?.toISOString?.() || (safe.lastLoginAt ? String(safe.lastLoginAt) : undefined),
  } as SafeUser;
}

async function ensureBootstrapUser() {
  const [existingAdmin] = await db.select().from(users).where(eq(users.email, BOOTSTRAP_EMAIL)).limit(1);
  if (!existingAdmin) {
    const now = new Date();
    await db.insert(users).values({
      id: crypto.randomUUID(),
      email: BOOTSTRAP_EMAIL,
      name: BOOTSTRAP_NAME,
      passwordHash: createPasswordHash(BOOTSTRAP_PASSWORD),
      role: "admin",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    console.log(`[Auth] Bootstrapped admin user: ${BOOTSTRAP_EMAIL}`);
  }
}

async function getUserById(id?: string): Promise<User | undefined> {
  if (!id) return undefined;
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}

async function getUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  return user;
}

async function requireAuthenticatedUser(req: Request, res: Response, next: NextFunction) {
  const user = await getUserById(req.session.authUserId);
  if (!user) {
    req.session.authUserId = undefined;
    if (req.path.startsWith("/api")) {
      return res.status(401).json({ error: "Authentication required" });
    }
    return res.redirect("/auth/login");
  }
  if (user.status !== "active") {
    req.session.authUserId = undefined;
    return res.status(403).json({ error: "Your access has been blocked" });
  }
  req.authUser = sanitizeUser(user);
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuthenticatedUser(req, res, () => {
    if (req.authUser?.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  });
}

export function protectApiRoutes(req: Request, res: Response, next: NextFunction) {
  const publicPaths = new Set([
    "/api/health",
    "/api/auth/me",
    "/api/auth/login",
    "/api/auth/logout",
  ]);

  if (!req.path.startsWith("/api")) return next();
  if (publicPaths.has(req.path)) return next();
  return requireAuthenticatedUser(req, res, next);
}

export function setupAuth(app: Express) {
  const isProduction = process.env.NODE_ENV === "production";
  
  ensureBootstrapUser();

  const sessionStore = new PostgresSessionStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
  });

  app.use(session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: isProduction,
    name: "adpilot.sid",
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }));

  app.get("/api/auth/me", async (req, res) => {
    const user = await getUserById(req.session.authUserId);
    if (!user || user.status !== "active") {
      if (req.session.authUserId && (!user || user.status !== "active")) {
        req.session.authUserId = undefined;
      }
      return res.json({
        authenticated: false,
        bootstrap: {
          email: BOOTSTRAP_EMAIL,
          passwordIsDefault: !process.env.AUTH_BOOTSTRAP_PASSWORD,
        },
      });
    }

    return res.json({
      authenticated: true,
      user: sanitizeUser(user),
      bootstrap: {
        email: BOOTSTRAP_EMAIL,
        passwordIsDefault: !process.env.AUTH_BOOTSTRAP_PASSWORD,
      },
    });
  });

  app.post("/api/auth/login", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await getUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ error: "This account is blocked from logging in" });
    }

    await db.update(users).set({
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(users.id, user.id));

    req.session.authUserId = user.id;
    return res.json({ success: true, user: sanitizeUser(user) });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

  app.get("/api/access/users", requireAdmin, async (_req, res) => {
    const allUsers = await db.select().from(users);
    res.json(allUsers.map(sanitizeUser));
  });

  app.post("/api/access/users", requireAdmin, async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const name = String(req.body?.name || "").trim();
    const password = String(req.body?.password || "");
    const role = (req.body?.role === "admin" ? "admin" : "member") as any;
    const status = (req.body?.status === "blocked" ? "blocked" : "active") as any;

    if (!email.includes("@")) {
      return res.status(400).json({ error: "A valid email is required" });
    }
    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    const existing = await getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "A user with that email already exists" });
    }

    const now = new Date();
    const newUserRecord: NewUser = {
      id: crypto.randomUUID(),
      email,
      name,
      passwordHash: createPasswordHash(password),
      role,
      status,
      createdAt: now,
      updatedAt: now,
    };

    const [inserted] = await db.insert(users).values(newUserRecord).returning();
    res.status(201).json(sanitizeUser(inserted));
  });

  app.put("/api/access/users/:userId", requireAdmin, async (req, res) => {
    const user = await getUserById(String(req.params.userId));
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const nextEmail = req.body?.email !== undefined ? String(req.body.email).trim().toLowerCase() : user.email;
    const nextName = req.body?.name !== undefined ? String(req.body.name).trim() : user.name;
    const nextRole = req.body?.role === "admin" ? "admin" : req.body?.role === "member" ? "member" : user.role;
    const nextStatus = req.body?.status === "blocked" ? "blocked" : req.body?.status === "active" ? "active" : user.status;
    const nextPassword = req.body?.password !== undefined ? String(req.body.password) : "";

    if (!nextEmail.includes("@")) {
      return res.status(400).json({ error: "A valid email is required" });
    }
    if (!nextName) {
      return res.status(400).json({ error: "Name is required" });
    }

    const conflict = await db.select().from(users).where(eq(users.email, nextEmail)).limit(1);
    if (conflict.length > 0 && conflict[0].id !== user.id) {
      return res.status(409).json({ error: "Another user already uses that email" });
    }

    const otherAdmins = await db.select().from(users).where(eq(users.role, "admin")).execute();
    const adminCount = otherAdmins.filter(a => a.id !== user.id).length;
    const isSelf = req.authUser?.id === user.id;

    if (user.role === "admin" && nextRole !== "admin" && adminCount === 0) {
      return res.status(400).json({ error: "At least one admin must remain" });
    }
    if (user.role === "admin" && nextStatus !== "active" && adminCount === 0) {
      return res.status(400).json({ error: "You cannot block the last admin account" });
    }

    const updates: any = {
      email: nextEmail,
      name: nextName,
      role: nextRole,
      status: nextStatus,
      updatedAt: new Date(),
    };

    if (nextPassword) {
      if (nextPassword.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      updates.passwordHash = createPasswordHash(nextPassword);
    }

    const [updated] = await db.update(users).set(updates).where(eq(users.id, user.id)).returning();

    if (isSelf && nextStatus !== "active") {
      req.session.authUserId = undefined;
    }

    res.json(sanitizeUser(updated));
  });
}
