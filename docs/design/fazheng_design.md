# 法正 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `fazheng` |
| **武将名称** | 法正 |
| **势力** | 蜀 |
| **性别** | male |
| **体力上限** | 3 |
| **技能** | 恩怨 / 眩惑 |

---

## 二、技能说明

### 恩怨（锁定技）
**时机**：持续生效

**效果**：
1. 当其他角色令你回复1点体力后，其摸一张牌
2. 当你受到其他角色对你造成的伤害后，其选择一项：
   - 1. 交给你一张♥️手牌
   - 2. 失去1点体力

**设计要点**：
- 属于**锁定技**，无需玩家操作，自动触发
- 分为两个独立的触发条件：
  - 体力回复触发：在体力回复后的处理函数中集成
  - 伤害受到触发：在伤害结算后的处理函数中集成
- 需要判断触发源是**其他角色**（非自己）
- 伤害触发后，目标角色需要进行选择（交♥️手牌或失去1点体力）
- 体力回复触发直接执行摸牌，无需选择
- 心心手牌的判断：通过 `card.suit === '♥'` 判断

### 眩惑
**时机**：出牌阶段限一次

**效果**：
1. 你可以交给一名其他角色一张♥️手牌
2. 然后你获得该角色的一张牌
3. 并将此牌交给另一名其他角色

**设计要点**：
- 属于**出牌阶段主动技能**，每回合限一次
- 需要 `g.huanhuoUsed` 标志位控制使用次数
- 流程分为多个步骤：
  - 选择目标角色（交♥️手牌的目标）
  - 选择要交出的♥️手牌
  - 从目标角色手牌中随机/选择获得一张牌
  - 选择第二个目标角色（交给另一名角色）
- 需要验证：交出的牌必须是♥️手牌
- 需要验证：目标角色有手牌可获得
- 需要验证：第二个目标角色不能是自己

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
fazheng: {
  id: 'fazheng',
  name: '法正',
  gender: 'male',
  maxHp: 3,
  skill: '恩怨/眩惑',
  desc: '恩怨:锁定技,①当其他角色令你回复1点体力后,其摸一张牌;②当你受到其他角色对你造成的伤害后,其选择一项:1.交给你一张♥手牌;2.失去1点体力。眩惑:出牌阶段限一次,你可以交给一名其他角色一张♥手牌,然后你获得该角色的一张牌,并将此牌交给另一名其他角色。',
  caps: { enyuan: true, huanhuo: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 法正【眩惑】:回合内使用标记
if(typeof g.huanhuoUsed!=='boolean') g.huanhuoUsed=false;

// 法正【恩怨】伤害后选择阶段: pending 应包含 type、sourceSeat（受伤的法正）、damagerSeat（造成伤害的角色）
if(g.pending && g.pending.type==='enyuanChoose'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.damagerSeat!=='number' || !g.players[d.damagerSeat] || !g.players[d.damagerSeat].alive){
    g.pending = null;
    g.phase = 'play';
  }
}

// 法正【眩惑】选择目标阶段
if(g.pending && g.pending.type==='huanhuoPick'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     !Array.isArray(d.heartCards) || d.heartCards.length===0 ||
     !Array.isArray(d.candidates) || d.candidates.length===0){
    g.pending = null;
    g.phase = 'play';
  }
}

// 法正【眩惑】选择获得的牌阶段
if(g.pending && g.pending.type==='huanhuoPickCard'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
     !Array.isArray(d.targetHand) || d.targetHand.length===0 ||
     !Array.isArray(d.candidates) || d.candidates.length===0){
    g.pending = null;
    g.phase = 'play';
  }
}

