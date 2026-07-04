// ---------- targeting UI state ----------
let selectedCardIdx = null;
// 丈八蛇矛「两张牌当杀」的纯客户端选牌状态(和 selectedCardIdx 互斥,从不入库)。
let zhangbaMode = false;
// 鬼才改判:点"发动"进入选牌模式(纯客户端,不入库),再点一张手牌确认替换;与 zhangbaMode 同款但各自独立。
let guicaiMode = false;
function resetGuicai(){ guicaiMode=false; }
let zhangbaPicks = [];          // 已选手牌下标,最多 2 个
function resetZhangba(){ zhangbaMode=false; zhangbaPicks=[]; }
let currentG = null; // 最近一次 render 收到的 g,供确认弹窗取消时重新渲染

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
  const cleanup=()=>{ selectedCardIdx=null; resetZhangba(); };
  showConfirm(message,
    ()=>{ cleanup(); actionFn(); },
    ()=>{ cleanup(); render(currentG); });
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
  if(!(g.phase==='guicai' && g.pending && g.pending.type==='guicai' && g.pending.seat===mySeat)) resetGuicai();
  const seatsEl=document.getElementById('seats');
  seatsEl.innerHTML='';
  (g.players||[]).forEach((p,i)=>{
    if(!p) return;
    const d=document.createElement('div');
    d.className='seat'+(g.turn===i&&g.started?' active':'')+(p.alive?'':' dead')+(i===mySeat?' me':'');
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
          return '<span class="eslot"'+(c?' title="'+escapeHtml(eDesc)+'"':'')+'>'+slotLabels[s]+' '+(c
            ? '<b>'+cardFace(c)+' '+escapeHtml(c.name)+rangeSuffix+'</b> <span class="info-badge" onclick="event.stopPropagation();showEquipInfo(\''+c.name+'\')">?</span>'
            : '<span class="empty">—</span>')+'</span>';
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
      // 判定区(延时锦囊)最简显示:公开信息,直接写牌名;地基阶段先只做到"看得见",样式留给以后的 UI 大改版
      (g.started && (p.delays||[]).length>0 ? '<div class="meta">判定区: '+p.delays.map(c=>escapeHtml(c.name)).join('、')+'</div>' : '')+
      // 自己的座位卡显示当前攻击距离(= attackRange,无武器默认1),让玩家一眼知道能打多远
      (i===mySeat && g.started ? '<div class="meta">攻击距离 '+attackRange(g,mySeat)+'</div>' : '')+
      '<div class="meta">手牌 '+(p.hand||[]).length+' 张</div>'+
      (i===mySeat?'':handBacks);
    // targeting: clickable opponents when choosing a target card
    const meP=g.players[mySeat];
    const selCard=(selectedCardIdx!==null)?(meP.hand||[])[selectedCardIdx]:null;
    const isShaSel=!!(selCard && canUseAs(meP,selCard,'杀'));               // 选的牌作为杀(含赵云的闪)
    const needHandOrEquip=!!(selCard && (selCard.name==='顺手牵羊'||selCard.name==='过河拆桥'));
    // 顺手/拆桥对目标"有没有效果"的口径要和服务端 resolveTrick 的 optCount===0 一致:
    // 手牌和装备任一非空即可选,而不是只看手牌——否则"手牌0但有装备"会被 UI 误挡在选目标这一步。
    const hasHandOrEquip = (p.hand||[]).length>0 || EQUIP_SLOTS.some(s=>p.equips && p.equips[s]);
    const inRange = !isShaSel || canReachSha(g, mySeat, i);                 // 杀才受攻击距离限制
    // 默认不能选自己;闪电这类延时锦囊在 CARD_PLAYS 里声明了 allowSelf,放行自选(和服务端 playCard 同一条件)
    const selSpec = selCard && CARD_PLAYS[isShaSel?'杀':selCard.name];
    const allowSelf = !!(selSpec && selSpec.allowSelf);
    const targetable = (i!==mySeat || allowSelf) && p.alive && (!needHandOrEquip || hasHandOrEquip) && inRange;
    if(selectedCardIdx!==null && g.phase==='play' && g.turn===mySeat){
      if(targetable){
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{ const idx=selectedCardIdx;
          const c0=((g.players[mySeat].hand||[])[idx])||{};
          const actionId = canUseAs(g.players[mySeat],c0,'杀') ? '杀' : c0.name; // 闪(赵云)→'杀'
          confirmAndPlay(playConfirmMsg(g, actionId, c0, i), ()=>playCard(idx, actionId, i)); };
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
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{ const a=zhangbaPicks[0], b=zhangbaPicks[1];
          confirmAndPlay('对 '+g.players[i].name+' 使用两张牌当【杀】？', ()=>playZhangbaSha(a, b, i)); };
      } else if(i!==mySeat && p.alive && !reach){
        d.style.outline='2px dotted #6b5b4d';
        d.title='攻击距离外（距离 '+distance(g,mySeat,i)+' ＞ 射程 '+attackRange(g,mySeat)+'）';
        d.innerHTML += '<span class="tag" style="position:absolute;top:8px;right:8px;background:#3a2f28">够不着</span>';
      }
    }
    seatsEl.appendChild(d);
  });

  // phase pill + deck info
  const phaseName={lobby:'等待开始',draw:'摸牌阶段',play:'出牌阶段',discard:'弃牌阶段',respond:'响应阶段',duel:'决斗中',wuxie:'无懈响应',aoeResp:'群体响应',pick:'选牌',qilin:'弃坐骑',dying:'濒死求桃',guicai:'鬼才改判',over:'游戏结束'}[g.phase]||g.phase;
  document.getElementById('phasePill').textContent=phaseName;
  document.getElementById('deckInfo').textContent = g.started ? ('牌堆 '+g.deck.length+' · 弃牌堆 '+g.discard.length) : '';

  // banner
  const bn=document.getElementById('banner'); bn.innerHTML='';
  if(g.phase==='respond'&&g.pending){
    const to=g.players[g.pending.to].name, from=g.players[g.pending.from].name;
    // 攻击者/目标名字各自染身份色(按座位号,不按名字,避免撞色),一眼看出"谁在打谁"
    // (仅此 banner;日志是纯文本存储,escapeHtml 后无法带色,不做)
    const fromSpan='<span style="color:'+seatColor(g.pending.from)+'">'+escapeHtml(from)+'</span>';
    const toSpan='<span style="color:'+seatColor(g.pending.to)+'">'+escapeHtml(to)+'</span>';
    bn.innerHTML='<div class="banner">'+fromSpan+' 对 '+toSpan+' 出【杀】,等待'+toSpan+'响应…</div>';
  }
  if(g.phase==='duel'&&g.pending){
    const a=g.players[g.pending.active].name;
    bn.innerHTML='<div class="banner">【决斗】进行中,轮到 '+escapeHtml(a)+' 打出【杀】…</div>';
  }
  if(g.phase==='wuxie'&&g.pending){
    const from=g.players[g.pending.from].name;
    // 目标是使用者自己(如无中生有)时,"对 X 使用"会念成"对自己使用",措辞改成"使用【trick】"更自然
    const useDesc = g.pending.from===g.pending.to ? from+' 使用【'+g.pending.trick+'】' : from+' 对 '+g.players[g.pending.to].name+' 使用【'+g.pending.trick+'】';
    const asking=g.players[g.pending.asking]?g.players[g.pending.asking].name:'?';
    const text = g.pending.depth>0
      ? (g.players[g.pending.exclude]?g.players[g.pending.exclude].name:'?')+' 的【无懈可击】,正在询问 '+asking+' 是否用【无懈可击】反制…'
      : useDesc+',正在询问 '+asking+' 是否使用【无懈可击】…';
    bn.innerHTML='<div class="banner">'+escapeHtml(text)+'</div>';
  }
  if(g.phase==='guicai'&&g.pending&&g.pending.type==='guicai'){
    const p=g.players[g.pending.seat], jc=g.pending.judgeCard;
    bn.innerHTML='<div class="banner">'+escapeHtml(p?p.name:'?')+' 判定得到 '+escapeHtml(jc.suit+rankText(jc.rank))+',是否发动【鬼才】替换判定牌…</div>';
  }
  if(g.phase==='dying'&&g.pending&&g.pending.type==='dying'){
    const dyingP=g.players[g.pending.seat], asking=g.players[g.pending.asking];
    bn.innerHTML='<div class="banner">'+escapeHtml(dyingP?dyingP.name:'?')+' 濒死！正在询问 '+escapeHtml(asking?asking.name:'?')+' 是否使用【桃】…</div>';
  }
  if(g.phase==='aoeResp'&&g.pending&&g.aoe){
    const to=g.players[g.pending.to]?g.players[g.pending.to].name:'?';
    bn.innerHTML='<div class="banner">【'+escapeHtml(g.aoe.trick)+'】要求 '+escapeHtml(to)+' 打出【'+escapeHtml(g.pending.need)+'】…</div>';
  }
  if(g.phase==='pick'&&g.pending){
    const from=g.players[g.pending.from]?g.players[g.pending.from].name:'?', to=g.players[g.pending.to]?g.players[g.pending.to].name:'?';
    bn.innerHTML='<div class="banner">'+escapeHtml(from)+' 对 '+escapeHtml(to)+' 使用【'+escapeHtml(g.pending.trick)+'】,正在选择拿/拆哪张牌…</div>';
  }
  if(g.phase==='qilin'&&g.pending){
    const from=g.players[g.pending.from]?g.players[g.pending.from].name:'?', to=g.players[g.pending.to]?g.players[g.pending.to].name:'?';
    bn.innerHTML='<div class="banner">'+escapeHtml(from)+' 的【麒麟弓】发动,正在选择弃置 '+escapeHtml(to)+' 的哪匹坐骑…</div>';
  }
  if(g.phase==='over'){
    bn.innerHTML='<div class="banner" style="border-color:var(--gold);color:var(--gold)">🏆 胜者：'+escapeHtml(g.winner||'')+'</div>';
  }

  renderControls(g);
  renderHand(g);

  // log
  const logEl=document.getElementById('log');
  logEl.innerHTML=(g.log||[]).map(l=>'<div>'+escapeHtml(l)+'</div>').join('');
  logEl.scrollTop=logEl.scrollHeight;
}

