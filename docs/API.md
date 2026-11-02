# API Reference

Base URL（本地）：`http://localhost:3001`  
所有请求/响应均为 JSON，图片 OCR 使用 `multipart/form-data`。

## 错误格式

```json
{ "error": "人类可读的错误信息" }
```

常见状态码：`400` 参数错误、`403` CORS 来源不允许、`413` 文件过大、`422` OCR 无结果、`429` 限流、`502/504` 上游模型/OCR 失败、`503` 未配置能力。

---

## GET /api/health

健康检查与能力开关。

```json
{
  "ok": true,
  "service": "sport-meal-api",
  "version": "2.0.0",
  "time": "2026-11-02T08:44:03.492Z",
  "features": {
    "llm": false,
    "ocr": true,
    "nutritionOnline": true,
    "database": { "enabled": true, "driver": "node:sqlite", "path": "..." }
  }
}
```

`features.llm=false` 表示未配置 `DEEPSEEK_API_KEY`，计划/教练会使用本地规则。

---

## GET /api/foods?q=鸡胸&limit=8

搜索本地营养库（用于调试与扩展，不参与主流程）。

```json
{
  "query": "鸡胸",
  "count": 1,
  "items": [
    {
      "id": "chicken-breast",
      "name": "鸡胸肉",
      "category": "protein",
      "per100g": { "kcal": 165, "protein": 31, "carbs": 0, "fat": 3.6 },
      "defaultGrams": 150
    }
  ]
}
```

---

## POST /api/nutrition/lookup

先联网检索，再回退本地库，最后按菜名常识估算。每道菜独立返回 `source`。

请求：

```json
{
  "items": [
    { "name": "番茄炒蛋", "grams": 200, "price": 5 },
    { "name": "外星料理", "grams": 180 }
  ],
  "online": true
}
```

响应（节选）：

```json
{
  "items": [
    {
      "name": "番茄炒蛋",
      "grams": 200,
      "per100g": { "kcal": 86, "protein": 5.4, "carbs": 4, "fat": 5.3 },
      "nutrition": { "kcal": 172, "protein": 10.8, "carbs": 8, "fat": 10.6 },
      "source": { "key": "local", "label": "本地营养库", "confidence": "high" },
      "matchedName": "番茄炒蛋",
      "note": "含炒油"
    },
    {
      "name": "外星料理",
      "source": { "key": "estimated", "label": "估算值", "confidence": "low" },
      "note": "未检索到精确数据，按菜名关键词与同类菜品常识估算"
    }
  ],
  "totals": { "kcal": 440, "protein": 25.2, "carbs": 40.4, "fat": 19.8, "price": 5 },
  "meta": {
    "itemCount": 2,
    "sourceCount": { "local": 1, "estimated": 1 },
    "estimatedCount": 1,
    "note": "部分菜品未检索到精确数据，已按常识估算并标注“估算值”。"
  }
}
```

`source.key`：
- `online`：Open Food Facts 检索到可用的包装食品数据；
- `local`：本地种子营养库；
- `estimated`：常识估算，前端必须突出“估算值”。

---

## POST /api/plan

核心接口。后端会重新执行营养检索（有缓存）、组餐、训练安排和可选的 LLM 润色。

请求：

```json
{
  "profile": {
    "sex": "male",
    "age": 20,
    "heightCm": 175,
    "weightKg": 68,
    "goal": "cut",
    "experience": "beginner",
    "daysPerWeek": 3
  },
  "training": {
    "strengthMin": 45,
    "cardioMin": 20,
    "intensity": "mid"
  },
  "preferences": {
    "meal": "lunch",
    "budget": 15,
    "avoid": ["辣"]
  },
  "menu": {
    "canteen": "一食堂 · 大众窗口",
    "items": [
      { "name": "米饭", "grams": 200, "price": 1.5 },
      { "name": "番茄炒蛋", "grams": 200, "price": 5 },
      { "name": "卤鸡腿", "grams": 150, "price": 6 }
    ]
  }
}
```

响应（节选）：

```json
{
  "requestId": "uuid",
  "generatedAt": "2026-11-02T09:00:00.000Z",
  "mode": "local",
  "nutrition": { "items": [], "totals": {}, "meta": {} },
  "plan": {
    "target": {
      "tdee": 2715,
      "exerciseKcal": 365,
      "mealTarget": { "kcal": 810, "protein": 45, "carbs": 81, "fat": 24 }
    },
    "meals": [
      {
        "label": "蛋白优先",
        "tag": "训练后修复",
        "items": [
          { "name": "卤鸡腿", "grams": 150, "nutrition": { "kcal": 272, "protein": 36 } }
        ],
        "totals": { "kcal": 614, "protein": 47.2, "carbs": 63.8, "fat": 17.6, "price": 10.5 },
        "coverage": { "kcal": 0.76, "protein": 1.05, "carbs": 0.79, "fat": 0.73 },
        "flags": ["蛋白达标", "有蔬菜/搭配"],
        "swaps": [{ "from": "卤鸡腿", "to": "番茄炒蛋", "reason": "..." }]
      }
    ],
    "training": {
      "weekly": {
        "weekly": [{ "day": "周一", "focus": "全身 A", "type": "strength", "duration": 45 }],
        "today": "今天已完成 45 分钟力量 + 20 分钟有氧。",
        "principles": []
      }
    },
    "narrative": {
      "headline": "减脂日：先把蛋白吃够，再谈热量",
      "summary": "...",
      "coachNote": "...",
      "mealWhy": "...",
      "safety": "..."
    },
    "ai": { "used": false, "provider": "local", "reason": "未配置 DEEPSEEK_API_KEY" }
  }
}
```

> `mode=ai` 只代表文案由模型润色；所有数字仍来自规则引擎和营养检索。

---

## POST /api/coach

```json
{
  "message": "练完腿酸，明天还能练吗？",
  "context": {
    "goal": "cut",
    "targets": { "protein": 45, "kcal": 810 },
    "todayTraining": { "strengthMin": 45, "cardioMin": 20, "intensity": "mid" },
    "planSummary": "今天首推..."
  }
}
```

响应：

```json
{ "reply": "...", "mode": "local", "provider": "local", "note": "未配置模型，使用本地教练" }
```

如果配置了 `DEEPSEEK_API_KEY`，会调用模型；失败自动回退本地教练。

---

## POST /api/ocr/menu

`multipart/form-data`，字段名 `image`，支持 jpg/png/webp，最大 8MB。

```bash
curl -X POST http://localhost:3001/api/ocr/menu \
  -F "image=@menu.jpg"
```

响应：

```json
{
  "provider": "ocr.space",
  "items": [{ "name": "米饭", "raw": "米饭" }],
  "rawText": "今日菜单\n米饭1.5元\n...",
  "note": "OCR 只负责识别菜名，营养数据仍需联网检索或估算"
}
```

- 默认 `OCR_PROVIDER=auto`：先 OCR.space，再回退 Tesseract.js；
- 只使用本地：`OCR_PROVIDER=tesseract`（首次会下载中文语言包）；
- 只使用云端：`OCR_PROVIDER=ocrspace`（需要可用 key）。

---

## POST /api/feedback

```json
{ "planId": "uuid", "rating": 5, "comment": "采纳", "meta": { "goal": "cut" } }
```

`rating` 必须是 1–5 的整数/数字；用于后续个性化排序。

---

## 速率限制

默认：
- `/api/*`：120 次/分钟/IP；
- `/api/plan`：20 次/分钟/IP；
- `/api/ocr`：8 次/分钟/IP。

可通过环境变量调整。