// 法正【眩惑】选择第二个目标阶段
if(g.pending && g.pending.type==='huanhuoPickSecond'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.transferCard!=='object' || !d.transferCard ||
     !Array.isArray(d.candidates) || d.candidates.length===0){
    g.pending = null;
    g.phase = 'play';
  }
}
```

在 `startTurn` 函数中添加重置：
```javascript
g.huanhuoUsed = false;  // 在其他标志位重置的同一行
```

---

## 四、技能实现

### 恩怨实现

**集成点1**：体力回复后的处理函数（如 `healPlayer` 或 `recoverHp`）

```javascript
// 在体力回复函数中添加恩怨触发检查（体力回复部分）
function recoverHp(g, targetSeat, sourceSeat, amount) {
  tx(g => {
    const target = g.players[targetSeat];
    const source = g.players[sourceSeat];
    
    if (!target || !target.alive) return g;
    
    // 执行体力回复
    const originalHp = target.hp || 0;
    target.hp = Math.min(target.maxHp, (target.hp || 0) + amount);
    const actualRecovered = (target.hp || 0) - originalHp;
    
    // 恩怨触发：当其他角色令你回复1点体力后，其摸一张牌
    if (hasCap(target, 'enyuan') && actualRecovered > 0 && sourceSeat !== targetSeat) {
      // 确保回复的是1点体力（每次回复1点都触发）
      for (let i = 0; i < actualRecovered; i++) {
        // 摸一张牌给source
        if (source && source.alive) {
          drawN(g, sourceSeat, 1);
          g.log = pushLog(g.log, `${target.name} 回复1点体力,${source.name} 发动【恩怨】效果,摸一张牌`);
        }
      }
    }
    
    return g;
  });
}
```

**集成点2**：伤害结算后的处理函数（如 `resolveDamageEffect` 或 `damagePlayer`）

```javascript
// 在伤害结算函数中添加恩怨触发检查（伤害部分）
function damagePlayer(g, targetSeat, sourceSeat, damage) {
  tx(g => {
    const target = g.players[targetSeat];
    const source = g.players[sourceSeat];
    
    if (!target || !target.alive || !source || !source.alive) return g;
    
    // 执行伤害扣减
    target.hp = Math.max(0, (target.hp || target.maxHp || 0) - damage);
    
    // 恩怨触发：当你受到其他角色对你造成的伤害后
    if (hasCap(target, 'enyuan') && sourceSeat !== targetSeat) {
      // 进入恩怨选择阶段
      g.pending = {
        type: 'enyuanChoose',
        sourceSeat: targetSeat,    // 法正
        damagerSeat: sourceSeat   // 造成伤害的角色
      };
      g.phase = 'enyuanChoose';
      g.log = pushLog(g.log, `${source.name} 对 ${target.name} 造成了${damage}点伤害,${source.name} 需要选择【恩怨】效果`);
      markSkillSound(g, '恩怨');
    }
    
    return g;
  });
}

// 恩怨选择处理函数
function triggerEnyuan() {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'enyuanChoose') return g;
    
    const damager = g.players[pending.damagerSeat];
    const source = g.players[pending.sourceSeat]; // 法正
    
    if (!damager || !damager.alive || !source || !source.alive) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 检查damager是否有♥手牌
    const heartCards = (damager.hand || []).filter(card => card.suit === '♥');
    
    if (heartCards.length > 0) {
      // 进入选择阶段：交♥手牌或失去1点体力
      g.pending = {
        type: 'enyuanChooseOption',
        sourceSeat: pending.sourceSeat,
        damagerSeat: pending.damagerSeat,
        heartCards: heartCards
      };
      g.phase = 'enyuanChooseOption';
      g.log = pushLog(g.log, `${damager.name} 需要选择：交一张♥手牌给${source.name}，或失去1点体力`);
    } else {
      // 没有♥手牌，只能选择失去1点体力
      damager.hp = Math.max(0, (damager.hp || 0) - 1);
      g.log = pushLog(g.log, `${damager.name} 没有♥手牌，发动【恩怨】效果，失去1点体力`);
      g.pending = null;
      g.phase = 'play';
    }
    
    return g;
  });
}

