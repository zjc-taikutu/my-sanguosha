// ---------- game constants ----------
const SEATS = 3;        // 房间容量上限(满 3 不再加入)
const MIN_PLAYERS = 2;  // 开始游戏的最低人数(2 或 3 人均可开始)
const MAX_HP = 4; // 大厅占位 / 兜底默认体力上限
const START_HAND = 4;
const BASIC_CARDS = ['杀','闪','桃']; // 基本牌:不含锦囊/装备,乐进【骁果】等按"是不是基本牌"判断的地方统一查这个表

// ---------- 装备区(地基:只搭容器+显示;派生属性/距离/射程/效果一律后续经 EQUIPS 常量表 + getEquip 实现,不写进 Firebase) ----------
// 四槽:weapon 武器 / armor 防具 / plus1 +1马(防御马) / minus1 -1马(进攻马);每槽存一张装备牌对象 {id,name} 或 null(空)。
const EQUIP_SLOTS = ['weapon','armor','plus1','minus1'];
function emptyEquips(){ return { weapon:null, armor:null, plus1:null, minus1:null }; }
// 装备牌派生属性表(name→{slot,...});只存在客户端,从不写进 Firebase(持久化的只有槽里的 {id,name})。
// range(武器射程)/dist(马的距离修正)本步只声明、不生效,留给后续距离系统。业务层查表不硬编码装备名。
const EQUIPS = {
  '诸葛连弩': { slot:'weapon', range:1, cap:'unlimitedSha', desc:'武器,射程1。装备后,你在自己的出牌阶段可以使用任意数量的【杀】(不再受每回合只能出1张的限制)。' },
  '丈八蛇矛': { slot:'weapon', range:3, cap:'twoAsSha', desc:'武器,射程3。你可以把任意两张手牌合起来当作一张【杀】使用。' },
  '八卦阵':   { slot:'armor', cap:'bagua', desc:'防具。当你需要打出【闪】时,可先翻开牌堆顶一张牌碰运气:翻到红色就当作你打出了【闪】,黑色则无效、仍需正常应对。' },
  '仁王盾':   { slot:'armor', cap:'renwang', desc:'防具。黑色的【杀】对你无效。' },
  '青釭剑':   { slot:'weapon', range:2, cap:'ignoreArmor', desc:'武器,射程2。你使用【杀】时无视对方的防具(例如对方的【八卦阵】无法发动)。' },
  '麒麟弓':   { slot:'weapon', range:5, cap:'qilin', desc:'武器,射程5。你的【杀】对目标造成伤害时,可以弃掉对方装备的一匹坐骑。' },
  '青龙偃月刀': { slot:'weapon', range:3, cap:'qinglong', desc:'武器,射程3。你使用的【杀】被【闪】抵消时,你可以对同一目标再使用一张【杀】(不计入出杀次数限制,无距离限制,只要又被闪抵消可以连续触发)。' },
  '寒冰剑':   { slot:'weapon', range:2, cap:'hanbing', desc:'武器,射程2。你使用的【杀】命中目标时,可以防止此伤害,改为弃置该角色两张牌(不足两张则弃光为止,不能被无懈可击抵消)。' },
  '方天画戟': { slot:'weapon', range:4, cap:'fangtian', desc:'武器,射程4。锁定技,若你使用的【杀】是你手牌里的最后一张牌,则此【杀】可以额外选择至多两个目标(可以不多选、也可以只多选一个)。' },
  '古锭刀':   { slot:'weapon', range:2, cap:'gudingdao', desc:'武器,射程2。锁定技,当你使用【杀】对目标角色造成伤害时,若其没有手牌,此伤害+1。' },
  '贯石斧':   { slot:'weapon', range:3, cap:'guanshifu', desc:'武器,射程3。当你使用的【杀】被【闪】抵消时,你可以弃置两张牌(手牌/装备任意组合,须同时弃满两张),令此【杀】依然造成伤害。' },
  '的卢':     { slot:'plus1', dist:+1, desc:'坐骑(防御马)。其他角色计算与你的距离时+1,让你更难被【杀】攻击到。' },
  '绝影':     { slot:'plus1', dist:+1, desc:'坐骑(防御马)。其他角色计算与你的距离时+1,让你更难被【杀】攻击到。' },
  '爪黄飞电': { slot:'plus1', dist:+1, desc:'坐骑(防御马)。其他角色计算与你的距离时+1,让你更难被【杀】攻击到。' },
  '大宛':     { slot:'minus1', dist:-1, desc:'坐骑(进攻马)。你计算与其他角色的距离时-1,让你更容易攻击到别人。' },
  '赤兔':     { slot:'minus1', dist:-1, desc:'坐骑(进攻马)。你计算与其他角色的距离时-1,让你更容易攻击到别人。' },
  '紫骍':     { slot:'minus1', dist:-1, desc:'坐骑(进攻马)。你计算与其他角色的距离时-1,让你更容易攻击到别人。' },
  '骕骦':     { slot:'minus1', dist:-1, desc:'坐骑(进攻马)。你计算与其他角色的距离时-1,让你更容易攻击到别人。' },
};
function getEquip(name){ return EQUIPS[name] || null; } // 唯一查询入口

