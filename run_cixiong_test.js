/**
 * 雌雄双股剑回归
 */
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const ROOT = __dirname;
let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', e.message); failed++; }
}

const context = {
  gameRef: { transaction(fn){ return fn(context._g || {}); } },
  firebase: {
    initializeApp(){ return { database(){ return { ref(){ return {
      on(){}, once(){}, push(){ return { set(){}, key:'k' }; },
      transaction(){ return {}; }, set(){}, update(){}, child(){ return this; }, remove(){},
      get(){ return { val(){ return null; } }; }
    }; } }; } }; },
    database(){ return this.initializeApp().database(); }
  },
  document: {
    getElementById(){ return {
      onclick:null, innerHTML:'', style:{}, className:'', textContent:'',
      classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } },
      appendChild(){ return {}; }, remove(){}, setAttribute(){}, getAttribute(){ return null; },
      addEventListener(){}, removeEventListener(){}, querySelector(){ return null; },
      querySelectorAll(){ return []; }
    }; },
    createElement(){ return {
      style:{}, className:'', textContent:'', innerHTML:'', onclick:null, disabled:false,
      setAttribute(){}, appendChild(){ return {}; },
      classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } }
    }; },
    createTextNode(t){ return { textContent:t }; },
    createDocumentFragment(){ return { appendChild(){} }; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    body:{ appendChild(){} }, head:{ appendChild(){} }, addEventListener(){}
  },
  window: {
    location:{ search:'', href:'http://localhost' },
    localStorage:{ getItem(){ return null; }, setItem(){} },
    addEventListener(){}, setTimeout, clearTimeout, alert(){}, confirm(){ return true; },
    navigator:{ userAgent:'test' }, matchMedia(){ return { matches:false, addEventListener(){} }; }
  },
  console, Math, Date, JSON, RegExp, Array, Object, String, Number, Boolean,
  parseInt, isNaN, setTimeout, clearTimeout
};
context.window.document = context.document;
context.window.firebase = context.firebase;
context.global = context;
const sandbox = vm.createContext(context);

['config.js','data.js','room-lifecycle.js','game.js','weapons.js','skills.js'].forEach(f=>{
  vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), sandbox, { filename:f });
  if(f==='game.js'){
    vm.runInContext(`
      tx = function(fn){ if(typeof _g==='undefined'||!_g) return; return fn(_g); };
      gameRef = { transaction: function(fn){ return tx(fn); } };
      mySeat = 0;
      var _g = null;
    `, sandbox);
  }
  console.log('  OK', f);
});

function R(code){ return vm.runInContext(code, sandbox); }
function bindG(g){ sandbox.__tg = g; vm.runInContext('_g = __tg;', sandbox); }
function G(){ return vm.runInContext('_g', sandbox); }

function emptyEq(){ return R('emptyEquips')(); }
function mkPlayer(name, genId, extra){
  const gen = R('getGeneral')(genId);
  return Object.assign({
    name, general: genId, gender: gen&&gen.gender,
    hp: gen?gen.maxHp:4, maxHp: gen?gen.maxHp:4,
    hand: [], equips: emptyEq(), delays: [], alive: true, dying: false
  }, extra||{});
}

console.log('\n== 雌雄双股剑 ==\n');

check('EQUIPS 与 buildDeck 含雌雄', ()=>{
  const e = R('getEquip')('雌雄双股剑');
  assert.ok(e);
  assert.strictEqual(e.range, 2);
  assert.strictEqual(e.cap, 'cixiong');
  const deck = R('buildDeck')();
  const n = deck.filter(c=>c.name==='雌雄双股剑').length;
  assert.strictEqual(n, 1);
  assert.ok(deck.some(c=>c.name==='雌雄双股剑' && c.suit==='♠' && c.rank===2));
});

check('isOppositeGender', ()=>{
  const m = mkPlayer('男','zhangfei');
  const f = mkPlayer('女','daqiao');
  assert.strictEqual(R('isOppositeGender')(m,f), true);
  assert.strictEqual(R('isOppositeGender')(m,m), false);
});