// 恩怨选项处理
function chooseEnyuanOption(option) {
  // option: 'giveCard' 或 'loseHp'
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'enyuanChooseOption') return g;
    
    const damager = g.players[pending.damagerSeat];
    const source = g.players[pending.sourceSeat]; // 法正
    
    if (!damager || !damager.alive || !source || !source.alive) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    if (option === 'giveCard') {
      // 选择交一张♥手牌
      // 进入选择♥手牌阶段
      g.pending = {
        type: 'enyuanGiveCard',
        sourceSeat: pending.sourceSeat,
        damagerSeat: pending.damagerSeat,
        heartCards: pending.heartCards
      };
      g.phase = 'enyuanGiveCard';
      g.log = pushLog(g.log, `${damager.name} 选择交一张♥手牌给${source.name}`);
    } else if (option === 'loseHp') {
      // 选择失去1点体力
      damager.hp = Math.max(0, (damager.hp || 0) - 1);
      g.log = pushLog(g.log, `${damager.name} 选择失去1点体力`);
      g.pending = null;
      g.phase = 'play';
    }
    
    return g;
  });
}

// 恩怨选择♥手牌处理
function giveEnyuanCard(cardIndex) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'enyuanGiveCard') return g;
    
    const damager = g.players[pending.damagerSeat];
    const source = g.players[pending.sourceSeat]; // 法正
    
    if (!damager || !damager.alive || !source || !source.alive) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    if (cardIndex < 0 || cardIndex >= pending.heartCards.length) {
      return g;
    }
    
    // 获取要交给的牌
    const card = pending.heartCards[cardIndex];
    
    // 从damager手牌中移除这张牌
    const hand = damager.hand || [];
    const idx = hand.findIndex(c => c.id === card.id);
    if (idx !== -1) {
      hand.splice(idx, 1);
    }
    
    // 添加到source手牌
    if (!source.hand) source.hand = [];
    source.hand.push(card);
    
    g.log = pushLog(g.log, `${damager.name} 交给 ${source.name} 一张♥手牌【${card.name}】`);
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}

