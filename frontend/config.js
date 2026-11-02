/**
 * 本地开发：留空表示“同源”，即由 Express 同时托管前端和 /api。
 * 如果前端单独跑在 5500 端口，改成 http://127.0.0.1:3001。
 * GitHub Pages 构建时由 scripts/build-frontend.mjs 用 API_BASE_URL 覆盖本文件。
 */
window.APP_CONFIG = {
  apiBaseUrl: "",
  appName: "练完吃啥 Pro",
  buildTime: "local",
};