// ---------- 延时锦囊(判定区)地基:seam 已搭好,三张具体牌(闪电/乐不思蜀/兵粮寸断)尚未实现 ----------
// name -> { onlySelf(是否只能对自己使用,如日后的闪电), effect(g,seat,judgeCard,card)=>可选返回"传给谁"的座位号 }。
// effect 在 game.js 的 resolveDelayTricks(回合开始的判定阶段)里被调用:seat=正在结算判定区的玩家,
// judgeCard=judge(g)翻出的判定牌,card=延时锦囊牌本身。返回数字座位号=传给该玩家(判定区各自独立,不进弃牌堆);
// 不返回(undefined)=判定完就弃置。加新延时锦囊:1) 这里加一项 2) buildDeck 里加牌——和 EQUIPS 表同一套约定。
const DELAY_TRICKS = {};
// 闪电:只能放在自己判定区(onlySelf)。回合开始判定黑桃2~9(不含A/10/J/Q/K)则受到3点无来源伤害、
// 闪电作废;否则不受伤害,传给下家(nextAlive 环形顺序,阵亡者不占位)。dealDamage 的 sourceSeat
// 传 undefined——已确认安全:司马懿【反馈】等依赖 sourceSeat 的钩子本来就防御了非数字来源,静默跳过。
// dealDamage 命中致命时会挂起濒死流程(返回 true),此时 effect 仍返回 'pending' 让 resolveDelayTricks
// 停止处理、把控制权交还(闪电这张牌本身照常进弃牌堆,和是否致命无关,由 resolveDelayTricks 统一处理)。
DELAY_TRICKS['闪电'] = {
  onlySelf:true,
  effect:(g, seat, judgeCard, card)=>{
    if(cardSuitForPlayer(g.players[seat], judgeCard)==='♠' && judgeCard.rank>=2 && judgeCard.rank<=9){
      const dying = dealDamage(g, seat, 3, undefined, '【闪电】发动', 'delay', card);
      return dying ? 'pending' : undefined;
    }
    // 判定不中:移到下一名"判定区里没有【闪电】"的其他存活角色(官方通则:同一判定区不能有两张同名牌)。
    // 找不到合法去处(极端边界:2人局且对方判定区已有另一张闪电)则作废进弃牌堆、不传回自己,
    // 否则本回合判定循环会立刻再判一次造成死循环。
    const n=g.players.length;
    for(let k=1;k<=n;k++){
      const s=(seat+k)%n;
      if(s===seat) break;
      const p=g.players[s];
      if(p && p.alive && !(p.delays||[]).some(c=>c && c.name==='闪电')) return s;
    }
    g.log = pushLog(g.log, '场上没有可传递的判定区,【闪电】作废');
  }
};
// 乐不思蜀:只能放在别人判定区(onlySelf:false)。回合开始判定,官方原文是"若判定结果不为
// 红桃,则跳过其出牌阶段"——精确到花色(♥),不是红/黑两大类:红桃♥=判定失败,无效果;
// 黑桃/梅花/方块(含方块这张"红色但不是红桃"的牌)=判定成功,跳过这个回合的出牌阶段。
// 摸牌阶段依然正常摸牌,只是不给出牌机会,所以不能在这里直接切阶段(这时候还没摸牌),
// 只能设一个标志位 g.skipPlay,交给 doDraw 在摸完牌、原本要进 play 阶段的那一刻消费掉。
// 不管判定结果是哪种花色,乐不思蜀本身都作废(不返回值,resolveDelayTricks 默认分支进弃牌堆);
// 不产生伤害,不会触发濒死流程,不需要闪电那套 'pending' 挂起机制。
// 【曾经的 bug】最初这里写的是 `if(!isRed(judgeCard)) g.skipPlay=true`(只按红/黑两大类判断),
// 会把方块(红色但不是红桃)也当成"逃脱花色"错误放行——已改为直接比较 `judgeCard.suit`。
DELAY_TRICKS['乐不思蜀'] = {
  onlySelf:false,
  effect:(g, seat, judgeCard, card)=>{
    const name=g.players[seat].name;
    if(cardSuitForPlayer(g.players[seat], judgeCard)!=='♥'){
      g.skipPlay=true;
      g.log=pushLog(g.log, name+' 判定不为红桃,【乐不思蜀】生效,跳过出牌阶段');
    } else {
      g.log=pushLog(g.log, name+' 判定为红桃,【乐不思蜀】无效');
    }
  }
};
// 兵粮寸断:只能放别人判定区。官方原文"若判定结果不为梅花,则跳过其摸牌阶段"——精确到
// 花色(♣),不是红/黑两大类:梅花♣=判定失败,无效果;红桃/黑桃/方块(含黑桃这张"黑色但
// 不是梅花"的牌)=判定成功,跳过该玩家这个回合的摸牌阶段。和乐不思蜀"跳过阶段"的触发
// 条件各自锁定不同花色,不是同一个"红/黑"判断的镜像,影响的阶段也相反
// (兵粮寸断管摸牌 g.skipDraw,乐不思蜀管出牌 g.skipPlay)——两个标志位各管一段、
// 互不覆盖;真正消费的地方是 enterDrawPhase(见 game.js),会同时兼顾两者同时命中的情况。
// 不管判定结果是哪种花色,兵粮寸断本身都作废(不返回值,resolveDelayTricks 默认分支进弃
// 牌堆),不像闪电那样在"不生效"时传给下家——判定完这张牌就离开判定区,不产生伤害,不触发
// 濒死。【曾经的 bug】最初这里写的是 `if(!isRed(judgeCard)) g.skipDraw=true`(只按红/黑
// 两大类判断)——这个判断方向整体是反的:红桃/方块本该生效却被误判成"红=逃脱"而放行,
// 黑桃本该逃脱却被误判成"黑=生效"——已改为直接比较 `judgeCard.suit`。
DELAY_TRICKS['兵粮寸断'] = {
  onlySelf:false,
  effect:(g, seat, judgeCard, card)=>{
    const name=g.players[seat].name;
    if(cardSuitForPlayer(g.players[seat], judgeCard)!=='♣'){
      g.skipDraw=true;
      g.log=pushLog(g.log, name+' 判定不为梅花,【兵粮寸断】生效,跳过摸牌阶段');
    } else {
      g.log=pushLog(g.log, name+' 判定为梅花,【兵粮寸断】无效');
    }
  }
};

