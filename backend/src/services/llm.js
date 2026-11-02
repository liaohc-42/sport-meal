'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { HttpError } = require('../utils/http');

const knowledgePath = path.join(config.root, 'data', 'nutrition-knowledge.md');
let knowledge = '';
try {
  knowledge = fs.readFileSync(knowledgePath, 'utf8');
} catch {
  knowledge = '运动营养与训练原则：保证蛋白质、训练前后碳水、蔬菜和睡眠；不提供医疗建议。';
}

function isConfigured() {
  return Boolean(config.deepseek.apiKey);
}

function parseJson(text) {
  if (!text) return null;
  let cleaned = String(text).trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  try { return JSON.parse(cleaned); } catch { /* try substring */ }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

async function callDeepSeek(messages, options = {}) {
  if (!isConfigured()) {
    const error = new Error('DEEPSEEK_API_KEY 未配置');
    error.code = 'NO_KEY';
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.deepseek.timeoutMs);
  try {
    const response = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseek.apiKey}`,
      },
      body: JSON.stringify({
        model: config.deepseek.model,
        temperature: options.temperature === undefined ? 0.4 : options.temperature,
        max_tokens: options.maxTokens || 800,
        messages,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const msg = data && data.error ? (data.error.message || data.error) : `HTTP ${response.status}`;
      throw new HttpError(502, `大模型接口错误：${msg}`);
    }
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    if (!content) throw new HttpError(502, '大模型返回为空');
    return content;
  } catch (error) {
    if (error.name === 'AbortError') throw new HttpError(504, '大模型请求超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function safeText(value, min, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length < min || text.length > max) return '';
  if (/保证|治愈|治疗|包过|一定能|绝对/.test(text)) return '';
  return text;
}

async function enhancePlan(plan, nutrition) {
  if (!isConfigured()) return { used: false, reason: '未配置 DEEPSEEK_API_KEY，使用本地教练话术' };
  const facts = {
    date: plan.date,
    goal: plan.profile.goal,
    targets: plan.target.mealTarget,
    training: {
      strengthMin: plan.training.strengthMin,
      cardioMin: plan.training.cardioMin,
      exerciseKcal: plan.training.exerciseKcal,
      today: plan.training.weekly.today,
    },
    meals: plan.meals.map((meal) => ({
      label: meal.label,
      items: meal.items.map((item) => ({ name: item.name, grams: item.grams })),
      totals: meal.totals,
      coverage: meal.coverage,
      flags: meal.flags,
    })),
    nutritionMeta: nutrition.meta,
    localNarrative: plan.narrative,
  };
  const system = [
    '你是一个校园运动营养教练，服务对象是大学生。',
    '你只能依据用户提供的结构化事实说话，不要新增菜品、价格、营养数字或训练动作。',
    '不要提供医疗诊断、药物、极端节食或“保证变瘦/增肌”的承诺。',
    '语气像靠谱的学长，具体、克制、可执行。',
    '只输出 JSON：{"headline":"不超过24字","summary":"不超过100字","coachNote":"不超过80字","mealWhy":"不超过80字","safety":"不超过80字"}',
  ].join('\n');
  const user = JSON.stringify(facts);
  try {
    const content = await callDeepSeek([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { json: true, maxTokens: 600, temperature: 0.35 });
    const data = parseJson(content);
    if (!data) throw new HttpError(502, '模型输出不是 JSON');
    const narrative = {
      headline: safeText(data.headline, 4, 40) || plan.narrative.headline,
      summary: safeText(data.summary, 10, 180) || plan.narrative.summary,
      coachNote: safeText(data.coachNote, 5, 120) || plan.narrative.coachNote,
      mealWhy: safeText(data.mealWhy, 5, 160) || plan.narrative.mealWhy,
      safety: safeText(data.safety, 10, 180) || plan.narrative.safety,
    };
    return { used: true, provider: 'deepseek', model: config.deepseek.model, narrative };
  } catch (error) {
    return { used: false, reason: error.message || '模型调用失败，已回退本地文案' };
  }
}

async function coachReply(message, context = {}) {
  if (!isConfigured()) {
    return { used: false, reply: localCoachReply(message, context), reason: '本地教练模式' };
  }
  const system = [
    '你是校园运动与食堂营养教练。',
    '已知知识库如下：',
    knowledge.slice(0, 9000),
    '规则：只给一般性运动营养建议；不诊断疾病；不推荐药物或极端节食；如涉及疼痛、疾病、进食障碍，建议就医。',
    '回答控制在 3–5 句，先给结论，再给一个今天能做的动作；不要编造用户没有提供的数字。',
  ].join('\n');
  const user = JSON.stringify({
    question: message,
    context: {
      goal: context.goal,
      targets: context.targets,
      todayTraining: context.todayTraining,
      planSummary: context.planSummary,
    },
  });
  try {
    const content = await callDeepSeek([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { maxTokens: 500, temperature: 0.5 });
    const reply = safeText(content, 6, 600);
    if (!reply) throw new HttpError(502, '模型回答未通过校验');
    return { used: true, provider: 'deepseek', reply };
  } catch (error) {
    return { used: false, reply: localCoachReply(message, context), reason: error.message };
  }
}

function localCoachReply(message, context = {}) {
  const text = String(message || '');
  const goal = context.goal === 'gain' ? '增肌' : context.goal === 'keep' ? '维持' : '减脂';
  if (/酸|痛|受伤|膝|腰|肩/.test(text)) {
    return '先别硬扛：停止引发疼痛的动作，24–48 小时内以休息和轻活动为主；如果关节刺痛、肿胀或影响走路，建议尽快去校医院或运动康复门诊。恢复后先从无痛范围的动作和轻重量开始。';
  }
  if (/蛋白|鸡胸|增肌/.test(text)) {
    return `按你今天的${goal}目标，先把每餐蛋白放在 20–40g：优先鸡胸、鱼、牛肉、鸡蛋、豆腐或无糖酸奶。训练后不用急着灌蛋白粉，先吃一顿有蛋白和主食的饭；全天总量比“练完 5 分钟内”更重要。`;
  }
  if (/减脂|瘦|热量|碳水/.test(text)) {
    return '减脂不要先砍蛋白：保留每餐一个手掌大小的蛋白菜，主食减到原来的 2/3 而不是清零，蔬菜尽量占半盘。先这样做两周，再根据体重和训练表现微调，不要一天一个方案。';
  }
  if (/练|训练|有氧|力量/.test(text)) {
    return '今天优先完成 5–10 分钟动态热身，再做 3–4 个复合动作（深蹲、推、拉、髋主导），每个 2–3 组、保留 2–3 次余力。若昨天练腿很酸，今天改上肢或快走，不要把“酸痛”当成效果指标。';
  }
  if (/早餐|晚饭|食堂|吃什么/.test(text)) {
    return '在食堂按“1 份蛋白 + 1 份主食 + 1–2 份蔬菜”打底：例如鸡腿/鱼/豆腐 + 米饭/玉米 + 两份青菜。先保证这个结构，再根据目标是减脂还是增肌调整主食份量。';
  }
  return '先把今天拆成两件事：一是完成一次不受伤的训练，二是下一餐按“蛋白 + 主食 + 蔬菜”搭一盘。你告诉我今天的训练时长、目标和食堂能看到的菜，我可以直接帮你排一餐。';
}

module.exports = { isConfigured, enhancePlan, coachReply, localCoachReply, callDeepSeek, knowledge };
