'use strict';

// Vercel Serverless Function entry.
// 所有 /api/* 请求会由 vercel.json 重写到这里，再交给 Express 处理。
module.exports = require('../src/app');
