'use strict';

const raw = require('../../data/foods.json');
const { normalizeDishName, normalizeText } = require('../utils/http');

const foods = raw.foods.map((food) => ({
  ...food,
  normalizedName: normalizeDishName(food.name),
  normalizedAliases: (food.aliases || []).map(normalizeDishName),
}));

const byName = new Map();
for (const food of foods) {
  byName.set(food.normalizedName, food);
  for (const alias of food.normalizedAliases) {
    if (!byName.has(alias)) byName.set(alias, food);
  }
}

function scoreMatch(query, food) {
  const q = normalizeDishName(query);
  if (!q) return 0;
  if (q === food.normalizedName) return 100;
  if (food.normalizedAliases.includes(q)) return 96;

  let best = 0;
  const candidates = [food.normalizedName, ...food.normalizedAliases];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (q.includes(candidate) && candidate.length >= 2) {
      best = Math.max(best, 78 + Math.min(candidate.length, 8));
    } else if (candidate.includes(q) && q.length >= 2) {
      best = Math.max(best, 62 + Math.min(q.length, 8));
    }
  }
  return best;
}

function findFood(name) {
  const q = normalizeDishName(name);
  if (!q) return null;
  if (byName.has(q)) {
    const food = byName.get(q);
    return { ...food, matchType: q === food.normalizedName ? 'exact' : 'alias', matchScore: 100 };
  }
  let best = null;
  for (const food of foods) {
    const score = scoreMatch(q, food);
    if (score > (best ? best.matchScore : 0)) best = { ...food, matchType: 'fuzzy', matchScore: score };
  }
  return best && best.matchScore >= 70 ? best : null;
}

function searchFoods(query, limit = 8) {
  const q = normalizeText(query);
  if (!q) return foods.slice(0, limit).map((f) => ({ ...f, per100g: undefined }));
  return foods
    .map((food) => ({ food, score: scoreMatch(query, food) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => ({ ...x.food, matchScore: x.score }));
}

function listFoods() {
  return foods;
}

module.exports = { foods, findFood, searchFoods, listFoods };
