// ---------- game constants ----------
const SEATS = 3;        // 房间容量上限(满 3 不再加入)
const MIN_PLAYERS = 2;  // 开始游戏的最低人数(2 或 3 人均可开始)
const MAX_HP = 4; // 大厅占位 / 兜底默认体力上限
const START_HAND = 4;

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
  '青釭剑':   { slot:'weapon', range:2, cap:'ignoreArmor', desc:'武器,射程2。你使用【杀】时无视对方的防具(例如对方的【八卦阵】无法发动)。' },
  '麒麟弓':   { slot:'weapon', range:5, cap:'qilin', desc:'武器,射程5。你的【杀】对目标造成伤害时,可以弃掉对方装备的一匹坐骑。' },
  '的卢':     { slot:'plus1', dist:+1, desc:'坐骑(防御马)。其他角色计算与你的距离时+1,让你更难被【杀】攻击到。' },
  '绝影':     { slot:'plus1', dist:+1, desc:'坐骑(防御马)。其他角色计算与你的距离时+1,让你更难被【杀】攻击到。' },
  '爪黄飞电': { slot:'plus1', dist:+1, desc:'坐骑(防御马)。其他角色计算与你的距离时+1,让你更难被【杀】攻击到。' },
  '大宛':     { slot:'plus1', dist:+1, desc:'坐骑(防御马)。其他角色计算与你的距离时+1,让你更难被【杀】攻击到。' },
  '赤兔':     { slot:'minus1', dist:-1, desc:'坐骑(进攻马)。你计算与其他角色的距离时-1,让你更容易攻击到别人。' },
  '紫骍':     { slot:'minus1', dist:-1, desc:'坐骑(进攻马)。你计算与其他角色的距离时-1,让你更容易攻击到别人。' },
  '骕骦':     { slot:'minus1', dist:-1, desc:'坐骑(进攻马)。你计算与其他角色的距离时-1,让你更容易攻击到别人。' },
};
function getEquip(name){ return EQUIPS[name] || null; } // 唯一查询入口

