'use strict';

const config = require('../config');
const { HttpError } = require('../utils/http');

const OCR_URL = 'https://api.ocr.space/parse/image';

function cleanLines(text) {
  const rawLines = String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^[\s·•\-–—*]+/, '').trim())
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  for (let line of rawLines) {
    // 中文 OCR 经常在字之间插空格：先去掉中文之间的空白，再处理价格
    if (/[\u4e00-\u9fa5]/.test(line)) line = line.replace(/\s+/g, '');
    line = line
      .replace(/[¥￥]\s*\d+(?:\.\d+)?\s*元?/g, '')
      .replace(/\d+(?:\.\d+)?\s*元/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (line.length < 2 || line.length > 28) continue;
    if (/^(今日菜[单単]|菜[单単]|价格|窗口|营业时间|早餐|午餐|晚餐|主食|荤菜|素菜|汤类|备注)$/.test(line)) continue;
    if (/^[\d\s.、/]+$/.test(line)) continue;
    if (/^[A-Za-z\s]{1,3}$/.test(line)) continue;
    line = line.replace(/[|丨]/g, '').trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= 20) break;
  }
  return out;
}

async function ocrSpace(buffer, mimetype) {
  const form = new FormData();
  form.append('apikey', config.ocr.apiKey);
  form.append('language', config.ocr.language);
  form.append('isOverlayRequired', 'false');
  form.append('OCREngine', '1');
  form.append('scale', 'true');
  form.append('file', new Blob([buffer], { type: mimetype }), 'menu.jpg');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ocr.timeoutMs);
  let data;
  try {
    const response = await fetch(OCR_URL, { method: 'POST', body: form, signal: controller.signal });
    data = await response.json().catch(() => null);
    if (!response.ok) throw new HttpError(502, `OCR 服务返回 HTTP ${response.status}`);
  } catch (error) {
    if (error.name === 'AbortError') throw new HttpError(504, 'OCR 识别超时');
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, `OCR 服务不可用：${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!data || data.IsErroredOnProcessing) {
    const msg = data && Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join('；') : 'OCR 识别失败';
    throw new HttpError(502, msg);
  }
  const results = Array.isArray(data.ParsedResults) ? data.ParsedResults : [];
  const rawText = results.map((r) => r.ParsedText || '').join('\n');
  return { provider: 'ocr.space', rawText, lines: cleanLines(rawText) };
}

async function tesseract(buffer) {
  let worker;
  try {
    // 延迟 require，避免没启用 OCR 时也加载 wasm
    const { createWorker } = require('tesseract.js');
    worker = await createWorker(config.ocr.tesseractLangs, 1, { logger: () => {} });
    const { data } = await worker.recognize(buffer);
    const rawText = (data && data.text) || '';
    return { provider: 'tesseract.js', rawText, lines: cleanLines(rawText) };
  } catch (error) {
    throw new HttpError(502, `本地 OCR 失败：${error.message}`);
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch { /* ignore */ }
    }
  }
}

async function recognizeMenu(buffer, mimetype = 'image/jpeg') {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new HttpError(400, '请上传菜单图片');
  if (buffer.length > 8 * 1024 * 1024) throw new HttpError(413, '图片不能超过 8MB');

  const provider = config.ocr.provider;
  let result = null;
  let cloudError = null;

  if (provider !== 'tesseract') {
    try {
      result = await ocrSpace(buffer, mimetype);
    } catch (error) {
      cloudError = error.message;
      if (provider === 'ocrspace') throw error;
    }
  }

  if (!result) {
    try {
      result = await tesseract(buffer);
    } catch (error) {
      const detail = cloudError ? `云端：${cloudError}；本地：${error.message}` : error.message;
      throw new HttpError(502, `OCR 识别失败：${detail}`);
    }
  }

  if (!result.lines.length) {
    throw new HttpError(422, '没有从图片中识别出菜名，请换一张清晰图片或手动输入');
  }

  return {
    provider: result.provider,
    language: config.ocr.language,
    items: result.lines.map((name) => ({ name, raw: name })),
    rawText: result.rawText,
    note: 'OCR 只负责识别菜名，营养数据仍需联网检索或估算；请核对识别结果后再生成计划。',
  };
}

module.exports = { recognizeMenu, cleanLines };
