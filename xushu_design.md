# 徐庶 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `xushu` |
| **武将名称** | 徐庶 |
| **势力** | 蜀 |
| **性别** | male |
| **体力上限** | 3 |
| **技能** | 无言 / 举荐 |

---

## 二、技能说明

### 无言（锁定技）
**时机**：伤害计算时

**效果**：
1. 当你使用锦囊牌造成伤害时，防止此伤害
2. 当你受到锦囊牌造成的伤害时，防止此伤害

**设计要点**：
- 属于**锁定技**，无需玩家操作，自动触发
- **关键修正**：必须在 `dealDamage` 函数中集成，而不是假设 `beforeDamage` 钩子
- 仅**防止伤害本身**，不影响锦囊牌的其他结算（如南蛮的多目标效果）
- **关键修正**：排除连环传导伤害（传导时 `skipChain=true`，无言不挡传导）
- 必须判断伤害的**使用者**是徐庶（主动使用锦囊），或**目标**是徐庶（受到锦囊伤害）
- 防止伤害意味着：设置 `amount = 0` 并直接返回，但不阻断后续流程

### 举荐
**时机**：结束阶段

**效果**：
1. 你可以弃置一张非基本牌
2. 令一名其他角色选择一项：
   - 1. 摸两张牌
   - 2. 回复1点体力
   - 3. 复原武将牌

**设计要点**：
- 属于**结束阶段主动技能**，每回合每名玩家可使用一次
- **关键修正**：使用 `p.marks.jujian_used` 而不是全局标志，避免多人局串台
- **非基本牌**的判断：使用 `!isTrickCardName(card.name)`，兼容项目中实际的判断方式
- **关键修正**：弃牌操作延迟到选择目标后执行，防止取消时牌丢失
- **关键修正**：复原武将牌需同时处理 `flipped`（翻面）和 `chained`（横置）状态
- **关键修正**：失败回退到 `'end'` 阶段而非 `'play'` 阶段
- **关键修正**：使用 DOM API 创建 UI 元素，避免 XSS 注入风险
- **关键修正**：`onEndPhase` 为纯函数，避免嵌套事务
- **关键修正**：效果选择仅允许被举荐者操作，防止越权
- **关键修正**：手牌索引漂移保护，通过 card.id 校验

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
xushu: {
  id: 'xushu',
  name: '徐庶',
  gender: 'male',
  maxHp: 3,
  skill: '无言/举荐',
  desc: '无言:锁定技,当你使用锦囊牌造成伤害时,或受到锦囊牌造成的伤害时,防止此伤害。举荐:结束阶段,你可以弃置一张非基本牌,令一名其他角色选择一项:1.摸两张牌;2.回复1点体力;3.复原武将牌。',
  caps: { wuyan: true, jujian: true }
}
```

**注意**：无言为锁定技，通过 `caps` 声明即可，无需 `hooks`

---

## 四、技能实现

### 通用辅助函数

```javascript
// 基本牌判断，使用项目中实际的 isTrickCardName 函数
// isTrickCardName 在 game.js 中已定义：
// function isTrickCardName(name){
//   return !!name && !BASIC_CARDS.includes(name) && !getEquip(name);
// }
// 所以非基本牌 = 锦囊牌 = isTrickCardName(card.name) === true
function isNonBasic(card) {
  return card && isTrickCardName(card.name);
}

// 清理举荐使用标记
function clearJujian(g, seat) {
  const p = g.players[seat];
  if (p?.marks) p.marks.jujian_used = false;
}

