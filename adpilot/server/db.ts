import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../shared/schema.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

if (!process.env.DATABASE_URL) {
  // If no DB URL is provided, we use a local pool that will likely fail
  // safely so the app can fall back to JSON in our code if we need.
  console.warn("DATABASE_URL is missing! Persistence will be limited to JSON files.");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export const db = drizzle(pool, { schema });