// ---------- 武将定义表(数据结构 + 技能均已实现) ----------
// 技能有两种表达:被动能力挂 caps(经 generalHasCap/generalCapValue 查),触发型挂 hooks(经 triggerHook 分发);统一经 getGeneral(id) 取用。
const GENERALS = {
  zhangfei:      { id:'zhangfei',      name:'张飞',   maxHp:4, skill:'咆哮', desc:'出牌阶段,你可以使用任意数量的【杀】。', caps:{ unlimitedSha:true } },
  guojia:        { id:'guojia',        name:'郭嘉',   maxHp:3, skill:'天妒', desc:'当你受到伤害后,你摸一张牌(受到几点伤害就摸几张)。',
    hooks:{
      // 受伤后摸等量牌。ctx={amount, sourceSeat};直接在当前 tx 的 g 上操作,不开新事务。
      onDamaged(g, seat, ctx){
        drawN(g, seat, ctx.amount);
        g.log = pushLog(g.log, g.players[seat].name+' 【天妒】发动,摸'+ctx.amount+'张牌');
      }
    } },
  sunshangxiang: { id:'sunshangxiang', name:'孙尚香', maxHp:4, skill:'枭姬', desc:'当你失去装备区里的一张装备牌时,你摸两张牌。', hooks:{ onLoseEquip:(g, seat, ctx)=>{ const n = 2 * (ctx && ctx.count || 1); drawN(g, seat, n); g.log=pushLog(g.log, g.players[seat].name+' 发动【枭姬】,摸'+n+'张牌'); } } },
  zhaoyun:       { id:'zhaoyun',       name:'赵云',   maxHp:4, skill:'龙胆', desc:'你可以将【杀】当【闪】、【闪】当【杀】使用(1:1 转化)。', caps:{ longdan:true } },
  lvmeng:        { id:'lvmeng',        name:'吕蒙',   maxHp:4, skill:'克己', desc:'若你于出牌阶段未使用或打出过【杀】,你可以跳过弃牌阶段(手牌超过体力上限也不必弃牌)。', caps:{ keji:true } },
  simayi:        { id:'simayi',        name:'司马懿', maxHp:3, skill:'反馈', desc:'当你受到伤害后,你获得伤害来源的一张手牌(随机)。',
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
      }
    } },
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
function isRed(card){ return !!(card && (card.suit==='♥'||card.suit==='♦')); }
function cardColor(card){ return isRed(card)?'red':'black'; }
// 点数显示:1→A、11~13→J/Q/K,其余原数字;缺失回退空串
function rankText(rank){ return {1:'A',11:'J',12:'Q',13:'K'}[rank] || (rank?String(rank):''); }
// 牌面花色+点数的带色 HTML(红 #b33 / 黑 #3a2f28);缺 suit/rank 安全回退空串(兼容旧牌)
function cardFace(card){
  if(!card || !card.suit) return '';
  return '<span style="color:'+(isRed(card)?'#b33':'#3a2f28')+'">'+card.suit+rankText(card.rank)+'</span>';
}
// 这张牌对该玩家能否充当 role('杀'/'闪')使用。默认本名相符;赵云【龙胆】允许 杀<->闪 双向转化。
function canUseAs(player, card, role){
  if(!card) return false;
  if(card.name===role) return true;
  if(generalHasCap(player,'longdan')){
    if(role==='杀' && card.name==='闪') return true;
    if(role==='闪' && card.name==='杀') return true;
  }
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
  '顺手牵羊': '拿取一名其他角色的一张牌归为己有(可拿手牌或一件装备),每次只能拿一张。',
  '过河拆桥': '弃掉一名其他角色的一张牌(手牌或一件装备),每次只能弃一张。',
  '无懈可击': '抵消一张功能牌(“锦囊”,如决斗、南蛮入侵等)对一名角色的效果;也能抵消别人的【无懈可击】。',
  '南蛮入侵': '你以外的所有角色各需打出一张【杀】,打不出的人受到1点伤害。',
  '万箭齐发': '你以外的所有角色各需打出一张【闪】,打不出的人受到1点伤害。',
};
function getCardDesc(name){ return CARD_DESC[name] || ''; } // 基础牌/锦囊说明
// 任意牌的说明统一入口:装备牌走 EQUIPS.desc,基础牌/锦囊走 CARD_DESC。任何位置(手牌/装备区/帮助面板)都用它。
function getAnyDesc(name){ const e=getEquip(name); return (e && e.desc) || getCardDesc(name) || ''; }

const SUITS = ['♠','♥','♦','♣']; // 黑/红/红/♣黑;轮询分配保证红黑严格均衡(判定公平)
function buildDeck(){
  const d = [];
  let id = 0;
  // 确定性轮询分配花色/点数:suit=SUITS[id%4](每4张2红2黑),rank=id%13+1;gcd(4,13)=1 → 组合不重样、同名牌花色也铺开
  const add = (name, n) => { for(let i=0;i<n;i++){ d.push({id, name, suit:SUITS[id%4], rank:(id%13)+1}); id++; } };
  // 基础牌(大头,梯度 杀>闪>桃):40 张
  add('杀', 18); add('闪', 14); add('桃', 8);
  // 锦囊(适中,稳定出现不刷屏):29 张
  add('决斗', 4); add('无中生有', 5); add('顺手牵羊', 4); add('过河拆桥', 5); add('无懈可击', 5);
  add('南蛮入侵', 3); add('万箭齐发', 3);
  // 装备牌(系统性配比;装备是最小类=点缀):武器 8(4 把各 2,让特效武器更常登场)+ 防具 3(仅八卦阵一种,多给让判定机制常见)
  add('诸葛连弩', 2); add('丈八蛇矛', 2); add('青釭剑', 2); add('麒麟弓', 2); add('八卦阵', 3);
  // 坐骑:+1马 / -1马 各多几匹(同的卢/赤兔机制,无新逻辑),每匹 1 张,整体不至过多
  add('的卢', 1); add('绝影', 1); add('爪黄飞电', 1); add('大宛', 1);   // +1马 共 4 匹
  add('赤兔', 1); add('紫骍', 1); add('骕骦', 1);                        // -1马 共 3 匹
  // shuffle
  for(let i=d.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [d[i],d[j]]=[d[j],d[i]]; }
  return d;
}
