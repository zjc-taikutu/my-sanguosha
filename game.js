// ---------- local state ----------
let roomId = null, mySeat = null;
let gameRef = null;
// 本地稳定标识:用来区分"我自己刷新重连"和"另一个人重名"。持久化到 localStorage,刷新后不变。
let myClientId = (function(){
  try{
    let c = localStorage.getItem('sgsClientId');
    if(!c){ c = 'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); localStorage.setItem('sgsClientId', c); }
    return c;
  }catch(e){ return 'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
})();

// ---------- join ----------
document.getElementById('joinBtn').onclick = joinRoom;
function joinRoom(){
  const errEl = document.getElementById('lobbyErr');
  errEl.textContent = '';
  if (NOT_CONFIGURED){ errEl.textContent = '请先在文件里填入 Firebase 配置再部署。'; return; }
  const room = document.getElementById('roomInput').value.trim();
  const name = document.getElementById('nameInput').value.trim();
  if(!room){ errEl.textContent='请填房间号'; return; }
  // bug1:房间号被拼进 Firebase 路径,key 不允许 . # $ [ ] / 等字符,只放行字母/数字/-/_
  if(!/^[A-Za-z0-9_-]+$/.test(room)){ errEl.textContent='房间号只能用字母、数字、- 和 _'; return; }
  if(!name){ errEl.textContent='请填名字'; return; }
  roomId = room;
  gameRef = db.ref('rooms/'+roomId+'/game');

  let joinError = null; // 在事务里设置,事务外提示

  gameRef.transaction(g => {
    joinError = null;
    if(g === null){
      g = { started:false, players:[], turn:0, phase:'lobby', deck:[], discard:[],
            pending:null, shaUsed:false, log:['房间已创建,等待玩家加入'] };
    }
    g.players = g.players || [];
    // bug2:先按本地标识找"我自己"(刷新重连),能回到原座位
    const mine = g.players.findIndex(p=>p && p.cid===myClientId);
    if(mine>=0){ mySeat = mine; return g; }
    // 名字被房间里"别人"(不同 cid)占用 -> 拒绝,不复用座位
    const nameTaken = g.players.some(p=>p && p.name===name && p.cid!==myClientId);
    if(nameTaken){ joinError='这个名字已被占用,请换一个'; return g; }
    if(g.started){ return g; } // 这局已开始,且不是原座位的人 -> 事务外提示
    if(g.players.length >= SEATS) return g; // full
    mySeat = g.players.length;
    g.players.push({ name, cid:myClientId, hp:MAX_HP, maxHp:MAX_HP, hand:[], alive:true });
    g.log = pushLog(g.log, name+' 加入了房间（座位'+(mySeat+1)+'）');
    return g;
  }, (err, committed, snap)=>{
    if(err){ errEl.textContent='连接出错: '+err.message; return; }
    if(joinError){ errEl.textContent=joinError; return; }
    const g = snap.val();
    if(mySeat===null && (g.players||[]).length>=SEATS && !g.started){
      errEl.textContent='房间已满（已有3人）。'; return;
    }
    if(mySeat===null && g.started){
      errEl.textContent='这局已经开始了,换个房间号或等下一局。'; return;
    }
    enterGame();
  });
}

function enterGame(){
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('configWarn').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  gameRef.on('value', snap => render(snap.val()));
}

// ---------- helpers ----------
// Firebase drops empty arrays/objects -> they come back undefined. Restore defaults.
function normalize(g){
  if(!g) return g;
  g.deck = g.deck || [];
  g.discard = g.discard || [];
  g.log = g.log || [];
  g.players = g.players || [];
  g.players.forEach(p=>{ if(p){ p.hand = p.hand || []; if(typeof p.alive!=='boolean') p.alive=true;
    // 体力上限防御:旧数据/异常路径缺失时回退,避免血条/桃回血读到 undefined
    if(typeof p.maxHp!=='number') p.maxHp = MAX_HP;
    // 装备区防御:Firebase 吞 null 值/空对象,读回来容器会缺失或缺键;补容器 + 补齐四槽(缺的回退 null)
    p.equips = Object.assign(emptyEquips(), p.equips || {});
    // 濒死标记:纯 UI 提示用的布尔标量,和 alive 同款防御
    if(typeof p.dying!=='boolean') p.dying=false;
    // 判定区(延时锦囊):和 p.hand 同款防御,Firebase 吞空数组
    p.delays = p.delays || [];
  } });
  // 无懈询问阶段:asking 是当前响应者座位号(数字);防御非法值
  if(g.pending && g.pending.type==='wuxie' && typeof g.pending.asking!=='number') g.pending.asking=-1;
  // 无懈反制:exclude(当前轮不问谁的座位号)/depth(成功次数)都应是数字;缺失多半是旧数据,回退到"层0"
  if(g.pending && g.pending.type==='wuxie'){
    if(typeof g.pending.exclude!=='number') g.pending.exclude=g.pending.from;
    if(typeof g.pending.depth!=='number') g.pending.depth=0;
  }
  // 濒死询问阶段:seat/asking 都应是数字座位号,resume.type 应是字符串;任一不对就整体判无效,防止卡死
  if(g.pending && g.pending.type==='dying'){
    const d=g.pending;
    if(typeof d.seat!=='number' || typeof d.asking!=='number' || !d.resume || typeof d.resume.type!=='string'){
      g.pending=null; g.phase='play';
    }
  }
  // 鬼才改判阶段:seat/asking 都应是数字座位号,judgeCard 应有 suit/rank,resume.kind 应是字符串;任一不对就整体判无效
  if(g.pending && g.pending.type==='guicai'){
    const d=g.pending;
    if(typeof d.seat!=='number' || typeof d.asking!=='number' || !d.judgeCard || !d.judgeCard.suit || !d.resume || typeof d.resume.kind!=='string'){
      g.pending=null; g.phase='play';
    }
  }
  // 铁骑判定阶段:from/to 都应是数字座位号;不对就整体判无效
  if(g.pending && g.pending.type==='tieqi' && (typeof g.pending.from!=='number' || typeof g.pending.to!=='number')){
    g.pending=null; g.phase='play';
  }
  // 烈弓阶段:from/to 都应是数字座位号;不对就整体判无效
  if(g.pending && g.pending.type==='liegong' && (typeof g.pending.from!=='number' || typeof g.pending.to!=='number')){
    g.pending=null; g.phase='play';
  }
  // 骁果询问阶段:endingSeat/asking 都应是数字座位号;不对就整体判无效
  if(g.pending && g.pending.type==='xiaoguo' && (typeof g.pending.endingSeat!=='number' || typeof g.pending.asking!=='number')){
    g.pending=null; g.phase='play';
  }
  // 骁果二选一阶段:from/endingSeat/to 都应是数字座位号;不对就整体判无效
  if(g.pending && g.pending.type==='xiaoguoChoice' && (typeof g.pending.from!=='number' || typeof g.pending.endingSeat!=='number' || typeof g.pending.to!=='number')){
    g.pending=null; g.phase='play';
  }
  // 借刀杀人选择阶段:from/seatA/seatB 都应是数字座位号;不对就整体判无效
  if(g.pending && g.pending.type==='jiedaoChoice' && (typeof g.pending.from!=='number' || typeof g.pending.seatA!=='number' || typeof g.pending.seatB!=='number')){
    g.pending=null; g.phase='play';
  }
  // 五谷丰登挑选阶段:pool/order 是数组(Firebase 吞空数组),from/idx 应是数字;不对就整体判无效
  if(g.pending && g.pending.type==='wugu'){
    g.pending.pool = g.pending.pool || [];
    g.pending.order = g.pending.order || [];
    if(typeof g.pending.from!=='number' || typeof g.pending.idx!=='number' || g.pending.order.length===0){
      g.pending=null; g.phase='play';
    }
  }
  // 洛神判定阶段:seat 应是数字座位号;不对就整体判无效
  if(g.pending && g.pending.type==='luoshen' && typeof g.pending.seat!=='number'){
    g.pending=null; g.phase='play';
  }
  // 群体锦囊上下文:字段不全则视为无效(全是标量,无空数组问题)
  if(g.aoe && (typeof g.aoe.from!=='number' || !g.aoe.trick || !g.aoe.need)) g.aoe=null;
  // 乐不思蜀:跳过出牌阶段的标志位,和 p.dying 同款防御
  if(typeof g.skipPlay!=='boolean') g.skipPlay=false;
  // 兵粮寸断:跳过摸牌阶段的标志位,和 g.skipPlay 同款防御
  if(typeof g.skipDraw!=='boolean') g.skipDraw=false;
  // 徐晃【断粮】:出牌阶段限一次的标志位,和 g.shaUsed 同款防御
  if(typeof g.duanliangUsed!=='boolean') g.duanliangUsed=false;
  // 张郃【巧变】:出牌阶段限一次的标志位,和 g.duanliangUsed 同款防御
  if(typeof g.qiaobianUsed!=='boolean') g.qiaobianUsed=false;
  return g;
}
function pushLog(log, msg){
  log = (log||[]).slice(-40); log.push(msg); return log;
}
function nextAlive(g, from){
  const n=g.players.length; // 按实际玩家数取模,支持 2 或 3 人
  for(let k=1;k<=n;k++){
    const s=(from+k)%n;
    if(g.players[s] && g.players[s].alive) return s;
  }
  return from;
}
function aliveCount(g){ return g.players.filter(p=>p&&p.alive).length; }
// 牌堆空则把弃牌堆洗回牌堆;返回牌堆此刻是否有牌(true/false)。摸牌与判定共用同一重洗口径。
function ensureDeck(g){
  if(g.deck.length===0){
    if(g.discard.length===0) return false;
    g.deck = g.discard; g.discard = [];
    for(let a=g.deck.length-1;a>0;a--){const b=Math.floor(Math.random()*(a+1));[g.deck[a],g.deck[b]]=[g.deck[b],g.deck[a]];}
  }
  return true;
}
function drawN(g, seat, n){
  for(let i=0;i<n;i++){
    if(!ensureDeck(g)) break;
    g.players[seat].hand.push(g.deck.pop());
  }
}
// 通用判定:翻牌堆顶一张(堆空则先重洗弃牌堆),亮出后进弃牌堆,返回这张牌(供调用方看花色/颜色)。
// 通用无副作用——不含任何具体技能逻辑,闪电/乐不思蜀等日后复用。堆+弃都空则返回 null,调用方容错。
function judge(g){
  if(!ensureDeck(g)) return null;
  const card = g.deck.pop();
  g.discard.push(card);
  g.log=pushLog(g.log, '判定牌:'+card.suit+rankText(card.rank));
  return card;
}
// revealPool: 批量亮出牌堆顶 n 张牌,只放进一个数组返回(不进弃牌堆、不记判定日志)——
// 和 judge() 语义不同:judge 是"翻一张+立刻进弃牌堆+判定日志",这里是"批量暂存到公共池,
// 之后可能被人挑走进手牌、也可能被无懈/挑完剩余弃入弃牌堆",五谷丰登专用。
// 牌堆(含重洗弃牌堆)不够 n 张时,能亮多少算多少(不报错、不阻断)。
function revealPool(g, n){
  const pool=[];
  for(let i=0;i<n;i++){
    if(!ensureDeck(g)) break;
    pool.push(g.deck.pop());
  }
  return pool;
}
// 八卦阵:被要求出【闪】时先判定,红=视为打出一张【闪】(免这次伤害),黑=判定失败(仍走正常出闪/受伤)。
// 只在「需要出闪」的响应点调用。能力来源=装备(cap:'bagua'),走 hasCap 不硬编码牌名。
// 返回三态:true=判定成功(红)、false=判定失败(黑/无牌)、'pending'=挂起等待【鬼才】改判决定
// (调用方收到 'pending' 应立即 return,收尾延后到 finishGuicai 处理,和 dealDamage 的濒死挂起同一套路)。
// resumeInfo 由调用方传入,记录"改判解决后该接回哪条被打断的流程"(见 finishGuicai)。
function tryBagua(g, seat, resumeInfo){
  const p=g.players[seat];
  if(!p || !p.alive || !hasCap(p,'bagua')) return false;
  g.log=pushLog(g.log, p.name+' 发动【八卦阵】');
  const card=judge(g);
  if(!card) return false; // 无牌可判,视为未发动
  if(maybeGuicai(g, seat, card, Object.assign({kind:'bagua'}, resumeInfo))==='pending') return 'pending';
  return finishBaguaColor(g, card);
}
// finishBaguaColor: 八卦阵判定的红黑结算(独立出来,供 tryBagua 直接判 和 finishGuicai 改判后判 共用)。
function finishBaguaColor(g, card){
  if(isRed(card)){ g.log=pushLog(g.log, '判定为红,视为打出【闪】'); return true; }
  g.log=pushLog(g.log, '判定为黑,【八卦阵】未生效'); return false;
}
// ===== 鬼才:判定牌亮出后,判定者自己(优先)或攻击范围内的其他鬼才拥有者可打出一张手牌替换 =====
// 四个判定场景(八卦阵 tryBagua、闪电/乐不思蜀/兵粮寸断的 processOneDelayCard)都调用 maybeGuicai,
// 不各自实现一遍"谁可以发起"的枚举。
// nextGuicaiAsker: 从 current 的下家起,按座位顺序找下一个"有资格发起鬼才"的候选人——
// 存活 + hasCap(p,'guicai') + 手牌非空 + 攻击范围够到 judgedSeat(candidateSeat→judgedSeat
// 距离<=candidateSeat攻击范围,用 canReachSha)。绕回 judgedSeat 即问完一圈,返回 null。
function nextGuicaiAsker(g, judgedSeat, current){
  const n=g.players.length;
  for(let k=1;k<=n;k++){
    const s=(current+k)%n;
    if(s===judgedSeat) return null;
    const p=g.players[s];
    if(p && p.alive && hasCap(p,'guicai') && (p.hand||[]).length>0 && canReachSha(g, s, judgedSeat)) return s;
  }
  return null;
}
// firstGuicaiAsker: 判定者自己优先(若有资格);否则按座位顺序找第一个有资格的其他人。
function firstGuicaiAsker(g, judgedSeat){
  const p=g.players[judgedSeat];
  if(p && hasCap(p,'guicai') && (p.hand||[]).length>0) return judgedSeat;
  return nextGuicaiAsker(g, judgedSeat, judgedSeat);
}
// maybeGuicai: 判定牌亮出后统一入口。若存在有资格的候选人,挂起询问,返回 'pending'
// (调用方应立即 return,原有处理延后到 finishGuicai 按 resume.kind 接回);没人有资格
// 则不挂起,返回 undefined,调用方照常用原判定牌结算。
// resume 记录"改判解决后用哪条逻辑消费最终判定牌"——resume.kind:'bagua'(走 finishBaguaColor,
// resume.type 是 sha/aoe,和原本一致)或 'delayJudge'(走 DELAY_TRICKS[trickName].effect)。
function maybeGuicai(g, judgedSeat, card, resume){
  const asker=firstGuicaiAsker(g, judgedSeat);
  if(asker===null) return;
  g.pending={type:'guicai', seat:judgedSeat, asking:asker, judgeCard:card, resume};
  g.phase='guicai';
  g.log=pushLog(g.log, g.players[judgedSeat].name+' 判定得到 '+card.suit+rankText(card.rank)+',询问 '+g.players[asker].name+' 是否发动【鬼才】替换判定牌…');
  return 'pending';
}
// respondGuicai: 仅当前被问的人(pending.asking)可响应。替换:打出一张手牌(移出手牌/进弃牌堆),
// 用它的花色/内容结算,调 finishGuicai;不替换:推进到下一个候选人(nextGuicaiAsker),
// 问完一圈(绕回判定者自己)才用原判定牌结算——和无懈可击"不出→问下一个"同一套结构。
function respondGuicai(useReplace, cardIdx){
  tx(g=>{
    if(g.phase!=='guicai'||!g.pending||g.pending.type!=='guicai') return g;
    if(g.pending.asking!==mySeat) return g;
    const me=g.players[mySeat];
    if(useReplace){
      const card=(me.hand||[])[cardIdx];
      if(!card) return g; // 没这张牌:状态不变(双重保险)
      me.hand.splice(cardIdx,1);
      g.discard.push(card);
      g.log=pushLog(g.log, me.name+' 发动【鬼才】,打出'+card.suit+rankText(card.rank)+' 替换判定牌');
      finishGuicai(g, card);
      return g;
    }
    g.log=pushLog(g.log, me.name+'：不发动【鬼才】');
    const nxt=nextGuicaiAsker(g, g.pending.seat, mySeat);
    if(nxt===null){ finishGuicai(g, g.pending.judgeCard); return g; }
    g.pending.asking=nxt;
    g.log=pushLog(g.log, '询问 '+g.players[nxt].name+' 是否发动【鬼才】替换判定牌…');
    return g;
  });
}
// finishGuicai: 鬼才改判解决(不管替换与否)。按 resume.kind 分派——
// 'bagua':和原来一样走 finishBaguaColor + resume.type(sha/aoe)接回被打断的流程;
// 'delayJudge':用最终判定牌重新调用该延时锦囊的 effect,处理去向后继续该玩家判定区剩余的牌。
function finishGuicai(g, finalCard){
  const resume=g.pending.resume;
  g.pending=null;
  if(resume.kind==='delayJudge'){
    const result=finishDelayCard(g, resume.seat, DELAY_TRICKS[resume.trickName], finalCard, resume.card);
    if(result==='pending'){
      // 又挂起了(嵌套濒死或嵌套鬼才)。和 continueDelayResolution 的收尾同一套逻辑,不能省略:
      // 若新挂起是濒死,它的 resume 只有 {type:'delay'}(dealDamage/startDying 不知道 seat是谁,
      // 这个信息只有这里——鬼才改判后重新触发的 finishDelayCard——才知道),这里必须补上 seat,
      // 否则 finishDying 读 resume.seat 是 undefined,g.players[undefined] 直接抛异常(真实 bug:
      // 鬼才替换了延时锦囊的判定牌、替换后结果致命时才会走到这条分支,此前测试没覆盖到这个组合)。
      // 若新挂起是鬼才(嵌套鬼才改判),它的 resume 已经自带完整信息,绝不能覆盖。
      if(g.pending.type==='dying') g.pending.resume={type:'delay', seat:resume.seat};
      return;
    }
    continueDelayResolution(g, resume.seat);
    return;
  }
  if(resume.kind==='tieqiJudge'){
    finishTieqiJudge(g, resume.from, resume.to, finalCard);
    return;
  }
  if(resume.kind==='luoshenJudge'){
    finishLuoshenJudge(g, resume.seat, finalCard);
    return;
  }
  // kind==='bagua'
  const red = finishBaguaColor(g, finalCard);
  if(resume.type==='sha'){
    if(red){ g.phase='play'; }
    else { g.pending={from:resume.from, to:resume.to}; g.phase='respond'; }
  } else if(resume.type==='aoe'){
    if(red){
      g.log=pushLog(g.log, g.players[resume.target].name+' 以【八卦阵】抵消【'+g.aoe.trick+'】');
      aoeAdvance(g, resume.target);
    } else {
      g.pending={type:'aoeResp', from:g.aoe.from, to:resume.target, need:g.aoe.need};
      g.phase='aoeResp';
      g.log=pushLog(g.log, '要求 '+g.players[resume.target].name+' 打出【'+g.aoe.need+'】');
    }
  }
}

// ---------- actions (all via transaction on the whole game) ----------
// stripUndefined: 深度剔除对象/数组里所有值为 undefined 的属性——Firebase 的 transaction 规则是
// "返回值里任何字段显式为 undefined 就整个拒绝写入"(不是软失败,是直接不提交,抛
// "Data returned contains undefined in property ..." 错误)。这类 bug 极隐蔽:很多 pending 构造
// 习惯"多传一个透传字段,其它场景不传就是 undefined"(如 startTrick 的 card/seatB/pool——见那里的
// 具体修复),本地跑/自测环境不会报错,只有真连 Firebase 才会在提交那一刻被拒绝。这里在 tx() 出口
// 做一层统一兜底,即使以后又有类似疏漏也不会真正写坏/被拒绝——但这只是兜底,不是纵容随手传
// `x: 可能是 undefined 的变量` 的理由,新增"透传字段"时仍然优先用条件展开、只在有值时才放进对象。
function stripUndefined(obj){
  if(Array.isArray(obj)){
    obj.forEach(v=>{ if(v && typeof v==='object') stripUndefined(v); });
    return obj;
  }
  if(obj && typeof obj==='object'){
    Object.keys(obj).forEach(k=>{
      if(obj[k]===undefined) delete obj[k];
      else if(obj[k] && typeof obj[k]==='object') stripUndefined(obj[k]);
    });
  }
  return obj;
}
function tx(fn){ gameRef.transaction(g => { if(!g) return g; normalize(g); return stripUndefined(fn(g) || g); }); }

function startGame(){
  tx(g=>{
    if(g.started || g.players.length<MIN_PLAYERS) return g;
    g.deck = buildDeck(); g.discard=[];
    g.players.forEach((p,i)=>{
      p.general = randomGeneralId();           // 随机分配武将(允许重复)
      p.maxHp = generalMaxHp(p.general);       // 体力上限按武将,异常回退 MAX_HP
      p.hp = p.maxHp; p.hand=[]; p.alive=true; p.dying=false; p.delays=[];
      p.equips = emptyEquips();                // 装备区:开局四槽全空
      drawN(g,i,START_HAND);
    });
    g.started=true; g.pending=null;
    g.log = pushLog(g.log, '游戏开始！');
    // 第一回合也要走 startTurn(不能手写 g.turn/g.phase),否则会跳过判定区处理和洛神触发链路
    // ——这正是"开局第一回合甄姬洛神不触发"这个 bug 的根因,第二回合起走 endTurn→startTurn 就正常。
    startTurn(g, 0);
    return g;
  });
}
function doDraw(){
  tx(g=>{
    if(g.phase!=='draw'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    const n = 2 + generalCapValue(me,'extraDrawPhase',0); // 基础2张 + extraDrawPhase 额外摸牌(通用数值 seam,当前暂无武将/装备使用)
    drawN(g, mySeat, n);
    g.log=pushLog(g.log, me.name+' 摸了'+n+'张牌');
    // 乐不思蜀:摸牌阶段照常摸牌,只是不给出牌机会——判定成功时 resolveDelayTricks 已经设过 g.skipPlay,
    // 这里(原本要进 play 阶段的那一刻)消费掉,直接跳去 discard(该弃就弃、没超限就直接可以结束回合)。
    if(g.skipPlay){
      g.skipPlay=false;
      g.log=pushLog(g.log, me.name+' 因【乐不思蜀】跳过出牌阶段');
      g.phase='discard';
    } else {
      g.phase='play';
    }
    return g;
  });
}
// respondTuxi: 张辽【突袭】——摸牌阶段放弃摸牌,改为从 1~2 名其他存活玩家的手牌里各随机拿一张。
// targets 是 1~2 个座位号(不含自己、不重复、都要存活);校验不过直接不生效(状态不变)。
// 选到没手牌的目标不算错误,只是拿不到牌,记一条日志说明,不阻断其余目标的结算。
// 和顺手牵羊不同:这是摸牌阶段的替代行为,不是出牌阶段的锦囊,不开无懈可击窗口,同步直接结算。
function respondTuxi(targets){
  tx(g=>{
    if(g.phase!=='draw'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!hasCap(me,'tuxi')) return g;
    if(!Array.isArray(targets) || targets.length<1 || targets.length>2) return g;
    const seen=new Set();
    for(const t of targets){
      if(typeof t!=='number' || t===mySeat || !g.players[t] || !g.players[t].alive || seen.has(t)) return g;
      seen.add(t);
    }
    targets.forEach(t=>{
      const tgt=g.players[t];
      if((tgt.hand||[]).length>0){
        const j=Math.floor(Math.random()*tgt.hand.length);
        me.hand.push(tgt.hand.splice(j,1)[0]);
        g.log=pushLog(g.log, me.name+' 发动【突袭】,从 '+tgt.name+' 拿走一张手牌');
      } else {
        g.log=pushLog(g.log, me.name+' 发动【突袭】,但 '+tgt.name+' 没有手牌');
      }
    });
    g.phase='play';
    return g;
  });
}
// ===== 统一出牌入口:出牌阶段所有牌共用样板,各牌独特部分在 CARD_PLAYS 表里 =====
// actionId:除"杀"外都等于 card.name;杀固定为 '杀'(赵云的闪也走杀,物理牌名可能是'闪')。
// 每项:canPlay(身份+独特前置校验)、target(是否指定目标,决定走不走统一目标校验)、effect(独特效果+日志)。
const CARD_PLAYS = {
  '杀': {
    target:true,
    canPlay:(g,me,card)=> canUseAs(me,card,'杀') && (!g.shaUsed || hasCap(me,'unlimitedSha')), // 无限杀:张飞【咆哮】或诸葛连弩
    canTarget:(g,me,card,targetSeat)=> canReachSha(g, mySeat, targetSeat), // 只有杀受攻击距离限制
    effect:(g,me,card,targetSeat)=>{
      const usedAs = card.name==='杀' ? '出【杀】' : '出【'+card.name+'】当【杀】';
      g.shaUsed=true; // 本回合出杀次数限制:这里(当前回合玩家在自己出牌阶段出杀)才该计入
      resolveShaUse(g, me, targetSeat, usedAs, card);
    }
  },
  '桃': {
    target:false,
    canPlay:(g,me,card)=> card.name==='桃' && me.hp<me.maxHp,
    effect:(g,me,card)=>{ me.hp++; g.log=pushLog(g.log, me.name+' 使用【桃】回复1点体力'); }
  },
  '决斗': {
    target:true,
    canPlay:(g,me,card)=> card.name==='决斗',
    effect:(g,me,card,targetSeat)=>{
      g.log=pushLog(g.log, me.name+' 对 '+g.players[targetSeat].name+' 使用【决斗】');
      // 先开无懈窗口；无人无懈才真正进入 duel 弃杀流程（见 resolveTrick）
      startTrick(g, {trick:'决斗', from:mySeat, to:targetSeat});
    }
  },
  '无中生有': {
    target:false,
    canPlay:(g,me,card)=> card.name==='无中生有',
    effect:(g,me,card)=>{
      g.log=pushLog(g.log, me.name+' 使用【无中生有】');
      // 目标是自己(只影响使用者本人):先开无懈窗口,无人无懈(或反制后恢复生效)才真正摸牌(见 resolveTrick)
      startTrick(g, {trick:'无中生有', from:mySeat, to:mySeat});
    }
  },
  '桃园结义': {
    target:false,
    canPlay:(g,me,card)=> card.name==='桃园结义',
    effect:(g,me,card)=>{
      g.log=pushLog(g.log, me.name+' 使用【桃园结义】');
      // 对全场存活角色生效(含自己),无懈抵消的是这次使用的整体效果(全场都不回血),
      // 不是逐个单独无懈——所以和无中生有同一个模板:开一次无懈窗口,to 只是占位
      // (resolveTrick 里真正生效时循环所有存活玩家,不会用 info.to 做单人操作)。
      startTrick(g, {trick:'桃园结义', from:mySeat, to:mySeat});
    }
  },
  // 借刀杀人:两个不同角色的目标(A 要有武器、B 要在 A 攻击范围内),不是标准单目标流程能表达的,
  // 客户端拦下 selectedCardIdx 选中后走专属的"选 A→选 B"两步流程,直接调 jieDaoShaRen 提交,
  // 不经过 playCard/这里的 effect(target:true 只是为了让点牌选中这一步复用现有 UI 高亮)。
  '借刀杀人': {
    target:true,
    canPlay:(g,me,card)=> card.name==='借刀杀人' && g.players.some((A,ai)=>
      A && A.alive && ai!==mySeat && A.equips && A.equips.weapon &&
      g.players.some((B,bi)=> B && B.alive && bi!==ai && canReachSha(g,ai,bi))
    ),
    effect:()=>{} // 正常流程不会走到这里(见上方注释);留空防御,避免万一被绕过时报错
  },
  '五谷丰登': {
    target:false,
    canPlay:(g,me,card)=> card.name==='五谷丰登',
    effect:(g,me,card)=>{
      const pool = revealPool(g, aliveCount(g));
      g.log=pushLog(g.log, me.name+' 使用【五谷丰登】,亮出'+pool.length+'张牌');
      // 目标是自己(占位,和无中生有/桃园结义同一模板):无懈抵消的是整体效果(亮出的牌全部作废进弃牌堆)
      startTrick(g, {trick:'五谷丰登', from:mySeat, to:mySeat, pool});
    }
  },
  '顺手牵羊': {
    target:true,
    canPlay:(g,me,card)=> card.name==='顺手牵羊',
    effect:(g,me,card,targetSeat)=>{
      g.log=pushLog(g.log, me.name+' 对 '+g.players[targetSeat].name+' 使用【顺手牵羊】');
      startTrick(g, {trick:'顺手牵羊', from:mySeat, to:targetSeat});
    }
  },
  '过河拆桥': {
    target:true,
    canPlay:(g,me,card)=> card.name==='过河拆桥',
    effect:(g,me,card,targetSeat)=>{
      g.log=pushLog(g.log, me.name+' 对 '+g.players[targetSeat].name+' 使用【过河拆桥】');
      startTrick(g, {trick:'过河拆桥', from:mySeat, to:targetSeat});
    }
  },
  '南蛮入侵': { target:false, canPlay:(g,me,card)=> card.name==='南蛮入侵', effect:(g,me,card)=> aoeEffect(g,me,card) },
  '万箭齐发': { target:false, canPlay:(g,me,card)=> card.name==='万箭齐发', effect:(g,me,card)=> aoeEffect(g,me,card) },
};
// 装备牌:所有装备共用同一个 spec。noDiscard=true → playCard 不把它塞进弃牌堆,改由 effect 放进装备区。
// 加新装备只需往 EQUIPS 加一项,下面的循环会自动挂进 CARD_PLAYS(actionId=牌名)。
const equipPlay = {
  target:false,
  noDiscard:true,
  canPlay:(g,me,card)=> !!getEquip(card.name),
  effect:(g,me,card)=> equipCard(g,me,card)
};
Object.keys(EQUIPS).forEach(name=>{ CARD_PLAYS[name] = equipPlay; });
// 延时锦囊:所有延时锦囊共用同一个 spec。noDiscard=true → 不立即进弃牌堆,效果是"放进目标判定区"
// (真正放置动作在 startTrick 打开的无懈窗口问完之后,见 resolveTrick 的 DELAY_TRICKS 分支)。
// allowSelf=true:playCard 默认拒绝自选目标,闪电这类"只能选自己"的延时锦囊需要放行这条限制。
// 加新延时锦囊只需往 DELAY_TRICKS 加一项,下面的循环自动挂进 CARD_PLAYS(actionId=牌名)。
const delayTrickPlay = {
  target:true,
  noDiscard:true,
  allowSelf:true,
  canPlay:(g,me,card)=> !!DELAY_TRICKS[card.name],
  canTarget:(g,me,card,targetSeat)=> DELAY_TRICKS[card.name].onlySelf ? targetSeat===mySeat : targetSeat!==mySeat,
  effect:(g,me,card,targetSeat)=>{
    g.log=pushLog(g.log, me.name+' 对 '+g.players[targetSeat].name+' 使用【'+card.name+'】');
    // 打出时的无懈窗口:和决斗/顺手/拆桥同一套 startTrick,card 透传进 pending,
    // 供 finishWuxieRound(被无懈挡下→进弃牌堆)/resolveTrick(未被挡下→放进判定区)使用。
    startTrick(g, {trick:card.name, from:mySeat, to:targetSeat, card});
  }
};
Object.keys(DELAY_TRICKS).forEach(name=>{ CARD_PLAYS[name] = delayTrickPlay; });
// equipCard: 把已出手(被 playCard 从手牌 splice 出、且未进弃牌堆)的装备牌放进对应槽;同槽旧装备进弃牌堆。
function equipCard(g, me, card){
  const slot = getEquip(card.name).slot;
  const old = me.equips[slot];
  if(old) g.discard.push(old);   // 旧装备进弃牌堆
  me.equips[slot] = card;        // 新装备入槽(装备牌本身不进弃牌堆)
  const slotName = { weapon:'武器', armor:'防具', plus1:'+1马', minus1:'-1马' }[slot];
  g.log=pushLog(g.log, me.name+' 装备了【'+card.name+'】'+(old?'，替换下【'+old.name+'】':'')+'（'+slotName+'）');
  // 同槽换装 = 换下的旧装备离开装备区 → 触发失去装备钩子(如孙尚香【枭姬】)。恒失去 1 张。
  if(old) triggerHook(g, g.players.indexOf(me), 'onLoseEquip', { count:1 });
}
// ===== 距离机制(装备第2步):马的 dist、武器的 range 均从 EQUIPS 读,不硬编码 =====
// 读某槽装备的距离修正(的卢 plus1:+1、赤兔 minus1:-1);无装备/无 dist 返回 0。
function equipDist(player, slot){
  const c = player && player.equips && player.equips[slot];
  const info = c && getEquip(c.name);
  return (info && typeof info.dist==='number') ? info.dist : 0;
}
// distance: from 到 to 的实际距离。环形最近间隔只在"存活玩家"上数(阵亡者不占座位),
// 再叠加 目标的 +1马 与 from 的 -1马,最小为 1。
// from 方向的 -1 修正有两个独立来源、直接相加:装备的 -1 马(equipDist)+ 马超【马术】
// 这类"锁定技距离-1"的 cap(extraMinus1)——两者不互斥,同时存在时效果叠加。
function distance(g, from, to){
  if(from===to) return 0;
  const alive = g.players.map((p,i)=>i).filter(i=>g.players[i] && g.players[i].alive);
  const m = alive.length;
  const pf = alive.indexOf(from), pt = alive.indexOf(to);
  if(pf<0 || pt<0 || m<2) return 1;                       // 兜底(出杀时双方必存活)
  const cw = (((pt-pf)%m)+m)%m;                            // 顺时针步数(只数存活者)
  const base = Math.min(cw, m-cw);                         // 顺/逆取较小
  const fromMinus1 = equipDist(g.players[from],'minus1') + (hasCap(g.players[from],'extraMinus1') ? -1 : 0);
  const d = base + equipDist(g.players[to],'plus1') + fromMinus1;
  return Math.max(1, d);
}
// attackRange: 该玩家攻击距离 = 武器 range,无武器默认 1。
function attackRange(g, seat){
  const p = g.players[seat];
  const w = p && p.equips && p.equips.weapon;
  const info = w && getEquip(w.name);
  return (info && typeof info.range==='number') ? info.range : 1;
}
// canReachSha: 我(mySeat)能否对 targetSeat 出杀 = 距离 <= 攻击距离。UI 与校验共用,避免口径分叉。
function canReachSha(g, fromSeat, targetSeat){
  return distance(g, fromSeat, targetSeat) <= attackRange(g, fromSeat);
}
// 群体锦囊效果:无目标,启动逐目标结算流程(南蛮要杀、万箭要闪)。
function aoeEffect(g, me, card){
  const need = (card.name==='南蛮入侵')?'杀':'闪';
  g.aoe={trick:card.name, from:mySeat, need};
  g.log=pushLog(g.log, me.name+' 使用【'+card.name+'】');
  aoeAdvance(g, mySeat); // 从下家起结算第一个目标
}
// playCard: 统一校验(阶段/回合、取牌、身份+独特前置、目标存活、默认非自己)、出牌入弃牌堆(noDiscard 的装备/延时锦囊除外),再执行该牌独特效果。
function playCard(cardIdx, actionId, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat], card=me.hand[cardIdx];
    if(!card) return g;
    const spec=CARD_PLAYS[actionId];
    if(!spec || !spec.canPlay(g,me,card)) return g;
    if(spec.target){
      // 默认拒绝自选目标;spec.allowSelf(如闪电这类延时锦囊)放行
      if((targetSeat===mySeat && !spec.allowSelf) || !g.players[targetSeat] || !g.players[targetSeat].alive) return g;
      if(spec.canTarget && !spec.canTarget(g,me,card,targetSeat)) return g; // 额外目标限制(如杀的攻击距离)
    }
    me.hand.splice(cardIdx,1);
    if(!spec.noDiscard) g.discard.push(card); // 装备牌 noDiscard:不进弃牌堆,由 effect 放进装备区
    spec.effect(g, me, card, targetSeat);
    return g;
  });
}
// resolveShaUse: 杀的结算入口(设次数标记 + pending + 进入响应阶段 + 日志)。
// 普通杀(CARD_PLAYS['杀'])和丈八蛇矛两张当杀共用,保证响应/距离/次数口径不分叉。
// 马超【铁骑】:攻击者可选是否发动判定,红色则这张杀不可被闪抵消——这是攻击者自己的选择,
// 需要挂起等一次响应,原来"设好 pending 后直接走青釭剑/八卦阵/进响应阶段"这段尾巴抽成
// continueShaAfterTieqi,不管有没有铁骑、发不发动、判红判黑,最终都走这同一条尾巴。
// card(可选):转化后实际打出的物理牌(关羽红牌/龙胆闪牌等),供于禁【毅重】判断颜色;
// 丈八蛇矛两张当杀没有单一花色,调用方不传(undefined),毅重不生效。
// 注意:g.shaUsed(本回合出杀次数限制)不在这里设置——本函数不假设调用方一定是"当前回合玩家
// 在自己出牌阶段出杀"(借刀杀人打破了这个假设:A 可能根本不是当前回合玩家)。谁该计入次数
// 由各调用点自己在调用前决定:CARD_PLAYS['杀'].effect/playZhangbaSha 会设,借刀杀人不设。
function resolveShaUse(g, me, targetSeat, usedAs, card){
  const target=g.players[targetSeat];
  // 于禁【毅重】(锁定技):目标无防具 + 这张杀是黑色 → 直接无效,不进响应阶段、不消耗闪、不受伤。
  if(card && !isRed(card) && hasCap(target,'yizhong') && !(target.equips && target.equips.armor)){
    g.log=pushLog(g.log, me.name+' 对 '+target.name+' 使用的黑色【杀】因【毅重】无效');
    g.phase='play';
    return;
  }
  g.log=pushLog(g.log, me.name+' 对 '+target.name+' '+usedAs);
  if(hasCap(me,'tieqi')){
    g.pending={type:'tieqi', from:mySeat, to:targetSeat};
    g.phase='tieqi';
    g.log=pushLog(g.log, '是否发动【铁骑】进行判定…');
    return;
  }
  // 黄忠【烈弓】:数值条件同步比较,不需要判定,满足条件时可选发动(不是自动生效)。
  if(hasCap(me,'liegong')){
    const targetHandCount=(g.players[targetSeat].hand||[]).length;
    if(targetHandCount>=me.hp || targetHandCount<=attackRange(g,mySeat)){
      g.pending={type:'liegong', from:mySeat, to:targetSeat};
      g.phase='liegong';
      g.log=pushLog(g.log, '是否发动【烈弓】,令此【杀】不可被【闪】抵消…');
      return;
    }
  }
  continueShaAfterTieqi(g, mySeat, targetSeat, false);
}
// respondLiegong: 仅攻击者(pending.from)可响应。不需要判定,玩家的选择直接就是 noShan 的值——
// 复用 continueShaAfterTieqi 同一条尾巴(和铁骑判红共用"不可被闪抵消"这一效果)。
function respondLiegong(activate){
  tx(g=>{
    if(g.phase!=='liegong'||!g.pending||g.pending.type!=='liegong'||g.pending.from!==mySeat) return g;
    const from=g.pending.from, to=g.pending.to;
    g.log=pushLog(g.log, activate
      ? g.players[from].name+' 发动【烈弓】,此【杀】不可被【闪】抵消'
      : g.players[from].name+'：不发动【烈弓】');
    continueShaAfterTieqi(g, from, to, activate);
    return g;
  });
}
// jieDaoShaRen: 使用者选定 A(有武器)、B(在 A 攻击范围内,不是 A 自己)后提交,弃牌+开无懈窗口。
// 距离校验(B 是否在 A 范围内)就在这一步做,A 后续出杀时不再重复校验(见 respondJiedao 注释)。
function jieDaoShaRen(cardIdx, seatA, seatB){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    const card=me.hand[cardIdx];
    if(!card || card.name!=='借刀杀人') return g;
    const A=g.players[seatA], B=g.players[seatB];
    if(!A || !A.alive || seatA===mySeat || !A.equips.weapon) return g;
    if(!B || !B.alive || seatB===seatA || !canReachSha(g, seatA, seatB)) return g;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    g.log=pushLog(g.log, me.name+' 对 '+A.name+' 使用【借刀杀人】,目标 '+B.name);
    startTrick(g, {trick:'借刀杀人', from:mySeat, to:seatA, seatB});
    return g;
  });
}
// respondJiedao: 仅 A(pending.seatA)可响应。选杀:走 resolveShaUse(复用铁骑/烈弓/毅重等判定),
// 但故意不设 g.shaUsed——这张"借来的杀"不占用任何人(包括 A 自己、当前回合玩家)的次数限制,
// 也不重复校验距离(B 是否在 A 范围内,已经在 jieDaoShaRen 选目标那一步校验过)。
// 选弃武器:弃置 A 当前装备的武器(不是使用者选的牌),触发 onLoseEquip(孙尚香会摸两张)。
function respondJiedao(useSha){
  tx(g=>{
    if(g.phase!=='jiedaoChoice'||!g.pending||g.pending.type!=='jiedaoChoice'||g.pending.seatA!==mySeat) return g;
    const seatB=g.pending.seatB;
    const A=g.players[mySeat];
    if(useSha){
      const idx=findUsableAs(A.hand, A, '杀');
      if(idx<0) return g; // 没有可用的杀:不生效(按钮本就不该渲染)
      const card=A.hand.splice(idx,1)[0]; g.discard.push(card);
      g.log=pushLog(g.log, A.name+' 选择对 '+g.players[seatB].name+' 使用'+(card.name==='杀'?'【杀】':'【'+card.name+'】当【杀】')+'(借刀杀人)');
      g.pending=null;
      resolveShaUse(g, A, seatB, '借刀杀人:出【杀】', card);
      return g;
    }
    const weapon=A.equips.weapon;
    if(!weapon) return g; // 理论上不会(resolveTrick 进这个阶段前已校验),双重保险
    A.equips.weapon=null;
    g.discard.push(weapon);
    g.log=pushLog(g.log, A.name+' 选择弃置武器【'+weapon.name+'】(借刀杀人)');
    triggerHook(g, mySeat, 'onLoseEquip', {count:1});
    g.pending=null; g.phase='play';
    return g;
  });
}
// continueShaAfterTieqi: 铁骑判定/烈弓数值条件阶段结束后(或从一开始就没有这两个技能)接回杀的
// 原有流程。noShan 为真时这张杀不可被闪抵消——包括八卦阵这类"视为闪"的效果,所以直接跳过
// tryBagua(根本不给判定机会),进响应阶段但 pending.noShan 标记会挡掉出闪。是谁、为什么触发
// noShan(铁骑判红、还是烈弓数值条件)由调用方(finishTieqiJudge/respondLiegong)自己记日志,
// 这里只管接回流程,不重复归因到某个具体技能。
function continueShaAfterTieqi(g, from, to, noShan){
  const me=g.players[from];
  g.pending={from, to, noShan};
  if(noShan){
    g.log=pushLog(g.log, '此【杀】不可被【闪】抵消(含视为闪的效果)');
    g.phase='respond';
    return;
  }
  // 青釭剑:攻击者无视目标防具 → 跳过目标八卦阵判定(八卦阵公开,记一条日志便于阅读)
  if(hasCap(me,'ignoreArmor')){
    if(hasCap(g.players[to],'bagua')) g.log=pushLog(g.log, me.name+' 的【青釭剑】无视了 '+g.players[to].name+' 的防具');
    g.phase='respond'; return; // 目标只能正常出闪/受伤
  }
  // 八卦阵:被杀需出闪前先判定,红=视为出闪 → 杀被抵消,攻击者继续出牌(与正常出闪同结果)
  const r=tryBagua(g, to, {type:'sha', from, to});
  if(r==='pending') return; // 鬼才改判进行中,收尾延后到 finishGuicai
  if(r){ g.pending=null; g.phase='play'; return; }
  g.phase='respond'; // 黑/无八卦阵:照常进响应,等目标出闪或受伤
}
// respondTieqi: 仅攻击者(pending.from)可响应。不发动:直接接原尾巴(noShan=false)。
// 发动:judge() 翻牌(可被鬼才改判,和其它判定场景同一套 maybeGuicai),红则 noShan=true。
function respondTieqi(activate){
  tx(g=>{
    if(g.phase!=='tieqi'||!g.pending||g.pending.type!=='tieqi'||g.pending.from!==mySeat) return g;
    const from=g.pending.from, to=g.pending.to;
    if(!activate){
      g.log=pushLog(g.log, g.players[from].name+'：不发动【铁骑】');
      continueShaAfterTieqi(g, from, to, false);
      return g;
    }
    const card=judge(g);
    if(!card){ continueShaAfterTieqi(g, from, to, false); return g; } // 无牌可判,视为未发动
    if(maybeGuicai(g, from, card, {kind:'tieqiJudge', from, to})==='pending') return g;
    finishTieqiJudge(g, from, to, card);
    return g;
  });
}
// finishTieqiJudge: 铁骑判定结算(不管是否被鬼才改判过)。红=不可被闪抵消,黑=无事发生。
function finishTieqiJudge(g, from, to, card){
  const red=isRed(card);
  g.log=pushLog(g.log, g.players[from].name+' 发动【铁骑】,判定为'+(red?'红':'黑'));
  continueShaAfterTieqi(g, from, to, red);
}
// playZhangbaSha: 丈八蛇矛特效——任意两张手牌当一个【杀】。与 playCard 平级(playCard 只吃单张)。
// 次数/距离/目标响应与普通杀完全一致(共用 resolveShaUse);仅"凑杀"方式不同。
function playZhangbaSha(idx1, idx2, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(idx1===idx2) return g;
    const c1=me.hand[idx1], c2=me.hand[idx2];
    if(!c1||!c2) return g;
    if(!hasCap(me,'twoAsSha')) return g;                       // 无丈八(卸下/被拆即失效)
    if(g.shaUsed && !hasCap(me,'unlimitedSha')) return g;      // 次数限制(除非无限杀)
    const tgt=g.players[targetSeat];
    if(targetSeat===mySeat||!tgt||!tgt.alive) return g;
    if(!canReachSha(g, mySeat, targetSeat)) return g;          // 攻击距离(丈八 range3)
    // 两张牌进弃牌堆:先弹大下标再弹小下标,避免 splice 后错位
    const hi=Math.max(idx1,idx2), lo=Math.min(idx1,idx2);
    g.discard.push(me.hand.splice(hi,1)[0]);
    g.discard.push(me.hand.splice(lo,1)[0]);
    g.shaUsed=true; // 本回合出杀次数限制:这里(当前回合玩家在自己出牌阶段出杀)才该计入
    resolveShaUse(g, me, targetSeat, '用两张牌当【杀】(丈八蛇矛)');
    return g;
  });
}
// duanLiang: 徐晃【断粮】——出牌阶段限一次,弃置任意一张手牌,视为对一名其他角色使用了一张
// 【兵粮寸断】。不需要真的持有兵粮寸断这张牌:弃掉的牌是真实牌、正常进弃牌堆;判定区里放的
// 是临时构造的虚拟对象 {name:'兵粮寸断', virtual:true},走和真实兵粮寸断完全一样的
// startTrick/resolveTrick/回合开始判定流程(可被无懈可击抵消),虚拟牌离场时经 discardOrVanish
// 直接消失,不会进弃牌堆重新流通、污染牌堆构成。真实规则断粮无距离限制,这里不做距离校验。
function duanLiang(cardIdx, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!hasCap(me,'duanliang') || g.duanliangUsed) return g;
    const card=me.hand[cardIdx];
    if(!card) return g;
    if(targetSeat===mySeat || !g.players[targetSeat] || !g.players[targetSeat].alive) return g;
    g.duanliangUsed=true;
    me.hand.splice(cardIdx,1);
    g.discard.push(card); // 弃置的牌是真实牌,正常进弃牌堆
    g.log=pushLog(g.log, me.name+' 弃置一张牌,发动【断粮】,视为对 '+g.players[targetSeat].name+' 使用了一张【兵粮寸断】');
    startTrick(g, {trick:'兵粮寸断', from:mySeat, to:targetSeat, card:{name:'兵粮寸断', virtual:true}});
    return g;
  });
}
// qiaoBian: 张郃【巧变】(简化版)——出牌阶段限一次,弃一张手牌、跳过这个阶段,可选把场上
// 一张装备/延时锦囊移到另一名角色身上。全程只有张郃自己做选择,不需要任何其他玩家响应,
// 不引入新的服务端阶段,客户端选好 move 后一次性提交,服务端独立重新校验(不信任客户端)。
// move 为 null(不移动,仅跳过阶段)或 {kind:'equip'|'delay', srcSeat, slot(kind==='equip'时)
// 或 idx(kind==='delay'时,src.delays 下标), dstSeat}。
function qiaoBian(cardIdx, move){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!hasCap(me,'qiaobian') || g.qiaobianUsed) return g;
    const card=me.hand[cardIdx];
    if(!card) return g;
    g.qiaobianUsed=true;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    g.log=pushLog(g.log, me.name+' 弃置一张牌,发动【巧变】,跳过出牌阶段');
    if(move) doQiaobianMove(g, move);
    g.phase='discard';
    return g;
  });
}
// doQiaobianMove: 独立重新校验合法性后执行移动;不合法就安静跳过(巧变本身——弃牌+跳过
// 阶段——已经生效,不受影响,只是这次没有移动发生)。装备移动触发 onLoseEquip(和拆装备/
// 换装同性质,源玩家视为失去这件装备);延时锦囊移动不触发任何钩子(项目里没有对应的
// "失去判定牌"钩子)。
function doQiaobianMove(g, move){
  const src=g.players[move.srcSeat], dst=g.players[move.dstSeat];
  if(!src || !dst || !src.alive || !dst.alive || move.srcSeat===move.dstSeat) return;
  if(move.kind==='equip'){
    const slot=move.slot;
    if(!EQUIP_SLOTS.includes(slot)) return;
    const card=src.equips[slot];
    if(!card || dst.equips[slot]) return; // 源槽为空,或目标同类型槽已被占用
    src.equips[slot]=null;
    dst.equips[slot]=card;
    g.log=pushLog(g.log, '【巧变】把 '+src.name+' 的装备【'+card.name+'】移到了 '+dst.name);
    triggerHook(g, move.srcSeat, 'onLoseEquip', {count:1});
  } else if(move.kind==='delay'){
    const idx=move.idx;
    const card=(src.delays||[])[idx];
    if(!card) return;
    dst.delays = dst.delays || [];
    if(dst.delays.some(c=>c.name===card.name)) return; // 目标判定区已有同名延时锦囊
    src.delays.splice(idx,1);
    dst.delays.push(card);
    g.log=pushLog(g.log, '【巧变】把 '+src.name+' 判定区的【'+card.name+'】移到了 '+dst.name+' 的判定区');
  }
}
// ===== 伤害 / 胜负 统一处理(为日后武将技能铺路) =====
// dealDamage: 只负责扣血 + 死亡判定挂起 + 相关日志,不推进阶段、不判胜负。
// 返回值语义:是否已挂起进入濒死流程(true = 调用方应立即 return,后续收尾延后到 finishDying 处理;
// 不代表最终真死——濒死可能被桃救回)。sourceSeat 暂存伤害来源,供日后技能使用。
function dealDamage(g, seat, amount, sourceSeat, reason, srcType){
  const p=g.players[seat];
  if(!p) return false;
  p.hp -= amount;
  g.log=pushLog(g.log, p.name+(reason?' '+reason+',':' ')+'受到'+amount+'点伤害（体力'+p.hp+'）');
  if(p.hp<=0){
    startDying(g, seat, srcType);
    return true; // 挂起:调用方立即 return,不做收尾(收尾延后到濒死解决时统一处理)
  }
  // 实际受伤且存活 -> 触发"受到伤害后"钩子(如郭嘉【天妒】)。srcType 标识伤害来源类型('sha'/'duel'/'aoe'),现有钩子忽略,备将来用。
  if(amount>0) triggerHook(g, seat, 'onDamaged', { amount, sourceSeat, srcType });
  return false;
}
// ===== 濒死求桃:血量<=0 不立刻死亡,按座位顺序逐个询问是否打出【桃】救援 =====
// startDying: 由 dealDamage 在 hp<=0 时调用。从濒死者本人开始问(可自救),
// resume 记下"濒死解决后该接回哪条流程的尾巴"(取值就是调用方本来就在传的 srcType)。
function startDying(g, seat, resumeType){
  const p=g.players[seat];
  p.dying=true;
  g.pending={type:'dying', seat, asking:seat, resume:{type:resumeType}};
  g.phase='dying';
  g.log=pushLog(g.log, p.name+' 濒死！询问 '+p.name+' 是否使用【桃】自救…');
}
// respondDying: 仅当前被问的人(pending.asking)可响应。
// 打出桃:回1点体力;若脱离濒死(hp>0)则 finishDying(false)结束;若仍<=0,留在同一个人身上,
// 允许其继续追加桃(接力仍在此人,若无更多桃则界面只剩"不救"可点)。
// 不救:用 nextAskee(from=濒死者座位) 推进到下一个存活玩家;绕回濒死者本人 = 问完一圈,无人救 -> finishDying(true)。
function respondDying(useTao){
  tx(g=>{
    if(g.phase!=='dying'||!g.pending||g.pending.type!=='dying') return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || g.pending.asking!==mySeat) return g;
    const dyingP=g.players[g.pending.seat];
    if(useTao){
      const idx=findUsableAs(me.hand, me, '桃'); // 复用 canUseAs/findUsableAs seam,不硬编码牌名
      if(idx<0) return g; // 没有桃:状态不变(双重保险,按钮本就不该出现)
      const card=me.hand.splice(idx,1)[0]; g.discard.push(card);
      dyingP.hp++;
      g.log=pushLog(g.log, me.name+' 对 '+dyingP.name+' 打出【'+card.name+'】,回复1点体力（体力'+dyingP.hp+'）');
      if(dyingP.hp>0){ finishDying(g, false); }
      return g;
    }
    g.log=pushLog(g.log, me.name+'：不使用【桃】');
    const nxt=nextAskee(g, g.pending.seat, mySeat);
    if(nxt===null){ finishDying(g, true); return g; }
    g.pending.asking=nxt;
    g.log=pushLog(g.log, '询问 '+g.players[nxt].name+' 是否对 '+dyingP.name+' 使用【桃】…');
    return g;
  });
}
// finishDying: 濒死解决(获救或真死)。真死时把原 dealDamage 里的"阵亡弃牌"逻辑搬到这里执行;
// 随后按 pending.resume.type 接回原来被 dealDamage 打断的那条流程的尾巴
// (respondShan/duelResponse/aoeRespond 各自原有的 checkWin+阶段推进逻辑,原样不变、只是延后到此刻执行)。
function finishDying(g, actuallyDied){
  const seat=g.pending.seat, resume=g.pending.resume;
  const p=g.players[seat];
  p.dying=false;
  if(actuallyDied){
    p.alive=false;
    // 阵亡:所有手牌 + 装备牌 + 判定区(延时锦囊)弃置进弃牌堆(标准规则),让牌回流、牌库不被抽干
    const equipCards = EQUIP_SLOTS.map(s=> p.equips && p.equips[s]).filter(Boolean);
    const delayCards = p.delays || [];
    const handCount = (p.hand||[]).length;
    if(handCount)          g.discard.push(...p.hand);
    if(equipCards.length)  g.discard.push(...equipCards);
    if(delayCards.length)  g.discard.push(...delayCards);
    p.hand = [];
    p.equips = emptyEquips(); // 四槽清空
    p.delays = [];            // 判定区清空
    const parts=[];
    if(handCount)          parts.push('弃置'+handCount+'张手牌');
    if(equipCards.length)  parts.push('弃置装备'+equipCards.map(c=>'【'+c.name+'】').join(''));
    if(delayCards.length)  parts.push('弃置判定区'+delayCards.map(c=>'【'+c.name+'】').join(''));
    g.log=pushLog(g.log, p.name+' 无人使用【桃】救援,阵亡！'+(parts.length?'（'+parts.join('，')+'）':''));
    // 阵亡弃装备刻意【不】触发 onLoseEquip 失去装备钩子(如枭姬):人已死,死亡结算不再发动常规技能。
    // ⚠️ 日后新增「主动卸载装备」入口时,记得在那里接入 triggerHook(g, seat, 'onLoseEquip', {count}),别漏了枭姬。
  } else {
    g.log=pushLog(g.log, p.name+' 脱离濒死！');
  }
  g.pending=null;
  if(checkWin(g)) return;
  if(resume.type==='duel'){
    if(!g.players[g.turn].alive){
      startTurn(g, nextAlive(g, g.turn));
    } else {
      g.phase='play';
    }
  } else if(resume.type==='aoe'){
    aoeAdvance(g, seat);
  } else if(resume.type==='delay'){
    // 判定区的牌(如闪电)致命挂起后的接回:真死了就换到下一个存活玩家的回合(该玩家的判定阶段
    // 从头 startTurn);被桃救回就继续处理这位玩家判定区剩余的牌(可能再次挂起濒死或鬼才,机制
    // 天然支持连续多张——具体怎么继续、怎么区分"新挂起是濒死还是鬼才",见 continueDelayResolution)。
    if(!g.players[resume.seat].alive){
      startTurn(g, nextAlive(g, resume.seat));
    } else {
      continueDelayResolution(g, resume.seat);
    }
  } else if(resume.type==='xiaoguo'){
    // 骁果"受到1点伤害"选项致命挂起后的接回:不管目标是否真死,都继续找下一个有资格的
    // 候选乐进(或最终真正切换回合)——resume 在 respondXiaoguoChoice 里已经带上完整信息。
    advanceXiaoguo(g, resume.endingSeat, resume.lastAsker);
  } else { // 'sha' 及其它:攻击者继续出牌阶段
    g.phase='play';
  }
}
// 麒麟弓:杀造成伤害且目标存活时,弃目标一匹坐骑。0匹→无效果;1匹→直接弃;2匹→开选马子阶段(攻击者选)。
// 返回 true 表示已开选马子阶段(调用方应提前返回、不做收尾)。仅由「杀造成伤害」处调用(srcType==='sha')。
function maybeStartQilin(g, attackerSeat, victimSeat){
  const attacker=g.players[attackerSeat], victim=g.players[victimSeat];
  if(!attacker || !victim || !victim.alive || !hasCap(attacker,'qilin')) return false;
  const hasP = !!(victim.equips && victim.equips.plus1);
  const hasM = !!(victim.equips && victim.equips.minus1);
  if(!hasP && !hasM) return false;                 // 目标无坐骑:无额外效果
  if(hasP && hasM){                                // 两匹:开子阶段,由攻击者选弃哪匹
    g.pending={type:'qilin', from:attackerSeat, to:victimSeat};
    g.phase='qilin';
    g.log=pushLog(g.log, attacker.name+' 的【麒麟弓】发动,选择弃置 '+victim.name+' 的哪匹坐骑…');
    return true;
  }
  discardMount(g, victimSeat, hasP?'plus1':'minus1', attacker.name);  // 一匹:直接弃
  return false;
}
// 弃置某玩家一匹坐骑进弃牌堆 + 触发失去装备钩子(枭姬等)。坐骑公开,日志写牌名。
function discardMount(g, seat, slot, attackerName){
  const p=g.players[seat], card=p.equips[slot]; if(!card) return;
  p.equips[slot]=null; g.discard.push(card);
  g.log=pushLog(g.log, (attackerName?attackerName+' 的':'')+'【麒麟弓】弃置了 '+p.name+' 的坐骑【'+card.name+'】');
  triggerHook(g, seat, 'onLoseEquip', { count:1 });
}
// qilinResolve: 麒麟弓选马子阶段结算。仅攻击者(pending.from)可操作;slot='plus1'|'minus1';失效项安全回 play 防软锁。
function qilinResolve(slot){
  tx(g=>{
    if(g.phase!=='qilin'||!g.pending||g.pending.type!=='qilin'||g.pending.from!==mySeat) return g;
    const victimSeat=g.pending.to, victim=g.players[victimSeat], attacker=g.players[g.pending.from];
    if(!victim || !victim.alive || (slot!=='plus1'&&slot!=='minus1') || !victim.equips[slot]){
      g.pending=null; g.phase='play'; return g; // 失效兜底
    }
    discardMount(g, victimSeat, slot, attacker?attacker.name:'');
    g.pending=null; g.phase='play';
    return g;
  });
}
// checkWin: 存活<=1 则结束游戏(置 over/winner、清理 pending/aoe、记日志),返回 true;否则 false。
function checkWin(g){
  if(aliveCount(g)<=1){
    const w=g.players.find(p=>p&&p.alive);
    g.phase='over'; g.winner = w?w.name:'无';
    g.pending=null; g.aoe=null;
    g.log=pushLog(g.log, '游戏结束,胜者：'+g.winner);
    return true;
  }
  return false;
}
// 决斗中由当前 active 玩家响应：打出【杀】则把出杀义务交给对方；认输则受伤、决斗结束。
// duelResponse: 决斗响应。吕布【无双】(锁定技):决斗任一方(发起者或目标)是吕布时,needed=2——
// 同一个人这一轮要连续打出两张杀才轮到对方,g.pending.shaCount 记这一轮已出几张;
// 换人时归零重新计数。选择认输就按原逻辑直接受伤,已出的杀不退回。
function duelResponse(useSha){
  tx(g=>{
    if(g.phase!=='duel'||!g.pending||g.pending.active!==mySeat) return g;
    const me=g.players[mySeat];
    const wushuang = hasCap(g.players[g.pending.from],'wushuang') || hasCap(g.players[g.pending.to],'wushuang');
    const needed = wushuang ? 2 : 1;
    if(useSha){
      const idx=findUsableAs(me.hand,me,'杀'); // 龙胆:闪可当杀,优先用本名杀
      if(idx<0) return g;
      const card=me.hand.splice(idx,1)[0]; g.discard.push(card);
      const played=(g.pending.shaCount||0)+1;
      g.log=pushLog(g.log, me.name+(card.name==='杀'?' 打出【杀】':' 打出【'+card.name+'】当【杀】')+(needed>1?'（'+played+'/'+needed+'）':''));
      if(played<needed){ g.pending.shaCount=played; return g; } // 吕布【无双】:这一轮还没出满,留在同一个人身上
      g.pending.active = (mySeat===g.pending.from)?g.pending.to:g.pending.from;
      g.pending.shaCount = 0; // 换人,计数归零重新开始
      return g;
    }
    // 认输：受伤
    // 注意:此处 sourceSeat 传的是 pending.from(决斗发起者)。决斗发起者本人认输受伤时,
    // sourceSeat 会等于受害者本人,导致司马懿【反馈】等依赖"伤害来源"的技能在该边角不触发;
    // 日后若要精确,应传"对手座位"(发起者受伤时传 pending.to,目标受伤时传 pending.from)。
    const dying = dealDamage(g, mySeat, 1, g.pending.from, '不出【杀】', 'duel');
    if(dying) return g; // 濒死流程接管,后续(轮转/阶段)延后到 finishDying 处理
    g.pending=null;
    if(checkWin(g)) return g;
    // 若回合玩家在决斗中阵亡,直接换下家;否则回合玩家继续出牌阶段
    if(!g.players[g.turn].alive){
      startTurn(g, nextAlive(g, g.turn));
    } else {
      g.phase='play';
    }
    return g;
  });
}
// ===== 无懈可击：锦囊结算前,按座位顺序逐个询问每个存活玩家 =====
// nextAskee: 从 current 的下家起,按座位号找下一个存活、且非使用者的玩家;
// 扫描中遇到 from(使用者)即代表问完一圈,返回 null。跳过阵亡者。
function nextAskee(g, from, current){
  const n=g.players.length; // 按实际玩家数取模,支持 2 或 3 人
  for(let k=1;k<=n;k++){
    const s=(current+k)%n;
    if(s===from) return null;                       // 绕回使用者 = 问完一圈
    if(g.players[s] && g.players[s].alive) return s; // 跳过阵亡者
  }
  return null;
}
// startTrick: 锦囊牌已进弃牌堆后调用。初始化无懈询问轮次(exclude/depth 见 openWuxieRound 注释),
// 交给 openWuxieRound 统一处理"算下一个问谁/问不到人就直接收尾"。
function startTrick(g, info){
  // card(可选):延时锦囊的物理牌对象,随 pending 透传,供 finishWuxieRound(被挡下→弃牌堆)/
  // resolveTrick(未被挡下→放进判定区)使用。seatB(可选):借刀杀人的第二个目标。
  // pool(可选):五谷丰登亮出的公共池。三者都只有各自那张牌会传,其它锦囊不传——
  // **不能直接把 info.card/info.seatB/info.pool 无条件塞进 pending**:大多数锦囊这几个字段
  // 都是 undefined,而 Firebase 的 transaction 规则是"返回值里任何字段显式为 undefined 就整个
  // 拒绝写入"(真实 bug:曾经这样写,导致过河拆桥/无中生有/决斗/顺手牵羊/桃园结义/延时锦囊
  // 放置/五谷丰登——所有经过 startTrick 的锦囊——第一次使用就被 Firebase 拒绝,界面上表现为
  // "点确定没反应",且这类 bug 只有真连 Firebase 才会触发,本地 stub 测试完全测不出来)。
  // 只在真的有值时才把这个 key 放进对象(而不是塞一个 undefined 值)。
  g.pending={type:'wuxie', trick:info.trick, from:info.from, to:info.to, exclude:info.from, depth:0};
  if(info.card!==undefined) g.pending.card=info.card;
  if(info.seatB!==undefined) g.pending.seatB=info.seatB;
  if(info.pool!==undefined) g.pending.pool=info.pool;
  g.phase='wuxie';
  openWuxieRound(g);
}
// ===== 无懈可击可被无懈可击反制(不限层数)=====
// 核心洞察:原锦囊/该 AOE 目标最终是否生效,只取决于"无懈可击总共被成功打出了几次"的奇偶性
// (depth 为奇数=作废,偶数含0=正常生效),不需要记录"每一层反制了谁"的完整历史栈——
// 每一层只是把 g.pending 的 exclude(当前这轮不问谁,即刚打出上一次无懈的人)/depth(成功次数)
// 原地更新,再重新走一遍座位遍历,不存在真正的递归调用,不会有调用栈风险。
// openWuxieRound: (重新)计算这一轮该问谁;问不到人(exclude 是唯一存活者,极端边界)则直接收尾。
function openWuxieRound(g){
  const asking=nextAskee(g, g.pending.exclude, g.pending.exclude);
  if(asking===null){ finishWuxieRound(g); return; }
  g.pending.asking=asking;
  // TEMP DEBUG(排查五谷丰登无懈按钮不显示的bug,定位到根因后移除):
  console.log('[DEBUG openWuxieRound] trick=', g.pending.trick, 'asking=', asking, typeof asking, 'exclude=', g.pending.exclude, 'depth=', g.pending.depth);
  const verb = g.pending.depth>0 ? '反制' : '使用';
  g.log=pushLog(g.log, '询问 '+g.players[asking].name+' 是否'+verb+'【无懈可击】…');
}
// finishWuxieRound: 一轮问完无人再出(或问不到人)时收尾。depth 奇数=原锦囊/该 AOE 目标作废,
// 偶数(含0,从未被无懈或被反制回来)=正常生效。ctx==='aoe' 时走群体锦囊自己的推进函数。
function finishWuxieRound(g){
  const info={trick:g.pending.trick, from:g.pending.from, to:g.pending.to, card:g.pending.card, seatB:g.pending.seatB, pool:g.pending.pool};
  const blocked = (g.pending.depth % 2)===1;
  if(g.pending.ctx==='aoe'){
    if(blocked){ aoeAdvance(g, info.to); } else { startAoeRespond(g, info.to); }
  } else {
    if(blocked){
      // 延时锦囊的物理牌在 playCard 那步是 noDiscard(没进弃牌堆);被无懈挡下=放置失败,这里补进弃牌堆
      // (虚拟牌如徐晃【断粮】用 discardOrVanish 直接消失,不进弃牌堆重新流通)。
      // 普通锦囊 info.card 恒为 undefined,这条判断对它们是无操作(它们的牌在 playCard 时已经进了弃牌堆)。
      if(info.card) discardOrVanish(g, info.card);
      // 五谷丰登被无懈:亮出的公共池是真实牌(不是虚拟牌),整体弃入弃牌堆,谁都拿不到
      if(info.pool && info.pool.length) g.discard.push(...info.pool);
      g.pending=null; g.phase='play';
    } else {
      resolveTrick(g, info);
    }
  }
}
// resolveTrick: 锦囊真正生效。决斗 -> 进入 duel 弃杀;顺手/拆桥 -> 作用于"手牌+装备",
// 有多种可拿对象时开"选牌"子阶段交使用者选,唯一对象则直接结算,全空则无效果。
function resolveTrick(g, info){
  const tgt=g.players[info.to];
  if(info.trick==='决斗'){
    g.pending={type:'duel', from:info.from, to:info.to, active:info.to};
    g.phase='duel';
    g.log=pushLog(g.log, '【决斗】开始,'+tgt.name+' 先出杀');
    return; // duel 流程自身不再触发无懈
  }
  if(info.trick==='无中生有'){
    drawN(g, info.from, 2);
    g.pending=null; g.phase='play';
    g.log=pushLog(g.log, g.players[info.from].name+' 【无中生有】生效,摸两张牌');
    return;
  }
  if(info.trick==='桃园结义'){
    // 对所有存活角色生效(含使用者自己);已满血的人跳过,不溢出、不报错。
    g.players.forEach(p=>{ if(p && p.alive && p.hp<p.maxHp) p.hp++; });
    g.pending=null; g.phase='play';
    g.log=pushLog(g.log, g.players[info.from].name+' 【桃园结义】生效,所有存活角色回复1点体力');
    return;
  }
  if(info.trick==='五谷丰登'){
    // 挑选顺序:从发起者起,按存活玩家环形顺序转一整圈(此刻的存活人数可能已和亮牌时不同,
    // 若无懈询问期间有人阵亡,顺序就按现在的存活玩家算——多出的牌在挑完一圈后兜底弃入弃牌堆,
    // 不追求"重新分配"这种复杂规则,只保证不会卡死)。
    if(!info.pool || info.pool.length===0){ g.pending=null; g.phase='play'; return; }
    const order=[info.from];
    let s=info.from;
    for(let k=1;k<aliveCount(g);k++){ s=nextAlive(g,s); if(s===info.from) break; order.push(s); }
    g.pending={type:'wugu', from:info.from, pool:info.pool.slice(), order, idx:0};
    g.phase='wugu';
    g.log=pushLog(g.log, '【五谷丰登】开始,从 '+g.players[info.from].name+' 起依次挑选');
    return;
  }
  if(info.trick==='借刀杀人'){
    const A=g.players[info.to], B=g.players[info.seatB];
    // 无懈询问期间状态可能变化(A 阵亡/武器没了/B 阵亡):安全回 play,不做任何事,防软锁
    if(!A || !A.alive || !A.equips.weapon || !B || !B.alive){
      g.pending=null; g.phase='play';
      g.log=pushLog(g.log, '【借刀杀人】目标已失效,无事发生');
      return;
    }
    g.pending={type:'jiedaoChoice', from:info.from, seatA:info.to, seatB:info.seatB};
    g.phase='jiedaoChoice';
    g.log=pushLog(g.log, A.name+' 请选择:对 '+B.name+' 使用【杀】,或弃置武器【'+A.equips.weapon.name+'】…');
    return;
  }
  if(DELAY_TRICKS[info.trick]){
    // 放置未被无懈挡下:延时锦囊的物理牌(info.card)进目标判定区,不进弃牌堆,不立即生效——
    // 等目标下次回合开始时,resolveDelayTricks 才会翻判定、调具体牌的 effect、决定去向。
    tgt.delays = tgt.delays || [];
    tgt.delays.push(info.card);
    g.pending=null; g.phase='play';
    g.log=pushLog(g.log, tgt.name+' 的判定区放置了【'+info.trick+'】');
    return;
  }
  // 顺手/拆桥:目标手牌(隐藏,整体算1个"随机手牌"选项) + 每件已装备(公开,各1个具体选项)
  if(!tgt || !tgt.alive){ g.pending=null; g.phase='play'; return; }
  const handCount=(tgt.hand||[]).length;
  const equipSlots=EQUIP_SLOTS.filter(s=>tgt.equips[s]);
  const optCount=(handCount>0?1:0)+equipSlots.length;
  if(optCount===0){
    g.log=pushLog(g.log, tgt.name+' 没有手牌和装备,【'+info.trick+'】无效果');
    g.pending=null; g.phase='play'; return;
  }
  if(optCount===1){
    // 唯一选择:免弹窗直接结算
    if(handCount>0) applyTrickOnHand(g, info); else applyTrickOnEquip(g, info, equipSlots[0]);
    g.pending=null; g.phase='play'; return;
  }
  // 多个可选:开使用者选牌子阶段(只有 from 能操作)
  g.pending={type:'pick', trick:info.trick, from:info.from, to:info.to};
  g.phase='pick';
  g.log=pushLog(g.log, '等待 '+g.players[info.from].name+' 选择对 '+tgt.name+' 拿/拆哪张牌…');
}
// applyTrickOnHand: 随机拿/弃目标一张手牌。手牌是隐藏信息 -> 日志不写牌名。
function applyTrickOnHand(g, info){
  const me=g.players[info.from], tgt=g.players[info.to];
  const j=Math.floor(Math.random()*tgt.hand.length);
  const card=tgt.hand.splice(j,1)[0];
  if(info.trick==='顺手牵羊'){ me.hand.push(card); g.log=pushLog(g.log, me.name+' 从 '+tgt.name+' 拿走一张手牌'); }
  else { g.discard.push(card); g.log=pushLog(g.log, me.name+' 弃掉 '+tgt.name+' 一张手牌'); }
}
// applyTrickOnEquip: 拿/拆目标某槽装备。装备是公开信息 -> 日志写明牌名。顺手获得的装备进使用者手牌。
function applyTrickOnEquip(g, info, slot){
  const me=g.players[info.from], tgt=g.players[info.to];
  const card=tgt.equips[slot]; if(!card) return;
  tgt.equips[slot]=null;
  if(info.trick==='顺手牵羊'){ me.hand.push(card); g.log=pushLog(g.log, me.name+' 顺走 '+tgt.name+' 的装备【'+card.name+'】'); }
  else { g.discard.push(card); g.log=pushLog(g.log, me.name+' 拆掉 '+tgt.name+' 的装备【'+card.name+'】'); }
  // 失主(info.to)的装备离开装备区 → 触发失去装备钩子(如孙尚香【枭姬】)。顺手/拆桥单次仅动一槽,恒失去 1 张。
  triggerHook(g, info.to, 'onLoseEquip', { count:1 });
}
// pickResolve: 选牌子阶段结算。choice='hand' 或槽名。仅使用者可操作;失效项(手牌已空/槽已空)安全回 play 防软锁。
function pickResolve(choice){
  tx(g=>{
    if(g.phase!=='pick'||!g.pending||g.pending.type!=='pick'||g.pending.from!==mySeat) return g;
    const info={trick:g.pending.trick, from:g.pending.from, to:g.pending.to};
    const tgt=g.players[info.to];
    if(!tgt || !tgt.alive){ g.pending=null; g.phase='play'; return g; }
    if(choice==='hand'){
      if((tgt.hand||[]).length===0){ g.pending=null; g.phase='play'; return g; } // 失效兜底
      applyTrickOnHand(g, info);
    } else {
      if(!EQUIP_SLOTS.includes(choice) || !tgt.equips[choice]){ g.pending=null; g.phase='play'; return g; } // 失效兜底
      applyTrickOnEquip(g, info, choice);
    }
    g.pending=null; g.phase='play';
    return g;
  });
}
// wuguPick: 五谷丰登挑选。仅当前轮到的人(order[idx])可操作;poolIdx 校验后从公共池移除、
// 收入挑选者手牌;idx 推进到下一个人,挑完一整圈(idx===order.length)则收尾——若池里还有剩牌
// (阵亡导致 order 比 pool 短的边界),兜底弃入弃牌堆,不做复杂的重新分配,只保证不卡死。
function wuguPick(poolIdx){
  tx(g=>{
    if(g.phase!=='wugu'||!g.pending||g.pending.type!=='wugu') return g;
    const { order, idx, pool } = g.pending;
    if(order[idx]!==mySeat) return g;
    const card = pool[poolIdx];
    if(!card) return g;
    const me=g.players[mySeat];
    pool.splice(poolIdx,1);
    me.hand.push(card);
    g.log=pushLog(g.log, me.name+' 从【五谷丰登】挑选了一张牌');
    g.pending.idx = idx+1;
    if(g.pending.idx>=order.length){
      if(pool.length) g.discard.push(...pool); // 兜底:阵亡边界导致池未分完的剩牌
      g.pending=null; g.phase='play';
      g.log=pushLog(g.log, '【五谷丰登】结算完毕');
    }
    return g;
  });
}
// respondWuxie: 仅当前被询问者(pending.asking)可响应。
// 出且确有无懈 -> depth++、exclude=自己,开新一轮反制窗口(openWuxieRound,可不限层数继续下去);
// 不出 -> 指针移到下一存活玩家,问完一圈(绕回 exclude)则收尾(finishWuxieRound,按 depth 奇偶判定)。
// 点"出"但其实没无懈的本地提示在按钮 onclick 里处理,不进 tx,避免改共享状态/泄露手牌。
function respondWuxie(useWuxie){
  tx(g=>{
    if(g.phase!=='wuxie'||!g.pending||g.pending.type!=='wuxie') return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || g.pending.asking!==mySeat) return g;
    if(useWuxie){
      const idx=me.hand.findIndex(c=>c.name==='无懈可击');
      if(idx<0) return g; // 没牌:状态不变,仍停在本人这一轮(界面按钮保留)
      g.discard.push(me.hand.splice(idx,1)[0]);
      // depth===0(反制原锦囊)措辞不同于 depth>=1(反制上一次无懈可击)
      const target = g.pending.depth>0 ? g.players[g.pending.exclude].name+' 的【无懈可击】' : '对 '+g.players[g.pending.to].name+' 的【'+g.pending.trick+'】';
      g.log=pushLog(g.log, me.name+' 打出【无懈可击】,抵消了'+target);
      g.pending.depth++;
      g.pending.exclude=mySeat;
      openWuxieRound(g);
      return g;
    }
    // 不出:指针推进到下一个存活玩家;绕回 exclude 即这一轮问完一圈 -> 收尾
    g.log=pushLog(g.log, me.name+'：不出');
    const nxt=nextAskee(g, g.pending.exclude, mySeat);
    if(nxt===null){
      finishWuxieRound(g);
    } else {
      g.pending.asking=nxt;
      const verb = g.pending.depth>0 ? '反制' : '使用';
      g.log=pushLog(g.log, '询问 '+g.players[nxt].name+' 是否'+verb+'【无懈可击】…');
    }
    return g;
  });
}

