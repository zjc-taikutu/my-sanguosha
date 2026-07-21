describe('凌统【旋风】修复', function() {
  function player(name, general) {
    return {
      name: name, general: general, alive: true, hp: 4, maxHp: 4,
      hand: [], equips: { weapon: null, armor: null, plus1: null, minus1: null },
      delays: [], caps: {}, huashenPool: [], huashenGeneral: null, huashenSkillName: null
    };
  }

  it('Firebase省略空数组后仍保留刚触发的旋风选择状态', function() {
    const lingtong = player('凌统', 'lingtong');
    const target = player('目标', 'liubei');
    const g = {
      players: [lingtong, target], turn: 0, phase: 'xuanfengPick',
      pending: {
        type: 'xuanfengPick', from: 0, trigger: 'equip', maxRemaining: 2,
        stage: 'selecting', previousPhase: 'play'
      },
      deck: [], discard: [], log: []
    };

    normalize(g);

    assert.strictEqual(g.pending.type, 'xuanfengPick');
    assert.deepStrictEqual(Array.from(g.pending.targets), []);
    assert.deepStrictEqual(Array.from(g.pending.discardedCounts), []);
    assert.strictEqual(g.phase, 'xuanfengPick');
  });

  it('选择1张后可以主动完成并真实弃牌', function() {
    mySeat = 0;
    const lingtong = player('凌统', 'lingtong');
    const target = player('目标', 'liubei');
    target.hand = [{ id: 'h1', name: '杀' }, { id: 'h2', name: '闪' }];
    _g = {
      players: [lingtong, target], turn: 0, phase: 'xuanfengPick',
      pending: { type: 'xuanfengPick', from: 0, trigger: 'equip', targets: [1], discardedCounts: [1], maxRemaining: 1, stage: 'selecting', previousPhase: 'play' },
      deck: [], discard: [], log: []
    };

    finishXuanfengSelection();

    assert.strictEqual(target.hand.length, 1);
    assert.strictEqual(_g.discard.length, 1);
    assert.strictEqual(_g.pending, null);
    assert.strictEqual(_g.phase, 'play');
  });

  it('选中目标后进入逐张选牌阶段', function() {
    mySeat = 0;
    const lingtong = player('凌统', 'lingtong');
    const target = player('目标', 'liubei');
    target.hand = [{ id: 'h1', name: '杀' }, { id: 'h2', name: '闪' }];
    _g = {
      players: [lingtong, target], turn: 0, phase: 'xuanfengPick',
      pending: { type: 'xuanfengPick', from: 0, trigger: 'equip', targets: [1], discardedCounts: [1], maxRemaining: 1, stage: 'selecting', previousPhase: 'play' },
      deck: [], discard: [], log: []
    };

    pickXuanfengTarget(1);

    assert.strictEqual(_g.pending.currentTargetSeat, 1);
    assert.strictEqual(_g.pending.maxRemaining, 1);
    assert.strictEqual(_g.pending.stage, 'chooseCard');
  });

  it('可以指定弃置目标的装备而不是随机手牌', function() {
    mySeat = 0;
    const lingtong = player('凌统', 'lingtong');
    const target = player('目标', 'liubei');
    target.hand = [{ id: 'h1', name: '杀' }];
    target.equips.armor = { id: 'e1', name: '八卦阵' };
    _g = {
      players: [lingtong, target], turn: 0, phase: 'xuanfengPick',
      pending: { type: 'xuanfengPick', from: 0, trigger: 'equip', targets: [], discardedCounts: [], selections: [], maxRemaining: 2, stage: 'chooseCard', currentTargetSeat: 1, previousPhase: 'play' },
      deck: [], discard: [], log: []
    };

    pickXuanfengCard('equip', 'armor');
    finishXuanfengSelection();

    assert.strictEqual(target.equips.armor, null);
    assert.strictEqual(target.hand.length, 1);
    assert.strictEqual(_g.discard[0].name, '八卦阵');
    assert.strictEqual(_g.pending, null);
  });

  it('骁果令凌统失去装备后保留旋风pending并记录续接', function() {
    mySeat = 1;
    const yuejin = player('乐进', 'yuejin');
    const lingtong = player('凌统', 'lingtong');
    lingtong.equips.armor = { id: 'e1', name: '八卦阵' };
    _g = {
      players: [yuejin, lingtong], turn: 1, phase: 'xiaoguoChoice',
      pending: { type: 'xiaoguoChoice', from: 0, endingSeat: 1, to: 1 },
      deck: [{ id: 'd1', name: '杀' }], discard: [], log: []
    };

    respondXiaoguoChoice('armor');

    assert.strictEqual(lingtong.equips.armor, null);
    assert.strictEqual(yuejin.hand.length, 1);
    assert.strictEqual(_g.pending.type, 'xuanfengPick');
    assert.strictEqual(_g.pending.from, 1);
    assert.strictEqual(_g.pending.resume.type, 'xiaoguo');
    assert.strictEqual(_g.pending.resume.endingSeat, 1);
    assert.strictEqual(_g.pending.resume.lastAsker, 0);
  });
});
