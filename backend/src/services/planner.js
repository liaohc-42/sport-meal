'use strict';

const { clamp, round } = require('../utils/http');

const ACTIVITY = 1.4;
const GOAL_LABEL = { cut: '减脂', gain: '增肌', keep: '维持' };
const MEAL_SHARE = { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.15 };
const INTENSITY = { low: 0.8, mid: 1, high: 1.25 };

function normalizeProfile(profile = {}) {
  return {
    sex: profile.sex === 'female' ? 'female' : 'male',
    age: clamp(profile.age || 20, 14, 80),
    heightCm: clamp(profile.heightCm || 172, 130, 220),
    weightKg: clamp(profile.weightKg || 65, 30, 200),
    goal: ['cut', 'gain', 'keep'].includes(profile.goal) ? profile.goal : 'cut',
    experience: ['beginner', 'intermediate', 'advanced'].includes(profile.experience) ? profile.experience : 'beginner',
    daysPerWeek: clamp(profile.daysPerWeek || 3, 2, 6),
  };
}

function normalizeTraining(training = {}) {
  return {
    strengthMin: clamp(training.strengthMin || 0, 0, 240),
    cardioMin: clamp(training.cardioMin || 0, 0, 240),
    intensity: ['low', 'mid', 'high'].includes(training.intensity) ? training.intensity : 'mid',
  };
}

function normalizePreferences(preferences = {}) {
  return {
    meal: ['breakfast', 'lunch', 'dinner', 'snack'].includes(preferences.meal) ? preferences.meal : 'lunch',
    budget: preferences.budget === '' || preferences.budget === undefined ? null : clamp(preferences.budget, 0, 999),
    avoid: Array.isArray(preferences.avoid) ? preferences.avoid.filter(Boolean).slice(0, 12) : [],
  };
}

function calcTargets(profile, training, preferences) {
  const sexOffset = profile.sex === 'female' ? -161 : 5;
  const bmr = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age + sexOffset;
  const factor = INTENSITY[training.intensity] || 1;
  const exerciseKcal = Math.round((training.strengthMin * 5 + training.cardioMin * 7) * factor);
  const tdee = bmr * ACTIVITY + exerciseKcal;

  let kcal;
  let protein;
  let carbs;
  if (profile.goal === 'cut') {
    kcal = Math.max(1300, tdee - 400);
    protein = 1.9 * profile.weightKg;
    carbs = (training.cardioMin >= 30 ? 4.0 : 3.4) * profile.weightKg;
  } else if (profile.goal === 'gain') {
    kcal = tdee + 250;
    protein = 1.8 * profile.weightKg;
    carbs = (training.cardioMin >= 30 ? 6.0 : 5.0) * profile.weightKg;
  } else {
    kcal = tdee;
    protein = 1.6 * profile.weightKg;
    carbs = 4.5 * profile.weightKg;
  }
  const fat = Math.max(0.7 * profile.weightKg, (kcal * 0.27) / 9);
  const share = MEAL_SHARE[preferences.meal] || 0.35;
  return {
    bmr: round(bmr, 0),
    tdee: round(tdee, 0),
    exerciseKcal,
    kcal: round(kcal, 0),
    protein: round(protein, 0),
    carbs: round(carbs, 0),
    fat: round(fat, 0),
    mealShare: share,
    mealTarget: {
      kcal: round(kcal * share, 0),
      protein: round(protein * share, 0),
      carbs: round(carbs * share, 0),
      fat: round(fat * share, 0),
    },
  };
}

function classify(name) {
  const n = String(name || '');
  const hasProtein = /鸡|牛|猪|羊|鱼|虾|蛋|豆腐|豆干|肉|奶|蛋白粉|鸡胸|鸡腿|肠|火腿/.test(n);
  const hasCarb = /米饭|饭|面|粉|粥|馒头|包|吐司|玉米|紫薯|红薯|土豆|燕麦|饺|馄饨|米线|河粉/.test(n);
  const hasVeg = /菜|瓜|番茄|西红柿|西兰花|菠菜|蘑菇|菇|萝卜|汤|沙拉|海带|木耳/.test(n);
  if (hasProtein && hasCarb) return 'mixed';
  if (hasProtein) return 'protein';
  if (hasCarb) return 'carb';
  if (hasVeg) return 'veg';
  return 'extra';
}

function cloneItem(item, grams) {
  const g = clamp(grams === undefined ? item.grams : grams, 10, 1000);
  const f = g / 100;
  return {
    name: item.name,
    grams: round(g, 0),
    price: item.price,
    category: classify(item.name),
    per100g: item.per100g,
    nutrition: {
      kcal: round(item.per100g.kcal * f, 0),
      protein: round(item.per100g.protein * f, 1),
      carbs: round(item.per100g.carbs * f, 1),
      fat: round(item.per100g.fat * f, 1),
    },
    source: item.source,
    matchedName: item.matchedName,
    note: item.note,
  };
}

