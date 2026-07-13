// 徐庶/曹彰/曹植 数据与静态接入回归
// 运行: node test_three_generals.js
const fs = require('fs');
const data = require('./data.js');
const {
  GENERALS, GENERAL_IDS, getGeneral, generalHasCap, generalMaxHp, BASIC_CARDS
} = data;

let failed = 0;
function assert(cond, msg){
  if(!cond){ console.error('FAIL:', msg); failed++; }
  else console.log('OK:', msg);
}

console.log('=== 三武将数据测试 ===\n');

// 徐庶
{
  const g = GENERALS.xushu;
  assert(!!g, 'xushu exists');
  assert(g.name==='徐庶' && g.maxHp===3 && g.gender==='male', 'xushu basic fields');
  assert(g.caps && g.caps.wuyan && g.caps.jujian, 'xushu caps');
  assert(GENERAL_IDS.includes('xushu'), 'xushu in GENERAL_IDS');
  assert(generalHasCap({general:'xushu'},'wuyan'), 'generalHasCap wuyan');
  assert(generalHasCap({general:'xushu'},'jujian'), 'generalHasCap jujian');
  assert(generalMaxHp('xushu')===3, 'xushu maxHp');
}
// 曹彰
{
  const g = GENERALS.caozhang;
  assert(!!g, 'caozhang exists');
  assert(g.name==='曹彰' && g.maxHp===4, 'caozhang basic');
  assert(g.caps && g.caps.jiangchi, 'caozhang jiangchi');
  assert(GENERAL_IDS.includes('caozhang'), 'caozhang in ids');
  assert(generalHasCap({general:'caozhang'},'jiangchi'), 'has jiangchi');
}
// 曹植
{
  const g = GENERALS.caozhi;
  assert(!!g, 'caozhi exists');
  assert(g.name==='曹植' && g.maxHp===3, 'caozhi basic');
  assert(g.caps && g.caps.luoying && g.caps.jiushi, 'caozhi caps');
  assert(GENERAL_IDS.includes('caozhi'), 'caozhi in ids');
}

// 源码静态检查
const gameSrc = fs.readFileSync('./game.js','utf8');
const skillsSrc = fs.readFileSync('./skills.js','utf8');
const renderSrc = fs.readFileSync('./render.js','utf8');
const controlsSrc = fs.readFileSync('./render-controls.js','utf8');
const indexSrc = fs.readFileSync('./index.html','utf8');

assert(gameSrc.includes("generalHasCap(src, 'wuyan')") || gameSrc.includes('generalHasCap(src, "wuyan")') || gameSrc.includes("generalHasCap(src, 'wuyan')"), 'dealDamage has wuyan check');
assert(gameSrc.includes("isTrickCardName(sourceCard.name)"), 'wuyan uses isTrickCardName');
assert(gameSrc.includes("type: 'jujianPickCard'") || gameSrc.includes("type:'jujianPickCard'"), 'endTurn jujian hook');
assert(gameSrc.includes("type:'jiangchiAsk'"), 'jiangchiAsk in continueEnterDrawPhase');
assert(gameSrc.includes('me.jiangchiNoSlash'), 'jiangchiNoSlash in canPlay path');
assert(gameSrc.includes('jiangchiExtraShaLeft'), 'jiangchiExtraShaLeft');
assert(gameSrc.includes('me.jiangchiNoDistance'), 'jiangchiNoDistance');
assert(gameSrc.includes('maybeStartLuoying'), 'luoying hook');
assert(gameSrc.includes("type: 'jiushiFlipAsk'") || gameSrc.includes("type:'jiushiFlipAsk'"), 'jiushiFlipAsk');

assert(skillsSrc.includes('function respondJujianPickCard'), 'respondJujianPickCard');
assert(skillsSrc.includes('function respondJiangchi'), 'respondJiangchi');
assert(skillsSrc.includes('function maybeStartLuoying'), 'maybeStartLuoying def');
assert(skillsSrc.includes("card.suit==='♣'"), 'luoying uses ♣');
assert(skillsSrc.includes('function respondJiushiFlip'), 'respondJiushiFlip');
assert(skillsSrc.includes("markSkillSound(g, '无言')") || skillsSrc.includes("markSkillSound(g, '举荐')"), 'skill sound chinese');

assert(renderSrc.includes("'无言':'wuyan'"), 'SKILL_PINYIN wuyan');
assert(renderSrc.includes("'将驰':'jiangchi'"), 'SKILL_PINYIN jiangchi');
assert(renderSrc.includes("'落英':'luoying'"), 'SKILL_PINYIN luoying');

assert(controlsSrc.includes("phase==='jujianPickCard'"), 'UI jujian');
assert(controlsSrc.includes("phase==='jiangchiAsk'"), 'UI jiangchi');
assert(controlsSrc.includes("phase==='luoyingAsk'"), 'UI luoying');
assert(controlsSrc.includes("phase==='jiushiFlipAsk'"), 'UI jiushi');

assert(indexSrc.includes('?v=130'), 'cache bust 129');

// 非基本牌口径:装备不是 BASIC_CARDS
assert(!BASIC_CARDS.includes('过河拆桥'), 'trick not basic');
assert(!BASIC_CARDS.includes('诸葛连弩'), 'equip not basic');
assert(BASIC_CARDS.includes('杀'), 'sha is basic');

console.log('\n=== done, failed='+failed+' ===');
process.exit(failed?1:0);
