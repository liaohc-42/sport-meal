'use strict';

const express = require('express');
const { lookupMenu } = require('../nutrition/lookup');
const { asyncRoute, HttpError } = require('../utils/http');

const router = express.Router();

router.post('/lookup', asyncRoute(async (req, res) => {
  const items = req.body && req.body.items;
  if (!Array.isArray(items) || !items.length) {
    throw new HttpError(400, '请提供至少一道菜，items 不能为空');
  }
  if (items.length > 15) {
    throw new HttpError(400, '一次最多查询 15 道菜');
  }
  const invalid = items.find((item) => !item || typeof item.name !== 'string' || !item.name.trim());
  if (invalid) throw new HttpError(400, '每道菜都需要 name');

  const result = await lookupMenu(items, { online: req.body.online !== false });
  res.json(result);
}));

module.exports = router;