// 取消恩怨
function cancelEnyuan() {
  tx(g => {
    if (g.pending && (g.pending.type === 'enyuanChoose' || g.pending.type === 'enyuanChooseOption' || g.pending.type === 'enyuanGiveCard') &&
        g.pending.damagerSeat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【恩怨】选择`);
    }
    return g;
  });
}
```

### 眩惑实现

**UI触发点**：`render-controls.js` 添加眩惑按钮

```javascript
// 在 renderControls 中添加眩惑选择逻辑
function renderControls(g, me) {
  // ... 现有代码 ...

  if (hasCap(me, 'huanhuo') && !g.huanhuoUsed && g.phase === 'play' && g.turn === mySeat) {
    // 检查是否有♥手牌
    const heartCards = (me.hand || []).filter(card => card.suit === '♥');
    if (heartCards.length > 0) {
      ui.innerHTML += `
        <button onclick="startHuanhuo()" class="skill-btn" style="background: #4a90d9;">
          眩惑
        </button>
      `;
    }
  }
}

// 眩惑选择流程
let huanhuoTargetSeat = null;
let huanhuoCard = null;
let huanhuoGotCard = null;

function startHuanhuo() {
  huanhuoTargetSeat = null;
  huanhuoCard = null;
  huanhuoGotCard = null;
  
  // 获取当前玩家的♥手牌
  const me = g.players[mySeat];
  const heartCards = (me.hand || []).filter(card => card.suit === '♥');
  
  // 进入选择目标角色阶段
  g.pending = { 
    type: 'huanhuoPick', 
    sourceSeat: mySeat,
    heartCards: heartCards,
    candidates: []
  };
  
  // 计算可选目标（其他存活角色）
  for (let i = 0; i < g.players.length; i++) {
    if (i !== mySeat && g.players[i] && g.players[i].alive) {
      g.pending.candidates.push(i);
    }
  }
  
  g.log = pushLog(g.log, `${me.name} 发动【眩惑】,选择目标角色…`);
  render();
}

// 选择眩惑目标角色
function pickHuanhuoTarget(seat) {
  if (seat === mySeat) return;
  
  tx(g => {
    if (g.pending.type !== 'huanhuoPick') return g;
    
    const me = g.players[mySeat];
    const target = g.players[seat];
    
    if (!target || !target.alive) return g;
    if (!g.pending.candidates.includes(seat)) return g;
    
    // 存储目标
    huanhuoTargetSeat = seat;
    
    // 进入选择♥手牌阶段
    g.pending = {
      type: 'huanhuoPickCard',
      sourceSeat: mySeat,
      targetSeat: seat,
      heartCards: g.pending.heartCards,
      candidates: []
    };
    
    // 重新计算候选（其实就是♥手牌）
    g.pending.candidates = g.pending.heartCards.map((_, idx) => idx);
    
    g.log = pushLog(g.log, `${me.name} 选择 ${target.name} 作为目标,请选择一张♥手牌`);
    
    return g;
  });
}

// 选择要交出的♥手牌
function pickHuanhuoHeartCard(cardIndex) {
  tx(g => {
    if (g.pending.type !== 'huanhuoPickCard') return g;
    
    if (cardIndex < 0 || cardIndex >= g.pending.heartCards.length) return g;
    if (!g.pending.candidates.includes(cardIndex)) return g;
    
    const me = g.players[mySeat];
    const target = g.players[g.pending.targetSeat];
    
    // 获取选择的♥手牌
    huanhuoCard = g.pending.heartCards[cardIndex];
    
    // 从自己手牌中移除这张牌
    const hand = me.hand || [];
    const idx = hand.findIndex(c => c.id === huanhuoCard.id);
    if (idx !== -1) {
      hand.splice(idx, 1);
    }
    
    // 将这张牌交给目标角色
    if (!target.hand) target.hand = [];
    target.hand.push(huanhuoCard);
    
    // 检查目标角色是否有手牌可获得
    const targetHand = target.hand || [];
    if (targetHand.length === 0) {
      // 目标没有手牌，直接清理状态
      g.log = pushLog(g.log, `${target.name} 没有手牌，【眩惑】无法继续`);
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 进入选择要获得的牌阶段
    g.pending = {
      type: 'huanhuoPickGotCard',
      sourceSeat: mySeat,
      targetSeat: g.pending.targetSeat,
      targetHand: targetHand,
      candidates: targetHand.map((_, idx) => idx)
    };
    
    g.log = pushLog(g.log, `${me.name} 交给 ${target.name} 一张♥手牌,请选择要获得的牌`);
    
    return g;
  });
}

// 选择要获得的牌
function pickHuanhuoGotCard(cardIndex) {
  tx(g => {
    if (g.pending.type !== 'huanhuoPickGotCard') return g;
    
    if (cardIndex < 0 || cardIndex >= g.pending.targetHand.length) return g;
    if (!g.pending.candidates.includes(cardIndex)) return g;
    
    const me = g.players[mySeat];
    const target = g.players[g.pending.targetSeat];
    
    // 获取选择的牌
    huanhuoGotCard = g.pending.targetHand[cardIndex];
    
    // 从目标手牌中移除这张牌
    const targetHand = target.hand || [];
    const idx = targetHand.findIndex(c => c.id === huanhuoGotCard.id);
    if (idx !== -1) {
      targetHand.splice(idx, 1);
    }
    
    // 添加到自己手牌
    if (!me.hand) me.hand = [];
    me.hand.push(huanhuoGotCard);
    
    // 进入选择第二个目标阶段（交给另一名其他角色）
    g.pending = {
      type: 'huanhuoPickSecond',
      sourceSeat: mySeat,
      transferCard: huanhuoGotCard,
      candidates: []
    };
    
    // 计算第二个目标候选（不能是自己，也不能是第一个目标）
    for (let i = 0; i < g.players.length; i++) {
      if (i !== mySeat && i !== g.pending.targetSeat && g.players[i] && g.players[i].alive) {
        g.pending.candidates.push(i);
      }
    }
    
    g.log = pushLog(g.log, `${me.name} 获得了 ${target.name} 的一张牌,请选择要交给的角色`);
    
    return g;
  });
}

// 选择第二个目标角色（交给牌）
function pickHuanhuoSecondTarget(seat) {
  tx(g => {
    if (g.pending.type !== 'huanhuoPickSecond') return g;
    
    if (!g.pending.candidates.includes(seat)) return g;
    
    const me = g.players[mySeat];
    const secondTarget = g.players[seat];
    
    if (!secondTarget || !secondTarget.alive) return g;
    
    // 从自己手牌中移除获得的牌
    const hand = me.hand || [];
    const idx = hand.findIndex(c => c.id === g.pending.transferCard.id);
    if (idx !== -1) {
      hand.splice(idx, 1);
    }
    
    // 将牌交给第二个目标
    if (!secondTarget.hand) secondTarget.hand = [];
    secondTarget.hand.push(g.pending.transferCard);
    
    // 标记已使用眩惑
    g.huanhuoUsed = true;
    
    g.log = pushLog(g.log, `${me.name} 发动【眩惑】,交给 ${g.players[g.pending.targetSeat].name} 一张♥手牌,获得其一张牌后交给 ${secondTarget.name}`);
    markSkillSound(g, '眩惑');
    
    // 清理状态
    g.pending = null;
    g.phase = 'play';
    
    huanhuoTargetSeat = null;
    huanhuoCard = null;
    huanhuoGotCard = null;
    
    return g;
  });
}

// 取消眩惑
function cancelHuanhuo() {
  tx(g => {
    if (g.pending && (g.pending.type === 'huanhuoPick' || g.pending.type === 'huanhuoPickCard' || 
        g.pending.type === 'huanhuoPickGotCard' || g.pending.type === 'huanhuoPickSecond') &&
        g.pending.sourceSeat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【眩惑】`);
      
      huanhuoTargetSeat = null;
      huanhuoCard = null;
      huanhuoGotCard = null;
    }
    return g;
  });
}
```

---

## 五、渲染集成（render-controls.js）

### 恩怨 UI 集成

```javascript
// 在 renderControls 中添加恩怨相关状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 恩怨：伤害后的触发
  if (g.pending && g.pending.type === 'enyuanChoose' && g.pending.damagerSeat === seat) {
    const source = g.players[g.pending.sourceSeat];
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【恩怨】触发</h4>
        <p>${source.name} 受到你的伤害，你需要选择</p>
        <button onclick="triggerEnyuan()" class="skill-btn" style="background: #d4a762;">
          进行选择
        </button>
      </div>
    `;
    return;
  }

  // 恩怨：选择交♥手牌或失去体力
  if (g.pending && g.pending.type === 'enyuanChooseOption' && g.pending.damagerSeat === seat) {
    const source = g.players[g.pending.sourceSeat];
    const hasHeart = g.pending.heartCards.length > 0;
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【恩怨】选择</h4>
        <p>你需要选择：</p>
        <div class="options">
    `;
    
    if (hasHeart) {
      ui.innerHTML += `
        <button onclick="chooseEnyuanOption('giveCard')" class="skill-btn">
          交一张♥手牌给${source.name}
        </button>
      `;
    }
    
    ui.innerHTML += `
        <button onclick="chooseEnyuanOption('loseHp')" class="skill-btn">
          失去1点体力
        </button>
        </div>
        <button onclick="cancelEnyuan()" class="cancel-btn">取消</button>
      </div>
    `;
    return;
  }

  // 恩怨：选择要交的♥手牌
  if (g.pending && g.pending.type === 'enyuanGiveCard' && g.pending.damagerSeat === seat) {
    const source = g.players[g.pending.sourceSeat];
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【恩怨】选择♥手牌</h4>
        <p>选择要交给 ${source.name} 的一张♥手牌：</p>
        <div class="card-options">
    `;
    
    for (let i = 0; i < g.pending.heartCards.length; i++) {
      const card = g.pending.heartCards[i];
      ui.innerHTML += `
        <button onclick="giveEnyuanCard(${i})" class="card-btn">
          【${card.name}】
        </button>
      `;
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelEnyuan()" class="cancel-btn">取消</button>
      </div>
    `;
    return;
  }
}
```

### 眩惑 UI 集成

```javascript
// 在 renderControls 中添加眩惑相关状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 眩惑：选择第一个目标
  if (g.pending && g.pending.type === 'huanhuoPick' && g.pending.sourceSeat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【眩惑】选择目标</h4>
        <p>选择要交♥手牌的角色：</p>
        <div class="target-options">
    `;
    
    for (let i = 0; i < g.pending.candidates.length; i++) {
      const tSeat = g.pending.candidates[i];
      const target = g.players[tSeat];
      ui.innerHTML += `
        <button onclick="pickHuanhuoTarget(${tSeat})" class="target-btn">
          ${target.name}
        </button>
      `;
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelHuanhuo()" class="cancel-btn">取消</button>
      </div>
    `;
    return;
  }

  // 眩惑：选择要交的♥手牌
  if (g.pending && g.pending.type === 'huanhuoPickCard' && g.pending.sourceSeat === seat) {
    const target = g.players[g.pending.targetSeat];
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【眩惑】选择♥手牌</h4>
        <p>选择要交给 ${target.name} 的一张♥手牌：</p>
        <div class="card-options">
    `;
    
    for (let i = 0; i < g.pending.heartCards.length; i++) {
      const card = g.pending.heartCards[i];
      ui.innerHTML += `
        <button onclick="pickHuanhuoHeartCard(${i})" class="card-btn">
          【${card.name}】
        </button>
      `;
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelHuanhuo()" class="cancel-btn">取消</button>
      </div>
    `;
    return;
  }

  // 眩惑：选择要获得的牌
  if (g.pending && g.pending.type === 'huanhuoPickGotCard' && g.pending.sourceSeat === seat) {
    const target = g.players[g.pending.targetSeat];
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【眩惑】选择获得的牌</h4>
        <p>从 ${target.name} 手牌中选择一张获得：</p>
        <div class="card-options">
    `;
    
    for (let i = 0; i < g.pending.targetHand.length; i++) {
      const card = g.pending.targetHand[i];
      ui.innerHTML += `
        <button onclick="pickHuanhuoGotCard(${i})" class="card-btn">
          【${card.name}】
        </button>
      `;
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelHuanhuo()" class="cancel-btn">取消</button>
      </div>
    `;
    return;
  }

  // 眩惑：选择第二个目标
  if (g.pending && g.pending.type === 'huanhuoPickSecond' && g.pending.sourceSeat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【眩惑】选择交给的角色</h4>
        <p>选择要将获得的牌交给的角色：</p>
        <div class="target-options">
    `;
    
    for (let i = 0; i < g.pending.candidates.length; i++) {
      const tSeat = g.pending.candidates[i];
      const target = g.players[tSeat];
      ui.innerHTML += `
        <button onclick="pickHuanhuoSecondTarget(${tSeat})" class="target-btn">
          ${target.name}
        </button>
      `;
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelHuanhuo()" class="cancel-btn">取消</button>
      </div>
    `;
    return;
  }
}
```

---

## 六、音效标识

在 `markSkillSound` 中添加：
```javascript
const SKILL_SOUNDS = {
  // ... 现有技能 ...
  '恩怨': 'enyuan',
  '眩惑': 'huanhuo',
};
```

---

## 七、边界条件处理

### 恩怨

**体力回复部分**：
1. **自己回复自己的体力**：不触发（需要是其他角色令你回复）
2. **一次回复多于1点体力**：每回复1点体力，触发一次摸牌效果
3. **牌堆为空**：使用 `ensureDeck(g)` 确保有牌可摸
4. **目标角色已阵亡**：在触发前验证，阵亡则不触发
5. **同时回复多个角色的体力**：每个角色独立触发

**伤害部分**：
1. **自己对自己造成伤害**：不触发（需要是其他角色对你造成伤害）
2. **目标角色没有♥手牌**：直接失去1点体力
3. **目标角色没有手牌**：直接失去1点体力（因为无法交♥手牌）
4. **目标角色体力为1**：失去1点体力后进入濒死状态
5. **目标角色体力为0**：已经阵亡，不触发
6. **同时受到多点伤害**：每次伤害独立触发恩怨
7. **目标角色在选择阶段阵亡**：清理pending状态，回到出牌阶段
8. **多次触发恩怨**：每次伤害都独立触发，需要独立处理

### 眩惑

1. **场上不足2名其他角色**：按钮不显示（需要至少1个目标接收♥手牌，和1个不同的目标接收转交的牌）
2. **没有♥手牌**：按钮不显示
3. **目标角色没有手牌**：在选择获得牌阶段提示无法继续，取消技能
4. **第二个目标选择时没有合法目标**：检查候选列表，如无合法目标则取消技能
5. **自己作为第二个目标**：不允许选择自己
6. **第一个目标和第二个目标相同**：不允许，需要选择不同的角色
7. **技能发动过程中角色阵亡**：在每个步骤验证角色存活状态
8. **每回合多次点击**：仅第一次生效，使用 `g.huanhuoUsed` 标志位控制
9. **取消技能**：在任何步骤都可以取消，恢复原始状态

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **恩怨-体力回复** |
| 恩怨：其他角色令法正回复1点体力 | 该角色摸一张牌 |
| 恩怨：自己回复自己的体力 | 不触发恩怨 |
| 恩怨：同时回复2点体力 | 触发2次摸牌效果 |
| **恩怨-伤害** |
| 恩怨：法正受到其他角色1点伤害，对方有♥手牌 | 对方选择交♥手牌或失去1点体力 |
| 恩怨：法正受到其他角色1点伤害，对方没有♥手牌 | 对方直接失去1点体力 |
| 恩怨：法正受到其他角色1点伤害，对方体力为1 | 对方失去1点体力后进入濒死 |
| 恩怨：法正受到其他角色1点伤害，对方选择交♥手牌 | 对方交一张♥手牌给法正 |
| 恩怨：法正受到其他角色1点伤害，对方选择失去体力 | 对方失去1点体力 |
| 恩怨：法正受到自己造成的伤害 | 不触发恩怨 |
| **眩惑** |
| 眩惑：法正有♥手牌，场上有2个其他角色 | 可以发动眩惑 |
| 眩惑：法正没有♥手牌 | 按钮不显示 |
| 眩惑：场上只有1名其他角色 | 按钮不显示（需要至少2个其他角色） |
| 眩惑：选择目标后，目标有手牌 | 可以选择要获得的牌 |
| 眩惑：选择目标后，目标没有手牌 | 提示无法继续，取消技能 |
| 眩惑：获得牌后，有合法第二目标 | 可以选择交给的角色 |
| 眩惑：获得牌后，没有合法第二目标 | 提示无法继续，取消技能 |
| 眩惑：每回合多次点击 | 仅第一次生效 |
| 眩惑：取消技能 | 任何步骤都可以取消，状态恢复 |

---

## 九、实现优先级

1. **恩怨-体力回复部分优先**：锁定技，仅需要在体力回复函数中集成，实现简单
2. **恩怨-伤害部分优先**：需要处理选择逻辑，稍微复杂
3. **眩惑优先**：需要多步选择流程，实现复杂度较高
4. **UI集成优先**：恩怨和眩惑的选择界面渲染
5. **边界处理优先**：特殊情况的处理和验证
6. **音效集成**：最后添加音效标识

---

## 十、集成要点

### 与现有系统的集成

1. **体力回复系统**：
   - 复用现有的 `recoverHp` 或 `healPlayer` 函数
   - 在体力回复后添加恩怨触发检查

2. **伤害结算系统**：
   - 复用现有的 `damagePlayer` 或 `resolveDamageEffect` 函数
   - 在伤害结算后添加恩怨触发检查

3. **出牌阶段系统**：
   - 复用现有的出牌阶段逻辑
   - 在 `renderControls` 中添加眩惑按钮

4. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程
   - 使用 `g.pending` 存储中间状态

5. **选择系统**：
   - 复用现有的 `isSeatClickable` 等函数
   - 为不同的选择阶段提供适当的UI

### 需要修改的文件

1. **data.js**：添加法正武将定义
2. **game.js**：
   - `normalize()`：添加恩怨和眩惑状态字段防御
   - `startTurn()`：添加眩惑使用标志位重置
   - `recoverHp()` 或 `healPlayer()`：集成恩怨体力回复触发
   - `damagePlayer()` 或 `resolveDamageEffect()`：集成恩怨伤害触发
3. **skills.js**：添加恩怨和眩惑技能辅助函数
4. **render-controls.js**：添加恩怨和眩惑UI界面
5. **render.js**：可能需要添加状态显示

---

## 十一、流程图

### 恩怨完整流程

**体力回复部分**：
```
其他角色令法正回复体力
    ↓
