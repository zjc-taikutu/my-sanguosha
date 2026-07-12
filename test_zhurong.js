// 祝融武将实装静态检查
// 运行: node test_zhurong.js

const fs = require('fs');

console.log('=== 祝融武将实装静态检查 ===\n');

// 读取文件内容
const dataCode = fs.readFileSync('./data.js', 'utf8');
const gameCode = fs.readFileSync('./game.js', 'utf8');
const skillsCode = fs.readFileSync('./skills.js', 'utf8');
const renderControlsCode = fs.readFileSync('./render-controls.js', 'utf8');
const renderCode = fs.readFileSync('./render.js', 'utf8');

let allPassed = true;

// 测试1: 祝融武将定义
console.log('测试1: 祝融武将定义');
if (dataCode.includes("id:'zhurong'")) {
  console.log('✓ 祝融ID定义正确');
} else {
  console.log('✗ 缺少祝融ID定义');
  allPassed = false;
}

if (dataCode.includes("name:'祝融'")) {
  console.log('✓ 祝融名称定义正确');
} else {
  console.log('✗ 缺少祝融名称定义');
  allPassed = false;
}

if (dataCode.includes("gender:'female'")) {
  console.log('✓ 祝融性别定义正确');
} else {
  console.log('✗ 缺少祝融性别定义');
  allPassed = false;
}

if (dataCode.includes("maxHp:4") && dataCode.includes("id:'zhurong'")) {
  console.log('✓ 祝融体力上限定义正确');
} else {
  console.log('✗ 缺少祝融体力上限定义');
  allPassed = false;
}

if (dataCode.includes("skill:'巨象/烈刃'")) {
  console.log('✓ 祝融技能定义正确');
} else {
  console.log('✗ 缺少祝融技能定义');
  allPassed = false;
}

if (dataCode.includes("juxiang:true") && dataCode.includes("lieRen:true") && dataCode.includes("id:'zhurong'")) {
  console.log('✓ 祝融caps定义正确');
} else {
  console.log('✗ 缺少祝融caps定义');
  allPassed = false;
}

console.log('');

// 测试2: 巨象效果①在aoeAdvance中
console.log('测试2: 巨象效果①在aoeAdvance中');
if (gameCode.includes("generalHasCap(nextPlayer,'juxiang')")) {
  console.log('✓ 巨象检查逻辑存在');
} else {
  console.log('✗ 缺少巨象检查逻辑');
  allPassed = false;
}

if (gameCode.includes("【巨象】发动，南蛮入侵对其无效")) {
  console.log('✓ 巨象效果①日志正确');
} else {
  console.log('✗ 缺少巨象效果①日志');
  allPassed = false;
}

console.log('');

// 测试3: 巨象效果②在aoeAdvance中
console.log('测试3: 巨象效果②在aoeAdvance中');
if (gameCode.includes("zhurongSeats")) {
  console.log('✓ 巨象效果②祝融座位收集逻辑存在');
} else {
  console.log('✗ 缺少巨象效果②祝融座位收集逻辑');
  allPassed = false;
}

if (gameCode.includes("【巨象】发动,获得了【南蛮入侵】")) {
  console.log('✓ 巨象效果②日志正确');
} else {
  console.log('✗ 缺少巨象效果②日志');
  allPassed = false;
}

if (gameCode.includes("isFromZhurong")) {
  console.log('✓ 巨象效果②排除自己使用的南蛮入侵');
} else {
  console.log('✗ 缺少巨象效果②排除自己使用的南蛮入侵');
  allPassed = false;
}

console.log('');

// 测试4: 烈刃触发检查
console.log('测试4: 烈刃触发检查');
if (gameCode.includes("maybeStartLieRen")) {
  console.log('✓ maybeStartLieRen函数存在');
} else {
  console.log('✗ 缺少maybeStartLieRen函数');
  allPassed = false;
}

if (gameCode.includes("hasCap(source,'lieRen')")) {
  console.log('✓ 烈刃能力检查存在');
} else {
  console.log('✗ 缺少烈刃能力检查');
  allPassed = false;
}

if (gameCode.includes("type:'lieRenChoose'")) {
  console.log('✓ 烈刃选择阶段pending正确');
} else {
  console.log('✗ 缺少烈刃选择阶段pending');
  allPassed = false;
}

console.log('');

