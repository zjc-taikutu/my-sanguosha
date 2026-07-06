// ---------- targeting UI state ----------
let selectedCardIdx = null;
// 丈八蛇矛「两张牌当杀」的纯客户端选牌状态(和 selectedCardIdx 互斥,从不入库)。
let zhangbaMode = false;
// 鬼才改判:点"发动"进入选牌模式(纯客户端,不入库),再点一张手牌确认替换;与 zhangbaMode 同款但各自独立。
let guicaiMode = false;
function resetGuicai(){ guicaiMode=false; }
let zhangbaPicks = [];          // 已选手牌下标,最多 2 个
function resetZhangba(){ zhangbaMode=false; zhangbaPicks=[]; }
// 张辽【突袭】:摸牌阶段点"发动突袭"进选目标模式(纯客户端,不入库),选 1~2 名座位后点"确认"才发动。
// 和 zhangbaMode 的关键区别:数量可变(1或2都合法),不能靠"选满自动触发",必须有独立确认按钮。
let tuxiMode = false;
let tuxiPicks = [];              // 已选目标座位号,最多 2 个
function resetTuxi(){ tuxiMode=false; tuxiPicks=[]; }
// 徐晃【断粮】:出牌阶段点"发动断粮"进选牌+选目标模式(纯客户端,不入库)。
// 先点一张手牌(任意牌都行,不检查牌名)选中,再点一名其他玩家座位提交;和普通出牌选目标
// 的交互很像,但不走 CARD_PLAYS/playCard(断粮不认牌名,是独立的技能动作)。
let duanliangMode = false;
let duanliangCardIdx = null;    // 已选中要弃置的手牌下标(单选)
function resetDuanliang(){ duanliangMode=false; duanliangCardIdx=null; }
// 乐进【骁果】:点"发动"进选牌模式(纯客户端,不入库),只有基本牌可点,点了直接提交(仿鬼才)。
let xiaoguoMode = false;
function resetXiaoguo(){ xiaoguoMode=false; }
// 张郃【巧变】:出牌阶段点"发动巧变"——① 点一张手牌选中(任意牌) → ② 从"整个牌桌"动态列出
// 的装备/判定牌里选一个来源(或直接"不移动,仅跳过阶段") → ③ 从合法目的地里选一个,一次性
// 提交 qiaoBian(cardIdx, move)。全程纯客户端状态机,不入库,不需要任何其他玩家响应。
let qiaobianMode = false;        // false | 'card' | 'source' | 'target'
let qiaobianCardIdx = null;      // 已选中要弃置的手牌下标
let qiaobianSrc = null;          // 已选中的来源 {kind:'equip'|'delay', seat, slot|idx, name}
function resetQiaobian(){ qiaobianMode=false; qiaobianCardIdx=null; qiaobianSrc=null; }
// 借刀杀人:两步选目标(先选 A:有武器的角色,再选 B:A 攻击范围内的其他角色),与常规单目标出牌
// 走的 selectedCardIdx 通用块互斥(见 render 里 isJiedaoSel 的排除条件)。jiedaoSeatA===null 时选 A,
// 选中后 jiedaoSeatA 存座位号,再点一次选 B 才真正提交。
let jiedaoSeatA = null;
function resetJiedao(){ jiedaoSeatA=null; }
let currentG = null; // 最近一次 render 收到的 g,供确认弹窗取消时重新渲染
// 日志浮层:默认收起,点 #logBtn 打开,复用 showInfo/#infoModal 机制(见 renderLogModal)。
// 这个标志只是"面板现在开着吗",供 render() 判断要不要跟着这次状态更新同步刷新面板内容。
let logModalOpen = false;
// 日志 toast:"刚刚发生了什么"的瞬时提示,和 banner("当前该谁做什么")信息类型不同,不复用。
// undefined 是哨兵值,只在"页面/模块刚加载后的第一次 render()"这一刻生效一次——把它设成当时
// 最新一条日志的文本、不弹任何 toast(否则中途加入/刷新页面进入一局进行中的对局,会把历史
// 最后一条日志误当"新发生的事"弹出来)。之后每次 render() 都是和"上一次真实记过的文本"比较,
// 包括 Firebase 断线重连后的自动重新推送——不会重置回 undefined,所以重连瞬间不会被误判成
// "有新日志"。
// **这里存的是"最后一条日志的文本"而不是"g.log.length"**——曾经是按长度比较(`logLen >
// lastToastedLogLen`),真实 bug:`pushLog`(game.js)`slice(-40)` 只保留最近 40 条,一旦总
// 条数超过 40,`g.log.length` 会永远封顶在 41(第一次触顶那一刻变成 41,之后每次都是"切掉
// 最老一条再 push 一条",长度维持 41 不变)——长度封顶之后 `logLen > lastToastedLogLen`
// 永远算不出"有新增",toast 从触顶那一刻起永久失效,直到刷新页面重置这个变量。按"最新一条
// 日志的文本是否变化"判断不受数组长度封顶影响,数组内容依然在滚动、最新一条文本一直在变。
// 已知的小代价:如果连续两条日志文本恰好完全相同(比如两人先后都摸了两张牌,文案巧合一致),
// 这里会漏弹一次——toast 本来就是"尽量提醒瞥一眼"而非"逐条必达"的定位(多条连续新日志时
// 本来就只弹最后一条,不排队),这个概率很低的边界情况不值得为它引入递增序号之类的额外机制
// (那需要改 pushLog 签名和所有调用点)。
let lastToastedLogText = undefined;
// colorizeLogLine: 只在 toast 这一处渲染路径把日志行里出现的玩家名字染上座位色(呼应座位卡片
// 的 seatColor),不碰 g.log 本身的存储(依然是纯字符串,日志面板 renderLogModal 不受影响)。
// 先转义整行,再用转义后的名字做字面 split/join 替换(不用正则,不用处理名字里的正则特殊字符);
// 按名字长度从长到短替换,防止"某玩家名字是另一玩家名字子串"时被短名字提前抢先替换掉。
// 名字长度<2的不参与染色:三国杀满屏都是单字游戏术语(杀/闪/桃/牌/堆/弃...),1个字的玩家名
// 几乎必然和这些词撞在一起,误染色概率很高;2字以上撞上无关词组纯属巧合,概率低很多,
// 这里只接受"低概率的巧合误染色"这一种代价,不为它再引入正则/语境匹配的复杂度。
function colorizeLogLine(g, text){
  let escaped = escapeHtml(text);
  const entries = (g.players||[]).map((p,i)=>({i,p}))
    .filter(o=>o.p && o.p.name && o.p.name.length>=2)
    .sort((a,b)=>b.p.name.length-a.p.name.length);
  entries.forEach(({i,p})=>{
    const escName = escapeHtml(p.name);
    if(!escName) return;
    escaped = escaped.split(escName).join('<span style="color:'+seatColor(i)+'">'+escName+'</span>');
  });
  return escaped;
}
function showLogToast(g, text){
  const el = document.getElementById('logToast');
  el.innerHTML = colorizeLogLine(g, text);
  // 重新触发 CSS 动画:先摘掉 .show(可能还在播放上一条的动画),强制回流,再加回去。
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

// ===== 出牌确认弹窗:独立于 showInfo(那是"只读说明+关闭",这里是"确定/取消"两种不同结果) =====
function showConfirm(message, onOk, onCancel){
  const m=document.getElementById('confirmModal');
  m.innerHTML='<div class="confirm-panel"><div class="confirm-msg">'+escapeHtml(message)+'</div>'
    +'<div class="confirm-btns"><button class="ghost" id="confirmCancel">取消</button><button class="primary" id="confirmOk">确定</button></div></div>';
  m.classList.remove('hidden');
  const hide=()=>{ m.classList.add('hidden'); m.innerHTML=''; };
  m.querySelector('#confirmOk').onclick=()=>{ hide(); onOk(); };
  m.querySelector('#confirmCancel').onclick=()=>{ hide(); onCancel(); };
  m.onclick=(e)=>{ if(e.target===m){ hide(); onCancel(); } };
}
// confirmAndPlay: 出牌四类触发点(选目标/不选目标/丈八两张当杀)统一委托的包装——
// 无论确定还是取消都先清空客户端选牌状态(selectedCardIdx/zhangba*),只有确定才真正执行 actionFn。
// 只插在"UI 已决定要调用出牌函数"和"真正调用"之间一道用户复核,不碰 canPlay/canTarget 等校验。
function confirmAndPlay(message, actionFn){
  const cleanup=()=>{ selectedCardIdx=null; resetZhangba(); resetDuanliang(); resetQiaobian(); resetJiedao(); };
  showConfirm(message,
    // 确定后也立即 render(currentG):cleanup 清空的是 JS 变量,不会自动重绘 DOM——网络往返
    // (playCard 的 tx)完成前,旧的座位/手牌节点(连同其 onclick)会一直留在页面上可点。
    // 立即重绘让"选目标"相关的 onclick 不再被挂上(selectedCardIdx 已是 null),防止这段
    // 等待期内误触第二下(常见于手机网络延迟)。
    ()=>{ cleanup(); render(currentG); actionFn(); },
    ()=>{ cleanup(); render(currentG); });
}
// resolveActionId: 点一张手牌该按"它自己的牌名"结算,还是按"当杀"结算(赵云龙胆/关羽武圣)——
// 优先它自己的 CARD_PLAYS 入口:只要这张牌本身就是一张能主动出的牌(CARD_PLAYS[card.name] 存在
// 且此刻 canPlay),就按它自己的效果走,"点哪张牌就是哪张牌的效果",符合直觉。只有这张牌本身
// 没有独立可出的入口时(目前只有【闪】——它从来不是主动可出的 CARD_PLAYS 项,只能被动响应)才走
// canUseAs 的转化路径。这样关羽武圣/甄姬倾国拿到一张红/黑色的无中生有/南蛮入侵/过河拆桥等"本身
// 就有效果"的牌时,默认还是按它自己的效果走,不会被误判成杀(此前的真实 bug:这类牌被强制当成
// 杀,点击只会"选中"而不触发确认框,或错误套用杀的攻击距离限制);而武圣/倾国对【闪】的转化、
// 赵云龙胆的双向转化完全不受影响,因为【闪】走不到"自己的 CARD_PLAYS 入口"这条路,天然落回转化。
// 注意:这只管"主动点一张牌该按什么结算"这一层客户端判断——决斗出杀/濒死出桃/打闪/万箭出闪
// 这类被动响应场景依然直接用 canUseAs/findUsableAs 找"任意能顶替用的牌",不经过这个函数,
// 武圣/倾国/龙胆在那些场景的转化能力完全不受影响(那正是这些技能的核心用途)。
function resolveActionId(g, me, card){
  const ownSpec = CARD_PLAYS[card.name];
  if(ownSpec && ownSpec.canPlay(g, me, card)) return card.name;
  if(canUseAs(me, card, '杀')) return '杀';
  return card.name;
}
// playConfirmMsg: 按牌类型生成确认文案。装备用"装备"(spec.noDiscard 是装备牌的统一标志,不硬编码牌名),
// 其余用"使用";带目标的加上目标姓名;杀由非'杀'名的牌顶替时(赵云的闪)标注"当【杀】"。
function playConfirmMsg(g, actionId, card, targetSeat){
  const spec = CARD_PLAYS[actionId];
  if(spec && spec.noDiscard) return '装备【'+card.name+'】？';
  const label = (actionId==='杀' && card.name!=='杀') ? '【'+card.name+'】当【杀】' : '【'+card.name+'】';
  if(spec && spec.target) return '对 '+g.players[targetSeat].name+' 使用'+label+'？';
  return '使用'+label+'？';
}

// ---------- 按座位号分配固定颜色(纯身份标识,不参与任何游戏状态,不入库) ----------
// 冷色调 8 色,按 hue 均匀展开(每两色间隔约24°),刻意避开现有语义色(朱红=--cinnabar/回合朱红框、
// 金=--gold/回合金框、玉=--jade)所在的暖色/绿色区间。按座位号(非名字)分配,同局内 SEATS(≤3)人
// 或以后更多人,只要座位号不同、颜色必然不同——不会因为名字巧合 hash 到相近色。
const NAME_COLORS = ['#3B82C4','#2FBF71','#C4519B','#B8A22F','#8B5FBF','#D9713C','#4FA8A8','#C4C44F'];
function seatColor(seat){ return NAME_COLORS[((seat%NAME_COLORS.length)+NAME_COLORS.length)%NAME_COLORS.length]; }

// setBanner: banner 是唯一常驻可见的焦点行(原来 render() 里独立维护一份 banner + renderControls
// 里独立维护一份 hint,两处各写各的、经常重复或遗漏——现在只有 renderControls 这一处书写者,
// 每个分支把"谁对谁/发生了什么"和"你该做什么(含没有可用牌等兜底提示)"合并成一句话。
// style 可选,仅 game-over 播报胜利时需要金色特殊样式。
function setBanner(html, style){
  document.getElementById('banner').innerHTML = html ? '<div class="banner"'+(style?' style="'+style+'"':'')+'>'+html+'</div>' : '';
}

// ===== 座位环形布局 第2步:槽位分配(仿张郃巧变等"纯前端现算"风格,不入库) =====
// 只按"总座位数"(加入顺序,开局后不再变)算槽位,和"是否存活"无关——阵亡只变暗、不挪位置,
// 避免消化"有人死了"这条信息的同时还要处理布局跳动。约定:从我起顺时针(回合顺序)第一个
// 对手在我右侧('tr'),第二个在我左侧('tl');只有1个对手时居中在正上方('top')。
// 座位数未来若超过3(SEATS 现在封顶3),多出的对手会退化堆进'tl',先不深做(现状用不到)。
function seatSlot(n, mySeat, seatIdx){
  if(seatIdx===mySeat) return 'me';
  if(n<=2) return 'top';
  const rel=((seatIdx-mySeat)%n+n)%n; // 1..n-1,越小=回合顺序上离我越近
  return rel===1 ? 'tr' : 'tl';
}

// ===== 张郃【巧变】:动态扫描整个牌桌,现算"可选来源"/"合法目的地"清单(不预存进 pending) =====
const EQUIP_SLOT_LABEL={ weapon:'武器', armor:'防具', plus1:'防御马', minus1:'进攻马' };
// qiaobianSources: 所有存活玩家的非空装备槽 + 判定区里的每张延时锦囊,各生成一条来源记录。
function qiaobianSources(g){
  const list=[];
  g.players.forEach((p,i)=>{
    if(!p || !p.alive) return;
    EQUIP_SLOTS.forEach(slot=>{ if(p.equips && p.equips[slot]){
      list.push({kind:'equip', seat:i, slot, name:p.equips[slot].name, label:p.name+' 的'+EQUIP_SLOT_LABEL[slot]+'【'+p.equips[slot].name+'】'});
    }});
    (p.delays||[]).forEach((c,idx)=>{
      list.push({kind:'delay', seat:i, idx, name:c.name, label:p.name+' 判定区的【'+c.name+'】'});
    });
  });
  return list;
}
// qiaobianTargets: 给定一条来源,列出合法的目的地玩家(排除来源本人)——
// 装备要求该玩家对应槽为空;延时锦囊要求该玩家判定区没有同名的牌。
function qiaobianTargets(g, src){
  return g.players.map((p,i)=>({p,i})).filter(o=>{
    if(!o.p || !o.p.alive || o.i===src.seat) return false;
    if(src.kind==='equip') return !o.p.equips[src.slot];
    return !(o.p.delays||[]).some(c=>c.name===src.name);
  }).map(o=>({seat:o.i, label:o.p.name}));
}

// ---------- render ----------
function render(g){
  currentG = g; // 供确认弹窗的取消回调异步刷新界面用(回调触发时早已不在 render 的调用栈里)
  if(!g){
    // room was deleted by someone (or doesn't exist) while we're in-game -> return to lobby
    if(!document.getElementById('game').classList.contains('hidden')){
      if(gameRef) gameRef.off();
      backToLobby();
      document.getElementById('lobbyErr').textContent = '房间已被关闭,可重新进入。';
    }
    return;
  }
  normalize(g);
  // 单点兜底:只要不在「自己的出牌阶段」,就退出丈八选牌模式——覆盖换回合/进弃牌/游戏结束/中断/离开等一切离开出牌阶段的情形。
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetZhangba();
  // 同款兜底:一旦不在"轮到自己响应鬼才改判"的状态,退出选牌模式,不留残留。
  if(!(g.phase==='guicai' && g.pending && g.pending.type==='guicai' && g.pending.asking===mySeat)) resetGuicai();
  // 同款兜底:只要不在「自己的摸牌阶段」,就退出突袭选目标模式。
  if(!(g.started && g.phase==='draw' && g.turn===mySeat)) resetTuxi();
  // 同款兜底:只要不在「自己的出牌阶段」,就退出断粮选牌+选目标模式。
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetDuanliang();
  // 同款兜底:一旦不在"轮到自己响应骁果"的状态,退出选牌模式,不留残留。
  if(!(g.phase==='xiaoguo' && g.pending && g.pending.type==='xiaoguo' && g.pending.asking===mySeat)) resetXiaoguo();
  // 同款兜底:只要不在「自己的出牌阶段」,就退出巧变选牌/选源/选目标模式。
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetQiaobian();
  // 同款兜底:只要不在「自己的出牌阶段」,就退出借刀杀人选 A/B 模式。
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetJiedao();
  const seatsEl=document.getElementById('seats');
  seatsEl.innerHTML='';
  const seatN=(g.players||[]).length;
  // 容器 class 决定用哪套 grid-template(1个对手 vs 2个对手,形状不同,不能共用一套列模板);
  // 这个数由"总座位数"决定,开局后不随存活人数变化,不会因为死亡触发布局重排。
  // 注意:className 是整体覆盖,必须把静态 HTML 里原有的 'seats' 一起写回去,否则会把它冲掉,
  // 导致 CSS 里 .seats.opp2 这种"要求同时命中两个 class"的选择器永远匹配不上(曾经在这里踩过)。
  seatsEl.className = 'seats opp'+Math.max(1, seatN-1);
  (g.players||[]).forEach((p,i)=>{
    if(!p) return;
    const d=document.createElement('div');
    const slot = (mySeat===null) ? 'top' : seatSlot(seatN, mySeat, i);
    d.className='seat'+(g.turn===i&&g.started?' active':'')+(p.alive?'':' dead')+(i===mySeat?' me':'')+' slot-'+slot;
    const gen=getGeneral(p.general); // 可能为 null(大厅/旧数据)
    // 大厅(未开局)武将未定,不显示具体血条格数,避免"占位4格→开局3格"的误导跳变
    const hearts = g.started
      ? ('❤'.repeat(Math.max(0,p.hp)) + '<span class="empty">'+'♡'.repeat(Math.max(0,p.maxHp-p.hp))+'</span>')
      : '<span class="empty">待开局</span>';
    const handBacks = '<div class="backs">'+'<div class="cardback"></div>'.repeat((p.hand||[]).length)+'</div>';
    const genLabel = g.started ? (gen?gen.name:'—') : '武将未定';
    // 装备区(公开信息,和武将一样人人可见);地基阶段无真装备牌,四槽都显示暗色占位"—"。
    // 读的是 normalize 补好的 p.equips,四槽必定齐全,不会 undefined.xxx 报错。
    const eq = p.equips || emptyEquips();
    // 马槽用中性名(防御马/进攻马),不用"＋1/－1"——避免空槽也被误读成有距离加成
    const slotLabels = { weapon:'武器', armor:'防具', plus1:'防御马', minus1:'进攻马' };
    const equipRow = g.started
      ? '<div class="equips">'+EQUIP_SLOTS.map(s=>{
          const c = eq[s];
          // 只有武器槽显示射程(马/防具不需要);射程从 getEquip(牌名).range 读
          const rangeSuffix = (s==='weapon' && c && getEquip(c.name) && getEquip(c.name).range) ? ' 射'+getEquip(c.name).range : '';
          // 已装备的牌加 "?" 角标查看特效说明(装备公开);inline onclick stopPropagation 不触发座位选目标
          const eDesc = (c && getEquip(c.name) && getEquip(c.name).desc) || ''; // 悬停提示用
          return '<span class="eslot '+(c?'filled':'empty-slot')+'"'+(c?' title="'+escapeHtml(eDesc)+'"':'')+'>'+slotLabels[s]+' '+(c
            ? '<b>'+cardFace(c)+' '+escapeHtml(c.name)+rangeSuffix+'</b> <span class="info-badge" onclick="event.stopPropagation();showEquipInfo(\''+c.name+'\')">?</span>'
            : '<span class="empty">—</span>')+'</span>';
        }).join('')+'</div>'
      : '';
    // 判定区(延时锦囊):公开信息,和装备区呼应但视觉上区分——每张牌一个紫色描边小 chip
    // (紫色呼应手牌里 .card.trick 的锦囊配色,一眼联想到"这是锦囊类"),不是装备区那种固定
    // 槽位+暗色占位的风格,因为判定区没有"应该有什么"这个固定槽位概念,空的时候整行不显示。
    const delayRow = (g.started && (p.delays||[]).length>0)
      ? '<div class="delays"><span class="dlabel">判定区</span>'+p.delays.map(c=>{
          const dDesc = getCardDesc(c.name);
          return '<span class="dchip"'+(dDesc?' title="'+escapeHtml(dDesc)+'"':'')+'>'+(cardFace(c)||'')+' '+escapeHtml(c.name)+
            ' <span class="info-badge" onclick="event.stopPropagation();showDelayInfo(\''+c.name+'\')">?</span></span>';
        }).join('')+'</div>'
      : '';
    d.innerHTML =
      // 姓名文字染身份色(纯识别用,不碰边框/outline——那些留给回合/选目标等状态高亮,优先级更高)
      '<div class="nm"><span style="color:'+seatColor(i)+'">'+escapeHtml(p.name)+'</span>'+
        (i===mySeat?'<span class="tag">你</span>':'')+
        (g.turn===i&&g.started?'<span class="tag turn">回合</span>':'')+
        (p.dying?'<span class="tag" style="background:var(--cinnabar)">濒死</span>':'')+
      '</div>'+
      '<div class="meta"'+(g.started&&gen?' title="'+escapeHtml(gen.skill+'：'+(gen.desc||''))+'"':'')+'>武将 '+escapeHtml(genLabel)+
        (g.started&&gen?' · '+escapeHtml(gen.skill)+' <span class="info-badge" onclick="event.stopPropagation();showGeneralInfo(\''+gen.id+'\')">?</span>':'')+'</div>'+
      '<div class="hp">'+hearts+'</div>'+
      equipRow+
      delayRow+
      // 自己的座位卡显示当前攻击距离(= attackRange,无武器默认1),让玩家一眼知道能打多远
      (i===mySeat && g.started ? '<div class="meta">攻击距离 '+attackRange(g,mySeat)+'</div>' : '')+
      '<div class="meta">手牌 '+(p.hand||[]).length+' 张</div>'+
      (i===mySeat?'':handBacks);
    // targeting: clickable opponents when choosing a target card
    const meP=g.players[mySeat];
    const selCard=(selectedCardIdx!==null)?(meP.hand||[])[selectedCardIdx]:null;
    const isShaSel=!!(selCard && resolveActionId(g,meP,selCard)==='杀');    // 选的牌最终按"杀"结算(含赵云的闪、没有独立效果的红/黑牌)
    const isJiedaoSel=!!(selCard && selCard.name==='借刀杀人');             // 借刀杀人走专属两步选择,不进通用单目标块
    const needHandOrEquip=!!(selCard && (selCard.name==='顺手牵羊'||selCard.name==='过河拆桥'));
    // 顺手/拆桥对目标"有没有效果"的口径要和服务端 resolveTrick 的 optCount===0 一致:
    // 手牌和装备任一非空即可选,而不是只看手牌——否则"手牌0但有装备"会被 UI 误挡在选目标这一步。
    const hasHandOrEquip = (p.hand||[]).length>0 || EQUIP_SLOTS.some(s=>p.equips && p.equips[s]);
    const inRange = !isShaSel || canReachSha(g, mySeat, i);                 // 杀才受攻击距离限制
    // 默认不能选自己;是否放行自选要按这张延时锦囊自己的 onlySelf 判断(闪电 onlySelf:true 只能选自己,
    // 乐不思蜀/兵粮寸断 onlySelf:false 和普通牌一样不能选自己)。
    // 之前误用 CARD_PLAYS[name].allowSelf(delayTrickPlay 这个共享对象,所有延时锦囊都是 allowSelf:true,
    // 只用来放行服务端 playCard 的默认排自选校验)当"这张牌能不能选自己"的判断依据——allowSelf 为真时
    // (i!==mySeat || allowSelf) 对任何座位恒真,等于"选中任意延时锦囊后谁都能点",和服务端 canTarget
    // (按 DELAY_TRICKS[card.name].onlySelf 分别限制)不一致:闪电点别人在服务端被正确拒绝,但UI没跟着限制,
    // 表现为"点了没反应"。这里直接查 DELAY_TRICKS 复刻服务端同一条判断,不再经 allowSelf 这层间接。
    const selDT = selCard && DELAY_TRICKS[selCard.name];
    const selfOK = selDT ? (selDT.onlySelf ? i===mySeat : i!==mySeat) : (i!==mySeat);
    const targetable = selfOK && p.alive && (!needHandOrEquip || hasHandOrEquip) && inRange;
    if(selectedCardIdx!==null && g.phase==='play' && g.turn===mySeat && !isJiedaoSel){
      if(targetable){
        // idx 在这里(渲染时/挂载 onclick 那一刻)冻结,而不是等点击时才读 selectedCardIdx——
        // 否则确认框弹出后、tx 网络往返完成前,旧节点还挂着这个 onclick,手机上一次误触的
        // 二次点击会读到已被 confirmAndPlay 的 cleanup 清空的 selectedCardIdx(=null),
        // 显示"使用【undefined】"且 playCard(null,...) 静默失败(此前的真实 bug)。
        const idx=selectedCardIdx;
        const c0=((g.players[mySeat].hand||[])[idx])||{};
        const actionId = resolveActionId(g, g.players[mySeat], c0); // 优先这张牌自己的效果,没有独立入口才转化为杀(见 resolveActionId 注释)
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{ confirmAndPlay(playConfirmMsg(g, actionId, c0, i), ()=>playCard(idx, actionId, i)); };
      } else if(isShaSel && i!==mySeat && p.alive && !inRange){
        // 够不着:选了杀但超出攻击距离 —— 暗色点线 + 角标 + 悬浮说明,不可点
        d.style.outline='2px dotted #6b5b4d';
        d.title='攻击距离外（距离 '+distance(g,mySeat,i)+' ＞ 射程 '+attackRange(g,mySeat)+'）';
        d.innerHTML += '<span class="tag" style="position:absolute;top:8px;right:8px;background:#3a2f28">够不着</span>';
      }
    }
    // 丈八蛇矛:已选满两张牌后,对手作为杀的目标(距离规则同普通杀,与 selectedCardIdx 路径互斥)
    if(zhangbaMode && zhangbaPicks.length===2 && g.phase==='play' && g.turn===mySeat){
      const reach = canReachSha(g, mySeat, i);
      if(i!==mySeat && p.alive && reach){
        // 同上:a/b 在挂载时冻结,不在点击时才读 zhangbaPicks(它会被 confirmAndPlay 的 cleanup 清空)
        const a=zhangbaPicks[0], b=zhangbaPicks[1];
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{ confirmAndPlay('对 '+g.players[i].name+' 使用两张牌当【杀】？', ()=>playZhangbaSha(a, b, i)); };
      } else if(i!==mySeat && p.alive && !reach){
        d.style.outline='2px dotted #6b5b4d';
        d.title='攻击距离外（距离 '+distance(g,mySeat,i)+' ＞ 射程 '+attackRange(g,mySeat)+'）';
        d.innerHTML += '<span class="tag" style="position:absolute;top:8px;right:8px;background:#3a2f28">够不着</span>';
      }
    }
    // 徐晃【断粮】选目标:已选中一张要弃的牌后,点一名其他存活玩家提交(无距离限制)。
    if(duanliangMode && duanliangCardIdx!==null && g.phase==='play' && g.turn===mySeat && i!==mySeat && p.alive){
      // 同上:idx 挂载时冻结,不在点击时才读 duanliangCardIdx
      const idx=duanliangCardIdx;
      d.style.cursor='pointer';
      d.style.outline='2px dashed var(--cinnabar-bright)';
      d.onclick=()=>{ confirmAndPlay('弃置一张牌,对 '+g.players[i].name+' 发动【断粮】(视为使用【兵粮寸断】)？', ()=>duanLiang(idx, i)); };
    }
    // 借刀杀人:选中这张牌后走专属两步流程——先选 A(有武器),再选 B(A 攻击范围内的其他角色)。
    if(isJiedaoSel && g.phase==='play' && g.turn===mySeat){
      if(jiedaoSeatA===null){
        // 选 A:排除自己;要有武器;且场上要存在至少一个 A 攻击范围内的其他存活角色(否则选了也选不出 B)
        const hasSomeB = g.players.some((B,bi)=> B && B.alive && bi!==i && canReachSha(g,i,bi));
        if(i!==mySeat && p.alive && p.equips && p.equips.weapon && hasSomeB){
          d.style.cursor='pointer';
          d.style.outline='2px dashed var(--cinnabar-bright)';
          d.onclick=()=>{ jiedaoSeatA=i; render(g); };
        }
      } else if(i!==jiedaoSeatA && p.alive && canReachSha(g, jiedaoSeatA, i)){
        // 同上:idx/seatA 挂载时冻结,不在点击时才读 selectedCardIdx/jiedaoSeatA
        const idx=selectedCardIdx, seatA=jiedaoSeatA, seatB=i;
        d.style.cursor='pointer';
        d.style.outline='3px solid var(--gold)';
        d.onclick=()=>{ confirmAndPlay('对 '+g.players[seatA].name+' 使用【借刀杀人】,目标 '+g.players[seatB].name+'？',
            ()=>jieDaoShaRen(idx, seatA, seatB)); };
      } else if(i===jiedaoSeatA){
        d.style.outline='3px solid var(--gold)';
        d.style.cursor='pointer';
        d.onclick=()=>{ jiedaoSeatA=null; render(g); };
      }
    }
    // 张辽【突袭】选目标模式:点存活的其他玩家 = 切换选中/取消,上限 min(2,其他存活玩家数)。
    if(tuxiMode && g.phase==='draw' && g.turn===mySeat && i!==mySeat && p.alive){
      const otherAliveCount = g.players.filter((pp,ii)=>ii!==mySeat && pp && pp.alive).length;
      const maxPick = Math.min(2, otherAliveCount);
      const picked = tuxiPicks.includes(i);
      const selectable = picked || tuxiPicks.length<maxPick;
      if(selectable){
        d.style.cursor='pointer';
        if(picked) d.style.outline='3px solid var(--gold)';
        else d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{
          if(picked) tuxiPicks = tuxiPicks.filter(x=>x!==i);
          else if(tuxiPicks.length<maxPick) tuxiPicks.push(i);
          render(g);
        };
      }
    }
    seatsEl.appendChild(d);
  });

  // phase pill + deck info
  const phaseName={lobby:'等待开始',draw:'摸牌阶段',play:'出牌阶段',discard:'弃牌阶段',respond:'响应阶段',duel:'决斗中',wuxie:'无懈响应',aoeResp:'群体响应',pick:'选牌',qilin:'弃坐骑',dying:'濒死求桃',guicai:'鬼才改判',tieqi:'铁骑判定',liegong:'烈弓',luoshen:'洛神判定',xiaoguo:'骁果',xiaoguoChoice:'骁果选择',jiedaoChoice:'借刀杀人选择',wugu:'五谷丰登',over:'游戏结束'}[g.phase]||g.phase;
  document.getElementById('phasePill').textContent=phaseName;
  document.getElementById('deckInfo').textContent = g.started ? ('牌堆 '+g.deck.length+' · 弃牌堆 '+g.discard.length) : '';

  // banner 的全部内容现在唯一由 renderControls 负责写入(见该函数顶部 setBanner 说明),
  // 这里不再并行维护一份——避免同一份信息有两个书写者、两边不同步。
  renderControls(g);
  renderHand(g);

  // 日志不再常驻:默认收起,只有 #logBtn 点开的浮层打开着时才需要跟着这次 render 同步刷新内容
  // (Firebase 是实时推送,面板开着的时候底下状态可能还在变,不刷新就会显示过期日志)。
  if(logModalOpen) renderLogModal(g);

  // 日志 toast:有新日志才弹,只弹最新一条(不排队)——连续好几条(比如无懈连锁反应)只看
  // 最后结果,完整过程本来就在 #logBtn 的日志面板里,toast 只负责"提醒瞥一眼",不保证条条都看到。
  // 按"最新一条文本是否变化"判断,不按数组长度(长度会被 pushLog 的 slice(-40) 封顶,详见上面
  // lastToastedLogText 声明处的说明)。
  const log = g.log||[];
  const latestLog = log.length ? log[log.length-1] : null;
  if(lastToastedLogText===undefined){
    lastToastedLogText = latestLog; // 第一次 render(加入房间/刷新页面那一刻),只记文本,不弹历史
  } else if(latestLog!==null && latestLog!==lastToastedLogText){
    showLogToast(g, latestLog);
    lastToastedLogText = latestLog;
  }
}

function renderControls(g){
  const c=document.getElementById('controls'); c.innerHTML='';
  setBanner(''); // 唯一重置点:每次重渲染先清空,下面每个分支各写各的一句
  const me=g.players[mySeat];
  const myTurn = g.turn===mySeat;

  if(!g.started){
    const cnt=(g.players||[]).filter(Boolean).length;
    const btn=document.createElement('button');
    btn.className='primary'; btn.textContent='开始游戏（'+cnt+'/'+SEATS+'）';
    btn.disabled = cnt<MIN_PLAYERS;
    btn.onclick=startGame;
    c.appendChild(btn);
    if(cnt<MIN_PLAYERS) setBanner('至少 '+MIN_PLAYERS+' 人即可开始,还差 '+(MIN_PLAYERS-cnt)+' 人…');
    else if(cnt<SEATS) setBanner('已可开始（'+cnt+' 人),也可等满 '+SEATS+' 人。');
    return;
  }
  if(g.phase==='over'){
    const btn=document.createElement('button'); btn.className='primary';
    btn.textContent='再来一局'; btn.onclick=newGame; c.appendChild(btn);
    const clean=document.createElement('button'); clean.className='ghost';
    clean.textContent='结束并清理房间'; clean.onclick=cleanupRoom; c.appendChild(clean);
    setBanner('🏆 胜者：'+escapeHtml(g.winner||'')+' · 大家看完结果后,点「结束并清理房间」可删除本房间数据。', 'border-color:var(--gold);color:var(--gold)');
    return;
  }
  if(g.phase==='tieqi' && g.pending && g.pending.type==='tieqi' && g.pending.from===mySeat){
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【铁骑】判定'; b1.onclick=()=>respondTieqi(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动'; b2.onclick=()=>respondTieqi(false);
    c.appendChild(b2);
    const to=g.players[g.pending.to].name;
    setBanner('你对 '+escapeHtml(to)+' 出【杀】,是否发动【铁骑】判定?若为红色则此杀不可被闪抵消。');
    return;
  }
  if(g.phase==='tieqi' && g.pending && g.pending.type==='tieqi'){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner(escapeHtml(from)+' 对 '+escapeHtml(to)+' 出【杀】,'+escapeHtml(from)+' 是否发动【铁骑】进行判定…');
    return;
  }
  if(g.phase==='liegong' && g.pending && g.pending.type==='liegong' && g.pending.from===mySeat){
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【烈弓】'; b1.onclick=()=>respondLiegong(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动'; b2.onclick=()=>respondLiegong(false);
    c.appendChild(b2);
    const to=g.players[g.pending.to].name;
    setBanner('你对 '+escapeHtml(to)+' 出【杀】,是否发动【烈弓】?令此杀不可被闪抵消。');
    return;
  }
  if(g.phase==='liegong' && g.pending && g.pending.type==='liegong'){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner(escapeHtml(from)+' 对 '+escapeHtml(to)+' 出【杀】,'+escapeHtml(from)+' 是否发动【烈弓】…');
    return;
  }
  if(g.phase==='xiaoguo' && g.pending && g.pending.type==='xiaoguo' && g.pending.asking===mySeat){
    const endingName=g.players[g.pending.endingSeat].name;
    if(xiaoguoMode){
      setBanner(escapeHtml(endingName)+' 结束阶段,发动【骁果】:选择一张基本牌(杀/闪/桃)弃置(或点已选中的牌取消)。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetXiaoguo(); render(g); }; c.appendChild(cb);
    } else {
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='发动【骁果】'; b1.onclick=()=>{ xiaoguoMode=true; render(g); };
      c.appendChild(b1);
      const b2=document.createElement('button');
      b2.textContent='不发动'; b2.onclick=()=>respondXiaoguo(false);
      c.appendChild(b2);
      setBanner(escapeHtml(endingName)+' 结束阶段,是否弃一张基本牌发动【骁果】?');
    }
    return;
  }
  if(g.phase==='xiaoguo' && g.pending && g.pending.type==='xiaoguo'){
    const ending=g.players[g.pending.endingSeat].name, asker=g.players[g.pending.asking].name;
    setBanner(escapeHtml(ending)+' 结束阶段,正在询问 '+escapeHtml(asker)+' 是否发动【骁果】…');
    return;
  }
  if(g.phase==='xiaoguoChoice' && g.pending && g.pending.type==='xiaoguoChoice' && g.pending.to===mySeat){
    const target=g.players[mySeat], askerName=g.players[g.pending.from].name;
    const slotLabel={ weapon:'武器', armor:'防具', plus1:'防御马', minus1:'进攻马' };
    EQUIP_SLOTS.forEach(s=>{ if(target.equips[s]){
      const b=document.createElement('button');
      b.textContent='弃置'+slotLabel[s]+'【'+target.equips[s].name+'】'; b.onclick=()=>respondXiaoguoChoice(s); c.appendChild(b);
    }});
    const db=document.createElement('button'); db.className='primary';
    db.textContent='受到1点伤害'; db.onclick=()=>respondXiaoguoChoice('damage'); c.appendChild(db);
    setBanner(escapeHtml(askerName)+' 发动【骁果】,请选择:弃置一件装备(对方摸一张牌),或受到1点伤害。');
    return;
  }
  if(g.phase==='xiaoguoChoice' && g.pending && g.pending.type==='xiaoguoChoice'){
    const from=g.players[g.pending.from].name, ending=g.players[g.pending.endingSeat].name;
    setBanner(escapeHtml(from)+' 发动【骁果】,'+escapeHtml(ending)+' 选择弃装备或受到1点伤害…');
    return;
  }
  if(g.phase==='jiedaoChoice' && g.pending && g.pending.type==='jiedaoChoice' && g.pending.seatA===mySeat){
    const A=g.players[mySeat], B=g.players[g.pending.seatB], askerName=g.players[g.pending.from].name;
    const canSha = findUsableAs(A.hand, A, '杀')>=0;
    if(canSha){
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='对 '+B.name+' 使用【杀】'; b1.onclick=()=>respondJiedao(true); c.appendChild(b1);
    }
    const b2=document.createElement('button');
    b2.textContent='弃置武器【'+A.equips.weapon.name+'】'; b2.onclick=()=>respondJiedao(false); c.appendChild(b2);
    setBanner(escapeHtml(askerName)+' 对你使用【借刀杀人】,目标 '+escapeHtml(B.name)+',请选择:对其使用【杀】,或弃置你的武器。');
    return;
  }
  if(g.phase==='jiedaoChoice' && g.pending && g.pending.type==='jiedaoChoice'){
    const seatA=g.players[g.pending.seatA].name, seatB=g.players[g.pending.seatB].name;
    setBanner('等待 '+escapeHtml(seatA)+' 选择对 '+escapeHtml(seatB)+' 使用【杀】或弃置武器…');
    return;
  }
  if(g.phase==='wugu' && g.pending && g.pending.type==='wugu'){
    const picker=g.pending.order[g.pending.idx];
    const poolDesc=g.pending.pool.map(c=>(cardFace(c)||'')+escapeHtml(c.name)).join('、');
    if(picker===mySeat){
      g.pending.pool.forEach((card,pi)=>{
        const b=document.createElement('button');
        b.innerHTML='挑选 '+(cardFace(card)||card.name)+' '+card.name;
        b.onclick=()=>wuguPick(pi);
        c.appendChild(b);
      });
      setBanner('【五谷丰登】轮到你挑选,公共池:'+poolDesc);
    } else {
      setBanner('【五谷丰登】等待 '+escapeHtml(g.players[picker].name)+' 挑选。公共池:'+poolDesc);
    }
    return;
  }
  if(g.phase==='luoshen' && g.pending && g.pending.type==='luoshen' && g.pending.seat===mySeat){
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【洛神】判定'; b1.onclick=()=>respondLuoshen(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不再发动'; b2.onclick=()=>respondLuoshen(false);
    c.appendChild(b2);
    setBanner('是否发动【洛神】进行判定?黑色可获得判定牌并继续发动,红色则结束。');
    return;
  }
  if(g.phase==='luoshen' && g.pending && g.pending.type==='luoshen'){
    const p=g.players[g.pending.seat];
    setBanner(escapeHtml(p.name)+' 是否发动【洛神】进行判定…');
    return;
  }
  if(g.phase==='respond' && g.pending && g.pending.to===mySeat){
    // 马超【铁骑】判红:此杀不可被闪抵消,连按钮都不给("没有可用手段就不渲染"的一贯风格)
    const hasShan = !g.pending.noShan && me.hand.some(card=>canUseAs(me,card,'闪'));
    if(hasShan){
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='出【闪】'; b1.onclick=()=>respondShan(true);
      c.appendChild(b1);
    }
    const b2=document.createElement('button');
    b2.textContent='不闪（受伤）'; b2.onclick=()=>respondShan(false);
    c.appendChild(b2);
    // 吕布【无双】:攻击者是吕布时需要连续两张闪,shanCount 记已打出几张
    const shanNeeded = hasCap(g.players[g.pending.from],'wushuang') ? 2 : 1;
    const from=g.players[g.pending.from].name;
    const lead = escapeHtml(from)+' 对你出【杀】,';
    let tail;
    if(g.pending.noShan) tail='对方发动了【铁骑】且判定为红,此杀不可被闪抵消,只能受到伤害。';
    else if(!hasShan) tail='你没有【闪】,只能受到伤害。';
    else if(shanNeeded>1 && g.pending.shanCount>0) tail='对方是吕布【无双】,已打出'+g.pending.shanCount+'/'+shanNeeded+'张【闪】,还需再打出一张才能抵消!';
    else if(shanNeeded>1) tail='对方是吕布【无双】,需要连续打出2张【闪】才能抵消。';
    else tail='是否打出【闪】?';
    setBanner(lead+tail);
    return;
  }
  if(g.phase==='respond' && g.pending){
    const to=g.players[g.pending.to].name, from=g.players[g.pending.from].name;
    // 攻击者/目标名字各自染身份色(按座位号,不按名字,避免撞色),一眼看出"谁在打谁"
    // (仅此 banner;日志是纯文本存储,escapeHtml 后无法带色,不做)
    const fromSpan='<span style="color:'+seatColor(g.pending.from)+'">'+escapeHtml(from)+'</span>';
    const toSpan='<span style="color:'+seatColor(g.pending.to)+'">'+escapeHtml(to)+'</span>';
    const noShanTag = g.pending.noShan ? '(【铁骑】判红,不可被闪抵消)' : '';
    setBanner(fromSpan+' 对 '+toSpan+' 出【杀】'+noShanTag+',等待'+toSpan+'响应…');
    return;
  }
  if(g.phase==='duel' && g.pending && g.pending.active===mySeat){
    const hasSha=me.hand.some(card=>canUseAs(me,card,'杀'));
    if(hasSha){
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='打出【杀】'; b1.onclick=()=>duelResponse(true);
      c.appendChild(b1);
    }
    const b2=document.createElement('button');
    b2.textContent='认输（受伤）'; b2.onclick=()=>duelResponse(false);
    c.appendChild(b2);
    // 吕布【无双】:跟吕布决斗的对方每轮需连续两张杀,吕布自己始终只需一张——不是"涉及吕布就双方都2张"。
    // 这里渲染的是"该 mySeat 出杀"的按钮/提示,所以判定要看 mySeat 自己是不是吕布,不是看决斗双方。
    const oppSeat = (mySeat===g.pending.from)?g.pending.to:g.pending.from;
    const shaNeeded = (!hasCap(me,'wushuang') && hasCap(g.players[oppSeat],'wushuang')) ? 2 : 1;
    let tail;
    if(!hasSha) tail='你没有【杀】,只能受到伤害。';
    else if(shaNeeded>1 && g.pending.shaCount>0) tail='决斗涉及吕布【无双】,这一轮已打出'+g.pending.shaCount+'/'+shaNeeded+'张【杀】,还需再打出一张!';
    else if(shaNeeded>1) tail='决斗涉及吕布【无双】,这一轮需要连续打出2张【杀】。';
    else tail='是否打出【杀】?';
    setBanner('【决斗】进行中,轮到你打出【杀】,'+tail);
    return;
  }
  if(g.phase==='duel' && g.pending){
    const a=g.players[g.pending.active].name;
    setBanner('【决斗】进行中,轮到 '+escapeHtml(a)+' 打出【杀】…');
    return;
  }
  // TEMP DEBUG(排查五谷丰登无懈按钮不显示的bug,定位到根因后移除):
  // mySeat = 这次 render() 是在哪个客户端跑的(谁在看这个页面);g.turn = 当前回合玩家,
  // 一起打印能判断"是回合玩家自己这边渲染的,还是被问的人那边渲染的"。
  if(g.phase==='wuxie' && g.pending){
    console.log('[DEBUG render wuxie] mySeat(本机)=', mySeat, 'g.turn=', g.turn, 'full pending=', JSON.stringify(g.pending));
  }
  if(g.phase==='wuxie' && g.pending && g.pending.type==='wuxie' && g.pending.asking===mySeat){
    // 此分支只在"被询问者本人"的客户端渲染(旁观者走下面 asking!==mySeat 分支,只看到等待提示、
    // 完全不渲染这两个按钮),所以按钮是否 disable 只影响本人自己的界面,不会向其他人泄露谁有无懈。
    const hasWuxie = me.hand.some(card=>card.name==='无懈可击');
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='打出【无懈可击】';
    b1.disabled = !hasWuxie;
    b1.onclick=()=>{
      if(!hasWuxie) return; // 双重保险:即便被点到也不生效,不改共享状态
      respondWuxie(true);
    };
    const b2=document.createElement('button');
    b2.textContent='不出'; b2.onclick=()=>respondWuxie(false);
    c.appendChild(b1); c.appendChild(b2);
    const tgtDesc = g.pending.from===g.pending.to ? g.players[g.pending.from].name+' 的【'+g.pending.trick+'】' : g.players[g.pending.from].name+' 对 '+g.players[g.pending.to].name+' 的【'+g.pending.trick+'】';
    const askText = g.pending.depth>0
      ? '是否用【无懈可击】反制 '+(g.players[g.pending.exclude]?g.players[g.pending.exclude].name:'?')+' 的【无懈可击】?'
      : '是否对 '+tgtDesc+' 打出【无懈可击】?';
    setBanner(hasWuxie ? escapeHtml(askText) : '你没有【无懈可击】,只能点「不出」。');
    return;
  }
  if(g.phase==='wuxie' && g.pending && g.pending.type==='wuxie'){
    const from=g.players[g.pending.from].name;
    // 目标是使用者自己(如无中生有)时,"对 X 使用"会念成"对自己使用",措辞改成"使用【trick】"更自然
    const useDesc = g.pending.from===g.pending.to ? from+' 使用【'+g.pending.trick+'】' : from+' 对 '+g.players[g.pending.to].name+' 使用【'+g.pending.trick+'】';
    const asking=g.players[g.pending.asking]?g.players[g.pending.asking].name:'?';
    const text = g.pending.depth>0
      ? (g.players[g.pending.exclude]?g.players[g.pending.exclude].name:'?')+' 的【无懈可击】,正在询问 '+asking+' 是否用【无懈可击】反制…'
      : useDesc+',正在询问 '+asking+' 是否使用【无懈可击】…';
    setBanner(escapeHtml(text));
    return;
  }
  if(g.phase==='guicai' && g.pending && g.pending.type==='guicai' && g.pending.asking===mySeat){
    const jc=g.pending.judgeCard;
    const isSelf = g.pending.seat===mySeat;
    const judgedName = g.players[g.pending.seat].name;
    if(guicaiMode){
      setBanner('发动【鬼才】:选择一张手牌替换'+(isSelf?'':'('+escapeHtml(judgedName)+' 的)')+'判定牌(当前判定：'+jc.suit+rankText(jc.rank)+')。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetGuicai(); render(g); }; c.appendChild(cb);
    } else {
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='发动【鬼才】替换判定牌'; b1.onclick=()=>{ guicaiMode=true; render(g); };
      c.appendChild(b1);
      const b2=document.createElement('button');
      b2.textContent='不发动'; b2.onclick=()=>respondGuicai(false);
      c.appendChild(b2);
      setBanner(isSelf
        ? '你的判定得到 '+jc.suit+rankText(jc.rank)+',是否发动【鬼才】用一张手牌替换?'
        : escapeHtml(judgedName)+' 判定得到 '+jc.suit+rankText(jc.rank)+',是否打出一张手牌替换 '+escapeHtml(judgedName)+' 的判定牌?');
    }
    return;
  }
  if(g.phase==='guicai' && g.pending && g.pending.type==='guicai'){
    const p=g.players[g.pending.seat], asker=g.players[g.pending.asking], jc=g.pending.judgeCard;
    setBanner(escapeHtml(p?p.name:'?')+' 判定得到 '+escapeHtml(jc.suit+rankText(jc.rank))+',正在询问 '+escapeHtml(asker?asker.name:'?')+' 是否发动【鬼才】替换判定牌…');
    return;
  }
  if(g.phase==='dying' && g.pending && g.pending.type==='dying' && g.pending.asking===mySeat){
    const dyingP=g.players[g.pending.seat];
    const isSelf = g.pending.seat===mySeat;
    const hasTao = me.hand.some(card=>canUseAs(me,card,'桃'));
    if(hasTao){
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent = isSelf ? '打出【桃】自救' : '打出【桃】救 '+dyingP.name;
      b1.onclick=()=>respondDying(true);
      c.appendChild(b1);
    }
    const b2=document.createElement('button');
    b2.textContent='不救'; b2.onclick=()=>respondDying(false);
    c.appendChild(b2);
    setBanner(hasTao
      ? (isSelf ? dyingP.name+' 濒死,你是否打出【桃】自救?' : dyingP.name+' 濒死,是否对其打出【桃】救援?')
      : escapeHtml(dyingP.name)+' 濒死,你没有【桃】,只能选择不救。');
    return;
  }
  if(g.phase==='dying' && g.pending && g.pending.type==='dying'){
    const dyingP=g.players[g.pending.seat], asking=g.players[g.pending.asking]?g.players[g.pending.asking].name:'?';
    setBanner(escapeHtml(dyingP?dyingP.name:'?')+' 濒死！正在询问 '+escapeHtml(asking)+' 是否使用【桃】…');
    return;
  }
  if(g.phase==='aoeResp' && g.pending && g.pending.to===mySeat){
    const need=g.pending.need;
    const hasCard=me.hand.some(card=>canUseAs(me,card,need));
    if(hasCard){
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='打出【'+need+'】'; b1.onclick=()=>aoeRespond(true);
      c.appendChild(b1);
    }
    const b2=document.createElement('button');
    b2.textContent='不出（受伤）'; b2.onclick=()=>aoeRespond(false);
    c.appendChild(b2);
    const trick = g.aoe ? g.aoe.trick : need;
    setBanner('【'+escapeHtml(trick)+'】要求你打出【'+escapeHtml(need)+'】。'+(hasCard?'':'你没有【'+escapeHtml(need)+'】,只能受到伤害。'));
    return;
  }
  if(g.phase==='aoeResp' && g.pending){
    const to=g.players[g.pending.to]?g.players[g.pending.to].name:'?';
    setBanner('【'+escapeHtml(g.aoe?g.aoe.trick:'')+'】要求 '+escapeHtml(to)+' 打出【'+escapeHtml(g.pending.need)+'】…');
    return;
  }
  if(g.phase==='pick' && g.pending && g.pending.from===mySeat){
    const tgt=g.players[g.pending.to];
    const verb = g.pending.trick==='顺手牵羊' ? '拿' : '拆';
    if(tgt && (tgt.hand||[]).length>0){
      // 手牌隐藏:只给"随机一张手牌"整体选项,不列具体牌
      const b=document.createElement('button'); b.className='primary';
      b.textContent=verb+'随机一张手牌'; b.onclick=()=>pickResolve('hand'); c.appendChild(b);
    }
    // 装备公开:逐件列出具体牌名供指定
    if(tgt) EQUIP_SLOTS.forEach(s=>{ if(tgt.equips[s]){
      const b=document.createElement('button');
      b.textContent=verb+'装备【'+tgt.equips[s].name+'】'; b.onclick=()=>pickResolve(s); c.appendChild(b);
    }});
    setBanner('对 '+escapeHtml(tgt?tgt.name:'目标')+' 使用【'+escapeHtml(g.pending.trick)+'】,选择'+verb+'哪张牌（手牌随机、装备可指定）。');
    return;
  }
  if(g.phase==='pick' && g.pending){
    const from=g.players[g.pending.from]?g.players[g.pending.from].name:'?', to=g.players[g.pending.to]?g.players[g.pending.to].name:'?';
    setBanner(escapeHtml(from)+' 对 '+escapeHtml(to)+' 使用【'+escapeHtml(g.pending.trick)+'】,正在选择拿/拆哪张牌…');
    return;
  }
  if(g.phase==='qilin' && g.pending && g.pending.from===mySeat){
    // 麒麟弓选马:攻击者从目标的两匹坐骑里选弃哪匹(坐骑公开,列具体牌名)
    const tgt=g.players[g.pending.to];
    const slotLabel={ plus1:'+1马', minus1:'-1马' };
    if(tgt) ['plus1','minus1'].forEach(s=>{ if(tgt.equips[s]){
      const b=document.createElement('button');
      b.textContent='弃置'+slotLabel[s]+'【'+tgt.equips[s].name+'】'; b.onclick=()=>qilinResolve(s); c.appendChild(b);
    }});
    setBanner('你的【麒麟弓】发动,选择弃置 '+escapeHtml(tgt?tgt.name:'目标')+' 的哪匹坐骑。');
    return;
  }
  if(g.phase==='qilin' && g.pending){
    const from=g.players[g.pending.from]?g.players[g.pending.from].name:'?', to=g.players[g.pending.to]?g.players[g.pending.to].name:'?';
    setBanner(escapeHtml(from)+' 的【麒麟弓】发动,正在选择弃置 '+escapeHtml(to)+' 的哪匹坐骑…');
    return;
  }
  if(!myTurn){
    setBanner('等待 '+escapeHtml(g.players[g.turn].name)+' 行动…');
    return;
  }
  // it's my turn
  if(g.phase==='draw'){
    // 张辽【突袭】:其他存活玩家里至少一人有手牌才值得开这个入口,否则跟没有技能一样不渲染。
    const others = g.players.map((p,i)=>({p,i})).filter(o=>o.i!==mySeat && o.p && o.p.alive);
    const tuxiAvailable = hasCap(me,'tuxi') && others.some(o=>(o.p.hand||[]).length>0);
    const maxPick = Math.min(2, others.length);
    if(tuxiMode){
      setBanner('【突袭】选择 1~'+maxPick+' 名角色,各摸一张手牌(已选 '+tuxiPicks.length+'/'+maxPick+')。');
      if(tuxiPicks.length>=1){
        const ok=document.createElement('button'); ok.className='primary';
        ok.textContent='确认发动'; ok.onclick=()=>{ const picks=tuxiPicks.slice(); resetTuxi(); respondTuxi(picks); };
        c.appendChild(ok);
      }
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetTuxi(); render(g); }; c.appendChild(cb);
    } else {
      const b=document.createElement('button'); b.className='primary';
      b.textContent='摸两张牌'; b.onclick=doDraw; c.appendChild(b);
      if(tuxiAvailable){
        const tb=document.createElement('button'); tb.className='ghost';
        tb.textContent='发动【突袭】'; tb.onclick=()=>{ tuxiMode=true; tuxiPicks=[]; render(g); };
        c.appendChild(tb);
      }
      setBanner('轮到你,摸牌阶段。');
    }
  } else if(g.phase==='play'){
    // 本回合是否还能出杀(与单张杀 canPlay 同口径:未出过 或 有无限杀)
    const canSha = !g.shaUsed || hasCap(me,'unlimitedSha');
    if(zhangbaMode && !canSha) resetZhangba(); // 选牌途中次数变得不可用 → 安全退出,不卡在选牌模式
    if(duanliangMode && g.duanliangUsed) resetDuanliang(); // 选牌途中变得不可用(理论上不会,双重保险)
    if(qiaobianMode && g.qiaobianUsed) resetQiaobian(); // 同款双重保险
    if(qiaobianMode==='card'){
      setBanner('【巧变】选择一张要弃置的手牌(任意牌都行)。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetQiaobian(); render(g); }; c.appendChild(cb);
    } else if(qiaobianMode==='source'){
      const sources=qiaobianSources(g);
      setBanner('【巧变】选择要移动的装备/判定牌(也可以不移动,仅跳过这个阶段)。');
      sources.forEach(s=>{
        const b=document.createElement('button');
        b.textContent=s.label; b.onclick=()=>{ qiaobianSrc=s; qiaobianMode='target'; render(g); };
        c.appendChild(b);
      });
      const skip=document.createElement('button'); skip.className='primary';
      skip.textContent='不移动,仅跳过阶段'; skip.onclick=()=>{ const idx=qiaobianCardIdx; resetQiaobian(); qiaoBian(idx, null); };
      c.appendChild(skip);
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetQiaobian(); render(g); }; c.appendChild(cb);
    } else if(qiaobianMode==='target'){
      const targets=qiaobianTargets(g, qiaobianSrc);
      setBanner('【巧变】把'+escapeHtml(qiaobianSrc.label)+'移动到哪位角色?'+(targets.length===0?'(没有合法的目的地)':''));
      targets.forEach(t=>{
        const b=document.createElement('button');
        b.textContent='移动到 '+t.label; b.onclick=()=>{
          const idx=qiaobianCardIdx, src=qiaobianSrc;
          resetQiaobian();
          qiaoBian(idx, {kind:src.kind, srcSeat:src.seat, slot:src.slot, idx:src.idx, dstSeat:t.seat});
        };
        c.appendChild(b);
      });
      const back=document.createElement('button'); back.className='ghost';
      back.textContent='重新选来源'; back.onclick=()=>{ qiaobianSrc=null; qiaobianMode='source'; render(g); }; c.appendChild(back);
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetQiaobian(); render(g); }; c.appendChild(cb);
    } else if(duanliangMode){
      // 断粮选牌+选目标模式:先选一张手牌(任意牌都行),再点上方一名其他玩家提交。提供取消。
      setBanner(duanliangCardIdx===null
        ? '【断粮】选择一张要弃置的手牌(任意牌都行)。'
        : '已选中要弃置的牌,点上方一名其他玩家,视为对其使用【兵粮寸断】(或点牌取消选中)。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetDuanliang(); render(g); }; c.appendChild(cb);
    } else if(zhangbaMode){
      // 丈八选牌模式:选两张手牌当杀,再点目标。提供取消。
      setBanner('丈八蛇矛:选两张手牌当作【杀】(已选 '+zhangbaPicks.length+'/2)'+(zhangbaPicks.length===2?'，攻击距离 '+attackRange(g,mySeat)+'，点上方一名对手作为目标。':'。'));
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetZhangba(); render(g); }; c.appendChild(cb);
    } else if(selectedCardIdx!==null && (me.hand||[])[selectedCardIdx] && (me.hand||[])[selectedCardIdx].name==='借刀杀人'){
      // 借刀杀人两步选择提示 + 取消
      setBanner(jiedaoSeatA===null
        ? '【借刀杀人】选择一名装备着武器的角色(A)。'
        : '已选中 '+escapeHtml(g.players[jiedaoSeatA].name)+' 为 A,点上方 A 攻击范围内的另一名角色作为 B(或点 A 重新选)。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ selectedCardIdx=null; resetJiedao(); render(g); }; c.appendChild(cb);
    } else if(selectedCardIdx!==null){
      const selCard=(me.hand||[])[selectedCardIdx]||{};
      const nm=selCard.name;
      const actionId=resolveActionId(g,me,selCard);
      // 只有真的会按"杀"结算才显示"当【杀】"/攻击距离提示(见 resolveActionId:红/黑牌若自己有
      // 独立效果,默认不会被判成杀,不该显示这段容易让人误以为要当杀打的文案)
      const label = (actionId==='杀' && nm!=='杀') ? '【'+nm+'】当【杀】' : '【'+nm+'】';
      const rangeNote = (actionId==='杀') ? '，攻击距离 '+attackRange(g,mySeat)+'，仅范围内对手可选' : '';
      setBanner('已选中'+label+rangeNote+',点上方一名对手作为目标(或点牌取消)。');
    } else {
      const shaInfo = hasCap(me,'unlimitedSha') ? '可出任意张杀' : (g.shaUsed?'已用过杀':'可出1张杀');
      setBanner('点手牌出牌:【杀】/【决斗】/【顺手牵羊】/【过河拆桥】选目标 ·【桃】回血 ·【无中生有】摸两张 ·【南蛮入侵】/【万箭齐发】群体 · 装备牌点击直接装备。本回合'+shaInfo+'。');
    }
    // 丈八蛇矛入口:装丈八(twoAsSha)、手牌≥2、且本回合还能出杀(canSha,与单张杀同口径)时才出现——
    // 否则普通武将出过一张杀后仍白进选牌流程。张飞等无限杀者 canSha 恒真,可继续用丈八。
    if(!zhangbaMode && !duanliangMode && !qiaobianMode && selectedCardIdx===null && hasCap(me,'twoAsSha') && (me.hand||[]).length>=2 && canSha){
      const zb=document.createElement('button'); zb.className='ghost';
      zb.textContent='丈八蛇矛:两张牌当杀'; zb.onclick=()=>{ selectedCardIdx=null; zhangbaMode=true; zhangbaPicks=[]; render(g); }; c.appendChild(zb);
    }
    // 断粮入口:出牌阶段限一次,手牌非空才值得开这个入口(没牌可弃就跟没有技能一样不渲染)。
    if(!zhangbaMode && !duanliangMode && !qiaobianMode && selectedCardIdx===null && hasCap(me,'duanliang') && !g.duanliangUsed && (me.hand||[]).length>0){
      const db=document.createElement('button'); db.className='ghost';
      db.textContent='发动【断粮】'; db.onclick=()=>{ selectedCardIdx=null; duanliangMode=true; duanliangCardIdx=null; render(g); }; c.appendChild(db);
    }
    // 巧变入口:出牌阶段限一次,手牌非空才值得开这个入口。
    if(!zhangbaMode && !duanliangMode && !qiaobianMode && selectedCardIdx===null && hasCap(me,'qiaobian') && !g.qiaobianUsed && (me.hand||[]).length>0){
      const qb=document.createElement('button'); qb.className='ghost';
      qb.textContent='发动【巧变】'; qb.onclick=()=>{ selectedCardIdx=null; qiaobianMode='card'; qiaobianCardIdx=null; qiaobianSrc=null; render(g); }; c.appendChild(qb);
    }
    const b=document.createElement('button'); b.className='ghost';
    b.textContent='结束出牌'; b.onclick=()=>{selectedCardIdx=null;resetZhangba();resetDuanliang();resetQiaobian();resetJiedao();endPlay();}; c.appendChild(b);
  } else if(g.phase==='discard'){
    const over = me.hand.length - me.hp;
    const keji = canSkipDiscard(g, mySeat); // 吕蒙【克己】满足:可跳过弃牌
    if(over>0) setBanner(keji
      ? '克己:本回合未出杀,可不弃牌直接结束回合(也可点手牌自愿弃置)。'
      : '手牌超出体力,需弃掉 '+over+' 张(点手牌弃置)。');
    else setBanner('轮到你,弃牌阶段。手牌未超出体力上限,可直接结束回合。');
    const b=document.createElement('button'); b.className='primary';
    b.textContent='结束回合'; b.disabled=over>0 && !keji; b.onclick=endTurn; c.appendChild(b);
  }
}

function renderHand(g){
  const h=document.getElementById('hand'); h.innerHTML='';
  if(mySeat===null) return;
  const me=g.players[mySeat]; if(!me) return;
  const myTurn=g.turn===mySeat;
  // 自己的武将信息(技能名+描述);未开局或无将时留空
  const myGenEl=document.getElementById('myGeneral');
  const myGen=g.started?getGeneral(me.general):null;
  myGenEl.innerHTML = myGen
    ? '你的武将：'+escapeHtml(myGen.name)+' · '+escapeHtml(myGen.skill)+'<span style="color:var(--paper-dim)">（'+escapeHtml(myGen.desc)+'）</span>'
    : '';
  (me.hand||[]).forEach((card,idx)=>{
    const el=document.createElement('div');
    const cls = card.name==='杀'?'sha':card.name==='桃'?'tao':card.name==='闪'?'shan':card.name==='顺手牵羊'?'steal':'trick';
    // 过河拆桥沿用统一锦囊样式 trick
    const picked = zhangbaMode && zhangbaPicks.includes(idx);
    const duanliangPicked = duanliangMode && duanliangCardIdx===idx;
    el.className='card '+cls+((selectedCardIdx===idx||picked||duanliangPicked)?' selected':'');
    el.innerHTML='<div class="corner">'+(cardFace(card)||card.name)+'</div><div class="big">'+card.name+'</div><div class="corner br">'+card.name+'</div>';

    let usable=false, onClick=null;
    if(g.phase==='guicai'&&guicaiMode&&g.pending&&g.pending.type==='guicai'&&g.pending.asking===mySeat){
      // 鬼才选牌模式:任意一张手牌都可以打出替换判定牌
      usable=true; onClick=()=>respondGuicai(true, idx);
    } else if(g.phase==='xiaoguo'&&xiaoguoMode&&g.pending&&g.pending.type==='xiaoguo'&&g.pending.asking===mySeat){
      // 骁果选牌模式:只有基本牌(杀/闪/桃)可选,其余牌照常灰显不可点
      usable = BASIC_CARDS.includes(card.name);
      if(usable) onClick=()=>{ resetXiaoguo(); respondXiaoguo(true, idx); };
    } else if(g.phase==='play'&&myTurn&&qiaobianMode==='card'){
      // 巧变选牌模式:任意一张牌都可以选(不检查牌名),选中后立即进入"选来源"阶段
      usable=true;
      onClick=()=>{ qiaobianCardIdx=idx; qiaobianMode='source'; render(g); };
    } else if(g.phase==='play'&&myTurn&&duanliangMode){
      // 断粮选牌模式:任意一张牌都可以选(不检查牌名),点= 切换选中(单选,再点别的牌会换选中)
      usable=true;
      onClick=()=>{ duanliangCardIdx = (duanliangCardIdx===idx?null:idx); render(g); };
    } else if(g.phase==='play'&&myTurn&&zhangbaMode){
      // 丈八选牌模式:点牌 = toggle 到 zhangbaPicks(任意牌均可,最多2张;已满则仅允许取消已选)
      usable = picked || zhangbaPicks.length<2;
      if(usable) onClick=()=>{
        if(picked) zhangbaPicks = zhangbaPicks.filter(x=>x!==idx);
        else if(zhangbaPicks.length<2) zhangbaPicks.push(idx);
        render(g);
      };
    } else if(g.phase==='play'&&myTurn){
      // actionId:优先这张牌自己的效果,没有独立入口(如闪)才转化为杀;查 CARD_PLAYS 决定可用性与点击行为
      const actionId = resolveActionId(g, me, card);
      const spec = CARD_PLAYS[actionId];
      if(spec && spec.canPlay(g,me,card)){
        usable=true;
        if(spec.target){ onClick=()=>{ selectedCardIdx = (selectedCardIdx===idx?null:idx); render(g);} ; } // 目标牌:点=选中
        else { onClick=()=>confirmAndPlay(playConfirmMsg(g, actionId, card), ()=>playCard(idx, actionId)); } // 桃/无中生有/AOE/装备:确认后出牌
      }
    } else if(g.phase==='discard'&&myTurn&&me.hand.length>me.hp){
      usable=true; onClick=()=>discardCard(idx);
    } else if(g.phase==='respond'&&g.pending&&g.pending.to===mySeat&&card.name==='闪'){
      // handled via button; leave card non-clickable
    }
    if(!usable) el.classList.add('disabled');
    if(onClick) el.onclick=onClick;
    el.title = getAnyDesc(card.name); // 电脑鼠标悬停即显示说明(装备牌走 EQUIPS.desc、基础牌/锦囊走 CARD_DESC)
    // "?" 角标:查看该牌说明。stopPropagation 不触发出牌;pointer-events:auto 让 disabled 牌也能查看
    // 外层 .info-badge-hit 是实际点击热区(比视觉圆圈大,手机上更好点中),内层 .info-badge 只负责
    // 视觉上的小圆圈(手机断点下会缩小,避免盖住花色/点数角标文字)——热区和视觉大小分离,不是
    // 缩小视觉尺寸就顺带缩小了可点范围。
    const hit=document.createElement('div'); hit.className='info-badge-hit';
    hit.onclick=(e)=>{ e.stopPropagation(); showInfo(card.name, escapeHtml(getAnyDesc(card.name)||'(暂无说明)')); };
    const badge=document.createElement('span'); badge.className='info-badge'; badge.textContent='?';
    hit.appendChild(badge);
    el.appendChild(hit);
    h.appendChild(el);
  });
  if((me.hand||[]).length===0) h.innerHTML='<span style="color:var(--paper-dim);font-size:13px">（暂无手牌）</span>';
}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

// ===== 说明浮层(独立于 render;bodyHtml 需已是安全 HTML,单条说明请自行 escapeHtml) =====
function showInfo(title, bodyHtml){
  const m=document.getElementById('infoModal');
  m.innerHTML='<div class="info-panel"><button class="info-close icon-btn" aria-label="关闭">✕</button>'
    +'<h3>'+escapeHtml(title)+'</h3><div class="info-body">'+bodyHtml+'</div></div>';
  m.classList.remove('hidden');
  m.onclick=(e)=>{ if(e.target===m) hideInfo(); };            // 点遮罩空白处关闭
  m.querySelector('.info-close').onclick=hideInfo;
  m.querySelector('.info-panel').onclick=(e)=>e.stopPropagation(); // 点面板本身不关闭
}
function hideInfo(){ const m=document.getElementById('infoModal'); m.classList.add('hidden'); m.innerHTML=''; logModalOpen=false; }
// showLog/renderLogModal: 日志浮层,复用 showInfo/#infoModal(和武将/装备说明、帮助面板同一套
// "只读+关闭"组件),不是新造的展开/收起控件。区别于那些一次性静态内容:日志在面板开着时
// 还会继续变化(Firebase 实时推送),所以 render() 每次都会在 logModalOpen 为真时重新调用
// renderLogModal 刷新内容,而不是只在打开的一瞬间生成一次。
function showLog(){ logModalOpen=true; renderLogModal(currentG); }
function renderLogModal(g){
  if(!logModalOpen || !g) return;
  const html=(g.log||[]).map(l=>'<div>'+escapeHtml(l)+'</div>').join('');
  showInfo('日志', '<div class="log-modal">'+html+'</div>');
  const body=document.querySelector('#infoModal .log-modal');
  if(body) body.scrollTop=body.scrollHeight; // 每次刷新都跟到最新一条,和以前常驻日志的行为一致
}
// 供座位卡内联触发(武将/装备,均公开信息);inline onclick 已 stopPropagation,不触发选目标
function showGeneralInfo(id){ const gen=getGeneral(id); if(gen) showInfo(gen.name+' · '+gen.skill, escapeHtml(gen.desc||'(暂无说明)')); }
function showEquipInfo(name){ const e=getEquip(name); showInfo(name, escapeHtml((e&&e.desc)||'(暂无说明)')); }
function showDelayInfo(name){ showInfo(name, escapeHtml(getCardDesc(name)||'(暂无说明)')); }
// 帮助按钮:一次性列出全部牌/武将/装备说明
function showHelp(){
  let html='<div class="sec">基础牌 / 锦囊</div>';
  ['杀','闪','桃','决斗','无中生有','桃园结义','顺手牵羊','过河拆桥','无懈可击','南蛮入侵','万箭齐发','闪电','乐不思蜀','兵粮寸断','借刀杀人','五谷丰登'].forEach(n=>{
    html+='<div class="item"><b>'+escapeHtml(n)+'</b>：'+escapeHtml(getCardDesc(n))+'</div>'; });
  html+='<div class="sec">武将</div>';
  GENERAL_IDS.forEach(id=>{ const gg=getGeneral(id);
    html+='<div class="item"><b>'+escapeHtml(gg.name)+'【'+escapeHtml(gg.skill)+'】</b>：'+escapeHtml(gg.desc||'')+'</div>'; });
  html+='<div class="sec">装备</div>';
  Object.keys(EQUIPS).forEach(n=>{
    html+='<div class="item"><b>'+escapeHtml(n)+'</b>：'+escapeHtml(getEquip(n).desc||'')+'</div>'; });
  showInfo('规则 / 说明', html);
}
