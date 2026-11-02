'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const fs = require('node:fs');
const config = require('./config');
const { init, getDbStatus } = require('./db');
const { HttpError } = require('./utils/http');

init();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'https:'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));

const allowedOrigins = new Set(config.frontendOrigins.filter((x) => !x.includes('*')));
const wildcardOrigins = config.frontendOrigins.filter((x) => x.includes('*'));
function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.has('*') || allowedOrigins.has(origin)) return true;
  return wildcardOrigins.some((pattern) => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(origin);
  });
}
app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new HttpError(403, `CORS 不允许来源：${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.rateLimit.apiPerMinute,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: '请求太频繁，请稍后再试' },
});
const planLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.rateLimit.planPerMinute,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: '生成计划太频繁，请稍后再试' },
});
const ocrLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.rateLimit.ocrPerMinute,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: '图片识别太频繁，请稍后再试' },
});

app.use('/api', apiLimiter);
app.use('/api/health', require('./routes/health'));
app.use('/api/foods', require('./routes/foods'));
app.use('/api/nutrition', require('./routes/nutrition'));
app.use('/api/plan', planLimiter, require('./routes/plan'));
app.use('/api/coach', require('./routes/coach'));
app.use('/api/ocr', ocrLimiter, require('./routes/ocr'));
app.use('/api/feedback', require('./routes/feedback'));

app.get('/api', (req, res) => {
  res.json({
    name: 'sport-meal-api',
    version: config.version,
    docs: 'https://github.com/your-org/sport-meal#api',
    health: '/api/health',
  });
});

// 本地开发时，Express 直接托管前端；GitHub Pages 部署时前端独立托管。
// Vercel 只有 backend 目录时，不要因为缺少 frontend 而影响 API。
const frontendIndex = path.join(config.frontendDir, 'index.html');
const hasFrontend = fs.existsSync(frontendIndex);
if (hasFrontend) {
  app.use(express.static(config.frontendDir, {
    index: 'index.html',
    maxAge: config.env === 'production' ? '1h' : 0,
  }));
}

app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在', path: req.path });
});

app.use((req, res, next) => {
  if (hasFrontend && req.method === 'GET' && req.accepts('html')) {
    return res.sendFile(frontendIndex);
  }
  return next();
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  if (error && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '图片不能超过 8MB' });
  }
  const status = error instanceof HttpError ? error.status : (error.status || 500);
  if (status >= 500) console.error('[api:error]', error);
  return res.status(status).json({
    error: error.message || '服务器内部错误',
    ...(error.details ? { details: error.details } : {}),
  });
});

module.exports = app;
module.exports.getDbStatus = getDbStatus;
