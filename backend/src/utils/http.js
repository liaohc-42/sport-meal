'use strict';

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function round(value, digits = 0) {
  const p = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * p) / p;
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[，,。.;；:：!！?？、/\\|+＋\-—_]/g, ' ')
    .replace(/\d+(\.\d+)?\s*(g|克|ml|毫升|元|块|kcal|千卡|大卡)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDishName(name) {
  return normalizeText(name)
    .replace(/盖饭|盖浇饭|套餐|一份|小份|大份|半份/g, '')
    .replace(/\s+/g, '')
    .trim();
}

async function fetchJson(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const msg = data && (data.error || data.message) ? (data.error || data.message) : `HTTP ${response.status}`;
      throw new HttpError(502, `上游接口错误：${msg}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function asyncRoute(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function isNonEmptyString(value, max = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

module.exports = {
  HttpError,
  clamp,
  round,
  normalizeText,
  normalizeDishName,
  fetchJson,
  asyncRoute,
  isNonEmptyString,
};
