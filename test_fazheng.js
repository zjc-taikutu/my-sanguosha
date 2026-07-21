function fazhengCard(name,suit,rank,id){
  return {id:id||name+'-'+suit+'-'+rank,name,suit,rank};
}

function fazhengPlayer(name,general){
  return {
    name,general,hp:3,maxHp:3,alive:true,hand:[],
    equips:{weapon:null,armor:null,plus1:null,minus1:null},delays:[]
  };
}

function fazhengGame(){
  return {
    players:[fazhengPlayer('法正','fazheng'),fazhengPlayer('甲','xiahoudun'),fazhengPlayer('乙','zhangfei')],
    deck:[fazhengCard('杀','♠',7,'deck-1')],discard:[],log:[],pending:null,
    phase:'play',turn:0,started:true,huanhuoUsed:false
  };
}

describe('法正【恩怨/眩惑】',function(){
  it('眩惑可以完成交红桃、获得牌并转交另一名角色的完整流程',function(){
    mySeat=0;
    _g=fazhengGame();
    const heart=fazhengCard('闪','♥',3,'heart');
    const taken=fazhengCard('杀','♠',9,'taken');
    _g.players[0].hand=[heart];
    _g.players[1].hand=[taken];

    startHuanhuo();
    assert.strictEqual(_g.phase,'huanhuoPick');
    assert.deepStrictEqual(Array.from(_g.pending.candidates),[1,2]);
    pickHuanhuoTarget(1);
    assert.strictEqual(_g.phase,'huanhuoPickCard');
    pickHuanhuoHeartCard(0);
    assert.strictEqual(_g.phase,'huanhuoPickGotCard');
    pickHuanhuoGotCard(0);
    assert.strictEqual(_g.phase,'huanhuoPickSecond');
    assert.strictEqual(_g.pending.firstTargetSeat,1);
    assert.deepStrictEqual(Array.from(_g.pending.candidates),[2]);
    pickHuanhuoSecondTarget(2);

    assert.strictEqual(_g.pending,null);
    assert.strictEqual(_g.phase,'play');
    assert.strictEqual(_g.huanhuoUsed,true);
    assert.ok(_g.players[1].hand.some(c=>c.id==='heart'));
    assert.ok(_g.players[2].hand.some(c=>c.id==='taken'));
    assert.ok(!_g.players[0].hand.some(c=>c.id==='taken'));
  });

  it('恩怨失去体力不是伤害，不会触发伤害类技能',function(){
    mySeat=1;
    _g=fazhengGame();
    _g.turn=2;
    _g.players[1].hp=2;
    _g.pending={type:'enyuanChooseOption',sourceSeat:0,damagerSeat:1,heartCards:[],resume:{type:'fanjian'}};
    _g.phase='enyuanChooseOption';

    chooseEnyuanOption('loseHp');

    assert.strictEqual(_g.players[1].hp,1);
    assert.strictEqual(_g.pending,null);
    assert.strictEqual(_g.phase,'play');
    assert.ok(!_g.log.some(x=>String(x.text||x).includes('刚烈')));
  });

  it('非伤害来源不能替别人操作恩怨',function(){
    mySeat=2;
    _g=fazhengGame();
    _g.pending={type:'enyuanChoose',sourceSeat:0,damagerSeat:1,resume:{type:'sha'}};
    _g.phase='enyuanChoose';
    triggerEnyuan();
    assert.strictEqual(_g.pending.type,'enyuanChoose');
  });

  it('其他角色用青囊令法正回血时，施术者因恩怨摸一张牌',function(){
    mySeat=1;
    _g=fazhengGame();
    _g.turn=1;
    _g.players[1].general='huatuo';
    _g.players[0].hp=2;
    _g.players[1].hand=[fazhengCard('杀','♣',4,'cost')];
    _g.deck=[fazhengCard('闪','♦',8,'reward')];

    qingNang(0,0);

    assert.strictEqual(_g.players[0].hp,3);
    assert.strictEqual(_g.players[1].hand.length,1);
    assert.strictEqual(_g.players[1].hand[0].id,'reward');
  });
});
