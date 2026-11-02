# 部署指南

本项目是“静态前端 + 独立 API”的结构：

```
GitHub Pages (frontend/)  ──HTTPS──▶  Vercel / Node / Cloudflare Container (backend/)
                                      ├─ Open Food Facts（营养检索）
                                      ├─ OCR.space / Tesseract（菜单图片）
                                      └─ DeepSeek（可选，只做文案与教练对话）
```

> 前端是纯静态文件，不需要构建框架；`scripts/build-frontend.mjs` 只负责复制文件 + 注入 API 地址。

---

## 一、本地运行（最快）

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

打开：

- 本机：<http://127.0.0.1:3001>
- 同一 Wi-Fi：`http://<本机局域网IP>:3001`

Express 同时托管 `frontend/` 和 `/api`，所以本地 `frontend/config.js` 的 `apiBaseUrl` 留空（同源）即可。

---

## 二、GitHub Pages 部署前端

### 1. 准备仓库

把整个 `sport-meal/` 推到 GitHub 的 `main` 分支。

### 2. 开启 Pages

GitHub 仓库 → **Settings → Pages** → **Build and deployment**：

- Source：**GitHub Actions**
- 不需要选择分支目录。

### 3. 配置 API 地址 Secret

仓库 → **Settings → Secrets and variables → Actions** → **New repository secret**：

- Name：`API_BASE_URL`
- Value：你的后端公网地址，例如 `https://sport-meal-api.vercel.app`
- 必须是 HTTPS；末尾不要带 `/`。

> 也可以使用 Repository variable（`vars.API_BASE_URL`）；workflow 已做兼容。  
> 如果没设置，构建会给出 warning，页面会请求同源 `/api`，在 Pages 上不可用。

### 4. 配置后端 CORS

后端环境变量加：

```
FRONTEND_ORIGIN=https://<你的GitHub用户名>.github.io
```

如果是项目页（`https://user.github.io/repo/`），Origin 仍然是 `https://user.github.io`，不需要带路径。

### 5. 触发部署

- push 到 `main`（修改 `frontend/**` 或 workflow 时自动触发）；
- 或在 Actions 页面手动 **Run workflow**。

Workflow 会：

1. checkout；
2. 安装 Node 22；
3. `node scripts/build-frontend.mjs`（复制到 `dist/`，写入 `config.js`）；
4. 上传 Pages artifact；
5. 部署到 GitHub Pages。

最终地址：

```
https://<用户名>.github.io/<仓库名>/
```

> 用户主页仓库（`<用户名>.github.io`）则是 `https://<用户名>.github.io/`。

### 6. 验证

- 打开 Pages 地址；
- 右上角应显示“后端在线”；
- 若显示“后端未连接”：
  - 检查 `API_BASE_URL` 是否为 HTTPS；
  - 检查后端 `FRONTEND_ORIGIN` 是否包含 Pages 域名；
  - 浏览器 Network 看 `/api/health` 是否 200；
  - 检查后端是否允许跨域。

---

## 三、Vercel 部署后端

### 1. 导入项目

Vercel → Add New → Project → 选择仓库。

- **Root Directory**：`backend`
- Framework Preset：Other
- Build Command：留空
- Output Directory：留空
- Install Command：`npm install`

`backend/vercel.json` 会把所有请求重写到 `api/index.js`，Express 在 Serverless Function 内处理路由。

### 2. 环境变量

在 Vercel Project → Settings → Environment Variables 添加：

```
NODE_ENV=production
FRONTEND_ORIGIN=https://<用户名>.github.io
DB_PATH=/tmp/app.db

# 可选：没有也可以完整使用本地教练
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# 营养联网检索
NUTRITION_ONLINE=true

# OCR：auto / ocrspace / tesseract
OCR_PROVIDER=auto
OCR_SPACE_API_KEY=...
```

> `DB_PATH=/tmp/app.db` 是因为 Vercel 只有 `/tmp` 可写；Serverless 实例重启后 SQLite 缓存会丢失。  
> 正式产品建议把 `nutrition_cache` / `plans` / `feedback` 换成 Postgres、Supabase 或 Turso，再在 `src/db.js` 中替换实现。

### 3. 部署

```bash
cd backend
npx vercel --prod
```

或直接在 Vercel 控制台 Deploy。部署后访问：

```
https://<project>.vercel.app/api/health
```

应返回 `ok: true`。

### 4. 常见问题

- **504**：DeepSeek 响应慢；Vercel 免费函数有执行时长限制。可把 `DEEPSEEK_TIMEOUT_MS` 调到 15000，或关闭 AI（不配 key）使用本地教练。
- **数据库只读**：没有设置 `DB_PATH=/tmp/app.db`。
- **CORS 403**：`FRONTEND_ORIGIN` 没包含 Pages 域名，或带了路径/末尾 `/`。
- **OCR 503**：OCR.space 不可用；设 `OCR_PROVIDER=auto` 会回退 Tesseract.js，但 Vercel 上 Tesseract 语言包较大，建议云端 OCR key。

---

## 四、Cloudflare Workers / Containers