function totalsOf(items) {
  const t = items.reduce((acc, item) => {
    acc.kcal += item.nutrition.kcal;
    acc.protein += item.nutrition.protein;
    acc.carbs += item.nutrition.carbs;
    acc.fat += item.nutrition.fat;
    if (item.price != null) acc.price += item.price;
    return acc;
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0, price: 0 });
  return {
    kcal: round(t.kcal, 0),
    protein: round(t.protein, 1),
    carbs: round(t.carbs, 1),
    fat: round(t.fat, 1),
    price: round(t.price, 1),
  };
}

function scoreItem(item, goal) {
  const p = item.per100g.protein;
  const f = item.per100g.fat;
  const k = item.per100g.kcal;
  if (goal === 'gain') return p * 3 - f * 0.8 + k * 0.02;
  if (goal === 'cut') return p * 2.5 - f * 1.8 - k * 0.04;
  return p * 2 - f * 0.8;
}

function makeCombination(selected, profile, target, label, tag, reason) {
  const items = selected.map((x) => cloneItem(x.item, x.grams));
  const totals = totalsOf(items);
  const coverage = {
    protein: round(totals.protein / Math.max(target.mealTarget.protein, 1), 3),
    carbs: round(totals.carbs / Math.max(target.mealTarget.carbs, 1), 3),
    kcal: round(totals.kcal / Math.max(target.mealTarget.kcal, 1), 3),
    fat: round(totals.fat / Math.max(target.mealTarget.fat, 1), 3),
  };
  const flags = [];
  if (coverage.protein >= 0.9) flags.push('蛋白达标');
  else if (coverage.protein < 0.75) flags.push('蛋白偏低');
  if (coverage.carbs < 0.65) flags.push('碳水偏低');
  if (coverage.kcal > 1.25) flags.push('热量偏高');
  if (items.some((i) => i.category === 'veg' || i.category === 'mixed')) flags.push('有蔬菜/搭配');
  if (items.some((i) => i.source.key === 'estimated')) flags.push('含估算值');

  return {
    label,
    tag,
    reason,
    items,
    totals,
    coverage,
    flags,
    note: reason,
  };
}

function chooseBest(list, goal) {
  return list.slice().sort((a, b) => scoreItem(b, goal) - scoreItem(a, goal))[0];
}

function buildSwaps(plan, allItems, target, goal) {
  const selectedIds = new Set(plan.items.map((i) => i.name));
  const swaps = [];
  for (const item of plan.items) {
    const category = item.category;
    const candidates = allItems.filter((x) => !selectedIds.has(x.name) && classify(x.name) === category);
    let best = null;
    for (const candidate of candidates) {
      const factor = 100;
      const candKcal = candidate.per100g.kcal;
      const candProtein = candidate.per100g.protein;
      const candFat = candidate.per100g.fat;
      const oldKcal = item.per100g.kcal;
      const oldProtein = item.per100g.protein;
      const oldFat = item.per100g.fat;
      let score = 0;
      let reason = '';
      if (goal === 'cut') {
        score = (oldKcal - candKcal) * 0.05 + (oldFat - candFat) * 1.5 + (candProtein - oldProtein) * 0.4;
        reason = `每 100g 热量 ${candKcal - oldKcal >= 0 ? '+' : ''}${round(candKcal - oldKcal, 0)} kcal，脂肪 ${candFat - oldFat >= 0 ? '+' : ''}${round(candFat - oldFat, 1)}g`;
      } else if (goal === 'gain') {
        score = (candProtein - oldProtein) * 2 + (candKcal - oldKcal) * 0.02 - Math.max(0, candFat - oldFat) * 0.3;
        reason = `每 100g 蛋白 ${candProtein - oldProtein >= 0 ? '+' : ''}${round(candProtein - oldProtein, 1)}g，热量 ${candKcal - oldKcal >= 0 ? '+' : ''}${round(candKcal - oldKcal, 0)} kcal`;
      } else {
        score = (candProtein - oldProtein) * 0.8 - Math.abs(candKcal - oldKcal) * 0.02;
        reason = `蛋白 ${candProtein - oldProtein >= 0 ? '+' : ''}${round(candProtein - oldProtein, 1)}g/100g，口味更接近`;
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { score, from: item.name, to: candidate.name, reason };
      }
    }
    if (best) swaps.push({ from: best.from, to: best.to, reason: best.reason });
    if (swaps.length >= 2) break;
  }
  return swaps;
}

