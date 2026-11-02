'use strict';

const express = require('express');
const { searchFoods } = require('../nutrition/database');
const { asyncRoute } = require('../utils/http');

const router = express.Router();

router.get('/', asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 8));
  const results = searchFoods(q, limit).map((food) => ({
    id: food.id,
    name: food.name,
    aliases: food.aliases,
    category: food.category,
    per100g: food.per100g,
    defaultGrams: food.defaultGrams,
    tags: food.tags,
    allergens: food.allergens,
    note: food.note,
  }));
  res.json({ query: q, items: results, count: results.length });
}));

module.exports = router;