### 先说明一个事实

当前后端是 **Express**，使用 Node 的 `fs`、`node:sqlite`、`tesseract.js` 和长连接文件系统。  
它**不能原样直接跑在 Cloudflare Workers 的 V8 隔离环境**里。有两个现实方案：

### 方案 A：Cloudflare Containers（推荐，改动最小）

Cloudflare Containers 可以运行 Docker 镜像，Express 原样跑。

1. 安装 Wrangler 并登录：

```bash
npm i -D wrangler
npx wrangler login
```

2. 为 `backend/` 写 Dockerfile（示例）：

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
```

3. 在 `wrangler.toml` 中配置 Container 与路由（示意）：

```toml
name = "sport-meal-api"
main = "src/worker.js"
compatibility_date = "2026-01-01"

[[containers]]
class_name = "SportMealContainer"
image = "./Dockerfile"
max_instances = 2

[[routes]]
pattern = "api.example.com/*"
zone_name = "example.com"
```

4. 用 Worker 把请求转发给 Container；`DEEPSEEK_API_KEY`、`OCR_SPACE_API_KEY` 用：

```bash
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put OCR_SPACE_API_KEY
```

5. 容器内 SQLite 建议挂载持久卷或用外部 Postgres；不要依赖容器本地磁盘做长期数据。

> 这是最贴近当前代码的部署方式，但需要 Cloudflare 付费/配额支持 Containers。

### 方案 B：把 API 迁到 Hono + Workers

如果必须用纯 Workers：

1. 新建 Worker 项目：`npm create cloudflare@latest`；
2. 安装 `hono`；
3. 把 `src/routes/*` 逐个改写为 Hono 路由；
4. 替换能力：
   - `node:sqlite` → **D1**（`env.DB.prepare(...)`）；
   - 文件缓存 → **KV**；
   - `tesseract.js` → 云端 OCR API（Workers 里不适合跑 wasm OCR）；
   - `express.static` → 不需要，前端在 Pages；
   - `cors` / `helmet` → Hono 中间件；
5. 环境变量用 `wrangler secret put`；
6. 部署：

```bash
npx wrangler deploy
```

Hono 路由示意：

```js
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();
app.use('*', cors({ origin: 'https://<用户名>.github.io' }));
app.get('/api/health', (c) => c.json({ ok: true }));
app.post('/api/plan', async (c) => {
  const body = await c.req.json();
  // 复用 planner / nutrition 的纯函数；D1 替代 node:sqlite
  return c.json({ ok: true });
});
export default app;
```

> 迁移工作量主要不在路由，而在数据库、OCR 和 Node 文件系统。若目标是尽快上线，优先 Vercel；若要长期低成本，建议 Cloudflare Container 或 Vercel + 外部 Postgres。

---

## 五、环境变量总表

| 变量 | 必填 | 说明 |
|---|---|---|
| `PORT` | 否 | 本地端口，默认 3001 |
| `FRONTEND_ORIGIN` | 线上必填 | 允许的前端 Origin，逗号分隔 |
| `DEEPSEEK_API_KEY` | 否 | 不配则本地教练/本地话术 |
| `DEEPSEEK_BASE_URL` | 否 | 默认 `https://api.deepseek.com/v1` |
| `DEEPSEEK_MODEL` | 否 | 默认 `deepseek-chat` |
| `DEEPSEEK_TIMEOUT_MS` | 否 | 默认 25000 |
| `NUTRITION_ONLINE` | 否 | 默认 true；false 则只用本地库/估算 |
| `NUTRITION_TIMEOUT_MS` | 否 | 默认 5000 |
| `OCR_PROVIDER` | 否 | `auto` / `ocrspace` / `tesseract` |
| `OCR_SPACE_API_KEY` | 否 | 不填用演示 key `helloworld`，限流 |
| `OCR_SPACE_LANGUAGE` | 否 | 默认 chs |
| `TESSERACT_LANGS` | 否 | 默认 `chi_sim+eng` |
| `DB_PATH` | 否 | 本地默认 `data/app.db`；Vercel 设 `/tmp/app.db` |
| `API_RATE_LIMIT` | 否 | 默认 120/分钟 |
| `PLAN_RATE_LIMIT` | 否 | 默认 20/分钟 |
| `OCR_RATE_LIMIT` | 否 | 默认 8/分钟 |

**不要**把 `.env` 提交到仓库；`.env.example` 才是模板。

---

## 六、发布检查清单

- [ ] `npm test` 通过；
- [ ] 本地 `/api/health` 返回 ok；
- [ ] 前端右上角显示“后端在线”；
- [ ] 不配置 DeepSeek 也能生成计划；
- [ ] 搜索不到营养时显示“估算值”；
- [ ] 上传菜单图片能识别或优雅提示手动输入；
- [ ] Pages 域名已加入 `FRONTEND_ORIGIN`；
- [ ] 手机 4G 访问 Pages 正常；
- [ ] `.env`、Key、数据库文件没有进 Git；
- [ ] README 中的 API 地址、截图和演示账号是真实的（没有就删掉）。