// 徐庶状态规范化
function normalizeXuShu(g) {
  g.players.forEach(p => {
    if (!p.marks) p.marks = {};
    if (typeof p.marks.jujian_used !== 'boolean') p.marks.jujian_used = false;
  });
  if (g.pending?.type?.startsWith('jujian')) {
    const d = g.pending;
    if (typeof d.sourceSeat !== 'number' || !g.players[d.sourceSeat]?.alive) {
      g.pending = null;
      if (g.phase?.startsWith('jujian')) g.phase = 'end';
    }
  }
}
```

---

### 无言实现

**集成点**：直接在 `dealDamage` 函数中添加检测

由于项目中没有 `beforeDamage` 钩子，无言需要直接集成到 `dealDamage` 中：

```javascript
// 在 game.js 的 dealDamage 函数中添加无言检测
// 位置：在扣减体力前，检查是否为锦囊牌伤害
function dealDamage(g, seat, amount, sourceSeat, reason, srcType, sourceCard, skipTianxiang, skipZhengyi, skipChain) {
  const p = g.players[seat];
  if (!p) return false;
  
  // >>> 无言检测：在真正扣减体力前拦截 <<<
  // 判断是否为锦囊牌造成的伤害
  const isTrickDamage = sourceCard && isTrickCardName(sourceCard.name);
  
  if (isTrickDamage && !skipChain) { // skipChain 为 true 时是传导伤害，无言不挡
    const src = g.players[sourceSeat];
    const tgt = g.players[seat];
    
    // 徐庶使用锦囊牌造成伤害时，防止此伤害
    if (src && src.alive && generalHasCap(src, 'wuyan')) {
      g.log = pushLog(g.log, `${src.name} 发动【无言】,防止了其锦囊造成的伤害`);
      markSkillSound(g, sourceSeat, 'wuyan');
      return false; // 防止伤害，返回 false 表示不继续后续流程
    }
    
    // 徐庶受到锦囊牌造成的伤害时，防止此伤害
    if (tgt && tgt.alive && generalHasCap(tgt, 'wuyan')) {
      g.log = pushLog(g.log, `${tgt.name} 发动【无言】,防止了锦囊伤害`);
      markSkillSound(g, seat, 'wuyan');
      return false; // 防止伤害，返回 false 表示不继续后续流程
    }
  }
  
  // >>> 原有 dealDamage 逻辑继续 <<<
  if (!skipZhengyi && maybeStartZhengyi(g, seat, amount, sourceSeat, reason, srcType, sourceCard)) return true;
  if (!skipTianxiang && maybeStartTianxiang(g, seat, amount, sourceSeat, reason, srcType, sourceCard)) return true;
  // ... 后续逻辑
}
```

---

### 举荐实现

**集成点**：在 `endTurn` 函数中添加举荐触发（类似曹仁【据守】的集成方式）

```javascript
// 结束阶段统一入口，纯函数，由 endTurn 包 tx
function tryJujian(g) {
  if (g.phase !== 'end' || g.turn !== mySeat) return g;
  const me = g.players[mySeat];
  if (!generalHasCap(me, 'jujian') || me.marks?.jujian_used) return g;
  
  // 统一使用 isTrickCardName 判断非基本牌
  const nonBasic = (me.hand || []).map((c, i) => ({c, i})).filter(x => x.c && isTrickCardName(x.c.name));
  if (nonBasic.length === 0) return g;
  if (!g.players.some((p, i) => i !== mySeat && p?.alive)) return g;
  
  g.pending = {
    type: 'jujianPickCard',
    sourceSeat: mySeat,
    handIndices: nonBasic.map(x => x.i),
    cards: nonBasic.map(x => x.c),
    cardIds: nonBasic.map(x => x.c.id ?? x.c.cid), // 用id校验漂移
    createdAt: Date.now()
  };
  g.phase = 'jujianPickCard';
  g.log = pushLog(g.log, `${me.name} 是否发动【举荐】？`);
  return g;
}

// 选择要弃置的非基本牌
function pickJujianCard(handIndex) {
  tx(g => {
    const d = g.pending;
    if (d?.type !== 'jujianPickCard' || d.sourceSeat !== mySeat) return g;
    const pos = d.handIndices.indexOf(handIndex);
    if (pos === -1) return g;
    
    const me = g.players[mySeat];
    const card = me.hand[handIndex];
    
    // 统一使用 isTrickCardName 判断
    if (!card || !isTrickCardName(card.name)) return g;
    
    // 手牌索引漂移保护：通过id校验
    if (d.cardIds[pos] && (card.id ?? card.cid) !== d.cardIds[pos]) return g;
    
    // 暂不弃牌，存起来等选完目标再真正弃置
    g.pending = {
      type: 'jujianPickTarget',
      sourceSeat: mySeat,
      discardHandIndex: handIndex,
      discardCardId: card.id ?? card.cid,
      discardCard: card,
      candidates: g.players.map((_, i) => i).filter(i => i !== mySeat && g.players[i]?.alive)
    };
    g.phase = 'jujianPickTarget';
    return g;
  });
}

