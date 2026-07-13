/**
 * 李典测试运行器 - 使用共享上下文的vm
 */

const vm = require('vm');
const fs = require('fs');
const assert = require('assert');

// 创建共享上下文
const context = {
  gameRef: {
    transaction: function(fn) {
      return fn({});
    }
  },
  firebase: {
    initializeApp: function() { return { database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function(fn) { var cb = fn(function() {}); if (cb) cb(); return {}; }, set: function() {}, update: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; } }; },
    database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function() { return {}; }, set: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; }
  },
  document: {
    getElementById: function(id) { return { onclick: function() {}, innerHTML: '', style: {}, className: '', classList: { add: function() {}, remove: function() {}, toggle: function() {}, contains: function() { return false; } }, appendChild: function() { return {}; }, remove: function() {}, setAttribute: function() {}, getAttribute: function() { return null; }, addEventListener: function() {}, removeEventListener: function() {} }; },
    createElement: function(tag) { return { src: '', href: '', rel: '', type: '', textContent: '', innerHTML: '', onclick: function() {}, onerror: function() {}, onload: function() {}, className: '', id: '', style: {}, setAttribute: function() {}, getAttribute: function() { return null; }, appendChild: function() { return {}; } }; },
    createTextNode: function(t) { return { nodeValue: t, textContent: t }; },
    createDocumentFragment: function() { return { appendChild: function() { return {}; }, querySelector: function() { return null; }, querySelectorAll: function() { return []; } }; },
    querySelector: function() { return null; }, querySelectorAll: function() { return []; },
    body: { innerHTML: '', appendChild: function() { return {}; }, removeChild: function() { return {}; }, insertBefore: function() { return {}; } },
    head: { appendChild: function() { return {}; } }, forms: [], images: [], scripts: []
  },
  window: {
    firebase: null,
    location: { search: '', href: 'http://localhost', reload: function() {} },
    localStorage: { getItem: function() { return null; }, setItem: function() {}, removeItem: function() {}, clear: function() {} },
    sessionStorage: { getItem: function() { return null; }, setItem: function() {} },
    addEventListener: function() {}, removeEventListener: function() {},
    setTimeout: function(f, t) { return setTimeout(f, t); }, clearTimeout: function(t) { return clearTimeout(t); },
    setInterval: function(f, t) { return setInterval(f, t); }, clearInterval: function(t) { return clearInterval(t); },
    alert: function() {}, confirm: function() { return true; }, prompt: function() { return null; },
    open: function() { return null; }, close: function() {},
    history: { pushState: function() {}, replaceState: function() {} },
    navigator: { userAgent: 'Mozilla/5.0', platform: 'Win32', language: 'zh-CN', onLine: true }
  },
  joinRoom: function() {},
  mySeat: 0,
  pushLog: function(log, text) { log.push({seq: log.length, text: text}); return log; },
  console: console,
  Math: Math,
  Date: Date,
  JSON: JSON,
  RegExp: RegExp,
  assert: assert,
  describe: function(name, fn) {
    console.log('Description:', name);
    fn();
  },
  it: function(name, fn) {
    try {
      fn();
      console.log('  PASS', name);
    } catch (e) {
      console.log('  FAIL', name, '-', e.message);
      throw e;
    }
  }
};

context.window.firebase = context.firebase;
context.window.document = context.document;
context.global = context;

// 创建VM上下文
// 重新设置context中的gameRef，使其在上下文中可用
context.gameRef = {
  transaction: function(fn) {
    return fn(context.g || {});
  }
};

const sandbox = vm.createContext(context, {
  name: 'sgs-sandbox'
});

console.log('Loading Li Dian test environment...\n');

console.log('Loading dependencies...\n');

// 加载所有依赖文件
var files = ['config.js', 'data.js', 'weapons.js', 'room-lifecycle.js', 'game.js', 'skills.js'];
var loaded = 0;

files.forEach(function(file) {
  try {
    var code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, {
      filename: file,
      lineOffset: 0
    });
    loaded++;
    console.log('  OK ' + file);
    
    // After loading game.js, override tx and set mySeat to 0 for tests
    if (file === 'game.js') {
      vm.runInContext('tx = function(fn) { return fn(typeof _g !== "undefined" ? _g : {}); };', sandbox);
      vm.runInContext('gameRef = { transaction: function(fn) { return tx(fn); } };', sandbox);
      vm.runInContext('mySeat = 0;', sandbox);
      console.log('After loading ' + file + ': sandbox.mySeat =', sandbox.mySeat);
    }
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) {
      console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    }
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  Li Dian Tests');
console.log('='.repeat(60) + '\n');

// 加载并运行测试代码
var testCode = fs.readFileSync('test_lidian.js', 'utf8');

// 在上下文中设置_g变量，用于tx函数
vm.runInContext('_g = null;', sandbox);

// 执行测试 - 在同一个上下文中运行
try {
  vm.runInContext(testCode, sandbox, {
    filename: 'test_lidian.js',
    lineOffset: 0
  });
  
  console.log('\n' + '='.repeat(60));
  console.log('  ALL TESTS PASSED!');
  console.log('='.repeat(60) + '\n');
  process.exit(0);
} catch (e) {
  console.log('\nTest failed:');
  console.log('  Error:', e.message);
  if (e.stack) {
    var lines = e.stack.split('\n').slice(0, 20);
    lines.forEach(function(l) { console.log('   ', l.trim()); });
  }
  console.log('\n' + '='.repeat(60));
  console.log('  TESTS FAILED');
  console.log('='.repeat(60) + '\n');
  process.exit(1);
}
