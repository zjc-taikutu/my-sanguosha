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
  it('眩惑目标阶段真实渲染不抛错',function(){
    mySeat=0;
    _g=fazhengGame();
    _g.players[0].hand=[fazhengCard('闪','♥',3,'ui-heart')];
    startHuanhuo();
    assert.doesNotThrow(function(){ renderControls(_g); });
  });

  it('眩惑四个操作阶段经过Firebase回读后均可真实渲染',function(){
    mySeat=0;
    _g=fazhengGame();
    _g.players[0].hand=[fazhengCard('杀','♠',7,'not-heart'),fazhengCard('桃','♥',9,'ui-peach')];
    _g.players[1].hand=[fazhengCard('闪','♦',8,'target-card')];
    startHuanhuo();
    pickHuanhuoTarget(1);
    _g=JSON.parse(JSON.stringify(_g)); normalize(_g);
    assert.strictEqual(_g.pending.heartCards,undefined);
    assert.doesNotThrow(function(){ renderControls(_g); });

    pickHuanhuoHeartCard(1);
    _g=JSON.parse(JSON.stringify(_g)); normalize(_g);
    assert.strictEqual(_g.phase,'huanhuoPickGotCard');
    assert.doesNotThrow(function(){ renderControls(_g); });

    const oldRandom=Math.random; Math.random=()=>0;
    pickHuanhuoGotCard('hand');
    Math.random=oldRandom;
    _g=JSON.parse(JSON.stringify(_g)); normalize(_g);
    assert.strictEqual(_g.phase,'huanhuoPickSecond');
    assert.doesNotThrow(function(){ renderControls(_g); });
  });

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
    // 模拟 Firebase 完整序列化/回读后再执行下一次点击，不能依赖旧牌对象快照。
    _g=JSON.parse(JSON.stringify(_g));
    normalize(_g);
    assert.strictEqual(_g.pending.type,'huanhuoPickCard');
    pickHuanhuoHeartCard(0);
    assert.strictEqual(_g.phase,'huanhuoPickGotCard');
    const oldRandom=Math.random; Math.random=()=>0;
    pickHuanhuoGotCard('hand');
    Math.random=oldRandom;
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

  it('眩惑按官方规则可指定获得装备，并触发失去装备钩子',function(){
    mySeat=0;
    _g=fazhengGame();
    _g.players[0].hand=[fazhengCard('桃','♥',3,'heart-equip')];
    _g.players[1].general='sunshangxiang';
    _g.players[1].equips.weapon=fazhengCard('青龙偃月刀','♠',5,'taken-equip');
    _g.deck=[fazhengCard('杀','♠',7,'draw-a'),fazhengCard('闪','♦',8,'draw-b')];

    startHuanhuo();
    pickHuanhuoTarget(1);
    pickHuanhuoHeartCard(0);
    pickHuanhuoGotCard('equip','weapon');

    assert.strictEqual(_g.players[1].equips.weapon,null);
    assert.strictEqual(_g.players[1].hand.length,3,'孙尚香失去装备应因枭姬摸两张');
    assert.strictEqual(_g.phase,'huanhuoPickSecond');
    assert.ok(_g.players[0].hand.some(c=>c.id==='taken-equip'));
    pickHuanhuoSecondTarget(2);
    assert.ok(_g.players[2].hand.some(c=>c.id==='taken-equip'));
  });

  it('眩惑拿走凌统装备时，旋风结算后继续转交而不丢失流程',function(){
    mySeat=0;
    _g=fazhengGame();
    _g.players[0].hand=[fazhengCard('桃','♥',3,'heart-lingtong')];
    _g.players[1].general='lingtong';
    _g.players[1].equips.armor=fazhengCard('八卦阵','♣',2,'lingtong-equip');

    startHuanhuo();
    pickHuanhuoTarget(1);
    pickHuanhuoHeartCard(0);
    pickHuanhuoGotCard('equip','armor');
    assert.strictEqual(_g.phase,'xuanfengPick');
    assert.strictEqual(_g.pending.resume.type,'huanhuoTransfer');

    mySeat=1;
    cancelXuanfeng();
    assert.strictEqual(_g.phase,'huanhuoPickSecond');
    assert.strictEqual(_g.pending.sourceSeat,0);
    mySeat=0;
    pickHuanhuoSecondTarget(2);
    assert.ok(_g.players[2].hand.some(c=>c.id==='lingtong-equip'));
  });

  it('眩惑选择红桃阶段经过normalize后仍可取消',function(){
    mySeat=0;
    _g=fazhengGame();
    _g.players[0].hand=[fazhengCard('闪','♥',3,'heart-cancel')];
    startHuanhuo();
    pickHuanhuoTarget(1);
    _g=JSON.parse(JSON.stringify(_g));
    normalize(_g);
    assert.strictEqual(_g.pending.type,'huanhuoPickCard');
    cancelHuanhuo();
    assert.strictEqual(_g.pending,null);
    assert.strictEqual(_g.phase,'play');
  });

  it('眩惑目标选择阶段取消后可再次发动，不残留死界面',function(){
    mySeat=0;
    _g=fazhengGame();
    _g.players[0].hand=[fazhengCard('闪','♥',3,'heart-retry')];
    startHuanhuo();
    cancelHuanhuo();
    _g=JSON.parse(JSON.stringify(_g));
    normalize(_g);
    assert.strictEqual(_g.pending,null);
    assert.strictEqual(_g.phase,'play');
    startHuanhuo();
    assert.strictEqual(_g.pending.type,'huanhuoPick');
    assert.strictEqual(_g.phase,'huanhuoPick');
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

  it('恩怨可交出不在手牌首位的桃',function(){
    mySeat=1;
    _g=fazhengGame();
    const nonHeart=fazhengCard('杀','♣',4,'first-card');
    const peach=fazhengCard('桃','♥',9,'second-peach');
    _g.players[1].hand=[nonHeart,peach];
    _g.pending={type:'enyuanGiveCard',sourceSeat:0,damagerSeat:1,resume:{type:'sha'}};
    _g.phase='enyuanGiveCard';
    _g=JSON.parse(JSON.stringify(_g));
    normalize(_g);
    assert.doesNotThrow(function(){ renderControls(_g); });

    giveEnyuanCard(1);

    assert.strictEqual(_g.pending,null);
    assert.ok(_g.players[0].hand.some(c=>c.id==='second-peach'));
    assert.deepStrictEqual(Array.from(_g.players[1].hand).map(c=>c.id),['first-card']);
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