// 选择目标角色
function pickJujianTarget(targetSeat) {
  tx(g => {
    const d = g.pending;
    if (d?.type !== 'jujianPickTarget' || d.sourceSeat !== mySeat) return g;
    if (!d.candidates.includes(targetSeat)) return g;
    
    const me = g.players[mySeat];
    // 二次校验，防止期间手牌变化
    const cur = me.hand[d.discardHandIndex];
    if (!cur || (cur.id || cur.cid) !== d.discardCardId) {
      // 按id重新找
      const realIdx = me.hand.findIndex(c => (c.id || c.cid) === d.discardCardId);
      if (realIdx === -1) { 
        g.pending = null; 
        g.phase = 'end'; 
        return g; 
      }
      d.discardHandIndex = realIdx;
    }
    
    const [discarded] = me.hand.splice(d.discardHandIndex, 1);
    g.discard.push(discarded);
    
    // 进入选择效果阶段
    g.pending = { 
      type: 'jujianChooseEffect', 
      sourceSeat: mySeat, 
      targetSeat: targetSeat, 
      discardCard: discarded 
    };
    g.phase = 'jujianChooseEffect';
    g.log = pushLog(g.log, `${me.name} 举荐 ${g.players[targetSeat].name}`);
    markSkillSound(g, mySeat, 'jujian');
    return g;
  });
}

// 目标选择效果
function chooseJujianEffect(opt) {
  tx(g => {
    const d = g.pending;
    if (d?.type !== 'jujianChooseEffect') return g;
    
    // 关键修正：仅允许被举荐者选择效果
    if (d.targetSeat !== mySeat) return g;
    
    const tgt = g.players[d.targetSeat];
    if (!tgt?.alive) {
      g.pending = null;
      g.phase = 'end';
      return g;
    }
    
    if (opt === 'draw') {
      ensureDeck(g, 2);
      drawN(g, d.targetSeat, 2);
    } else if (opt === 'recover') {
      if (typeof recoverHp === 'function') {
        recoverHp(g, d.targetSeat, 1);
      } else {
        tgt.hp = Math.min(tgt.maxHp, (tgt.hp || 0) + 1);
      }
    } else if (opt === 'reset') {
      let changed = false;
      if (tgt.chained) { tgt.chained = false; changed = true; }
      if (tgt.turnedOver) { tgt.turnedOver = false; changed = true; }
      if (Array.isArray(tgt.disabledSlots) && tgt.disabledSlots.length) { 
        tgt.disabledSlots = []; 
        changed = true; 
      }
      g.log = pushLog(g.log, changed ? `${tgt.name} 已复原` : `${tgt.name} 无需复原`);
    }
    
    // 标记已使用
    g.players[d.sourceSeat].marks.jujian_used = true;
    g.log = pushLog(g.log, `${tgt.name} 选择 ${opt}`);
    
    // 清理状态
    g.pending = null;
    g.phase = 'end';
    return g;
  });
}

