'use strict';

const { round } = require('../utils/http');

function baseProfile(name) {
  const n = String(name || '');
  const carb = /米饭|饭|面|粉|粥|馒头|包|吐司|玉米|紫薯|红薯|土豆|燕麦|饺|馄饨|米线|河粉/.test(n);
  const protein = /鸡|牛|猪|羊|鱼|虾|蛋|豆腐|豆干|肉|奶|蛋白粉|鸡胸|鸡腿|火腿|肠/.test(n);
  const veg = /菜|瓜|番茄|西红柿|西兰花|菠菜|蘑菇|菇|萝卜|汤|沙拉|海带|木耳/.test(n);

  let profile = { kcal: 150, protein: 8, carbs: 18, fat: 5, label: '普通菜品' };
  if (carb && protein) profile = { kcal: 165, protein: 9, carbs: 21, fat: 5.5, label: '主食 + 蛋白混合' };
  else if (carb) profile = { kcal: 130, protein: 4, carbs: 26, fat: 2, label: '主食类' };
  else if (protein) profile = { kcal: 180, protein: 20, carbs: 3, fat: 9, label: '蛋白类' };
  else if (veg) profile = { kcal: 45, protein: 2, carbs: 6, fat: 1.5, label: '蔬菜/汤类' };

  // 关键词修正：这些是食堂最常见的“隐形油/糖/盐”来源
  if (/炸|酥|锅包|糖醋|干锅/.test(n)) {
    profile.kcal += 70; profile.fat += 6; profile.carbs += 4;
  }
  if (/红烧|卤|酱|烤/.test(n)) {
    profile.kcal += 30; profile.fat += 2.5;
  }
  if (/汤|羹/.test(n)) {
    profile.kcal = 25; profile.protein = 1.5; profile.carbs = 2.5; profile.fat = 1;
  }
  if (/清蒸|水煮|白灼|凉拌/.test(n)) {
    profile.kcal -= 20; profile.fat = Math.max(0.5, profile.fat - 2);
  }
  if (/鸡胸/.test(n)) {
    profile.kcal = 165; profile.protein = 31; profile.carbs = 0; profile.fat = 3.6;
  }
  if (/红烧肉|五花肉/.test(n)) {
    profile.kcal = 350; profile.protein = 14; profile.carbs = 6; profile.fat = 32;
  }
  if (/香锅|干锅|麻辣烫|火锅|烧烤/.test(n)) {
    profile.kcal = 220; profile.protein = 12; profile.carbs = 15; profile.fat = 13;
  }
  if (/奶茶|可乐|汽水|果汁/.test(n)) {
    profile.kcal = 55; profile.protein = 0.5; profile.carbs = 12; profile.fat = 1;
  }
  if (/蛋白粉|乳清/.test(n)) {
    profile.kcal = 380; profile.protein = 75; profile.carbs = 8; profile.fat = 5;
  }

  profile.protein = Math.max(0, profile.protein);
  profile.carbs = Math.max(0, profile.carbs);
  profile.fat = Math.max(0, profile.fat);
  // 用 Atwater 系数回算热量，避免热量和宏量营养素互相打架
  profile.kcal = round(profile.protein * 4 + profile.carbs * 4 + profile.fat * 9);
  return profile;
}

function estimateFood(name) {
  const profile = baseProfile(name);
  return {
    per100g: {
      kcal: profile.kcal,
      protein: profile.protein,
      carbs: profile.carbs,
      fat: profile.fat,
    },
    basis: profile.label,
    note: '未检索到精确数据，按菜名关键词与同类菜品常识估算；份量变化会影响结果。',
  };
}

module.exports = { estimateFood, baseProfile };
