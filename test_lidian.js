/**
 * 李典回归测试 - 完整版
 * 直接使用全局变量，不使用require
 */

// ============================================
// Task 1 测试: 武将数据注册 + 忘隙受伤侧
// ============================================

describe('Task 1: 李典武将数据注册', () => {
  it('1-1: GENERALS.lidian 应存在且 caps 含 xunxun 和 wangxi', () => {
    assert.ok(GENERALS.lidian, 'GENERALS.lidian should exist');
    const lidian = GENERALS.lidian;
    assert.strictEqual(lidian.id, 'lidian', 'id should be lidian');
    assert.strictEqual(lidian.name, '李典', 'name should be 李典');
    assert.strictEqual(lidian.gender, 'male', 'gender should be male');
    assert.strictEqual(lidian.maxHp, 3, 'maxHp should be 3');
    assert.ok(lidian.skill && lidian.skill.includes('恂恂'), 'skill should include 恂恂');
    assert.ok(lidian.skill && lidian.skill.includes('忘隙'), 'skill should include 忘隙');
    
    assert.ok(lidian.caps, 'should have caps');
    assert.strictEqual(lidian.caps.xunxun, true, 'caps.xunxun should be true');
    assert.strictEqual(lidian.caps.wangxi, true, 'caps.wangxi should be true');
    
    assert.ok(lidian.hooks, 'should have hooks');
    assert.ok(typeof lidian.hooks.onDamaged === 'function', 'should have onDamaged hook');
  });

  it('1-2: getGeneral lidian', () => {
    const gen = getGeneral('lidian');
    assert.ok(gen, 'getGeneral should return lidian');
    assert.strictEqual(gen.id, 'lidian');
    assert.strictEqual(gen.name, '李典');
  });

  it('1-3: generalHasCap should detect xunxun and wangxi', () => {
    const player = { general: 'lidian' };
    assert.strictEqual(generalHasCap(player, 'xunxun'), true, 'should detect xunxun');
    assert.strictEqual(generalHasCap(player, 'wangxi'), true, 'should detect wangxi');
  });
});

describe('Task 1: 忘隙受伤侧挂钩', () => {
  const mkG = () => ({
    players: [
      { name: 'A', general: 'lidian', hp: 3, maxHp: 3, alive: true, hand: [] },
      { name: 'B', general: 'zhangfei', hp: 4, maxHp: 4, alive: true, hand: [] },
      { name: 'C', general: 'guojia', hp: 3, maxHp: 3, alive: true, hand: [] }
    ],
    deck: [],
    discard: [],
    log: [],
    turn: 0,
    started: true
  });

  it('1-4: 李典非致命受伤应挂起 wangxiAsk pending', () => {
    const g = mkG();
    normalize(g);
    
    const interrupted = dealDamage(g, 0, 1, 1, 'test', 'sha');
    
    assert.ok(g.pending, 'should have pending');
    assert.strictEqual(g.pending.type, 'wangxiAsk', 'pending.type should be wangxiAsk');
    assert.strictEqual(g.pending.seat, 0, 'pending.seat should be 0');
    assert.strictEqual(g.pending.otherSeat, 1, 'pending.otherSeat should be 1');
    assert.strictEqual(g.pending.death, false, 'pending.death should be false');
    assert.strictEqual(g.pending.amount, 1, 'pending.amount should be 1');
    assert.ok(g.pending.resume, 'should have resume');
    assert.strictEqual(g.pending.resume.type, 'sha', 'resume.type should be sha');
  });

  it('1-5: non-Lidian should not trigger wangxi', () => {
    const g = mkG();
    g.players[0].general = 'zhangfei';
    normalize(g);
    
    const interrupted = dealDamage(g, 0, 1, 1, 'test', 'sha');
    
    assert.ok(!g.pending || g.pending.type !== 'wangxiAsk', 'non-Lidian should not trigger wangxiAsk');
  });

  it('1-6: lightning should not trigger wangxi', () => {
    const g = mkG();
    normalize(g);
    
    const interrupted = dealDamage(g, 0, 3, undefined, 'lightning', 'delay');
    
    assert.ok(!g.pending || g.pending.type !== 'wangxiAsk', 'lightning should not trigger wangxiAsk');
  });

  it('1-7: self-damage should not trigger wangxi', () => {
    const g = mkG();
    normalize(g);
    
    const interrupted = dealDamage(g, 0, 1, 0, 'self', 'kurou');
    
    assert.ok(!g.pending || g.pending.type !== 'wangxiAsk', 'self-damage should not trigger wangxiAsk');
  });

  it('1-8: lethal damage should hang dying not wangxiAsk', () => {
    const g = mkG();
    g.players[0].hp = 1;
    normalize(g);
    
    const interrupted = dealDamage(g, 0, 1, 1, 'test', 'sha');
    
    assert.ok(g.pending, 'should have pending');
    assert.strictEqual(g.pending.type, 'dying', 'pending.type should be dying');
  });

  it('1-9: amount=2 should trigger wangxiAsk with amount=2', () => {
    const g = mkG();
    g.players[0].hp = 3;
    normalize(g);
    
    const interrupted = dealDamage(g, 0, 2, 1, 'test', 'sha');
    
    assert.ok(g.pending, 'should have pending');
    assert.strictEqual(g.pending.type, 'wangxiAsk', 'pending.type should be wangxiAsk');
    assert.strictEqual(g.pending.amount, 2, 'pending.amount should be 2');
  });
});