检查是否有恩怨技能
    ↓
是：检查是否是其他角色令法正回复
    ↓
是：执行摸牌（每回复1点体力，摸1张牌）
    ↓
结束
```

**伤害部分**：
```
法正受到其他角色的伤害
    ↓
检查是否有恩怨技能
    ↓
是：进入恩怨选择阶段
    ↓
检查造成伤害的角色是否存活
    ↓
检查其是否有♥手牌
    ↓
有：选择交♥手牌或失去1点体力
    ↓
选择交♥手牌：选择一张♥手牌交给法正
    ↓
或选择失去1点体力
    ↓
清理状态，回到出牌阶段
```

### 眩惑完整流程
```
出牌阶段
    ↓
检查是否有恩怨技能且未使用过
    ↓
检查是否有♥手牌
    ↓
检查场上是否有至少2个其他角色
    ↓
是：可以发动眩惑
    ↓
选择第一个目标角色
    ↓
选择要交出的♥手牌
    ↓
将♥手牌交给第一个目标
    ↓
检查第一个目标是否有手牌
    ↓
有：选择要获得的牌
    ↓
获得该牌
    ↓
选择第二个目标角色（不能是自己和第一个目标）
    ↓
将获得的牌交给第二个目标
    ↓
标记眩惑已使用
    ↓