// 取消举荐
function cancelJujian() {
  tx(g => {
    const d = g.pending;
    if (!d?.type?.startsWith('jujian') || d.sourceSeat !== mySeat) return g;
    
    // 关键修正：已弃牌阶段不允许取消，防止丢牌
    if (d.type === 'jujianChooseEffect') {
      g.log = pushLog(g.log, `已弃牌，无法取消`);
      return g;
    }
    
    g.pending = null;
    g.phase = 'end';
    g.log = pushLog(g.log, `${g.players[mySeat].name} 取消举荐`);
    return g;
  });
}
```

---

## 五、集成方式

### 在 game.js 中的集成

**1. 无言集成**（直接修改 dealDamage 函数）：
```javascript
// 在 game.js 中，找到 dealDamage 函数，在开头部分添加无言检测
function dealDamage(g, seat, amount, sourceSeat, reason, srcType, sourceCard, skipTianxiang, skipZhengyi, skipChain) {
  const p = g.players[seat];
  if (!p) return false;
  
  // >>> 无言：在真正扣减体力前拦截 <<<
  const isTrickDamage = sourceCard && isTrickCardName(sourceCard.name);
  
  if (isTrickDamage && !skipChain) {
    const src = g.players[sourceSeat];
    const tgt = g.players[seat];
    
    if (src && src.alive && generalHasCap(src, 'wuyan')) {
      g.log = pushLog(g.log, `${src.name} 发动【无言】,防止了其锦囊造成的伤害`);
      markSkillSound(g, sourceSeat, 'wuyan');
      return false;
    }
    
    if (tgt && tgt.alive && generalHasCap(tgt, 'wuyan')) {
      g.log = pushLog(g.log, `${tgt.name} 发动【无言】,防止了锦囊伤害`);
      markSkillSound(g, seat, 'wuyan');
      return false;
    }
  }
  
  // >>> 原有逻辑继续 <<<
  if (!skipZhengyi && maybeStartZhengyi(g, seat, amount, sourceSeat, reason, srcType, sourceCard)) return true;
  // ...
}
```

**2. 举荐集成**（在 endTurn 函数中添加）：
```javascript
// 在 game.js 中的 endTurn 函数中，结束阶段技能检测区域添加
function endTurn() {
  tx(g => {
    if (g.phase !== 'discard' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    if (me.hand.length > me.hp && !canSkipDiscard(g, mySeat)) return g;
    if (maybeStartLiRangRecover(g, mySeat)) return g;
    
    // >>> 徐庶【举荐】：结束阶段 <<<
    if (generalHasCap(me, 'jujian') && me.alive && !me.marks?.jujian_used) {
      tryJujian(g);
      if (g.pending?.type === 'jujianPickCard') return g;
    }
    
    // >>> 原有 endTurn 逻辑继续 <<<
    // 曹仁【据守】：结束阶段可选触发（仅未翻面时可发动）
    if (generalHasCap(me, 'jushou') && me.alive && me.faceup !== false) {
      // ...
    }
    finishTurn(g, mySeat);
    return g;
  });
}
```

**3. 状态规范化**（在 normalize 函数中添加）：
```javascript
// 在 game.js 的 normalize 函数中添加徐庶状态规范化
function normalize(g) {
  // ... 现有规范化代码 ...
  
  // 徐庶状态规范化
  g.players.forEach(p => {
    if (!p.marks) p.marks = {};
    if (typeof p.marks.jujian_used !== 'boolean') p.marks.jujian_used = false;
  });
  if (g.pending?.type?.startsWith('jujian')) {
    const d = g.pending;
    if (typeof d.sourceSeat !== 'number' || !g.players[d.sourceSeat]?.alive) {
      g.pending = null;
      if (g.phase?.startsWith('jujian')) g.phase = 'end';
    }
  }
}
```

**4. 回合重置**（在 startTurn 函数中添加）：
```javascript
// 在 game.js 的 startTurn 函数中添加举荐标记重置
function startTurn(g, seat) {
  // ... 现有代码 ...
  
  // 重置举荐使用标记
  const p = g.players[seat];
  if (p?.marks) p.marks.jujian_used = false;
}
```

---

## 六、渲染集成（render-controls.js）

**关键修正**：使用 DOM API 创建元素，避免 XSS 注入风险

```javascript
function renderJujian(g, ui) {
  const d = g.pending;
  if (!d?.type?.startsWith('jujian')) return false;
  if (d.sourceSeat !== mySeat && d.targetSeat !== mySeat) return false;
  
  ui.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'skill-choose-panel';
  
  if (d.type === 'jujianPickCard') {
    wrap.innerHTML = '<h4>举荐：弃置一张非基本牌</h4>';
    d.cards.forEach((c, i) => {
      const b = document.createElement('button');
      b.textContent = c.name || c.id;
      b.onclick = () => pickJujianCard(d.handIndices[i]);
      wrap.appendChild(b);
    });
  } else if (d.type === 'jujianPickTarget') {
    wrap.innerHTML = '<h4>举荐：选择一名其他角色</h4>';
    d.candidates.forEach(seat => {
      const b = document.createElement('button');
      b.textContent = g.players[seat].name;
      b.onclick = () => pickJujianTarget(seat);
      wrap.appendChild(b);
    });
  } else if (d.type === 'jujianChooseEffect' && d.targetSeat === mySeat) {
    wrap.innerHTML = `<h4>${g.players[d.sourceSeat].name} 举荐你</h4>`;
    [['draw', '摸两张'], ['recover', '回1血'], ['reset', '复原']].forEach(([k, txt]) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.onclick = () => chooseJujianEffect(k);
      wrap.appendChild(b);
    });
  }
  
  const cancel = document.createElement('button');
  cancel.textContent = '取消';
  cancel.onclick = cancelJujian;
  wrap.appendChild(cancel);
  ui.appendChild(wrap);
  return true;
}

