// ---------- 座位卡片头像 ----------
// generalAvatarSrc: 按 id 拼路径的约定式查询(不在 GENERALS 表里存 img 字段)——和 getGeneral(id)
// 是唯一查询入口同一个道理,业务层永远调这个函数,不硬编码路径。"以后换图"只需要覆盖
// assets/generals/{id}.jpg(或同 id 的其它格式,见 avatarError),不用碰这里的代码。
function generalAvatarSrc(id){ return 'assets/generals/'+id+'.jpg'; }
// avatarError: <img onerror> 挂载。依次尝试 jpg(默认) → jpeg → png → webp → gif → svg,
// 这是为了"以后素材可能换成同 id 的其它常见格式"这个场景不用改代码,只要文件名前缀(id)不变。
// 全部格式都试完仍失败(比如日后新增武将暂时没配图)才真正隐藏 <img>、显示占位块——
// 不能只隐藏不管,浏览器会在原地画一个"图裂了"的破图标,必须真正 display:none 才行。
// 【曾经的闪烁 bug】默认格式曾经是 svg,但项目里实际所有武将素材都是 .jpg,没有任何 .svg
// 文件——导致每次渲染头像都必然先经历一次注定失败的 .svg 请求(等404)、fallback 到当时
// 排在前面的 .png(同样不存在,再失败一次),才轮到 .jpg 成功显示,这个"连续多次失败再成功"
// 的加载过程在每次页面重绘时都会重演一遍,就是头像闪烁的根源。现在默认直接用 jpg(和实际
// 素材一致,一次请求即可成功),svg 挪到 fallback 链末尾(不再作为默认首选,仅保留兼容,
// 万一以后真的换成 svg 素材)。
const AVATAR_FALLBACK_EXTS = ['jpeg','png','webp','gif','svg']; // 默认从 .jpg 开始(和当前实际素材一致,一次请求即可成功,不再有先失败几次的闪烁),失败后依次重试其它格式
function avatarError(imgEl){
  const tried = imgEl.dataset.avatarTry ? parseInt(imgEl.dataset.avatarTry, 10) : 0;
  if(tried >= AVATAR_FALLBACK_EXTS.length){
    imgEl.style.display='none';
    const ph = imgEl.parentElement && imgEl.parentElement.querySelector('.avatar-placeholder');
    if(ph) ph.style.display='flex';
    return;
  }
  const nextExt = AVATAR_FALLBACK_EXTS[tried];
  imgEl.dataset.avatarTry = String(tried+1);
  imgEl.src = imgEl.src.replace(/\.[a-zA-Z0-9]+(\?.*)?$/, '.'+nextExt);
}

