'use strict';

const config = require('../config');
const { cacheGet, cacheSet } = require('../db');
const { findFood } = require('./database');
const { searchOpenFoodFacts } = require('./online');
const { estimateFood } = require('./estimate');
const { clamp, round, normalizeDishName } = require('../utils/http');

const MAX_ITEMS = 15;

function normalizeItem(raw) {
  const name = String(raw && raw.name ? raw.name : '').trim().slice(0, 80);
  const grams = clamp(raw && raw.grams ? raw.grams : 200, 10, 1000);
  const price = raw && raw.price !== undefined && raw.price !== '' ? clamp(raw.price, 0, 999) : null;
  return { name, grams, price };
}

function sourceMeta(source, detail) {
  if (source === 'online') {
    return { key: 'online', label: '联网检索', confidence: 'medium', detail: detail || 'Open Food Facts' };
  }
  if (source === 'local') {
    return { key: 'local', label: '本地营养库', confidence: 'high', detail: detail || '种子营养数据' };
  }
  return { key: 'estimated', label: '估算值', confidence: 'low', detail: detail || '未检索到精确数据' };
}

async function lookupOne(raw, options = {}) {
  const item = normalizeItem(raw);
  if (!item.name) return null;

  const key = `v3:${normalizeDishName(item.name)}`;
  let base = cacheGet(key);
  let onlineError = null;

  // 按需求先联网检索；失败或没有可信结果，再回退到本地库和常识估算
  if (!base && config.nutrition.online && options.online !== false) {
    try {
      const online = await searchOpenFoodFacts(item.name);
      if (online) {
        base = {
          per100g: online.per100g,
          source: 'online',
          sourceUrl: online.sourceUrl,
          matchedName: online.matchedName,
          note: online.note,
          basis: online.provider,
        };
        cacheSet(key, base, 'online');
      }
    } catch (error) {
      onlineError = error.message;
    }
  }

  if (!base) {
    const local = findFood(item.name);
    if (local) {
      base = {
        per100g: local.per100g,
        source: 'local',
        sourceUrl: null,
        matchedName: local.name,
        note: local.note || '本地营养库参考值。',
        basis: local.matchType === 'exact' ? '本地库精确匹配' : `本地库近似匹配（${local.matchScore}）`,
      };
      cacheSet(key, base, 'local');
    }
  }

  if (!base) {
    const estimated = estimateFood(item.name);
    base = {
      per100g: estimated.per100g,
      source: 'estimated',
      sourceUrl: null,
      matchedName: null,
      note: estimated.note,
      basis: `${estimated.basis}常识估算`,
    };
  }

  const f = item.grams / 100;
  const nutrition = {
    kcal: round(base.per100g.kcal * f, 0),
    protein: round(base.per100g.protein * f, 1),
    carbs: round(base.per100g.carbs * f, 1),
    fat: round(base.per100g.fat * f, 1),
  };
  const src = sourceMeta(base.source, base.sourceUrl || base.basis);
  return {
    name: item.name,
    grams: round(item.grams, 0),
    price: item.price,
    per100g: base.per100g,
    nutrition,
    source: src,
    matchedName: base.matchedName,
    sourceUrl: base.sourceUrl || null,
    note: base.note,
    onlineError,
  };
}

async function lookupMenu(items, options = {}) {
  const list = Array.isArray(items) ? items.slice(0, MAX_ITEMS) : [];
  const results = (await Promise.all(list.map((item) => lookupOne(item, options)))).filter(Boolean);
  const totals = results.reduce((acc, item) => {
    acc.kcal += item.nutrition.kcal;
    acc.protein += item.nutrition.protein;
    acc.carbs += item.nutrition.carbs;
    acc.fat += item.nutrition.fat;
    acc.price += item.price || 0;
    return acc;
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0, price: 0 });
  const sourceCount = results.reduce((acc, item) => {
    acc[item.source.key] = (acc[item.source.key] || 0) + 1;
    return acc;
  }, {});
  return {
    items: results,
    totals: {
      kcal: round(totals.kcal, 0),
      protein: round(totals.protein, 1),
      carbs: round(totals.carbs, 1),
      fat: round(totals.fat, 1),
      price: round(totals.price, 1),
    },
    meta: {
      itemCount: results.length,
      sourceCount,
      onlineEnabled: config.nutrition.online,
      estimatedCount: results.filter((x) => x.source.key === 'estimated').length,
      note: results.some((x) => x.source.key === 'estimated')
        ? '部分菜品未检索到精确数据，已按常识估算并标注“估算值”。'
        : '营养数据来自本地库或联网检索，份量变化会影响结果。',
    },
  };
}

module.exports = { lookupMenu, lookupOne, MAX_ITEMS };
