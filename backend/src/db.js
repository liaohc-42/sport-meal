'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

let db = null;
let dbError = null;
const memory = {
  cache: new Map(),
  plans: new Map(),
  feedback: [],
};

function now() { return Date.now(); }

function init() {
  if (db) return db;
  try {
    // Node 22+ 内置 SQLite，避免 better-sqlite3 的原生编译依赖
    const { DatabaseSync } = require('node:sqlite');
    if (config.dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
    }
    db = new DatabaseSync(config.dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS nutrition_cache (
        cache_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        source TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        request_json TEXT NOT NULL,
        response_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        plan_id TEXT,
        rating INTEGER,
        comment TEXT,
        meta_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_plans_created_at ON plans(created_at);
    `);
    console.log('[db] SQLite ready:', config.dbPath);
  } catch (error) {
    dbError = error;
    db = null;
    console.warn('[db] SQLite unavailable, using in-memory cache:', error.message);
  }
  return db;
}

function getDbStatus() {
  return {
    enabled: Boolean(db),
    driver: db ? 'node:sqlite' : 'memory',
    error: dbError ? dbError.message : null,
    path: db ? config.dbPath : null,
  };
}

function cacheGet(key) {
  if (db) {
    const row = db.prepare('SELECT payload, updated_at FROM nutrition_cache WHERE cache_key = ?').get(key);
    if (!row) return null;
    if (now() - Number(row.updated_at) > config.nutrition.cacheTtlMs) return null;
    try { return JSON.parse(row.payload); } catch { return null; }
  }
  const item = memory.cache.get(key);
  if (!item) return null;
  if (now() - item.updatedAt > config.nutrition.cacheTtlMs) return null;
  return item.payload;
}

function cacheSet(key, payload, source) {
  if (db) {
    db.prepare(
      `INSERT INTO nutrition_cache (cache_key, payload, source, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload, source=excluded.source, updated_at=excluded.updated_at`
    ).run(key, JSON.stringify(payload), String(source || ''), now());
    return;
  }
  memory.cache.set(key, { payload, source, updatedAt: now() });
}

function savePlan(id, request, response) {
  if (db) {
    db.prepare('INSERT OR REPLACE INTO plans (id, created_at, request_json, response_json) VALUES (?, ?, ?, ?)')
      .run(id, now(), JSON.stringify(request), JSON.stringify(response));
    return;
  }
  memory.plans.set(id, { request, response, createdAt: now() });
}

function saveFeedback(record) {
  if (db) {
    db.prepare('INSERT INTO feedback (id, created_at, plan_id, rating, comment, meta_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(record.id, now(), record.planId || null, record.rating || null, record.comment || '', JSON.stringify(record.meta || {}));
    return;
  }
  memory.feedback.push({ ...record, createdAt: now() });
}

function close() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

module.exports = { init, getDbStatus, cacheGet, cacheSet, savePlan, saveFeedback, close };
