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
            pending:null, shaUsed:false, roundNum:1, roundSeatsActed:[], lastCardSound:null,
            lastSkillSound:null,
            log:['房间已创建,等待玩家加入'] };
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
  // 日志:元素统一成 {seq,text[,kind,actor,targets]}。老房间/开局初始条目(createRoom 的
  // log:['房间已创建…'])可能是裸字符串,在这里一次性补 seq——保留已有合法 seq、绝不重新编号
  // (seq 必须跨读取稳定,渲染端靠它判断哪些是新日志),只给缺 seq 的项接在当前最大值之后编号。
  // kind/actor/targets 是第二步新增的结构字段(logEvent 产出),原样透传+轻量类型防御——
  // Firebase 吞空 targets 数组、读回来是 undefined,消费端按"无目标"处理即可,不强求恢复空数组。
  // normalize 在读(render→normalize)和写(tx→normalize)两条路径都跑,所以到达渲染端时 g.log
  // 一定已是这套结构;此修正只在客户端内存进行、不写回 Firebase(同既有空数组防御)。
  {
    let maxSeq = 0;
    const keepMeta = (src, dst)=>{
      if(src && typeof src.kind==='string') dst.kind = src.kind;
      if(src && Number.isInteger(src.actor)) dst.actor = src.actor;
      if(src && Array.isArray(src.targets)) dst.targets = src.targets.filter(Number.isInteger);
      return dst;
    };
    g.log = (g.log || []).map(e=>{
      if(e && typeof e==='object' && Number.isInteger(e.seq)){
        if(e.seq>maxSeq) maxSeq=e.seq;
        return keepMeta(e, { seq:e.seq, text: typeof e.text==='string' ? e.text : String(e.text==null?'':e.text) });
      }
      return { seq: ++maxSeq, text: typeof e==='string' ? e : String(e==null?'':e) };
    });
  }
  g.players = g.players || [];
  // 轮次计数:数字/数组防御,Firebase 吞空数组、旧存档可能没有这两个字段
  if(!Number.isInteger(g.roundNum)) g.roundNum=1;
  if(!Array.isArray(g.roundSeatsActed)) g.roundSeatsActed=[];
  // 出牌语音事件:旧存档可能没有这个字段,回退 null(表示"还没有任何一次出牌语音事件")
  if(g.lastCardSound===undefined) g.lastCardSound=null;
  if(g.tableCard===undefined) g.tableCard=null;
  if(!Array.isArray(g.exchangeCards)) g.exchangeCards=[];
  if(g.tableCard && g.tableCard.targets!=null && !Array.isArray(g.tableCard.targets)) g.tableCard.targets=null;
  // 技能发动语音事件:同上,旧存档回退 null
  if(g.lastSkillSound===undefined) g.lastSkillSound=null;
  // 许褚【裸衣】:本回合伤害加成标记。回合开始重置,旧存档缺失回退 false。
  if(typeof g.luoyiActive!=='boolean') g.luoyiActive=false;
  // 开局选将模式:'random'/'pick',开局前是 null,旧存档缺失同样回退 null
  if(g.generalMode===undefined) g.generalMode=null;
  g.players.forEach(p=>{ if(p){ p.hand = p.hand || []; if(typeof p.alive!=='boolean') p.alive=true;
    // 三选一候选:pending 期间是数组,其余时候应为 null;Firebase 吞空数组,缺失回退 null
    if(p.generalChoices===undefined) p.generalChoices=null;
    // 体力上限防御:旧数据/异常路径缺失时回退,避免血条/桃回血读到 undefined
    if(typeof p.maxHp!=='number') p.maxHp = MAX_HP;
    // 装备区防御:Firebase 吞 null 值/空对象,读回来容器会缺失或缺键;补容器 + 补齐四槽(缺的回退 null)
    p.equips = Object.assign(emptyEquips(), p.equips || {});
    // 濒死标记:纯 UI 提示用的布尔标量,和 alive 同款防御
    if(typeof p.dying!=='boolean') p.dying=false;
    if(typeof p.chained!=='boolean') p.chained=false;
    if(typeof p.turnedOver!=='boolean') p.turnedOver=false;
    if(typeof p.nirvanaUsed!=='boolean') p.nirvanaUsed=false;
    if(!Number.isInteger(p.zhengyiTurn)) p.zhengyiTurn=-1;
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
  // 郭嘉【遗计】询问阶段:seat 应是数字座位号且对应玩家存活;任一不对就整体判无效,防止卡死。
  if(g.pending && g.pending.type==='yijiAsk'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
      g.pending=null; g.phase='play';
    }
  }
  // 郭嘉【遗计】分配阶段:seat 同上;cards 应是非空数组(牌堆不足2张时会是1张,长度1或2皆合法)。
  if(g.pending && g.pending.type==='yijiAssign'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive || !Array.isArray(d.cards) || d.cards.length===0){
      g.pending=null; g.phase='play';
    }
  }
  // 方天画戟排队(g.fangtianQueue):非活跃时应为 null(和 g.pending/g.aoe 同款标量哨兵)。
  // 活跃时 from/idx 应是数字、targets 应是非空数组——任一不对就整体判无效清空,防止卡死。
  if(g.fangtianQueue===undefined) g.fangtianQueue=null;
  if(g.fangtianQueue){
    const q=g.fangtianQueue;
    if(typeof q.from!=='number' || typeof q.idx!=='number' || !Array.isArray(q.targets) || q.targets.length===0){
      g.fangtianQueue=null;
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
  // 观星阶段:seat 应是数字座位号且对应玩家存活,cards 应是数组;不满足整体判无效,防止卡死
  if(g.pending && g.pending.type==='guanxingReview'){
    const gp=g.pending.seat;
    if(typeof gp!=='number' || !g.players[gp] || !g.players[gp].alive || !Array.isArray(g.pending.cards)){
      g.pending=null; g.phase='play';
    }
  }
  // 群体锦囊上下文:字段不全则视为无效(全是标量,无空数组问题)
  if(g.aoe && (typeof g.aoe.from!=='number' || !g.aoe.trick || !g.aoe.need)) g.aoe=null;
  // 乐不思蜀:跳过出牌阶段的标志位,和 p.dying 同款防御
  if(typeof g.skipPlay!=='boolean') g.skipPlay=false;
  // 兵粮寸断:跳过摸牌阶段的标志位,和 g.skipPlay 同款防御
  if(typeof g.skipDraw!=='boolean') g.skipDraw=false;
  // 张郃【巧变】完整版:跳过弃牌阶段的标志位,和 g.skipDraw/g.skipPlay 同款防御
  if(typeof g.skipDiscard!=='boolean') g.skipDiscard=false;
  // 徐晃【断粮】:出牌阶段限一次的标志位,和 g.shaUsed 同款防御
  // 吕蒙【克己】辅助标志:本回合是否在决斗中打出过杀,和 g.shaUsed 同款防御
  if(typeof g.shaPlayedInDuel!=='boolean') g.shaPlayedInDuel=false;
  if(typeof g.duanliangUsed!=='boolean') g.duanliangUsed=false;
  // 孙权【制衡】:出牌阶段限一次的标志位,和 g.duanliangUsed 同款防御
  if(typeof g.zhihengUsed!=='boolean') g.zhihengUsed=false;
  // 刘备【仁德】:统计当前出牌阶段已交出的牌数,到第2张时强制回复一次
  if(!Number.isInteger(g.renDeCount)) g.renDeCount=0;
  // 华佗【青囊】:出牌阶段限一次
  if(typeof g.qingNangUsed!=='boolean') g.qingNangUsed=false;
  // 荀彧【驱虎】:出牌阶段限一次
  if(typeof g.quHuUsed!=='boolean') g.quHuUsed=false;
  // 貂蝉【离间】:出牌阶段限一次
  if(typeof g.liJianUsed!=='boolean') g.liJianUsed=false;
  // 周瑜【反间】:出牌阶段限一次
  if(typeof g.fanJianUsed!=='boolean') g.fanJianUsed=false;
  // 孔融【礼让】:每轮限一次 + 当前礼让对象/弃牌阶段记录
  if(!Number.isInteger(g.liRangRound)) g.liRangRound=0;
  if(!g.liRangRecord || typeof g.liRangRecord!=='object') g.liRangRecord=null;
  if(g.liRangRecord){
    if(!Array.isArray(g.liRangRecord.discarded)) g.liRangRecord.discarded=[];
    if(typeof g.liRangRecord.round!=='number' || typeof g.liRangRecord.from!=='number' || typeof g.liRangRecord.to!=='number'){
      g.liRangRecord=null;
    }
  }
  // quhuRespond(拼点阶段)和 quhuDamageChoice(拼点赢后选伤害目标)结构不同,不能共用同一份校验——
  // 前者带 selfCard(拼点用的那张牌),后者带 targets(可选的伤害目标座位数组),没有 selfCard。
  // 曾经两者共用一段校验、都要求 selfCard 非空,quhuDamageChoice 从来不带这个字段,
  // 导致刚设置好 pending 就被下一次 normalize 判定"无效"直接清空、phase 打回 'play'——
  // 真实 bug:拼点赢了之后完全没机会选目标,见 CLAUDE.md 记录。
  if(g.pending && g.pending.type==='quhuRespond'){
    const d=g.pending;
    if(typeof d.seat!=='number' || typeof d.targetSeat!=='number' || !d.selfCard || !g.players[d.seat] || !g.players[d.targetSeat]){
      g.pending=null; g.phase='play';
    }
  }
  if(g.pending && g.pending.type==='quhuDamageChoice'){
    const d=g.pending;
    if(typeof d.seat!=='number' || typeof d.targetSeat!=='number' || !Array.isArray(d.targets) || d.targets.length===0
       || !g.players[d.seat] || !g.players[d.targetSeat] || !d.targets.every(t=>Number.isInteger(t) && g.players[t] && g.players[t].alive)){
      g.pending=null; g.phase='play';
    }
  }
  if(g.pending && g.pending.type==='fanjianSuit'){
    const d=g.pending;
    if(typeof d.seat!=='number' || typeof d.targetSeat!=='number' || !g.players[d.seat] || !g.players[d.targetSeat]){
      g.pending=null; g.phase='play';
    }
  }
  if(g.tiesuoQueue && (!Array.isArray(g.tiesuoQueue.targets) || !Number.isInteger(g.tiesuoQueue.idx) || typeof g.tiesuoQueue.from!=='number')){
    g.tiesuoQueue=null;
  }
  if(g.pending && g.pending.type==='jiemingAsk'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !Number.isInteger(d.remaining) || d.remaining<=0 || !g.players[d.seat] || !g.players[d.seat].alive){
      g.pending=null; g.phase='play';
    }
  }
  if(g.pending && g.pending.type==='liuli'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || !g.players[d.from] || !g.players[d.to]){
      g.pending=null; g.phase='play';
    }
  }
  if(g.pending && g.pending.type==='tianxiang'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive || !Array.isArray(d.targets) || d.targets.length===0){
      g.pending=null; g.phase='play';
    }
  }
  if(g.pending && g.pending.type==='biyue'){
    const d=g.pending;
    if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
      g.pending=null; g.phase='discard';
    }
  }
  if(g.pending && g.pending.type==='lirangAsk'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || !g.players[d.from] || !g.players[d.to] || !g.players[d.from].alive || !g.players[d.to].alive){
      g.pending=null; g.phase='draw';
    }
  }
  if(g.pending && g.pending.type==='lirangRecover'){
    const d=g.pending;
    if(typeof d.from!=='number' || typeof d.to!=='number' || !Array.isArray(d.cards) || !g.players[d.from] || !g.players[d.to]){
      g.pending=null; g.phase='discard';
    }
  }
  if(g.pending && g.pending.type==='zhengyi'){
    const d=g.pending;
    if(typeof d.seat!=='number' || typeof d.asking!=='number' || !g.players[d.seat] || !g.players[d.asking] || !g.players[d.seat].alive || !g.players[d.asking].alive){
      g.pending=null; g.phase='play';
    }
  }
  return g;
}
// logEvent: 追加一条结构化日志事件。ev = {text, kind?, actor?, targets?}:
//   text   —— 给日志面板/toast 显示的文本(本步仍由各调用点手写,措辞不变)
//   kind   —— 事件类型标签('damage'/'sha'/…),渲染端据此判定该不该弹 toast、以及 toast 的强调色,
//             取代原来"从文本里嗅探子串"的脆弱写法。未带 kind 的条目走旧子串判定,行为不变。
//   actor  —— 事件发起者座位号(可空);targets —— 目标座位号数组(可空)。本步只存不读,供第三步取用。
// seq 逻辑与原来一致:从上一条派生自增,跨读取稳定、不受 slice(-40) 长度封顶影响。
function logEvent(log, ev){
  log = (log||[]).slice(-40);
  const last = log.length ? log[log.length-1] : null;
  const lastSeq = (last && typeof last==='object' && Number.isInteger(last.seq)) ? last.seq : 0;
  const text = (ev && typeof ev.text==='string') ? ev.text : String(ev && ev.text!=null ? ev.text : '');
  const entry = { seq: lastSeq+1, text };
  if(ev){
    if(typeof ev.kind==='string') entry.kind = ev.kind;
    if(Number.isInteger(ev.actor)) entry.actor = ev.actor;
    if(Array.isArray(ev.targets)) entry.targets = ev.targets.filter(Number.isInteger);
  }
  log.push(entry);
  return log;
}
// pushLog: 纯文本日志便捷入口,内部就是只带 text 的 logEvent——那 177 个 g.log=pushLog(g.log,'…')
// 调用点一律不动,产出条目没有 kind,渲染端自动回退到"文本子串判定 toast"的旧路径,行为完全不变。
function pushLog(log, msg){
  return logEvent(log, { text: (typeof msg==='string' ? msg : String(msg==null?'':msg)) });
}
// markCardSound: 记录"这次打出/使用了哪张牌"这个语音播放事件,供 render.js 的
// maybePlayCardSound 检测并播放对应语音(assets/audio/{CARD_PINYIN拼音}.mp3)。
// seq 自增而不是只存牌名——"连续两次打出同一张牌名"(比如连续两个人都出杀)如果只比较
// name 文本,后一次会因为文本没变化而被误判成"和上次是同一个事件"从而漏播,seq 保证
// 每次调用都是可识别的独立事件。cardName 传的是"这次使用在游戏规则意义上算作哪张牌"
// (即 actionId/概念上的杀|闪|桃|兵粮寸断 等),不是"手里那张被转化的物理牌"——比如
// 龙胆闪当杀使用,应该播杀的语音,和玩家/其他人听到的"这是一次杀"这个游戏事件一致。
// markCardSound: seat/card 是可选的展示补充信息(座位号、牌面对象)——音效播放只看
// name+seq,不受影响;中央出牌区(g.tableCard)额外用 seat/card 显示"谁打了什么牌",
// 调用点没有现成的 seat/card 就不传,中央区退化为只显示牌名。targets 是可选的目标座位
// 信息(单个座位号或座位号数组,如铁索连环两个目标)——座位高亮用,没有目标的牌(如无中生有、
// 南蛮入侵这类非单目标或本步没能力提供的场景)传 null,单个座位号会被归一化成长度为1的数组。
// markCardSound: 音效/单次展示逻辑不变(g.lastCardSound/g.tableCard 照旧,每次覆盖+按 seq 淡入淡出)。
// 额外判断:调用这一刻如果正处于"多步骤交换"过程中(南蛮入侵/万箭齐发这类群体锦囊 g.aoe 非空,或
// 正在决斗 g.phase==='duel'),把这张牌也追加进 g.exchangeCards 数组——这个数组不设时间上限、
// 不被下一张覆盖,交给 renderTableCard 持续显示,直到交换动作真正结束(aoeAdvance 收尾/
// duelResponse 分出胜负)时才清空。
function markCardSound(g, cardName, seat, card, targets){
  const seq = (g.lastCardSound && g.lastCardSound.seq) ? g.lastCardSound.seq : 0;
  g.lastCardSound = { name: cardName, seq: seq+1 };
  const normTargets = targets==null ? null
    : (Array.isArray(targets) ? targets.filter(Number.isInteger) : (Number.isInteger(targets) ? [targets] : null));
  g.tableCard = { name: cardName, seq: seq+1, seat: (Number.isInteger(seat) ? seat : null), card: card || null, targets: normTargets };
  if(g.aoe || g.phase==='duel'){
    if(!Array.isArray(g.exchangeCards)) g.exchangeCards=[];
    g.exchangeCards.push({ name: cardName, seat: (Number.isInteger(seat) ? seat : null), card: card || null, seq: seq+1 });
  }
}
// markSkillSound: 和 markCardSound 同一模式,独立字段(lastSkillSound),记录"这次真正发动了
// 哪个技能"这个语音播放事件,供 render.js 的 maybePlaySkillSound 检测并播放对应语音
// (assets/audio/{SKILL_PINYIN拼音}.mp3)。只在"确认真的发动/生效"的分支调用,不在"仅仅有
// 资格/被询问是否发动"时调用。
function markSkillSound(g, skillName){
  const seq = (g.lastSkillSound && g.lastSkillSound.seq) ? g.lastSkillSound.seq : 0;
  g.lastSkillSound = { name: skillName, seq: seq+1 };
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
function drawPhaseCount(g, seat){
  return 2 + generalCapValue(g.players[seat],'extraDrawPhase',0);
}
function eligibleLiRangSeat(g, targetSeat){
  if(g.liRangRound===g.roundNum) return null;
  for(let k=1;k<=g.players.length;k++){
    const s=(targetSeat+k)%g.players.length;
    const p=g.players[s];
    if(s!==targetSeat && p && p.alive && hasCap(p,'lirang') && (p.hand||[]).length>=2) return s;
  }
  return null;
}
function finishDrawPhase(g, seat, n){
  drawN(g, seat, n);
  g.log=pushLog(g.log, g.players[seat].name+' 摸了'+n+'张牌');
  // 乐不思蜀/张郃【巧变】:摸牌阶段照常摸牌,只是不给出牌(或弃牌)机会——advancePastPlay
  // 统一判断出牌/弃牌阶段是否被跳过,不在这里各自重复逻辑。
  advancePastPlay(g);
}
function damageAmount(g, sourceSeat, baseAmount, cardType){
  let amount=baseAmount;
  const source=g.players[sourceSeat];
  if(source && g.luoyiActive && sourceSeat===g.turn && hasCap(source,'luoyi') && (cardType==='sha' || cardType==='duel')){
    amount++;
    g.log=pushLog(g.log, source.name+' 【裸衣】生效,此伤害+1');
  }
  return amount;
}
function isTrickCardName(name){
  return !!name && !BASIC_CARDS.includes(name) && !getEquip(name);
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
  return finishBaguaColor(g, seat, card);
}
// finishBaguaColor: 八卦阵判定的红黑结算(独立出来,供 tryBagua 直接判 和 finishGuicai 改判后判 共用)。
function finishBaguaColor(g, seat, card){
  const p = g.players[seat];
  if(isRedForPlayer(p, card)){ g.log=pushLog(g.log, p.name+' 判定为红,视为打出【闪】'); return true; }
  g.log=pushLog(g.log, p.name+' 判定为黑,【八卦阵】未生效'); return false;
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
      markSkillSound(g, '鬼才');
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
  // judgedSeat: 由 maybeGuicai 统一写在 g.pending.seat 上,不管 resume 具体带了哪些字段都始终
  // 正确——kind==='bagua' 的 resume(来自 tryBagua 的 resumeInfo,sha 场景是 {type,from,to,
  // sourceCard}、aoe 场景是 {type,target})都没有 .seat 这个字段,直接读 resume.seat 会是
  // undefined(真实踩过的坑:finishBaguaColor 内部 g.players[undefined] 抛异常,和本次要修的
  // ReferenceError 同一类问题,只是换了个位置)。g.pending.seat 才是所有 kind 都保证存在、
  // 值恒等于判定者座位的字段,必须在 g.pending=null 之前先取出来。
  const judgedSeat=g.pending.seat;
  g.pending=null;
  if(resume.kind==='delayJudge'){
    const result=finishDelayCard(g, resume.seat, DELAY_TRICKS[resume.trickName], finalCard, resume.card);
    if(result==='pending'){
      // 又挂起了(嵌套濒死、嵌套鬼才、或郭嘉【遗计】)。和 continueDelayResolution 的收尾同一套
      // 逻辑,不能省略:若新挂起是濒死或遗计(g.pending.type==='dying'||'yijiAsk'),它的 resume
      // 只有 {type:'delay'}(dealDamage/startDying 不知道 seat是谁,这个信息只有这里——鬼才改判
      // 后重新触发的 finishDelayCard——才知道),这里必须补上 seat,否则接回流程时读 resume.seat
      // 是 undefined,g.players[undefined] 直接抛异常(真实 bug:鬼才替换了延时锦囊的判定牌、
      // 替换后结果致命时才会走到这条分支,此前测试没覆盖到这个组合)。若新挂起是鬼才(嵌套鬼才
      // 改判),它的 resume 已经自带完整信息,绝不能覆盖。
      if(g.pending.type==='dying' || g.pending.type==='yijiAsk') g.pending.resume={type:'delay', seat:resume.seat};
      return;
    }
    continueDelayResolution(g, resume.seat);
    return;
  }
  if(resume.kind==='tieqiJudge'){
    finishTieqiJudge(g, resume.from, resume.to, finalCard, resume.sourceCard);
    return;
  }
  if(resume.kind==='luoshenJudge'){
    finishLuoshenJudge(g, resume.seat, finalCard);
    return;
  }
  // 许褚【裸衣】摸牌阶段询问:seat 应是当前回合玩家且存活。
  if(g.pending && g.pending.type==='luoyiAsk'){
    const d=g.pending;
    if(typeof d.seat!=='number' || d.seat!==g.turn || !g.players[d.seat] || !g.players[d.seat].alive){
      g.pending=null; g.phase='draw';
    }
  }
  if(resume.kind==='ganglieJudge'){
    finishGanglieJudge(g, finalCard, resume.seat, resume.sourceSeat, resume.resume);
    return;
  }
  // kind==='bagua'
  const red = finishBaguaColor(g, judgedSeat, finalCard);
  if(resume.type==='sha'){
    // 鬼才把这次判定改成红色,视为出闪——和 tryBagua 直接判红同一收尾(方天画戟排队目标需要
    // 继续;青龙偃月刀/贯石斧同样要在这里给一次触发机会,原因见 continueShaAfterTieqi 对应
    // 位置的注释)
    if(red){
      if(maybeStartQinglong(g, resume.from, resume.to)) return;
      if(!maybeStartGuanshifu(g, resume.from, resume.to, resume.sourceCard)) finishSingleShaTarget(g);
    }
    else {
      g.pending={from:resume.from, to:resume.to};
      if(resume.sourceCard!==undefined) g.pending.sourceCard=resume.sourceCard;
      g.phase='respond';
    }
  } else if(resume.type==='aoe'){
    if(red){
      g.log=pushLog(g.log, g.players[resume.target].name+' 以【八卦阵】抵消【'+g.aoe.trick+'】');
      aoeAdvance(g, resume.target);
    } else {
      g.pending={type:'aoeResp', from:g.aoe.from, to:resume.target, need:g.aoe.need};
      if(g.aoe.sourceCard!==undefined) g.pending.sourceCard=g.aoe.sourceCard;
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

// startGame(mode): 'random'(随机分配,允许原来的重复逻辑被"不放回抽样"取代,天然不重复)
// 或 'pick'(三选一)。两种模式都在真正开局前用不放回抽样从全部武将里锁定"这局会用到哪些
// 武将",不需要处理"两人抢同一个武将"这类实时并发冲突——抽样这一步和后续所有分配都在同一次
// tx 事务里原子完成。
// 守卫条件必须同时检查 g.phase==='pickingGeneral',不能只查 g.started——pick 模式下选将阶段
// g.started 仍是 false,如果几个玩家几乎同时点了不同的开始按钮(比如一人先点"三选一"已经建立
// 好候选状态,另一人紧接着点"随机武将"),只查 g.started 会让后到的那次调用照样通过守卫、把
// 刚建立好的选将状态覆盖掉。Firebase 的 tx() 事务保证这些调用严格按到达服务器的先后顺序依次
// 执行(不会真正并发、不会数据损坏),补上这条守卫后"先到先得,后面的都是 no-op"就是完全正确
// 的行为,不需要额外加锁或更复杂的仲裁逻辑。
function startGame(mode){
  tx(g=>{
    if(g.started || g.phase==='pickingGeneral' || g.players.length<MIN_PLAYERS) return g;
    if(mode!=='random' && mode!=='pick') return g;
    g.generalMode = mode;
    const n = g.players.length;
    const allIds = Object.keys(GENERALS);
    const shuffled = [...allIds].sort(()=>Math.random()-0.5); // 不放回抽样,保证不重复

    if(mode==='pick'){
      const perPlayer = 3;
      const needed = n*perPlayer;
      if(shuffled.length < needed){
        // 武将数不够撑起三选一(每人3个候选且互不重复),安全退化为直接随机分配,不报错不卡死
        g.players.forEach((p,i)=>{ p.general = shuffled[i % shuffled.length]; });
        finishGeneralAssign(g);
        return g;
      }
      const pool = shuffled.slice(0, needed);
      g.players.forEach((p,i)=>{
        p.generalChoices = pool.slice(i*perPlayer, (i+1)*perPlayer);
        p.general = null;
      });
      g.phase = 'pickingGeneral';
      g.log = pushLog(g.log, '选将阶段:请各位玩家从候选中选择一名武将');
      return g;
    }

    // random 模式:直接不重复分配,走原有开局收尾
    g.players.forEach((p,i)=>{ p.general = shuffled[i]; });
    finishGeneralAssign(g);
    return g;
  });
}
// finishGeneralAssign: 武将确定之后的开局收尾。原样对照迁移自原 startGame 函数体"分配完武将
// 之后"的全部逻辑(buildDeck/每人发牌堆状态/drawN初始手牌/g.started/g.pending/开局日志/
// startTurn(g,0)),一步不少。注意:原函数从未手写 g.phase(完全交给 startTurn 内部的
// continueQiaobianCheck 链路决定该进入哪个阶段),这里同样不手写 g.phase,维持原有行为
// ——这正是"开局第一回合甄姬洛神不触发"那个bug当年的教训(见下面 startTurn 调用处的注释),
// 不能因为这次改动顺手引入新的手写 g.phase。
function finishGeneralAssign(g){
  g.deck = buildDeck(); g.discard=[];
  g.players.forEach((p,i)=>{
    p.maxHp = generalMaxHp(p.general);       // 体力上限按武将,异常回退 MAX_HP
    p.hp = p.maxHp; p.hand=[]; p.alive=true; p.dying=false; p.chained=false; p.turnedOver=false; p.nirvanaUsed=false; p.delays=[];
    p.equips = emptyEquips();                // 装备区:开局四槽全空
    drawN(g,i,START_HAND);
  });
  g.started=true; g.pending=null;
  g.log = pushLog(g.log, '游戏开始！');
  // 第一回合也要走 startTurn(不能手写 g.turn/g.phase),否则会跳过判定区处理和洛神触发链路
  // ——这正是"开局第一回合甄姬洛神不触发"这个 bug 的根因,第二回合起走 endTurn→startTurn 就正常。
  startTurn(g, 0);
}
// respondPickGeneral: 三选一模式下,玩家从自己的候选(p.generalChoices)里选一个。
function respondPickGeneral(generalId){
  tx(g=>{
    if(g.phase!=='pickingGeneral') return g;
    const me=g.players[mySeat];
    if(!me || me.general || !Array.isArray(me.generalChoices) || !me.generalChoices.includes(generalId)) return g;
    me.general = generalId;
    me.generalChoices = null;
    // 日志刻意不写具体武将名字——候选和最终选择在正式开局(finishGeneralAssign)前都是
    // 隐藏信息,g.log 是所有玩家共享同步的字段(配合"新日志自动弹toast提醒所有人"机制),
    // 写具体牌名会让所有人立刻收到暴露选择的弹窗提示。
    g.log = pushLog(g.log, me.name+' 已选定武将,等待其他玩家…');
    if(g.players.every(p=>p && p.general)){
      finishGeneralAssign(g); // 全部选完,自动进入正式开局
    }
    return g;
  });
}
// debugPickGeneral: 仅供测试用的调试入口——不受 p.generalChoices(三选一候选池)限制,可以
// 直接指定任意已实现的武将。**刻意不检查"武将是否已被其他玩家选择过"这条唯一性限制**——
// 正式对局(respondPickGeneral)靠开局前不放回抽样天然保证同局武将互不重复,但测试场景下
// 经常需要让多人都选到同一个武将来单独反复验证某个技能,不应该受人数/候选池随机性影响,
// 所以这里放宽这条规则,允许重复选择同一个武将。这不代表正式对局允许重复,只是测试专用的
// 例外通道,和 render.js 里明显标注"仅供调试测试使用"的 UI 入口配套。
function debugPickGeneral(generalId){
  tx(g=>{
    if(g.phase!=='pickingGeneral') return g;
    const me=g.players[mySeat];
    if(!me || me.general) return g; // 已经选过了不能重复选,和正式respondPickGeneral保持同样的基本约束
    if(!GENERALS[generalId]) return g; // 必须是真实存在的武将id
    me.general = generalId;
    me.generalChoices = null;
    g.log = pushLog(g.log, me.name+' (调试模式)选择了武将【'+GENERALS[generalId].name+'】');
    if(g.players.every(p=>p && p.general)){
      finishGeneralAssign(g);
    }
    return g;
  });
}
function doDraw(){
  tx(g=>{
    if(g.phase!=='draw'||g.turn!==mySeat) return g;
    finishDrawPhase(g, mySeat, drawPhaseCount(g, mySeat));
    return g;
  });
}
function respondLiRang(activate, cardIdxs){
  tx(g=>{
    if(g.phase!=='lirangAsk'||!g.pending||g.pending.type!=='lirangAsk'||g.pending.from!==mySeat) return g;
    const from=g.pending.from, to=g.pending.to;
    const me=g.players[from], target=g.players[to];
    if(!me || !me.alive || !target || !target.alive || !hasCap(me,'lirang')) return g;
    if(!activate){
      g.log=pushLog(g.log, me.name+'：不发动【礼让】');
      g.pending=null;
      continueEnterDrawPhase(g);
      return g;
    }
    if(g.liRangRound===g.roundNum) return g;
    if(!Array.isArray(cardIdxs) || cardIdxs.length!==2) return g;
    const idxs=[...new Set(cardIdxs)].filter(i=>Number.isInteger(i)).sort((a,b)=>b-a);
    if(idxs.length!==2 || idxs.some(i=>i<0 || i>=(me.hand||[]).length)) return g;
    const moved=[];
    idxs.forEach(idx=>moved.push(me.hand.splice(idx,1)[0]));
    target.hand.push(...moved.reverse());
    g.liRangRound=g.roundNum;
    g.liRangRecord={round:g.roundNum, from, to, discarded:[]};
    g.pending=null;
    g.log=pushLog(g.log, me.name+' 发动【礼让】,交给 '+target.name+' 两张牌');
    markSkillSound(g, '礼让');
    continueEnterDrawPhase(g);
    return g;
  });
}
function respondLuoyi(activate){
  tx(g=>{
    if(g.phase!=='luoyiAsk'||!g.pending||g.pending.type!=='luoyiAsk'||g.pending.seat!==mySeat) return g;
    const me=g.players[mySeat];
    g.pending=null;
    const base=drawPhaseCount(g, mySeat);
    const n=activate ? Math.max(0, base-1) : base;
    if(activate){
      g.luoyiActive=true;
      g.log=pushLog(g.log, me.name+' 发动【裸衣】,少摸1张牌,本回合【杀】和【决斗】伤害+1');
      markSkillSound(g, '裸衣');
    } else {
      g.log=pushLog(g.log, me.name+'：不发动【裸衣】');
    }
    finishDrawPhase(g, mySeat, n);
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
function triggerJiangOnTarget(g, fromSeat, targetSeat, kind, isRedSha){
  const from=g.players[fromSeat], target=g.players[targetSeat];
  if(kind!=='duel' && !(kind==='sha' && isRedSha)) return;
  if(from && from.alive && hasCap(from,'jiang')){
    drawN(g, fromSeat, 1);
    g.log=pushLog(g.log, from.name+' 发动【激昂】,摸一张牌');
    markSkillSound(g, '激昂');
  }
  if(target && target.alive && hasCap(target,'jiang')){
    drawN(g, targetSeat, 1);
    g.log=pushLog(g.log, target.name+' 发动【激昂】,摸一张牌');
    markSkillSound(g, '激昂');
  }
}
// ===== 统一出牌入口:出牌阶段所有牌共用样板,各牌独特部分在 CARD_PLAYS 表里 =====
// actionId:除"杀"外都等于 card.name;杀固定为 '杀'(赵云的闪也走杀,物理牌名可能是'闪')。
// 每项:canPlay(身份+独特前置校验)、target(是否指定目标,决定走不走统一目标校验)、effect(独特效果+日志)。
const CARD_PLAYS = {
  '杀': {
    target:true,
    canPlay:(g,me,card)=> canUseAs(me,card,'杀') && (!g.shaUsed || hasCap(me,'unlimitedSha')), // 无限杀:张飞【咆哮】或诸葛连弩
    canTarget:(g,me,card,targetSeat)=>{
      const target=g.players[targetSeat];
      // 诸葛亮【空城】(锁定技):若目标没有手牌,不能成为【杀】的目标——距离校验之外额外叠加的
      // 一层限制,和距离一样都是"canTarget"这个 seam 的用途(见架构约定:只有杀挂了canTarget)。
      if(target && hasCap(target,'kongcheng') && (target.hand||[]).length===0) return false;
      return canReachSha(g, mySeat, targetSeat); // 只有杀受攻击距离限制
    },
    effect:(g,me,card,targetSeat)=>{
      const usedAs = card.name==='杀' ? '出【杀】' : '出【'+card.name+'】当【杀】';
      g.shaUsed=true; // 本回合出杀次数限制:这里(当前回合玩家在自己出牌阶段出杀)才该计入
      triggerJiangOnTarget(g, mySeat, targetSeat, 'sha', isRed(card));
      resolveShaUse(g, me, targetSeat, usedAs, singleCardShaColor(card), card);
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
    // 诸葛亮【空城】(锁定技):若目标没有手牌,不能成为【决斗】的目标。决斗本身无距离限制,
    // 所以这里不像杀那样叠加 canReachSha,只单独处理这一条限制。
    canTarget:(g,me,card,targetSeat)=>{
      const target=g.players[targetSeat];
      if(target && hasCap(target,'kongcheng') && (target.hand||[]).length===0) return false;
      return true;
    },
    effect:(g,me,card,targetSeat)=>{
      g.log=pushLog(g.log, me.name+' 对 '+g.players[targetSeat].name+' 使用【决斗】');
      triggerJiangOnTarget(g, mySeat, targetSeat, 'duel', false);
      // 先开无懈窗口；无人无懈才真正进入 duel 弃杀流程（见 resolveTrick）
      startTrick(g, {trick:'决斗', from:mySeat, to:targetSeat, sourceCard:card});
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
      startTrick(g, {trick:'五谷丰登', from:mySeat, to:mySeat, pool, sourceCard:card});
    }
  },
  '铁索连环': {
    target:true,
    allowSelf:true,
    canPlay:(g,me,card)=> card.name==='铁索连环',
    effect:(g,me,card,targetSeat)=>{
      const targets=(Array.isArray(targetSeat)?targetSeat:[targetSeat])
        .filter((seat, idx, arr)=>Number.isInteger(seat) && arr.indexOf(seat)===idx)
        .slice(0,2)
        .filter(seat=>g.players[seat] && g.players[seat].alive);
      if(targets.length===0) return;
      startTieSuoTargets(g, mySeat, targets);
    }
  },
  '顺手牵羊': {
    target:true,
    canPlay:(g,me,card)=> card.name==='顺手牵羊',
    canTarget:(g,me,card,targetSeat)=> distance(g, mySeat, targetSeat) <= 1,
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
  canTarget:(g,me,card,targetSeat)=>{
    const spec=DELAY_TRICKS[card.name];
    if(spec.onlySelf){ if(targetSeat!==mySeat) return false; }
    else { if(targetSeat===mySeat) return false; }
    if(card.name==='兵粮寸断' && distance(g, mySeat, targetSeat) > 1) return false;
    // 官方规则:同一判定区不能有两张同名的延时类锦囊牌——之前只在闪电判定失败后的自动
    // 传递里做了这个检查,玩家主动打出时完全没校验,导致能对同一目标连续打两张同名延时锦囊。
    const tgt=g.players[targetSeat];
    if(!tgt) return false;
    const hasDup=(tgt.delays||[]).some(c=>c && c.name===card.name);
    return !hasDup;
  },
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
  g.aoe={trick:card.name, from:mySeat, need, sourceCard:card};
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
      if(actionId==='铁索连环' && Array.isArray(targetSeat)){
        const targets=targetSeat
          .filter((seat, idx, arr)=>Number.isInteger(seat) && arr.indexOf(seat)===idx)
          .slice(0,2)
          .filter(seat=>g.players[seat] && g.players[seat].alive);
        if(targets.length===0) return g;
        targetSeat=targets;
      } else {
      // 默认拒绝自选目标;spec.allowSelf(如闪电这类延时锦囊)放行
      if((targetSeat===mySeat && !spec.allowSelf) || !g.players[targetSeat] || !g.players[targetSeat].alive) return g;
      if(spec.canTarget && !spec.canTarget(g,me,card,targetSeat)) return g; // 额外目标限制(如杀的攻击距离)
      }
    }
    me.hand.splice(cardIdx,1);
    if(!spec.noDiscard) g.discard.push(card); // 装备牌 noDiscard:不进弃牌堆,由 effect 放进装备区
    spec.effect(g, me, card, targetSeat);
    if(hasCap(me,'jizhi') && isTrickCardName(actionId)){
      drawN(g, mySeat, 1);
      g.log=pushLog(g.log, me.name+' 发动【集智】,摸一张牌');
      markSkillSound(g, '集智');
    }
    markCardSound(g, actionId, mySeat, card, spec.target ? targetSeat : null); // playCard 是普通出牌的统一出口,这里加一次就覆盖所有走这个入口的牌
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
// resolveShaUse 的 shaColor 参数:这张杀的颜色,'red'/'black'/'none'/undefined 之一——不是
// 直接传物理牌,由调用方各自算好再传入(普通杀/借刀杀人用 singleCardShaColor(card),丈八
// 蛇矛两张当杀用 combinedShaColor(c1,c2)),resolveShaUse 内部只认这一份统一的颜色结果,
// 不用再关心"这张杀是怎么凑出来的"。**这里曾经有一个真实 bug**:早期版本直接传物理牌
// `card`、丈八蛇矛不传(undefined),导致"黑色杀对某某无效"这类效果(毅重/仁王盾)对丈八蛇矛
// 的合成杀完全绕过、不管用两张什么颜色的牌合成都不生效——真实规则里合成杀是有颜色的
// (两张都红→红,两张都黑→黑,一红一黑→无色),不是"没有颜色"。改成 shaColor 之后这个
// bug 自然消失,不需要在这里特殊处理"丈八蛇矛"这个武器,颜色早在调用方就算对了。
function resolveShaUse(g, me, targetSeat, usedAs, shaColor, sourceCard){
  const fromSeat=g.players.indexOf(me);
  if(maybeStartLiuli(g, fromSeat, targetSeat, usedAs, shaColor, sourceCard)) return;
  resolveShaUseNoLiuli(g, me, targetSeat, usedAs, shaColor, sourceCard);
}
function resolveShaUseNoLiuli(g, me, targetSeat, usedAs, shaColor, sourceCard){
  const fromSeat=g.players.indexOf(me);
  const target=g.players[targetSeat];
  // 于禁【毅重】(锁定技,目标无防具+黑色杀)/ 仁王盾(装备了这件防具+黑色杀) → 直接无效,
  // 不进响应阶段、不消耗闪、不受伤。两者共用同一个 hasCap 入口(武将能力/装备能力不分来源),
  // 只是 || 一个条件——"目标无防具"和"目标装备了仁王盾"structurally 互斥(装备区防具槽
  // 只有一个,不可能同时是"空"和"仁王盾",不需要额外防御代码)。shaColor 为 'red'/'none'/
  // undefined 时都安全跳过这个判断,只有精确等于 'black' 才命中。
  if(shaColor==='black' && ((hasCap(target,'yizhong') && !(target.equips && target.equips.armor)) || hasCap(target,'renwang'))){
    const reason = hasCap(target,'renwang') ? '【仁王盾】' : '【毅重】';
    g.log=logEvent(g.log, { kind:'sha', actor:fromSeat, targets:[targetSeat], text: me.name+' 对 '+target.name+' 使用的黑色【杀】因'+reason+'无效' });
    finishSingleShaTarget(g);
    return;
  }
  g.log=logEvent(g.log, { kind:'sha', actor:fromSeat, targets:[targetSeat], text: me.name+' 对 '+target.name+' '+usedAs });
  if(hasCap(me,'tieqi')){
    g.pending={type:'tieqi', from:fromSeat, to:targetSeat};
    if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
    g.phase='tieqi';
    g.log=pushLog(g.log, '是否发动【铁骑】进行判定…');
    return;
  }
  // 黄忠【烈弓】:数值条件同步比较,不需要判定,满足条件时可选发动(不是自动生效)。
  if(hasCap(me,'liegong')){
    const targetHandCount=(g.players[targetSeat].hand||[]).length;
    if(targetHandCount>=me.hp || targetHandCount<=attackRange(g,fromSeat)){
      g.pending={type:'liegong', from:fromSeat, to:targetSeat};
      if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
      g.phase='liegong';
      g.log=pushLog(g.log, '是否发动【烈弓】,令此【杀】不可被【闪】抵消…');
      return;
    }
  }
  continueShaAfterTieqi(g, fromSeat, targetSeat, false, sourceCard);
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
    continueShaAfterTieqi(g, from, to, activate, g.pending.sourceCard);
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
    // 诸葛亮【空城】:借刀杀人的B同样是"被指定为这张杀的目标"(官方FAQ明确空城对借刀杀人的B
    // 目标同样生效),不能因为这条路径不走 CARD_PLAYS['杀'].canTarget 就漏了这层保护。
    if(hasCap(B,'kongcheng') && (B.hand||[]).length===0) return g;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    g.log=pushLog(g.log, me.name+' 对 '+A.name+' 使用【借刀杀人】,目标 '+B.name);
    markCardSound(g, '借刀杀人', mySeat, card, seatA); // 借刀杀人不走 playCard 统一出口(两步选目标的独立函数),单独补一次
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
      markCardSound(g, '杀', mySeat, card, seatB);
      if(card.name!=='杀'){ if(hasCap(A,'longdan')) markSkillSound(g,'龙胆'); else if(hasCap(A,'wusheng')) markSkillSound(g,'武圣'); }
      g.pending=null;
      resolveShaUse(g, A, seatB, '借刀杀人:出【杀】', singleCardShaColor(card), card);
      return g;
    }
    const weapon=A.equips.weapon;
    if(!weapon) return g; // 理论上不会(resolveTrick 进这个阶段前已校验),双重保险
    A.equips.weapon=null;
    const user=g.players[g.pending.from]; // 借刀杀人的使用者(不是A、不是B)
    if(user && user.alive){
      user.hand.push(weapon);
      g.log=pushLog(g.log, A.name+' 选择交出武器【'+weapon.name+'】,'+user.name+' 获得此牌(借刀杀人)');
    } else {
      // 使用者已阵亡(理论边界):没有手牌可归还,兜底弃入弃牌堆,防止牌凭空消失
      g.discard.push(weapon);
      g.log=pushLog(g.log, A.name+' 选择交出武器【'+weapon.name+'】,但使用者已不在场,该牌弃置(借刀杀人)');
    }
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
function continueShaAfterTieqi(g, from, to, noShan, sourceCard){
  const me=g.players[from];
  g.pending={from, to, noShan};
  if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
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
  const r=tryBagua(g, to, {type:'sha', from, to, sourceCard});
  if(r==='pending') return; // 鬼才改判进行中,收尾延后到 finishGuicai
  if(r){
    const sourceCardForSha = g.pending && g.pending.sourceCard;
    g.pending=null;
    // 青龙偃月刀/贯石斧:这条路径(八卦阵判红,视为出闪)和 respondShan 里目标打出实体闪是
    // 同一件事——"这张杀被闪抵消了"——都要给这两把武器一个触发机会,不能只在 respondShan
    // 里判断(八卦阵的判定发生在进入响应阶段之前,目标可能根本不会走到 respondShan)。两者
    // 装在同一个武器槽、互斥,不会同时满足两个 if。
    if(maybeStartQinglong(g, from, to)) return;
    if(maybeStartGuanshifu(g, from, to, sourceCardForSha)) return;
    finishSingleShaTarget(g);
    return;
  }
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
      continueShaAfterTieqi(g, from, to, false, g.pending.sourceCard);
      return g;
    }
    const card=judge(g);
    if(!card){ continueShaAfterTieqi(g, from, to, false, g.pending.sourceCard); return g; } // 无牌可判,视为未发动
    if(maybeGuicai(g, from, card, {kind:'tieqiJudge', from, to, sourceCard:g.pending.sourceCard})==='pending') return g;
    finishTieqiJudge(g, from, to, card, g.pending.sourceCard);
    return g;
  });
}
// finishTieqiJudge: 铁骑判定结算(不管是否被鬼才改判过)。红=不可被闪抵消,黑=无事发生。
function finishTieqiJudge(g, from, to, card, sourceCard){
  const red=isRedForPlayer(g.players[from], card);
  g.log=pushLog(g.log, g.players[from].name+' 发动【铁骑】,判定为'+(red?'红':'黑'));
  // 天妒:铁骑判定归属者是 from(发动铁骑的攻击者)自己的判定,若 from 恰好是郭嘉可以收下判定牌
  // (现实中不会发生——铁骑是马超专属 cap,一人不能同时是马超又是郭嘉——但函数写法上不应该
  // 硬编码排除这种情况,和 maybeTiandu 本身"只查 hasCap,不硬编码武将名"的原则一致)。
  maybeTiandu(g, from, card);
  continueShaAfterTieqi(g, from, to, red, sourceCard);
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
    // 诸葛亮【空城】:丈八蛇矛这条路径不走 CARD_PLAYS['杀'].canTarget,单独补上同一条限制
    // ——这仍然是"使用杀"这件事,空城不区分杀是怎么凑出来的。
    if(hasCap(tgt,'kongcheng') && (tgt.hand||[]).length===0) return g;
    // 两张牌进弃牌堆:先弹大下标再弹小下标,避免 splice 后错位
    const hi=Math.max(idx1,idx2), lo=Math.min(idx1,idx2);
    g.discard.push(me.hand.splice(hi,1)[0]);
    g.discard.push(me.hand.splice(lo,1)[0]);
    g.shaUsed=true; // 本回合出杀次数限制:这里(当前回合玩家在自己出牌阶段出杀)才该计入
    // 丈八蛇矛合成杀的颜色按两张牌的红黑组合决定(两红→红/两黑→黑/一红一黑→无色),
    // 不是"没有颜色"——c1/c2 是 splice 之前存的引用,不受后面 splice 影响。
    resolveShaUse(g, me, targetSeat, '用两张牌当【杀】(丈八蛇矛)', combinedShaColor(c1, c2), [c1, c2]);
    // 丈八蛇矛是两张牌合成一个杀,没有单一牌面对象可传(c1/c2 是两张不同的牌,传其中任一张
    // 都是拼凑/误导),中央出牌区只传座位(仍能显示"谁"),card 留空退化为不显示牌面。
    markCardSound(g, '杀', mySeat, null, targetSeat); // 丈八蛇矛两张当杀不走 playCard 统一出口,单独补一次
    return g;
  });
}
// playShaFangtian: 方天画戟——锁定技,若使用的杀是最后一张手牌,可额外选至多两个目标(总计最多3个)。
// 与 playCard/CARD_PLAYS['杀'] 平级的独立入口(不改动通用单目标出杀流程,普通玩家/普通情况完全不受影响)。
// 不强制选满(targets.length 1~3 都合法),结算顺序不由玩家提交顺序决定——按 nextAlive 回合方向从
// 攻击者起重排(官方原文"结算顺序固定、不可自选")。武器槽互斥:装备方天画戟时不可能同时装备
// 青龙偃月刀/寒冰剑/麒麟弓等其它武器,因此排队目标的后续响应/判定不会触碰那几把武器各自的专属分支。
// 额外目标是否也受方天画戟自身射程限制:查不到能逐字引用的官方原文,这里按"这仍是同一张杀、射程
// 限制作用于这张杀本身"的方向实现——是推断,不是确证的官方规则,已与用户确认按这个方向做。
function playShaFangtian(cardIdx, targets){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat], card=me.hand[cardIdx];
    if(!card || !canUseAs(me,card,'杀')) return g;
    if(g.shaUsed && !hasCap(me,'unlimitedSha')) return g; // 出杀次数限制,和普通杀一致
    if(!hasCap(me,'fangtian') || me.hand.length!==1) return g; // 锁定技触发条件:必须是最后一张手牌
    if(!Array.isArray(targets) || targets.length<1 || targets.length>3) return g;
    const seen=new Set();
    for(const t of targets){
      if(seen.has(t)) return g; // 目标不能重复
      seen.add(t);
      const tp=g.players[t];
      if(!tp || !tp.alive || t===mySeat || !canReachSha(g, mySeat, t)) return g;
      // 诸葛亮【空城】:方天画戟这条路径同样不走 CARD_PLAYS['杀'].canTarget,逐个目标补上
      // 同一条限制——多目标里任何一个是空城状态的诸葛亮都不能被列入。
      if(hasCap(tp,'kongcheng') && (tp.hand||[]).length===0) return g;
    }
    // 按现有回合方向(nextAlive)从攻击者起重排,不用玩家提交的原始顺序
    const order=[]; let s=mySeat;
    for(let i=0;i<g.players.length;i++){ s=nextAlive(g,s); if(targets.includes(s)) order.push(s); }
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    g.shaUsed=true; // 本回合出杀次数限制:这里(当前回合玩家在自己出牌阶段出杀)才该计入
    const usedAs = card.name==='杀' ? '出【杀】' : '出【'+card.name+'】当【杀】';
    g.log=pushLog(g.log, me.name+' 发动【方天画戟】,'+usedAs+',指定 '+order.length+' 个目标：'+order.map(t=>g.players[t].name).join('、'));
    g.fangtianQueue = { from:mySeat, targets:order, idx:0, usedAs, shaColor:singleCardShaColor(card), sourceCard:card };
    resolveShaUse(g, me, order[0], usedAs, singleCardShaColor(card), card);
    markCardSound(g, '杀', mySeat, card, order); // 方天画戟多目标出杀不走 playCard 统一出口,单独补一次
    return g;
  });
}
// duanLiang: 徐晃【断粮】——出牌阶段限一次,将一张黑色基本牌或黑色装备牌当【兵粮寸断】
// 使用,距离2以内。官方规则不是"弃任意牌"(此前的实现有误);选中的这张真实牌直接传给
// startTrick 的 info.card,走和真实兵粮寸断完全一样的 startTrick/resolveTrick/回合开始判定
// 流程(可被无懈可击抵消)——resolveTrick 按 info.trick 字段('兵粮寸断')分派,discardOrVanish
// 只看 card.virtual 标记,两者都跟牌的真实身份无关,不需要构造虚拟对象,判定完直接以真实
// 身份进弃牌堆即可。距离校验复用和杀同一套 distance(g,mySeat,targetSeat)<=2。
function duanLiang(cardIdx, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!hasCap(me,'duanliang') || g.duanliangUsed) return g;
    const card=me.hand[cardIdx];
    if(!card) return g;
    const isBlack = card.suit==='♠' || card.suit==='♣';
    const isBasicOrEquip = BASIC_CARDS.includes(card.name) || !!getEquip(card.name);
    if(!isBlack || !isBasicOrEquip) return g;
    if(targetSeat===mySeat || !g.players[targetSeat] || !g.players[targetSeat].alive) return g;
    if(distance(g, mySeat, targetSeat) > 2) return g;
    g.duanliangUsed=true;
    me.hand.splice(cardIdx,1);
    g.log=pushLog(g.log, me.name+' 将【'+card.name+'】当【兵粮寸断】使用,发动【断粮】,目标 '+g.players[targetSeat].name);
    markCardSound(g, '兵粮寸断', mySeat, card, targetSeat); // 念被当作使用的目标牌名(兵粮寸断),不是原始物理牌本身
    startTrick(g, {trick:'兵粮寸断', from:mySeat, to:targetSeat, card:card});
    return g;
  });
}
// qiXi: 甘宁【奇袭】——将任意一张黑色手牌当【过河拆桥】使用。
// 和徐晃【断粮】一样走独立技能动作:真实手牌先离手并进弃牌堆,再按过河拆桥开启无懈窗口。
function qiXi(cardIdx, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!hasCap(me,'qixi')) return g;
    const card=me.hand[cardIdx];
    if(!card) return g;
    const isBlack = card.suit==='♠' || card.suit==='♣';
    if(!isBlack) return g;
    const target=g.players[targetSeat];
    if(targetSeat===mySeat || !target || !target.alive) return g;
    const hasTargetCard = (target.hand||[]).length>0
      || EQUIP_SLOTS.some(s=>target.equips && target.equips[s])
      || (target.delays||[]).length>0;
    if(!hasTargetCard) return g;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    g.log=pushLog(g.log, me.name+' 将【'+card.name+'】当【过河拆桥】使用,发动【奇袭】,目标 '+target.name);
    markSkillSound(g, '奇袭');
    markCardSound(g, '过河拆桥', mySeat, card, targetSeat);
    startTrick(g, {trick:'过河拆桥', from:mySeat, to:targetSeat});
    return g;
  });
}
function guoSe(cardIdx, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!hasCap(me,'guose')) return g;
    const card=me.hand[cardIdx];
    if(!card || card.suit!=='♦') return g;
    const target=g.players[targetSeat];
    if(targetSeat===mySeat || !target || !target.alive) return g;
    target.delays = target.delays || [];
    if(target.delays.some(c=>c && c.name==='乐不思蜀')) return g;
    me.hand.splice(cardIdx,1);
    const trickCard={...card, name:'乐不思蜀', originalName:card.name};
    g.log=pushLog(g.log, me.name+' 将【'+card.name+'】当【乐不思蜀】使用,发动【国色】,目标 '+target.name);
    markSkillSound(g, '国色');
    markCardSound(g, '乐不思蜀', mySeat, card, targetSeat);
    startTrick(g, {trick:'乐不思蜀', from:mySeat, to:targetSeat, card:trickCard});
    return g;
  });
}
function lianHuan(cardIdx, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'lianhuan')) return g;
    const card=me.hand[cardIdx];
    if(!card || card.suit!=='♣') return g;
    const targets=(Array.isArray(targetSeat)?targetSeat:[targetSeat])
      .filter((seat, idx, arr)=>Number.isInteger(seat) && arr.indexOf(seat)===idx)
      .slice(0,2)
      .filter(seat=>g.players[seat] && g.players[seat].alive);
    if(targets.length===0) return g;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    g.log=pushLog(g.log, me.name+' 将【'+card.name+'】当【铁索连环】使用,目标 '+targets.map(seat=>g.players[seat].name).join('、'));
    markSkillSound(g, '连环');
    startTieSuoTargets(g, mySeat, targets);
    return g;
  });
}
function maleSeats(g){
  return g.players.map((p,i)=>({p,i})).filter(o=>o.p && o.p.alive && isMale(o.p)).map(o=>o.i);
}
function liJian(cardIdx, fromSeat, toSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'lijian') || g.liJianUsed) return g;
    const card=me.hand[cardIdx];
    if(!card) return g;
    const from=g.players[fromSeat], to=g.players[toSeat];
    if(fromSeat===toSeat || !from || !to || !from.alive || !to.alive || !isMale(from) || !isMale(to)) return g;
    if(maleSeats(g).length<2) return g;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    g.liJianUsed=true;
    g.log=pushLog(g.log, me.name+' 弃置一张牌发动【离间】,令 '+from.name+' 视为对 '+to.name+' 使用【决斗】');
    markSkillSound(g, '离间');
    triggerJiangOnTarget(g, fromSeat, toSeat, 'duel', false);
    startTrick(g, {trick:'决斗', from:fromSeat, to:toSeat});
    return g;
  });
}
function fanJian(targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat], target=g.players[targetSeat];
    if(!me || !target || !me.alive || !target.alive || targetSeat===mySeat) return g;
    if(!hasCap(me,'fanjian') || g.fanJianUsed || (me.hand||[]).length===0) return g;
    g.fanJianUsed=true;
    g.pending={type:'fanjianSuit', seat:mySeat, targetSeat};
    g.phase='fanjianSuit';
    g.log=pushLog(g.log, me.name+' 对 '+target.name+' 发动【反间】,令其选择一种花色');
    markSkillSound(g, '反间');
    return g;
  });
}
function respondFanjianSuit(suit){
  tx(g=>{
    if(g.phase!=='fanjianSuit'||!g.pending||g.pending.type!=='fanjianSuit'||g.pending.targetSeat!==mySeat) return g;
    if(!['♠','♥','♣','♦'].includes(suit)) return g;
    const {seat, targetSeat}=g.pending;
    const zhou=g.players[seat], target=g.players[targetSeat];
    if(!zhou || !target || !zhou.alive || !target.alive || (zhou.hand||[]).length===0){ g.pending=null; g.phase='play'; return g; }
    const idx=Math.floor(Math.random()*zhou.hand.length);
    const card=zhou.hand.splice(idx,1)[0];
    target.hand.push(card);
    const same=card.suit===suit;
    g.log=pushLog(g.log, target.name+' 为【反间】选择 '+suit+',获得并展示 '+card.suit+rankText(card.rank)+'【'+card.name+'】');
    g.pending=null;
    if(!same){
      const interrupted=dealDamage(g, targetSeat, 1, seat, '【反间】', 'fanjian');
      if(interrupted){
        if(g.pending) g.pending.resume={type:'fanjian'};
        return g;
      }
      if(checkWin(g)) return g;
    } else {
      g.log=pushLog(g.log, '花色相同,'+target.name+' 不受到【反间】伤害');
    }
    g.phase='play';
    return g;
  });
}
function recastLianHuan(cardIdx){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'lianhuan')) return g;
    const card=me.hand[cardIdx];
    if(!card || card.suit!=='♣') return g;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    drawN(g, mySeat, 1);
    g.log=pushLog(g.log, me.name+' 重铸【'+card.name+'】发动【连环】,摸一张牌');
    markSkillSound(g, '连环');
    return g;
  });
}
function advanceTieSuoQueue(g){
  const q=g.tiesuoQueue;
  if(!q){ g.phase='play'; return; }
  const from=g.players[q.from];
  while(q.idx<q.targets.length){
    const to=q.targets[q.idx++];
    const target=g.players[to];
    if(!from || !from.alive || !target || !target.alive) continue;
    g.log=pushLog(g.log, from.name+' 对 '+target.name+' 使用【铁索连环】');
    // 这里是队列推进函数,原始那张梅花实体牌在更早的 lianHuan/recastLianHuan 里已经处理完,
    // 这一步拿不到牌面对象(不同调用点各自持有,不应跨函数传值制造耦合),只传座位。
    markCardSound(g, '铁索连环', q.from, null, to);
    startTrick(g, {trick:'铁索连环', from:q.from, to});
    return;
  }
  g.tiesuoQueue=null;
  g.pending=null;
  g.phase='play';
}
function startTieSuoTargets(g, fromSeat, targetSeats){
  const seats=(Array.isArray(targetSeats)?targetSeats:[targetSeats])
    .filter((seat, idx, arr)=>Number.isInteger(seat) && arr.indexOf(seat)===idx)
    .slice(0,2)
    .filter(seat=>g.players[seat] && g.players[seat].alive);
  if(seats.length===0){ g.phase='play'; return; }
  g.tiesuoQueue={from:fromSeat, targets:seats, idx:0};
  advanceTieSuoQueue(g);
}
function liuliDiscardOptions(p){
  const list=[];
  (p.hand||[]).forEach((card, idx)=>list.push({kind:'hand', idx, label:'手牌【'+card.name+'】'}));
  EQUIP_SLOTS.forEach(slot=>{ if(p.equips && p.equips[slot]) list.push({kind:'equip', slot, label:EQUIP_SLOT_LABEL[slot]+'【'+p.equips[slot].name+'】'}); });
  return list;
}
function liuliTargets(g, from, to){
  return g.players.map((p,i)=>({p,i}))
    .filter(o=>o.p && o.p.alive && o.i!==from && o.i!==to && canReachSha(g, to, o.i) && !(hasCap(o.p,'kongcheng') && (o.p.hand||[]).length===0))
    .map(o=>o.i);
}
function maybeStartLiuli(g, from, to, usedAs, shaColor, sourceCard){
  const target=g.players[to];
  if(!target || !target.alive || from===to || !hasCap(target,'liuli')) return false;
  if(liuliDiscardOptions(target).length===0) return false;
  const targets=liuliTargets(g, from, to);
  if(targets.length===0) return false;
  g.pending={type:'liuli', from, to, usedAs, shaColor, targets};
  if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
  g.phase='liuli';
  g.log=pushLog(g.log, target.name+' 是否发动【流离】,弃一张牌转移此【杀】…');
  return true;
}
function respondLiuli(choice, newTargetSeat){
  tx(g=>{
    if(g.phase!=='liuli'||!g.pending||g.pending.type!=='liuli'||g.pending.to!==mySeat) return g;
    const {from, to, usedAs, shaColor, sourceCard}=g.pending;
    const me=g.players[to], newTarget=g.players[newTargetSeat];
    if(!choice){
      g.log=pushLog(g.log, me.name+'：不发动【流离】');
      resolveShaUseNoLiuli(g, g.players[from], to, usedAs, shaColor, sourceCard);
      return g;
    }
    if(!newTarget || !newTarget.alive || newTargetSeat===from || newTargetSeat===to || !liuliTargets(g, from, to).includes(newTargetSeat)) return g;
    let discarded=null;
    if(choice.kind==='hand'){
      const idx=choice.idx;
      if(!Number.isInteger(idx) || !me.hand[idx]) return g;
      discarded=me.hand.splice(idx,1)[0];
      g.discard.push(discarded);
    } else if(choice.kind==='equip'){
      const slot=choice.slot;
      if(!EQUIP_SLOTS.includes(slot) || !me.equips || !me.equips[slot]) return g;
      discarded=me.equips[slot];
      me.equips[slot]=null;
      g.discard.push(discarded);
      triggerHook(g, to, 'onLoseEquip', {count:1});
    } else return g;
    g.log=pushLog(g.log, me.name+' 弃置【'+discarded.name+'】发动【流离】,将此【杀】转移给 '+newTarget.name);
    markSkillSound(g, '流离');
    resolveShaUseNoLiuli(g, g.players[from], newTargetSeat, usedAs, shaColor, sourceCard);
    return g;
  });
}
// ===== 张郃【巧变】完整版:回合开始时一次性决策"是否发动"+"跳过判定/摸牌/出牌/弃牌
// 阶段之一"(一回合限一次),仅选"出牌阶段"才附带"移动一张装备/判定牌"这个后续效果
// (官方原文:"你可以弃置一张手牌并跳过一个阶段(准备阶段和结束阶段除外),若为:摸牌阶段,
// 你可以获得至多两名角色各一张手牌;出牌阶段,你可以移动场上一张牌。"——这个项目目前
// 只实现"跳过阶段"+"出牌阶段可移动装备/判定牌"这部分,"摸牌阶段可获得两名角色各一张
// 手牌"这个官方原文里的额外效果暂不实现,是简化,不是遗漏,见 CLAUDE.md 记录)。
//
// continueQiaobianCheck: startTurn 里紧接着"声明轮到谁"之后调用,必须在 resolveDelayTricks
// (真正的判定阶段)之前问,因为"跳过判定阶段"这个选项要求判定阶段还没发生。没有这个能力
// 或没有手牌(付不起弃牌的代价)则直接放行到原有链路,不放行的人完全不受这次改动影响。
// continueGuanxingCheck: 诸葛亮【观星】,回合开始时紧跟着"声明轮到谁"之后调用,比
// continueQiaobianCheck 更早——观星是"准备阶段"的交互,巧变是"回合开始时(判定阶段之前)"
// 的交互,准备阶段本来就在判定阶段之前,所以观星要插在链路里更靠前的位置。没有这个能力
// 或牌堆(含重洗弃牌堆)一张都没有则直接放行到原有链路(继续走巧变检查),不受这次改动影响。
function continueGuanxingCheck(g, seat){
  const p=g.players[seat];
  if(hasCap(p,'guanxing')){
    const aliveN = g.players.filter(pp=>pp&&pp.alive).length;
    const n = Math.min(5, aliveN);
    if(ensureDeck(g) && g.deck.length>0){
      const actualN = Math.min(n, g.deck.length); // 牌堆不够X张时,有多少看多少,不报错不卡死
      // g.deck 数组尾部代表"牌堆顶"(judge()/drawN() 都用 g.deck.pop() 取牌),这里从数组末尾
      // 切出 actualN 张——cards 里下标越大的牌离"牌堆顶"越近,cards[actualN-1] 就是原本
      // 会被最先翻到的那张。
      const cards = g.deck.splice(g.deck.length-actualN, actualN);
      g.pending = { type:'guanxingReview', seat, cards };
      g.phase = 'guanxingReview';
      g.log = pushLog(g.log, p.name+' 发动【观星】,正在查看牌堆顶…'); // 不写牌面,私密信息
      return;
    }
  }
  continueQiaobianCheck(g, seat);
}
// respondGuanxing: 观星发动者提交排序结果。topOrder/bottomOrder 是 g.pending.cards 的下标
// 数组(两者合起来必须恰好覆盖每个下标一次)。约定:topOrder 数组的**最后一个元素**对应的
// 那张牌,是"放回牌堆顶之后最先会被翻到的那张"(和 judge() 用 pop() 从数组末尾取牌的方向
// 严格对齐——这是最容易弄反的地方,前端UI组装 topOrder 时必须遵守这个约定,不能想当然按
// "数组第一个=最先翻到"来传)。bottomOrder 里的牌整体放到牌堆最底部(数组最前面),牌堆见底
// 前基本不会被摸到/判定到,顺序本身影响很小。
function respondGuanxing(topOrder, bottomOrder){
  tx(g=>{
    if(g.phase!=='guanxingReview'||!g.pending||g.pending.type!=='guanxingReview'||g.pending.seat!==mySeat) return g;
    const cards = g.pending.cards;
    const allIdx = [...(topOrder||[]), ...(bottomOrder||[])];
    // 校验:两个数组合起来必须恰好是cards的每个下标各出现一次,不能多选/漏选/重复选
    if(allIdx.length!==cards.length || new Set(allIdx).size!==cards.length || !allIdx.every(i=>Number.isInteger(i)&&i>=0&&i<cards.length)) return g;
    const topCards = topOrder.map(i=>cards[i]);
    const bottomCards = bottomOrder.map(i=>cards[i]);
    g.deck = [...bottomCards, ...g.deck, ...topCards];
    g.pending = null;
    g.log = pushLog(g.log, g.players[mySeat].name+' 【观星】结束'); // 不写具体怎么排的,私密信息
    continueQiaobianCheck(g, mySeat); // 继续走向巧变检查->判定阶段,原有链路不变
    return g;
  });
}
function continueQiaobianCheck(g, seat){
  const p=g.players[seat];
  if(hasCap(p,'qiaobian') && (p.hand||[]).length>0){
    g.pending={type:'qiaobianTurnStart', seat};
    g.phase='qiaobianTurnStart';
    g.log=pushLog(g.log, p.name+' 是否发动【巧变】…');
    return;
  }
  continueDelayResolution(g, seat);
}
// qiaobianDecline: 仅 pending.seat 本人可响应,"不发动"才需要真正提交(会改变共享状态,
// 放行到原有链路)。"发动"不需要单独一次网络往返——点"发动"只是让客户端进入"选牌+选阶段"
// 的本地界面(和徐晃断粮同款,选择过程纯客户端状态),真正生效的提交是 qiaobianDeclare。
function qiaobianDecline(){
  tx(g=>{
    if(g.phase!=='qiaobianTurnStart'||!g.pending||g.pending.type!=='qiaobianTurnStart'||g.pending.seat!==mySeat) return g;
    g.log=pushLog(g.log, g.players[mySeat].name+'：不发动【巧变】');
    g.pending=null;
    continueDelayResolution(g, mySeat);
    return g;
  });
}
// qiaobianDeclare: 真正弃牌+跳过阶段生效的提交。phaseChoice 是 'judge'/'draw'/'play'/'discard' 之一。
// - 'judge':判定阶段还没发生,直接跳过 resolveDelayTricks 这一次调用,判定区的牌原样保留,
//   留到下回合真正轮到判定阶段时再处理(不清空不作废)。
// - 'draw'/'discard':和乐不思蜀(skipPlay)/兵粮寸断(skipDraw)同款标志位机制,设标志位后
//   继续走原有链路,由 advancePastPlay/advancePastDiscard 在对应阶段的入口处消费。
// - 'play':还不能直接设 skipPlay——真实规则"移动一张装备/判定牌"是这个选项独有的后续效果,
//   要先问完"移动到哪"才算这次巧变完整结束,开新 pending qiaobianMove,skipPlay 留到那一步
//   (respondQiaobianMove)才设,避免"效果还没问完、标志已经生效"这种时序错乱。
function qiaobianDeclare(cardIdx, phaseChoice){
  tx(g=>{
    if(g.phase!=='qiaobianTurnStart'||!g.pending||g.pending.type!=='qiaobianTurnStart'||g.pending.seat!==mySeat) return g;
    if(!['judge','draw','play','discard'].includes(phaseChoice)) return g;
    const me=g.players[mySeat];
    const card=me.hand[cardIdx];
    if(!card) return g;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    const phaseLabel={judge:'判定阶段',draw:'摸牌阶段',play:'出牌阶段',discard:'弃牌阶段'}[phaseChoice];
    g.log=pushLog(g.log, me.name+' 弃置一张牌,发动【巧变】,跳过'+phaseLabel);
    g.pending=null;
    if(phaseChoice==='judge'){
      continueTurnStart(g, mySeat); // 直接跳过 resolveDelayTricks,判定区的牌不动
      return g;
    }
    if(phaseChoice==='draw'){
      g.skipDraw=true;
      continueDelayResolution(g, mySeat);
      return g;
    }
    if(phaseChoice==='discard'){
      g.skipDiscard=true;
      continueDelayResolution(g, mySeat);
      return g;
    }
    // phaseChoice==='play':先问是否移动一张装备/判定牌,skipPlay 留到 respondQiaobianMove 里设
    g.pending={type:'qiaobianMove', seat:mySeat};
    g.phase='qiaobianMove';
    g.log=pushLog(g.log, '【巧变】是否移动一张装备/判定牌…');
    return g;
  });
}
// respondQiaobianMove: 仅 pending.seat 本人可响应。move 为 null(不移动)或 {kind,srcSeat,
// slot/idx,dstSeat}(复用 doQiaobianMove 校验+执行)。移动是否合法/是否发生,都不影响
// "跳过出牌阶段"这个已经生效的效果——最后统一设 skipPlay 并继续原有链路。
function respondQiaobianMove(move){
  tx(g=>{
    if(g.phase!=='qiaobianMove'||!g.pending||g.pending.type!=='qiaobianMove'||g.pending.seat!==mySeat) return g;
    if(move) doQiaobianMove(g, move);
    g.pending=null;
    g.skipPlay=true;
    continueDelayResolution(g, mySeat);
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
function tianxiangHeartOptions(p){
  const list=[];
  (p.hand||[]).forEach((card, idx)=>{
    if(cardSuitForPlayer(p, card)==='♥') list.push({idx, card});
  });
  return list;
}
function tianxiangTargets(g, seat){
  return g.players.map((p,i)=>({p,i})).filter(o=>o.p && o.p.alive && o.i!==seat).map(o=>o.i);
}
function maybeStartTianxiang(g, seat, amount, sourceSeat, reason, srcType, sourceCard){
  const p=g.players[seat];
  if(!p || !p.alive || !hasCap(p,'tianxiang')) return false;
  const hearts=tianxiangHeartOptions(p);
  const targets=tianxiangTargets(g, seat);
  if(hearts.length===0 || targets.length===0) return false;
  g.pending={type:'tianxiang', seat, amount, sourceSeat, reason, srcType, targets, resume:{type:srcType}};
  if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
  g.phase='tianxiang';
  g.log=pushLog(g.log, p.name+' 是否发动【天香】,弃置一张红桃手牌转移此次伤害…');
  return true;
}
function zhengyiRecipient(g, seat){
  const p=g.players[seat];
  const r=g.liRangRecord;
  if(!p || !p.alive || !hasCap(p,'zhengyi') || !r || r.round!==g.roundNum || r.from!==seat) return null;
  const target=g.players[r.to];
  if(!target || !target.alive || r.to===seat) return null;
  return r.to;
}
function maybeStartZhengyi(g, seat, amount, sourceSeat, reason, srcType, sourceCard){
  const p=g.players[seat];
  if(!p || !p.alive || !hasCap(p,'zhengyi')) return false;
  if(p.zhengyiTurn===g.turn) return false;
  const asking=zhengyiRecipient(g, seat);
  if(asking===null) return false;
  p.zhengyiTurn=g.turn;
  g.pending={type:'zhengyi', seat, asking, amount, sourceSeat, reason, srcType, resume:{type:srcType}};
  if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
  g.phase='zhengyi';
  g.log=pushLog(g.log, p.name+' 本回合首次受到伤害,询问 '+g.players[asking].name+' 是否发动【争义】替其承受…');
  return true;
}
function finishTianxiangTransfer(g, originalResume, originalSeat, drawSeat){
  const target=g.players[drawSeat];
  if(target && target.alive){
    const lost=Math.max(0, target.maxHp-target.hp);
    if(lost>0){
      drawN(g, drawSeat, lost);
      g.log=pushLog(g.log, target.name+' 因【天香】摸'+lost+'张牌');
    } else {
      g.log=pushLog(g.log, target.name+' 未损失体力,【天香】不摸牌');
    }
  }
  resumeAfterInterrupt(g, originalResume, originalSeat);
}
function wrapPendingForTianxiang(g, originalResume, originalSeat, drawSeat){
  if(g.pending && g.pending.resume){
    g.pending.resume={type:'tianxiang', inner:g.pending.resume, originalResume, originalSeat, drawSeat};
  }
}
function dealDamage(g, seat, amount, sourceSeat, reason, srcType, sourceCard, skipTianxiang, skipZhengyi){
  const p=g.players[seat];
  if(!p) return false;
  if(!skipZhengyi && maybeStartZhengyi(g, seat, amount, sourceSeat, reason, srcType, sourceCard)) return true;
  if(!skipTianxiang && maybeStartTianxiang(g, seat, amount, sourceSeat, reason, srcType, sourceCard)) return true;
  p.hp = Math.max(0, p.hp - amount);
  g.log=logEvent(g.log, { kind:'damage', actor:(Number.isInteger(sourceSeat)?sourceSeat:undefined), targets:[seat], text: p.name+(reason?' '+reason+',':' ')+'受到'+amount+'点伤害（体力'+p.hp+'）' });
  if(p.hp<=0){
    startDying(g, seat, srcType);
    return true; // 挂起:调用方立即 return,不做收尾(收尾延后到濒死解决时统一处理)
  }
  // 实际受伤且存活 -> 触发"受到伤害后"钩子(如郭嘉【遗计】)。srcType 标识伤害来源类型('sha'/'duel'/'aoe'/'delay'/'xiaoguo'),
  // 用于事后接回被打断的流程(见下)。
  if(amount>0){
    // 郭嘉【遗计】这类"受伤后可选发动、需要挂起等玩家决定"的钩子,和濒死求桃是同一类问题:
    // 钩子在 dealDamage 内部同步执行,而 dealDamage 的调用方几乎都有自己的收尾尾巴(如
    // respondShan 的 `g.pending=null;finishSingleShaTarget(g);`),如果钩子设了新 pending 却
    // 没有信号告诉调用方"别做你自己的收尾了",调用方的尾巴会在同一个 tx 里紧接着把这个新
    // pending 立刻覆盖掉,pending 从未真正对任何客户端可见过。这里用"钩子执行前后 g.pending
    // 引用是否变化"来判断钩子有没有开出一个需要打断当前流程的新 pending——钩子如果想要这个
    // 效果,必须真的重新赋值一个新对象给 g.pending(如 `g.pending={type:'yijiAsk',...}`),
    // 单纯读取/不动 g.pending 则不会误判。
    const pendingBefore = g.pending;
    const ctx={ amount, sourceSeat, srcType };
    if(sourceCard!==undefined) ctx.sourceCard=sourceCard;
    triggerHook(g, seat, 'onDamaged', ctx);
    if(g.pending !== pendingBefore) return true; // 钩子挂起了新 pending,调用方应立即 return,和濒死同一个约定
  }
  return false;
}
function respondTianxiang(choice, targetSeat){
  tx(g=>{
    if(g.phase!=='tianxiang'||!g.pending||g.pending.type!=='tianxiang'||g.pending.seat!==mySeat) return g;
    const d=g.pending;
    const me=g.players[mySeat];
    if(!me || !me.alive) return g;
    const originalResume=d.resume || {type:d.srcType};
    if(!choice){
      g.pending=null;
      const interrupted=dealDamage(g, d.seat, d.amount, d.sourceSeat, d.reason, d.srcType, d.sourceCard, true);
      if(interrupted) return g;
      resumeAfterInterrupt(g, originalResume, d.seat);
      return g;
    }
    const target=g.players[targetSeat];
    if(!target || !target.alive || targetSeat===d.seat || !(d.targets||[]).includes(targetSeat)) return g;
    const card=me.hand[choice.idx];
    if(!card || cardSuitForPlayer(me, card)!=='♥') return g;
    me.hand.splice(choice.idx,1);
    g.discard.push(card);
    g.pending=null;
    g.log=pushLog(g.log, me.name+' 弃置【'+card.name+'】发动【天香】,将此次伤害转移给 '+target.name);
    markSkillSound(g, '天香');
    const interrupted=dealDamage(g, targetSeat, d.amount, d.sourceSeat, d.reason || '【天香】转移', d.srcType, d.sourceCard, true);
    if(interrupted){
      wrapPendingForTianxiang(g, originalResume, d.seat, targetSeat);
      return g;
    }
    finishTianxiangTransfer(g, originalResume, d.seat, targetSeat);
    return g;
  });
}
function wrapPendingForZhengyi(g, originalResume, originalSeat){
  if(g.pending && g.pending.resume){
    g.pending.resume={type:'zhengyi', inner:g.pending.resume, originalResume, originalSeat};
  }
}
function respondZhengyi(activate){
  tx(g=>{
    if(g.phase!=='zhengyi'||!g.pending||g.pending.type!=='zhengyi'||g.pending.asking!==mySeat) return g;
    const d=g.pending;
    const kong=g.players[d.seat], me=g.players[mySeat];
    if(!kong || !kong.alive || !me || !me.alive) return g;
    const originalResume=d.resume || {type:d.srcType};
    g.pending=null;
    if(!activate){
      g.log=pushLog(g.log, me.name+'：不发动【争义】');
      const interrupted=dealDamage(g, d.seat, d.amount, d.sourceSeat, d.reason, d.srcType, d.sourceCard, false, true);
      if(interrupted) return g;
      resumeAfterInterrupt(g, originalResume, d.seat);
      return g;
    }
    g.log=pushLog(g.log, me.name+' 发动【争义】,替 '+kong.name+' 承受此次伤害');
    markSkillSound(g, '争义');
    const interrupted=dealDamage(g, mySeat, d.amount, d.sourceSeat, d.reason || '【争义】转移', d.srcType, d.sourceCard, false, true);
    if(interrupted){
      wrapPendingForZhengyi(g, originalResume, d.seat);
      return g;
    }
    resumeAfterInterrupt(g, originalResume, d.seat);
    return g;
  });
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
function useJijiuCard(g, me, choice){
  if(!choice || !hasCap(me,'jijiu') || g.turn===mySeat) return null;
  if(choice.kind==='hand'){
    const idx=choice.idx;
    const card=me.hand[idx];
    if(!card || !isRed(card)) return null;
    me.hand.splice(idx,1);
    g.discard.push(card);
    return card;
  }
  if(choice.kind==='equip'){
    const slot=choice.slot;
    if(!EQUIP_SLOTS.includes(slot) || !me.equips || !me.equips[slot] || !isRed(me.equips[slot])) return null;
    const card=me.equips[slot];
    me.equips[slot]=null;
    g.discard.push(card);
    triggerHook(g, mySeat, 'onLoseEquip', {count:1});
    return card;
  }
  return null;
}
function respondDying(useTao, jijiuChoice){
  tx(g=>{
    if(g.phase!=='dying'||!g.pending||g.pending.type!=='dying') return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || g.pending.asking!==mySeat) return g;
    const dyingP=g.players[g.pending.seat];
    if(useTao){
      let card;
      if(jijiuChoice){
        card=useJijiuCard(g, me, jijiuChoice);
        if(!card) return g;
      } else {
        const idx=findUsableAs(me.hand, me, '桃'); // 复用 canUseAs/findUsableAs seam,不硬编码牌名
        if(idx<0) return g; // 没有桃:状态不变(双重保险,按钮本就不该出现)
        card=me.hand.splice(idx,1)[0]; g.discard.push(card);
      }
      dyingP.hp++;
      const asTao = jijiuChoice ? '当【桃】' : '';
      g.log=pushLog(g.log, me.name+' 对 '+dyingP.name+' 打出【'+card.name+'】'+asTao+',回复1点体力（体力'+dyingP.hp+'）');
      if(jijiuChoice) markSkillSound(g, '急救');
      markCardSound(g, '桃', mySeat, card, g.pending.seat);
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
function useNiepan(){
  tx(g=>{
    if(g.phase!=='dying'||!g.pending||g.pending.type!=='dying'||g.pending.seat!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'niepan') || me.nirvanaUsed) return g;
    const equipCards = EQUIP_SLOTS.map(s=> me.equips && me.equips[s]).filter(Boolean);
    const delayCards = me.delays || [];
    if((me.hand||[]).length) g.discard.push(...me.hand);
    if(equipCards.length) g.discard.push(...equipCards);
    if(delayCards.length) g.discard.push(...delayCards);
    me.hand=[];
    me.equips=emptyEquips();
    me.delays=[];
    me.chained=false;
    me.turnedOver=false;
    me.nirvanaUsed=true;
    me.hp=Math.min(me.maxHp, 3);
    drawN(g, mySeat, 3);
    g.log=pushLog(g.log, me.name+' 发动限定技【涅槃】,弃置所有牌,复原武将牌,摸3张牌并回复至'+me.hp+'点体力');
    markSkillSound(g, '涅槃');
    finishDying(g, false);
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
  resumeAfterInterrupt(g, resume, seat);
}
// resumeAfterInterrupt: "临时打断了原有流程、事后要接回被打断那条流程尾巴"这类场景的统一
// 出口——目前有两个来源会走到这里:①濒死解决(finishDying,可能真死也可能被救回);
// ②郭嘉【遗计】的可选发动结算完毕(不会死人,但同样需要接回被打断的流程)。两者的 resume
// 结构完全一致(`{type:srcType,...}`,取值就是 dealDamage 的 srcType 参数,'delay'/'xiaoguo'
// 需要额外字段,由各自的挂起入口负责补全——见 continueDelayResolution/finishGuicai 的
// delayJudge 分支/respondXiaoguoChoice),seat 是被打断的那个人(dealDamage 的 seat 参数,
// 也就是 resume.type==='sha'/'duel'/'aoe' 时这里需要的那个座位号)。
function resumeAfterInterrupt(g, resume, seat){
  if(resume.type==='ganglie'){
    resumeAfterInterrupt(g, resume.resume, resume.seat);
  } else if(resume.type==='tianxiang'){
    finishTianxiangTransfer(g, resume.originalResume, resume.originalSeat, resume.drawSeat);
  } else if(resume.type==='zhengyi'){
    resumeAfterInterrupt(g, resume.originalResume, resume.originalSeat);
  } else if(resume.type==='duel'){
    if(!g.players[g.turn].alive){
      startTurn(g, nextAlive(g, g.turn));
    } else {
      g.phase='play';
    }
  } else if(resume.type==='aoe'){
    aoeAdvance(g, seat);
  } else if(resume.type==='delay'){
    // 判定区的牌(如闪电)致命挂起后的接回:真死了就换到下一个存活玩家的回合(该玩家的判定阶段
    // 从头 startTurn);被桃救回(或郭嘉遗计这种非致命打断)就继续处理这位玩家判定区剩余的牌
    // (可能再次挂起濒死或鬼才或遗计,机制天然支持连续多次——具体怎么继续、怎么区分新挂起的
    // 类型,见 continueDelayResolution)。
    if(!g.players[resume.seat].alive){
      startTurn(g, nextAlive(g, resume.seat));
    } else {
      continueDelayResolution(g, resume.seat);
    }
  } else if(resume.type==='xiaoguo'){
    // 骁果"受到1点伤害"选项致命挂起(或遗计这种非致命打断)后的接回:不管目标是否真死,都
    // 继续找下一个有资格的候选乐进(或最终真正切换回合)——resume 在 respondXiaoguoChoice
    // 里已经带上完整信息。
    advanceXiaoguo(g, resume.endingSeat, resume.lastAsker);
  } else if(resume.type==='kurou'){
    // 黄盖【苦肉】主动自伤后的接回:若濒死被救回,继续摸两张;若真死且游戏未结束,轮到下个存活玩家。
    if(!g.players[seat] || !g.players[seat].alive){
      startTurn(g, nextAlive(g, seat));
    } else {
      drawN(g, seat, 2);
      g.log=pushLog(g.log, g.players[seat].name+' 【苦肉】结算,摸两张牌');
      g.phase='play';
    }
  } else if(resume.type==='quhu' || resume.type==='fanjian'){
    if(g.players[g.turn] && g.players[g.turn].alive) g.phase='play';
    else startTurn(g, nextAlive(g, g.turn));
  } else { // 'sha' 及其它:攻击者继续出牌阶段——若这是方天画戟排队目标中的一个,继续问下一个而不是直接回play
    if(g.fangtianQueue){ advanceFangtianQueue(g); } else { g.phase='play'; }
  }
}
// ===== 荀彧【驱虎/节命】:拼点与受伤后补牌 =====
function pointText(card){ return card ? card.suit+rankText(card.rank)+'【'+card.name+'】' : '?'; }
function quhuDamageTargets(g, targetSeat){
  return g.players.map((p,i)=>({p,i}))
    .filter(o=>o.p && o.p.alive && o.i!==targetSeat && canReachSha(g, targetSeat, o.i))
    .map(o=>o.i);
}
function finishQuhu(g){
  g.pending=null;
  if(checkWin(g)) return;
  g.phase='play';
}
function quHu(cardIdx, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat], target=g.players[targetSeat];
    if(!me || !target || !me.alive || !target.alive || !hasCap(me,'quhu') || g.quHuUsed) return g;
    if(targetSeat===mySeat || target.hp<=me.hp || (me.hand||[]).length===0 || (target.hand||[]).length===0) return g;
    const card=me.hand[cardIdx];
    if(!card) return g;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    g.quHuUsed=true;
    g.pending={type:'quhuRespond', seat:mySeat, targetSeat, selfCard:card};
    g.phase='quhuRespond';
    g.log=pushLog(g.log, me.name+' 发动【驱虎】,与 '+target.name+' 拼点');
    markSkillSound(g, '驱虎');
    return g;
  });
}
function respondQuhu(cardIdx){
  tx(g=>{
    if(g.phase!=='quhuRespond'||!g.pending||g.pending.type!=='quhuRespond'||g.pending.targetSeat!==mySeat) return g;
    const {seat, targetSeat, selfCard}=g.pending;
    const xun=g.players[seat], target=g.players[targetSeat];
    if(!xun || !target || !xun.alive || !target.alive){ finishQuhu(g); return g; }
    const card=target.hand[cardIdx];
    if(!card) return g;
    target.hand.splice(cardIdx,1);
    g.discard.push(card);
    const quhuWin = (selfCard.rank||0) > (card.rank||0);
    g.log=pushLog(g.log, xun.name+' 出 '+pointText(selfCard)+',对方 '+target.name+' 出 '+pointText(card)+',拼点'+(quhuWin?'荀彧赢':'荀彧没赢'));
    if(quhuWin){
      const targets=quhuDamageTargets(g, targetSeat);
      if(targets.length===0){
        g.log=pushLog(g.log, '但 '+target.name+' 攻击范围内没有可伤害目标');
        finishQuhu(g);
        return g;
      }
      g.pending={type:'quhuDamageChoice', seat, targetSeat, targets};
      g.phase='quhuDamageChoice';
      g.log=pushLog(g.log, '选择 '+target.name+' 攻击范围内一名角色受到1点伤害');
      return g;
    }
    g.log=pushLog(g.log, target.name+' 对其造成1点伤害');
    g.pending=null;
    const interrupted=dealDamage(g, seat, 1, targetSeat, '【驱虎】', 'quhu');
    if(interrupted){
      if(g.pending) g.pending.resume={type:'quhu'};
      return g;
    }
    if(checkWin(g)) return g;
    g.phase='play';
    return g;
  });
}
function respondQuhuDamage(targetSeat){
  tx(g=>{
    if(g.phase!=='quhuDamageChoice'||!g.pending||g.pending.type!=='quhuDamageChoice'||g.pending.seat!==mySeat) return g;
    const {targetSeat:sourceSeat, targets}=g.pending;
    if(!Array.isArray(targets) || !targets.includes(targetSeat)) return g;
    const source=g.players[sourceSeat], target=g.players[targetSeat];
    if(!source || !target || !source.alive || !target.alive){ finishQuhu(g); return g; }
    g.pending=null;
    const interrupted=dealDamage(g, targetSeat, 1, sourceSeat, '【驱虎】', 'quhu');
    if(interrupted){
      if(g.pending) g.pending.resume={type:'quhu'};
      return g;
    }
    if(checkWin(g)) return g;
    g.phase='play';
    return g;
  });
}
function finishJieming(g, resume, seat){
  g.pending=null;
  if(checkWin(g)) return;
  resumeAfterInterrupt(g, resume, seat);
}
function continueJieming(g, seat, remaining, resume){
  if(remaining>0 && g.players[seat] && g.players[seat].alive){
    g.pending={type:'jiemingAsk', seat, remaining, resume};
    g.phase='jiemingAsk';
    g.log=pushLog(g.log, g.players[seat].name+' 是否继续发动【节命】('+remaining+'次)…');
  } else {
    finishJieming(g, resume, seat);
  }
}
function respondJieming(targetSeat){
  tx(g=>{
    if(g.phase!=='jiemingAsk'||!g.pending||g.pending.type!=='jiemingAsk'||g.pending.seat!==mySeat) return g;
    const {seat, remaining, resume}=g.pending;
    const self=g.players[seat];
    if(targetSeat===null || targetSeat===undefined){
      g.log=pushLog(g.log, self.name+'：不发动【节命】');
      continueJieming(g, seat, remaining-1, resume);
      return g;
    }
    const target=g.players[targetSeat];
    if(!target || !target.alive) return g;
    const limit=Math.min(target.maxHp, 5);
    const n=Math.max(0, limit-(target.hand||[]).length);
    if(n>0) drawN(g, targetSeat, n);
    g.log=pushLog(g.log, self.name+' 发动【节命】,令 '+target.name+(n>0?' 摸'+n+'张牌':' 手牌已达上限,不摸牌'));
    markSkillSound(g, '节命');
    continueJieming(g, seat, remaining-1, resume);
    return g;
  });
}
// ===== 夏侯惇【刚烈】:受伤后可选判定,非红桃则伤害来源弃2手牌或受1点伤害 =====
function finishGanglie(g, resume, seat){
  g.pending=null;
  if(checkWin(g)) return;
  resumeAfterInterrupt(g, resume, seat);
}
function dealGanglieDamage(g, seat, sourceSeat, resume){
  const source=g.players[sourceSeat];
  const self=g.players[seat];
  if(!source || !source.alive || !self || !self.alive){
    finishGanglie(g, resume, seat);
    return;
  }
  g.pending=null;
  const interrupted=dealDamage(g, sourceSeat, 1, seat, '【刚烈】', 'ganglie');
  if(interrupted){
    if(g.pending) g.pending.resume={type:'ganglie', resume, seat};
    return;
  }
  if(checkWin(g)) return;
  resumeAfterInterrupt(g, resume, seat);
}
function finishGanglieJudge(g, card, seat, sourceSeat, resume){
  const self=g.players[seat];
  const source=g.players[sourceSeat];
  if(card) maybeTiandu(g, seat, card);
  if(card && card.suit==='♥'){
    g.log=pushLog(g.log, (self?self.name:'夏侯惇')+' 【刚烈】判定为红桃,无事发生');
    finishGanglie(g, resume, seat);
    return;
  }
  if(!source || !source.alive){
    g.log=pushLog(g.log, (self?self.name:'夏侯惇')+' 【刚烈】判定不为红桃,但伤害来源已不存在');
    finishGanglie(g, resume, seat);
    return;
  }
  if((source.hand||[]).length<2){
    g.log=pushLog(g.log, source.name+' 手牌不足2张,必须受到【刚烈】伤害');
    dealGanglieDamage(g, seat, sourceSeat, resume);
    return;
  }
  g.pending={type:'ganglieChoice', seat, sourceSeat, resume};
  g.phase='ganglieChoice';
  g.log=pushLog(g.log, source.name+' 需选择弃置2张手牌或受到1点【刚烈】伤害');
}
function respondGanglieAsk(activate){
  tx(g=>{
    if(g.phase!=='ganglieAsk'||!g.pending||g.pending.type!=='ganglieAsk'||g.pending.seat!==mySeat) return g;
    const {seat, sourceSeat, resume}=g.pending;
    const self=g.players[seat];
    if(!activate){
      g.log=pushLog(g.log, self.name+'：不发动【刚烈】');
      finishGanglie(g, resume, seat);
      return g;
    }
    g.log=pushLog(g.log, self.name+' 发动【刚烈】');
    markSkillSound(g, '刚烈');
    const card=judge(g);
    if(!card){
      finishGanglie(g, resume, seat);
      return g;
    }
    if(maybeGuicai(g, seat, card, {kind:'ganglieJudge', seat, sourceSeat, resume})==='pending') return g;
    finishGanglieJudge(g, card, seat, sourceSeat, resume);
    return g;
  });
}
function respondGanglieChoice(action, picks){
  tx(g=>{
    if(g.phase!=='ganglieChoice'||!g.pending||g.pending.type!=='ganglieChoice'||g.pending.sourceSeat!==mySeat) return g;
    const {seat, sourceSeat, resume}=g.pending;
    const source=g.players[sourceSeat];
    if(!source || !source.alive){
      finishGanglie(g, resume, seat);
      return g;
    }
    if(action==='discard'){
      if(!Array.isArray(picks) || picks.length!==2 || new Set(picks).size!==2 || (source.hand||[]).length<2) return g;
      const idxs=picks.map(x=>Number(x));
      if(idxs.some(x=>!Number.isInteger(x) || x<0 || x>=source.hand.length)) return g;
      idxs.sort((a,b)=>b-a).forEach(idx=>g.discard.push(source.hand.splice(idx,1)[0]));
      g.log=pushLog(g.log, source.name+' 弃置2张手牌,抵消【刚烈】伤害');
      finishGanglie(g, resume, seat);
      return g;
    }
    if(action==='damage'){
      dealGanglieDamage(g, seat, sourceSeat, resume);
    }
    return g;
  });
}
// ===== 郭嘉【遗计】:受伤后可选发动,看牌堆顶2张、分给任意角色(含自己) =====
// respondYijiAsk: 仅本人(pending.seat)可响应。不发动/发动都要用 resumeAfterInterrupt 接回被
// 打断的流程(resume 是 onDamaged 钩子里存的 {type:srcType,...},和濒死解决同一套约定)——
// 不能像最初设想那样硬编码 phase='play',因为遗计可能在决斗/AOE/延时锦囊判定/骁果等非
// "出牌阶段互殴"的场景中触发,这些场景各自需要接回不同的尾巴。
function respondYijiAsk(activate){
  tx(g=>{
    if(g.phase!=='yijiAsk'||!g.pending||g.pending.type!=='yijiAsk'||g.pending.seat!==mySeat) return g;
    const seat=mySeat, resume=g.pending.resume;
    if(!activate){
      g.log=pushLog(g.log, g.players[seat].name+'：不发动【遗计】');
      g.pending=null;
      if(checkWin(g)) return g;
      resumeAfterInterrupt(g, resume, seat);
      return g;
    }
    const n = Math.min(2, (g.deck||[]).length);
    if(n===0){ // 双重保险,理论上 onDamaged 已经拦过(牌堆空时钩子根本不会挂起这个 pending)
      g.pending=null;
      if(checkWin(g)) return g;
      resumeAfterInterrupt(g, resume, seat);
      return g;
    }
    const cards = g.deck.splice(0, n); // 从牌堆顶取,不进日志(私密信息)
    g.pending = { type:'yijiAssign', seat, cards, resume };
    g.phase='yijiAssign';
    g.log=pushLog(g.log, g.players[seat].name+' 发动【遗计】,正在分配牌…'); // 不写牌面
    markSkillSound(g, '遗计');
    return g;
  });
}
// respondYijiAssign: 仅本人可响应。assignments 是长度等于 cards.length 的座位号数组(cards[i]
// 交给 assignments[i]),可以重复(都给自己/都给同一人/分给不同人都合法)。
function respondYijiAssign(assignments){
  tx(g=>{
    if(g.phase!=='yijiAssign'||!g.pending||g.pending.type!=='yijiAssign'||g.pending.seat!==mySeat) return g;
    const {cards, resume}=g.pending;
    if(!Array.isArray(assignments) || assignments.length!==cards.length) return g;
    for(const seat of assignments){
      const tgt=g.players[seat];
      if(!tgt || !tgt.alive) return g; // 任一目标非法/已阵亡,整体拒绝,状态不变(双重保险)
    }
    assignments.forEach((seat, i)=>{ g.players[seat].hand.push(cards[i]); });
    g.log=pushLog(g.log, g.players[mySeat].name+' 【遗计】分配了'+cards.length+'张牌给 '+assignments.map(s=>g.players[s].name).join('、'));
    g.pending=null;
    if(checkWin(g)) return g;
    resumeAfterInterrupt(g, resume, mySeat);
    return g;
  });
}
// ===== 方天画戟:队列驱动的多目标杀,共用出口 =====
// finishSingleShaTarget: 一个目标的杀响应/判定彻底结束时统一走这里(毅重/仁王盾无效、八卦阵/鬼才改判
// 红色抵消、respondShan 出闪或命中受伤后的共用尾巴,均改走这个出口)——先 checkWin,再看 g.fangtianQueue
// 是否还有排队中的下一个目标,有则继续,没有(或本来就不是方天画戟触发的)才真正回到出牌阶段。
function finishSingleShaTarget(g){
  if(checkWin(g)) return;
  if(g.fangtianQueue){ advanceFangtianQueue(g); } else { g.phase='play'; }
}
// advanceFangtianQueue: 推进到方天画戟队列里的下一个目标,重新走一遍完整的 resolveShaUse(毅重/仁王盾/
// 铁骑/烈弓/青釭剑/八卦阵/响应阶段全部照常各自独立判定)。跳过中途已阵亡的排队目标(防御性,理论上
// 现有效果里没有会让排队目标之间互相致死的连锁,但仍做兜底)。问完/没有更多目标则清空队列回到出牌阶段。
function advanceFangtianQueue(g){
  const q=g.fangtianQueue;
  q.idx++;
  while(q.idx<q.targets.length && (!g.players[q.targets[q.idx]] || !g.players[q.targets[q.idx]].alive)) q.idx++;
  if(q.idx>=q.targets.length){ g.fangtianQueue=null; g.phase='play'; return; }
  resolveShaUse(g, g.players[q.from], q.targets[q.idx], q.usedAs, q.shaColor, q.sourceCard);
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
// duelResponse: 决斗响应。吕布【无双】(锁定技)是"跟吕布决斗的对方每轮需连续打出两张杀,
// 吕布自己始终只需一张"——不是"决斗涉及吕布,双方都要两张"。所以 needed 不能只看
// "决斗双方有没有人是吕布",必须看"当前正要出杀的这个人(mySeat)是不是吕布本人":
// 是吕布本人 -> 恒为1;不是吕布本人、且这场决斗的对方是吕布 -> 2;都不是吕布 -> 1。
// g.pending.shaCount 记这一轮已出几张,换人时归零重新计数。选择认输就按原逻辑直接受伤,已出的杀不退回。
function duelResponse(useSha){
  tx(g=>{
    if(g.phase!=='duel'||!g.pending||g.pending.active!==mySeat) return g;
    const me=g.players[mySeat];
    const opp=(mySeat===g.pending.from)?g.pending.to:g.pending.from;
    const needed = (!hasCap(me,'wushuang') && hasCap(g.players[opp],'wushuang')) ? 2 : 1;
    if(useSha){
      const idx=findUsableAs(me.hand,me,'杀'); // 龙胆:闪可当杀,优先用本名杀
      if(idx<0) return g;
      const card=me.hand.splice(idx,1)[0]; g.discard.push(card);
      // 官方FAQ:决斗中打出杀同样破坏吕蒙【克己】。但这里不能置 g.shaUsed——g.shaUsed 还兼管
      // "出牌阶段主动出杀次数限制",若置真会导致玩家在自己出牌阶段决斗打杀后再也出不了杀(真实bug)。
      // 改用独立标志 g.shaPlayedInDuel 只服务于克己判断,不碰出杀次数。
      g.shaPlayedInDuel=true;
      const played=(g.pending.shaCount||0)+1;
      g.log=pushLog(g.log, me.name+(card.name==='杀'?' 打出【杀】':' 打出【'+card.name+'】当【杀】')+(needed>1?'（'+played+'/'+needed+'）':''));
      markCardSound(g, '杀', mySeat, card, opp);
      if(card.name!=='杀'){ if(hasCap(me,'longdan')) markSkillSound(g,'龙胆'); else if(hasCap(me,'wusheng')) markSkillSound(g,'武圣'); }
      if(played<needed){ g.pending.shaCount=played; return g; } // 吕布【无双】:这一轮还没出满,留在同一个人身上
      g.pending.active = (mySeat===g.pending.from)?g.pending.to:g.pending.from;
      g.pending.shaCount = 0; // 换人,计数归零重新开始
      return g;
    }
    // 认输：受伤
    // sourceSeat 传 opp(决斗中的对方),不能传 g.pending.from——认输的可能是发起者本人,
    // 那种情况下 sourceSeat 必须是对手而不是受害者自己,否则司马懿【反馈】等依赖伤害来源的技能会出错。
    const dying = dealDamage(g, mySeat, damageAmount(g, opp, 1, 'duel'), opp, '不出【杀】', 'duel', g.pending.sourceCard);
    if(dying) return g; // 濒死流程接管,后续(轮转/阶段)延后到 finishDying 处理
    g.pending=null;
    g.exchangeCards=[]; // 决斗结束(认输一方受伤):清空持续展示,恢复单次出牌的原有淡入淡出
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
  if(info.sourceCard!==undefined) g.pending.sourceCard=info.sourceCard;
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
  const verb = g.pending.depth>0 ? '反制' : '使用';
  g.log=pushLog(g.log, '询问 '+g.players[asking].name+' 是否'+verb+'【无懈可击】…');
}
// finishWuxieRound: 一轮问完无人再出(或问不到人)时收尾。depth 奇数=原锦囊/该 AOE 目标作废,
// 偶数(含0,从未被无懈或被反制回来)=正常生效。ctx==='aoe' 时走群体锦囊自己的推进函数。
function finishWuxieRound(g){
  const info={trick:g.pending.trick, from:g.pending.from, to:g.pending.to, card:g.pending.card, sourceCard:g.pending.sourceCard, seatB:g.pending.seatB, pool:g.pending.pool};
  const blocked = (g.pending.depth % 2)===1;
  if(g.pending.ctx==='aoe'){
    if(blocked){ aoeAdvance(g, info.to); } else { startAoeRespond(g, info.to); }
  } else {
    if(blocked){
      if(info.trick==='铁索连环' && g.tiesuoQueue){
        g.pending=null;
        advanceTieSuoQueue(g);
        return;
      }
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
    if(info.sourceCard!==undefined) g.pending.sourceCard=info.sourceCard;
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
  if(info.trick==='铁索连环'){
    if(!tgt || !tgt.alive){
      g.pending=null;
      if(g.tiesuoQueue) advanceTieSuoQueue(g);
      else g.phase='play';
      return;
    }
    tgt.chained=!tgt.chained;
    g.log=pushLog(g.log, tgt.name+(tgt.chained?' 进入连环状态':' 解除连环状态'));
    g.pending=null;
    if(g.tiesuoQueue) advanceTieSuoQueue(g);
    else g.phase='play';
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
  // + 判定区每张延时锦囊(公开,各1个具体选项,官方规则明确判定区也在可选范围内)
  if(!tgt || !tgt.alive){ g.pending=null; g.phase='play'; return; }
  const handCount=(tgt.hand||[]).length;
  const equipSlots=EQUIP_SLOTS.filter(s=>tgt.equips[s]);
  const delayCount=(tgt.delays||[]).length;
  const optCount=(handCount>0?1:0)+equipSlots.length+delayCount;
  if(optCount===0){
    g.log=pushLog(g.log, tgt.name+' 没有手牌、装备或判定区的牌,【'+info.trick+'】无效果');
    g.pending=null; g.phase='play'; return;
  }
  if(optCount===1){
    // 唯一选择:免弹窗直接结算
    if(handCount>0) applyTrickOnHand(g, info);
    else if(equipSlots.length>0) applyTrickOnEquip(g, info, equipSlots[0]);
    else applyTrickOnDelay(g, info, 0);
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
// applyTrickOnDelay: 拿/拆目标判定区里第idx张延时锦囊。判定区是公开信息 -> 日志写明牌名。
// 顺手拿到的延时锦囊进使用者手牌后就是一张普通牌(和普通规则一致,可以再次正常打出使用)。
function applyTrickOnDelay(g, info, idx){
  const tgt=g.players[info.to];
  const card=(tgt.delays||[])[idx]; if(!card) return;
  tgt.delays.splice(idx,1);
  const me=g.players[info.from];
  if(info.trick==='顺手牵羊'){ me.hand.push(card); g.log=pushLog(g.log, me.name+' 顺走 '+tgt.name+' 判定区的【'+card.name+'】'); }
  else { g.discard.push(card); g.log=pushLog(g.log, me.name+' 拆掉 '+tgt.name+' 判定区的【'+card.name+'】'); }
}
// pickResolve: 选牌子阶段结算。choice='hand' 或装备槽名 或 'delay:'+下标(判定区第几张)。
// 仅使用者可操作;失效项(手牌已空/槽已空/判定区那张已不在)安全回 play 防软锁。
function pickResolve(choice){
  tx(g=>{
    if(g.phase!=='pick'||!g.pending||g.pending.type!=='pick'||g.pending.from!==mySeat) return g;
    const info={trick:g.pending.trick, from:g.pending.from, to:g.pending.to};
    const tgt=g.players[info.to];
    if(!tgt || !tgt.alive){ g.pending=null; g.phase='play'; return g; }
    if(choice==='hand'){
      if((tgt.hand||[]).length===0){ g.pending=null; g.phase='play'; return g; } // 失效兜底
      applyTrickOnHand(g, info);
    } else if(typeof choice==='string' && choice.startsWith('delay:')){
      const idx=Number(choice.slice(6));
      if(!Number.isInteger(idx) || !(tgt.delays||[])[idx]){ g.pending=null; g.phase='play'; return g; } // 失效兜底
      applyTrickOnDelay(g, info, idx);
    } else {
      if(!EQUIP_SLOTS.includes(choice) || !tgt.equips[choice]){ g.pending=null; g.phase='play'; return g; } // 失效兜底
      applyTrickOnEquip(g, info, choice);
    }
    g.pending=null; g.phase='play';
    return g;
  });
}
// ===== 寒冰剑:杀命中造成伤害之前,攻击者可选择防止伤害、改为弃置目标两张牌 =====
// hanbingDiscardCount: 目标手牌+装备区加起来还有几张牌可弃(0~n)。respondShan 里用来判断
// "目标完全没有牌可弃"这种不能发动的边界,不能弹出一个没什么可弃的空询问。
function hanbingDiscardCount(p){ return (p.hand||[]).length + EQUIP_SLOTS.filter(s=>p.equips&&p.equips[s]).length; }
// respondHanbingAsk: 仅 pending.from(装备寒冰剑的攻击者)可响应。不发动:补上正常伤害流程
// (和 respondShan 的"不闪"分支完全一致的一套收尾,只是挪到这个新函数里,因为已经隔了一次
// 网络往返,不能再指望原来那个 tx 调用里的共用尾巴)。发动:不造成任何伤害,直接进入弃牌
// 循环(startHanbingRound,round 从 0 开始)。
function respondHanbingAsk(activate){
  tx(g=>{
    if(g.phase!=='hanbingAsk'||!g.pending||g.pending.type!=='hanbingAsk'||g.pending.from!==mySeat) return g;
    const from=mySeat, to=g.pending.to;
    if(!activate){
      g.log=pushLog(g.log, g.players[from].name+'：不发动【寒冰剑】');
      const sourceCard=g.pending.sourceCard;
      g.pending=null;
      const dying = dealDamage(g, to, damageAmount(g, from, 1, 'sha'), from, '不闪', 'sha', sourceCard);
      if(dying) return g;
      if(maybeStartQilin(g, from, to)) return g;
      if(checkWin(g)) return g;
      g.phase='play';
      return g;
    }
    g.log=pushLog(g.log, g.players[from].name+' 发动【寒冰剑】,防止伤害,改为弃置 '+g.players[to].name+' 的牌');
    g.pending=null;
    startHanbingRound(g, from, to, 0);
    return g;
  });
}
// startHanbingRound: (重新)计算目标这一刻还有什么可弃——0个直接收尾(不管是第一轮就没有,
// 还是弃完第一张后目标没牌了);1个免弹窗自动弃这一个(和 pick 阶段"唯一选择直接结算"
// 同一个惯例),弃完继续问下一轮;2个以上才真正开 pending 问攻击者选。round 到 2 就收尾——
// "对方2张以上必须弃满两轮,不足两张弃光为止",不存在"弃1张就不弃了"这个中途停下的选项。
function startHanbingRound(g, from, to, round){
  const tgt=g.players[to];
  if(!tgt || !tgt.alive || round>=2){ finishHanbing(g); return; }
  const handCount=(tgt.hand||[]).length;
  const equipSlots=EQUIP_SLOTS.filter(s=>tgt.equips[s]);
  const optCount=(handCount>0?1:0)+equipSlots.length;
  if(optCount===0){ finishHanbing(g); return; }
  if(optCount===1){
    const info={trick:'寒冰剑', from, to};
    if(handCount>0) applyTrickOnHand(g, info); else applyTrickOnEquip(g, info, equipSlots[0]);
    startHanbingRound(g, from, to, round+1);
    return;
  }
  g.pending={type:'hanbing', from, to, round};
  g.phase='hanbing';
  g.log=pushLog(g.log, '等待 '+g.players[from].name+' 选择弃置 '+tgt.name+' 的第'+(round+1)+'张牌…');
}
function finishHanbing(g){
  g.pending=null;
  if(checkWin(g)) return;
  g.phase='play';
}
// hanbingPick: 弃牌子阶段结算。choice='hand' 或槽名,复用 applyTrickOnHand/applyTrickOnEquip
// (info.trick='寒冰剑' 不等于'顺手牵羊',天然落到"弃入弃牌堆"分支,这两个函数不用改一行)。
// 仅使用者(pending.from)可操作;失效项(手牌已空/槽已空)安全收尾防软锁。弃完这一张后继续
// 调用 startHanbingRound 进入下一轮(可能自动弃/可能再问/可能直接收尾)。
function hanbingPick(choice){
  tx(g=>{
    if(g.phase!=='hanbing'||!g.pending||g.pending.type!=='hanbing'||g.pending.from!==mySeat) return g;
    const {from,to,round}=g.pending;
    const tgt=g.players[to];
    if(!tgt || !tgt.alive){ finishHanbing(g); return g; }
    const info={trick:'寒冰剑', from, to};
    if(choice==='hand'){
      if((tgt.hand||[]).length===0){ finishHanbing(g); return g; } // 失效兜底
      applyTrickOnHand(g, info);
    } else {
      if(!EQUIP_SLOTS.includes(choice) || !tgt.equips[choice]){ finishHanbing(g); return g; } // 失效兜底
      applyTrickOnEquip(g, info, choice);
    }
    startHanbingRound(g, from, to, round+1);
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
      // 这张牌是 splice 结果直接扔进弃牌堆、没有留局部变量(不为了传参新增变量),card 留空。
      markCardSound(g, '无懈可击', mySeat);
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
    g.exchangeCards=[]; // 交换动作结束:清空持续展示,之后新的单次出牌恢复原来的单槽位淡入淡出
    g.log=pushLog(g.log, '【群体锦囊】结算完毕');
    return;
  }
  // 对该目标开启无懈询问子阶段(exclude/depth 初始化,交给 openWuxieRound 统一处理)
  g.pending={type:'wuxie', ctx:'aoe', trick:g.aoe.trick, from, to:next, exclude:from, depth:0};
  if(g.aoe.sourceCard!==undefined) g.pending.sourceCard=g.aoe.sourceCard;
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
  if(g.aoe.sourceCard!==undefined) g.pending.sourceCard=g.aoe.sourceCard;
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
      markCardSound(g, need, mySeat, card);
      if(card.name!==need){
        if(hasCap(me,'longdan')) markSkillSound(g,'龙胆');
        else if(need==='杀' && hasCap(me,'wusheng')) markSkillSound(g,'武圣');
      }
      aoeAdvance(g, mySeat);
      return g;
    }
    // 不出:受到1点伤害
    const dying = dealDamage(g, mySeat, 1, g.pending.from, '未打出【'+need+'】', 'aoe', g.aoe.sourceCard);
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
      markCardSound(g, '闪', mySeat, card);
      if(card.name!=='闪' && hasCap(me,'longdan')) markSkillSound(g,'龙胆');
      if(played<needed){ g.pending.shanCount=played; return g; } // 吕布【无双】:还不够,留在原地再问一次
      // 青龙偃月刀:杀被闪抵消,装备者(攻击者)可选择再对同一目标使用一张杀——不计入 g.shaUsed
      // 次数限制、无距离限制(官方原文括号里明确写了),只在攻击者手里确实有能当杀的牌时才问
      // (没有可用牌就不弹出这个询问,直接走下面原有的收尾,不会卡在一个按不动的死胡同界面)。
      // 如果这次追加的杀又被闪抵消,会再次落到这里、再问一次——不需要额外写"连续触发"的循环
      // 逻辑,这是同一段代码天然支持的效果,触发上限由攻击者手里还有没有牌能当杀这个客观条件封顶。
      if(maybeStartQinglong(g, g.pending.from, mySeat)) return g;
      // 贯石斧:杀被闪抵消(不管这个闪是实体牌/龙胆转化/倾国转化,触发条件只看"是否被闪挡下",
      // 不是"是否用了防具"——仁王盾/毅重让杀直接判无效,根本不会走到这个分支,不需要额外排除)。
      // 青龙偃月刀和贯石斧都装在同一个武器槽,互斥,不会同时满足两个 if。
      if(maybeStartGuanshifu(g, g.pending.from, mySeat, g.pending.sourceCard)) return g;
    } else {
      // 寒冰剑:杀命中造成伤害之前,装备者(攻击者)可选择防止此伤害、改为弃置目标两张牌——
      // 目标(mySeat,这一刻要受伤的人)完全没有牌可弃时不能发动,直接走原有的正常受伤流程,
      // 不弹出一个"发动了但没什么可弃"的空询问。
      const attackerHan=g.players[g.pending.from];
      if(hasCap(attackerHan,'hanbing') && hanbingDiscardCount(me)>0){
        const sourceCard=g.pending.sourceCard;
        g.pending={type:'hanbingAsk', from:g.pending.from, to:mySeat};
        if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
        g.phase='hanbingAsk';
        g.log=pushLog(g.log, attackerHan.name+' 是否发动【寒冰剑】,防止伤害,改为弃置 '+me.name+' 两张牌…');
        return g;
      }
      // 古锭刀:锁定技,自动生效,不问是否发动——命中这一刻(不是出杀那一刻)检查目标手牌数,
      // 若此刻恰好无手牌则这次伤害+1。整体按一次 dealDamage 调用结算(amount 先算好再传),
      // 不拆成两次调用,这样依赖"这次伤害共多少点"的钩子(如郭嘉【天妒】)才能看到正确数值。
      const gudingBonus = hasCap(attacker,'gudingdao') && (me.hand||[]).length===0 ? 1 : 0;
      const dying = dealDamage(g, mySeat, damageAmount(g, g.pending.from, 1+gudingBonus, 'sha'), g.pending.from, '不闪', 'sha', g.pending.sourceCard);
      if(dying) return g; // 濒死流程接管,后续(pending清空/checkWin/phase=play)延后到 finishDying 处理
      // 麒麟弓:杀造成实际伤害且目标存活 → 弃目标坐骑;两匹时开选马子阶段(此处提前返回,交给 qilinResolve,不做收尾)
      if(maybeStartQilin(g, g.pending.from, mySeat)) return g;
    }
    g.pending=null;
    finishSingleShaTarget(g); // 单个目标响应完毕:方天画戟排队中还有下一个则继续,否则回到出牌阶段
    return g;
  });
}
// respondQinglong: 仅攻击者(pending.from,也就是青龙偃月刀的装备者)可响应。不发动:直接走
// 和 respondShan 共用尾巴一致的收尾(清 pending、判胜负、回到出牌阶段)。发动:选一张能当杀
// 的手牌(目标固定是原目标 pending.to,不需要重新选目标),整张走 resolveShaUse 完整流程——
// 不占用 g.shaUsed(不计入出杀次数限制)、不做距离校验(官方原文明确无距离限制)。
function respondQinglong(activate, cardIdx){
  tx(g=>{
    if(g.phase!=='qinglong'||!g.pending||g.pending.type!=='qinglong'||g.pending.from!==mySeat) return g;
    const me=g.players[mySeat]; // 攻击者本人(装备者)
    const targetSeat=g.pending.to;
    if(!activate){
      g.log=pushLog(g.log, me.name+'：不发动【青龙偃月刀】');
      g.pending=null;
      if(checkWin(g)) return g;
      g.phase='play';
      return g;
    }
    const card=me.hand[cardIdx];
    if(!card || !canUseAs(me,card,'杀')) return g; // 没这张牌/不能当杀:状态不变(双重保险)
    me.hand.splice(cardIdx,1); g.discard.push(card);
    g.shaUsed=true; // 青龙偃月刀连续杀本质是又使用了一张杀,同样计入出杀次数限制/破坏克己
    const usedAs = card.name==='杀' ? '出【杀】' : '出【'+card.name+'】当【杀】';
    g.log=pushLog(g.log, me.name+' 发动【青龙偃月刀】,'+usedAs);
    markCardSound(g, '杀', mySeat, card, targetSeat);
    g.pending=null;
    resolveShaUse(g, me, targetSeat, usedAs, singleCardShaColor(card), card);
    return g;
  });
}
// ===== 贯石斧:杀被闪抵消后,攻击者可弃自己2张牌(手牌/装备混合)令这张杀依然造成伤害 =====
// guanshifuOptionCount: 攻击者自己还有多少张牌可弃(手牌张数 + 非空装备槽数,装备槽排除武器槽本身——
// 官方FAQ"可以弃装备区里的牌,除了贯石斧本身",武器槽此刻就是贯石斧,天然要排除)。
function guanshifuOptionCount(p){
  const equipCount = EQUIP_SLOTS.filter(s=> s!=='weapon' && p.equips && p.equips[s]).length;
  return (p.hand||[]).length + equipCount;
}
// maybeStartGuanshifu: 攻击者(fromSeat)是否要被问"是否发动贯石斧"。共用出口——不只是
// respondShan 里目标打出实体闪这一条路径会触发"杀被闪抵消",八卦阵判红(视为出闪)是在
// continueShaAfterTieqi/finishGuicai 里更早发生的、respondShan 根本不会被调用的另一条路径,
// 两条路径都要给贯石斧同样的触发机会,所以抽成共用函数,三处调用点各自决定收尾方式。
// 返回 true 表示已开 pending,调用方应立即 return、不做后续收尾。
// maybeStartQinglong: 攻击者(fromSeat)是否要被问"是否发动青龙偃月刀,再次使用一张杀"。
// 从 respondShan 内联判断抽出来的共用出口——和贯石斧同一个原因:八卦阵判红(视为出闪)是
// 在 continueShaAfterTieqi/finishGuicai 里更早发生的、respondShan 根本不会被调用的另一条
// 路径,原来只在 respondShan 里判断,导致"杀被八卦阵判红抵消"这个场景青龙偃月刀完全没有
// 触发机会——这是排查贯石斧同类问题时顺带发现的遗留 bug(青龙偃月刀比贯石斧更早实现,当时
// 没有意识到八卦阵判红会绕开 respondShan),这次一并修复,接入贯石斧同样的三处调用点。
// 返回 true 表示已开 pending,调用方应立即 return、不做后续收尾。
function maybeStartQinglong(g, fromSeat, toSeat){
  const attacker=g.players[fromSeat];
  if(!hasCap(attacker,'qinglong') || !(attacker.hand||[]).some(c=>canUseAs(attacker,c,'杀'))) return false;
  g.pending={type:'qinglong', from:fromSeat, to:toSeat};
  g.phase='qinglong';
  g.log=pushLog(g.log, attacker.name+' 是否发动【青龙偃月刀】,再次使用【杀】…');
  return true;
}
function maybeStartGuanshifu(g, fromSeat, toSeat, sourceCard){
  const attacker=g.players[fromSeat];
  if(!hasCap(attacker,'guanshifu') || guanshifuOptionCount(attacker)<2) return false;
  g.pending={type:'guanshi', from:fromSeat, to:toSeat};
  if(sourceCard!==undefined) g.pending.sourceCard=sourceCard;
  g.phase='guanshi';
  g.log=pushLog(g.log, attacker.name+' 是否发动【贯石斧】,弃两张牌令此【杀】依然造成伤害…');
  return true;
}
// respondGuanshi: 仅攻击者(pending.from)可响应。picks 为 null/不足2项=不发动,直接走"杀被抵消"
// 的原有收尾;恰好2项(每项 'hand:idx' 或 'equip:slot',不含 'equip:weapon')=同时弃掉这2张,
// 不重新走 resolveShaUse(不会再触发闪/判定/其它武器特效),直接 dealDamage 一次让这张杀命中。
function respondGuanshi(picks){
  tx(g=>{
    if(g.phase!=='guanshi'||!g.pending||g.pending.type!=='guanshi'||g.pending.from!==mySeat) return g;
    const from=mySeat, to=g.pending.to;
    const me=g.players[from]; // 攻击者本人(装备者)
    if(!Array.isArray(picks) || picks.length!==2){
      g.log=pushLog(g.log, me.name+'：不发动【贯石斧】');
      g.pending=null;
      finishSingleShaTarget(g);
      return g;
    }
    // 校验:两项不重复、都合法(手牌下标存在 / 装备槽非空且不是武器槽本身)
    const seen=new Set();
    for(const p of picks){
      if(seen.has(p)) return g;
      seen.add(p);
      if(p.startsWith('hand:')){
        const idx=Number(p.slice(5));
        if(!Number.isInteger(idx) || !me.hand[idx]) return g;
      } else if(p.startsWith('equip:')){
        const slot=p.slice(6);
        if(slot==='weapon' || !EQUIP_SLOTS.includes(slot) || !me.equips[slot]) return g;
      } else return g;
    }
    // 弃牌:先处理装备(不受手牌下标变动影响),再处理手牌(大下标先弹,避免 splice 错位)
    const handIdxs=[];
    for(const p of picks){
      if(p.startsWith('equip:')){
        const slot=p.slice(6);
        const card=me.equips[slot]; me.equips[slot]=null; g.discard.push(card);
        g.log=pushLog(g.log, me.name+' 弃置装备【'+card.name+'】(贯石斧)');
        triggerHook(g, from, 'onLoseEquip', {count:1});
      } else {
        handIdxs.push(Number(p.slice(5)));
      }
    }
    handIdxs.sort((a,b)=>b-a).forEach(idx=>{ g.discard.push(me.hand.splice(idx,1)[0]); });
    if(handIdxs.length) g.log=pushLog(g.log, me.name+' 弃置'+handIdxs.length+'张手牌(贯石斧)');
    g.log=pushLog(g.log, me.name+' 发动【贯石斧】,此【杀】依然对 '+g.players[to].name+' 造成伤害');
    const sourceCard=g.pending.sourceCard;
    g.pending=null;
    const dying = dealDamage(g, to, damageAmount(g, from, 1, 'sha'), from, '贯石斧强制命中', 'sha', sourceCard);
    if(dying) return g; // 濒死流程接管
    finishSingleShaTarget(g);
    return g;
  });
}
function endPlay(){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    // 正常结束出牌阶段:仍要检查张郃【巧变】是否也跳过了弃牌阶段(理论上和"正常走完出牌阶段"
    // 不冲突——巧变一回合限一次,选了"出牌阶段"就不会再选"弃牌阶段",但不能假设这里一定
    // 不会发生,统一走 advancePastDiscard 判断,不重复写一遍 if/else)。
    advancePastDiscard(g);
    return g;
  });
}
function kuRou(){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'kurou')) return g;
    g.log=pushLog(g.log, me.name+' 发动【苦肉】');
    markSkillSound(g, '苦肉');
    const interrupted = dealDamage(g, mySeat, 1, mySeat, '【苦肉】', 'kurou');
    if(interrupted) return g;
    drawN(g, mySeat, 2);
    g.log=pushLog(g.log, me.name+' 【苦肉】结算,摸两张牌');
    g.phase='play';
    return g;
  });
}
function zhiHeng(cardIdxs){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'zhiheng') || g.zhihengUsed) return g;
    if(!Array.isArray(cardIdxs) || cardIdxs.length<1) return g;
    const unique=[...new Set(cardIdxs)].filter(i=>Number.isInteger(i)).sort((a,b)=>b-a);
    if(unique.length!==cardIdxs.length) return g;
    if(unique.some(i=>i<0 || i>=(me.hand||[]).length)) return g;
    const moved=[];
    unique.forEach(i=>{ moved.push(me.hand.splice(i,1)[0]); });
    moved.forEach(c=>{ if(c) g.discard.push(c); });
    g.zhihengUsed=true;
    drawN(g, mySeat, moved.length);
    g.log=pushLog(g.log, me.name+' 发动【制衡】,弃'+moved.length+'张牌并摸'+moved.length+'张牌');
    markSkillSound(g, '制衡');
    g.phase='play';
    return g;
  });
}
function renDe(cardIdx, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'rende')) return g;
    const card=me.hand[cardIdx];
    if(!card) return g;
    const target=g.players[targetSeat];
    if(targetSeat===mySeat || !target || !target.alive) return g;
    me.hand.splice(cardIdx,1);
    target.hand.push(card);
    if(!Number.isInteger(g.renDeCount)) g.renDeCount=0;
    g.renDeCount++;
    g.log=pushLog(g.log, me.name+' 【仁德】将一张牌交给 '+target.name);
    if(g.renDeCount===2){
      if(me.hp<me.maxHp) me.hp = Math.min(me.maxHp, me.hp+1);
      g.log=pushLog(g.log, me.name+' 【仁德】发动,回复1点体力');
      markSkillSound(g, '仁德');
    }
    g.phase='play';
    return g;
  });
}
function qingNang(cardIdx, targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'qingnang') || g.qingNangUsed) return g;
    const card=me.hand[cardIdx];
    if(!card) return g;
    const tgt=g.players[targetSeat];
    if(!tgt || !tgt.alive || tgt.hp>=tgt.maxHp) return g;
    g.qingNangUsed=true;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    tgt.hp=Math.min(tgt.maxHp, tgt.hp+1);
    g.log=pushLog(g.log, me.name+' 弃置一张牌,发动【青囊】,令 '+tgt.name+' 回复1点体力');
    markSkillSound(g, '青囊');
    g.phase='play';
    return g;
  });
}
function discardCard(cardIdx){
  tx(g=>{
    if(g.phase!=='discard'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(me.hand.length<=me.hp) return g;
    const card=me.hand.splice(cardIdx,1)[0]; g.discard.push(card);
    if(g.liRangRecord && g.liRangRecord.round===g.roundNum && g.liRangRecord.to===mySeat){
      g.liRangRecord.discarded = g.liRangRecord.discarded || [];
      g.liRangRecord.discarded.push(card);
    }
    g.log=pushLog(g.log, me.name+' 弃置一张牌');
    return g;
  });
}
// discardCards: 弃牌阶段"多选后统一确认"的批量版本——UI 改成点击只是勾选/取消勾选,累积选好
// 几张,最后点"确认弃牌"才一次性提交到这里(不再是discardCard那种"点一张立即弃一张")。
// discardCard 本身保留不删,防止其它地方还在单独调用它,只是弃牌阶段UI不再走这个入口。
function discardCards(cardIdxList){
  tx(g=>{
    if(g.phase!=='discard'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!Array.isArray(cardIdxList) || cardIdxList.length===0) return g;
    // 校验:下标不重复、不越界
    const uniqueIdx = [...new Set(cardIdxList)];
    if(uniqueIdx.length!==cardIdxList.length) return g;
    if(!uniqueIdx.every(i=>Number.isInteger(i) && i>=0 && i<me.hand.length)) return g;
    const need = me.hand.length - me.hp;
    if(need<=0) return g; // 没有超出上限,不需要弃牌
    if(cardIdxList.length < need) return g; // 弃的不够,拒绝(必须一次性弃够,不允许弃少了留着下次再弃)
    // 按下标从大到小依次splice,避免删除时下标错位
    const sorted = [...uniqueIdx].sort((a,b)=>b-a);
    const discarded = sorted.map(i=>me.hand.splice(i,1)[0]);
    g.discard.push(...discarded);
    // 孔融【礼让】记录:和 discardCard 单张版本同一段逻辑,只是这里批量循环每一张都要记
    // (礼让回收的是"本弃牌阶段弃置的全部牌",不能因为改成批量提交就漏记)。
    if(g.liRangRecord && g.liRangRecord.round===g.roundNum && g.liRangRecord.to===mySeat){
      g.liRangRecord.discarded = g.liRangRecord.discarded || [];
      g.liRangRecord.discarded.push(...discarded);
    }
    g.log=pushLog(g.log, me.name+' 弃置了'+discarded.length+'张牌');
    return g;
  });
}
// 吕蒙【克己】(锁定技):本回合"未以任何方式打出过杀"则可跳过弃牌阶段。判据 = 未主动出杀(!shaUsed)
// 且 未在决斗中打杀(!shaPlayedInDuel)。g.shaUsed 只由主动出杀置真、仅管出杀次数;决斗打杀走
// g.shaPlayedInDuel,两者分离,避免决斗应战误消耗出牌阶段的出杀次数(见 duelResponse 注释)。
function canSkipDiscard(g, seat){
  const p=g.players[seat];
  return !!(p && hasCap(p,'keji') && !g.shaUsed && !g.shaPlayedInDuel);
}
function liRangDiscardCardsInPile(g, cards){
  return (cards||[]).filter(card=>(g.discard||[]).some(c=>c===card || (c && card && c.id!==undefined && c.id===card.id)));
}
function maybeStartLiRangRecover(g, endingSeat){
  const r=g.liRangRecord;
  if(!r || r.round!==g.roundNum || r.to!==endingSeat) return false;
  const kong=g.players[r.from];
  if(!kong || !kong.alive || !hasCap(kong,'lirang')) return false;
  const cards=liRangDiscardCardsInPile(g, r.discarded);
  if(cards.length===0) return false;
  g.pending={type:'lirangRecover', from:r.from, to:endingSeat, cards};
  g.phase='lirangRecover';
  g.log=pushLog(g.log, kong.name+' 是否发动【礼让】,获得 '+g.players[endingSeat].name+' 本弃牌阶段弃置的牌…');
  return true;
}
function respondLiRangRecover(activate){
  tx(g=>{
    if(g.phase!=='lirangRecover'||!g.pending||g.pending.type!=='lirangRecover'||g.pending.from!==mySeat) return g;
    const from=g.pending.from, to=g.pending.to;
    const kong=g.players[from], target=g.players[to];
    if(!kong || !kong.alive || !target) return g;
    if(activate){
      const gained=[];
      (g.pending.cards||[]).forEach(card=>{
        const idx=(g.discard||[]).findIndex(c=>c===card || (c && card && c.id!==undefined && c.id===card.id));
        if(idx>=0) gained.push(g.discard.splice(idx,1)[0]);
      });
      if(gained.length){
        kong.hand.push(...gained);
        g.log=pushLog(g.log, kong.name+' 发动【礼让】,获得 '+target.name+' 本弃牌阶段弃置的'+gained.length+'张牌');
        markSkillSound(g, '礼让');
      }
    } else {
      g.log=pushLog(g.log, kong.name+'：不发动【礼让】回收弃牌');
    }
    g.pending=null;
    advanceXiaoguo(g, to, to);
    return g;
  });
}
function endTurn(){
  tx(g=>{
    if(g.phase!=='discard'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(me.hand.length>me.hp && !canSkipDiscard(g, mySeat)) return g; // 手牌超上限必须先弃;克己满足则放行
    if(maybeStartLiRangRecover(g, mySeat)) return g;
    // 乐进【骁果】只在"正常走完弃牌阶段、即将结束回合"这里触发,不影响其它切回合路径
    // (决斗/濒死里回合玩家中途阵亡换人——那个人根本没走到结束阶段,规则本身就不该触发骁果)。
    advanceXiaoguo(g, mySeat, mySeat);
    return g;
  });
}
function finishTurn(g, endingSeat){
  const p=g.players[endingSeat];
  if(p && p.alive && hasCap(p,'biyue')){
    g.pending={type:'biyue', seat:endingSeat};
    g.phase='biyue';
    g.log=pushLog(g.log, p.name+' 是否发动【闭月】摸1张牌…');
  } else {
    startTurn(g, nextAlive(g, endingSeat));
  }
}
function respondBiyue(activate){
  tx(g=>{
    if(g.phase!=='biyue'||!g.pending||g.pending.type!=='biyue'||g.pending.seat!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive) return g;
    if(activate){
      drawN(g, mySeat, 1);
      g.log=pushLog(g.log, me.name+' 发动【闭月】,摸1张牌');
      markSkillSound(g, '闭月');
    } else {
      g.log=pushLog(g.log, me.name+'：不发动【闭月】');
    }
    g.pending=null;
    startTurn(g, nextAlive(g, mySeat));
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
  if(asker===null){ finishTurn(g, endingSeat); return; }
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
// 顺序:先声明轮到谁,再问张郃是否发动【巧变】(可能连判定阶段本身都跳过,必须在结算判定区
// 之前问),再结算判定区(回合开始的判定阶段,在摸牌之前),最后进摸牌阶段。
function startTurn(g, seat){
  if(!Array.isArray(g.roundSeatsActed)) g.roundSeatsActed=[];
  if(!Number.isInteger(g.roundNum)) g.roundNum=1;
  if(g.roundSeatsActed.includes(seat)){
    g.roundNum++;
    g.roundSeatsActed=[seat];
  } else {
    g.roundSeatsActed.push(seat);
  }
  g.turn=seat; g.shaUsed=false; g.shaPlayedInDuel=false; g.duanliangUsed=false; g.zhihengUsed=false; g.renDeCount=0; g.qingNangUsed=false; g.quHuUsed=false; g.liJianUsed=false; g.fanJianUsed=false; g.luoyiActive=false;
  g.log=pushLog(g.log, '轮到 '+g.players[seat].name);
  continueGuanxingCheck(g, seat);
}
// enterDrawPhase: 回合开始判定阶段结束、即将进入摸牌阶段前的统一入口(startTurn 正常路径、
// finishDying 的 delay-resume 分支都走这里,别各自重复判断)。
// 兵粮寸断的 g.skipDraw 在这里消费:为真则直接跳过摸牌阶段,交给 advancePastPlay 继续判断
// 出牌/弃牌阶段是否也被跳过——不在这里各自重复"检查下一个标志"的逻辑。
function enterDrawPhase(g){
  if(g.skipDraw){
    g.skipDraw=false;
    g.log=pushLog(g.log, g.players[g.turn].name+' 因【兵粮寸断】跳过摸牌阶段');
    advancePastPlay(g);
  } else {
    const lirangSeat=eligibleLiRangSeat(g, g.turn);
    if(lirangSeat!==null){
      g.pending={type:'lirangAsk', from:lirangSeat, to:g.turn};
      g.phase='lirangAsk';
      g.log=pushLog(g.log, g.players[g.turn].name+' 的摸牌阶段开始,询问 '+g.players[lirangSeat].name+' 是否发动【礼让】…');
      return;
    }
    continueEnterDrawPhase(g);
  }
}
function continueEnterDrawPhase(g){
  if(hasCap(g.players[g.turn], 'luoyi')){
    g.pending={type:'luoyiAsk', seat:g.turn};
    g.phase='luoyiAsk';
    g.log=pushLog(g.log, g.players[g.turn].name+' 是否发动【裸衣】,少摸1张牌换取本回合伤害加成…');
  } else {
    g.phase='draw';
  }
}
// advancePastPlay/advancePastDiscard: 出牌阶段、弃牌阶段各自"这个阶段是否被跳过"的统一判断,
// 从 enterDrawPhase(跳过摸牌阶段直接来到这里)、doDraw(正常摸完牌来到这里)、endPlay(正常结束
// 出牌来到这里)三处共用——之前 skipPlay 的消费点分散写在 enterDrawPhase/doDraw 两处、各自内嵌
// 一段"顺便检查下一个标志"的 if/else,这次新增 skipDiscard 后如果继续照抄,"检查 skipDiscard"就要
// 在三处分别重复一遍,容易漏改。抽成这两个级联函数后,"摸牌→出牌→弃牌"三个阶段谁被跳过、
// 跳过几个,只在这里维护一份逻辑,三个调用点都共享。
function advancePastPlay(g){
  if(g.skipPlay){
    g.skipPlay=false;
    g.log=pushLog(g.log, g.players[g.turn].name+' 因【乐不思蜀】跳过出牌阶段');
    advancePastDiscard(g);
  } else {
    g.phase='play';
  }
}
function advancePastDiscard(g){
  if(g.skipDiscard){
    g.skipDiscard=false;
    g.log=pushLog(g.log, g.players[g.turn].name+' 因【巧变】跳过弃牌阶段');
    finishTurn(g, g.turn);
  } else {
    g.phase='discard';
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
// maybeTiandu: 郭嘉【天妒】——若 seat 是郭嘉(caps.tiandu)且这张判定牌确实在弃牌堆里
// (judge() 已经把牌推进 g.discard),从弃牌堆移除、改放进郭嘉手牌,记日志。返回 true=已获得,
// 返回 false=不是郭嘉或条件不满足(调用方不需要做任何额外处理,判定牌该在哪还在哪)。
// 边界(官方FAQ已确认,当前项目无此场景但先注释说明):由他人技能造成的判定(如马超【铁骑】,
// 判定归属永远是马超本人而不是郭嘉,除非将来某种机制打破"一人一将"的假设)、或郭嘉的技能造成
// 他人的判定,都不适用天妒——这里只处理"seat 自己进行的判定"这一种情况,调用方传入的 seat
// 必须是判定的真正归属者(闪电/兵粮寸断/乐不思蜀是判定区所有者、铁骑是马超本人、洛神是甄姬本人)。
// 注意:天妒作用于"判定牌"本身(finalCard,judge() 抽出来的那张牌),和延时锦囊牌自身
// (闪电/乐不思蜀/兵粮寸断这张锦囊卡)是两个不同的对象、两件独立的事——天妒只影响判定牌的
// 归属,不影响延时锦囊卡本身该弃置还是传给下家(那部分逻辑不变,continueTiandu 无关)。
function maybeTiandu(g, seat, card){
  const p=g.players[seat];
  if(!p || !hasCap(p,'tiandu') || !card) return false;
  const idx=g.discard.lastIndexOf(card);
  if(idx<0) return false;
  g.discard.splice(idx,1);
  p.hand.push(card);
  g.log=pushLog(g.log, p.name+' 【天妒】发动,获得判定牌【'+card.name+'】');
  markSkillSound(g, '天妒');
  return true;
}
// finishDelayCard: 用最终判定牌(可能被鬼才替换过)调用该延时锦囊的 effect,处理去向(传下家/弃置)。
// 返回 'pending'=effect 内部触发了濒死(如闪电致命,牌本身仍正常进弃牌堆,和是否致命无关)、'done'=处理完毕。
function finishDelayCard(g, seat, spec, finalCard, card){
  const result=spec.effect(g, seat, finalCard, card);
  // 天妒:判定牌(finalCard)生效后,若 seat 是郭嘉可以收下——这是独立于延时锦囊卡(card)本身
  // 去向的另一件事,不管 card 接下来是传给下家还是弃置,finalCard 该不该被天妒收走都不受影响。
  maybeTiandu(g, seat, finalCard);
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
// 'pending' 时:若新挂起是濒死或郭嘉【遗计】(g.pending.type==='dying'||'yijiAsk'),它的 resume
// 只有 {type:'delay'}(因为 dealDamage/startDying 只知道 srcType 字符串,不知道 seat),这里补上
// seat;若新挂起是鬼才(g.pending.type==='guicai'),它的 resume 在 maybeGuicai 里已经自带完整
// 信息,绝不能覆盖。'done' 时统一走 enterDrawPhase,进入(或跳过)摸牌阶段。
function continueDelayResolution(g, seat){
  if(resolveDelayTricks(g, seat)==='pending'){
    if(g.pending.type==='dying' || g.pending.type==='yijiAsk') g.pending.resume={type:'delay', seat};
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
  if(isRedForPlayer(p, card)){
    g.log=pushLog(g.log, p.name+' 发动【洛神】,判定为红,洛神结束');
    // 天妒:洛神判红时判定牌留在弃牌堆(洛神本身没有拿走它),若 seat 恰好是郭嘉可以额外收下——
    // 这是唯一需要在这里调用 maybeTiandu 的分支。黑色分支(下面 else)本来就会把判定牌搬进
    // p.hand,如果也调用 maybeTiandu 会变成"先被天妒判定为已在弃牌堆里"(此时其实不在,已被
    // 洛神搬进手牌了)而返回 false、不会真的重复移动,但语义上容易让人误以为两个技能在竞争
    // 同一张牌,所以刻意不在黑色分支调用,避免这种"看起来在做什么、实际上什么也没做"的死代码。
    maybeTiandu(g, seat, card);
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
      p.hp = p.maxHp; p.hand=[]; p.alive=true; p.dying=false; p.chained=false; p.turnedOver=false; p.nirvanaUsed=false; p.delays=[];
      p.equips = emptyEquips();          // 装备区:每局重置为四槽全空
    });
    g.log=pushLog(g.log,'重置房间,可再次开始');
    return g;
  });
}

function cleanupRoom(){
  // 常驻按钮任何阶段都能点到(见 render.js #closeRoomBtn),游戏进行中点击等于强制中断
  // 所有人的对局且不可恢复——提示文案明确说清楚这一点,不区分"进行中"/"已结束"两套逻辑,
  // 行为本身(删除房间数据+所有人回大厅)完全一致,只是让玩家点之前多一层警示。
  if(!confirm('确定要关闭本房间吗?这会删除本房间数据,所有人会立即回到大厅——如果游戏正在进行中,会直接中断当前对局且无法恢复。')) return;
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
