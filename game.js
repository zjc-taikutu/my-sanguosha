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
  // 鬼才改判阶段:seat 应是数字座位号,judgeCard 应有 suit/rank,resume.type 应是字符串;任一不对就整体判无效
  if(g.pending && g.pending.type==='guicai'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !d.judgeCard || !d.judgeCard.suit || !d.resume || typeof d.resume.type!=='string'){
      g.pending=null; g.phase='play';
    }
  }
  // 群体锦囊上下文:字段不全则视为无效(全是标量,无空数组问题)
  if(g.aoe && (typeof g.aoe.from!=='number' || !g.aoe.trick || !g.aoe.need)) g.aoe=null;
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
  // 鬼才(简化版:仅"判定的这个人自己"是鬼才拥有者时可改判):有牌可换才值得开一个等待阶段
  if(hasCap(p,'guicai') && (p.hand||[]).length>0){
    startGuicai(g, seat, card, resumeInfo);
    return 'pending';
  }
  return finishBaguaColor(g, card);
}
// finishBaguaColor: 八卦阵判定的红黑结算(独立出来,供 tryBagua 直接判 和 finishGuicai 改判后判 共用)。
function finishBaguaColor(g, card){
  if(isRed(card)){ g.log=pushLog(g.log, '判定为红,视为打出【闪】'); return true; }
  g.log=pushLog(g.log, '判定为黑,【八卦阵】未生效'); return false;
}
// ===== 鬼才(简化版):判定牌亮出后,判定者本人(若是司马懿)可打出一张手牌替换 =====
// 扩展路径(日后要支持"攻击范围内他人的判定"时):把 tryBagua 里"谁可以发起鬼才"的判断
// 从"只查 hasCap(判定者,'guicai')"扩成"判定者自己(优先)+ 其余存活玩家里 hasCap(p,'guicai')
// && canReachSha(g,p座位,判定者座位) 的人",按座位顺序逐个问(复用 nextAskee)。
// startGuicai/respondGuicai/finishGuicai 这套挂起-恢复机制不用改,只改"问谁"的枚举。
function startGuicai(g, seat, judgeCard, resume){
  g.pending={type:'guicai', seat, judgeCard, resume};
  g.phase='guicai';
  g.log=pushLog(g.log, g.players[seat].name+' 判定得到 '+judgeCard.suit+rankText(judgeCard.rank)+',是否发动【鬼才】替换判定牌…');
}
// respondGuicai: 仅 pending.seat 本人可响应。替换:打出一张手牌(移出手牌/进弃牌堆),用它的花色结算;
// 不替换:直接用原判定牌结算。两种情况都调用 finishGuicai 走回原被打断的流程。
function respondGuicai(useReplace, cardIdx){
  tx(g=>{
    if(g.phase!=='guicai'||!g.pending||g.pending.type!=='guicai') return g;
    if(g.pending.seat!==mySeat) return g;
    const me=g.players[mySeat];
    let finalCard=g.pending.judgeCard;
    if(useReplace){
      const card=(me.hand||[])[cardIdx];
      if(!card) return g; // 没这张牌:状态不变(双重保险)
      me.hand.splice(cardIdx,1);
      g.discard.push(card);
      finalCard=card;
      g.log=pushLog(g.log, me.name+' 发动【鬼才】,打出'+card.suit+rankText(card.rank)+' 替换判定牌');
    }
    finishGuicai(g, finalCard);
    return g;
  });
}
// finishGuicai: 鬼才改判解决(不管替换与否)。按 resume.type 接回被 tryBagua 打断的那条流程的尾巴——
// 和 finishDying 按 resume.type 分支接回一样的模式,原调用点的收尾代码原样搬到这里、只是延后执行。
function finishGuicai(g, finalCard){
  const resume=g.pending.resume;
  const red = finishBaguaColor(g, finalCard);
  g.pending=null;
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
function tx(fn){ gameRef.transaction(g => { if(!g) return g; normalize(g); return fn(g) || g; }); }

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
    g.started=true; g.turn=0; g.phase='draw'; g.shaUsed=false; g.pending=null;
    g.log = pushLog(g.log, '游戏开始！轮到 '+g.players[0].name);
    return g;
  });
}
function doDraw(){
  tx(g=>{
    if(g.phase!=='draw'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    const n = 2 + generalCapValue(me,'extraDrawPhase',0); // 基础2张 + extraDrawPhase 额外摸牌(通用数值 seam,当前暂无武将/装备使用)
    drawN(g, mySeat, n);
    g.phase='play';
    g.log=pushLog(g.log, me.name+' 摸了'+n+'张牌');
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
      resolveShaUse(g, me, targetSeat, usedAs);
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
function distance(g, from, to){
  if(from===to) return 0;
  const alive = g.players.map((p,i)=>i).filter(i=>g.players[i] && g.players[i].alive);
  const m = alive.length;
  const pf = alive.indexOf(from), pt = alive.indexOf(to);
  if(pf<0 || pt<0 || m<2) return 1;                       // 兜底(出杀时双方必存活)
  const cw = (((pt-pf)%m)+m)%m;                            // 顺时针步数(只数存活者)
  const base = Math.min(cw, m-cw);                         // 顺/逆取较小
  const d = base + equipDist(g.players[to],'plus1') + equipDist(g.players[from],'minus1');
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
function resolveShaUse(g, me, targetSeat, usedAs){
  g.shaUsed=true; g.pending={from:mySeat,to:targetSeat};
  g.log=pushLog(g.log, me.name+' 对 '+g.players[targetSeat].name+' '+usedAs);
  // 青釭剑:攻击者无视目标防具 → 跳过目标八卦阵判定(八卦阵公开,记一条日志便于阅读)
  if(hasCap(me,'ignoreArmor')){
    if(hasCap(g.players[targetSeat],'bagua')) g.log=pushLog(g.log, me.name+' 的【青釭剑】无视了 '+g.players[targetSeat].name+' 的防具');
    g.phase='respond'; return; // 目标只能正常出闪/受伤
  }
  // 八卦阵:被杀需出闪前先判定,红=视为出闪 → 杀被抵消,攻击者继续出牌(与正常出闪同结果)
  const r=tryBagua(g, targetSeat, {type:'sha', from:mySeat, to:targetSeat});
  if(r==='pending') return; // 鬼才改判进行中,收尾延后到 finishGuicai
  if(r){ g.pending=null; g.phase='play'; return; }
  g.phase='respond'; // 黑/无八卦阵:照常进响应,等目标出闪或受伤
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
    resolveShaUse(g, me, targetSeat, '用两张牌当【杀】(丈八蛇矛)');
    return g;
  });
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
    // 从头 startTurn);被桃救回就继续处理这位玩家判定区剩余的牌(可能再次挂起,机制天然支持连续多张)。
    if(!g.players[resume.seat].alive){
      startTurn(g, nextAlive(g, resume.seat));
    } else if(resolveDelayTricks(g, resume.seat)==='pending'){
      g.pending.resume={type:'delay', seat:resume.seat};
    } else {
      g.phase='draw';
    }
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
function duelResponse(useSha){
  tx(g=>{
    if(g.phase!=='duel'||!g.pending||g.pending.active!==mySeat) return g;
    const me=g.players[mySeat];
    if(useSha){
      const idx=findUsableAs(me.hand,me,'杀'); // 龙胆:闪可当杀,优先用本名杀
      if(idx<0) return g;
      const card=me.hand.splice(idx,1)[0]; g.discard.push(card);
      g.pending.active = (mySeat===g.pending.from)?g.pending.to:g.pending.from;
      g.log=pushLog(g.log, me.name+(card.name==='杀'?' 打出【杀】':' 打出【'+card.name+'】当【杀】'));
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
  // resolveTrick(未被挡下→放进判定区)使用。普通锦囊不传,undefined 对它们是无操作。
  g.pending={type:'wuxie', trick:info.trick, from:info.from, to:info.to, card:info.card, exclude:info.from, depth:0};
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
  const verb = g.pending.depth>0 ? '反制' : '使用';
  g.log=pushLog(g.log, '询问 '+g.players[asking].name+' 是否'+verb+'【无懈可击】…');
}
// finishWuxieRound: 一轮问完无人再出(或问不到人)时收尾。depth 奇数=原锦囊/该 AOE 目标作废,
// 偶数(含0,从未被无懈或被反制回来)=正常生效。ctx==='aoe' 时走群体锦囊自己的推进函数。
function finishWuxieRound(g){
  const info={trick:g.pending.trick, from:g.pending.from, to:g.pending.to, card:g.pending.card};
  const blocked = (g.pending.depth % 2)===1;
  if(g.pending.ctx==='aoe'){
    if(blocked){ aoeAdvance(g, info.to); } else { startAoeRespond(g, info.to); }
  } else {
    if(blocked){
      // 延时锦囊的物理牌在 playCard 那步是 noDiscard(没进弃牌堆);被无懈挡下=放置失败,这里补进弃牌堆。
      // 普通锦囊 info.card 恒为 undefined,这条判断对它们是无操作(它们的牌在 playCard 时已经进了弃牌堆)。
      if(info.card) g.discard.push(info.card);
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

function respondShan(useShan){
  tx(g=>{
    if(g.phase!=='respond'||!g.pending||g.pending.to!==mySeat) return g;
    const me=g.players[mySeat]; const attacker=g.players[g.pending.from];
    if(useShan){
      const idx=findUsableAs(me.hand,me,'闪'); // 龙胆:杀可当闪,优先用本名闪
      if(idx<0) return g;
      const card=me.hand.splice(idx,1)[0]; g.discard.push(card);
      g.log=pushLog(g.log, me.name+(card.name==='闪'?' 使用【闪】抵消':' 使用【'+card.name+'】当【闪】抵消'));
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
    startTurn(g, nextAlive(g, mySeat));
    return g;
  });
}
// startTurn: 统一的"切到某人回合开始"入口(endTurn 正常换人、决斗/濒死里回合玩家阵亡换人 都走这里)。
// 顺序:先声明轮到谁,再结算判定区(回合开始的判定阶段,在摸牌之前),最后进摸牌阶段。
// 注意:判定区里的牌(如闪电)可能造成伤害而挂起濒死流程(resolveDelayTricks 返回 'pending')——
// 这时 phase 已经被 startDying 定成 'dying',这里绝不能再把它覆盖成 'draw',
// 而是记 g.pending.resume={type:'delay',seat},濒死解决后由 finishDying 接回来继续处理剩余的牌。
function startTurn(g, seat){
  g.turn=seat; g.shaUsed=false;
  g.log=pushLog(g.log, '轮到 '+g.players[seat].name);
  if(resolveDelayTricks(g, seat)==='pending'){
    g.pending.resume={type:'delay', seat};
    return;
  }
  g.phase='draw';
}
// resolveDelayTricks: 按放置顺序(数组顺序,先放先判——真实规则里玩家可自选顺序,这里简化成固定顺序)
// 结算判定区里的延时锦囊。地基阶段 DELAY_TRICKS 是空表,循环体不会跑到任何具体效果,只占好位置。
// 判定阶段本身不开无懈窗口(简化,见 CLAUDE.md);effect 返回:数字座位号=传给该玩家,
// 'pending'=这张牌的判定触发了濒死挂起(牌本身仍正常进弃牌堆,和是否致命无关),
// 否则(undefined)=正常作废进弃牌堆。返回 'pending' 时立刻停止处理该玩家判定区剩余的牌,
// 把控制权交还给调用方(startTurn/finishDying),不然会在 phase 已经是 'dying' 时继续瞎跑。
function resolveDelayTricks(g, seat){
  const p=g.players[seat];
  while(p.delays && p.delays.length>0){
    const card=p.delays[0];
    const spec=DELAY_TRICKS[card.name];
    if(!spec){ p.delays.shift(); g.discard.push(card); continue; } // 未知/尚未实现的延时锦囊,安全丢弃防卡死
    const judgeCard=judge(g);
    p.delays.shift();
    const result=spec.effect(g, seat, judgeCard, card);
    if(typeof result==='number' && g.players[result]){
      g.players[result].delays = g.players[result].delays || [];
      g.players[result].delays.push(card);
      g.log=pushLog(g.log, '【'+card.name+'】传给了 '+g.players[result].name);
    } else {
      g.discard.push(card); // 包括 undefined(正常作废)和 'pending'(挂起濒死,牌仍需归入弃牌堆)
    }
    if(result==='pending') return 'pending';
  }
  return 'done';
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