function renderControls(g){
  const c=document.getElementById('controls'); c.innerHTML='';
  const hint=document.getElementById('hint'); hint.textContent='';
  const me=g.players[mySeat];
  const myTurn = g.turn===mySeat;

  if(!g.started){
    const cnt=(g.players||[]).filter(Boolean).length;
    const btn=document.createElement('button');
    btn.className='primary'; btn.textContent='开始游戏（'+cnt+'/'+SEATS+'）';
    btn.disabled = cnt<MIN_PLAYERS;
    btn.onclick=startGame;
    c.appendChild(btn);
    if(cnt<MIN_PLAYERS) hint.textContent='至少 '+MIN_PLAYERS+' 人即可开始,还差 '+(MIN_PLAYERS-cnt)+' 人…';
    else if(cnt<SEATS) hint.textContent='已可开始（'+cnt+' 人),也可等满 '+SEATS+' 人。';
    return;
  }
  if(g.phase==='over'){
    const btn=document.createElement('button'); btn.className='primary';
    btn.textContent='再来一局'; btn.onclick=newGame; c.appendChild(btn);
    const clean=document.createElement('button'); clean.className='ghost';
    clean.textContent='结束并清理房间'; clean.onclick=cleanupRoom; c.appendChild(clean);
    hint.textContent='大家看完结果后,点「结束并清理房间」可删除本房间数据。';
    return;
  }
  if(g.phase==='respond' && g.pending && g.pending.to===mySeat){
    const hasShan = me.hand.some(card=>canUseAs(me,card,'闪'));
    if(hasShan){
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='出【闪】'; b1.onclick=()=>respondShan(true);
      c.appendChild(b1);
    }
    const b2=document.createElement('button');
    b2.textContent='不闪（受伤）'; b2.onclick=()=>respondShan(false);
    c.appendChild(b2);
    if(!hasShan) hint.textContent='你没有【闪】,只能受到伤害。';
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
    if(!hasSha) hint.textContent='你没有【杀】,只能受到伤害。';
    return;
  }
  if(g.phase==='wuxie' && g.pending && g.pending.asking===mySeat){
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
    hint.textContent = hasWuxie ? askText : '你没有【无懈可击】,只能点「不出」。';
    return;
  }
  if(g.phase==='wuxie' && g.pending){
    const asking=g.players[g.pending.asking]?g.players[g.pending.asking].name:'?';
    hint.textContent='等待 '+asking+' 决定是否'+(g.pending.depth>0?'反制':'使用')+'【无懈可击】…';
    return;
  }
  if(g.phase==='guicai' && g.pending && g.pending.type==='guicai' && g.pending.seat===mySeat){
    const jc=g.pending.judgeCard;
    if(guicaiMode){
      hint.textContent='【鬼才】选择一张手牌替换判定牌(当前判定：'+jc.suit+rankText(jc.rank)+')。';
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetGuicai(); render(g); }; c.appendChild(cb);
    } else {
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='发动【鬼才】替换判定牌'; b1.onclick=()=>{ guicaiMode=true; render(g); };
      c.appendChild(b1);
      const b2=document.createElement('button');
      b2.textContent='不替换'; b2.onclick=()=>respondGuicai(false);
      c.appendChild(b2);
      hint.textContent='判定得到 '+jc.suit+rankText(jc.rank)+',是否发动【鬼才】用一张手牌替换?';
    }
    return;
  }
  if(g.phase==='guicai' && g.pending && g.pending.type==='guicai'){
    const p=g.players[g.pending.seat];
    hint.textContent='等待 '+(p?p.name:'?')+' 决定是否发动【鬼才】替换判定牌…';
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
    hint.textContent = hasTao
      ? (isSelf ? '你濒死,是否打出【桃】自救?' : '是否对 '+dyingP.name+' 打出【桃】救援?')
      : '你没有【桃】,只能选择不救。';
    return;
  }
  if(g.phase==='dying' && g.pending && g.pending.type==='dying'){
    const dyingP=g.players[g.pending.seat], asking=g.players[g.pending.asking]?g.players[g.pending.asking].name:'?';
    hint.textContent='等待 '+asking+' 决定是否对 '+(dyingP?dyingP.name:'?')+' 使用【桃】…';
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
    if(!hasCard) hint.textContent='你没有【'+need+'】,只能受到伤害。';
    return;
  }
  if(g.phase==='aoeResp' && g.pending){
    const to=g.players[g.pending.to]?g.players[g.pending.to].name:'?';
    hint.textContent='等待 '+to+' 打出【'+g.pending.need+'】…';
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
    hint.textContent='选择对 '+(tgt?tgt.name:'目标')+' '+verb+'哪张牌（手牌随机、装备可指定）。';
    return;
  }
  if(g.phase==='pick' && g.pending){
    const from=g.players[g.pending.from]?g.players[g.pending.from].name:'?';
    hint.textContent='等待 '+from+' 选择拿/拆哪张牌…';
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
    hint.textContent='【麒麟弓】选择弃置 '+(tgt?tgt.name:'目标')+' 的哪匹坐骑。';
    return;
  }
  if(g.phase==='qilin' && g.pending){
    const from=g.players[g.pending.from]?g.players[g.pending.from].name:'?';
    hint.textContent='等待 '+from+' 用【麒麟弓】选择弃置坐骑…';
    return;
  }
  if(!myTurn){
    hint.textContent='等待 '+g.players[g.turn].name+' 行动…';
    return;
  }
  // it's my turn
  if(g.phase==='draw'){
    const b=document.createElement('button'); b.className='primary';
    b.textContent='摸两张牌'; b.onclick=doDraw; c.appendChild(b);
  } else if(g.phase==='play'){
    // 本回合是否还能出杀(与单张杀 canPlay 同口径:未出过 或 有无限杀)
    const canSha = !g.shaUsed || hasCap(me,'unlimitedSha');
    if(zhangbaMode && !canSha) resetZhangba(); // 选牌途中次数变得不可用 → 安全退出,不卡在选牌模式
    if(zhangbaMode){
      // 丈八选牌模式:选两张手牌当杀,再点目标。提供取消。
      hint.textContent='丈八蛇矛:选两张手牌当作【杀】(已选 '+zhangbaPicks.length+'/2)'+(zhangbaPicks.length===2?'，攻击距离 '+attackRange(g,mySeat)+'，点上方一名对手作为目标。':'。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetZhangba(); render(g); }; c.appendChild(cb);
    } else if(selectedCardIdx!==null){
      const selCard=(me.hand||[])[selectedCardIdx]||{};
      const nm=selCard.name;
      // 龙胆:选中一张闪当杀打目标时,显示"【闪】当【杀】"避免困惑
      const label = (nm==='闪') ? '【闪】当【杀】' : '【'+nm+'】';
      // 杀受攻击距离限制,提示当前射程,让玩家理解为何有人"够不着"
      const rangeNote = canUseAs(me,selCard,'杀') ? '，攻击距离 '+attackRange(g,mySeat)+'，仅范围内对手可选' : '';
      hint.textContent='已选中'+label+rangeNote+',点上方一名对手作为目标(或点牌取消)。';
    } else {
      const shaInfo = hasCap(me,'unlimitedSha') ? '可出任意张杀' : (g.shaUsed?'已用过杀':'可出1张杀');
      hint.textContent='点手牌出牌:【杀】/【决斗】/【顺手牵羊】/【过河拆桥】选目标 ·【桃】回血 ·【无中生有】摸两张 ·【南蛮入侵】/【万箭齐发】群体 · 装备牌点击直接装备。本回合'+shaInfo+'。';
    }
    // 丈八蛇矛入口:装丈八(twoAsSha)、手牌≥2、且本回合还能出杀(canSha,与单张杀同口径)时才出现——
    // 否则普通武将出过一张杀后仍白进选牌流程。张飞等无限杀者 canSha 恒真,可继续用丈八。
    if(!zhangbaMode && selectedCardIdx===null && hasCap(me,'twoAsSha') && (me.hand||[]).length>=2 && canSha){
      const zb=document.createElement('button'); zb.className='ghost';
      zb.textContent='丈八蛇矛:两张牌当杀'; zb.onclick=()=>{ selectedCardIdx=null; zhangbaMode=true; zhangbaPicks=[]; render(g); }; c.appendChild(zb);
    }
    const b=document.createElement('button'); b.className='ghost';
    b.textContent='结束出牌'; b.onclick=()=>{selectedCardIdx=null;resetZhangba();endPlay();}; c.appendChild(b);
  } else if(g.phase==='discard'){
    const over = me.hand.length - me.hp;
    const keji = canSkipDiscard(g, mySeat); // 吕蒙【克己】满足:可跳过弃牌
    if(over>0) hint.textContent = keji
      ? '克己:本回合未出杀,可不弃牌直接结束回合(也可点手牌自愿弃置)。'
      : '手牌超出体力,需弃掉 '+over+' 张(点手牌弃置)。';
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
    el.className='card '+cls+((selectedCardIdx===idx||picked)?' selected':'');
    el.innerHTML='<div class="corner">'+(cardFace(card)||card.name)+'</div><div class="big">'+card.name+'</div><div class="corner br">'+card.name+'</div>';

    let usable=false, onClick=null;
    if(g.phase==='guicai'&&guicaiMode&&g.pending&&g.pending.type==='guicai'&&g.pending.seat===mySeat){
      // 鬼才选牌模式:任意一张手牌都可以打出替换判定牌
      usable=true; onClick=()=>respondGuicai(true, idx);
    } else if(g.phase==='play'&&myTurn&&zhangbaMode){
      // 丈八选牌模式:点牌 = toggle 到 zhangbaPicks(任意牌均可,最多2张;已满则仅允许取消已选)
      usable = picked || zhangbaPicks.length<2;
      if(usable) onClick=()=>{
        if(picked) zhangbaPicks = zhangbaPicks.filter(x=>x!==idx);
        else if(zhangbaPicks.length<2) zhangbaPicks.push(idx);
        render(g);
      };
    } else if(g.phase==='play'&&myTurn){
      // actionId:赵云的闪也走'杀',其余按牌名;查 CARD_PLAYS 决定可用性与点击行为
      const actionId = canUseAs(me,card,'杀') ? '杀' : card.name;
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
    const badge=document.createElement('div'); badge.className='info-badge'; badge.textContent='?';
    badge.onclick=(e)=>{ e.stopPropagation(); showInfo(card.name, escapeHtml(getAnyDesc(card.name)||'(暂无说明)')); };
    el.appendChild(badge);
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
function hideInfo(){ const m=document.getElementById('infoModal'); m.classList.add('hidden'); m.innerHTML=''; }
// 供座位卡内联触发(武将/装备,均公开信息);inline onclick 已 stopPropagation,不触发选目标
function showGeneralInfo(id){ const gen=getGeneral(id); if(gen) showInfo(gen.name+' · '+gen.skill, escapeHtml(gen.desc||'(暂无说明)')); }
function showEquipInfo(name){ const e=getEquip(name); showInfo(name, escapeHtml((e&&e.desc)||'(暂无说明)')); }
// 帮助按钮:一次性列出全部牌/武将/装备说明
function showHelp(){
  let html='<div class="sec">基础牌 / 锦囊</div>';
  ['杀','闪','桃','决斗','无中生有','顺手牵羊','过河拆桥','无懈可击','南蛮入侵','万箭齐发','闪电','乐不思蜀'].forEach(n=>{
    html+='<div class="item"><b>'+escapeHtml(n)+'</b>：'+escapeHtml(getCardDesc(n))+'</div>'; });
  html+='<div class="sec">武将</div>';
  GENERAL_IDS.forEach(id=>{ const gg=getGeneral(id);
    html+='<div class="item"><b>'+escapeHtml(gg.name)+'【'+escapeHtml(gg.skill)+'】</b>：'+escapeHtml(gg.desc||'')+'</div>'; });
  html+='<div class="sec">装备</div>';
  Object.keys(EQUIPS).forEach(n=>{
    html+='<div class="item"><b>'+escapeHtml(n)+'</b>：'+escapeHtml(getEquip(n).desc||'')+'</div>'; });
  showInfo('规则 / 说明', html);
}
