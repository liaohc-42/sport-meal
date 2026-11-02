/* 练完吃啥 Pro — 原生前端
 * 说明：所有营养/训练数字均由后端规则引擎计算；本文件负责收集条件、调用 API、渲染结果。
 */
(function () {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const API_BASE = String(CONFIG.apiBaseUrl || '').replace(/\/+$/, '');
  const STORAGE_KEY = 'sport-meal-pro-v1';
  const AVOID_OPTIONS = ['辣', '花生', '海鲜', '蛋', '奶', '豆制品', '麸质', '猪肉', '牛肉', '羊肉', '鸡肉'];
  const SAMPLE_ITEMS = [
    { name: '米饭', grams: 200, price: 1.5 },
    { name: '番茄炒蛋', grams: 200, price: 5 },
    { name: '卤鸡腿', grams: 150, price: 6 },
    { name: '蒜蓉西兰花', grams: 200, price: 3 },
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const DEFAULT_STATE = {
    profile: { sex: 'male', age: 20, heightCm: 175, weightKg: 68, goal: 'cut', experience: 'beginner', daysPerWeek: 3 },
    training: { strengthMin: 45, cardioMin: 20, intensity: 'mid' },
    preferences: { meal: 'lunch', budget: 15, avoid: [] },
    menu: { canteen: '一食堂 · 大众窗口', items: SAMPLE_ITEMS.map(withId) },
    nutrition: null,
    plan: null,
    planDirty: false,
    health: null,
    chat: [],
  };

  let state = loadState();
  let busy = false;
  let clockTimer = null;
  let toastTimer = null;

  function withId(item) {
    return {
      id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `dish-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: item.name,
      grams: Number(item.grams) || 200,
      price: item.price === undefined || item.price === null || item.price === '' ? null : Number(item.price),
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULT_STATE);
      const saved = JSON.parse(raw);
      const merged = structuredClone(DEFAULT_STATE);
      if (saved.profile) Object.assign(merged.profile, saved.profile);
      if (saved.training) Object.assign(merged.training, saved.training);
      if (saved.preferences) Object.assign(merged.preferences, saved.preferences);
      if (saved.menu && Array.isArray(saved.menu.items)) {
        merged.menu.canteen = saved.menu.canteen || merged.menu.canteen;
        merged.menu.items = saved.menu.items.filter((x) => x && x.name).map(withId);
      }
      merged.profile.goal = ['cut', 'gain', 'keep'].includes(merged.profile.goal) ? merged.profile.goal : 'cut';
      merged.training.daysPerWeek = [2, 3, 4, 5].includes(Number(merged.training.daysPerWeek)) ? Number(merged.training.daysPerWeek) : 3;
      merged.training.experience = merged.profile.experience || 'beginner';
      return merged;
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        profile: state.profile,
        training: state.training,
        preferences: state.preferences,
        menu: state.menu,
      }));
    } catch { /* 隐私模式下静默 */ }
  }

  function api(path) { return `${API_BASE}${path}`; }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
  function round(value, digits = 0) {
    const p = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * p) / p;
  }
  function pct(value) { return `${Math.round(clamp(value, 0, 2) * 100)}%`; }
  function formatClock(date) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(date);
  }
  function formatFull(date) {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date);
  }

  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 60000);
    const { timeoutMs, ...fetchOptions } = options;
    const headers = { ...(fetchOptions.headers || {}) };
    if (fetchOptions.body && !(fetchOptions.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(api(path), { ...fetchOptions, headers, signal: controller.signal });
    } catch (error) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') throw new Error('请求超时，请检查后端或网络');
      throw new Error(`无法连接后端（${api(path)}）`);
    }
    clearTimeout(timeout);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw new Error((data && data.error) || `请求失败（HTTP ${response.status}）`);
    return data;
  }

  /* ---------------- 本地目标预览（最终以后端返回为准） ---------------- */
  function localTargets() {
    const p = state.profile;
    const t = state.training;
    const sexOffset = p.sex === 'female' ? -161 : 5;
    const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + sexOffset;
    const factor = t.intensity === 'high' ? 1.25 : t.intensity === 'low' ? 0.8 : 1;
    const exerciseKcal = Math.round((t.strengthMin * 5 + t.cardioMin * 7) * factor);
    const tdee = bmr * 1.4 + exerciseKcal;
    let kcal, protein;
    if (p.goal === 'cut') { kcal = Math.max(1300, tdee - 400); protein = 1.9 * p.weightKg; }
    else if (p.goal === 'gain') { kcal = tdee + 250; protein = 1.8 * p.weightKg; }
    else { kcal = tdee; protein = 1.6 * p.weightKg; }
    const share = { breakfast: .25, lunch: .35, dinner: .30, snack: .15 }[state.preferences.meal] || .35;
    return {
      bmr: round(bmr), tdee: round(tdee), exerciseKcal, kcal: round(kcal), protein: round(protein),
      mealShare: share,
      mealTarget: { kcal: round(kcal * share), protein: round(protein * share) },
    };
  }

  function currentTargets() {
    if (state.plan && !state.planDirty) {
      return (state.plan.plan && state.plan.plan.target) || state.plan.target || localTargets();
    }
    return localTargets();
  }

  function renderStats() {
    const t = currentTargets();
    $('#stat-tdee').textContent = t.tdee;
    $('#stat-meal-kcal').textContent = t.mealTarget.kcal;
    $('#stat-protein').textContent = t.mealTarget.protein;
    $('#stat-exercise').textContent = t.exerciseKcal;
    const total = state.training.strengthMin + state.training.cardioMin;
    $('#training-total').textContent = `${total} 分钟`;
    $('#strength-value').textContent = state.training.strengthMin;
    $('#cardio-value').textContent = state.training.cardioMin;
    const range = $('#strength-range');
    if (range) {
      range.style.setProperty('--pct', `${(state.training.strengthMin / 120) * 100}%`);
      range.setAttribute('aria-valuetext', `${state.training.strengthMin} 分钟`);
    }
    const cardio = $('#cardio-range');
    if (cardio) {
      cardio.style.setProperty('--pct', `${(state.training.cardioMin / 120) * 100}%`);
      cardio.setAttribute('aria-valuetext', `${state.training.cardioMin} 分钟`);
    }
  }

  /* ---------------- 渲染：目标、训练、资料 ---------------- */
  function renderGoal() {
    $$('#goal-tabs [data-goal]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.goal === state.profile.goal);
    });
  }

  function renderTrainingControls() {
    $('#strength-range').value = state.training.strengthMin;
    $('#cardio-range').value = state.training.cardioMin;
    $$('#intensity-seg [data-intensity]').forEach((b) => b.classList.toggle('active', b.dataset.intensity === state.training.intensity));
    $$('#days-seg [data-days]').forEach((b) => b.classList.toggle('active', Number(b.dataset.days) === state.profile.daysPerWeek));
    $('#experience').value = state.profile.experience;
    renderStats();
  }

  function renderProfile() {
    $('#sex').value = state.profile.sex;
    $('#age').value = state.profile.age;
    $('#height').value = state.profile.heightCm;
    $('#weight').value = state.profile.weightKg;
    $('#meal').value = state.preferences.meal;
    $('#budget').value = state.preferences.budget == null ? '' : state.preferences.budget;
    $('#experience').value = state.profile.experience;
    $('#avoid-chips').innerHTML = AVOID_OPTIONS.map((a) => {
      const on = state.preferences.avoid.includes(a);
      return `<button type="button" class="chip ${on ? 'active' : ''}" data-avoid="${esc(a)}" aria-pressed="${on}">${on ? '✕ ' : '+ '}${esc(a)}</button>`;
    }).join('');
  }

  /* ---------------- 渲染：菜单 ---------------- */
  function nutritionFor(index) {
    return state.nutrition && state.nutrition.items ? state.nutrition.items[index] : null;
  }

  function sourceBadge(n) {
    if (!n) return '<span class="src pending">待查询</span>';
    const key = n.source && n.source.key ? n.source.key : 'estimated';
    return `<span class="src ${esc(key)}" title="${esc(n.note || n.source.detail || '')}">${esc(n.source.label)}</span>`;
  }

  function renderMenu() {
    const items = state.menu.items;
    $('#canteen').value = state.menu.canteen;
    $('#menu-count').textContent = `${items.length} 道`;
    $('#menu-list').innerHTML = items.length ? items.map((item, index) => {
      const n = nutritionFor(index);
      const macros = n
        ? `<div class="dr-macros"><b>${n.nutrition.kcal} kcal</b><span>P ${n.nutrition.protein}g · C ${n.nutrition.carbs}g · F ${n.nutrition.fat}g</span></div>`
        : '<div class="dr-macros"><b>—</b><span>查营养后显示</span></div>';
      return `<div class="dish-row" data-index="${index}">
        <div class="dr-name">
          <b title="${esc(item.name)}">${esc(item.name)}</b>
          ${sourceBadge(n)}
          <small>${n ? esc(n.matchedName ? `匹配：${n.matchedName}` : '按菜名估算') : '尚未检索'}</small>
        </div>
        <label class="dr-grams"><input type="number" min="10" max="1000" step="10" value="${item.grams}" data-grams="${index}" aria-label="${esc(item.name)}份量"> g</label>
        ${macros}
        <button class="remove" data-remove="${index}" title="移除" aria-label="移除${esc(item.name)}">×</button>
      </div>`;
    }).join('') : '<div class="menu-empty">还没有菜。上方手动添加，或上传一张菜单图片。</div>';

    const summary = $('#menu-summary');
    if (state.nutrition) {
      const t = state.nutrition.totals;
      const estimated = state.nutrition.meta.estimatedCount || 0;
      summary.hidden = false;
      summary.innerHTML = `<span>合计 <b>${t.kcal} kcal</b> · 蛋白 <b>${t.protein}g</b> · 碳水 ${t.carbs}g · 脂肪 ${t.fat}g${t.price ? ` · ¥${t.price}` : ''}</span>
        <span class="sum-source"><span>${state.nutrition.items.filter((x) => x.source.key === 'online').length} 道联网</span><span>${state.nutrition.items.filter((x) => x.source.key === 'local').length} 道本地库</span>${estimated ? `<span style="color:#9b5d13">${estimated} 道估算</span>` : ''}</span>`;
    } else {
      summary.hidden = true;
    }
  }

  function invalidateNutrition() {
    state.nutrition = null;
    state.plan = null;
    state.planDirty = false;
  }

  function markPlanDirty() {
    if (!state.plan) return;
    state.planDirty = true;
    $('#generated-at').textContent = '条件已更新';
    const warning = $('.plan-warning.dirty');
    if (!warning && $('#plan-result')) {
      const div = document.createElement('div');
      div.className = 'plan-warning dirty';
      div.textContent = '条件已经改变，当前显示的是上一次结果；点“生成今日计划”重新计算。';
      $('#plan-result').prepend(div);
    }
    renderStats();
  }

  /* ---------------- 结果占位 / 渲染 ---------------- */
  function setResultPlaceholder(title, text, isError = false) {
    $('#plan-result').hidden = true;
    const el = $('#result-placeholder');
    el.hidden = false;
    el.innerHTML = `<div class="placeholder-icon">${isError ? '⚠️' : '🥣'}</div>
      <b>${esc(title)}</b><p>${esc(text)}</p>
      ${isError ? '<button class="text-link" id="retry-plan">重试 →</button>' : '<button class="text-link" id="demo-fill">用示例菜单试一下 →</button>'}`;
    const retry = $('#retry-plan');
    if (retry) retry.addEventListener('click', generatePlan);
    const demo = $('#demo-fill');
    if (demo) demo.addEventListener('click', fillDemo);
  }

  function macroBox(label, value, target, unit, coverage) {
    const warn = coverage < 0.75 || coverage > 1.3;
    return `<div class="macro-box ${warn ? 'warn' : ''}">
      <span>${label}</span><b>${value}<small> ${unit}</small></b>
      <small>目标 ${target}${unit} · ${pct(coverage)}</small>
      <div class="macro-bar"><i style="width:${Math.min(100, Math.round(coverage * 100))}%"></i></div>
    </div>`;
  }

  function renderMeal(meal, index, target) {
    const items = meal.items.map((item) => {
      const src = item.source ? item.source.label : '本地';
      const sourceClass = item.source && item.source.key ? item.source.key : 'local';
      return `<div class="meal-item">
        <div><b>${esc(item.name)}</b> <small>${item.grams}g <span class="src ${sourceClass}">${esc(src)}</span></small></div>
        <div class="mi-macro">${item.nutrition.kcal} kcal<br>P ${item.nutrition.protein}g</div>
      </div>`;
    }).join('');
    const flags = (meal.flags || []).map((f) => `<span class="flag ${/低|高|少|超|预算/.test(f) ? 'warn' : 'good'}">${esc(f)}</span>`).join('');
    const swaps = meal.swaps && meal.swaps.length
      ? `<div class="swaps"><b>同菜单可换</b>${meal.swaps.map((s) => `<div class="swap-row"><strong>${esc(s.from)} → ${esc(s.to)}</strong>：${esc(s.reason)}</div>`).join('')}</div>`
      : '';
    const price = meal.totals.price ? ` · ¥${meal.totals.price}` : '';
    return `<div class="meal-card ${index === 0 ? 'best' : ''}">
      <div class="meal-top"><span><b>${esc(meal.label)}</b> <span class="meal-tag">${esc(meal.tag)}</span></span><small class="muted">${meal.totals.kcal} kcal${price}</small></div>
      <div class="meal-items">${items}</div>
      <div class="meal-flags">${flags}</div>
      ${swaps}
    </div>`;
  }

  function renderPlan() {
    if (!state.plan) return;
    const { plan, nutrition, requestId, generatedAt } = state.plan;
    const top = plan.meals[0];
    $('#result-placeholder').hidden = true;
    const box = $('#plan-result');
    box.hidden = false;
    $('#generated-at').textContent = generatedAt ? formatFull(new Date(generatedAt)) : '刚刚生成';

    if (!top) {
      box.innerHTML = `<h2 class="plan-headline">${esc(plan.narrative.headline)}</h2>
        <p class="plan-summary">${esc(plan.narrative.summary)}</p>
        <div class="plan-warning">菜单为空或全部被忌口过滤，请先添加菜品。</div>`;
      return;
    }

    const target = plan.target.mealTarget;
    const coverage = top.coverage;
    const warnings = [...(plan.warnings || [])];
    if (state.planDirty) warnings.unshift('条件已改变，当前是上一次的结果，请重新生成。');
    const warningHtml = warnings.length ? warnings.map((w) => `<div class="plan-warning">${esc(w)}</div>`).join('') : '';

    const weekly = plan.training && plan.training.weekly ? plan.training.weekly : null;
    const weekHtml = weekly ? `<div class="week-grid">${weekly.weekly.map((d) => `
      <div class="week-day ${d.type === 'strength' ? 'training' : ''}">
        <span>${esc(d.day)}</span><b>${esc(d.focus)}</b><small>${d.type === 'rest' ? '恢复' : `${d.duration}′`}</small>
      </div>`).join('')}</div>` : '';

    box.innerHTML = `
      <h2 class="plan-headline">${esc(plan.narrative.headline)}</h2>
      <p class="plan-summary">${esc(plan.narrative.summary)}</p>
      ${warningHtml}
      <div class="macro-grid">
        ${macroBox('热量', top.totals.kcal, target.kcal, ' kcal', coverage.kcal)}
        ${macroBox('蛋白', top.totals.protein, target.protein, 'g', coverage.protein)}
        ${macroBox('碳水', top.totals.carbs, target.carbs, 'g', coverage.carbs)}
        ${macroBox('脂肪', top.totals.fat, target.fat, 'g', coverage.fat)}
      </div>
      <div class="meal-list">${plan.meals.map((m, i) => renderMeal(m, i, target)).join('')}</div>
      <div class="training-result">
        <h3>🏋️ 教练的本周安排</h3>
        <p>${esc(weekly ? weekly.today : plan.narrative.coachNote)}</p>
        ${weekHtml}
        <div class="coach-note"><b>今日重点</b><p>${esc(plan.narrative.mealWhy)}</p></div>
        <p class="disclaimer">${esc(plan.narrative.safety)}</p>
      </div>
      <div class="result-actions">
        <button class="btn primary" data-action="accept" data-plan-id="${esc(requestId)}">✓ 采纳这餐</button>
        <button class="btn ghost" data-action="reject" data-plan-id="${esc(requestId)}">不太合适</button>
      </div>
      <p class="disclaimer">${esc(nutrition && nutrition.meta ? nutrition.meta.note : '')} 数据来源：${esc((() => {
        if (!nutrition || !nutrition.meta || !nutrition.meta.sourceCount) return '本地 / 估算';
        const names = { online: '联网', local: '本地库', estimated: '估算' };
        return Object.entries(nutrition.meta.sourceCount).map(([k, v]) => `${names[k] || k} ${v} 道`).join(' · ');
      })())}。</p>`;
  }

  function renderAll() {
    renderGoal();
    renderTrainingControls();
    renderProfile();
    renderMenu();
    renderStats();
  }

  /* ---------------- API 流程 ---------------- */
  async function loadHealth() {
    const status = $('#api-status');
    status.className = 'status-pill';
    status.innerHTML = '<i></i> 连接后端中';
    try {
      const data = await request('/api/health', { timeoutMs: 6000 });
      state.health = data;
      status.className = 'status-pill online';
      status.innerHTML = `<i></i> 后端在线${data.features.llm ? ' · AI' : ' · 本地教练'}`;
      status.title = JSON.stringify(data.features);
      $('#footer-api').textContent = `API: ${API_BASE || '同源'} · v${data.version}`;
      $('#coach-mode').textContent = data.features.llm ? 'AI / 本地兜底' : '本地教练';
    } catch (error) {
      status.className = 'status-pill offline';
      status.innerHTML = '<i></i> 后端未连接';
      status.title = error.message;
      $('#footer-api').textContent = `API: ${API_BASE || '同源'} · 未连接`;
      $('#coach-mode').textContent = '离线';
    }
  }

  async function lookupNutrition() {
    if (!state.menu.items.length) { toast('先添加一道菜'); return; }
    if (busy) return;
    busy = true;
    const btn = $('#lookup-nutrition');
    btn.disabled = true;
    btn.textContent = '检索中…';
    try {
      const data = await request('/api/nutrition/lookup', {
        method: 'POST',
        body: JSON.stringify({ items: state.menu.items.map(({ name, grams, price }) => ({ name, grams, price })) }),
        timeoutMs: 45000,
      });
      state.nutrition = data;
      state.plan = null;
      state.planDirty = false;
      renderMenu();
      setResultPlaceholder('营养已经查好了', '确认每道菜的份量和“估算值”标签，再生成今日计划。');
      toast(data.meta.estimatedCount ? `查到 ${data.items.length} 道，其中 ${data.meta.estimatedCount} 道使用估算值` : `查到 ${data.items.length} 道菜的营养数据`);
    } catch (error) {
      toast(error.message);
      $('#ocr-status').hidden = false;
      $('#ocr-status').className = 'ocr-status error';
      $('#ocr-status').textContent = `营养查询失败：${error.message}`;
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = '🔎 先查营养';
    }
  }

  async function generatePlan() {
    if (!state.menu.items.length) { toast('先添加今天食堂的菜'); return; }
    if (busy) return;
    busy = true;
    const btn = $('#generate-plan');
    btn.disabled = true;
    btn.innerHTML = '正在查营养 / 生成…';
    $('#result-placeholder').hidden = true;
    $('#plan-result').hidden = false;
    $('#plan-result').innerHTML = '<div class="result-placeholder"><div class="placeholder-icon">⏳</div><b>正在检索营养并组合餐盘</b><p>先联网查每道菜，再由规则引擎组合；如果配置了大模型，会让教练把结论讲得更顺。</p></div>';
    const payload = {
      profile: {
        sex: state.profile.sex,
        age: state.profile.age,
        heightCm: state.profile.heightCm,
        weightKg: state.profile.weightKg,
        goal: state.profile.goal,
        experience: state.profile.experience,
        daysPerWeek: state.profile.daysPerWeek,
      },
      training: {
        strengthMin: state.training.strengthMin,
        cardioMin: state.training.cardioMin,
        intensity: state.training.intensity,
      },
      preferences: {
        meal: state.preferences.meal,
        budget: state.preferences.budget,
        avoid: state.preferences.avoid,
      },
      menu: {
        canteen: state.menu.canteen,
        items: state.menu.items.map(({ name, grams, price }) => ({ name, grams, price })),
      },
      online: true,
    };
    try {
      const data = await request('/api/plan', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 90000 });
      state.plan = data;
      state.nutrition = data.nutrition;
      state.planDirty = false;
      renderMenu();
      renderPlan();
      renderStats();
      $('#coach-mode').textContent = data.mode === 'ai' ? 'AI 教练' : '本地教练';
      toast(data.mode === 'ai' ? '计划已生成 · AI 教练已润色' : '计划已生成 · 本地教练模式');
    } catch (error) {
      setResultPlaceholder('计划没生成出来', error.message, true);
      toast(error.message);
    } finally {
      busy = false;
      btn.disabled = false;
      btn.innerHTML = '生成今日计划 <span>→</span>';
    }
  }

  function fillDemo() {
    state.menu.items = SAMPLE_ITEMS.map(withId);
    state.menu.canteen = '一食堂 · 大众窗口';
    state.nutrition = null;
    state.plan = null;
    state.planDirty = false;
    saveState();
    renderMenu();
    renderStats();
    setResultPlaceholder('示例菜单已放好', '点“生成今日计划”，看看后端如何先查营养、再组合餐盘。');
    toast('已放入 4 道示例菜');
  }

  /* ---------------- 菜单编辑 ---------------- */
  function addDish(name, grams, price) {
    const clean = String(name || '').trim();
    if (!clean) { toast('先输入菜名'); return false; }
    const item = withId({ name: clean.slice(0, 40), grams: clamp(grams || 200, 10, 1000), price: price === '' || price === undefined || price === null ? null : clamp(price, 0, 999) });
    state.menu.items.push(item);
    invalidateNutrition();
    saveState();
    renderMenu();
    renderStats();
    setResultPlaceholder('菜单已更新', '重新查营养或生成计划，结果会按新的菜单计算。');
    return true;
  }

  function deleteDish(index) {
    if (index < 0 || index >= state.menu.items.length) return;
    state.menu.items.splice(index, 1);
    invalidateNutrition();
    saveState();
    renderMenu();
    renderStats();
    setResultPlaceholder('菜单已更新', '重新查营养或生成计划，结果会按新的菜单计算。');
  }

  function updateGrams(index, grams, inputEl) {
    if (index < 0 || index >= state.menu.items.length) return;
    const next = clamp(grams, 10, 1000);
    state.menu.items[index].grams = next;
    inputEl.value = String(next);
    if (state.nutrition && state.nutrition.items[index] && state.nutrition.items[index].per100g) {
      const n = state.nutrition.items[index];
      const f = next / 100;
      n.grams = next;
      n.nutrition = {
        kcal: round(n.per100g.kcal * f),
        protein: round(n.per100g.protein * f, 1),
        carbs: round(n.per100g.carbs * f, 1),
        fat: round(n.per100g.fat * f, 1),
      };
      state.nutrition.totals = state.nutrition.items.reduce((a, x) => {
        a.kcal += x.nutrition.kcal; a.protein += x.nutrition.protein; a.carbs += x.nutrition.carbs; a.fat += x.nutrition.fat; a.price += x.price || 0;
        return a;
      }, { kcal: 0, protein: 0, carbs: 0, fat: 0, price: 0 });
      state.nutrition.totals.kcal = round(state.nutrition.totals.kcal);
      state.nutrition.totals.protein = round(state.nutrition.totals.protein, 1);
      state.nutrition.totals.carbs = round(state.nutrition.totals.carbs, 1);
      state.nutrition.totals.fat = round(state.nutrition.totals.fat, 1);
      state.nutrition.totals.price = round(state.nutrition.totals.price, 1);
    }
    markPlanDirty();
    saveState();
    renderMenu();
    renderStats();
  }

  async function uploadMenu(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('请选择图片文件'); return; }
    const status = $('#ocr-status');
    status.hidden = false;
    status.className = 'ocr-status';
    status.textContent = '📷 正在识别菜单，可能需要几秒…';
    const form = new FormData();
    form.append('image', file);
    try {
      const data = await request('/api/ocr/menu', { method: 'POST', body: form, timeoutMs: 40000 });
      let added = 0;
      for (const item of data.items || []) {
        const name = String(item.name || '').trim();
        if (!name) continue;
        if (!state.menu.items.some((x) => x.name === name)) {
          state.menu.items.push(withId({ name, grams: 200, price: null }));
          added++;
        }
      }
      invalidateNutrition();
      saveState();
      renderMenu();
      renderStats();
      status.className = 'ocr-status';
      status.textContent = `识别到 ${(data.items || []).length} 行，新增 ${added} 道菜。请核对菜名和份量，再查营养。`;
      setResultPlaceholder('菜单图片已导入', '核对识别结果，修正菜名/份量后生成计划。');
      toast(`图片识别完成，新增 ${added} 道`);
    } catch (error) {
      status.className = 'ocr-status error';
      status.textContent = `图片识别失败：${error.message}。可以手动输入菜名。`;
      toast(error.message);
    } finally {
      $('#menu-image').value = '';
    }
  }

  /* ---------------- 教练对话 ---------------- */
  function appendChat(role, text) {
    const chat = $('#chat');
    const div = document.createElement('div');
    div.className = `chat-msg ${role === 'user' ? 'user' : 'coach'}`;
    div.innerHTML = `<span>${role === 'user' ? '你' : '教练'}</span><p>${esc(text)}</p>`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    state.chat.push({ role, text });
    if (state.chat.length > 20) state.chat = state.chat.slice(-20);
  }

  async function askCoach(message) {
    const text = String(message || '').trim();
    if (!text) return;
    appendChat('user', text);
    const button = $('#chat-form button');
    button.disabled = true;
    try {
      const context = {
        goal: state.profile.goal,
        targets: state.plan ? state.plan.plan.target.mealTarget : localTargets().mealTarget,
        todayTraining: { strengthMin: state.training.strengthMin, cardioMin: state.training.cardioMin, intensity: state.training.intensity },
        planSummary: state.plan ? state.plan.plan.narrative.summary : null,
      };
      const data = await request('/api/coach', { method: 'POST', body: JSON.stringify({ message: text, context }), timeoutMs: 45000 });
      appendChat('coach', data.reply);
      $('#coach-mode').textContent = data.mode === 'ai' ? 'AI 教练' : '本地教练';
    } catch (error) {
      appendChat('coach', `后端暂时没连上：${error.message}。可以稍后重试，或先按“蛋白 + 主食 + 蔬菜”的结构选一餐。`);
    } finally {
      button.disabled = false;
    }
  }

  /* ---------------- 反馈 ---------------- */
  async function sendFeedback(planId, rating, comment = '') {
    try {
      await request('/api/feedback', { method: 'POST', body: JSON.stringify({ planId, rating, comment, meta: { goal: state.profile.goal } }), timeoutMs: 15000 });
      toast(rating >= 4 ? '已采纳，教练会记住这次选择' : '收到，下次会更保守一点');
      $$('.result-actions .btn').forEach((b) => { b.disabled = true; });
    } catch (error) {
      toast(`反馈没保存：${error.message}`);
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    document.addEventListener('click', (event) => {
      const goal = event.target.closest('[data-goal]');
      if (goal) {
        state.profile.goal = goal.dataset.goal;
        renderGoal(); markPlanDirty(); saveState(); renderStats();
        return;
      }
      const intensity = event.target.closest('[data-intensity]');
      if (intensity) {
        state.training.intensity = intensity.dataset.intensity;
        $$('#intensity-seg [data-intensity]').forEach((b) => b.classList.toggle('active', b === intensity));
        markPlanDirty(); saveState(); renderStats();
        return;
      }
      const days = event.target.closest('[data-days]');
      if (days) {
        state.profile.daysPerWeek = Number(days.dataset.days);
        $$('#days-seg [data-days]').forEach((b) => b.classList.toggle('active', b === days));
        markPlanDirty(); saveState();
        return;
      }
      const sample = event.target.closest('[data-sample]');
      if (sample) {
        const [name, grams, price] = sample.dataset.sample.split('|');
        if (addDish(name, Number(grams), price === '' ? null : Number(price))) toast(`已添加 ${name}`);
        return;
      }
      const remove = event.target.closest('[data-remove]');
      if (remove) {
        deleteDish(Number(remove.dataset.remove));
        return;
      }
      const avoid = event.target.closest('[data-avoid]');
      if (avoid) {
        const value = avoid.dataset.avoid;
        const at = state.preferences.avoid.indexOf(value);
        if (at >= 0) state.preferences.avoid.splice(at, 1);
        else state.preferences.avoid.push(value);
        renderProfile(); markPlanDirty(); saveState();
        return;
      }
      const ask = event.target.closest('[data-ask]');
      if (ask) { askCoach(ask.dataset.ask); return; }
      const action = event.target.closest('[data-action]');
      if (action) {
        if (action.dataset.action === 'accept') sendFeedback(action.dataset.planId, 5, '采纳');
        if (action.dataset.action === 'reject') sendFeedback(action.dataset.planId, 2, '不太合适');
      }
    });

    $('#strength-range').addEventListener('input', (e) => {
      state.training.strengthMin = Number(e.target.value);
      renderStats(); markPlanDirty(); saveState();
    });
    $('#cardio-range').addEventListener('input', (e) => {
      state.training.cardioMin = Number(e.target.value);
      renderStats(); markPlanDirty(); saveState();
    });

    ['#sex', '#age', '#height', '#weight', '#meal', '#budget', '#experience'].forEach((sel) => {
      $(sel).addEventListener('change', () => {
        state.profile.sex = $('#sex').value;
        state.profile.age = clamp($('#age').value, 14, 80);
        state.profile.heightCm = clamp($('#height').value, 130, 220);
        state.profile.weightKg = clamp($('#weight').value, 30, 200);
        state.preferences.meal = $('#meal').value;
        state.preferences.budget = $('#budget').value === '' ? null : clamp($('#budget').value, 0, 999);
        state.profile.experience = $('#experience').value;
        markPlanDirty(); saveState(); renderStats();
      });
    });

    $('#add-dish').addEventListener('click', () => {
      const name = $('#dish-name').value;
      const grams = Number($('#dish-grams').value) || 200;
      const price = $('#dish-price').value;
      if (addDish(name, grams, price === '' ? null : Number(price))) {
        $('#dish-name').value = '';
        $('#dish-price').value = '';
        $('#dish-name').focus();
        toast(`已添加 ${name}`);
      }
    });
    $('#dish-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('#add-dish').click(); }
    });
    $('#menu-list').addEventListener('change', (e) => {
      const input = e.target.closest('[data-grams]');
      if (input) updateGrams(Number(input.dataset.grams), input.value, input);
    });
    $('#canteen').addEventListener('change', (e) => {
      state.menu.canteen = e.target.value;
      saveState(); markPlanDirty();
    });
    $('#menu-image').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) uploadMenu(file);
    });
    $('#lookup-nutrition').addEventListener('click', lookupNutrition);
    $('#generate-plan').addEventListener('click', generatePlan);
    $('#demo-fill').addEventListener('click', fillDemo);
    $('#chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#chat-input');
      const value = input.value.trim();
      if (!value) return;
      input.value = '';
      askCoach(value);
    });
    $('#open-help').addEventListener('click', () => {
      $('#help-modal').classList.add('open');
      $('#help-modal').setAttribute('aria-hidden', 'false');
    });
    $('#close-help').addEventListener('click', closeHelp);
    $('#help-modal').addEventListener('click', (e) => {
      if (e.target.id === 'help-modal') closeHelp();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHelp(); });
  }

  function closeHelp() {
    $('#help-modal').classList.remove('open');
    $('#help-modal').setAttribute('aria-hidden', 'true');
  }

  /* ---------------- 启动 ---------------- */
  function startClock() {
    const tick = () => { $('#clock').textContent = formatClock(new Date()); };
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  function init() {
    renderAll();
    if (state.plan) renderPlan();
    else if (state.nutrition) setResultPlaceholder('营养已经查好了', '点“生成今日计划”，按当前条件组合一餐。');
    startClock();
    bindEvents();
    loadHealth();
    setInterval(loadHealth, 60000);
    window.addEventListener('beforeunload', () => clearInterval(clockTimer));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // 给浏览器回归测试留只读探针
  window.__SPORT_MEAL__ = {
    getState: () => JSON.parse(JSON.stringify(state)),
    getTargets: () => currentTargets(),
    apiBase: API_BASE,
  };
})();
