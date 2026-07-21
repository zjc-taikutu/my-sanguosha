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

  it('不能重复选择同一目标并重复扣减剩余数', function() {
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

    assert.deepStrictEqual(Array.from(_g.pending.targets), [1]);
    assert.deepStrictEqual(Array.from(_g.pending.discardedCounts), [1]);
    assert.strictEqual(_g.pending.maxRemaining, 1);
    assert.strictEqual(_g.pending.stage, 'selecting');
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