// 测试5: 烈刃技能函数
console.log('测试5: 烈刃技能函数');
if (skillsCode.includes("function triggerLieRen()")) {
  console.log('✓ triggerLieRen函数存在');
} else {
  console.log('✗ 缺少triggerLieRen函数');
  allPassed = false;
}

if (skillsCode.includes("function pickLieRenCard(cardIndex)")) {
  console.log('✓ pickLieRenCard函数存在');
} else {
  console.log('✗ 缺少pickLieRenCard函数');
  allPassed = false;
}

if (skillsCode.includes("function respondLieRen(cardIndex)")) {
  console.log('✓ respondLieRen函数存在');
} else {
  console.log('✗ 缺少respondLieRen函数');
  allPassed = false;
}

if (skillsCode.includes("function cancelLieRen()")) {
  console.log('✓ cancelLieRen函数存在');
} else {
  console.log('✗ 缺少cancelLieRen函数');
  allPassed = false;
}

console.log('');

// 测试6: 烈刃拼点赢后获得牌
console.log('测试6: 烈刃拼点赢后获得牌');
if (skillsCode.includes("lieRenWin")) {
  console.log('✓ 烈刃拼点结果判断存在');
} else {
  console.log('✗ 缺少烈刃拼点结果判断');
  allPassed = false;
}

if (skillsCode.includes("【烈刃】拼点赢,获得")) {
  console.log('✓ 烈刃赢得拼点日志正确');
} else {
  console.log('✗ 缺少烈刃赢得拼点日志');
  allPassed = false;
}

console.log('');

// 测试7: UI集成
console.log('测试7: UI集成');
if (renderControlsCode.includes("lieRenChoose")) {
  console.log('✓ 烈刃选择阶段UI存在');
} else {
  console.log('✗ 缺少烈刃选择阶段UI');
  allPassed = false;
}

if (renderControlsCode.includes("lieRenPickCard")) {
  console.log('✓ 烈刃选择拼点牌UI存在');
} else {
  console.log('✗ 缺少烈刃选择拼点牌UI');
  allPassed = false;
}

if (renderControlsCode.includes("lieRenRespond")) {
  console.log('✓ 烈刃拼点响应UI存在');
} else {
  console.log('✗ 缺少烈刃拼点响应UI');
  allPassed = false;
}

console.log('');

// 测试8: 状态字段防御
console.log('测试8: 状态字段防御');
if (gameCode.includes("g.pending.type==='lieRenChoose'")) {
  console.log('✓ 烈刃选择阶段状态防御存在');
} else {
  console.log('✗ 缺少烈刃选择阶段状态防御');
  allPassed = false;
}

if (gameCode.includes("g.pending.type==='lieRenPickCard'")) {
  console.log('✓ 烈刃选择拼点牌阶段状态防御存在');
} else {
  console.log('✗ 缺少烈刃选择拼点牌阶段状态防御');
  allPassed = false;
}

if (gameCode.includes("g.pending.type==='lieRenRespond'")) {
  console.log('✓ 烈刃拼点响应阶段状态防御存在');
} else {
  console.log('✗ 缺少烈刃拼点响应阶段状态防御');
  allPassed = false;
}

console.log('');

// 测试9: 音效集成
console.log('测试9: 音效集成');
if (renderCode.includes("'烈刃':'lieRen'")) {
  console.log('✓ 烈刃音效映射存在');
} else {
  console.log('✗ 缺少烈刃音效映射');
  allPassed = false;
}

if (renderCode.includes("'巨象':'juxiang'")) {
  console.log('✓ 巨象音效映射存在');
} else {
  console.log('✗ 缺少巨象音效映射');
  allPassed = false;
}

console.log('');

// 最终结果
if (allPassed) {
  console.log('🎉 祝融武将实装静态检查全部通过！');
  console.log('\n祝融武将功能包括:');
  console.log('  • 巨象：锁定技');
  console.log('    1. 南蛮入侵对祝融无效');
  console.log('    2. 其他角色使用南蛮入侵结算后，祝融获得该锦囊牌');
  console.log('  • 烈刃：使用杀造成伤害后，可以与目标拼点，赢则获得其一张牌');
  process.exit(0);
} else {
  console.log('❌ 祝融武将实装检查发现问题，请修复上述错误');
  process.exit(1);
}
