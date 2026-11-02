'use strict';

const config = require('../config');
const { fetchJson, normalizeDishName, round } = require('../utils/http');

const OFF_URL = 'https://world.openfoodfacts.org/cgi/search.pl';

const ENGLISH_HINTS = {
  '米饭': 'rice',
  '鸡胸': 'chicken breast',
  '鸡腿': 'chicken leg',
  '牛肉': 'beef',
  '猪肉': 'pork',
  '鸡蛋': 'egg',
  '豆腐': 'tofu',
  '牛奶': 'milk',
  '酸奶': 'yogurt',
  '香蕉': 'banana',
  '苹果': 'apple',
  '西兰花': 'broccoli',
  '番茄': 'tomato',
  '面条': 'noodles',
  '面包': 'bread',
  '燕麦': 'oats',
  '三明治': 'sandwich',
  '沙拉': 'salad',
};

function chooseSearchTerm(name) {
  const normalized = normalizeDishName(name);
  for (const [cn, en] of Object.entries(ENGLISH_HINTS)) {
    if (normalized.includes(cn)) return { term: en, original: normalized };
  }
  return { term: normalized, original: normalized };
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function pickNutriments(product) {
  const n = product.nutriments || {};
  let kcal = number(n['energy-kcal_100g']);
  if (kcal === null) {
    const kj = number(n.energy_100g);
    if (kj !== null) kcal = kj / 4.184;
  }
  const protein = number(n.proteins_100g);
  const carbs = number(n.carbohydrates_100g);
  const fat = number(n.fat_100g);
  if (kcal === null || protein === null || carbs === null || fat === null) return null;
  if (kcal > 900 || protein > 100 || carbs > 100 || fat > 100) return null;
  const calculated = protein * 4 + carbs * 4 + fat * 9;
  // 包装标签允许一定误差；偏离太大说明字段不完整或不适用于该产品
  if (Math.abs(calculated - kcal) > Math.max(80, kcal * 0.45)) return null;
  return {
    kcal: round(kcal, 0),
    protein: round(protein, 1),
    carbs: round(carbs, 1),
    fat: round(fat, 1),
  };
}

function bigrams(value) {
  const set = new Set();
  for (let i = 0; i < value.length - 1; i++) {
    const pair = value.slice(i, i + 2);
    if (pair.length === 2) set.add(pair);
  }
  return set;
}

function nameMatches(query, productName) {
  const q = normalizeDishName(query);
  const p = normalizeDishName(productName || '');
  if (!q || !p) return false;

  // 调料 / 酱汁 / 零食包装不能代表一道食堂菜
  if (/酱|汁|调料|汤料|零食|饮料|糖果|饼干/.test(p) && !/酱|汁|调料|零食|饮料/.test(q)) return false;
  if (p === q) return true;

  if (/[\u4e00-\u9fa5]/.test(q)) {
    const qGrams = bigrams(q);
    const pGrams = bigrams(p);
    if (!qGrams.size) return p.includes(q);
    let hit = 0;
    for (const gram of qGrams) if (pGrams.has(gram)) hit++;
    // 至少有 60% 的双字片段匹配；避免“番茄炒蛋”匹配到“番茄酱”
    if (hit / qGrams.size >= 0.6) return true;
    // 短词（2 字）只接受包含关系
    return q.length <= 2 && (p.includes(q) || q.includes(p));
  }

  const words = q.split(/\s+/).filter((w) => w.length > 2);
  return words.some((w) => p.includes(w));
}

async function searchOpenFoodFacts(name) {
  if (!config.nutrition.online) return null;
  const { term } = chooseSearchTerm(name);
  const url = new URL(OFF_URL);
  url.searchParams.set('search_terms', term);
  url.searchParams.set('search_simple', '1');
  url.searchParams.set('action', 'process');
  url.searchParams.set('json', '1');
  url.searchParams.set('page_size', '10');
  url.searchParams.set('fields', 'product_name,product_name_zh,nutriments,code,url');

  const data = await fetchJson(url.toString(), {
    headers: {
      'User-Agent': config.nutrition.userAgent,
      'Accept': 'application/json',
    },
  }, config.nutrition.timeoutMs);

  const products = Array.isArray(data && data.products) ? data.products : [];
  for (const product of products) {
    const productName = product.product_name_zh || product.product_name || '';
    if (!nameMatches(name, productName)) continue;
    const per100g = pickNutriments(product);
    if (!per100g) continue;
    return {
      per100g,
      matchedName: productName,
      provider: 'Open Food Facts',
      sourceUrl: product.code ? `https://world.openfoodfacts.org/product/${product.code}` : 'https://world.openfoodfacts.org/',
      note: '联网检索到包装食品营养数据，按每 100g 折算；堂食做法可能存在差异。',
    };
  }
  return null;
}

module.exports = { searchOpenFoodFacts, chooseSearchTerm };
