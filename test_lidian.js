function card(name, suit, rank){
  return { id:name+'-'+suit+'-'+rank+'-'+Math.random(), name, suit, rank };
}

function player(name, general){
  return {
    name,
    general,
    hp:3,
    maxHp:3,
    alive:true,
    hand:[],
    equips:{weapon:null, armor:null, atkHorse:null, defHorse:null},
    delays:[]
  };
}

function baseGame(){
  return {
    players:[player('李典','lidian'), player('张飞','zhangfei')],
    deck:[
      card('杀','♠',1),
      card('闪','♥',2),
      card('桃','♦',3),
      card('杀','♣',4),
      card('闪','♠',5)
    ],
    discard:[],
    log:[],
    pending:null,
    phase:'draw',
    turn:0,
    roundNum:1
  };
}

describe('李典【恂恂/忘隙】', function(){
  it('恂恂可以放弃摸牌,获得2张并将其余牌置底', function(){
    mySeat=0;
    _g=baseGame();
    respondXunxunStart();
    assert.strictEqual(_g.phase, 'xunxunPick');
    assert.strictEqual(_g.pending.cards.length, 4);
    respondXunxun([0,3], [1,2]);
    assert.strictEqual(_g.phase, 'play');
    assert.strictEqual(_g.players[0].hand.length, 2);
    assert.strictEqual(_g.deck.length, 3);
    assert.deepStrictEqual(_g.deck.slice(0,2).map(c=>c.rank), [3,4]);
  });

  it('非李典不能发动恂恂', function(){
    mySeat=0;
    _g=baseGame();
    _g.players[0].general='zhangfei';
    respondXunxunStart();
    assert.strictEqual(_g.phase, 'draw');
    assert.strictEqual(_g.pending, null);
  });

  it('忘隙发动后双方各摸指定数量的牌', function(){
    mySeat=0;
    _g=baseGame();
    _g.phase='wangxiAsk';
    _g.pending={type:'wangxiAsk', seat:0, otherSeat:1, death:false, amount:1, resume:{type:'sha'}};
    respondWangxi(true);
    assert.strictEqual(_g.players[0].hand.length, 1);
    assert.strictEqual(_g.players[1].hand.length, 1);
    assert.strictEqual(_g.phase, 'play');
    assert.strictEqual(_g.pending, null);
  });
});