// ---------- 武将定义表(数据结构 + 技能均已实现) ----------
// 技能有两种表达:被动能力挂 caps(经 generalHasCap/generalCapValue 查),触发型挂 hooks(经 triggerHook 分发);统一经 getGeneral(id) 取用。
const GENERALS = {
  zhangfei:      { id:'zhangfei',      name:'张飞',   gender:'male',   maxHp:4, skill:'咆哮', desc:'出牌阶段,你可以使用任意数量的【杀】。', caps:{ unlimitedSha:true } },
  guojia: { id:'guojia', name:'郭嘉', gender:'male', maxHp:3, skill:'天妒/遗计',
    desc:'天妒:当你的判定牌生效后,你可以获得此牌。遗计:当你受到1点伤害后,你可以选择观看牌堆顶两张牌,然后将这两张牌分别交给任意角色(可以是自己)。',
    caps:{ tiandu:true },
    hooks:{
      onDamaged(g, seat, ctx){
        const p=g.players[seat];
        if(!p || !p.alive || (g.deck||[]).length===0) return; // 牌堆空则无法发动,静默跳过
        // resume 记下"遗计问完之后该接回哪条被打断的流程"——取值就是 dealDamage 本来就在传的
        // ctx.srcType,和濒死求桃(startDying)同一套约定,复用同一个 resumeAfterInterrupt 出口。
        // 'delay'/'xiaoguo' 这两种 srcType 需要的额外字段(seat/endingSeat/lastAsker),由各自
        // 原有的挂起入口负责补全(见 continueDelayResolution/finishGuicai 的 delayJudge 分支/
        // respondXiaoguoChoice,这几处已经对 g.pending.type==='dying' 做同样的事,这次一并
        // 扩展到 'yijiAsk'),这里不需要关心这些细节。
        g.pending = { type:'yijiAsk', seat, resume:{type:ctx.srcType} };
        g.phase = 'yijiAsk';
        g.log = pushLog(g.log, p.name+' 是否发动【遗计】,观看牌堆顶两张牌…');
      }
    } },
  sunshangxiang: { id:'sunshangxiang', name:'孙尚香', gender:'female', maxHp:3, skill:'枭姬', desc:'当你失去装备区里的一张装备牌时,你摸两张牌。', hooks:{ onLoseEquip:(g, seat, ctx)=>{ const n = 2 * (ctx && ctx.count || 1); drawN(g, seat, n); g.log=pushLog(g.log, g.players[seat].name+' 发动【枭姬】,摸'+n+'张牌'); markSkillSound(g, '枭姬'); } } },
  diaochan:      { id:'diaochan',      name:'貂蝉',   gender:'female', maxHp:3, skill:'离间/闭月',
    desc:'离间:出牌阶段限一次,你可以弃置一张手牌,选择两名男性角色,令其中一名男性角色视为对另一名男性角色使用【决斗】。闭月:结束阶段,你可以摸1张牌。',
    caps:{ lijian:true, biyue:true } },
  kongrong:      { id:'kongrong',      name:'孔融',   gender:'male', maxHp:3, skill:'礼让/争义',
    desc:'礼让:每轮限一次,其他角色的摸牌阶段开始时,你可以交给其两张牌;其本回合弃牌阶段结束时,你可以获得其在此弃牌阶段弃置的牌。争义:每回合首次受到伤害时,本轮内因礼让获得过你牌的角色可以替你承受此次伤害。',
    caps:{ lirang:true, zhengyi:true } },
  zhaoyun:       { id:'zhaoyun',       name:'赵云',   gender:'male',   maxHp:4, skill:'龙胆', desc:'你可以将【杀】当【闪】、【闪】当【杀】使用(1:1 转化)。', caps:{ longdan:true } },
  lvmeng:        { id:'lvmeng',        name:'吕蒙',   gender:'male',   maxHp:4, skill:'克己', desc:'若你于出牌阶段未使用或打出过【杀】,你可以跳过弃牌阶段(手牌超过体力上限也不必弃牌)。', caps:{ keji:true } },
  simayi:        { id:'simayi',        name:'司马懿', gender:'male', maxHp:3, skill:'反馈', desc:'当你受到伤害后,你获得伤害来源的一张手牌(随机)。你进行判定时,可以打出一张手牌替换之(鬼才)。',
    caps:{ guicai:true },
    hooks:{
      // 受伤后从伤害来源随机获得一张手牌。ctx={amount, sourceSeat}。
      onDamaged(g, seat, ctx){
        const src = (typeof ctx.sourceSeat==='number') ? g.players[ctx.sourceSeat] : null;
        if(!src || ctx.sourceSeat===seat || !src.alive) return; // 无效来源/是自己/已阵亡 -> 静默跳过
        if((src.hand||[]).length===0){
          g.log = pushLog(g.log, g.players[seat].name+' 【反馈】发动,但 '+src.name+' 无牌可获得');
          return;
        }
        const j = Math.floor(Math.random()*src.hand.length);
        g.players[seat].hand.push(src.hand.splice(j,1)[0]);
        g.log = pushLog(g.log, g.players[seat].name+' 【反馈】发动,获得 '+src.name+' 一张牌');
        markSkillSound(g, '反馈');
      }
    } },
  xiahoudun:     { id:'xiahoudun',     name:'夏侯惇', gender:'male', maxHp:4, skill:'刚烈',
    desc:'当你受到伤害后,你可以进行判定,若结果不为红桃,伤害来源选择弃置2张手牌或受到你造成的1点伤害。',
    hooks:{
      onDamaged(g, seat, ctx){
        const self=g.players[seat];
        const sourceSeat=ctx && ctx.sourceSeat;
        const source=(typeof sourceSeat==='number') ? g.players[sourceSeat] : null;
        if(!self || !self.alive || !source || !source.alive || sourceSeat===seat || ctx.srcType==='ganglie') return;
        g.pending={type:'ganglieAsk', seat, sourceSeat, resume:{type:ctx.srcType}};
        g.phase='ganglieAsk';
        g.log=pushLog(g.log, self.name+' 是否发动【刚烈】,对 '+source.name+' 进行判定反击…');
      }
    } },
  xuchu:         { id:'xuchu',         name:'许褚',   gender:'male', maxHp:4, skill:'裸衣',
    desc:'摸牌阶段,你可以少摸1张牌。若如此做,直到本回合结束,你使用【杀】或【决斗】造成的伤害+1。',
    caps:{ luoyi:true } },
  xunyu:         { id:'xunyu',         name:'荀彧',   gender:'male', maxHp:3, skill:'驱虎/节命',
    desc:'驱虎:出牌阶段限一次,你可以与一名体力值大于你的角色拼点。若你赢,该角色对其攻击范围内由你选择的一名角色造成1点伤害;若你没赢,该角色对你造成1点伤害。节命:每受到1点伤害后,你可以令一名角色摸牌至手牌数等于体力上限,最多摸至5张。',
    caps:{ quhu:true },
    hooks:{
      onDamaged(g, seat, ctx){
        const p=g.players[seat];
        if(!p || !p.alive || (ctx && ctx.srcType)==='jieming') return;
        const amount=Math.max(1, (ctx && ctx.amount) || 1);
        g.pending={type:'jiemingAsk', seat, remaining:amount, resume:{type:ctx.srcType}};
        g.phase='jiemingAsk';
        g.log=pushLog(g.log, p.name+' 是否发动【节命】,令一名角色补牌…');
      }
    } },
  daqiao:        { id:'daqiao',        name:'大乔',   gender:'female', maxHp:3, skill:'国色/流离',
    desc:'国色:出牌阶段,你可以将一张方块牌当【乐不思蜀】使用。流离:当你成为其他角色使用【杀】的目标时,你可以弃置一张牌,将此【杀】转移给你攻击范围内的另一名其他角色(不能是此【杀】的使用者)。',
    caps:{ guose:true, liuli:true } },
  xiaoqiao:      { id:'xiaoqiao',      name:'小乔',   gender:'female', maxHp:3, skill:'天香/红颜',
    desc:'天香:当你受到伤害时,你可以弃置一张红桃手牌并选择一名其他角色,防止此伤害,改为该角色受到此伤害,然后其摸等同于已损失体力值的牌。红颜:锁定技,你的黑桃牌均视为红桃牌。',
    caps:{ tianxiang:true, hongyan:true } },
  pangtong:      { id:'pangtong',      name:'庞统',   gender:'male', maxHp:3, skill:'连环/涅槃',
    desc:'连环:你可以将一张梅花手牌当【铁索连环】使用或重铸。涅槃:限定技,当你处于濒死状态时,你可以弃置所有牌,解除连环状态和翻面,摸3张牌并将体力回复至3点。',
    caps:{ lianhuan:true, niepan:true } },
  machao:        { id:'machao',        name:'马超',   gender:'male', maxHp:4, skill:'马术/铁骑',
    desc:'马术(锁定技):你计算与其他角色的距离时始终-1(可与装备的-1马叠加)。铁骑:当你使用【杀】指定一名角色为目标后,你可以进行判定,若结果为红色,此【杀】不可被【闪】抵消(含视为闪的效果,如八卦阵)。',
    caps:{ extraMinus1:true, tieqi:true } },
  zhenji:        { id:'zhenji',        name:'甄姬',   gender:'female', maxHp:3, skill:'洛神/倾国',
    desc:'洛神:回合开始时,你可以进行判定,若结果为黑色,你获得这张判定牌(计入手牌),并可以再次发动(直到红色或你选择停止)。倾国:你可以将黑色手牌当【闪】使用或打出。',
    caps:{ luoshen:true, qingguo:true } },
  zhangliao:     { id:'zhangliao',     name:'张辽',   gender:'male', maxHp:4, skill:'突袭',
    desc:'摸牌阶段,你可以放弃摸牌,改为从至多两名其他角色的手牌中各摸一张牌。',
    caps:{ tuxi:true } },
  ganning:       { id:'ganning',       name:'甘宁',   gender:'male', maxHp:4, skill:'奇袭',
    desc:'你可以将任意一张黑色手牌当【过河拆桥】使用。',
    caps:{ qixi:true } },
  huanggai:      { id:'huanggai',      name:'黄盖',   gender:'male', maxHp:4, skill:'苦肉',
    desc:'出牌阶段,你可以失去1点体力,然后摸两张牌。',
    caps:{ kurou:true } },
  huangyueying:  { id:'huangyueying',  name:'黄月英', gender:'female', maxHp:3, skill:'集智',
    desc:'当你使用一张锦囊牌时,你可以摸一张牌。',
    caps:{ jizhi:true } },
  sunquan:       { id:'sunquan',       name:'孙权',   gender:'male', maxHp:4, skill:'制衡',
    desc:'出牌阶段限一次,你可以弃置任意张牌,然后摸等量的牌。',
    caps:{ zhiheng:true } },
  zhouyu:        { id:'zhouyu',        name:'周瑜',   gender:'male', maxHp:3, skill:'英姿',
    desc:'锁定技,摸牌阶段你额外摸一张牌。',
    caps:{ extraDrawPhase:1 } },
  sunce:         { id:'sunce',         name:'孙策',   gender:'male', maxHp:4, skill:'激昂',
    desc:'当你使用【决斗】或红色【杀】指定目标后,或成为【决斗】或红色【杀】的目标后,你可以摸一张牌。魂姿为觉醒技、制霸为主公技,当前暂不实现。',
    caps:{ jiang:true } },
  huatuo:        { id:'huatuo',        name:'华佗',   gender:'male', maxHp:3, skill:'青囊/急救',
    desc:'青囊:出牌阶段限一次,你可以弃置一张手牌,令一名已受伤的角色回复1点体力。急救:你的回合外,你可以将一张红色牌当【桃】使用。',
    caps:{ qingnang:true, jijiu:true } },
  liubei:        { id:'liubei',        name:'刘备',   gender:'male', maxHp:4, skill:'仁德',
    desc:'出牌阶段,你可以将任意数量的手牌交给其他角色,若本阶段内给出的牌达到2张或以上,你回复1点体力。激将为主公技,当前无身份局系统,暂不实现。',
    caps:{ rende:true } },
  caocao:        { id:'caocao',        name:'曹操',   gender:'male', maxHp:4, skill:'奸雄',
    desc:'当你受到伤害后,你可以获得对你造成伤害的牌。护驾为主公技,当前无身份局系统,暂不实现。',
    hooks:{
      onDamaged(g, seat, ctx){
        const p=g.players[seat];
        const source=ctx && ctx.sourceCard;
        if(!p || !p.alive || !source) return;
        const cards=Array.isArray(source) ? source : [source];
        const gained=[];
        cards.forEach(card=>{
          if(!card) return;
          const idx=(g.discard||[]).findIndex(c=>c===card || (c && card.id!==undefined && c.id===card.id));
          if(idx<0) return;
          gained.push(g.discard.splice(idx,1)[0]);
        });
        if(gained.length===0) return;
        p.hand.push(...gained);
        g.log=pushLog(g.log, p.name+' 发动【奸雄】,获得造成伤害的'+gained.map(c=>'【'+c.name+'】').join('、'));
        markSkillSound(g, '奸雄');
      }
    } },
  guanyu:        { id:'guanyu',        name:'关羽',   gender:'male', maxHp:4, skill:'武圣',
    desc:'你可以将任意一张红色手牌当【杀】使用或打出。',
    caps:{ wusheng:true } },
  huangzhong:    { id:'huangzhong',    name:'黄忠',   gender:'male', maxHp:4, skill:'烈弓',
    desc:'出牌阶段,你使用【杀】指定一名角色为目标后,若该角色手牌数≥你的体力值,或手牌数≤你的攻击范围,你可以令此【杀】不可被【闪】抵消。',
    caps:{ liegong:true } },
  xuhuang:       { id:'xuhuang',       name:'徐晃',   gender:'male', maxHp:4, skill:'断粮',
    desc:'出牌阶段限一次,你可以将一张黑色基本牌或黑色装备牌当【兵粮寸断】使用(距离2以内)。',
    caps:{ duanliang:true } },
  yujin:         { id:'yujin',         name:'于禁',   gender:'male', maxHp:4, skill:'毅重',
    desc:'锁定技,若你的装备区里没有防具牌,黑色【杀】对你无效。',
    caps:{ yizhong:true } },
  yuejin:        { id:'yuejin',        name:'乐进',   gender:'male', maxHp:4, skill:'骁果',
    desc:'其他角色的结束阶段,你可以弃置一张基本牌,然后该角色选择一项:弃置一张装备牌,你摸一张牌;或受到你造成的1点伤害。',
    caps:{ xiaoguo:true } },
  zhanghe:       { id:'zhanghe',       name:'张郃',   gender:'male', maxHp:4, skill:'巧变',
    desc:'回合开始时(限一次),你可以弃置一张手牌并选择判定/摸牌/出牌/弃牌阶段之一跳过。若跳过的是出牌阶段,你可以将场上一张装备牌移到另一名角色的对应空槽,或将一张延时锦囊移到另一名角色没有同名锦囊的判定区。',
    caps:{ qiaobian:true } },
  lvbu:          { id:'lvbu',          name:'吕布',   gender:'male', maxHp:4, skill:'无双(锁定技)',
    desc:'你使用【杀】指定目标后,该角色需要连续使用两张【闪】才能抵消。你或你的对手使用/成为【决斗】的目标时,每次响应需要连续打出两张【杀】。',
    caps:{ wushuang:true } },
  zhuge:         { id:'zhuge',         name:'诸葛亮', gender:'male', maxHp:3, skill:'观星/空城',
    desc:'观星:准备阶段,你可以观看牌堆顶的X张牌(X为存活角色数且最多为5),以任意顺序分配至牌堆顶或牌堆底。空城:锁定技,若你没有手牌,你不能成为【杀】或【决斗】的目标。',
    caps:{ guanxing:true, kongcheng:true } },
};
const GENERAL_IDS = Object.keys(GENERALS);
function getGeneral(id){ return GENERALS[id] || null; } // 唯一查询入口
// 查询某玩家的武将是否拥有某项被动能力(能力声明在 GENERALS.caps,业务层不写武将名)
function generalHasCap(player, cap){
  const gen = player && getGeneral(player.general);
  return !!(gen && gen.caps && gen.caps[cap]);
}
// 读取数值型被动能力的值(无则返回 fallback),如 extraDrawPhase(摸牌阶段多摸 N 张;通用数值 seam,当前暂无武将/装备使用)
function generalCapValue(player, cap, fallback){
  const gen = player && getGeneral(player.general);
  const v = gen && gen.caps && gen.caps[cap];
  return (typeof v === 'number') ? v : fallback;
}
function generalGender(player){
  const gen = player && getGeneral(player.general);
  return (gen && gen.gender) || 'male';
}
function isMale(player){ return generalGender(player)==='male'; }
// 装备来源的能力:任一已装备的牌在 EQUIPS 里声明了 cap===该能力(如诸葛连弩 cap:'unlimitedSha')。
function equipHasCap(player, cap){
  if(!player || !player.equips) return false;
  return EQUIP_SLOTS.some(slot=>{
    const c = player.equips[slot];
    const info = c && getEquip(c.name);
    return !!(info && info.cap===cap);
  });
}
// 统一能力入口:武将 caps 或 装备 cap 任一提供即算拥有。实时查询无缓存 —— 卸下/替换装备后自然失效。
function hasCap(player, cap){ return generalHasCap(player, cap) || equipHasCap(player, cap); }
// ===== 牌的花色/点数(判定机制的地基;本步只加数据+显示,不做任何看花色的规则)=====
// 颜色由花色派生,统一走这些 seam,不到处硬判断花色。
function cardSuitForPlayer(player, card){
  if(!card) return undefined;
  if(generalHasCap(player,'hongyan') && card.suit==='♠') return '♥';
  return card.suit;
}
function isRed(card){ return !!(card && (card.suit==='♥'||card.suit==='♦')); }
function isRedForPlayer(player, card){
  const suit=cardSuitForPlayer(player, card);
  return suit==='♥'||suit==='♦';
}
function cardColor(card){ return isRed(card)?'red':'black'; }
function cardColorForPlayer(player, card){ return isRedForPlayer(player, card)?'red':'black'; }
// singleCardShaColor: 普通杀(含转化牌,如龙胆的闪当杀、武圣的红牌当杀)的颜色——直接查这张
// 物理牌本身的花色。给 resolveShaUse 的 shaColor 参数用,不是给"判定牌颜色"这类场景用
// (判定区/铁骑/洛神那些判定,直接查 isRed(judgeCard) 即可,不涉及"杀的颜色"这个概念)。
function singleCardShaColor(card){ return card ? (isRed(card)?'red':'black') : undefined; }
// combinedShaColor: 丈八蛇矛"两张牌当一张杀"的颜色规则——不看单张牌花色,按两张牌的红黑
// 组合决定:两张都红→红,两张都黑→黑,一红一黑→"无色"(仁王盾/毅重这类"黑杀无效"的效果
// 对无色杀不生效)。这是一个真实存在的三态结果,不是"非红即黑"的二元判断,和 isRed 的语义
// 不同,专门给合成杀这个场景用,单张牌的颜色判断永远只有红/黑两态,不需要这个函数。
function combinedShaColor(c1, c2){
  const r1=isRed(c1), r2=isRed(c2);
  if(r1 && r2) return 'red';
  if(!r1 && !r2) return 'black';
  return 'none';
}
// 点数显示:1→A、11~13→J/Q/K,其余原数字;缺失回退空串
function rankText(rank){ return {1:'A',11:'J',12:'Q',13:'K'}[rank] || (rank?String(rank):''); }
// 牌面花色+点数的带色 HTML(红 #b33 / 黑 #3a2f28);缺 suit/rank 安全回退空串(兼容旧牌)
function cardFace(card){
  if(!card || !card.suit) return '';
  return '<span style="color:'+(isRed(card)?'#b33':'#3a2f28')+'">'+card.suit+rankText(card.rank)+'</span>';
}
// 这张牌对该玩家能否充当 role('杀'/'闪')使用。默认本名相符;赵云【龙胆】允许 杀<->闪 双向转化
// (按名字);甄姬【倾国】允许任意黑色手牌当【闪】、关羽【武圣】允许任意红色手牌当【杀】
// (都是按颜色,不看名字);三条判断各自独立,互不覆盖。
function canUseAs(player, card, role){
  if(!card) return false;
  if(card.name===role) return true;
  if(generalHasCap(player,'longdan')){
    if(role==='杀' && card.name==='闪') return true;
    if(role==='闪' && card.name==='杀') return true;
  }
  if(role==='闪' && hasCap(player,'qingguo') && !isRedForPlayer(player, card)) return true;
  if(role==='杀' && hasCap(player,'wusheng') && isRedForPlayer(player, card)) return true;
  return false;
}
// 在手牌里找一张能当 role 用的牌:优先本名牌,没有才用可转化的牌。返回索引,无则 -1。
function findUsableAs(hand, player, role){
  let i = (hand||[]).findIndex(c=>c && c.name===role);
  if(i<0) i = (hand||[]).findIndex(c=>canUseAs(player,c,role));
  return i;
}
// 触发型技能分发:查 seat 玩家武将的 hooks[hookName] 并执行(在调用方的 tx 内,直接改 g)。
function triggerHook(g, seat, hookName, ctx){
  const p = g.players[seat];
  const gen = p && getGeneral(p.general);
  const fn = gen && gen.hooks && gen.hooks[hookName];
  if(typeof fn === 'function') fn(g, seat, ctx);
}
function randomGeneralId(){ return GENERAL_IDS[Math.floor(Math.random()*GENERAL_IDS.length)]; }
// 取武将体力上限,任何异常(null/旧数据)都回退到 MAX_HP,绝不抛错
function generalMaxHp(id){ const gen=getGeneral(id); return (gen && typeof gen.maxHp==='number') ? gen.maxHp : MAX_HP; }