// ---------- 手牌卡面图(基本牌/普通锦囊/延时锦囊/装备牌,不含武将头像) ----------
// CARD_PINYIN: 牌名(与 data.js 的 CARD_DESC/EQUIPS 的 key 完全对应)→拼音文件名前缀的
// 约定式映射表,和 generalAvatarSrc 同一个道理——业务层永远查这张表,不硬编码路径。
// 图片是通用美术图(按牌名配一张,不按具体花色点数),所以每张牌实例真实的花色点数信息
// 靠 .corner 角标叠加显示,不受这张表影响。新增牌时在这里补一条映射即可。
const CARD_PINYIN = {
  '杀':'sha', '闪':'shan', '桃':'tao',
  '决斗':'juedou', '无中生有':'wuzhongshengyou', '顺手牵羊':'shunshouqianyang',
  '过河拆桥':'guohechaiqiao', '无懈可击':'wuxiekeji', '南蛮入侵':'nanmanruqin',
  '万箭齐发':'wanjianqifa', '闪电':'shandian', '乐不思蜀':'lebusishu',
  '兵粮寸断':'bingliangcunduan', '借刀杀人':'jiedaosharen', '五谷丰登':'wugufengdeng',
  '桃园结义':'taoyuanjieyi',
  '诸葛连弩':'zhugeliannu', '青釭剑':'qinggangjian', '青龙偃月刀':'qinglongyanyuedao',
  '丈八蛇矛':'zhangbashemao', '贯石斧':'guanshifu', '方天画戟':'fangtianhuaji',
  '麒麟弓':'qilingong', '寒冰剑':'hanbingjian', '古锭刀':'gudingdao',
  '八卦阵':'baguazhen', '仁王盾':'renwangdun',
  '的卢':'dilu', '绝影':'jueying', '爪黄飞电':'zhuahuangfeidian',
  '赤兔':'chitu', '紫骍':'zixing', '大宛':'dawan', '骕骦':'sushuang'
};
const SKILL_PINYIN = {
  '天妒':'tiandu', '遗计':'yiji', '枭姬':'xiaoji', '反馈':'fankui',
  '鬼才':'guicai', '龙胆':'longdan', '武圣':'wusheng'
};
// cardImageSrc: 映射表里没有这张牌名(比如以后加新牌但没先配这里)时返回 null,调用方按
// null 处理成"没有插画图片可用"——牌名文字始终固定显示在 .card-title 标题栏,不受这个
// 判断影响,和早期"图片铺满全卡、靠no-art控制牌名文字显示/隐藏"那版不同(见 CLAUDE.md)。
function cardImageSrc(name){
  const py = CARD_PINYIN[name];
  return py ? ('assets/cards/'+py+'.jpg') : null;
}
// CARD_FALLBACK_EXTS: 和 AVATAR_FALLBACK_EXTS 同款设计——默认 jpg 优先(cardImageSrc 已经
// 直接返回 .jpg),这里只需要列出"jpg失败之后"还要依次重试的格式,不需要再包含jpg本身。
const CARD_FALLBACK_EXTS = ['jpeg','png','webp','gif'];
// cardImgError: <img onerror> 挂载。全部格式都试完仍失败(比如这张牌暂时还没准备图片素材)
// 才真正隐藏 <img>、给 .card 加上 no-art 标记——让 CSS 给插画区域(.card-art-box)显示一块
// 占位底色,不留完全空白/破图标。牌名文字(.card-title)不受这个标记影响,本来就始终显示。
function cardImgError(imgEl){
  const tried = imgEl.dataset.cardTry ? parseInt(imgEl.dataset.cardTry, 10) : 0;
  if(tried >= CARD_FALLBACK_EXTS.length){
    imgEl.style.display='none';
    const cardEl = imgEl.closest('.card');
    if(cardEl) cardEl.classList.add('no-art');
    return;
  }
  const nextExt = CARD_FALLBACK_EXTS[tried];
  imgEl.dataset.cardTry = String(tried+1);
  imgEl.src = imgEl.src.replace(/\.[a-zA-Z0-9]+(\?.*)?$/, '.'+nextExt);
}

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
// 方天画戟:锁定技,手牌只剩最后一张且能当杀时才出现"追加目标"入口(仿张辽突袭同款
// "数量可变、不能靠选满自动触发、需要独立确认按钮"的交互)。因为触发条件已经限定"只有这一张
// 手牌",不需要像丈八/断粮那样先选牌——cardIdx 恒为 0,点入口直接进选目标模式。
let fangtianMode = false;
let fangtianPicks = [];          // 已选额外目标座位号,最多 3 个(含最少1个,不强制选满)
function resetFangtian(){ fangtianMode=false; fangtianPicks=[]; }
// 徐晃【断粮】:出牌阶段点"发动断粮"进选牌+选目标模式(纯客户端,不入库)。
// 先点一张黑色基本牌/黑色装备牌(官方规则,不是任意牌)选中,再点距离2以内的一名其他玩家
// 座位提交;和普通出牌选目标的交互很像,但不走 CARD_PLAYS/playCard(断粮是独立的技能动作,
// 选中的这张牌本身当【兵粮寸断】使用,不是弃置)。
let duanliangMode = false;
let duanliangCardIdx = null;    // 已选中要当兵粮寸断使用的手牌下标(单选)
function resetDuanliang(){ duanliangMode=false; duanliangCardIdx=null; }
// 乐进【骁果】:点"发动"进选牌模式(纯客户端,不入库),只有基本牌可点,点了直接提交(仿鬼才)。
let xiaoguoMode = false;
function resetXiaoguo(){ xiaoguoMode=false; }
// 青龙偃月刀:杀被闪抵消后,装备者(攻击者)点"发动"进选牌模式(纯客户端,不入库),能当杀的
// 牌都可点,点了直接提交(和骁果同一个"点发动进选牌模式,选牌即提交"的单步交互模式)。
let qinglongMode = false;
function resetQinglong(){ qinglongMode=false; }
// 贯石斧:杀被闪抵消后,装备者(攻击者)可选弃自己2张牌(手牌/装备混合)令这张杀依然造成伤害。
// 不需要"发动"这一步单独确认——直接列出自己所有可弃项(手牌+非武器槽装备)供toggle多选,
// 选够恰好2项才出现"确认发动",同屏始终有"不发动"按钮。guanshiPicks 存编码字符串
// ('hand:idx' / 'equip:slot'),纯客户端不入库。
let guanshiPicks = [];
function resetGuanshi(){ guanshiPicks=[]; }
// 郭嘉【遗计】分配阶段:yijiPicks 依次记录"第i张牌分配给哪个座位号",纯客户端不入库。
// 每次点一个座位号就 push 进去(允许重复,如都给自己/都给同一人),攒够 cards.length 张就提交。
let yijiPicks = [];
function resetYiji(){ yijiPicks=[]; }
// guanshifuOptions: 攻击者自己当前可弃的项(手牌逐张 + 非空装备槽逐件,武器槽排除——那就是
// 贯石斧本身)。返回 {key,label} 列表,供 UI 渲染 toggle 按钮。
function guanshifuOptions(p){
  const list=[];
  (p.hand||[]).forEach((c,idx)=>{ list.push({key:'hand:'+idx, label:'手牌【'+c.name+'】'}); });
  EQUIP_SLOTS.forEach(slot=>{ if(slot!=='weapon' && p.equips && p.equips[slot]){
    list.push({key:'equip:'+slot, label:EQUIP_SLOT_LABEL[slot]+'【'+p.equips[slot].name+'】'});
  }});
  return list;
}
// 张郃【巧变】完整版:回合开始服务端问"是否发动"(g.phase==='qiaobianTurnStart'),点"发动"后
// 客户端进入纯本地状态机(不入库,不需要其他玩家响应)——① 'choosePhase':选一张手牌+选一个
// 阶段(判定/摸牌/出牌/弃牌),一次性提交 qiaobianDeclare(cardIdx, phaseChoice);
// ② 若选的是"出牌阶段",服务端会开新 pending qiaobianMove,客户端接着走 'source'/'target'
// 两步(和简化版的移动 UI 完全一样)选装备/判定牌来源和目的地,或直接"不移动",提交
// respondQiaobianMove(move)。
let qiaobianMode = false;        // false | 'choosePhase' | 'source' | 'target'
let qiaobianCardIdx = null;      // 已选中要弃置的手牌下标
let qiaobianPhaseChoice = null;  // 已选中的阶段:'judge'|'draw'|'play'|'discard'
let qiaobianSrc = null;          // 已选中的来源 {kind:'equip'|'delay', seat, slot|idx, name}
function resetQiaobian(){ qiaobianMode=false; qiaobianCardIdx=null; qiaobianPhaseChoice=null; qiaobianSrc=null; }
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
// 这里会漏弹一次——这个概率很低的边界情况不值得为它引入递增序号之类的额外机制
// (那需要改 pushLog 签名和所有调用点)。
// 【排队展示,不再只弹最后一条】曾经这里"多条连续新日志只弹最后一条",导致延时锦囊判定
// (乐不思蜀/兵粮寸断的"判定为XX,生效/无效"这条中间结果)被同一次事务里紧跟着的下一条日志
// 淹没、玩家完全看不到判定过程发生了什么——已改成把本次新增的全部日志交给 queueLogToasts
// 排队依次展示(见该函数),上限5条防止无懈连锁反应这类极端场景排队太久。
let lastToastedLogText = undefined;
// colorizeLogLine: 只在 toast 这一处渲染路径把日志行里出现的玩家名字染上座位色(呼应座位卡片
// 的 seatColor),不碰 g.log 本身的存储(依然是纯字符串,日志面板 renderLogModal 不受影响)。
// 先转义整行,再用转义后的名字做字面 split/join 替换(不用正则,不用处理名字里的正则特殊字符);
// 按名字长度从长到短替换,防止"某玩家名字是另一玩家名字子串"时被短名字提前抢先替换掉。
// 名字长度<2的不参与染色:三国杀满屏都是单字游戏术语(杀/闪/桃/牌/堆/弃...),1个字的玩家名
// 几乎必然和这些词撞在一起,误染色概率很高;2字以上撞上无关词组纯属巧合,概率低很多,
// 这里只接受"低概率的巧合误染色"这一种代价,不为它再引入正则/语境匹配的复杂度。
// colorizeLogLine: 在原始纯文本上一次性算好所有"该染色的区间"（长名字优先占坑、已占用的
// 区间后续短名字不能再匹配),再统一拼出最终HTML,不对已生成的HTML做二次查找替换——旧实现
// 靠反复对同一段文本做"整串split/join"来判断该给谁上色,当一个玩家名字是另一个玩家名字的
// 子字符串时(如"AA"和"BAA"),长名字"BAA"先被包进彩色span,但"AA"这几个字符依然字面存在
// 于生成出的HTML字符串内部,轮到处理"AA"时又在已生成的HTML里重新匹配到、再包一层嵌套span,
// 内层颜色覆盖外层,导致同一个名字在一句话里被拆成两种颜色。这次改成先在纯文本坐标系里
// 用 claimed 数组标记哪些字符位置已经被占用,长名字优先占坑,从根本上避免嵌套/重叠染色。
function colorizeLogLine(g, text){
  const entries = (g.players||[]).map((p,i)=>({i,p}))
    .filter(o=>o.p && o.p.name && o.p.name.length>=2)
    .sort((a,b)=>b.p.name.length-a.p.name.length); // 长名字优先占坑,避免被短名字的子串匹配抢先

  const claimed = new Array(text.length).fill(false);
  const matches = []; // {start,end,color}
  entries.forEach(({i,p})=>{
    const name = p.name;
    let searchFrom = 0;
    while(true){
      const idx = text.indexOf(name, searchFrom);
      if(idx<0) break;
      const end = idx+name.length;
      let overlap = false;
      for(let k=idx;k<end;k++){ if(claimed[k]){ overlap=true; break; } }
      if(!overlap){
        for(let k=idx;k<end;k++) claimed[k]=true;
        matches.push({start:idx, end, color:seatColor(i)});
      }
      searchFrom = idx+1; // 继续找同一个名字在这条日志里的其它出现位置(比如同时提到来源和目标)
    }
  });
  matches.sort((a,b)=>a.start-b.start);

  let result = '';
  let cursor = 0;
  matches.forEach(m=>{
    result += escapeHtml(text.slice(cursor, m.start));
    result += '<span style="color:'+m.color+'">'+escapeHtml(text.slice(m.start, m.end))+'</span>';
    cursor = m.end;
  });
  result += escapeHtml(text.slice(cursor));
  return result;
}
function showLogToast(g, text){
  const el = document.getElementById('logToast');
  el.innerHTML = colorizeLogLine(g, text);
  // 重新触发 CSS 动画:先摘掉 .show(可能还在播放上一条的动画),强制回流,再加回去。
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

// ===== "轮到你了"提示:语音 + 大字视觉双重触发,同一个去重 key(见 render() 里的调用点) =====
// lastAnnouncedTurnKey:哨兵初始值 null(不是 undefined——这里不需要"第一次render不提示历史"
// 这套逻辑,一开始就没有任何"已提示过的轮次",null 天然和任何真实 turnKey 字符串都不相等)。
let lastAnnouncedTurnKey = null;
// announceMyTurn:用浏览器内置 SpeechSynthesis 播报"轮到你了"。浏览器的自动播放策略可能在
// 玩家还没和页面发生过任何交互时静默拒绝播放(不抛错、就是没声音)——showMyTurnBanner 是
// 专门给这种情况准备的视觉兜底,两者同时触发,不互相依赖对方是否成功。
function announceMyTurn(){
  try{
    if(!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance('轮到你了');
    u.lang = 'zh-CN';
    window.speechSynthesis.cancel(); // 避免多次快速触发时语音排队堆积
    window.speechSynthesis.speak(u);
  }catch(e){ /* 语音播放失败静默忽略,反正有大字视觉兜底 */ }
}
// showMyTurnBanner: 居中大字短暂覆层,和 showLogToast 同一套"class 加/减触发CSS动画"写法,
// 但视觉上更醒目(更大字号、居中、短暂遮罩),专用于"轮到我了"这一个场景,不复用常驻的
// .banner(那是被决斗/技能询问等很多场景复用的"当前该谁做什么"提示条,改大会影响那些场景)。
function showMyTurnBanner(){
  const el = document.getElementById('myTurnBanner');
  if(!el) return;
  el.textContent = '轮到你了';
  el.classList.remove('show');
  void el.offsetWidth; // 强制回流,保证连续触发时动画能重新播放(和 showLogToast 的写法一致)
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(()=>{ el.classList.remove('show'); }, 1800);
}

// ===== 音频引擎解锁(手机浏览器,尤其 iOS Safari,自动播放策略要求) =====
// 移动端浏览器(尤其 iOS Safari)的自动播放策略:音频播放必须紧跟一次真实的用户手势
// (点击/触摸)才会被允许,由 Firebase 异步事件(别人操作后同步过来的状态变化)触发的
// render()→play() 完全不在用户手势的调用栈里,会被静默拒绝(Promise reject,不抛同步异常)。
// 这解释了真实反馈的现象:自己主动点击出牌/出闪之类的操作,点击本身就是用户手势,播放能
// 通过;别人操作后异步推送过来触发的语音,没有这层手势,在手机上被拦截——桌面浏览器的自动
// 播放策略普遍宽松得多,两端表现不一致。
// 标准解法:页面第一次收到任意点击/触摸时,主动播放一次(不需要真的发出声音,play()后立刻
// pause()即可)来"解锁"这个页面生命周期内浏览器的音频引擎,之后同一页面里由异步事件触发的
// 播放就不再被当成"和用户手势无关"而拦截。只需全局解锁一次,不需要每次播放前都重新解锁。
let audioUnlocked = false;
function unlockAudioOnce(){
  if(audioUnlocked) return;
  audioUnlocked = true;
  try{
    const silent = new Audio();
    silent.src = 'data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA';
    const p = silent.play();
    if(p && p.catch) p.catch(()=>{}); // 解锁本身失败也不影响后续逻辑,只是"多一次机会没抓住"
    silent.pause();
  }catch(e){}
}
// 监听器要在页面加载后尽早注册(不等进入房间),玩家第一次点"加入房间"或任何按钮时就顺带解锁,
// 不需要额外引导玩家做什么特殊操作。{once:true} 保证只解锁一次,不重复播放这个静音音频。
document.addEventListener('touchstart', unlockAudioOnce, {once:true, passive:true});
document.addEventListener('click', unlockAudioOnce, {once:true, passive:true});

// 常驻"关闭房间"按钮(cleanupRoom):只需要绑定一次,不放进render(g)里——这是一个固定
// 挂在页面角落、不随游戏状态变化的元素,和 #helpBtn/#logBtn 同一类"页面初始化时绑一次"
// 的静态入口,不需要每次重绘都重新赋值 onclick(重复赋值同一个函数本身无害,但没必要)。
document.getElementById('closeRoomBtn').onclick = cleanupRoom;

// ===== 打出手牌语音:所有在场玩家(不只是出牌的人自己)都应该听到,靠共享状态
// g.lastCardSound(game.js 的 markCardSound 在每个"真正打出/使用一张牌"的关键节点写入)
// 同步触发,和 lastAnnouncedTurnKey 同一套去重模式(哨兵值+序号比较,不是比较牌名文本——
// 连续两次打出同一张牌名,如果只比较文本会被误判成同一个事件而漏播,详见 markCardSound
// 的 seq 自增设计)。 =====
let lastPlayedCardSeq = undefined;
function maybePlayCardSound(g){
  if(!g.lastCardSound) return;
  if(lastPlayedCardSeq===undefined){ lastPlayedCardSeq=g.lastCardSound.seq; return; } // 首次进入房间/刷新页面,不补放历史
  if(g.lastCardSound.seq===lastPlayedCardSeq) return;
  lastPlayedCardSeq = g.lastCardSound.seq;
  const py = CARD_PINYIN[g.lastCardSound.name];
  if(!py) return; // 没有对应语音文件的牌,静默跳过,不报错
  try{
    const audio = new Audio('assets/audio/'+py+'.mp3');
    // 播放失败原因打进console.warn(不是静默吞掉),方便真机排查——重点看err.name是不是
    // 'NotAllowedError'(浏览器自动播放策略拦截,标准解法见上面的unlockAudioOnce)还是别的
    // 原因(如404文件不存在)。这不影响游戏运行,失败与否都不会抛出未捕获异常。
    audio.play().catch(err=>console.warn('卡牌语音播放失败:', py, err && err.name, err));
  }catch(e){}
}
// maybePlaySkillSound: 和 maybePlayCardSound 同一模式,独立字段(lastSkillSound)+独立哨兵变量。
let lastPlayedSkillSeq = undefined;
function maybePlaySkillSound(g){
  if(!g.lastSkillSound) return;
  if(lastPlayedSkillSeq===undefined){ lastPlayedSkillSeq=g.lastSkillSound.seq; return; }
  if(g.lastSkillSound.seq===lastPlayedSkillSeq) return;
  lastPlayedSkillSeq = g.lastSkillSound.seq;
  const py = SKILL_PINYIN[g.lastSkillSound.name];
  if(!py) return;
  try{
    const audio = new Audio('assets/audio/'+py+'.mp3');
    audio.play().catch(err=>console.warn('技能语音播放失败:', py, err && err.name, err));
  }catch(e){}
}

// isToastworthyLog: 判断一条日志文本是否值得弹 toast 提醒——覆盖出牌动作("使用【"/"打出【"/
// "当【")、延时锦囊判定结果("生效"/"无效",如"【乐不思蜀】生效"/"【兵粮寸断】无效"、闪电
// 判定命中的"【闪电】发动")、伤害结算("受到",dealDamage 统一走"受到N点伤害"这个固定文案,
// 覆盖所有伤害来源)、以及部分技能发动提示("发动")。不是每条新增日志都弹——摸牌/回合切换
// 这类高频但信息量低的日志不触发,避免刷屏。
function isToastworthyLog(text){
  return text.includes('使用【')
    || text.includes('打出【')
    || text.includes('当【')
    || text.includes('生效')      // 延时锦囊判定成功(如"【乐不思蜀】生效"、"【兵粮寸断】生效"、"【闪电】发动")
    || text.includes('无效')      // 延时锦囊判定失败/未生效(如"【乐不思蜀】无效")
    || text.includes('受到')      // 受到伤害(掉血)
    || text.includes('发动');     // 闪电等判定生效的措辞变体,以及部分技能发动提示
}

// queueLogToasts: 把一次事务里新增的多条日志排队依次展示(每条showLogToast后等一段时间
// 再切下一条),而不是只弹最后一条——解决延时锦囊判定这类"中间结果"被淹没看不到的问题。
// 上限 5 条:无懈连锁反应这种极端场景可能一次性新增十几条日志,全部排队展示会等很久、
// 影响体验,这里只展示"最近的几条"(丢弃更早的),不追求条条必达——toast 本来就是
// "尽量提醒瞥一眼"的定位,完整过程始终能在 #logBtn 的日志面板里查看。
const LOG_TOAST_QUEUE_CAP = 5;
let toastQueue = [];
let toastQueueRunning = false;
function queueLogToasts(g, lines){
  // 先按 isToastworthyLog 过滤掉不值得弹的日志(摸牌/回合切换等),上限只针对过滤后剩下的
  // 这些"真正会弹"的日志计数,不该把无关日志也算进这5条名额里。
  const worthy = lines.filter(isToastworthyLog);
  const capped = worthy.length > LOG_TOAST_QUEUE_CAP ? worthy.slice(-LOG_TOAST_QUEUE_CAP) : worthy;
  toastQueue.push(...capped);
  if(toastQueueRunning) return;
  toastQueueRunning = true;
  const step=()=>{
    if(toastQueue.length===0){ toastQueueRunning=false; return; }
    const text = toastQueue.shift();
    showLogToast(g, text);
    // 间隔要略大于动画总时长(2.5s),否则下一条会在上一条淡入-停留-淡出还没播完时就提前打断它。
    setTimeout(step, 2600);
  };
  step();
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
  const cleanup=()=>{ selectedCardIdx=null; resetZhangba(); resetDuanliang(); resetQiaobian(); resetJiedao(); resetFangtian(); };
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
// fangtianSuffix: 方天画戟排队中的目标提示后缀(如"(方天画戟 目标2/3)"),没有排队则返回空串。
// 附加在响应阶段(respond/tieqi/liegong)的 banner 末尾,帮旁观者看懂"这是第几个目标"。
function fangtianSuffix(g){
  const q=g.fangtianQueue;
  return q ? '（方天画戟 目标'+(q.idx+1)+'/'+q.targets.length+'）' : '';
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
  // 轮到自己回合:语音+大字视觉双重提示,同一个触发时机、同一套去重判断——只在"刚刚轮到
  // 自己回合"这一刻提示一次,不会因为同一回合内的其它状态变化(如无关的日志/别人操作)
  // 而反复重复提示。
  // 【曾经的时机偏差】判断条件曾经是 g.phase==='play'&&g.turn===mySeat,导致提示要等
  // 玩家自己点了摸牌按钮、阶段从'draw'推进到'play'之后才触发,比"轮到你回合"这个真正的
  // 时间点晚了一步——现在改成只看"轮到谁"(g.turn===mySeat),不管当前是draw还是play哪个
  // 子阶段,回合刚开始(摸牌按钮出现的那一刻)就立刻提示。
  // turnKey 也不能再包含 g.phase:否则同一个回合从draw切到play,key会变化,又会被误判成
  // "新的一次轮到自己"而重复触发一次提示。key 用 (turn,roundNum) 组合:同一玩家在不同
  // 轮次会重新拿到同一个 turn 座位号,必须靠 roundNum 区分,不能只用 turn 本身。
  const turnKey = g.started ? (g.turn+':'+(g.roundNum||0)) : null;
  if(g.started && g.turn===mySeat && turnKey!==lastAnnouncedTurnKey){
    announceMyTurn();
    showMyTurnBanner();
    lastAnnouncedTurnKey = turnKey;
  } else if(g.turn!==mySeat){
    lastAnnouncedTurnKey = undefined;
  }
  maybePlayCardSound(g); // 打出手牌语音:和上面announceMyTurn同一批"每次状态更新都检测一次"的位置
  maybePlaySkillSound(g); // 技能发动语音:同一批检测
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
  // 同款兜底:一旦不在"轮到自己(攻击者)响应青龙偃月刀"的状态,退出选牌模式,不留残留。
  if(!(g.phase==='qinglong' && g.pending && g.pending.type==='qinglong' && g.pending.from===mySeat)) resetQinglong();
  // 同款兜底:一旦不在"轮到自己(攻击者)响应贯石斧"的状态,清空已选的弃牌项,不留残留。
  if(!(g.phase==='guanshi' && g.pending && g.pending.type==='guanshi' && g.pending.from===mySeat)) resetGuanshi();
  // 同款兜底:一旦不在"轮到自己分配遗计牌"的状态,清空已选的分配项,不留残留。
  if(!(g.phase==='yijiAssign' && g.pending && g.pending.type==='yijiAssign' && g.pending.seat===mySeat)) resetYiji();
  // 同款兜底:只要不在"轮到自己的巧变回合开始询问"或"轮到自己的巧变移动询问"这两个状态,
  // 就退出巧变选牌/选阶段/选源/选目标模式——巧变完整版横跨两个不同的服务端阶段。
  if(!(g.phase==='qiaobianTurnStart' && g.pending && g.pending.type==='qiaobianTurnStart' && g.pending.seat===mySeat) &&
     !(g.phase==='qiaobianMove' && g.pending && g.pending.type==='qiaobianMove' && g.pending.seat===mySeat)) resetQiaobian();
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
    // 未正式开局时(g.started仍为false,含三选一选将阶段pickingGeneral):不能显示具体武将
    // 名字——但 gen(=getGeneral(p.general))在这个玩家选完之后就已经非空了(respondPickGeneral
    // 立即赋值,不等其他人选完),所以这里不能直接判断"gen是否非空"来决定显示什么,而是要按
    // "选没选"这个状态本身区分文案:还没选显示"武将未定",已经选定(但还没到大家都选完、正式
    // 开局那一刻)显示"武将已选择"——只暴露"选没选"这个状态,不暴露选的是谁,和"其他玩家选择
    // 进度"那部分的隐藏信息原则一致。这是每个座位各自独立判断,不只是自己这个座位。
    const genLabel = g.started ? (gen?gen.name:'—') : (gen ? '武将已选择' : '武将未定');
    // 头像:必须同时满足"真的选定了武将(gen 非空)"和"g.started"才显示真实头像——只查 gen
    // 不够:三选一选将阶段(pickingGeneral)里,玩家选定后 p.general 就已经被设成真实武将id
    // (respondPickGeneral 立即赋值,不等其他人选完),但正式开局(finishGeneralAssign)前
    // 这仍然是隐藏信息,不能提前把头像露出来暴露身份。这是一个真实修过的信息泄露 bug——
    // 早先这里只判断 gen,选将阶段一旦自己选完,这个座位的头像会立刻正确显示出来,而当时
    // 别的玩家可能还没选完、整局甚至还没正式开始。和下面 skillLine 用的 g.started&&gen
    // 这个条件必须保持一致,不能各写各的。占位块默认 style="display:none"(有 <img> 时靠
    // onerror 才会显示),没有 <img> 时直接不带这行内联样式,保持默认可见。
    const avatarReady = g.started && gen;
    const avatarImg = avatarReady
      ? '<img class="avatar" src="'+generalAvatarSrc(gen.id)+'" onerror="avatarError(this)" alt="">'
      : '';
    const avatarPlaceholder = '<div class="avatar-placeholder"'+(avatarReady?' style="display:none"':'')+'>'+escapeHtml(genLabel)+'</div>';
    // 装备区(公开信息,和武将一样人人可见)。逐行列表(图标/标签+牌名+射程)。**对手卡片
    // 只渲染有装备的槽位,空槽整行不显示**(和判定区"空的时候不留占位"同一原则),只有
    // .seat.me 保留完整4槽显示(含空槽),因为你会想知道自己缺什么装备——这条决策独立于
    // 头像位置,第6步定下、第7步(头像居左)延续不变。
    const eq = p.equips || emptyEquips();
    const slotLabels = { weapon:'武器', armor:'防具', plus1:'防御马', minus1:'进攻马' };
    const equipSlotsToShow = i===mySeat ? EQUIP_SLOTS : EQUIP_SLOTS.filter(s=>eq[s]);
    const equipList = g.started
      ? '<div class="equip-list">'+equipSlotsToShow.map(s=>{
          const c = eq[s];
          const rangeSuffix = (s==='weapon' && c && getEquip(c.name) && getEquip(c.name).range) ? ' 射'+getEquip(c.name).range : '';
          const eDesc = (c && getEquip(c.name) && getEquip(c.name).desc) || '';
          return '<div class="erow '+(c?'filled':'empty-slot')+'"'+(c?' title="'+escapeHtml(eDesc)+'"':'')+'>'+slotLabels[s]+' '+(c
            ? '<b>'+cardFace(c)+' '+escapeHtml(c.name)+rangeSuffix+'</b> <span class="info-badge" onclick="event.stopPropagation();showEquipInfo(\''+c.name+'\')">?</span>'
            : '<span class="empty">—</span>')+'</div>';
        }).join('')+'</div>'
      : '';
    // 判定区(延时锦囊):现在是 .info-col 里普通文档流的一行(技能名下方、装备列表上方),
    // 不再需要绝对定位浮在头像上——紫色描边小 chip 呼应手牌 .card.trick 的锦囊配色。
    const delayRow = (g.started && (p.delays||[]).length>0)
      ? '<div class="delays">'+p.delays.map(c=>{
          const dDesc = getCardDesc(c.name);
          return '<span class="dchip"'+(dDesc?' title="'+escapeHtml(dDesc)+'"':'')+'>'+(cardFace(c)||'')+' '+escapeHtml(c.name)+
            ' <span class="info-badge" onclick="event.stopPropagation();showDelayInfo(\''+c.name+'\')">?</span></span>';
        }).join('')+'</div>'
      : '';
    const nmLine =
      '<div class="nm"><span style="color:'+seatColor(i)+'">'+escapeHtml(p.name)+'</span>'+
        (i===mySeat?'<span class="tag">你</span>':'')+
        (g.turn===i&&g.started?'<span class="tag turn">回合</span>':'')+
        (p.dying?'<span class="tag" style="background:var(--cinnabar)">濒死</span>':'')+
      '</div>';
    // 武将名+技能名拼一行(如"关羽 · 武圣"),贴合旧版"武将 X · 技能"的习惯——去掉"武将"
    // 前缀文字,头像本身已经很直观表明"这是武将",不需要文字点破。title 只放技能说明,
    // 不重复塞武将名(武将名已经在正文里,title 没必要啰嗦重复)。
    const skillLine = (g.started&&gen)
      ? '<div class="skill-line" title="'+escapeHtml(gen.skill+'：'+(gen.desc||''))+'">'+escapeHtml(gen.name)+' · '+escapeHtml(gen.skill)+' <span class="info-badge" onclick="event.stopPropagation();showGeneralInfo(\''+gen.id+'\')">?</span></div>'
      : '';
    // 头像居左+信息居右(第7步,取代第6步的头像铺底):头像框是固定小方块(见 index.html
    // .avatar-box,宽高比锁死等于素材 3:4,不裁切),姓名/血量/技能/判定区/装备回到普通
    // 文档流,不再叠在图片上,不需要蒙层/绝对定位。
    d.innerHTML =
      '<div class="card-top">'+
        '<div class="avatar-box">'+avatarImg+avatarPlaceholder+'</div>'+
        '<div class="info-col">'+
          '<div class="top-row">'+nmLine+'<div class="hp">'+hearts+'</div></div>'+
          skillLine+
          delayRow+
          equipList+
        '</div>'+
      '</div>'+
      '<div class="seat-body">'+
        // 自己的座位卡显示当前攻击距离(= attackRange,无武器默认1),让玩家一眼知道能打多远
        (i===mySeat && g.started ? '<div class="meta">攻击距离 '+attackRange(g,mySeat)+'</div>' : '')+
        '<div class="meta">手牌 '+(p.hand||[]).length+' 张</div>'+
        (i===mySeat?'':handBacks)+
      '</div>';
    // targeting: clickable opponents when choosing a target card
    const meP=g.players[mySeat];
    const selCard=(selectedCardIdx!==null)?(meP.hand||[])[selectedCardIdx]:null;
    const isShaSel=!!(selCard && resolveActionId(g,meP,selCard)==='杀');    // 选的牌最终按"杀"结算(含赵云的闪、没有独立效果的红/黑牌)
    const isJiedaoSel=!!(selCard && selCard.name==='借刀杀人');             // 借刀杀人走专属两步选择,不进通用单目标块
    const needHandOrEquip=!!(selCard && (selCard.name==='顺手牵羊'||selCard.name==='过河拆桥'));
    // 顺手/拆桥对目标"有没有效果"的口径要和服务端 resolveTrick 的 optCount===0 一致:
    // 手牌、装备、判定区(延时锦囊)任一非空即可选——否则"手牌0但有装备/判定区的牌"会被
    // UI 误挡在选目标这一步(官方规则判定区也在可拿/可拆范围内,见 CLAUDE.md 改动记录)。
    const hasHandOrEquip = (p.hand||[]).length>0 || EQUIP_SLOTS.some(s=>p.equips && p.equips[s]) || (p.delays||[]).length>0;
    // 顺手牵羊/兵粮寸断(直接使用场景,不是徐晃【断粮】那条路径)距离限制均为1,和服务端
    // canTarget 的口径一致;过河拆桥/乐不思蜀/闪电均无此限制,不在这个判断范围内。
    const distLimited = !!(selCard && (selCard.name==='顺手牵羊' || selCard.name==='兵粮寸断'));
    const inRange = (!isShaSel || canReachSha(g, mySeat, i)) && (!distLimited || distance(g, mySeat, i) <= 1);
    // 默认不能选自己;是否放行自选要按这张延时锦囊自己的 onlySelf 判断(闪电 onlySelf:true 只能选自己,
    // 乐不思蜀/兵粮寸断 onlySelf:false 和普通牌一样不能选自己)。
    // 之前误用 CARD_PLAYS[name].allowSelf(delayTrickPlay 这个共享对象,所有延时锦囊都是 allowSelf:true,
    // 只用来放行服务端 playCard 的默认排自选校验)当"这张牌能不能选自己"的判断依据——allowSelf 为真时
    // (i!==mySeat || allowSelf) 对任何座位恒真,等于"选中任意延时锦囊后谁都能点",和服务端 canTarget
    // (按 DELAY_TRICKS[card.name].onlySelf 分别限制)不一致:闪电点别人在服务端被正确拒绝,但UI没跟着限制,
    // 表现为"点了没反应"。这里直接查 DELAY_TRICKS 复刻服务端同一条判断,不再经 allowSelf 这层间接。
    const selDT = selCard && DELAY_TRICKS[selCard.name];
    const selfOK = selDT ? (selDT.onlySelf ? i===mySeat : i!==mySeat) : (i!==mySeat);
    // 官方规则:同一判定区不能有两张同名的延时类锦囊牌,和服务端 canTarget 的 hasDup 判断口径一致。
    const hasDupDelay = !!(selDT && (p.delays||[]).some(c=>c && c.name===selCard.name));
    const targetable = selfOK && p.alive && (!needHandOrEquip || hasHandOrEquip) && inRange && !hasDupDelay;
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
      } else if((isShaSel||distLimited) && i!==mySeat && p.alive && !inRange){
        // 够不着:选了杀但超出攻击距离,或选了顺手牵羊/兵粮寸断但超出距离1 —— 暗色点线 + 角标 +
        // 悬浮说明,不可点(和杀同款视觉,避免玩家点了却被服务端 canTarget 拒绝)。
        d.style.outline='2px dotted #6b5b4d';
        d.title = isShaSel
          ? '攻击距离外（距离 '+distance(g,mySeat,i)+' ＞ 射程 '+attackRange(g,mySeat)+'）'
          : '距离外（距离 '+distance(g,mySeat,i)+' ＞ 1）';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">够不着</span>';
      } else if(selDT && hasDupDelay && selfOK && p.alive){
        // 判定区已有同名延时锦囊:官方规则不允许重复,暗色点线 + 角标 + 悬浮说明,不可点
        // (同款视觉,避免玩家点了却被服务端 canTarget 拒绝)。
        d.style.outline='2px dotted #6b5b4d';
        d.title='判定区已有【'+selCard.name+'】,不能重复放置';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">已有同名</span>';
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
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">够不着</span>';
      }
    }
    // 方天画戟选目标模式:点存活的、在攻击距离内的其他玩家 = 切换选中/取消,上限 min(3,范围内合法目标数)。
    // 不强制选满(选够1个即可点"确认发动");距离限制是推断而非确证的官方规则(见 EQUIPS['方天画戟'].desc)。
    if(fangtianMode && g.phase==='play' && g.turn===mySeat && i!==mySeat && p.alive){
      const reach = canReachSha(g, mySeat, i);
      const picked = fangtianPicks.includes(i);
      const selectable = reach && (picked || fangtianPicks.length<3);
      if(selectable){
        d.style.cursor='pointer';
        if(picked) d.style.outline='3px solid var(--gold)';
        else d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{
          if(picked) fangtianPicks = fangtianPicks.filter(x=>x!==i);
          else if(fangtianPicks.length<3) fangtianPicks.push(i);
          render(g);
        };
      } else if(!reach){
        d.style.outline='2px dotted #6b5b4d';
        d.title='攻击距离外（距离 '+distance(g,mySeat,i)+' ＞ 射程 '+attackRange(g,mySeat)+'）';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">够不着</span>';
      }
    }
    // 徐晃【断粮】选目标:已选中一张黑色基本牌/黑色装备牌后,点距离2以内的其他存活玩家提交
    // (官方规则"对距离2以内的角色使用",和杀的攻击距离同一套 distance() 口径,复用同款
    // "够不着"暗色点线+角标的视觉写法)。
    if(duanliangMode && duanliangCardIdx!==null && g.phase==='play' && g.turn===mySeat && i!==mySeat && p.alive){
      const inRange = distance(g, mySeat, i) <= 2;
      if(inRange){
        // 同上:idx 挂载时冻结,不在点击时才读 duanliangCardIdx
        const idx=duanliangCardIdx;
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{ confirmAndPlay('将这张牌当【兵粮寸断】使用,对 '+g.players[i].name+' 发动【断粮】？', ()=>duanLiang(idx, i)); };
      } else {
        d.style.outline='2px dotted #6b5b4d';
        d.title='距离外（距离 '+distance(g,mySeat,i)+' ＞ 2）';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">够不着</span>';
      }
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
  const phaseName={lobby:'等待开始',draw:'摸牌阶段',play:'出牌阶段',discard:'弃牌阶段',respond:'响应阶段',duel:'决斗中',wuxie:'无懈响应',aoeResp:'群体响应',pick:'选牌',qilin:'弃坐骑',dying:'濒死求桃',guicai:'鬼才改判',tieqi:'铁骑判定',liegong:'烈弓',luoshen:'洛神判定',xiaoguo:'骁果',xiaoguoChoice:'骁果选择',jiedaoChoice:'借刀杀人选择',wugu:'五谷丰登',qiaobianTurnStart:'巧变询问',qiaobianMove:'巧变移动',qinglong:'青龙偃月刀',hanbingAsk:'寒冰剑询问',hanbing:'寒冰剑弃牌',guanshi:'贯石斧',yijiAsk:'遗计询问',yijiAssign:'遗计分配',pickingGeneral:'选将阶段',over:'游戏结束'}[g.phase]||g.phase;
  document.getElementById('phasePill').textContent=phaseName;
  document.getElementById('deckInfo').textContent = g.started ? ('第'+(g.roundNum||1)+'轮 · 牌堆 '+g.deck.length+' · 弃牌堆 '+g.discard.length) : '';

  // banner 的全部内容现在唯一由 renderControls 负责写入(见该函数顶部 setBanner 说明),
  // 这里不再并行维护一份——避免同一份信息有两个书写者、两边不同步。
  renderControls(g);
  renderHand(g);

  // 日志不再常驻:默认收起,只有 #logBtn 点开的浮层打开着时才需要跟着这次 render 同步刷新内容
  // (Firebase 是实时推送,面板开着的时候底下状态可能还在变,不刷新就会显示过期日志)。
  if(logModalOpen) renderLogModal(g);

  // 日志 toast:有新日志才弹,把本次新增的日志(可能不止一条,比如延时锦囊判定这类一次事务
  // 里连续 pushLog 好几次)排队依次展示——早期版本"只弹最新一条"会把中间结果(比如判定牌本身
  // 生效/无效那条)淹没掉,只看到判定后紧跟着的下一条日志,看不出判定过程发生了什么。
  // 定位新增日志的起点:不能按数组长度(会被 pushLog 的 slice(-40) 封顶,详见上面
  // lastToastedLogText 声明处的说明),而是从数组末尾往前找"上次已展示的那条文本"出现的位置——
  // 找不到(日志被封顶顶掉、或全新房间)就只展示这次拿到的全部(newLines,由下面的上限兜底)。
  const log = g.log||[];
  if(lastToastedLogText===undefined){
    lastToastedLogText = log.length ? log[log.length-1] : null; // 第一次render,只记文本,不弹历史
  } else if(log.length){
    let startIdx = log.length; // 默认:没有新增
    for(let i=log.length-1; i>=0; i--){
      if(log[i]===lastToastedLogText){ startIdx=i+1; break; }
      if(i===0) startIdx=0; // 没找到,说明这段时间新增了不止能追溯的量,从头展示这次拿到的全部
    }
    const newLines = log.slice(startIdx);
    if(newLines.length){
      queueLogToasts(g, newLines);
      lastToastedLogText = log[log.length-1];
    }
  }
}

// renderPickGeneral: g.phase==='pickingGeneral' 阶段的UI。两种状态——①自己的
// generalChoices 还有值(还没选):展示3个候选武将卡片(头像+武将名·技能名+完整desc说明
// 文字),点击提交respondPickGeneral;②自己已经选定(generalChoices已清空、general有值):
// 展示banner"你已选择:XX,等待其他玩家…"+其他玩家的选择进度(只显示已选/未选状态,不暴露
// 别人的候选内容——候选本身也是隐藏信息,武将确定前不该被别人看到)。
// 布局:候选卡片纵向堆叠(不是横排3列)——desc完整说明文字通常有一两句话,比单纯技能名长
// 不少,三张卡片横排会挤得每张都很窄导致文字换行挤压变形,纵向堆叠让每张卡片都能占满宽度、
// 有足够空间完整展示说明文字。
function renderPickGeneral(g, c){
  const me = g.players[mySeat];
  if(!me){ setBanner('选将阶段…'); return; }
  if(Array.isArray(me.generalChoices) && me.generalChoices.length>0){
    setBanner('选将阶段:请从下面3名候选武将中选择一名');
    const list=document.createElement('div'); list.className='general-pick-list';
    me.generalChoices.forEach(id=>{
      const gen=getGeneral(id); if(!gen) return;
      const card=document.createElement('div'); card.className='general-pick-card';
      card.innerHTML =
        '<div class="avatar-box">'
          +'<img class="avatar" src="'+generalAvatarSrc(gen.id)+'" onerror="avatarError(this)" alt="">'
          +'<div class="avatar-placeholder" style="display:none">'+escapeHtml(gen.name)+'</div>'
        +'</div>'
        +'<div class="general-pick-info">'
          +'<div class="general-pick-name">'+escapeHtml(gen.name)+' · '+escapeHtml(gen.skill)+'</div>'
          +'<div class="general-pick-desc">'+escapeHtml(gen.desc||'(暂无说明)')+'</div>'
        +'</div>';
      card.onclick=()=>respondPickGeneral(id);
      list.appendChild(card);
    });
    c.appendChild(list);
    return;
  }
  // 自己已经选完,等待其他玩家
  const myGen = getGeneral(me.general);
  setBanner('你已选择：'+escapeHtml(myGen?myGen.name:'')+'，等待其他玩家选择…');
  const prog=document.createElement('div'); prog.className='pick-progress';
  g.players.forEach(p=>{
    if(!p) return;
    const done = !!p.general;
    const row=document.createElement('div'); row.className='pick-progress-row';
    row.innerHTML = escapeHtml(p.name)+'：'+(done?'<span style="color:var(--jade)">已选择</span>':'<span style="color:var(--paper-dim)">等待中…</span>');
    prog.appendChild(row);
  });
  c.appendChild(prog);
}
function renderControls(g){
  const c=document.getElementById('controls'); c.innerHTML='';
  setBanner(''); // 唯一重置点:每次重渲染先清空,下面每个分支各写各的一句
  const me=g.players[mySeat];
  const myTurn = g.turn===mySeat;

  // pickingGeneral 阶段发生在 g.started 真正置 true(finishGeneralAssign)之前,必须在
  // "!g.started" 这个判断之前先检查,否则会被下面那个分支提前拦截、永远进不到这里。
  if(g.phase==='pickingGeneral'){
    renderPickGeneral(g, c);
    return;
  }
  if(!g.started){
    const cnt=(g.players||[]).filter(Boolean).length;
    // 两种开局模式的按钮并列:随机武将(原有行为,直接分配)/三选一(进入 pickingGeneral
    // 阶段各自选择)。不管哪种模式,startGame(mode) 内部都靠"开局前不放回抽样锁定这局武将池"
    // 保证同局武将互不重复,这里的按钮只负责传参、不做任何重复性判断。
    // 两个按钮视觉权重必须一致(都用 ghost,不用 primary/ghost 这种"一个突出一个不突出"的
    // 搭配)——这两个是平等的两种模式选择,不是"默认推荐项+备选项"的关系,主次视觉会误导玩家
    // 下意识觉得该点哪个。人数计数两边都要显示(之前只有随机武将那个有,三选一没有,容易让人
    // 忽略"三选一同样受人数门槛限制"这件事)。
    const btnRandom=document.createElement('button');
    btnRandom.className='ghost'; btnRandom.textContent='开始游戏(随机武将)（'+cnt+'/'+SEATS+'）';
    btnRandom.disabled = cnt<MIN_PLAYERS;
    btnRandom.onclick=()=>startGame('random');
    c.appendChild(btnRandom);

    const btnPick=document.createElement('button');
    btnPick.className='ghost'; btnPick.textContent='开始游戏(三选一)（'+cnt+'/'+SEATS+'）';
    btnPick.disabled = cnt<MIN_PLAYERS;
    btnPick.onclick=()=>startGame('pick');
    c.appendChild(btnPick);

    if(cnt<MIN_PLAYERS) setBanner('至少 '+MIN_PLAYERS+' 人即可开始,还差 '+(MIN_PLAYERS-cnt)+' 人…');
    else if(cnt<SEATS) setBanner('已可开始（'+cnt+' 人),也可等满 '+SEATS+' 人。');
    return;
  }
  if(g.phase==='over'){
    const btn=document.createElement('button'); btn.className='primary';
    btn.textContent='再来一局'; btn.onclick=newGame; c.appendChild(btn);
    // "结束并清理房间"这个按钮已经统一到页面左上角常驻的 #closeRoomBtn(cleanupRoom),
    // 不再在这里重复渲染同一个功能,避免游戏结束时同时出现两个功能一样的按钮让玩家困惑。
    setBanner('🏆 胜者：'+escapeHtml(g.winner||'')+' · 大家看完结果后,可点左上角「关闭房间」删除本房间数据。', 'border-color:var(--gold);color:var(--gold)');
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
    setBanner('你对 '+escapeHtml(to)+' 出【杀】,是否发动【铁骑】判定?若为红色则此杀不可被闪抵消。'+fangtianSuffix(g));
    return;
  }
  if(g.phase==='tieqi' && g.pending && g.pending.type==='tieqi'){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner(escapeHtml(from)+' 对 '+escapeHtml(to)+' 出【杀】,'+escapeHtml(from)+' 是否发动【铁骑】进行判定…'+fangtianSuffix(g));
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
    setBanner('你对 '+escapeHtml(to)+' 出【杀】,是否发动【烈弓】?令此杀不可被闪抵消。'+fangtianSuffix(g));
    return;
  }
  if(g.phase==='liegong' && g.pending && g.pending.type==='liegong'){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner(escapeHtml(from)+' 对 '+escapeHtml(to)+' 出【杀】,'+escapeHtml(from)+' 是否发动【烈弓】…'+fangtianSuffix(g));
    return;
  }
  // 青龙偃月刀:杀被闪抵消,装备者(攻击者)是否发动再使用一张杀(固定同一目标,不需要选目标)。
  if(g.phase==='qinglong' && g.pending && g.pending.type==='qinglong' && g.pending.from===mySeat){
    const to=g.players[g.pending.to].name;
    if(qinglongMode){
      setBanner('【青龙偃月刀】选择一张能当【杀】的手牌,对 '+escapeHtml(to)+' 再次使用。');
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetQinglong(); render(g); }; c.appendChild(cb);
    } else {
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='发动【青龙偃月刀】'; b1.onclick=()=>{ qinglongMode=true; render(g); };
      c.appendChild(b1);
      const b2=document.createElement('button');
      b2.textContent='不发动'; b2.onclick=()=>respondQinglong(false);
      c.appendChild(b2);
      setBanner('你对 '+escapeHtml(to)+' 的【杀】被【闪】抵消,是否发动【青龙偃月刀】再使用一张【杀】?');
    }
    return;
  }
  if(g.phase==='qinglong' && g.pending && g.pending.type==='qinglong'){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner(escapeHtml(from)+' 对 '+escapeHtml(to)+' 的【杀】被【闪】抵消,'+escapeHtml(from)+' 是否发动【青龙偃月刀】…');
    return;
  }
  // 贯石斧:杀被闪抵消,装备者(攻击者)可弃自己2张牌(手牌/装备混合toggle多选)令这张杀依然
  // 造成伤害。恰好选够2项才出现"确认发动";同屏始终有"不发动"。
  if(g.phase==='guanshi' && g.pending && g.pending.type==='guanshi' && g.pending.from===mySeat){
    const to=g.players[g.pending.to].name;
    const opts=guanshifuOptions(g.players[mySeat]);
    opts.forEach(o=>{
      const picked=guanshiPicks.includes(o.key);
      const b=document.createElement('button');
      if(picked) b.className='primary';
      b.textContent=(picked?'✓ ':'')+o.label;
      b.onclick=()=>{
        if(picked) guanshiPicks=guanshiPicks.filter(x=>x!==o.key);
        else if(guanshiPicks.length<2) guanshiPicks=[...guanshiPicks, o.key];
        render(g);
      };
      c.appendChild(b);
    });
    if(guanshiPicks.length===2){
      const ok=document.createElement('button'); ok.className='primary';
      ok.textContent='确认发动【贯石斧】'; ok.onclick=()=>{ const picks=guanshiPicks.slice(); resetGuanshi(); respondGuanshi(picks); };
      c.appendChild(ok);
    }
    const nb=document.createElement('button');
    nb.textContent='不发动'; nb.onclick=()=>{ resetGuanshi(); respondGuanshi(null); };
    c.appendChild(nb);
    setBanner('你对 '+escapeHtml(to)+' 的【杀】被【闪】抵消,是否弃2张牌(已选 '+guanshiPicks.length+'/2)发动【贯石斧】令此【杀】依然造成伤害?');
    return;
  }
  if(g.phase==='guanshi' && g.pending && g.pending.type==='guanshi'){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner(escapeHtml(from)+' 对 '+escapeHtml(to)+' 的【杀】被【闪】抵消,'+escapeHtml(from)+' 是否发动【贯石斧】…');
    return;
  }
  // 郭嘉【遗计】:受伤后是否发动,看牌堆顶2张(不足2张时可能只有1张)分给任意角色(含自己)。
  if(g.phase==='yijiAsk' && g.pending && g.pending.type==='yijiAsk' && g.pending.seat===mySeat){
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【遗计】'; b1.onclick=()=>respondYijiAsk(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动'; b2.onclick=()=>respondYijiAsk(false);
    c.appendChild(b2);
    setBanner('你受到了伤害,是否发动【遗计】,观看牌堆顶两张牌并分配?');
    return;
  }
  if(g.phase==='yijiAsk' && g.pending && g.pending.type==='yijiAsk'){
    const p=g.players[g.pending.seat].name;
    setBanner('等待 '+escapeHtml(p)+' 决定是否发动【遗计】…'); // 不剧透是否受伤/发动详情之外的任何牌面信息
    return;
  }
  // 郭嘉【遗计】分配阶段:g.pending.cards 是共享状态里的真实牌面,理论上任何客户端都能读到——
  // 必须严格只在 mySeat===pending.seat 时才把牌面画出来,其余客户端只看不剧透的 banner,
  // 和现有对手手牌只显示牌背的处理原则一致(见 CLAUDE.md 的技术债提示)。
  if(g.phase==='yijiAssign' && g.pending && g.pending.type==='yijiAssign' && g.pending.seat===mySeat){
    const cards=g.pending.cards;
    const alivePlayers=g.players.map((p,i)=>({p,i})).filter(o=>o.p && o.p.alive);
    const idx=yijiPicks.length; // 当前正在为第几张牌选接收者(0-based),渲染这一刻冻结,不在 onclick 里读可变的 yijiPicks
    const isLast=(idx===cards.length-1);
    const card=cards[idx];
    const cardBox=document.createElement('div'); cardBox.className='card '+(card.name==='杀'?'sha':card.name==='桃'?'tao':card.name==='闪'?'shan':'trick');
    cardBox.style.display='inline-block'; cardBox.style.marginRight='10px';
    cardBox.innerHTML='<div class="corner">'+(cardFace(card)||card.name)+'</div><div class="big">'+card.name+'</div><div class="corner br">'+card.name+'</div>';
    c.appendChild(cardBox);
    alivePlayers.forEach(o=>{
      const b=document.createElement('button');
      b.textContent='给 '+(o.i===mySeat?'自己':o.p.name);
      // 选到最后一张牌时,这次点击就直接提交(不是"选满再点确认"那套,少一步交互);
      // 不是最后一张就只是累积选择、留在同一 tx 之外继续问下一张。
      b.onclick = isLast
        ? ()=>{ const picks=[...yijiPicks, o.i]; resetYiji(); respondYijiAssign(picks); }
        : ()=>{ yijiPicks=[...yijiPicks, o.i]; render(g); };
      c.appendChild(b);
    });
    if(idx>0){
      const back=document.createElement('button'); back.className='ghost';
      back.textContent='上一步(重选)'; back.onclick=()=>{ yijiPicks=yijiPicks.slice(0,-1); render(g); };
      c.appendChild(back);
    }
    setBanner('【遗计】选择第'+(idx+1)+'/'+cards.length+'张牌交给谁?');
    return;
  }
  if(g.phase==='yijiAssign' && g.pending && g.pending.type==='yijiAssign'){
    const p=g.players[g.pending.seat].name;
    setBanner(escapeHtml(p)+' 正在分配【遗计】看到的牌…'); // 不渲染牌面,严格保密
    return;
  }
  // 寒冰剑:杀命中前,装备者(攻击者)是否发动"防止伤害、改为弃置目标两张牌"。
  if(g.phase==='hanbingAsk' && g.pending && g.pending.type==='hanbingAsk' && g.pending.from===mySeat){
    const to=g.players[g.pending.to].name;
    const b1=document.createElement('button'); b1.className='primary';
    b1.textContent='发动【寒冰剑】'; b1.onclick=()=>respondHanbingAsk(true);
    c.appendChild(b1);
    const b2=document.createElement('button');
    b2.textContent='不发动'; b2.onclick=()=>respondHanbingAsk(false);
    c.appendChild(b2);
    setBanner('你的【杀】命中 '+escapeHtml(to)+',是否发动【寒冰剑】?防止伤害,改为弃置对方两张牌。');
    return;
  }
  if(g.phase==='hanbingAsk' && g.pending && g.pending.type==='hanbingAsk'){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner(escapeHtml(from)+' 的【杀】命中 '+escapeHtml(to)+','+escapeHtml(from)+' 是否发动【寒冰剑】…');
    return;
  }
  // 寒冰剑弃牌子阶段:和 pick 阶段同一套"随机手牌+具名装备"选项列表,只是这次响应函数是
  // hanbingPick,弃完一张可能还会自动/再问下一轮(由 startHanbingRound 决定,不在这里判断)。
  if(g.phase==='hanbing' && g.pending && g.pending.from===mySeat){
    const tgt=g.players[g.pending.to];
    if(tgt && (tgt.hand||[]).length>0){
      const b=document.createElement('button'); b.className='primary';
      b.textContent='弃随机一张手牌'; b.onclick=()=>hanbingPick('hand'); c.appendChild(b);
    }
    if(tgt) EQUIP_SLOTS.forEach(s=>{ if(tgt.equips[s]){
      const b=document.createElement('button');
      b.textContent='弃装备【'+tgt.equips[s].name+'】'; b.onclick=()=>hanbingPick(s); c.appendChild(b);
    }});
    setBanner('【寒冰剑】选择弃置 '+escapeHtml(tgt?tgt.name:'目标')+' 的第'+((g.pending.round||0)+1)+'张牌（手牌随机、装备可指定）。');
    return;
  }
  if(g.phase==='hanbing' && g.pending){
    const from=g.players[g.pending.from].name, to=g.players[g.pending.to].name;
    setBanner(escapeHtml(from)+' 发动了【寒冰剑】,正在选择弃置 '+escapeHtml(to)+' 的第'+((g.pending.round||0)+1)+'张牌…');
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
  // ===== 张郃【巧变】完整版:回合开始"是否发动"→"选牌+选阶段"→(仅出牌阶段)"是否移动一张牌" =====
  if(g.phase==='qiaobianTurnStart' && g.pending && g.pending.type==='qiaobianTurnStart' && g.pending.seat===mySeat){
    if(qiaobianMode!=='choosePhase'){
      const b1=document.createElement('button'); b1.className='primary';
      b1.textContent='发动【巧变】'; b1.onclick=()=>{ qiaobianMode='choosePhase'; qiaobianCardIdx=null; qiaobianPhaseChoice=null; render(g); };
      c.appendChild(b1);
      const b2=document.createElement('button');
      b2.textContent='不发动'; b2.onclick=()=>qiaobianDecline();
      c.appendChild(b2);
      setBanner('是否发动【巧变】,弃一张手牌并跳过判定/摸牌/出牌/弃牌阶段之一?');
      return;
    }
    // choosePhase 模式:手牌区选一张牌(见 renderHand 里的 qiaobianMode==='choosePhase' 分支)+
    // 这里选一个要跳过的阶段,两者都选好才出现"确认"。
    const phases=[['judge','判定阶段'],['draw','摸牌阶段'],['play','出牌阶段'],['discard','弃牌阶段']];
    phases.forEach(([key,label])=>{
      const b=document.createElement('button');
      if(qiaobianPhaseChoice===key) b.className='primary';
      b.textContent=label; b.onclick=()=>{ qiaobianPhaseChoice=key; render(g); };
      c.appendChild(b);
    });
    if(qiaobianCardIdx!==null && qiaobianPhaseChoice){
      const ok=document.createElement('button'); ok.className='primary';
      ok.textContent='确认'; ok.onclick=()=>{ const idx=qiaobianCardIdx, ph=qiaobianPhaseChoice; resetQiaobian(); qiaobianDeclare(idx, ph); };
      c.appendChild(ok);
    }
    const cb=document.createElement('button'); cb.className='ghost';
    cb.textContent='取消'; cb.onclick=()=>{ resetQiaobian(); render(g); }; c.appendChild(cb);
    setBanner('【巧变】选择一张要弃置的手牌(下方手牌区点选)，再选一个要跳过的阶段'+
      (qiaobianCardIdx===null?'（还没选牌）':'')+(qiaobianPhaseChoice?'':'（还没选阶段）')+'。');
    return;
  }
  if(g.phase==='qiaobianTurnStart' && g.pending && g.pending.type==='qiaobianTurnStart'){
    setBanner(escapeHtml(g.players[g.pending.seat].name)+' 是否发动【巧变】…');
    return;
  }
  if(g.phase==='qiaobianMove' && g.pending && g.pending.type==='qiaobianMove' && g.pending.seat===mySeat){
    if(qiaobianSrc){
      const targets=qiaobianTargets(g, qiaobianSrc);
      targets.forEach(t=>{
        const b=document.createElement('button');
        b.textContent='移动到 '+t.label; b.onclick=()=>{
          const src=qiaobianSrc; resetQiaobian();
          respondQiaobianMove({kind:src.kind, srcSeat:src.seat, slot:src.slot, idx:src.idx, dstSeat:t.seat});
        };
        c.appendChild(b);
      });
      const back=document.createElement('button'); back.className='ghost';
      back.textContent='重新选来源'; back.onclick=()=>{ qiaobianSrc=null; render(g); }; c.appendChild(back);
      const skip=document.createElement('button'); skip.className='ghost';
      skip.textContent='不移动'; skip.onclick=()=>{ resetQiaobian(); respondQiaobianMove(null); }; c.appendChild(skip);
      setBanner('【巧变】把'+escapeHtml(qiaobianSrc.label)+'移动到哪位角色?'+(targets.length===0?'(没有合法的目的地)':''));
      return;
    }
    const sources=qiaobianSources(g);
    sources.forEach(s=>{
      const b=document.createElement('button');
      b.textContent=s.label; b.onclick=()=>{ qiaobianSrc=s; render(g); };
      c.appendChild(b);
    });
    const skip=document.createElement('button'); skip.className='primary';
    skip.textContent='不移动'; skip.onclick=()=>{ resetQiaobian(); respondQiaobianMove(null); };
    c.appendChild(skip);
    setBanner('【巧变】跳过出牌阶段成功,是否移动一张装备/判定牌?');
    return;
  }
  if(g.phase==='qiaobianMove' && g.pending && g.pending.type==='qiaobianMove'){
    setBanner(escapeHtml(g.players[g.pending.seat].name)+' 正在决定是否移动一张装备/判定牌…');
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
    setBanner(lead+tail+fangtianSuffix(g));
    return;
  }
  if(g.phase==='respond' && g.pending){
    const to=g.players[g.pending.to].name, from=g.players[g.pending.from].name;
    // 攻击者/目标名字各自染身份色(按座位号,不按名字,避免撞色),一眼看出"谁在打谁"
    // (仅此 banner;日志是纯文本存储,escapeHtml 后无法带色,不做)
    const fromSpan='<span style="color:'+seatColor(g.pending.from)+'">'+escapeHtml(from)+'</span>';
    const toSpan='<span style="color:'+seatColor(g.pending.to)+'">'+escapeHtml(to)+'</span>';
    const noShanTag = g.pending.noShan ? '(【铁骑】判红,不可被闪抵消)' : '';
    setBanner(fromSpan+' 对 '+toSpan+' 出【杀】'+noShanTag+',等待'+toSpan+'响应…'+fangtianSuffix(g));
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
    // 判定区(延时锦囊)公开:逐张列出具体牌名供指定,官方规则明确判定区也在可拿/可拆范围内
    if(tgt) (tgt.delays||[]).forEach((card,idx)=>{
      const b=document.createElement('button');
      b.textContent=verb+'判定区【'+card.name+'】'; b.onclick=()=>pickResolve('delay:'+idx); c.appendChild(b);
    });
    setBanner('对 '+escapeHtml(tgt?tgt.name:'目标')+' 使用【'+escapeHtml(g.pending.trick)+'】,选择'+verb+'哪张牌（手牌随机、装备/判定区可指定）。');
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
    // 方天画戟触发条件(手牌恰好剩1张+能当杀+还能出杀)在选目标途中变得不满足 → 安全退出,不卡在选牌模式
    if(fangtianMode && (!canSha || me.hand.length!==1 || !hasCap(me,'fangtian') || !canUseAs(me,(me.hand||[])[0],'杀'))) resetFangtian();
    if(fangtianMode){
      // 方天画戟选目标模式:点上方存活+范围内的其他玩家(见 seat 循环里的分支),不强制选满,选够1个即可确认。
      setBanner('【方天画戟】选择至多3个目标(已选 '+fangtianPicks.length+'/3，攻击距离 '+attackRange(g,mySeat)+')。');
      if(fangtianPicks.length>=1){
        const ok=document.createElement('button'); ok.className='primary';
        ok.textContent='确认出杀'; ok.onclick=()=>{ const picks=fangtianPicks.slice(); resetFangtian(); playShaFangtian(0, picks); };
        c.appendChild(ok);
      }
      const cb=document.createElement('button'); cb.className='ghost';
      cb.textContent='取消'; cb.onclick=()=>{ resetFangtian(); render(g); }; c.appendChild(cb);
    } else if(duanliangMode){
      // 断粮选牌+选目标模式:先选一张黑色基本牌/黑色装备牌,再点距离2以内的其他玩家提交。提供取消。
      setBanner(duanliangCardIdx===null
        ? '【断粮】选择一张黑色基本牌或黑色装备牌当【兵粮寸断】使用。'
        : '已选中,点上方距离2以内的一名其他玩家,当【兵粮寸断】对其使用(或点牌取消选中)。');
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
    if(!zhangbaMode && !duanliangMode && !fangtianMode && selectedCardIdx===null && hasCap(me,'twoAsSha') && (me.hand||[]).length>=2 && canSha){
      const zb=document.createElement('button'); zb.className='ghost';
      zb.textContent='丈八蛇矛:两张牌当杀'; zb.onclick=()=>{ selectedCardIdx=null; zhangbaMode=true; zhangbaPicks=[]; render(g); }; c.appendChild(zb);
    }
    // 断粮入口:出牌阶段限一次,手牌里至少有一张黑色基本牌/黑色装备牌才值得开这个入口
    // (没有符合条件的牌就跟没有技能一样不渲染,不能只看"手牌非空"——那样会出现点进去
    // 一张能选的牌都没有的死胡同界面)。
    const hasDuanliangCard = (me.hand||[]).some(c=>(c.suit==='♠'||c.suit==='♣') && (BASIC_CARDS.includes(c.name)||!!getEquip(c.name)));
    if(!zhangbaMode && !duanliangMode && !fangtianMode && selectedCardIdx===null && hasCap(me,'duanliang') && !g.duanliangUsed && hasDuanliangCard){
      const db=document.createElement('button'); db.className='ghost';
      db.textContent='发动【断粮】'; db.onclick=()=>{ selectedCardIdx=null; duanliangMode=true; duanliangCardIdx=null; render(g); }; c.appendChild(db);
    }
    // 方天画戟入口:锁定技,仅当手牌恰好只剩这最后一张、且这张牌能当杀、且本回合还能出杀时才出现——
    // 不满足条件(手里还有别的牌)时和没有这把武器一样,普通单目标出杀流程完全不受影响。
    if(!zhangbaMode && !duanliangMode && !fangtianMode && selectedCardIdx===null && hasCap(me,'fangtian') && canSha
       && (me.hand||[]).length===1 && canUseAs(me,(me.hand||[])[0],'杀')){
      const fb=document.createElement('button'); fb.className='ghost';
      fb.textContent='追加目标(方天画戟)'; fb.onclick=()=>{ selectedCardIdx=null; fangtianMode=true; fangtianPicks=[]; render(g); }; c.appendChild(fb);
    }
    const b=document.createElement('button'); b.className='ghost';
    b.textContent='结束出牌'; b.onclick=()=>{selectedCardIdx=null;resetZhangba();resetDuanliang();resetQiaobian();resetJiedao();resetFangtian();endPlay();}; c.appendChild(b);
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

// attachLongPressPreview: 手机端(触屏设备)长按放大预览,和桌面端鼠标悬停(index.html里
// @media (hover:hover) and (pointer:fine) 限定的 .card:hover)是两条独立的交互路径——桌面端
// 靠CSS伪类自动响应真实的悬停状态,手机端没有"悬停"这个交互状态,靠这里手动监听touch事件、
// 长按500ms后手动切换一个class(.long-press-preview)来复用同一套放大视觉效果(scale+
// translateY+box-shadow,见index.html的.card.long-press-preview规则)。两者互不干扰:桌面端
// 触屏模拟不出真悬停(见CLAUDE.md的hover:hover/pointer:fine限定),这里的touch监听器也不会
// 在桌面鼠标操作下触发(桌面浏览器点击不会派发touchstart)。
// 长按只是纯视觉预览,不进入任何游戏操作流程——不调用render(g)、不设置selectedCardIdx等
// 任何游戏状态,松手时如果触发过长按预览,阻止这次touchend继续变成click(不会误触发打牌);
// 如果手指按下后不到500ms就松开(正常点击),不做任何拦截,原有的点击打牌逻辑照常执行。
// renderHand每次游戏状态更新都会把整排手牌DOM销毁重建(h.innerHTML=''重新生成),旧的
// touch监听器随着旧DOM节点一起被丢弃,所以这个函数必须在每次renderHand为每张新生成的
// 卡片元素各自调用一次,不能只在页面加载时绑定一次。
function attachLongPressPreview(el, card){
  let pressTimer = null;
  let longPressTriggered = false;

  const start = (e)=>{
    longPressTriggered = false;
    pressTimer = setTimeout(()=>{
      longPressTriggered = true;
      el.classList.add('long-press-preview');
    }, 500);
  };
  const cancel = ()=>{
    clearTimeout(pressTimer);
    el.classList.remove('long-press-preview');
  };
  const end = (e)=>{
    clearTimeout(pressTimer);
    if(longPressTriggered){
      el.classList.remove('long-press-preview');
      e.preventDefault();
      e.stopPropagation();
    }
  };

  el.addEventListener('touchstart', start, {passive:true});
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('touchmove', cancel);
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
    const qiaobianPicked = qiaobianMode==='choosePhase' && qiaobianCardIdx===idx;
    el.className='card '+cls+((selectedCardIdx===idx||picked||duanliangPicked||qiaobianPicked)?' selected':'');
    // 卡片版式:顶部标题栏(牌名,代码生成文字,不依赖图片、始终显示)+ 下方插画区域(图片,
    // 有则铺满、没有则留一块占位底色)+ 左上角花色点数角标——更接近实体卡牌的分区观感,
    // 牌名不再像早期"图片铺满全卡"那版那样靠 no-art 来控制显示/隐藏。
    // .corner 相对整张卡片(.card)定位,top:0;left:0,和右上角"?"图标(.info-badge-hit)
    // 对角对齐;尺寸由 CSS 的 --badge 变量统一控制,不在这里处理(见 index.html)。
    // 只保留左上角一个角标,右下角(.corner.br)已删除——单个角标已经能完整传达花色点数
    // 信息,不需要两处重复。
    const imgSrc = cardImageSrc(card.name);
    const imgTag = imgSrc ? '<img class="card-art" src="'+imgSrc+'" onerror="cardImgError(this)" alt="">' : '';
    const cornerText = cardFace(card)||'';
    // 标题栏字号用 fitFontSize 实测自适应(取代早期"按牌名字数分档手动猜大小"的做法,
    // 那套只覆盖了4字/5字两档,任何新长度组合都要回来手动调整)。cardMetricsForViewport
    // 按当前视口宽度取这一档卡片的实际宽度/--badge值/标题栏最大字号。
    // 【曾经反复出现三次的真实bug,这次修正】titleMaxWidth 曾经按 CSS 的 .card-title
    // padding 系数(--badge*0.12*2)算,那只是"给文字预留的装饰性呼吸空间"这个很小的
    // 数值(badge=20px时只有4.8px)——但左右两个图标(.corner花色角标、.info-badge-hit
    // 问号)是绝对定位悬浮在标题栏上层的完整 badge 宽度方块(20px/16px/14px),不受父
    // 元素padding约束、z-index比文字高。maxWidth 算的是"CSS padding算出来的名义宽度"
    // 而不是"两个图标之间真正的净空间"——这两者是完全不同的两个数字,只要文字宽度超出
    // 图标间真正的净空间,末尾的字就会被图标不透明地压住挡掉,不管字号算法本身多精确都
    // 没用(算法只能保证"塞进算出来的maxWidth",算错了maxWidth,结果必然还是被挡)。
    // 现在改成:卡片宽度减去左右各一个完整badge的宽度(图标真正占用、文字必须避开的
    // 空间),再留4px缓冲。
    const m = cardMetricsForViewport();
    const titleMaxWidth = m.cardWidth - m.badge * 2 - 4;
    const titleFontSize = fitFontSize(card.name, titleMaxWidth, m.maxTitleFont, 700, CARD_TITLE_FONT_FAMILY) + 'px';
    el.innerHTML =
      '<div class="card-title" style="font-size:'+titleFontSize+'">'+card.name+'</div>'
      +'<div class="card-art-box">'+imgTag+'</div>'
      +'<div class="corner">'+cornerText+'</div>';
    el.classList.toggle('no-art', !imgSrc); // no-art 现在只控制插画区域的占位底色,不再控制牌名文字的显示/隐藏

    let usable=false, onClick=null;
    if(g.phase==='guicai'&&guicaiMode&&g.pending&&g.pending.type==='guicai'&&g.pending.asking===mySeat){
      // 鬼才选牌模式:任意一张手牌都可以打出替换判定牌
      usable=true; onClick=()=>respondGuicai(true, idx);
    } else if(g.phase==='xiaoguo'&&xiaoguoMode&&g.pending&&g.pending.type==='xiaoguo'&&g.pending.asking===mySeat){
      // 骁果选牌模式:只有基本牌(杀/闪/桃)可选,其余牌照常灰显不可点
      usable = BASIC_CARDS.includes(card.name);
      if(usable) onClick=()=>{ resetXiaoguo(); respondXiaoguo(true, idx); };
    } else if(g.phase==='qinglong'&&qinglongMode&&g.pending&&g.pending.type==='qinglong'&&g.pending.from===mySeat){
      // 青龙偃月刀选牌模式:只有能当杀的牌可选(canUseAs 统一入口,含龙胆闪当杀等转化),
      // 点了直接提交,不需要额外确认(目标固定,不需要选目标)。
      usable = canUseAs(me, card, '杀');
      if(usable) onClick=()=>{ resetQinglong(); respondQinglong(true, idx); };
    } else if(g.phase==='qiaobianTurnStart'&&qiaobianMode==='choosePhase'&&g.pending&&g.pending.type==='qiaobianTurnStart'&&g.pending.seat===mySeat){
      // 巧变选牌模式:任意一张牌都可以选(不检查牌名)。toggle 单选(和断粮同款),
      // 还要另外选一个阶段(四个按钮在 renderControls 里),两者都选好才出现"确认"。
      usable=true;
      onClick=()=>{ qiaobianCardIdx = (qiaobianCardIdx===idx?null:idx); render(g); };
    } else if(g.phase==='play'&&myTurn&&duanliangMode){
      // 断粮选牌模式:官方规则只能选黑色基本牌或黑色装备牌(不是任意牌),不满足条件的牌
      // 照常灰显不可点。点=切换选中(单选,再点别的合法牌会换选中)。
      const isBlack = card.suit==='♠' || card.suit==='♣';
      const isBasicOrEquip = BASIC_CARDS.includes(card.name) || !!getEquip(card.name);
      usable = isBlack && isBasicOrEquip;
      if(usable) onClick=()=>{ duanliangCardIdx = (duanliangCardIdx===idx?null:idx); render(g); };
    } else if(g.phase==='play'&&myTurn&&fangtianMode){
      // 方天画戟选目标模式:手牌只有这一张(触发条件已限定),不需要再点手牌本身,
      // 目标全部在座位区(见下方 seat 循环里的 fangtianMode 分支)选择,这里留空不可点。
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
    attachLongPressPreview(el, card); // 手机端长按放大预览,和桌面端hover是独立的两条路径
    h.appendChild(el);
  });
  if((me.hand||[]).length===0) h.innerHTML='<span style="color:var(--paper-dim);font-size:13px">（暂无手牌）</span>';
}

// fitFontSize: 用canvas measureText测量文字在给定字号下的实际宽度,反推出能让文字刚好
// 塞进 maxWidth 的字号(不超过 maxFontSize),取代早期"按字数分档手动猜大小"的做法——
// 新增任何长度的牌名都不需要回来手动调整,算法自动算出刚好放得下的字号。
// 用一个模块级复用的canvas(避免每次调用都新建一个,减少开销)。
// 【曾经的下限保护,已移除,真实bug】原来 return Math.max(scaled, maxFontSize*0.4) 设了
// 一个"不低于maxFontSize*0.4"的下限,初衷是"避免极端长文字缩到无法辨认"——但用 Playwright
// 实测"青龙偃月刀"（5字,64px卡片,两个20px图标间真实净空间只有~22px）发现:这个下限会
// 反过来违背 fitFontSize 本身"保证文字塞进maxWidth"的核心承诺——被下限强行拉高到
// maxFontSize*0.4(=5.6px)后,实际渲染宽度是29.45px,超过了22px的真实间隙,文字依然
// 被左右两个图标压住,和"按maxWidth精确计算字号"这个函数存在的意义直接矛盾。有下限时,
// "文字会不会被遮挡"这件事不再由 maxWidth 决定,而是由"maxFontSize*0.4 算出来的宽度
// 是否偶然小于间隙"这个和 maxWidth 无关的巧合决定——这不是这个函数应该承诺的行为。
// 现在去掉下限,允许字号真正缩到能塞进 maxWidth 为止(哪怕极端情况下缩得很小、肉眼难以
// 辨认单个字符也认了)——"字虽然小但没被图标挡住"好于"字号被强行拉大但被图标挡住看不清
// 是哪张牌",这是这次改动权衡后的选择。
let _fitCanvas = null;
const CARD_TITLE_FONT_FAMILY = '"Songti SC","Noto Serif SC",ui-serif,"STSong",serif'; // 和 body 的 font-family 保持一致(见 index.html);canvas 不支持"inherit",必须传具体字体栈
function fitFontSize(text, maxWidth, maxFontSize, fontWeight, fontFamily){
  if(!_fitCanvas) _fitCanvas = document.createElement('canvas');
  const ctx = _fitCanvas.getContext('2d');
  ctx.font = (fontWeight||700)+' '+maxFontSize+'px '+fontFamily;
  const width = ctx.measureText(text).width;
  if(width<=maxWidth) return maxFontSize;
  const scaled = maxFontSize * (maxWidth/width) * 0.96; // 0.96留安全余量,避免刚好卡在边缘
  return scaled; // 不设下限——保证塞进maxWidth是这个函数唯一的承诺,见上方注释
}
// cardMetricsForViewport: 手牌卡片在当前视口宽度下的尺寸(卡片宽度/--badge值/标题栏
// 最大字号)——和 index.html 里 .card 基础规则+两个响应式断点(max-width:640px/480px)
// 的实际数值保持同步(方案B:不动态读DOM,直接按视口宽度分档传入固定值,更简单,足以
// 达成"不用再按牌名字数手动调整"这个核心目标;如果以后改动了那三个断点的卡片宽度或
// --badge/标题栏字号,这里要跟着改)。
function cardMetricsForViewport(){
  const w = window.innerWidth;
  if(w<=480) return { cardWidth:46, badge:14, maxTitleFont:10 };
  if(w<=640) return { cardWidth:50, badge:16, maxTitleFont:11 };
  return { cardWidth:64, badge:20, maxTitleFont:14 };
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
