'use strict';

const express = require('express');
const multer = require('multer');
const { recognizeMenu } = require('../services/ocr');
const { asyncRoute, HttpError } = require('../utils/http');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

router.post('/menu', upload.single('image'), asyncRoute(async (req, res) => {
  if (!req.file) throw new HttpError(400, '请选择一张菜单图片（字段名 image）');
  if (!/^image\//.test(req.file.mimetype)) throw new HttpError(415, '只支持图片文件');
  const result = await recognizeMenu(req.file.buffer, req.file.mimetype);
  res.json(result);
}));

module.exports = router;
