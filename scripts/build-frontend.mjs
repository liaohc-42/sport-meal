#!/usr/bin/env node
/**
 * 无框架前端构建：
 * 1. 复制 frontend/ 到 dist/
 * 2. 用 API_BASE_URL 环境变量（或 --api-base-url）生成 dist/config.js
 * 3. 打上构建时间，方便确认线上版本
 *
 * 本地：npm run build:frontend
 * GitHub Pages：workflow 注入 secrets.API_BASE_URL
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'frontend');
const dist = path.join(root, 'dist');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

const apiBaseUrl = (argValue('--api-base-url') || process.env.API_BASE_URL || '').trim().replace(/\/+$/, '');
const buildTime = new Date().toISOString();

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync(source, dist, {
  recursive: true,
  filter: (file) => !file.endsWith('config.example.js'),
});
fs.writeFileSync(path.join(dist, '.nojekyll'), '', 'utf8');

const config = `/**
 * 由 scripts/build-frontend.mjs 生成，请勿手动编辑线上产物。
 * API_BASE_URL: ${apiBaseUrl || '(same origin)'}
 */
window.APP_CONFIG = ${JSON.stringify({
  apiBaseUrl,
  appName: '练完吃啥 Pro',
  buildTime,
}, null, 2)};
`;
fs.writeFileSync(path.join(dist, 'config.js'), config, 'utf8');

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
if (!html.includes('./config.js') || !html.includes('./assets/app.js')) {
  console.error('[build] index.html 未正确引用 config.js / app.js');
  process.exit(1);
}
if (!apiBaseUrl) {
  console.warn('[build] 未设置 API_BASE_URL：页面会请求同源 /api。GitHub Pages 请设置 Secrets.API_BASE_URL。');
}
console.log(`[build] dist ready: ${dist}`);
console.log(`[build] API_BASE_URL: ${apiBaseUrl || '(same origin)'}`);
