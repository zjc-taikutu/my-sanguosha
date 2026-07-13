// Jul 12 后新增路径回归:不屈/散谣/强袭/骁果 pending 清理/攻击距离口径
// 运行: node test_jul12_regressions.js
const fs = require('fs');

let failed = 0;
function assert(cond, msg){
  if(!cond){ console.error('FAIL:', msg); failed++; }
  else console.log('OK:', msg);
}

const gameSrc = fs.readFileSync('./game.js','utf8');
const skillsSrc = fs.readFileSync('./skills.js','utf8');
const indexSrc = fs.readFileSync('./index.html','utf8');

// 1) respondBuqu: startDying 后不可 g.pending=null
{
  const m = gameSrc.match(/function respondBuqu[\s\S]*?\nfunction /);
  assert(!!m, 'respondBuqu exists');
  const body = m[0];
  assert(body.includes('startDying('), 'respondBuqu calls startDying');
  assert(!/startDying\([^)]*\);\s*\n\s*g\.pending\s*=\s*null/.test(body),
    'respondBuqu does NOT null pending after startDying');
  assert(body.includes('resumeAfterInterrupt'), 'respondBuqu uses resumeAfterInterrupt on prevent-death');
  assert(body.includes("hasCap(p, 'buqu')") || body.includes('hasCap(p,"buqu")'),
    'respondBuqu uses hasCap not hardcode zhoutai only for ability');
}

// 2) 散谣/强袭: dealDamage 打断后不无条件清 pending
{
  const sanyao = skillsSrc.match(/function respondSanyao[\s\S]*?\nfunction /);
  assert(!!sanyao, 'respondSanyao exists');
  assert(sanyao[0].includes('if(interrupted) return g'), 'respondSanyao respects dealDamage interrupt');
  assert(sanyao[0].includes('const interrupted = dealDamage'), 'respondSanyao captures dealDamage return');

  const qiangxi = skillsSrc.match(/function pickQiangxiTarget[\s\S]*?\nfunction /);
  assert(!!qiangxi, 'pickQiangxiTarget exists');
  assert(qiangxi[0].includes('if(interrupted) return g'), 'pickQiangxiTarget respects dealDamage interrupt');
}

// 3) 乱武: 完整 resolveShaUse + luanwuResume 接回
{
  const useSha = skillsSrc.match(/function useShaForLuanwu[\s\S]*?\nfunction /);
  assert(!!useSha, 'useShaForLuanwu exists');
  assert(useSha[0].includes('resolveShaUse('), 'useShaForLuanwu uses resolveShaUse');
  assert(useSha[0].includes('luanwuResume'), 'useShaForLuanwu stores luanwuResume');
  assert(gameSrc.includes("resume.type==='luanwu'") || gameSrc.includes('continueLuanwuAfterSha'),
    'resumeAfterInterrupt / finishSha handles luanwu');
}

// 4) 骁果结束清空 pending
{
  const adv = gameSrc.match(/function advanceXiaoguo[\s\S]*?\nfunction /);
  assert(!!adv, 'advanceXiaoguo exists');
  assert(/asker===null\)\{\s*g\.pending\s*=\s*null/.test(adv[0]) ||
         /asker===null\)\{ g\.pending=null/.test(adv[0]),
    'advanceXiaoguo nulls pending when no more askers');
}