// ===== 群体锦囊：南蛮入侵(出杀)/ 万箭齐发(出闪),对使用者外所有存活角色逐个结算 =====
// 出牌阶段使用,无需选目标。
// aoeAdvance: 推进到 prevSeat 之后的下一个目标;问完(绕回 from)则结束整个群体结算回到 play。
// 每次都整体重建 g.pending,避免上一子阶段(尤其 asking)字段残留。
function aoeAdvance(g, prevSeat){
  const from=g.aoe.from;
  const next=nextAskee(g, from, prevSeat);
  if(next===null){
    g.aoe=null; g.pending=null; g.phase='play';
    g.log=pushLog(g.log, '【群体锦囊】结算完毕');
    return;
  }
  // 对该目标开启无懈询问子阶段(exclude/depth 初始化,交给 openWuxieRound 统一处理)
  g.pending={type:'wuxie', ctx:'aoe', trick:g.aoe.trick, from, to:next, exclude:from, depth:0};
  g.phase='wuxie';
  g.log=pushLog(g.log, '结算对 '+g.players[next].name+' 的【'+g.aoe.trick+'】…');
  openWuxieRound(g);
}
// startAoeRespond: 无人无懈后,要求当前目标打出 杀/闪。整体重建 pending。
function startAoeRespond(g, target){
  // 八卦阵:仅当需要出【闪】(万箭齐发)时先判定,红=视为出闪 → 免这一箭,推进下一目标(与打出闪同一条路)
  if(g.aoe.need==='闪'){
    const r=tryBagua(g, target, {type:'aoe', target});
    if(r==='pending') return; // 鬼才改判进行中,收尾延后到 finishGuicai
    if(r){
      g.log=pushLog(g.log, g.players[target].name+' 以【八卦阵】抵消【'+g.aoe.trick+'】');
      aoeAdvance(g, target);
      return;
    }
  }
  g.pending={type:'aoeResp', from:g.aoe.from, to:target, need:g.aoe.need};
  g.phase='aoeResp';
  g.log=pushLog(g.log, '要求 '+g.players[target].name+' 打出【'+g.aoe.need+'】');
}
// aoeRespond: 仅 pending.to 可响应;出 need 牌则抵消,否则受1点伤害(可能阵亡)。出杀不碰 shaUsed。
function aoeRespond(useCard){
  tx(g=>{
    if(g.phase!=='aoeResp'||!g.pending||g.pending.type!=='aoeResp'||!g.aoe) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || g.pending.to!==mySeat) return g;
    const need=g.pending.need;
    if(useCard){
      const idx=findUsableAs(me.hand,me,need); // 龙胆:杀/闪可互转,优先用本名牌
      if(idx<0) return g; // 没牌:界面按钮保留,等其改点"不出"
      const card=me.hand.splice(idx,1)[0]; g.discard.push(card);
      const label = card.name===need ? '打出【'+need+'】' : '打出【'+card.name+'】当【'+need+'】';
      g.log=pushLog(g.log, me.name+' '+label+',抵消【'+g.aoe.trick+'】');
      aoeAdvance(g, mySeat);
      return g;
    }
    // 不出:受到1点伤害
    const dying = dealDamage(g, mySeat, 1, g.pending.from, '未打出【'+need+'】', 'aoe');
    if(dying) return g; // 濒死流程接管,后续(aoeAdvance)延后到 finishDying 处理
    if(checkWin(g)) return g;
    aoeAdvance(g, mySeat); // 未结束才推进到下一目标
    return g;
  });
}

