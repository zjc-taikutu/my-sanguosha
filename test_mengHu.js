/**
 * 孟获实装静态检查
 * 运行: node test_mengHu.js
 */

const fs = require('fs');
const assert = require('assert');

console.log('=== 孟获实装静态检查 ===\n');

// 读取文件内容
const dataCode = fs.readFileSync('./data.js', 'utf8');
const gameCode = fs.readFileSync('./game.js', 'utf8');
const skillsCode = fs.readFileSync('./skills.js', 'utf8');
const renderControlsCode = fs.readFileSync('./render-controls.js', 'utf8');

let allPassed = true;

// 测试1: 孟获武将定义
console.log('测试1: 孟获武将定义');
try {
  assert.ok(dataCode.includes("id:'mengHu'"), '应包含 mengHu ID');
  assert.ok(dataCode.includes("name:'孟获'"), '应包含孟获名称');
  assert.ok(dataCode.includes("maxHp:4"), '体力应为4');
  assert.ok(dataCode.includes("skill:'祸首/再起'"), '技能应为祸首/再起');
  assert.ok(dataCode.includes("huoshou:true"), '应包含 huoshou cap');
  assert.ok(dataCode.includes("zaiqi:true"), '应包含 zaiqi cap');
  console.log('✓ 孟获武将定义正确\n');
} catch(e) {
  console.log('✗ 失败:', e.message, '\n');
  allPassed = false;
}

// 测试2: 祸首在 aoeAdvance 中
console.log('测试2: 祸首在 aoeAdvance 中');
try {
  assert.ok(gameCode.includes("g.aoe.trick==='南蛮入侵'"), '应检查南蛮入侵');
  assert.ok(gameCode.includes("generalHasCap(nextPlayer,'huoshou')"), '应检查 huoshou 能力');
  assert.ok(gameCode.includes("【祸首】发动，南蛮入侵对其无效"), '应包含祸首日志');
  console.log('✓ 祸首在 aoeAdvance 中正确实现\n');
} catch(e) {
  console.log('✗ 失败:', e.message, '\n');
  allPassed = false;
}

// 测试3: 祸首伤害来源重定向
console.log('测试3: 祸首伤害来源重定向');
try {
  assert.ok(gameCode.includes("actualSourceSeat = g.pending.from"), '应初始化 actualSourceSeat');
  assert.ok(gameCode.includes("g.aoe.trick==='南蛮入侵'"), '应检查南蛮入侵');
  assert.ok(gameCode.includes("generalHasCap(p, 'huoshou')"), '应检查 huoshou 能力');
  assert.ok(gameCode.includes("【祸首】发动，成为南蛮入侵的伤害来源"), '应包含伤害来源日志');
  console.log('✓ 祸首伤害来源重定向正确实现\n');
} catch(e) {
  console.log('✗ 失败:', e.message, '\n');
  allPassed = false;
}

// 测试4: 再起函数实现
console.log('测试4: 再起函数实现');
try {
  assert.ok(skillsCode.includes('function respondZaiqi'), '应包含 respondZaiqi 函数');
  assert.ok(skillsCode.includes("g.phase !== 'draw'"), '应检查摸牌阶段');
  assert.ok(skillsCode.includes("me.hp >= me.maxHp"), '应检查是否已受伤');
  assert.ok(skillsCode.includes('hasCap(me, \'zaiqi\')'), '应检查 zaiqi 能力');
  assert.ok(skillsCode.includes('revealPool(g, lostHp)'), '应调用 revealPool');
  assert.ok(skillsCode.includes("cardSuitForPlayer(me, card) === '♥'"), '应检查红桃');
  assert.ok(skillsCode.includes('g.discard.push(...cards)'), '应将牌置入弃牌堆');
  assert.ok(skillsCode.includes("g.phase = 'play'"), '应进入出牌阶段');
  console.log('✓ 再起函数正确实现\n');
} catch(e) {
  console.log('✗ 失败:', e.message, '\n');
  allPassed = false;
}

// 测试5: UI 集成
console.log('测试5: UI 集成');
try {
  assert.ok(renderControlsCode.includes('hasCap(me,\'zaiqi\')'), '应检查 zaiqi 能力');
  assert.ok(renderControlsCode.includes('me.hp < me.maxHp'), '应检查是否已受伤');
  assert.ok(renderControlsCode.includes('发动【再起】'), '应包含再起按钮');
  assert.ok(renderControlsCode.includes('respondZaiqi()'), '应调用 respondZaiqi');
  console.log('✓ UI 集成正确\n');
} catch(e) {
  console.log('✗ 失败:', e.message, '\n');
  allPassed = false;
}

// 最终结果
if (allPassed) {
  console.log('===================');
  console.log('✅ 所有静态检查通过！');
  console.log('===================');
  console.log('\n孟获武将实装已完成：');
  console.log('  • 武将定义: data.js');
  console.log('  • 祸首技能: game.js (aoeAdvance + aoeRespond)');
  console.log('  • 再起技能: skills.js (respondZaiqi)');
  console.log('  • UI集成: render-controls.js');
  console.log('\n下一步：');
  console.log('  1. 在浏览器中打开 index.html 手动测试');
  console.log('  2. 测试南蛮入侵对孟获无效');
  console.log('  3. 测试孟获作为南蛮入侵伤害来源');
  console.log('  4. 测试再起技能的完整流程');
} else {
  console.log('===================');
  console.log('❌ 部分检查失败');
  console.log('===================');
}
