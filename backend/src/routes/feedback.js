'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const { saveFeedback } = require('../db');
const { asyncRoute, HttpError } = require('../utils/http');

const router = express.Router();

router.post('/', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const rating = Number(body.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'rating 需要是 1–5');
  const record = {
    id: randomUUID(),
    planId: body.planId ? String(body.planId).slice(0, 80) : null,
    rating: Math.round(rating),
    comment: String(body.comment || '').slice(0, 500),
    meta: body.meta && typeof body.meta === 'object' ? body.meta : {},
  };
  saveFeedback(record);
  res.json({ ok: true, id: record.id });
}));

module.exports = router;
