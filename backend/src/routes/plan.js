'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const { lookupMenu } = require('../nutrition/lookup');
const { buildPlan } = require('../services/planner');
const { enhancePlan } = require('../services/llm');
const { savePlan } = require('../db');
const { asyncRoute, HttpError } = require('../utils/http');

const router = express.Router();

router.post('/', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const menu = body.menu && Array.isArray(body.menu.items) ? body.menu.items : null;
  if (!menu || !menu.length) throw new HttpError(400, '请先添加今天食堂的菜品');
  if (menu.length > 15) throw new HttpError(400, '一次最多分析 15 道菜');
  if (!body.profile || typeof body.profile !== 'object') throw new HttpError(400, '缺少 profile');
  if (!body.training || typeof body.training !== 'object') throw new HttpError(400, '缺少 training');

  const nutrition = await lookupMenu(menu, { online: body.online !== false });
  const plan = buildPlan(body, nutrition);
  const ai = await enhancePlan(plan, nutrition);
  if (ai.used && ai.narrative) plan.narrative = ai.narrative;
  plan.ai = { used: Boolean(ai.used), provider: ai.provider || 'local', model: ai.model || null, reason: ai.reason || null };

  const requestId = randomUUID();
  const response = {
    requestId,
    generatedAt: new Date().toISOString(),
    plan,
    nutrition,
    mode: ai.used ? 'ai' : 'local',
  };
  savePlan(requestId, { profile: body.profile, training: body.training, preferences: body.preferences, menu }, response);
  res.json(response);
}));

module.exports = router;
