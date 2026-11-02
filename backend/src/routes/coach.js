'use strict';

const express = require('express');
const { coachReply, isConfigured } = require('../services/llm');
const { asyncRoute, HttpError } = require('../utils/http');

const router = express.Router();

router.post('/', asyncRoute(async (req, res) => {
  const message = String((req.body && req.body.message) || '').trim();
  if (!message) throw new HttpError(400, '请输入想问教练的问题');
  if (message.length > 500) throw new HttpError(400, '问题请控制在 500 字以内');
  const context = req.body && req.body.context && typeof req.body.context === 'object' ? req.body.context : {};
  const result = await coachReply(message, context);
  res.json({
    reply: result.reply,
    mode: result.used ? 'ai' : 'local',
    provider: result.provider || 'local',
    note: result.used ? null : (result.reason || (isConfigured() ? '模型失败，使用本地教练' : '未配置模型，使用本地教练')),
  });
}));

module.exports = router;
