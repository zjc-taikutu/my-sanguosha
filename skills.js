// skills.js — 各武将专属技能/特定锦囊机制的实现,从 game.js 拆分出来(纯重构,行为零变化,
// 这是继 weapons.js(武器/防具特效)之后 game.js 的第二次拆分)。
//
// 【这批函数为什么能安全独立】排查确认它们彼此之间零调用关系(每个技能只有自己的几个
// 函数互相调用,不同技能之间不存在依赖),只共同依赖 game.js 留下的核心编排函数
// (dealDamage/checkWin/pushLog/tx等hub函数,以及 resolveShaUse/resolveTrick/
// finishGuicai 等留在 game.js 的杀/锦囊/判定拦截引擎)。被 render-controls.js(多数)/
// render.js/render-hand.js 的 UI 点击直接调用是正常形态,和 weapons.js 里
// respondHanbingAsk 等函数被 render.js 的 onclick 调用是同一性质,不代表这些技能
// 函数之间有耦合。
//
// 【核实中从最初候选名单里拉回 game.js core 的函数,不在这里】distance/equipDist
// (距离系统,归属 attackRange/canReachSha 同一族)、ensureDeck(牌堆管理,归属
// drawN/judge)、stripUndefined(tx的序列化辅助)、startDying(濒死通用机制,归属
// dealDamage/checkWin/finishDying)、playCard/isTrickCardName(统一出牌入口,归属
// CARD_PLAYS)、aoeEffect/aoeRespond(AOE通用发起/响应机制,归属aoeAdvance)、
// equipCard(装备通用机制)、discardCard/discardCards(弃牌阶段通用机制)、
// endTurn(回合结束通用触发)——这些函数虽然在最初的调用图聚类里因为"组内互调次数
// 低于阈值"被归进了长尾,但它们的真实角色是"所有玩家都会用到的基础规则",不是
// 某个武将/技能专属逻辑,核实后改判定为留在 core。
//
// 【开局武将分配相关函数不在这里】startGame/finishGeneralAssign/respondPickGeneral/
// debugPickGeneral 归入 room-lifecycle.js(和建房/加入/重开同一个"游戏生命周期"
// 主题,不是武将技能)。


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
        const card = tgt.hand.splice(j,1)[0];
        me.hand.push(card);
        // 陆逊【连营】:检查目标玩家是否触发连营
        maybeStartLianying(g, t, 1);
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
    // 陆逊【连营】:检查是否触发连营
    maybeStartLianying(g, mySeat, 1);
    g.discard.push(card);
    g.log=pushLog(g.log, me.name+' 对 '+A.name+' 使用【借刀杀人】,目标 '+B.name);
    markCardSound(g, '借刀杀人', mySeat, card, seatA); // 借刀杀人不走 playCard 统一出口(两步选目标的独立函数),单独补一次
    startTrick(g, {trick:'借刀杀人', from:mySeat, to:seatA, seatB});
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
    // 陆逊【连营】:检查是否触发连营
    maybeStartLianying(g, mySeat, 1);
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
    // 陆逊【连营】:检查是否触发连营
    maybeStartLianying(g, mySeat, 1);
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
    // 陆逊【连营】:检查是否触发连营
    maybeStartLianying(g, mySeat, 1);
    const trickCard={...card, name:'乐不思蜀', originalName:card.name};
    g.log=pushLog(g.log, me.name+' 将【'+card.name+'】当【乐不思蜀】使用,发动【国色】,目标 '+target.name);
    markSkillSound(g, '国色');
    markCardSound(g, '乐不思蜀', mySeat, card, targetSeat);
    startTrick(g, {trick:'乐不思蜀', from:mySeat, to:targetSeat, card:trickCard});
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
    // 陆逊【连营】:检查是否触发连营
    maybeStartLianying(g, mySeat, 1);
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

function chainedDamageTargets(g, seat){
  return (g.players||[])
    .map((p,i)=>({p,i}))
    .filter(o=>o.i!==seat && o.p && o.p.alive && o.p.chained)
    .map(o=>o.i);
}