// 基础牌/锦囊的一句话效果说明(给新手看,通俗;装备说明在 EQUIPS.desc)。唯一查询入口 getCardDesc,业务层不硬编码牌名。
const CARD_DESC = {
  '杀':       '出牌阶段使用,对攻击距离内的一名其他角色造成1点伤害;对方可打出【闪】抵消。每回合一般只能使用1张,且受攻击距离限制。',
  '闪':       '当你被【杀】指定为目标时打出,用来抵消这张【杀】、免受伤害。不能主动使用。',
  '桃':       '让自己回复1点体力,只能在自己体力没满时使用。',
  '决斗':     '指定一名其他角色决斗:双方轮流打出【杀】,先打不出【杀】的一方受到1点伤害。',
  '无中生有': '直接从牌堆摸两张牌。',
  '桃园结义': '所有存活角色各回复1点体力(已满血则不受影响),可被无懈可击整体抵消。',
  '顺手牵羊': '拿取一名其他角色的一张牌归为己有(可拿手牌或一件装备),每次只能拿一张。',
  '过河拆桥': '弃掉一名其他角色的一张牌(手牌或一件装备),每次只能弃一张。',
  '无懈可击': '抵消一张功能牌(“锦囊”,如决斗、南蛮入侵等)对一名角色的效果;也能抵消别人的【无懈可击】。',
  '南蛮入侵': '你以外的所有角色各需打出一张【杀】,打不出的人受到1点伤害。',
  '万箭齐发': '你以外的所有角色各需打出一张【闪】,打不出的人受到1点伤害。',
  '闪电': '延时锦囊,只能放在你自己的判定区。轮到你回合开始时判定:黑桃2~9,你受到3点伤害,然后此牌作废;否则无事发生,将此牌移到下一名角色的判定区。',
  '乐不思蜀': '延时锦囊,只能放在其他角色的判定区。轮到该角色回合开始时判定:若判定牌不为♥(红桃),跳过本回合的出牌阶段;为♥则无效果。判定完此牌作废。',
  '兵粮寸断': '延时锦囊,只能放在其他角色的判定区。轮到该角色回合开始时判定:若判定牌不为♣(梅花),跳过本回合的摸牌阶段;为♣则无效果。判定完此牌作废。',
  '铁索连环': '指定一至两名角色,分别令其进入或解除连环状态。连环状态用于日后的属性伤害传导;也可以被庞统【连环】重铸。',
  '借刀杀人': '选择一名装备着武器牌的角色(A),再选择A攻击范围内的另一名角色(B)。A可以选择对B使用一张【杀】(不受A本回合出杀次数限制),否则弃置A装备的武器牌。可被无懈可击整体抵消。',
  '五谷丰登': '亮出等同于存活角色数量的牌堆顶的牌,从你开始按座位顺序,每人依次挑选一张收入手中。可被无懈可击整体抵消(亮出的牌全部作废)。',
};
function getCardDesc(name){ return CARD_DESC[name] || ''; } // 基础牌/锦囊说明
// 任意牌的说明统一入口:装备牌走 EQUIPS.desc,基础牌/锦囊走 CARD_DESC。任何位置(手牌/装备区/帮助面板)都用它。
function getAnyDesc(name){ const e=getEquip(name); return (e && e.desc) || getCardDesc(name) || ''; }