function buildMealPlans(menuItems, target, profile) {
  const proteins = menuItems.filter((x) => classify(x.name) === 'protein' || classify(x.name) === 'mixed');
  const carbs = menuItems.filter((x) => classify(x.name) === 'carb');
  const vegetables = menuItems.filter((x) => classify(x.name) === 'veg');
  const extras = menuItems.filter((x) => classify(x.name) === 'extra');

  const proteinA = chooseBest(proteins, profile.goal);
  const proteinB = proteins.filter((x) => !proteinA || x.name !== proteinA.name).sort((a, b) => scoreItem(b, profile.goal) - scoreItem(a, profile.goal))[0];
  const carbA = chooseBest(carbs, profile.goal);
  const vegA = vegetables[0];
  const extraA = extras[0];

  const candidates = [];
  const add = (parts, label, tag, reason) => {
    const selected = parts.filter(Boolean).map((part) => {
      if (part && part.item) return { item: part.item, grams: part.grams == null ? part.item.grams : part.grams };
      return { item: part, grams: part.grams };
    });
    if (!selected.length) return;
    const key = selected.map((x) => `${x.item.name}:${Math.round(x.grams)}`).sort().join('|');
    if (candidates.some((x) => x.key === key)) return;
    candidates.push({ key, plan: makeCombination(selected, profile, target, label, tag, reason) });
  };

  if (proteinA) {
    add([proteinA, carbA, vegA], '蛋白优先', '训练后修复', '先保证蛋白，再配主食和蔬菜。');
    add([proteinA, proteinB, carbA, vegA], '双蛋白', '高蛋白日', '目标蛋白较高时，用两道蛋白菜拼够。');
    add([proteinA, carbA, vegA, extraA], '均衡一餐', '最像日常', '蛋白、碳水、蔬菜和加餐都保留。');
    if (carbA) {
      const portion = profile.goal === 'gain' ? 1.25 : 0.65;
      add([
        proteinA,
        { item: carbA, grams: Math.round(carbA.grams * portion) },
        vegA,
      ], profile.goal === 'gain' ? '加量版' : '轻负担', profile.goal === 'gain' ? '训练日加量' : '主食减量', profile.goal === 'gain'
        ? '保留蛋白和蔬菜，把主食加量给训练日。'
        : '蛋白和蔬菜不变，主食减到约 2/3，适合训练量不大的日子。');
    }
  } else if (carbA) {
    add([carbA, vegA], '先吃上', '菜单偏窄', '这份菜单没有明显蛋白菜，先保证能量和蔬菜，建议另加蛋/奶/豆制品。');
  }
  if (!candidates.length) {
    add(menuItems.slice(0, 4), '菜单拼盘', '按现有菜品', '按当前菜单直接组合，注意补充蛋白质。');
  }

  return candidates.slice(0, 3).map(({ plan }) => ({
    ...plan,
    swaps: buildSwaps(plan, menuItems, target, profile.goal),
  }));
}

const SPLITS = {
  2: [['全身 A', '深蹲 / 推 / 拉'], ['全身 B', '髋主导 / 拉 / 核心']],
  3: [['全身 A', '深蹲 / 推 / 拉'], ['全身 B', '髋主导 / 拉 / 核心'], ['全身 C', '单腿 / 上肢综合']],
  4: [['上肢 A', '推为主'], ['下肢 A', '蹲为主'], ['上肢 B', '拉为主'], ['下肢 B', '髋为主']],
  5: [['推', '胸肩三头'], ['拉', '背二头'], ['腿', '蹲/髋'], ['上肢', '推拉综合'], ['下肢', '单腿/核心']],
  6: [['推 A', '胸肩三头'], ['拉 A', '背二头'], ['腿 A', '蹲为主'], ['推 B', '容量'], ['拉 B', '容量'], ['腿 B', '髋/单腿']],
};