// respondShan: 出闪响应。吕布【无双】(锁定技):攻击者是吕布时,needed=2——打出一张闪不够,
// g.pending.shanCount 记差几张,留在 respond 阶段原样再问一次(按钮/阶段都不变,只是 hint
// 文案会提示"还差几张");不选择继续出闪就按原逻辑直接受伤,已打出的闪不退回、只扣1点血。
function respondShan(useShan){
  tx(g=>{
    if(g.phase!=='respond'||!g.pending||g.pending.to!==mySeat) return g;
    const me=g.players[mySeat]; const attacker=g.players[g.pending.from];
    const needed = hasCap(attacker,'wushuang') ? 2 : 1;
    if(useShan){
      if(g.pending.noShan) return g; // 马超【铁骑】判红:此杀不可被闪抵消,服务端兜底(UI 本就不该渲染这个按钮)
      const idx=findUsableAs(me.hand,me,'闪'); // 龙胆:杀可当闪,优先用本名闪
      if(idx<0) return g;
      const card=me.hand.splice(idx,1)[0]; g.discard.push(card);
      const played=(g.pending.shanCount||0)+1;
      g.log=pushLog(g.log, me.name+' 打出'+(card.name==='闪'?'【闪】':'【'+card.name+'】当【闪】')+(needed>1?'（'+played+'/'+needed+'）':'抵消'));
      if(played<needed){ g.pending.shanCount=played; return g; } // 吕布【无双】:还不够,留在原地再问一次
    } else {
      const dying = dealDamage(g, mySeat, 1, g.pending.from, '不闪', 'sha');
      if(dying) return g; // 濒死流程接管,后续(pending清空/checkWin/phase=play)延后到 finishDying 处理
      // 麒麟弓:杀造成实际伤害且目标存活 → 弃目标坐骑;两匹时开选马子阶段(此处提前返回,交给 qilinResolve,不做收尾)
      if(maybeStartQilin(g, g.pending.from, mySeat)) return g;
    }
    g.pending=null;
    if(checkWin(g)) return g;
    g.phase='play'; // attacker continues play phase
    return g;
  });
}
function endPlay(){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    g.phase='discard';
    return g;
  });
}
function discardCard(cardIdx){
  tx(g=>{
    if(g.phase!=='discard'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(me.hand.length<=me.hp) return g;
    const card=me.hand.splice(cardIdx,1)[0]; g.discard.push(card);
    g.log=pushLog(g.log, me.name+' 弃置一张牌');
    return g;
  });
}
// 吕蒙【克己】(锁定技):本回合未主动出过杀(!shaUsed)则可跳过弃牌阶段。shaUsed 只被主动出杀置真(被动出杀不碰)。
function canSkipDiscard(g, seat){
  const p=g.players[seat];
  return !!(p && hasCap(p,'keji') && !g.shaUsed);
}
function endTurn(){
  tx(g=>{
    if(g.phase!=='discard'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(me.hand.length>me.hp && !canSkipDiscard(g, mySeat)) return g; // 手牌超上限必须先弃;克己满足则放行
    // 乐进【骁果】只在"正常走完弃牌阶段、即将结束回合"这里触发,不影响其它切回合路径
    // (决斗/濒死里回合玩家中途阵亡换人——那个人根本没走到结束阶段,规则本身就不该触发骁果)。
    advanceXiaoguo(g, mySeat, mySeat);
    return g;
  });
}
// ===== 乐进【骁果】:其他角色的结束阶段,乐进可以弃基本牌发动,让该角色弃装备(乐进摸牌)或受伤 =====
// nextXiaoguoAsker: 从 current 的下家起,按座位顺序找下一个"有资格发动骁果"的候选人——
// 存活 + hasCap(p,'xiaoguo') + 手牌里有基本牌。绕回 endingSeat(即将结束回合的人,永远不会
// 被当成候选人,天然排除"乐进对自己回合结束触发")即问完一圈,返回 null。
function nextXiaoguoAsker(g, endingSeat, current){
  const n=g.players.length;
  for(let k=1;k<=n;k++){
    const s=(current+k)%n;
    if(s===endingSeat) return null;
    const p=g.players[s];
    if(p && p.alive && hasCap(p,'xiaoguo') && (p.hand||[]).some(c=>BASIC_CARDS.includes(c.name))) return s;
  }
  return null;
}
// advanceXiaoguo: (重新)找下一个有资格的候选人问;问完(或从一开始就没人有资格)则真正切换回合。
// 每个候选人发动或不发动之后都会调这个函数继续找下一个,直到问完一圈——理论上支持多个乐进都发动。
function advanceXiaoguo(g, endingSeat, current){
  const asker=nextXiaoguoAsker(g, endingSeat, current);
  if(asker===null){ startTurn(g, nextAlive(g, endingSeat)); return; }
  g.pending={type:'xiaoguo', endingSeat, asking:asker};
  g.phase='xiaoguo';
  g.log=pushLog(g.log, '结束阶段:询问 '+g.players[asker].name+' 是否发动【骁果】…');
}
// respondXiaoguo: 仅当前被问的人(pending.asking)可响应。不发动:推进到下一个候选人;
// 发动:弃一张基本牌(校验 BASIC_CARDS),交给目标(endingSeat)二选一。
function respondXiaoguo(activate, cardIdx){
  tx(g=>{
    if(g.phase!=='xiaoguo'||!g.pending||g.pending.type!=='xiaoguo'||g.pending.asking!==mySeat) return g;
    const endingSeat=g.pending.endingSeat;
    if(!activate){
      advanceXiaoguo(g, endingSeat, mySeat);
      return g;
    }
    const me=g.players[mySeat];
    const card=me.hand[cardIdx];
    if(!card || !BASIC_CARDS.includes(card.name)) return g; // 不是基本牌:不生效,状态不变
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    g.log=pushLog(g.log, me.name+' 弃置一张【'+card.name+'】,发动【骁果】,询问 '+g.players[endingSeat].name+' 弃装备或受到1点伤害…');
    g.pending={type:'xiaoguoChoice', from:mySeat, endingSeat, to:endingSeat};
    g.phase='xiaoguoChoice';
    return g;
  });
}
// respondXiaoguoChoice: 仅目标(pending.to,即 endingSeat 本人)可响应。choice 是装备槽名
// (EQUIP_SLOTS 之一)= 弃该装备、乐进摸一张;choice==='damage' = 受到乐进 1 点伤害
// (可能连锁触发濒死,见 finishDying 的 resume.type==='xiaoguo' 分支)。
function respondXiaoguoChoice(choice){
  tx(g=>{
    if(g.phase!=='xiaoguoChoice'||!g.pending||g.pending.type!=='xiaoguoChoice'||g.pending.to!==mySeat) return g;
    const from=g.pending.from, endingSeat=g.pending.endingSeat;
    const target=g.players[endingSeat], asker=g.players[from];
    if(choice==='damage'){
      const dying=dealDamage(g, endingSeat, 1, from, '【骁果】', 'xiaoguo');
      if(dying){ g.pending.resume={type:'xiaoguo', endingSeat, lastAsker:from}; return g; }
      g.pending=null;
      if(checkWin(g)) return g;
      advanceXiaoguo(g, endingSeat, from);
      return g;
    }
    if(!EQUIP_SLOTS.includes(choice) || !target.equips[choice]) return g; // 非法/槽已空
    const card=target.equips[choice];
    target.equips[choice]=null;
    g.discard.push(card);
    g.log=pushLog(g.log, target.name+' 弃置装备【'+card.name+'】,'+asker.name+' 摸一张牌');
    triggerHook(g, endingSeat, 'onLoseEquip', {count:1});
    drawN(g, from, 1);
    g.pending=null;
    advanceXiaoguo(g, endingSeat, from);
    return g;
  });
}
// startTurn: 统一的"切到某人回合开始"入口(endTurn 正常换人、决斗/濒死里回合玩家阵亡换人 都走这里)。
// 顺序:先声明轮到谁,再结算判定区(回合开始的判定阶段,在摸牌之前),最后进摸牌阶段。
function startTurn(g, seat){
  g.turn=seat; g.shaUsed=false; g.duanliangUsed=false; g.qiaobianUsed=false;
  g.log=pushLog(g.log, '轮到 '+g.players[seat].name);
  continueDelayResolution(g, seat);
}
// enterDrawPhase: 回合开始判定阶段结束、即将进入摸牌阶段前的统一入口(startTurn 正常路径、
// finishDying 的 delay-resume 分支都走这里,别各自重复判断)。
// 兵粮寸断的 g.skipDraw 在这里消费:为真则直接跳过摸牌阶段进 play(不摸牌)。
// 边界:若同一玩家判定区里兵粮寸断(跳摸牌)和乐不思蜀(跳出牌)同时命中——
// skipDraw 一旦跳过 'draw' 阶段,doDraw 就永远不会被调用,乐不思蜀的 skipPlay
// 会失去消费的机会(变成悬空标志,污染到下一回合)。所以这里一并检查 skipPlay:
// 两者都命中时直接跳到 discard,两个标志同时清零,不留残留。
function enterDrawPhase(g){
  if(g.skipDraw){
    g.skipDraw=false;
    g.log=pushLog(g.log, g.players[g.turn].name+' 因【兵粮寸断】跳过摸牌阶段');
    if(g.skipPlay){
      g.skipPlay=false;
      g.log=pushLog(g.log, g.players[g.turn].name+' 因【乐不思蜀】跳过出牌阶段');
      g.phase='discard';
    } else {
      g.phase='play';
    }
  } else {
    g.phase='draw';
  }
}
// resolveDelayTricks: 按放置顺序(数组顺序,先放先判——真实规则里玩家可自选顺序,这里简化成固定顺序)
// 结算判定区里的延时锦囊,逐张调用 processOneDelayCard;返回 'pending'(某张牌挂起了,可能是鬼才
// 改判或效果内部触发的濒死,立刻停止处理该玩家判定区剩余的牌,把控制权交还给调用方)或 'done'。
function resolveDelayTricks(g, seat){
  const p=g.players[seat];
  while(p.delays && p.delays.length>0){
    if(processOneDelayCard(g, seat)==='pending') return 'pending';
  }
  return 'done';
}
// processOneDelayCard: 处理 seat 判定区最前面一张牌——judge 翻牌 + 鬼才改判窗口(maybeGuicai)。
// 若无人有资格发起鬼才,直接用原判定牌走 finishDelayCard;否则挂起,返回 'pending'(收尾延后到
// finishGuicai 按 resume.kind==='delayJudge' 接回,用最终判定牌重新调 finishDelayCard)。
function processOneDelayCard(g, seat){
  const p=g.players[seat];
  const card=p.delays[0];
  const spec=DELAY_TRICKS[card.name];
  if(!spec){ p.delays.shift(); g.discard.push(card); return 'done'; } // 未知/尚未实现的延时锦囊,安全丢弃防卡死
  const judgeCard=judge(g);
  p.delays.shift();
  if(maybeGuicai(g, seat, judgeCard, {kind:'delayJudge', seat, trickName:card.name, card})==='pending') return 'pending';
  return finishDelayCard(g, seat, spec, judgeCard, card);
}
// finishDelayCard: 用最终判定牌(可能被鬼才替换过)调用该延时锦囊的 effect,处理去向(传下家/弃置)。
// 返回 'pending'=effect 内部触发了濒死(如闪电致命,牌本身仍正常进弃牌堆,和是否致命无关)、'done'=处理完毕。
function finishDelayCard(g, seat, spec, finalCard, card){
  const result=spec.effect(g, seat, finalCard, card);
  if(typeof result==='number' && g.players[result]){
    g.players[result].delays = g.players[result].delays || [];
    g.players[result].delays.push(card);
    g.log=pushLog(g.log, '【'+card.name+'】传给了 '+g.players[result].name);
  } else {
    discardOrVanish(g, card);
  }
  return result==='pending' ? 'pending' : 'done';
}
// discardOrVanish: 延时锦囊的牌"离场"时的统一去向——真实牌进弃牌堆;虚拟牌(card.virtual,
// 如徐晃【断粮】"视为使用一张兵粮寸断"临时构造的牌)用完即焚,直接消失、不进弃牌堆,
// 否则会被 ensureDeck 当真牌重新洗回牌堆,凭空多出一张不在 buildDeck 统计里的牌、污染牌堆构成。
function discardOrVanish(g, card){
  if(!card.virtual) g.discard.push(card);
}
// continueDelayResolution: resolveDelayTricks(g,seat) 结果的统一处理——startTurn、finishDying 的
// resume.type==='delay' 分支、finishGuicai 的 resume.kind==='delayJudge' 分支三处共用。
// 'pending' 时:若新挂起是濒死(g.pending.type==='dying'),它的 resume 只有 {type:'delay'}(因为
// dealDamage/startDying 只知道 srcType 字符串,不知道 seat),这里补上 seat;若新挂起是鬼才
// (g.pending.type==='guicai'),它的 resume 在 maybeGuicai 里已经自带完整信息,绝不能覆盖。
// 'done' 时统一走 enterDrawPhase,进入(或跳过)摸牌阶段。
function continueDelayResolution(g, seat){
  if(resolveDelayTricks(g, seat)==='pending'){
    if(g.pending.type==='dying') g.pending.resume={type:'delay', seat};
    return;
  }
  continueTurnStart(g, seat);
}
// ===== 甄姬【洛神】:回合开始阶段(判定区处理完毕之后、摸牌之前)甄姬自己选择要不要发动的循环判定 =====
// continueTurnStart: 判定区处理完毕后的下一步——轮到的人若有洛神,问是否发动(可连续判定);
// 没有则直接进摸牌阶段。startTurn/finishDying 的 delay 分支/finishGuicai 的 delayJudge 分支
// 都经 continueDelayResolution 走到这里,不用各自重复判断。
function continueTurnStart(g, seat){
  if(hasCap(g.players[seat],'luoshen')){
    g.pending={type:'luoshen', seat};
    g.phase='luoshen';
    g.log=pushLog(g.log, g.players[seat].name+' 是否发动【洛神】进行判定…');
    return;
  }
  enterDrawPhase(g);
}
// respondLuoshen: 仅 pending.seat 本人可响应。不发动:直接进摸牌阶段;发动:judge() 翻牌
// (可被鬼才改判,和其它判定场景同一套 maybeGuicai),结果延后到 finishLuoshenJudge 处理。
function respondLuoshen(activate){
  tx(g=>{
    if(g.phase!=='luoshen'||!g.pending||g.pending.type!=='luoshen'||g.pending.seat!==mySeat) return g;
    const seat=mySeat;
    if(!activate){
      g.log=pushLog(g.log, g.players[seat].name+'：不再发动【洛神】');
      enterDrawPhase(g);
      return g;
    }
    const card=judge(g);
    if(!card){ enterDrawPhase(g); return g; } // 无牌可判,视为发动失败,直接进摸牌阶段
    if(maybeGuicai(g, seat, card, {kind:'luoshenJudge', seat})==='pending') return g;
    finishLuoshenJudge(g, seat, card);
    return g;
  });
}
// finishLuoshenJudge: 洛神判定结算(不管是否被鬼才改判过)。红色=判定失败,牌进弃牌堆,洛神结束;
// 黑色=判定牌归玩家所有——judge(g) 已经把牌推进了 g.discard,这里要把它弹出来改放进手牌,
// 不能"弃牌堆+手牌各一份"。留在同一个 'luoshen' 阶段,再问一次要不要继续发动(循环判定)。
function finishLuoshenJudge(g, seat, card){
  const p=g.players[seat];
  if(isRed(card)){
    g.log=pushLog(g.log, p.name+' 发动【洛神】,判定为红,洛神结束');
    enterDrawPhase(g);
  } else {
    const idx=g.discard.lastIndexOf(card);
    if(idx>=0) g.discard.splice(idx,1); // 从弃牌堆移除,改成玩家获得
    p.hand.push(card);
    g.log=pushLog(g.log, p.name+' 发动【洛神】,判定为黑,获得判定牌,可以再次发动');
    g.pending={type:'luoshen', seat};
    g.phase='luoshen';
  }
}
function newGame(){
  tx(g=>{
    g.started=false; g.phase='lobby'; g.pending=null; g.winner=null; g.aoe=null;
    g.deck=[]; g.discard=[];
    g.players.forEach(p=>{
      p.general = randomGeneralId();     // 每局重新随机换将
      p.maxHp = generalMaxHp(p.general); // 异常回退 MAX_HP
      p.hp = p.maxHp; p.hand=[]; p.alive=true; p.dying=false; p.delays=[];
      p.equips = emptyEquips();          // 装备区:每局重置为四槽全空
    });
    g.log=pushLog(g.log,'重置房间,可再次开始');
    return g;
  });
}

function cleanupRoom(){
  if(!confirm('确定要删除本房间数据吗?所有人会回到大厅。')) return;
  if(gameRef) gameRef.off();
  gameRef.remove().then(backToLobby).catch(err=>{
    alert('清理失败: '+err.message);
  });
}
function backToLobby(){
  mySeat = null; selectedCardIdx = null; resetZhangba();
  document.getElementById('game').classList.add('hidden');
  document.getElementById('lobby').classList.remove('hidden');
  document.getElementById('lobbyErr').textContent = '房间已清理,可重新进入。';
}