const SUITS = ['♠','♥','♦','♣']; // 黑/红/红/♣黑;轮询分配保证红黑严格均衡(判定公平)
function buildDeck(){
  // 牌堆:标准版(104基础+4EX)官方花色点数 + 项目额外实现的军争/非官方牌。
  // 省略未实现的【雌雄双股剑】(♠2,需性别系统)。共111张。
  // 点数:A=1,J=11,Q=12,K=13。同花色点数可在不同牌名重复,靠 id 区分。
  const S='♠', H='♥', C='♣', D='♦';
  const LIST = [
    // 基本牌 53
    ['杀',S,7],['杀',S,8],['杀',S,8],['杀',S,9],['杀',S,9],['杀',S,10],['杀',S,10],
    ['杀',H,10],['杀',H,10],['杀',H,11],
    ['杀',C,2],['杀',C,3],['杀',C,4],['杀',C,5],['杀',C,6],['杀',C,7],['杀',C,8],['杀',C,8],['杀',C,9],['杀',C,9],['杀',C,10],['杀',C,10],['杀',C,11],['杀',C,11],
    ['杀',D,6],['杀',D,7],['杀',D,8],['杀',D,9],['杀',D,10],['杀',D,13],
    ['闪',H,2],['闪',H,2],['闪',H,13],
    ['闪',D,2],['闪',D,2],['闪',D,3],['闪',D,4],['闪',D,5],['闪',D,6],['闪',D,8],['闪',D,9],['闪',D,10],['闪',D,10],['闪',D,11],['闪',D,11],
    ['桃',H,3],['桃',H,4],['桃',H,7],['桃',H,8],['桃',H,9],['桃',H,12],
    ['桃',D,2],['桃',D,12],
    // 标准版锦囊 36
    ['决斗',S,1],['决斗',C,1],['决斗',D,1],
    ['无中生有',H,7],['无中生有',H,8],['无中生有',H,9],['无中生有',H,11],
    ['顺手牵羊',S,3],['顺手牵羊',S,4],['顺手牵羊',S,11],['顺手牵羊',D,3],['顺手牵羊',D,4],
    ['过河拆桥',S,3],['过河拆桥',S,4],['过河拆桥',S,12],['过河拆桥',C,3],['过河拆桥',C,4],['过河拆桥',H,12],
    ['无懈可击',S,11],['无懈可击',C,12],['无懈可击',C,13],['无懈可击',D,12],
    ['借刀杀人',C,12],['借刀杀人',C,13],
    ['南蛮入侵',S,7],['南蛮入侵',S,13],['南蛮入侵',C,7],
    ['万箭齐发',H,1],
    ['桃园结义',H,1],
    ['五谷丰登',H,3],['五谷丰登',H,4],
    ['乐不思蜀',S,6],['乐不思蜀',H,6],['乐不思蜀',C,6],
    ['闪电',S,1],['闪电',H,12],
    ['铁索连环',C,10],['铁索连环',C,11],
    // 标准版装备 18(官方19,省略雌雄双股剑)
    ['诸葛连弩',C,1],['诸葛连弩',D,1],
    ['青釭剑',S,6],['青龙偃月刀',S,5],['丈八蛇矛',S,12],
    ['贯石斧',D,5],['方天画戟',D,12],['麒麟弓',H,5],['寒冰剑',S,2],
    ['八卦阵',S,2],['八卦阵',C,2],['仁王盾',C,2],
    ['绝影',S,5],['爪黄飞电',H,13],['的卢',C,5],
    ['大宛',S,13],['赤兔',H,5],['紫骍',D,13],
    // 项目额外实现的军争/非官方牌 4(按官方军争花色点数;骕骦无官方值暂定♣K)
    ['兵粮寸断',S,10],['兵粮寸断',C,4],
    ['古锭刀',S,1],
    ['骕骦',C,13],
  ];
  const d = LIST.map((c,i)=>({id:i, name:c[0], suit:c[1], rank:c[2]}));
  for(let i=d.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [d[i],d[j]]=[d[j],d[i]]; }
  return d;
}