function propagateChainedDamage(g, seat, amount, sourceSeat, reason, srcType, sourceCard){
  const nature=cardDamageNature(sourceCard);
  const p=g.players[seat];
  if(!nature || !p || !p.chained || amount<=0) return false;
  const targets=chainedDamageTargets(g, seat);
  p.chained=false;
  g.log=pushLog(g.log, p.name+' 解除连环状态');
  for(const targetSeat of targets){
    const target=g.players[targetSeat];
    if(!target || !target.alive || !target.chained) continue;
    target.chained=false;
    g.log=pushLog(g.log, target.name+' 被连环传导,解除连环状态');
    const interrupted=dealDamage(g, targetSeat, amount, sourceSeat, '连环传导'+(damageNatureText(nature)?'('+damageNatureText(nature)+')':''), srcType, sourceCard, false, false, true);
    if(interrupted) return true;
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
    // 陆逊【连营】:检查是否触发连营
    maybeStartLianying(g, mySeat, 1);
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

function respondHuogongReveal(cardIdx){
  tx(g=>{
    if(g.phase!=='huogongReveal'||!g.pending||g.pending.type!=='huogongReveal'||g.pending.to!==mySeat) return g;
    const d=g.pending;
    const target=g.players[mySeat], user=g.players[d.from];
    if(!target || !target.alive || !user || !user.alive){ g.pending=null; g.phase='play'; return g; }
    const revealed=(target.hand||[])[cardIdx];
    if(!revealed) return g;
    const suit=cardSuitForPlayer(target, revealed);
    g.log=pushLog(g.log, target.name+' 展示 '+suit+rankText(revealed.rank)+'【'+revealed.name+'】');
    const hasSame=(user.hand||[]).some(c=>c && cardSuitForPlayer(user, c)===suit);
    if(!hasSame){
      g.pending=null; g.phase='play';
      g.log=pushLog(g.log, user.name+' 没有同花色手牌,【火攻】不造成伤害');
      return g;
    }
    g.pending={type:'huogong', from:d.from, to:mySeat, suit, sourceCard:d.sourceCard};
    g.phase='huogong';
    g.log=pushLog(g.log, user.name+' 可弃置一张'+suit+'手牌,令 '+target.name+' 受到1点火属性伤害');
    return g;
  });
}

function respondHuogong(activate, cardIdx){
  tx(g=>{
    if(g.phase!=='huogong'||!g.pending||g.pending.type!=='huogong'||g.pending.from!==mySeat) return g;
    const d=g.pending;
    const me=g.players[mySeat], target=g.players[d.to];
    if(!me || !me.alive || !target || !target.alive){ g.pending=null; g.phase='play'; return g; }
    if(!activate){
      g.log=pushLog(g.log, me.name+'：不弃牌,【火攻】不造成伤害');
      g.pending=null; g.phase='play';
      return g;
    }
    const card=me.hand[cardIdx];
    if(!card || cardSuitForPlayer(me, card)!==d.suit) return g;
    me.hand.splice(cardIdx,1);
    g.discard.push(card);
    const sourceCard=d.sourceCard;
    g.log=pushLog(g.log, me.name+' 弃置 '+d.suit+'【'+card.name+'】,【火攻】生效');
    g.pending=null;
    const dying=dealDamage(g, d.to, 1, mySeat, '【火攻】', 'huogong', sourceCard);
    if(dying) return g;
    if(checkWin(g)) return g;
    g.phase='play';
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
    // 陆逊【连营】:检查是否触发连营（一次性检查整个操作后的手牌数）
    if(moved.length > 0) maybeStartLianying(g, mySeat, moved.length);
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
    // 陆逊【连营】:检查是否触发连营
    maybeStartLianying(g, mySeat, 1);
    g.discard.push(card);
    tgt.hp=Math.min(tgt.maxHp, tgt.hp+1);
    g.log=pushLog(g.log, me.name+' 弃置一张牌,发动【青囊】,令 '+tgt.name+' 回复1点体力');
    markSkillSound(g, '青囊');
    g.phase='play';
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

// ===== 姜维【志继】 =====
// respondZhijiChoice: 姜维【志继】觉醒后的选择
// choice: true=回复1点体力, false=摸两张牌
function respondZhijiChoice(healOrDraw){
  tx(g=>{
    if(g.phase!=='zhijiChoice'||!g.pending||g.pending.type!=='zhijiChoice') return g;
    const seat = g.pending.seat;
    const p = g.players[seat];
    if(!p || !p.alive) {
      g.pending = null; g.phase = 'play';
      return g;
    }
    
    if(healOrDraw){
      // 选择回复1点体力
      p.hp = Math.min(p.hp + 1, p.maxHp);
      g.log = pushLog(g.log, p.name + ' 选择回复1点体力');
    } else {
      // 选择摸两张牌
      drawN(g, seat, 2);
      g.log = pushLog(g.log, p.name + ' 选择摸两张牌');
    }
    
    // 获得观星技能（在选择完成后才生效）
    if(!p.caps) p.caps = {};
    p.caps.guanxing = true;
    g.log = pushLog(g.log, p.name + ' 【志继】觉醒完成,获得【观星】技能');
    g.pending = null;
    // 继续准备阶段的后续流程
    continueGuanxingCheck(g, seat);
    return g;
  });
}

// ===== 姜维【挑衅】 =====
// respondTiaoxin: 姜维【挑衅】,选择目标后提交。服务端在 tx 内:
// 1. 校验:出牌阶段,本回合未使用过挑衅,目标合法
// 2. 设 g.tiaoxinUsed=true,开 pending 询问目标角色选择:①对你使用一张杀;②让你弃置其一张牌
function respondTiaoxin(targetSeat){
  tx(g=>{
    if(g.phase!=='play'||g.turn!==mySeat) return g;
    const me=g.players[mySeat];
    if(!me || !me.alive || !hasCap(me,'tiaoxin')) return g;
    if(g.tiaoxinUsed) return g; // 本回合已使用过
    const target = g.players[targetSeat];
    if(!target || !target.alive || targetSeat===mySeat) return g;
    
    g.tiaoxinUsed=true;
    g.pending={type:'tiaoxinChoice', from:mySeat, to:targetSeat};
    g.phase='tiaoxinChoice';
    g.log=pushLog(g.log, me.name+' 发动【挑衅】,要求 '+target.name+' 选择:对其使用一张杀或被弃置一张牌');
    return g;
  });
}

// respondTiaoxinChoice: 挑衅目标的选择
// target 选择: true=使用杀, false=被弃置一张牌
function respondTiaoxinChoice(useSha){
  tx(g=>{
    if(g.phase!=='tiaoxinChoice'||!g.pending||g.pending.type!=='tiaoxinChoice') return g;
    const from=g.pending.from, to=g.pending.to;
    const target=g.players[to];
    const asker=g.players[from];
    
    if(useSha){
      // 目标选择对挑衅者使用一张杀
      // 检查目标是否能出杀
      const shaCard = findUsableAs(target.hand, target, '杀');
      if(shaCard && shaCard.card){
        // 使用杀 - resolveShaUse(g, me, targetSeat, usedAs, shaColor, sourceCard)
        // 这里target是出杀者，from是目标
        resolveShaUse(g, target, from, shaCard.role, singleCardShaColor(shaCard.card), shaCard.card);
        g.pending=null; g.phase='play';
      } else {
        // 目标不能出杀，视为放弃使用杀，需要被弃置一张牌
        g.log=pushLog(g.log, target.name+' 无法对 '+asker.name+' 使用杀,自动选择被弃置一张牌');
        // 落到弃置分支
        const discardable=[...(target.hand||[]), ...Object.values(target.equips||{}).filter(e=>e)];
        if(discardable.length>0){
          const idx=Math.floor(Math.random()*discardable.length);
          const card=discardable[idx];
          if((target.hand||[]).includes(card)){
            const handIdx=target.hand.indexOf(card);
            target.hand.splice(handIdx, 1);
            g.discard.push(card);
          } else {
            // 是装备牌
            const slot=Object.keys(target.equips||{}).find(s=>target.equips[s]===card);
            if(slot) {
              target.equips[slot]=null;
              g.discard.push(card);
            }
          }
          g.log=pushLog(g.log, asker.name+' 弃置了 '+target.name+' 的一张牌');
        }
        g.pending=null; g.phase='play';
      }
    } else {
      // 目标选择被弃置一张牌
      const discardable=[...(target.hand||[]), ...Object.values(target.equips||{}).filter(e=>e)];
      if(discardable.length>0){
        const idx=Math.floor(Math.random()*discardable.length);
        const card=discardable[idx];
        if((target.hand||[]).includes(card)){
          const handIdx=target.hand.indexOf(card);
          target.hand.splice(handIdx, 1);
          g.discard.push(card);
        } else {
          // 是装备牌
          const slot=Object.keys(target.equips||{}).find(s=>target.equips[s]===card);
          if(slot) {
            target.equips[slot]=null;
            g.discard.push(card);
          }
        }
        g.log=pushLog(g.log, asker.name+' 弃置了 '+target.name+' 的一张牌');
      }
      g.pending=null; g.phase='play';
    }
    return g;
  });
}