check('异性杀触发 cixiongAsk', ()=>{
  const male = mkPlayer('张飞','zhangfei');
  male.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  male.hand = [{id:2,name:'杀',suit:'♥',rank:7}];
  const female = mkPlayer('大乔','daqiao');
  female.hand = [{id:3,name:'闪',suit:'♦',rank:2}];
  const g = {
    phase:'play', turn:0, started:true, players:[male,female],
    deck: Array.from({length:20},(_,i)=>({id:100+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[],
    shaUsed:false, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('playCard')(0, '杀', 1);
  const gg = G();
  assert.strictEqual(gg.phase, 'cixiongAsk', 'phase='+gg.phase);
  assert.strictEqual(gg.pending.type, 'cixiongAsk');
  assert.strictEqual(gg.pending.from, 0);
  assert.strictEqual(gg.pending.to, 1);
});

check('同性不触发', ()=>{
  const m1 = mkPlayer('张飞','zhangfei');
  m1.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  m1.hand = [{id:2,name:'杀',suit:'♥',rank:7}];
  const m2 = mkPlayer('关羽','guanyu');
  m2.hand = [{id:3,name:'闪',suit:'♦',rank:2}];
  const g = {
    phase:'play', turn:0, started:true, players:[m1,m2],
    deck: Array.from({length:20},(_,i)=>({id:100+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('playCard')(0, '杀', 1);
  const gg = G();
  assert.notStrictEqual(gg.phase, 'cixiongAsk');
  assert.ok(gg.phase==='respond' || gg.phase==='play' || gg.pending);
});

check('发动后目标弃牌再进 respond', ()=>{
  const male = mkPlayer('张飞','zhangfei');
  male.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  const female = mkPlayer('大乔','daqiao');
  female.hand = [{id:3,name:'杀',suit:'♠',rank:5},{id:4,name:'桃',suit:'♥',rank:3}];
  const g = {
    phase:'cixiongAsk', turn:0, started:true,
    players:[male,female],
    deck: Array.from({length:20},(_,i)=>({id:100+i,name:'闪',suit:'♦',rank:2})),
    discard:[], log:[], exchangeCards:[],
    pending:{ type:'cixiongAsk', from:0, to:1, noShan:false, shaColor:'red' },
    shaUsed:true, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('respondCixiongAsk')(true);
  let gg = G();
  assert.strictEqual(gg.phase, 'cixiongChoice');
  vm.runInContext('mySeat=1;', sandbox);
  R('respondCixiongChoice')('discard', 0);
  gg = G();
  assert.strictEqual(female.hand.length, 1);
  assert.ok(gg.discard.some(c=>c.name==='杀'));
  assert.strictEqual(gg.phase, 'respond');
});

check('发动后目标令摸牌', ()=>{
  const male = mkPlayer('张飞','zhangfei');
  male.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  male.hand = [];
  const female = mkPlayer('大乔','daqiao');
  female.hand = [{id:3,name:'杀',suit:'♠',rank:5}];
  const g = {
    phase:'cixiongAsk', turn:0, started:true,
    players:[male,female],
    deck: Array.from({length:5},(_,i)=>({id:100+i,name:'闪',suit:'♦',rank:2})),
    discard:[], log:[], exchangeCards:[],
    pending:{ type:'cixiongAsk', from:0, to:1, noShan:false, shaColor:'red' },
    shaUsed:true, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('respondCixiongAsk')(true);
  vm.runInContext('mySeat=1;', sandbox);
  R('respondCixiongChoice')('draw');
  const gg = G();
  assert.strictEqual(male.hand.length, 1);
  assert.strictEqual(gg.phase, 'respond');
});

check('目标无手牌发动直接摸', ()=>{
  const male = mkPlayer('张飞','zhangfei');
  male.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  male.hand = [];
  const female = mkPlayer('大乔','daqiao');
  female.hand = [];
  const g = {
    phase:'cixiongAsk', turn:0, started:true,
    players:[male,female],
    deck: Array.from({length:5},(_,i)=>({id:100+i,name:'闪',suit:'♦',rank:2})),
    discard:[], log:[], exchangeCards:[],
    pending:{ type:'cixiongAsk', from:0, to:1, noShan:false, shaColor:'black' },
    shaUsed:true, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('respondCixiongAsk')(true);
  const gg = G();
  assert.strictEqual(male.hand.length, 1);
  // 黑杀无仁王应进 respond
  assert.strictEqual(gg.phase, 'respond');
});

check('不发动直接继续', ()=>{
  const male = mkPlayer('张飞','zhangfei');
  const female = mkPlayer('大乔','daqiao');
  female.hand = [{id:3,name:'闪',suit:'♦',rank:2}];
  const g = {
    phase:'cixiongAsk', turn:0, started:true,
    players:[male,female],
    deck:[], discard:[], log:[], exchangeCards:[],
    pending:{ type:'cixiongAsk', from:0, to:1, noShan:false, shaColor:'red' },
    shaUsed:true, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('respondCixiongAsk')(false);
  assert.strictEqual(G().phase, 'respond');
});

check('黑杀+仁王:雌雄后仍可无效', ()=>{
  const male = mkPlayer('张飞','zhangfei');
  male.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  const female = mkPlayer('大乔','daqiao');
  female.equips.armor = {id:9,name:'仁王盾',suit:'♣',rank:2};
  female.hand = [];
  const g = {
    phase:'cixiongAsk', turn:0, started:true,
    players:[male,female],
    deck: Array.from({length:5},(_,i)=>({id:100+i,name:'闪',suit:'♦',rank:2})),
    discard:[], log:[], exchangeCards:[],
    pending:{ type:'cixiongAsk', from:0, to:1, noShan:false, shaColor:'black' },
    shaUsed:true, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('respondCixiongAsk')(true); // 无手牌 → 摸后 continueAfter → 仁王无效
  const gg = G();
  assert.ok(male.hand.length>=1, '先摸了牌');
  // 仁王无效后 finishSingleShaTarget → phase play
  assert.strictEqual(gg.phase, 'play');
  const logText = (gg.log||[]).map(e=>e.text||e).join('|');
  assert.ok(logText.includes('仁王盾') || logText.includes('无效'), logText);
});

check('hasCap cixiong', ()=>{
  const p = mkPlayer('张飞','zhangfei');
  p.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  assert.strictEqual(R('hasCap')(p,'cixiong'), true);
  p.equips.weapon = null;
  assert.strictEqual(R('hasCap')(p,'cixiong'), false);
});

console.log('\npassed:', passed, 'failed:', failed);
process.exit(failed?1:0);
