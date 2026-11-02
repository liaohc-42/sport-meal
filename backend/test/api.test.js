'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { cleanLines } = require('../src/services/ocr');
const { classify, calcTargets } = require('../src/services/planner');

const profile = {
  sex: 'male', age: 20, heightCm: 175, weightKg: 68,
  goal: 'cut', experience: 'beginner', daysPerWeek: 3,
};
const training = { strengthMin: 45, cardioMin: 20, intensity: 'mid' };
const preferences = { meal: 'lunch', budget: 15, avoid: [] };
const menu = {
  canteen: '一食堂',
  items: [
    { name: '米饭', grams: 200, price: 1.5 },
    { name: '番茄炒蛋', grams: 200, price: 5 },
    { name: '卤鸡腿', grams: 150, price: 6 },
    { name: '蒜蓉西兰花', grams: 200, price: 3 },
  ],
};

test('health returns feature flags', async () => {
  const res = await request(app).get('/api/health').expect(200);
  assert.equal(res.body.ok, true);
  assert.equal(typeof res.body.features.llm, 'boolean');
  assert.equal(res.body.features.database.enabled, true);
});

test('local food search works', async () => {
  const res = await request(app).get('/api/foods').query({ q: '鸡胸' }).expect(200);
  assert.ok(res.body.items.length >= 1);
  assert.ok(res.body.items.some((x) => x.name === '鸡胸肉'));
});

test('nutrition lookup uses local database and survives online failure', async () => {
  const res = await request(app)
    .post('/api/nutrition/lookup')
    .send({ items: menu.items, online: false })
    .expect(200);
  assert.equal(res.body.items.length, 4);
  assert.ok(res.body.items.every((x) => x.per100g && x.nutrition));
  assert.ok(res.body.items.every((x) => ['local', 'online', 'estimated'].includes(x.source.key)));
  assert.ok(res.body.totals.protein > 30);
});

test('unknown food is explicitly marked estimated', async () => {
  const res = await request(app)
    .post('/api/nutrition/lookup')
    .send({ items: [{ name: '外星料理', grams: 200 }], online: false })
    .expect(200);
  assert.equal(res.body.items[0].source.key, 'estimated');
  assert.match(res.body.items[0].source.label, /估算/);
  assert.equal(res.body.meta.estimatedCount, 1);
});

test('plan contains meal combinations, weekly training and local coach', async () => {
  const res = await request(app)
    .post('/api/plan')
    .send({ profile, training, preferences, menu })
    .expect(200);
  assert.equal(res.body.mode, 'local');
  assert.ok(res.body.plan.meals.length >= 2);
  assert.ok(res.body.plan.meals[0].totals.protein > 30);
  assert.equal(res.body.plan.training.weekly.weekly.length, 7);
  assert.ok(res.body.plan.narrative.headline.length > 3);
  assert.ok(res.body.requestId);
});

test('coach falls back to local when no API key', async () => {
  const res = await request(app)
    .post('/api/coach')
    .send({ message: '蛋白够不够？', context: { goal: 'cut' } })
    .expect(200);
  assert.equal(res.body.mode, 'local');
  assert.ok(res.body.reply.length > 10);
});

test('feedback validates rating', async () => {
  await request(app).post('/api/feedback').send({ rating: 9 }).expect(400);
  const res = await request(app).post('/api/feedback').send({ rating: 5, comment: 'ok' }).expect(200);
  assert.equal(res.body.ok, true);
});

test('ocr line cleaning strips prices and headers', () => {
  const lines = cleanLines('今日菜单\n米饭 1.5 元\n番茄炒蛋 5 元\n卤鸡腿 6元\n');
  assert.deepEqual(lines, ['米饭', '番茄炒蛋', '卤鸡腿']);
});

test('training targets change with exercise volume', () => {
  const low = calcTargets(profile, { ...training, strengthMin: 0, cardioMin: 0 }, preferences);
  const high = calcTargets(profile, { ...training, strengthMin: 90, cardioMin: 60, intensity: 'high' }, preferences);
  assert.ok(high.exerciseKcal > low.exerciseKcal);
  assert.ok(high.kcal > low.kcal);
});
