/**
 * 身份模式(主公局)回归 — 随实现逐步扩展断言。
 * 规格: docs/superpowers/specs/2026-07-19-identity-mode-design.md
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
      transaction(fn){ const r=fn(function(){}); if(typeof r==='function') r(); return {}; },
      set(){}, update(){}, child(){ return this; }, remove(){}, get(){ return { val(){ return null; } }; }
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
      src:'', style:{}, className:'', id:'', textContent:'', innerHTML:'',
      onclick:null, disabled:false, setAttribute(){}, getAttribute(){ return null; },
      appendChild(){ return {}; }, classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } }
    }; },
    createTextNode(t){ return { textContent:t }; },
    createDocumentFragment(){ return { appendChild(){ return {}; } }; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    body:{ appendChild(){}, removeChild(){} }, head:{ appendChild(){} },
    addEventListener(){}
  },
  window: {
    location:{ search:'', href:'http://localhost' },
    localStorage:{ getItem(){ return null; }, setItem(){}, removeItem(){} },
    addEventListener(){}, removeEventListener(){},
    setTimeout, clearTimeout, alert(){}, confirm(){ return true; },
    navigator:{ userAgent:'test' }, matchMedia(){ return { matches:false, addListener(){}, addEventListener(){} }; }
  },
  console, Math, Date, JSON, RegExp, Array, Object, String, Number, Boolean,
  parseInt, parseFloat, isNaN, Infinity, NaN, undefined,
  setTimeout, clearTimeout, setInterval, clearInterval
};
context.window.document = context.document;
context.window.firebase = context.firebase;
context.global = context;

const sandbox = vm.createContext(context);
const files = ['config.js','data.js','room-lifecycle.js','game.js','weapons.js','skills.js'];
console.log('Loading...\n');
files.forEach(f=>{
  const code = fs.readFileSync(path.join(ROOT,f),'utf8');
  vm.runInContext(code, sandbox, { filename:f });
  if(f==='game.js'){
    // 真实 tx:对共享 _g 做 transaction
    vm.runInContext(`
      var _g = null;
      tx = function(fn){
        if(!_g) return;
        const r = fn(_g);
        return r === undefined ? _g : r;
      };
      gameRef = { transaction: function(fn){ return tx(fn); } };
      mySeat = 0;
    `, sandbox);
  }
  console.log('  OK', f);
});

// 暴露测试用 setter
vm.runInContext(`
  function __setG(g){ _g = g; }
  function __getG(){ return _g; }
  function __setSeat(s){ mySeat = s; }
`, sandbox);

const EXPECT = {
  4: {zhu:1, zhong:1, fan:1, nei:1},
  5: {zhu:1, zhong:1, fan:2, nei:1},
  6: {zhu:1, zhong:1, fan:3, nei:1},
  7: {zhu:1, zhong:2, fan:3, nei:1},
  8: {zhu:1, zhong:2, fan:4, nei:1},
};

function countRoles(arr){
  const c = {zhu:0,zhong:0,fan:0,nei:0};
  arr.forEach(r=>{ if(c[r]!=null) c[r]++; });
  return c;
}

console.log('\n== Task1: IDENTITY_TABLE / assignIdentities / canSeeRole ==\n');

// vm 里 const 不挂到 sandbox 对象属性上,用 runInContext 取值
function R(code){ return vm.runInContext(code, sandbox); }

check('IDENTITY_TABLE 存在且覆盖 4~8', ()=>{
  const T = R('IDENTITY_TABLE');
  assert.ok(T);
  for(let n=4;n<=8;n++) assert.ok(Array.isArray(T[n]), '缺 '+n);
});

check('配比数量正确', ()=>{
  const T = R('IDENTITY_TABLE');
  for(let n=4;n<=8;n++){
    const c = countRoles(T[n]);
    assert.deepStrictEqual(c, EXPECT[n], 'n='+n+' got '+JSON.stringify(c));
    assert.strictEqual(T[n].length, n);
  }
});

check('ROLE_LABEL 四身份', ()=>{
  const L = R('ROLE_LABEL');
  assert.strictEqual(L.zhu, '主公');
  assert.strictEqual(L.zhong, '忠臣');
  assert.strictEqual(L.fan, '反贼');
  assert.strictEqual(L.nei, '内奸');
});

check('assignIdentities 4 人:1 主公 revealed,其余未翻', ()=>{
  const players = [1,2,3,4].map(i=>({name:'P'+i}));
  R('assignIdentities')(players);
  const lords = players.filter(p=>p.role==='zhu');
  assert.strictEqual(lords.length, 1);
  assert.strictEqual(lords[0].roleRevealed, true);
  players.filter(p=>p.role!=='zhu').forEach(p=>{
    assert.strictEqual(p.roleRevealed, false);
    assert.ok(['zhong','fan','nei'].includes(p.role));
  });
  assert.deepStrictEqual(countRoles(players.map(p=>p.role)), EXPECT[4]);
});

check('assignIdentities 3 人 no-op', ()=>{
  const players = [{name:'a'},{name:'b'},{name:'c'}];
  R('assignIdentities')(players);
  assert.strictEqual(players[0].role, undefined);
});

check('getLordSeat', ()=>{
  const g = { players:[{role:'fan'},{role:'zhu',roleRevealed:true},{role:'nei'}] };
  assert.strictEqual(R('getLordSeat')(g), 1);
  assert.strictEqual(R('getLordSeat')({players:[]}), -1);
});

check('canSeeRole 规则', ()=>{
  const g = {
    gameMode:'identity',
    players:[
      {role:'zhu', roleRevealed:true},
      {role:'zhong', roleRevealed:false},
      {role:'fan', roleRevealed:false},
      {role:'nei', roleRevealed:true},
    ]
  };
  const canSeeRole = R('canSeeRole');
  assert.strictEqual(canSeeRole(g, 1, 0), true);
  assert.strictEqual(canSeeRole(g, 2, 0), true);
  assert.strictEqual(canSeeRole(g, 1, 1), true);
  assert.strictEqual(canSeeRole(g, 0, 1), false);
  assert.strictEqual(canSeeRole(g, 0, 2), false);
  assert.strictEqual(canSeeRole(g, 0, 3), true);
  assert.strictEqual(canSeeRole({gameMode:'ffa', players:g.players}, 0, 0), false);
  assert.strictEqual(canSeeRole({gameMode:null, players:g.players}, 0, 0), false);
});

// ========== 后续 Task 追加的用例挂这里 ==========

console.log('\n== summary ==');
console.log('passed:', passed, 'failed:', failed);
process.exit(failed ? 1 : 0);