// ============================================
// Task 2 测试: 忘隙造成侧 + dealDamage 接入
// ============================================

describe('Task 2: 忘隙造成侧挂钩', () => {
  const mkG = () => ({
    players: [
      { name: 'A', general: 'lidian', hp: 3, maxHp: 3, alive: true, hand: [] },
      { name: 'B', general: 'zhangfei', hp: 4, maxHp: 4, alive: true, hand: [] },
      { name: 'C', general: 'guojia', hp: 3, maxHp: 3, alive: true, hand: [] }
    ],
    deck: [],
    discard: [],
    log: [],
    turn: 0,
    started: true
  });

  it('2-1: Lidian causing non-lethal damage should hang wangxiAsk', () => {
    const g = mkG();
    normalize(g);
    
    const interrupted = dealDamage(g, 1, 1, 0, 'test', 'sha');
    
    assert.ok(g.pending, 'should have pending');
    assert.strictEqual(g.pending.type, 'wangxiAsk', 'pending.type should be wangxiAsk');
    assert.strictEqual(g.pending.seat, 0, 'pending.seat should be 0 (Lidian as attacker)');
    assert.strictEqual(g.pending.otherSeat, 1, 'pending.otherSeat should be 1 (B)');
    assert.strictEqual(g.pending.death, false, 'pending.death should be false');
    assert.strictEqual(g.pending.amount, 1, 'pending.amount should be 1');
  });

  it('2-2: amount=2 should trigger wangxiAsk with amount=2', () => {
    const g = mkG();
    g.players[1].hp = 4;
    normalize(g);
    
    const interrupted = dealDamage(g, 1, 2, 0, 'test', 'sha');
    
    assert.ok(g.pending, 'should have pending');
    assert.strictEqual(g.pending.type, 'wangxiAsk', 'pending.type should be wangxiAsk');
    assert.strictEqual(g.pending.amount, 2, 'pending.amount should be 2');
  });

  it('2-3: lethal damage should hang dying not wangxiAsk', () => {
    const g = mkG();
    g.players[1].hp = 1;
    normalize(g);
    
    const interrupted = dealDamage(g, 1, 1, 0, 'test', 'sha');
    
    assert.ok(g.pending, 'should have pending');
    assert.strictEqual(g.pending.type, 'dying', 'pending.type should be dying');
  });

  it('2-4: non-Lidian causing damage should not trigger wangxi', () => {
    const g = mkG();
    g.players[0].general = 'zhangfei';
    normalize(g);
    
    const interrupted = dealDamage(g, 1, 1, 0, 'test', 'sha');
    
    assert.ok(!g.pending || g.pending.type !== 'wangxiAsk', 'non-Lidian should not trigger wangxi');
  });
});

// ============================================
// Task 3 测试: 忘隙致死造成侧
// ============================================

describe('Task 3: 忘隙致死造成侧', () => {
  const mkG = () => ({
    players: [
      { name: 'A', general: 'lidian', hp: 3, maxHp: 3, alive: true, hand: [] },
      { name: 'B', general: 'zhangfei', hp: 4, maxHp: 4, alive: true, hand: [] },
      { name: 'C', general: 'guojia', hp: 3, maxHp: 3, alive: true, hand: [] }
    ],
    deck: [],
    discard: [],
    log: [],
    turn: 0,
    started: true
  });

  it('3-1: Lidian killing other should hang wangxiAsk after death resolution', () => {
    const g = mkG();
    g.players[1].hp = 1;
    normalize(g);
    
    const interrupted = dealDamage(g, 1, 1, 0, 'test', 'sha');
    
    assert.ok(g.pending, 'should have pending');
    assert.strictEqual(g.pending.type, 'dying', 'pending.type should be dying');
    assert.ok(g.pending.resume, 'should have resume');
    assert.strictEqual(g.pending.resume.sourceSeat, 0, 'resume.sourceSeat should be 0');
    assert.strictEqual(g.pending.resume.amount, 1, 'resume.amount should be 1');
  });

  it('3-2: Lidian being killed should not trigger wangxi', () => {
    const g = mkG();
    g.players[0].hp = 1;
    normalize(g);
    
    const interrupted = dealDamage(g, 0, 1, 1, 'test', 'sha');
    
    assert.ok(g.pending, 'should have pending');
    assert.strictEqual(g.pending.type, 'dying', 'pending.type should be dying');
    assert.ok(g.pending.resume, 'should have resume');
    assert.strictEqual(g.pending.resume.sourceSeat, 1, 'resume.sourceSeat should be 1');
  });

  it('3-3: non-Lidian killing should not trigger wangxi', () => {
    const g = mkG();
    g.players[0].general = 'zhangfei';
    g.players[1].hp = 1;
    normalize(g);
    
    const interrupted = dealDamage(g, 1, 1, 0, 'test', 'sha');
    
    assert.ok(g.pending, 'should have pending');
    assert.strictEqual(g.pending.type, 'dying', 'pending.type should be dying');
  });
});

