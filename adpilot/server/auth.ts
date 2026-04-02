import type { Express, NextFunction, Request, Response } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import createMemoryStore from "memorystore";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { db } from "./db";
import { users, type User, type NewUser } from "@shared/schema";
import { eq } from "drizzle-orm";

const PostgresSessionStore = connectPg(session);
const MemoryStore = createMemoryStore(session);

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

function readUsersFromFile(): StoredUser[] {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeUsersToFile(nextUsers: StoredUser[]) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(nextUsers, null, 2));
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

function sanitizeStoredUser(user: StoredUser): SafeUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

function isUsableDatabaseUrl(connectionString?: string): boolean {
  if (!connectionString?.trim()) return false;
  try {
    const parsed = new URL(connectionString);
    return parsed.protocol === "postgres:" || parsed.protocol === "postgresql:";
  } catch {
    return false;
  }
}

async function selectUserByEmailFromDb(email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user;
}

async function selectUserByIdFromDb(id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}

async function getAllUsers(): Promise<Array<User | StoredUser>> {
  try {
    return await db.select().from(users);
  } catch {
    return readUsersFromFile();
  }
}

async function ensureBootstrapUser() {
  try {
    const existingAdmin = await selectUserByEmailFromDb(BOOTSTRAP_EMAIL);
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
      console.log(`[Auth] Bootstrapped admin user in database: ${BOOTSTRAP_EMAIL}`);
    }
    return;
  } catch (error) {
    console.warn("[Auth] Database bootstrap unavailable, falling back to file-based auth:", error);
  }

  const usersFromFile = readUsersFromFile();
  const existingAdmin = usersFromFile.find((user) => user.email === BOOTSTRAP_EMAIL);
  if (!existingAdmin) {
    const now = new Date().toISOString();
    usersFromFile.push({
      id: crypto.randomUUID(),
      email: BOOTSTRAP_EMAIL,
      name: BOOTSTRAP_NAME,
      passwordHash: createPasswordHash(BOOTSTRAP_PASSWORD),
      role: "admin",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    writeUsersToFile(usersFromFile);
    console.log(`[Auth] Bootstrapped admin user in file storage: ${BOOTSTRAP_EMAIL}`);
  }
}

async function getUserById(id?: string): Promise<User | undefined> {
  if (!id) return undefined;
  try {
    return await selectUserByIdFromDb(id);
  } catch {
    const user = readUsersFromFile().find((entry) => entry.id === id);
    return user as unknown as User | undefined;
  }
}

async function getUserByEmail(email: string): Promise<User | undefined> {
  const normalizedEmail = email.trim().toLowerCase();
  try {
    return await selectUserByEmailFromDb(normalizedEmail);
  } catch {
    const user = readUsersFromFile().find((entry) => entry.email === normalizedEmail);
    return user as unknown as User | undefined;
  }
}

async function createUser(newUserRecord: NewUser): Promise<User | StoredUser> {
  try {
    const [inserted] = await db.insert(users).values(newUserRecord).returning();
    return inserted;
  } catch {
    const usersFromFile = readUsersFromFile();
    usersFromFile.push({
      id: newUserRecord.id,
      email: newUserRecord.email,
      name: newUserRecord.name,
      passwordHash: newUserRecord.passwordHash,
      role: newUserRecord.role ?? "member",
      status: newUserRecord.status ?? "active",
      createdAt: newUserRecord.createdAt instanceof Date ? newUserRecord.createdAt.toISOString() : String(newUserRecord.createdAt),
      updatedAt: newUserRecord.updatedAt instanceof Date ? newUserRecord.updatedAt.toISOString() : String(newUserRecord.updatedAt),
    });
    writeUsersToFile(usersFromFile);
    return usersFromFile[usersFromFile.length - 1];
  }
}

async function updateUser(userId: string, updates: Partial<NewUser> & { lastLoginAt?: Date | string | null }): Promise<User | StoredUser | undefined> {
  try {
    const [updated] = await db.update(users).set(updates).where(eq(users.id, userId)).returning();
    return updated;
  } catch {
    const usersFromFile = readUsersFromFile();
    const index = usersFromFile.findIndex((entry) => entry.id === userId);
    if (index === -1) return undefined;
    const current = usersFromFile[index];
    const nextUser: StoredUser = {
      ...current,
      ...Object.fromEntries(
        Object.entries(updates).map(([key, value]) => [
          key,
          value instanceof Date ? value.toISOString() : value,
        ]),
      ),
      updatedAt: updates.updatedAt instanceof Date ? updates.updatedAt.toISOString() : String(updates.updatedAt || current.updatedAt),
    } as StoredUser;
    usersFromFile[index] = nextUser;
    writeUsersToFile(usersFromFile);
    return nextUser;
  }
}

function toSafeUser(user: User | StoredUser): SafeUser {
  return "passwordHash" in user && typeof user.createdAt === "string"
    ? sanitizeStoredUser(user as StoredUser)
    : sanitizeUser(user as User);
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
  req.authUser = toSafeUser(user);
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

export async function setupAuth(app: Express) {
  const isProduction = process.env.NODE_ENV === "production";
  const canUsePostgresSessions =
    process.env.AUTH_USE_PG_SESSIONS === "true" &&
    isUsableDatabaseUrl(process.env.DATABASE_URL);
  const cookieSameSite = (process.env.AUTH_COOKIE_SAMESITE || "lax") as "lax" | "strict" | "none";
  const cookieSecure = process.env.AUTH_COOKIE_SECURE === "false"
    ? false
    : process.env.AUTH_COOKIE_SECURE === "true"
      ? true
      : isProduction;

  if (isProduction && !canUsePostgresSessions) {
    console.warn("[Auth] Using in-memory sessions in production. This works only reliably on a single instance.");
  }

  await ensureBootstrapUser();

  const sessionStore = canUsePostgresSessions
    ? new PostgresSessionStore({
        conString: process.env.DATABASE_URL,
        createTableIfMissing: true,
      })
    : new MemoryStore({
        checkPeriod: 1000 * 60 * 60 * 24,
      });

  app.use(session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    name: "adpilot_prod_sid", // UNIQUE name for production
    cookie: {
      httpOnly: true,
      sameSite: cookieSameSite,
      secure: cookieSecure,
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
      user: toSafeUser(user),
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

    await updateUser(user.id, {
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    });

    req.session.authUserId = user.id;
    return req.session.save((error) => {
      if (error) {
        console.error("[Auth] Failed to persist session after login:", error);
        return res.status(500).json({ error: "Login succeeded, but the session could not be saved" });
      }

      return res.json({ success: true, user: toSafeUser(user) });
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("adpilot_prod_sid");
      res.json({ success: true });
    });
  });

  app.get("/api/access/users", requireAdmin, async (_req, res) => {
    const allUsers = await getAllUsers();
    res.json(allUsers.map(toSafeUser));
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

    const inserted = await createUser(newUserRecord);
    res.status(201).json(toSafeUser(inserted));
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

    const conflict = await getUserByEmail(nextEmail).then((match) => (match ? [match] : []));
    if (conflict.length > 0 && conflict[0].id !== user.id) {
      return res.status(409).json({ error: "Another user already uses that email" });
    }

    const otherAdmins = await getAllUsers();
    const adminCount = otherAdmins.filter((a) => a.id !== user.id && a.role === "admin").length;
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

    const updated = await updateUser(user.id, updates);
    if (!updated) {
      return res.status(404).json({ error: "User not found" });
    }

    if (isSelf && nextStatus !== "active") {
      req.session.authUserId = undefined;
    }

    res.json(toSafeUser(updated));
  });
}
