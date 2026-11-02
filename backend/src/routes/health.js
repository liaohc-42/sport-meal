'use strict';

const express = require('express');
const config = require('../config');
const { getDbStatus } = require('../db');
const { isConfigured } = require('../services/llm');
const { asyncRoute } = require('../utils/http');

const router = express.Router();

router.get('/', asyncRoute(async (req, res) => {
  res.json({
    ok: true,
    service: 'sport-meal-api',
    version: config.version,
    time: new Date().toISOString(),
    features: {
      llm: isConfigured(),
      ocr: Boolean(config.ocr.apiKey),
      nutritionOnline: config.nutrition.online,
      database: getDbStatus(),
    },
    endpoints: [
      'GET /api/health',
      'GET /api/foods?q=',
      'POST /api/nutrition/lookup',
      'POST /api/plan',
      'POST /api/coach',
      'POST /api/ocr/menu',
      'POST /api/feedback',
    ],
  });
}));

module.exports = router;
