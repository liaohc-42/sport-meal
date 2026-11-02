'use strict';

const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const root = path.join(__dirname, '..');

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  version: '2.0.0',
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3001),
  root,
  frontendDir: path.join(root, '..', 'frontend'),
  frontendOrigins: (
    process.env.FRONTEND_ORIGIN ||
    'http://localhost:3001,http://127.0.0.1:3001,http://127.0.0.1:5500,http://localhost:5500'
  ).split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    // 本地演示时允许临时隧道；生产环境请显式设置 FRONTEND_ORIGIN，不使用通配
    .concat(process.env.NODE_ENV === 'production' ? [] : ['https://*.trycloudflare.com', 'https://*.lhr.life']),
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'app.db'),
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    timeoutMs: int(process.env.DEEPSEEK_TIMEOUT_MS, 25000),
  },
  nutrition: {
    online: bool(process.env.NUTRITION_ONLINE, true),
    timeoutMs: int(process.env.NUTRITION_TIMEOUT_MS, 5000),
    cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
    userAgent: 'SportMeal/2.0 (campus nutrition demo; contact: local)',
  },
  ocr: {
    provider: process.env.OCR_PROVIDER || 'auto',
    apiKey: process.env.OCR_SPACE_API_KEY || 'helloworld',
    language: process.env.OCR_SPACE_LANGUAGE || 'chs',
    timeoutMs: int(process.env.OCR_TIMEOUT_MS, 20000),
    tesseractLangs: process.env.TESSERACT_LANGS || 'chi_sim+eng',
  },
  rateLimit: {
    apiPerMinute: int(process.env.API_RATE_LIMIT, 120),
    planPerMinute: int(process.env.PLAN_RATE_LIMIT, 20),
    ocrPerMinute: int(process.env.OCR_RATE_LIMIT, 8),
  },
};

module.exports = config;