// ============================================
// Task 4 测试: respondWangxi 统一结算
// ============================================

describe('Task 4: respondWangxi 统一结算', () => {
  const mkG = () => ({
    players: [
      { name: 'A', general: 'lidian', hp: 3, maxHp: 3, alive: true, hand: [] },
      { name: 'B', general: 'zhangfei', hp: 4, maxHp: 4, alive: true, hand: [] },
      { name: 'C', general: 'guojia', hp: 3, maxHp: 3, alive: true, hand: [] }
    ],
    deck: [
      {id:1, name:'kill', suit:'S', rank:7},
      {id:2, name:'shan', suit:'H', rank:10},
      {id:3, name:'tao', suit:'H', rank:3},
      {id:4, name:'kill', suit:'C', rank:5}
    ],
    discard: [],
    log: [],
    turn: 0,
    started: true
  });

  it('4-1: activate=true time both draw amount cards', () => {
    const g = mkG();
    g.turn = 0;
    normalize(g);
    
    g.pending = { type:'wangxiAsk', seat: 0, otherSeat: 1, death: false, amount: 1, resume:{type:'sha'} };
    g.phase = 'wangxiAsk';
    
    _g = g;
    console.log('Before respondWangxi: hand length =', g.players[0].hand.length, 'deck length =', g.deck.length);
    respondWangxi(g, true);
    console.log('After respondWangxi: hand length =', g.players[0].hand.length, 'deck length =', g.deck.length);
    
    assert.strictEqual(g.players[0].hand.length, 1, 'Lidian should draw 1 card');
    assert.strictEqual(g.players[1].hand.length, 1, 'B should draw 1 card');
    assert.ok(!g.pending, 'pending should be cleared');
    assert.strictEqual(g.phase, 'play', 'should return to play phase');
  });

  it('4-2: death=true time only Lidian draws', () => {
    const g = mkG();
    g.turn = 0;
    g.players[1].alive = false;
    normalize(g);
    
    g.pending = { type:'wangxiAsk', seat: 0, otherSeat: 1, death: true, amount: 1, resume:{type:'sha'} };
    g.phase = 'wangxiAsk';
    
    _g = g;
    respondWangxi(g, true);
    
    assert.strictEqual(g.players[0].hand.length, 1, 'Lidian should draw 1 card');
    assert.strictEqual(g.players[1].hand.length, 0, 'B should not draw (already dead)');
    assert.ok(!g.pending, 'pending should be cleared');
    assert.strictEqual(g.phase, 'play', 'should return to play phase');
  });

  it('4-3: activate=false time resume back', () => {
    const g = mkG();
    g.turn = 0;
    normalize(g);
    
    g.pending = { type:'wangxiAsk', seat: 0, otherSeat: 1, death: false, amount: 1, resume:{type:'sha'} };
    g.phase = 'wangxiAsk';
    
    _g = g;
    respondWangxi(g, false);
    
    assert.ok(!g.pending, 'pending should be cleared');
    assert.strictEqual(g.phase, 'play', 'should resume back to play phase (sha resume defaults to play)');
  });

  it('4-4: amount=2 activate=true time both draw 2 cards', () => {
    const g = mkG();
    g.turn = 0;
    normalize(g);
    
    g.pending = { type:'wangxiAsk', seat: 0, otherSeat: 1, death: false, amount: 2, resume:{type:'sha'} };
    g.phase = 'wangxiAsk';
    
    _g = g;
    respondWangxi(g, true);
    
    assert.strictEqual(g.players[0].hand.length, 2, 'Lidian should draw 2 cards');
    assert.strictEqual(g.players[1].hand.length, 2, 'B should draw 2 cards');
    assert.ok(!g.pending, 'pending should be cleared');
  });
});