清理状态，回到出牌阶段
```

---

## 十二、特殊说明

### 关于恩怨的触发时机

恩怨的触发分为两个独立的部分：

1. **体力回复部分**：当**其他角色**令法正回复1点体力后，该角色摸一张牌
   - 必须是**其他角色**令法正回复（非自己）
   - 每回复**1点体力**触发一次，如果一次回复多点，则触发多次
   - 直接执行摸牌，无需玩家操作

2. **伤害部分**：当法正受到**其他角色**对自己造成的伤害后
   - 必须是**其他角色**对法正造成伤害（非自己）
   - 每次受到伤害都会触发，即使是多点伤害
   - 造成伤害的角色需要**选择**：交一张♥手牌给法正，或者失去1点体力
   - 如果该角色没有♥手牌，则直接失去1点体力

### 关于眩惑的流程

眩惑是一个**多步骤**的技能，流程如下：

1. **选择目标**：选择一名其他角色作为交♥手牌的对象
2. **交出♥手牌**：从自己的手牌中选择一张♥手牌交给该目标
3. **获得一张牌**：从该目标的手牌中选择/随机获得一张牌
4. **交给另一名角色**：将获得的牌交给另一名其他角色（不能是自己）

注意：
- 每回合限使用一次
- 需要至少2名其他存活角色（一个接收♥手牌，一个接收转交的牌）
- 需要自己有♥手牌
- 目标角色需要有手牌（否则无法获得牌）

### 关于♥手牌的判断

通过 `card.suit === '♥'` 来判断是否为红桃（♥）手牌。

---

## 十三、修正记录

*文档状态：设计中*
*创建时间：2026-07-13*
*负责人：Mistral Vibe*

### 设计说明
- **武将定位**：法正作为蜀国的文官武将，技能设计体现其"恩怨分明"和"挑拨离间"的特点
- **恩怨**：锁定技，增加法正的生存能力和场控能力
- **眩惑**：主动技能，通过牌的流动实现控制效果

### 待实装项
- [ ] data.js: 添加法正武将定义
- [ ] game.js: 状态字段扩展和回合重置
- [ ] game.js: 恩怨体力回复触发集成
- [ ] game.js: 恩怨伤害触发集成
- [ ] skills.js: 恩怨和眩惑技能函数
- [ ] render-controls.js: 恩怨和眩惑UI界面
- [ ] 音效文件：需要添加assets/audio/enyuan.mp3和assets/audio/huanhuo.mp3

### 待优化项
- 收集更多测试场景
- 优化多步骤选择的用户体验
- 考虑AI决策逻辑的集成