// 5) enterDrawPhase 入口清 pending
{
  const edp = gameSrc.match(/function enterDrawPhase\(g\)\{[\s\S]{0,200}/);
  assert(!!edp, 'enterDrawPhase exists');
  assert(/g\.pending\s*=\s*null/.test(edp[0]), 'enterDrawPhase nulls pending at entry');
}

// 6) getAttackRange 委托 attackRange
{
  const gar = skillsSrc.match(/function getAttackRange[\s\S]*?\nfunction /);
  assert(!!gar, 'getAttackRange exists');
  assert(gar[0].includes('return attackRange(g, seat)'), 'getAttackRange delegates to attackRange');
  assert(!/range\s*\+=\s*1/.test(gar[0]), 'getAttackRange no longer adds horse as attack range');
}

// 7) pickTianyiTarget 不误要求 phase===play only
{
  const ptt = skillsSrc.match(/function pickTianyiTarget[\s\S]*?\nfunction /);
  assert(!!ptt, 'pickTianyiTarget exists');
  assert(ptt[0].includes('tianyiPickTarget'), 'pickTianyiTarget accepts tianyiPickTarget pending');
  assert(!/if\s*\(\s*g\.phase\s*!==\s*'play'\s*\|\|\s*g\.turn\s*!==\s*mySeat\s*\)\s*return g;/.test(ptt[0]),
    'pickTianyiTarget no longer hard-requires phase play only');
}

// 8) normalize 防御新增 pending 类型
assert(gameSrc.includes("type==='buquAsk'"), 'normalize defends buquAsk');
assert(gameSrc.includes("type==='lianyingAsk'"), 'normalize defends lianyingAsk');
assert(gameSrc.includes("type==='tianyiPickCard'"), 'normalize defends tianyiPickCard');

// 9) cache bust
assert(indexSrc.includes('?v=130') || indexSrc.includes('?v=129'), 'cache bust present');

// 10) 连营队列:不立刻写 pending,tx 收尾 flush
{
  const ly = gameSrc.match(/function maybeStartLianying[\s\S]*?\nfunction tryFlushLianying/);
  assert(!!ly, 'maybeStartLianying + tryFlushLianying exist');
  assert(ly[0].includes('lianyingQueue'), 'maybeStartLianying uses queue');
  assert(!/g\.pending\s*=\s*\{\s*type:\s*'lianyingAsk'/.test(ly[0]),
    'maybeStartLianying does not set pending immediately');
  assert(gameSrc.includes('function tryFlushLianying'), 'tryFlushLianying defined');
  assert(gameSrc.includes('tryFlushLianying(result)'), 'tx calls tryFlushLianying');
  assert(gameSrc.includes("if(!Array.isArray(g.lianyingQueue))"), 'normalize defends lianyingQueue');
}

// 11) 乱武走完整 resolveShaUse + luanwuResume
{
  const useSha = skillsSrc.match(/function useShaForLuanwu[\s\S]*?\nfunction /);
  assert(!!useSha, 'useShaForLuanwu exists');
  assert(useSha[0].includes('resolveShaUse('), 'useShaForLuanwu calls resolveShaUse');
  assert(useSha[0].includes('luanwuResume'), 'useShaForLuanwu sets luanwuResume');
  assert(useSha[0].includes('skipShaLimit') || useSha[0].includes('noDistance'),
    'useShaForLuanwu passes shaInfo flags');
  assert(gameSrc.includes('function continueLuanwuAfterSha'), 'continueLuanwuAfterSha exists');
  assert(gameSrc.includes('g.luanwuResume'), 'finishSingleShaTarget path uses luanwuResume');
  assert(!/dealDamage\(g,\s*targetSeat,\s*1,\s*sourceSeat,\s*`\$\{source\.name\} 的【乱武】效果`/.test(useSha[0]),
    'useShaForLuanwu no longer direct dealDamage for 乱武杀');
}

// 12) 不屈 removeBuquCard 不硬编码武将 id
{
  const m = gameSrc.match(/function removeBuquCard[\s\S]*?\nfunction /);
  assert(!!m, 'removeBuquCard exists');
  assert(m[0].includes("hasCap(p, 'buqu')") || m[0].includes('hasCap(p,"buqu")'),
    'removeBuquCard uses hasCap');
  assert(!/general\s*!==\s*['"]zhoutai['"]/.test(m[0]), 'removeBuquCard no hardcode zhoutai');
}

// 13) 乱武无全局 luanwuTargetMap
assert(!/let\s+luanwuTargetMap/.test(skillsSrc), 'no global luanwuTargetMap');
assert(!/luanwuTargetMap\[/.test(skillsSrc+fs.readFileSync('./render-controls.js','utf8')),
  'no luanwuTargetMap indexing');
assert(skillsSrc.includes('pending.targetMap') || skillsSrc.includes('g.pending.targetMap'),
  'luanwu uses pending.targetMap');

// 14) 神速1 在判定前: continueShensu1Check 在 continueQiaobianCheck 之后、continueDelayResolution 之前
{
  assert(skillsSrc.includes('function continueShensu1Check'), 'continueShensu1Check exists');
  assert(skillsSrc.includes('continueShensu1Check(g, seat)'), 'qiaobian path calls shensu1 check');
  const edp = gameSrc.match(/function enterDrawPhase\(g\)\{[\s\S]{0,800}/);
  assert(!!edp, 'enterDrawPhase snippet');
  assert(!/type:\s*['"]shensuChoose1['"]/.test(edp[0]),
    'enterDrawPhase no longer opens shensuChoose1');
  assert(skillsSrc.includes("type: 'shensuChoose1'") || skillsSrc.includes('type: "shensuChoose1"') ||
         skillsSrc.includes("type:'shensuChoose1'"),
    'shensuChoose1 opened in continueShensu1Check path');
  // skipShensu1 接回判定链路
  const skip = skillsSrc.match(/function skipShensu1[\s\S]*?\nfunction /);
  assert(!!skip && skip[0].includes('continueDelayResolution'), 'skipShensu1 continues to delay resolution');
  assert(!/phase\s*=\s*['"]judge['"]/.test(skip[0]), 'skipShensu1 no fake phase=judge');
}

console.log('\n=== done, failed='+failed+' ===');
process.exit(failed?1:0);