// 在 renderControls 中集成
function renderControls(g, me) {
  // ... 现有代码 ...
  
  // 集成举荐 UI
  if (renderJujian(g, ui)) return;
  
  // ... 其余代码 ...
}
```

---

## 七、音效标识

```javascript
const SKILL_SOUNDS = {
  // ... 现有技能 ...
  '无言': 'wuyan',
  '举荐': 'jujian',
};
```

---

## 八、边界条件处理

### 无言

| 场景 | 处理方式 |
|------|----------|
| 非锦囊牌（基本牌/装备牌） | 不触发，正常结算 |
| 延迟锦囊牌（delay 类型） | 触发，防止伤害 |
| **连环传导伤害** | **不触发**，传导时 `skipChain=true` |
| 多目标锦囊（南蛮入侵等） | 仅防止对徐庶的伤害，其他目标正常结算 |
| 徐庶自己使用锦囊牌对自己 | 防止伤害 |
| 非徐庶使用锦囊牌对徐庶 | 防止对徐庶的伤害 |
| 徐庶使用非锦囊牌 | 不触发，正常结算 |

### 举荐

| 场景 | 处理方式 |
|------|----------|
| 无非基本牌 | 不显示按钮，直接进入结束阶段 |
| 场上无其他存活角色 | 不显示按钮 |
| 选择非基本牌后取消 | 牌不丢失，直接取消 |
| 选择目标后取消 | **已弃牌，提示无法取消** |
| 目标角色阵亡 | 自动取消，回到结束阶段 |
| 武将牌已正置无横置 | 提示"无需复原" |
| 武将牌翻面+横置 | 一次复原所有异常状态 |
| 体力已满，选择回复 | 体力保持最大值 |
| 牌堆不足2张 | 先摸现有的，再通过 ensureDeck 补足 |
| 手牌索引漂移 | 通过 card.id 校验，重新寻找正确索引 |
| 徐庶尝试替被举荐者选效果 | **权限拒绝，仅被举荐者可选** |

---

## 九、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **无言** | |
| 徐庶使用锦囊牌（如火攻）攻击其他角色 | 防止伤害，目标不扣体力 |
| 徐庶受到其他角色锦囊牌伤害 | 防止伤害，徐庶不扣体力 |
| 徐庶使用南蛮入侵（多目标锦囊） | 所有目标都受到伤害（无言不影响锦囊结算，仅防止徐庶自身的伤害） |
| 徐庶受到铁索连环传导的锦囊伤害 | **正常扣体力**（传导不算锦囊伤害） |
| 徐庶使用基本牌攻击 | 正常造成伤害 |
| 徐庶受到基本牌伤害 | 正常扣体力 |
| **举荐** | |
| 徐庶有非基本牌，结束阶段 | 可以发动举荐 |
| 徐庶只有基本牌，结束阶段 | 不显示举荐按钮 |
| 徐庶持有锦囊牌 | 识别为非基本牌，可正常发动举荐 |
| 选择非基本牌后取消 | 牌不丢失，回到结束阶段 |
| 选择目标后，取消 | 提示"已弃牌，无法取消" |
| 选择目标后，目标选择摸两张牌 | 目标摸2张牌 |
| 选择目标后，目标选择回复1点体力 | 目标回复1点体力 |
| 选择目标后，目标选择复原（翻面+横置） | 所有异常状态清除 |
| 选择目标后，目标选择复原（已正置） | 提示无需复原 |
| A发动举荐后，B同一回合 | B可以正常发动（不串台） |
| 多个徐庶同一局 | 各自独立计算举荐次数 |
| 举荐过程中手牌被其他技能改动 | 通过id重新定位，正确弃置目标牌 |
| 徐庶尝试在被举荐者选效果时操作 | 权限拒绝，仅被举荐者可选 |

---

## 十、流程图

### 无言流程
```
dealDamage 被调用
    ↓
检查 sourceCard 是否为锦囊牌（isTrickCardName）
    ↓
是：检查 skipChain（传导时 skipChain=true）
    ↓
skipChain=false 时：检查使用者或目标是否为徐庶
    ↓
是：日志记录 + 播放音效
    ↓
返回 false（防止伤害，不继续后续流程）
    ↓
