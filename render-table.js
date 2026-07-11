// render-table.js — 中央出牌区展示层,从 render.js 拆分出来(纯重构第三步,行为零变化)。
// tableCardFaceHtml/renderTableCard 原样剪切,函数体逐字未改(含飞牌动画那段对代码顺序
// 极敏感的"同步设起点->强制回流->同步设终点"写法,详见 CLAUDE.md)。cardImageSrc/
// cardImgError/CARD_FALLBACK_EXTS/getPlayerDisplayLabel 等被 renderHand 等其它渲染
// 逻辑共用的函数仍留在 render.js,这里按全局作用域直接调用它们。


// renderTableCard: 中央出牌区(feature/table-ui 第2步)+ 出牌方/目标座位高亮(第3步)。复用
// markCardSound 同一批调用点写入的 g.tableCard={name,seq,seat,card,targets}——seq 和
// g.lastCardSound 永远同步递增(同一次 markCardSound 调用里一起写),这里按 seq 去重(和
// maybePlayCardSound 同款写法,不是比较牌名文本)。seat/card/targets 都是可选展示信息:
// 调用点只有能安全拿到的才传,没有 seat 就整体不落座位名/不高亮出牌方,没有 card 就不显示
// 花色点数,没有 targets 就不高亮任何目标座位——不强行拼凑数据,退化成只显示牌名。
// tableCardFaceHtml: 中央出牌区/交换展示共用的牌面结构——和手牌同一套图片素材(cardImageSrc)+
// 同一套失败降级(cardImgError/CARD_FALLBACK_EXTS),只是尺寸更小、没有手牌那套按视口自适应
// 字号的复杂逻辑(中央区文字量小、固定尺寸足够,不需要那么精细)。card 为空时返回空字符串。
function tableCardFaceHtml(card){
  if(!card) return '';
  const imgSrc = cardImageSrc(card.name);
  const imgTag = imgSrc ? '<img class="card-art" src="'+imgSrc+'" onerror="cardImgError(this)" alt="">' : '';
  const cornerText = cardFace(card)||'';
  return '<div class="card '+(imgSrc?'':'no-art')+' table-card-mini">'
    + '<div class="card-art-box">'+imgTag+'</div>'
    + '<div class="corner">'+cornerText+'</div>'
    + '</div>';
}
let lastShownTableCardSeq = undefined;
function renderTableCard(g){
  const el = document.getElementById('tableCard');
  if(!el) return;
  // 交换进行中(南蛮入侵/万箭齐发的多目标应战、或决斗的连续出杀):持续显示这个数组里的每一张牌,
  // 不走下面的单槽位 seq 去重/淡入淡出——只要 g.exchangeCards 非空就一直渲染、不设定时器清除,
  // 交给 game.js 在动作真正结束时(aoeAdvance收尾/duelResponse分出胜负)清空数组来"结束显示"。
  if(Array.isArray(g.exchangeCards) && g.exchangeCards.length>0){
    el.classList.add('exchange-mode');
    el.innerHTML = g.exchangeCards.map(entry=>{
      const w = (Number.isInteger(entry.seat) && g.players[entry.seat]) ? getPlayerDisplayLabel(g, g.players[entry.seat]) : '';
      const f = entry.card ? tableCardFaceHtml(entry.card) : '';
      return '<div class="exchange-card">'
        + (w ? '<div class="table-card-who">'+escapeHtml(w)+'</div>' : '')
        + '<div class="table-card-name">'+escapeHtml(entry.name)+'</div>'
        + f
        + '</div>';
    }).join('');
    return; // 交换展示接管了这次渲染,不再往下走单槽位逻辑
  }
  el.classList.remove('exchange-mode');
  if(!g.tableCard){ return; } // 房间刚创建/旧存档没有这个字段:不渲染,保持空
  if(lastShownTableCardSeq===undefined){ lastShownTableCardSeq=g.tableCard.seq; return; } // 首次进入房间/刷新页面,不补放历史
  if(g.tableCard.seq===lastShownTableCardSeq) return;
  lastShownTableCardSeq = g.tableCard.seq;
  const { name, seat, card } = g.tableCard;
  const who = (Number.isInteger(seat) && g.players[seat]) ? getPlayerDisplayLabel(g, g.players[seat]) : '';
  const faceHtml = card ? tableCardFaceHtml(card) : ''; // 复用手牌同款"插画图+花色角标"结构,不再只显示文字角标
  el.innerHTML = (who ? '<div class="table-card-who">'+escapeHtml(who)+'</div>' : '')
    + '<div class="table-card-name">'+escapeHtml(name)+'</div>'
    + faceHtml;
  // 和 #logToast 同款"淡入-停留-淡出"手法:先移除 .show 强制回流,再加回去,保证 CSS 动画
  // 每次都从头重新播放(而不是因为 class 已经是 show 而被浏览器判定"没有变化"、动画不重触发)。
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  // 座位高亮(feature/table-ui 第3步):出牌方 + 目标座位短暂加一个高亮 class,和中央出牌区
  // 同一节奏淡出——复用 CSS transition,不额外起新的 setTimeout 链,靠下一次 seq 变化时清除
  // 上一轮残留的高亮(不需要单独的计时器让它消失,新事件到来/离开页面前它就一直保持,视觉上
  // 配合 outline 的 transition 从有到无是瞬间的,但因为下一次事件通常不会立刻到来,实际观感
  // 和中央出牌区的淡出节奏一致;只读 g.tableCard,不新增判定逻辑,不碰 .active/.dead/.me)。
  document.querySelectorAll('.seat.table-actor,.seat.table-target').forEach(elx=>{
    elx.classList.remove('table-actor','table-target');
  });
  if(Number.isInteger(seat)){
    const actorEl = document.querySelector('.seat[data-seat="'+seat+'"]');
    if(actorEl) actorEl.classList.add('table-actor');
  }
  if(Array.isArray(g.tableCard.targets)){
    g.tableCard.targets.forEach(t=>{
      const targetEl = document.querySelector('.seat[data-seat="'+t+'"]');
      if(targetEl) targetEl.classList.add('table-target');
    });
  }
  // 飞牌动画(feature/table-ui 第4步):出牌方座位 -> 中央 #tableCard。用 getBoundingClientRect
  // 算两者的屏幕坐标差,生成一个绝对定位的临时元素做 transform 位移动画,动画结束后移除,
  // 不常驻 DOM。任何一步拿不到有效坐标就静默跳过——这是纯装饰层,绝不能因为它出错而影响
  // 上面已经完成的文字展示/座位高亮(那两块是本函数的主体,必须始终生效)。只做"出牌方->中央"
  // 这一段,不做"中央->目标"的连线(运行时坐标计算风险最高的部分,留给下一步,可复用这里的
  // getBoundingClientRect 写法)。
  const existingFly = document.getElementById('flyingCard');
  if(existingFly) existingFly.remove(); // 连续快速出牌:先清掉上一张还没飞完的,不叠加多个
  if(Number.isInteger(seat)){
    const actorEl = document.querySelector('.seat[data-seat="'+seat+'"]');
    const centerEl = document.getElementById('tableCard');
    if(actorEl && centerEl){
      try{
        const fromRect = actorEl.getBoundingClientRect();
        const toRect = centerEl.getBoundingClientRect();
        const seatsEl = document.getElementById('seats');
        const containerRect = seatsEl.getBoundingClientRect();
        // 坐标都换算成相对 #seats 容器的偏移,配合 #seats 的 position:relative 定位飞牌元素,
        // 不用 fixed(fixed 相对视口,#seats 内部滚动/布局变化时容易和真实座位位置脱节)。
        const fromX = fromRect.left - containerRect.left + fromRect.width/2;
        const fromY = fromRect.top - containerRect.top + fromRect.height/2;
        const toX = toRect.left - containerRect.left + toRect.width/2;
        const toY = toRect.top - containerRect.top + toRect.height/2;
        const fly = document.createElement('div');
        fly.id = 'flyingCard';
        fly.className = 'flying-card';
        fly.textContent = name; // 飞行途中只显示牌名文字,足够传达"这张牌在飞",不需要完整牌面渲染
        fly.style.left = fromX + 'px';
        fly.style.top = fromY + 'px';
        seatsEl.appendChild(fly);
        // 强制回流后再设置终点坐标,触发 CSS transition 位移(而不是直接跳到终点)。
        void fly.offsetWidth;
        fly.style.left = toX + 'px';
        fly.style.top = toY + 'px';
        fly.style.opacity = '0';
        setTimeout(()=>{ if(fly.parentNode) fly.remove(); }, 650); // 略长于 CSS transition 时长,确保动画播完再摘除
      }catch(e){
        // 坐标计算出任何异常(理论上不该发生,但飞牌是装饰层,宁可静默跳过也不能抛出影响主渲染)
        const stray = document.getElementById('flyingCard');
        if(stray) stray.remove();
      }
    }
  }
  // 目标连线(feature/table-ui 第5步):#tableCard 中央 -> 每个目标座位。和上面飞牌动画同一套
  // 坐标获取/清理/异常处理写法(相对 #seats 容器换算偏移、try/catch 静默降级、连续触发先清掉
  // 上一批、动画结束后彻底移除不常驻 DOM)——只在 targets 非空数组时触发,每个目标一条独立的线。
  // 用 SVG line 元素画线(比 CSS border/transform 拼线更简单可靠,不需要算角度)。
  const existingLines = document.getElementById('targetLines');
  if(existingLines) existingLines.remove(); // 连续快速出牌:先清掉上一批还没淡出的连线
  if(Array.isArray(g.tableCard.targets) && g.tableCard.targets.length>0){
    const centerEl = document.getElementById('tableCard');
    const seatsEl = document.getElementById('seats');
    if(centerEl && seatsEl){
      try{
        const containerRect = seatsEl.getBoundingClientRect();
        const toRect = centerEl.getBoundingClientRect();
        const fromX = toRect.left - containerRect.left + toRect.width/2;
        const fromY = toRect.top - containerRect.top + toRect.height/2;
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.id = 'targetLines';
        svg.setAttribute('class', 'target-lines');
        svg.setAttribute('width', containerRect.width);
        svg.setAttribute('height', containerRect.height);
        let anyLine = false;
        g.tableCard.targets.forEach(t=>{
          const targetEl = document.querySelector('.seat[data-seat="'+t+'"]');
          if(!targetEl) return;
          const tRect = targetEl.getBoundingClientRect();
          const tx = tRect.left - containerRect.left + tRect.width/2;
          const ty = tRect.top - containerRect.top + tRect.height/2;
          const line = document.createElementNS(svgNS, 'line');
          line.setAttribute('x1', fromX); line.setAttribute('y1', fromY);
          line.setAttribute('x2', tx); line.setAttribute('y2', ty);
          line.setAttribute('class', 'target-line');
          svg.appendChild(line);
          anyLine = true;
        });
        if(anyLine){
          seatsEl.appendChild(svg);
          setTimeout(()=>{ if(svg.parentNode) svg.remove(); }, 2600); // 和 #tableCard 淡出节奏(2.6s)一致
        }
      }catch(e){
        // 坐标计算出任何异常(理论上不该发生,但连线是装饰层,宁可静默跳过也不能抛出影响主渲染)
        const stray = document.getElementById('targetLines');
        if(stray) stray.remove();
      }
    }
  }
}
