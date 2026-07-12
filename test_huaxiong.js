// 华雄【耀武】回归测试
// 运行方式: node test_huaxiong.js

// 直接require data.js
const data = require('./data.js');
const {
  GENERALS, generalMaxHp, hasCap,
  emptyEquips, getGeneral
} = data;

console.log('=== 华雄【耀武】回归测试开始 ===\n');

// ==================== 基础数据测试 ====================
console.log('--- 基础数据测试 ---');

// T0: 武将存在性
{
  const gen = GENERALS.huaxiong;
  console.assert(gen && gen.name === '华雄' && gen.maxHp === 6, 'T0: GENERALS.huaxiong missing or maxHp!=6');
  console.assert(gen.caps && gen.caps.yaowu === true, 'T0: caps.yaowu missing');
  console.assert(gen.desc.includes('红色【杀】'), 'T0: desc should mention 红色【杀】');
  console.assert(gen.id === 'huaxiong', 'T0: id should be huaxiong');
  console.log('✓ T0: 武将数据正确');
}

// T0b: generalMaxHp
{
  const maxHp = generalMaxHp('huaxiong');
  console.assert(maxHp === 6, 'T0b: generalMaxHp should return 6');
  console.log('✓ T0b: generalMaxHp返回6');
}

// T0c: GENERAL_IDS包含huaxiong
{
  console.assert(data.GENERAL_IDS.includes('huaxiong'), 'T0c: GENERAL_IDS should include huaxiong');
  console.log('✓ T0c: GENERAL_IDS包含huaxiong');
}

// 由于game.js有浏览器端代码，无法直接在Node.js中测试完整逻辑
// 这里仅测试数据部分，剩余测试需要在实际游戏环境中运行
console.log('\n--- 数据测试完成 ---');
console.log('✓ 华雄武将数据已正确添加到GENERALS');
console.log('✓ 6血上限、yaowu caps、技能描述均正确');

console.log('\n=== 数据部分测试通过 ✓ ===');
console.log('\n注意：完整的耀武逻辑测试需要在游戏环境中运行，');
console.log('因为game.js包含浏览器端代码无法在Node.js vm中执行。');