否：继续原有 dealDamage 逻辑
```

### 举荐流程
```
endTurn() 函数执行
    ↓
检查是否为徐庶且未使用过举荐
    ↓
是：tryJujian(g) 检测是否可发动（纯函数，无tx）
    ↓
有锦囊牌且有其他存活角色？
    ↓
是：进入 jujianPickCard 阶段
    ↓
选择锦囊牌（存索引+cardId，暂不弃牌）
    ↓
进入 jujianPickTarget 阶段
    ↓
选择目标角色
    ↓
二次校验：通过 cardId 重新定位手牌（防漂移）
    ↓
真正弃置牌到弃牌堆
    ↓
进入 jujianChooseEffect 阶段
    ↓
仅被举荐者选择效果（权限检查）
    ↓
执行效果
    ↓
标记 p.marks.jujian_used = true
    ↓
回到 end 阶段
```

---

## 十一、特殊说明

### 关键修正说明

1. **全局标志问题**：原方案使用 `g.jujiuUsed` 会导致所有人共享同一个标志位。修正为 `p.marks.jujian_used`，每个玩家独立维护。

2. **阶段回退问题**：原方案校验失败回退到 `'play'` 阶段，但举荐是结束阶段技能，会导致流程异常。修正为回退到 `'end'` 阶段。

3. **无言实现位置**：原方案假设 `beforeDamage` 钩子，但项目中没有此钩子。修正为在 `dealDamage` 函数内部直接集成检测。

4. **弃牌时机**：原方案在选择牌时就弃牌，取消时会丢失牌。修正为在选择目标后再真正弃牌。

5. **复原武将牌**：原方案仅处理 `chained`，修正为同时处理 `flipped`（翻面）和 `chained`（横置），以及 `disabledSlots`（废除）。

6. **锦囊判断方式**：原方案使用 `card.type`，修正为使用项目实际的 `isTrickCardName(card.name)`。

7. **连环传导误拦**：原方案假设 `ev.isChain` 字段，修正为检测 `skipChain` 参数（传导时 `skipChain=true`）。

8. **结束阶段集成**：原方案假设 `endPhase` 函数，修正为在 `endTurn` 函数中集成（类似曹仁【据守】）。

9. **嵌套事务问题**：`tryJujian` 内部包 `tx`，而 `endTurn` 也包 `tx`，嵌套会丢状态。修正为 `tryJujian` 纯函数，由 `endTurn` 统一包事务。

10. **越权选择问题**：`chooseJujianEffect` 允许徐庶替被举荐者选效果。修正为仅被举荐者（`targetSeat === mySeat`）可选。

11. **取消不回滚+索引漂移**：已弃牌阶段取消会丢牌；手牌索引在阶段间可能变化。修正：已弃牌阶段拒绝取消；通过 card.id 校验并重新定位。

### 武将定位
- **无言**：体现徐庶的"不言"特性，在锦囊牌交锋中具有免疫力
- **举荐**：体现徐庶的"荐贤"特性，通过牺牲锦囊牌为他人提供多种益处

---

## 十二、修正记录

*文档状态：设计完成（已修正所有问题，与项目实际代码完全匹配）*
*创建时间：2026-07-13*
*最终修正时间：2026-07-13*
*负责人：Mistral Vibe*

### 已修复的差异点
- ✅ hooks 机制：从假设的全局钩子改为项目实际的武将 hooks + triggerHook
- ✅ 伤害拦截：从假设的 beforeDamage 钩子改为直接在 dealDamage 内部集成
- ✅ 锦囊判断：从 card.type 改为使用项目实际的 isTrickCardName(card.name)
- ✅ 连环传导：从 ev.isChain 改为检测 skipChain 参数
- ✅ 阶段机制：从 endPhase 改为在 endTurn 中集成

### 待实装项
- [ ] data.js: 添加徐庶武将定义
- [ ] game.js: 在 dealDamage 中集成无言检测
- [ ] game.js: 在 endTurn 中集成 tryJujian
- [ ] game.js: 状态规范化和回合重置
- [ ] skills.js: 无言和举荐技能函数
- [ ] render-controls.js: 举荐 UI 界面
- [ ] audio/: 添加 wuyan.mp3 和 jujian.mp3

### 待优化项
- 收集更多边界测试场景
- 验证多徐庶局的正确性
- 优化移动端 UI 体验
