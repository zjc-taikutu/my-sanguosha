// room-lifecycle.js — 房间/对局生命周期,从 game.js 拆分出来(纯重构,行为零变化)。
// 包含建房加入(joinRoom/enterGame)、开局武将分配(startGame/finishGeneralAssign/
// respondPickGeneral/debugPickGeneral)、重开/关闭/返回大厅(newGame/cleanupRoom/
// backToLobby)。这几组函数在调用图上彼此并不互相调用(joinRoom/enterGame 与
// startGame 一系是各自独立的连通分量),放进同一个文件是主题分组而非调用图发现的
// 聚类——但和 skills.js 同理,这批函数之间本来就没有调用关系,合并不会制造新耦合,
// 只是把"游戏从头到尾怎么开始/怎么结束"这条主线集中到一处。


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