// ============================================
// Task 5 测试: 恂恂服务端 + normalize
// ============================================

describe('Task 5: 恂恂服务端', () => {
  const mkG = () => ({
    players: [
      { name: 'A', general: 'lidian', hp: 3, maxHp: 3, alive: true, hand: [] },
      { name: 'B', general: 'zhangfei', hp: 4, maxHp: 4, alive: true, hand: [] },
      { name: 'C', general: 'guojia', hp: 3, maxHp: 3, alive: true, hand: [] }
    ],
    deck: [
      {id:1, name:'kill', suit:'S', rank:7},
      {id:2, name:'shan', suit:'H', rank:10},
      {id:3, name:'tao', suit:'H', rank:3},
      {id:4, name:'kill', suit:'C', rank:5},
      {id:5, name:'duel', suit:'D', rank:2}
    ],
    discard: [],
    log: [],
    turn: 0,
    started: true
  });

  it('5-1: draw phase Lidian xunxun should show up to 4 cards', () => {
    const g = mkG();
    g.turn = 0;
    normalize(g);
    
    continueEnterDrawPhase(g);
    
    assert.ok(g.pending, 'should have pending');
    assert.strictEqual(g.pending.type, 'xunxunPick', 'pending.type should be xunxunPick');
    assert.strictEqual(g.pending.seat, 0, 'pending.seat should be 0');
    assert.strictEqual(g.pending.cards.length, 4, 'should show 4 cards (deck has 5, max 4)');
    assert.strictEqual(g.pending.takeN, 2, 'takeN should be 2');
    assert.strictEqual(g.deck.length, 1, 'deck should have 1 remaining');
  });

  it('5-2: deck less than 4 cards should show all', () => {
    const g = mkG();
    g.turn = 0;
    g.deck = g.deck.slice(0, 3);
    normalize(g);
    
    continueEnterDrawPhase(g);
    
    assert.ok(g.pending, 'should have pending');
    assert.strictEqual(g.pending.type, 'xunxunPick', 'pending.type should be xunxunPick');
    assert.strictEqual(g.pending.cards.length, 3, 'should show 3 cards (deck has only 3)');
    assert.strictEqual(g.pending.takeN, 2, 'takeN should be min(2,3)=2');
    assert.strictEqual(g.deck.length, 0, 'deck should have 0 remaining');
  });

  it('5-3: empty deck cannot trigger xunxun', () => {
    const g = mkG();
    g.turn = 0;
    g.deck = [];
    normalize(g);
    
    continueEnterDrawPhase(g);
    
    assert.ok(!g.pending || g.pending.type !== 'xunxunPick', 'should not have xunxunPick');
    assert.strictEqual(g.phase, 'draw', 'should be in draw phase');
  });

  it('5-4: respondXunxun settlement correct', () => {
    const g = mkG();
    g.turn = 0;
    normalize(g);
    
    const n = Math.min(4, g.deck.length);
    const cards = g.deck.splice(g.deck.length - n, n);
    g.pending = { type:'xunxunPick', seat: 0, cards, takeN: Math.min(2, n) };
    g.phase = 'xunxunPick';
    
    const me = g.players[0];
    const keepIdxs = [0, 1];
    const bottomOrder = [2, 3];
    
    _g = g;
    console.log('Before respondXunxun: hand length =', me.hand.length, 'deck length =', g.deck.length, 'cards.length =', cards.length);
    console.log('pending.seat =', g.pending.seat, 'mySeat =', mySeat, 'phase =', g.phase, 'takeN =', g.pending.takeN);
    console.log('hasCap(me, xunxun) =', hasCap(me, 'xunxun'), 'me.alive =', me.alive);
    
    respondXunxun(keepIdxs, bottomOrder);
    console.log('After respondXunxun: hand length =', me.hand.length, 'deck length =', g.deck.length);
    
    assert.strictEqual(me.hand.length, 2, 'Lidian should get 2 cards');
    assert.strictEqual(g.deck.length, 3, 'deck should have 3 cards (2 bottom + 1 original)');
    assert.strictEqual(g.phase, 'play', 'should enter play phase');
    assert.ok(!g.pending, 'pending should be cleared');
  });

  it('5-5: normalize defense xunxunPick', () => {
    const g = mkG();
    
    g.pending = { type:'xunxunPick', seat: 0, cards: [], takeN: 2 };
    normalize(g);
    
    assert.ok(!g.pending, 'empty cards should be cleared');
    assert.strictEqual(g.phase, 'play', 'phase should fallback to play');
  });
});

console.log('All Li Dian tests loaded');