function buildTrainingPlan(profile, training) {
  const days = SPLITS[Math.round(profile.daysPerWeek)] || SPLITS[3];
  const weekNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const slots = [0, 2, 4, 1, 3, 5, 6].slice(0, days.length);
  const weekly = weekNames.map((day, index) => {
    const slot = slots.indexOf(index);
    if (slot < 0) return { day, focus: '恢复 / 步行', type: 'rest', duration: 0, intensity: '低' };
    return {
      day,
      focus: days[slot][0],
      detail: days[slot][1],
      type: 'strength',
      duration: profile.experience === 'beginner' ? 45 : 60,
      intensity: profile.goal === 'cut' ? '中' : '中高',
    };
  });
  const todayDone = training.strengthMin + training.cardioMin > 0;
  return {
    weekly,
    today: todayDone
      ? `今天已完成 ${training.strengthMin} 分钟力量 + ${training.cardioMin} 分钟有氧（${training.intensity}强度）。`
      : '今天还没有记录训练。先完成 5–10 分钟动态热身，再开始主训练。',
    principles: [
      '每次力量训练覆盖推、拉、蹲或髋主导中的至少两类动作。',
      profile.experience === 'beginner' ? '新手先用 2–3 组、每组 8–12 次，保留 2–3 次余力。' : '用渐进超负荷：重量或次数每周小幅增加，不追求每次力竭。',
      '训练前动态热身 5–10 分钟，训练后 5 分钟低强度放松。',
      '睡眠 7–9 小时；同一肌群持续明显酸痛时，安排轻量或休息。',
    ],
    cardio: training.cardioMin > 0
      ? `今天有氧 ${training.cardioMin} 分钟，注意训练前后补水；减脂期不要把有氧加到影响力量恢复。`
      : '如果目标是减脂，可在非力量日加 20–30 分钟快走或低强度有氧。',
  };
}

function localNarrative(plan, target, nutrition, profile, preferences) {
  const top = plan.meals[0];
  if (!top) {
    return {
      headline: `${GOAL_LABEL[profile.goal]}日：先补一条可执行的菜单`,
      summary: `今天目标约 ${target.mealTarget.kcal} kcal，蛋白 ${target.mealTarget.protein}g。当前菜单为空或全部被忌口过滤，请先添加主食、蛋白质和蔬菜。`,
      coachNote: plan.training.today,
      mealWhy: '没有可用菜品，无法生成餐盘组合。',
      safety: '营养值为参考估算，不替代医生或注册营养师建议。',
    };
  }
  const flags = [];
  if (top.coverage.protein < 0.8) flags.push('蛋白还差一些，可在同窗口加蛋、奶或豆制品');
  if (top.coverage.carbs < 0.65) flags.push('主食偏少，训练日容易影响恢复');
  if (top.totals.price > (preferences.budget || Infinity)) flags.push('超出预算，优先减加餐而不是减蛋白');
  if (nutrition.meta.estimatedCount) flags.push('有菜品使用估算值，份量变化会影响结果');
  return {
    headline: `${GOAL_LABEL[profile.goal]}日：先把蛋白吃够，再谈热量`,
    summary: `今天目标约 ${target.mealTarget.kcal} kcal，蛋白 ${target.mealTarget.protein}g。首推「${top.label}」：${top.items.map((i) => i.name).join(' + ')}，约 ${top.totals.protein}g 蛋白、${top.totals.kcal} kcal。`,
    coachNote: plan.training.today,
    mealWhy: flags.length ? flags.join('；') : '蛋白、碳水和蔬菜都有覆盖，按建议份量执行即可。',
    safety: '营养值为参考估算，不替代医生或注册营养师建议；有过敏、疾病或进食障碍史请先咨询专业人士。',
  };
}

function buildPlan(input, nutrition) {
  const profile = normalizeProfile(input.profile);
  const training = normalizeTraining(input.training);
  const preferences = normalizePreferences(input.preferences);
  const target = calcTargets(profile, training, preferences);
  const menuItems = nutrition.items.filter((item) => {
    const n = item.name;
    return !preferences.avoid.some((a) => n.includes(a));
  });
  const meals = buildMealPlans(menuItems, target, profile);
  if (preferences.budget != null) {
    meals.forEach((meal) => {
      if (meal.totals.price > preferences.budget + 0.001) meal.flags.push('超预算');
    });
  }
  const plan = {
    date: new Date().toISOString(),
    profile,
    training: {
      ...training,
      exerciseKcal: target.exerciseKcal,
      weekly: buildTrainingPlan(profile, training),
    },
    preferences,
    target,
    meals,
    nutritionMeta: nutrition.meta,
    warnings: [],
  };
  if (nutrition.meta.estimatedCount) plan.warnings.push('有菜品未检索到精确营养数据，已标注“估算值”。');
  if (!menuItems.length) plan.warnings.push('菜单为空或全部被忌口过滤，请先添加菜品。');
  if (meals[0] && meals[0].totals.price > (preferences.budget || Infinity)) plan.warnings.push('推荐组合超出预算。');
  plan.narrative = localNarrative(plan, target, nutrition, profile, preferences);
  return plan;
}

module.exports = {
  buildPlan,
  calcTargets,
  classify,
  normalizeProfile,
  normalizeTraining,
  normalizePreferences,
  buildTrainingPlan,
  localNarrative,
};
