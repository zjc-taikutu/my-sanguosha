# 曹冲 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `caochong` |
| **武将名称** | 曹冲 |
| **势力** | 魏 |
| **性别** | male |
| **体力上限** | 3 |
| **技能** | 称象 / 仁心 |

---

## 二、技能说明

### 称象
**时机**：受到伤害后

**效果**：
1. 你可以亮出牌堆顶的四张牌
2. 获得其中**任意张点数之和不大于13的牌**

**设计要点**：
- 属于**受到伤害后的触发技**，需与 `afterDamage` 流程集成
- 亮出4张牌后，从中选择任意张牌获取，但选择的牌的点数之和必须不大于13
- 需要计算牌的点数：J=11, Q=12, K=13, A=1（其他牌为面值）
- 选择完成后，未选择的牌置入弃牌堆
- 该技能为**可选择发动**的技能

---

### 仁心
**时机**：其他角色受到伤害时

**效果**：
1. 若其体力值为1
2. 你可以**翻面**并**弃置一张装备牌**
3. 防止此伤害

**设计要点**：
- 属于**他人受到伤害时的响应技**，需与 `beforeDamage` 流程集成
- 触发条件：目标角色体力值为1
- 发动条件：你处于正面朝上状态（翻面后变为背面朝上）
- 需要弃置你的**一张装备牌**作为代价
- 成功发动后，**防止此次伤害**（伤害值置0）
- 每次伤害只能发动一次仁心

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
caochong: {
  id: 'caochong',
  name: '曹冲',
  gender: 'male',
  maxHp: 3,
  skill: '称象/仁心',
  desc: '称象:当你受到伤害后,你可以亮出牌堆顶的四张牌,获得其中任意张点数之和不大于13的牌。仁心:当其他角色受到伤害时,若其体力值为1,你可以翻面并弃置一张装备牌,防止此伤害。',
  caps: { chengxiang: true, renxin: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 曹冲【称象】: 选择阶段
if(g.pending && g.pending.type==='chengxiangChoose'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     !Array.isArray(d.revealedCards) || d.revealedCards.length !== 4 ||
     !Array.isArray(d.selectable) || !Number.isInteger(d.sumLimit) || d.sumLimit <= 0){
    g.pending = null;
  }
}

// 曹冲【仁心】: 选择装备牌阶段
if(g.pending && g.pending.type==='renxinChoose'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     !g.players[d.seat].faceUp ||
     typeof d.target!=='number' || !g.players[d.target] || !g.players[d.target].alive ||
     g.players[d.target].hp > 1 ||
     !Array.isArray(d.equipIndices) || d.equipIndices.length === 0){
    g.pending = null;
  }
}
```

在 `startTurn` 函数中添加重置：
```javascript
// 曹冲无需回合重置的全局标志，主要通过pending状态管理
```

---

## 四、技能实现

### 称象实现

**集成点**：`afterDamage` 函数（受到伤害后的处理）

```javascript
// 修改 afterDamage 函数，添加称象触发逻辑
function afterDamage(g, damageInfo) {
  tx(g => {
    const { targetSeat, sourceSeat, damage, cardType } = damageInfo;
    
    // 称象触发：受到伤害后
    if (targetSeat === mySeat && g.players[mySeat].alive && generalHasCap(g.players[mySeat], 'chengxiang')) {
      const me = g.players[mySeat];
      
      // 确保牌堆有至少4张牌
      ensureDeck(g, 4);
      
      if (g.deck.length >= 4) {
        // 亮出牌堆顶的4张牌
        const revealed = g.deck.splice(0, 4);
        
        // 计算每张牌的点数
        const cardValues = revealed.map(card => {
          const value = getCardValue(card); // 需要实现getCardValue函数
          return { card, value };
        });
        
        // 进入称象选择阶段
        g.pending = {
          type: 'chengxiangChoose',
          seat: mySeat,
          revealedCards: revealed,
          cardValues: cardValues,
          sumLimit: 13,
          selectable: [] // 存储可选的牌的索引组合
        };
        
        // 预计算所有可能的选择组合（点数和<=13）
        calculateChengxiangOptions(g.pending);
        
        g.log = pushLog(g.log, `${me.name} 发动【称象】,亮出牌堆顶的4张牌`);
        markSkillSound(g, '称象');
        return g;
      }
    }
    
    return g;
  });
}

// 获取牌的点数
function getCardValue(card) {
  const rank = card.rank;
  const suit = card.suit;
  
  // 根据牌的rank确定点数
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  
  // 数字牌直接返回数值
  const num = parseInt(rank);
  return isNaN(num) ? 0 : num;
}

// 计算称象可选的牌的组合（点数和<=13）
function calculateChengxiangOptions(pending) {
  const { cardValues, sumLimit } = pending;
  const n = cardValues.length;
  const selectable = [];
  
  // 生成所有非空子集，并检查点数和
  for (let mask = 1; mask < (1 << n); mask++) {
    let sum = 0;
    const indices = [];
    
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += cardValues[i].value;
        indices.push(i);
      }
    }
    
    if (sum <= sumLimit) {
      selectable.push({ indices, sum });
    }
  }
  
  pending.selectable = selectable;
}

// 称象选择完成
function confirmChengxiang(selection) {
  tx(g => {
    if (g.pending.type !== 'chengxiangChoose' || g.pending.seat !== mySeat) return g;
    
    const me = g.players[mySeat];
    const pending = g.pending;
    
    // 获取选择的牌
    const selectedIndices = selection.indices || [];
    const selectedCards = selectedIndices.map(idx => pending.revealedCards[idx]);
    
    // 获得选择的牌
    me.hand.push(...selectedCards);
    
    // 未选择的牌置入弃牌堆
    const unselectedCards = pending.revealedCards.filter(
      (_, idx) => !selectedIndices.includes(idx)
    );
    g.discard.push(...unselectedCards);
    
    g.log = pushLog(g.log, `${me.name} 获得了${selectedIndices.length}张牌（点数和：${selection.sum}），其余牌置入弃牌堆`);
    
    // 清理pending状态
    g.pending = null;
    
    return g;
  });
}

// 取消称象
function cancelChengxiang() {
  tx(g => {
    if (g.pending.type !== 'chengxiangChoose' || g.pending.seat !== mySeat) return g;
    
    const me = g.players[mySeat];
    const pending = g.pending;
    
    // 所有亮出的牌置入弃牌堆
    g.discard.push(...pending.revealedCards);
    
    g.log = pushLog(g.log, `${me.name} 取消发动【称象】，牌置入弃牌堆`);
    
    // 清理pending状态
    g.pending = null;
    
    return g;
  });
}
```

---

### 仁心实现

**集成点**：`beforeDamage` 函数（受到伤害前的处理）

```javascript
// 修改 beforeDamage 函数，添加仁心触发逻辑
function beforeDamage(g, damageInfo) {
  tx(g => {
    const { targetSeat, sourceSeat, damage, cardType } = damageInfo;
    
    // 仁心触发：其他角色受到伤害时，且其体力值为1
    if (targetSeat !== mySeat && targetSeat !== sourceSeat && 
        g.players[targetSeat] && g.players[targetSeat].alive &&
        g.players[targetSeat].hp === 1 &&
        g.players[mySeat] && g.players[mySeat].alive &&
        g.players[mySeat].faceUp &&
        generalHasCap(g.players[mySeat], 'renxin')) {
      
      const me = g.players[mySeat];
      const target = g.players[targetSeat];
      
      // 检查我是否有装备牌可以弃置
      const equipIndices = me.equip ? 
        me.equip.map((e, idx) => e ? idx : -1).filter(idx => idx !== -1) : [];
      
      if (equipIndices.length > 0) {
        // 进入仁心选择阶段
        g.pending = {
          type: 'renxinChoose',
          seat: mySeat,
          target: targetSeat,
          damage: damage,
          sourceSeat: sourceSeat,
          equipIndices: equipIndices,
          originalDamageInfo: damageInfo
        };
        
        g.log = pushLog(g.log, `${me.name} 可以发动【仁心】,保护 ${target.name}`);
        return g;
      }
    }
    
    return g;
  });
}

// 仁心选择装备牌弃置
function chooseRenxinEquip(equipIndex) {
  tx(g => {
    if (g.pending.type !== 'renxinChoose' || g.pending.seat !== mySeat) return g;
    
    const me = g.players[mySeat];
    const target = g.players[g.pending.target];
    const pending = g.pending;
    
    // 检查装备索引是否合法
    if (!pending.equipIndices.includes(equipIndex) || 
        !me.equip || !me.equip[equipIndex]) {
      return g;
    }
    
    // 弃置装备牌
    const equipCard = me.equip[equipIndex];
    me.equip[equipIndex] = null;
    g.discard.push(equipCard);
    
    // 翻面
    me.faceUp = false;
    
    // 防止此伤害
    // 需要取消当前的伤害处理
    pending.originalDamageInfo.damage = 0;
    
    g.log = pushLog(g.log, `${me.name} 发动【仁心】,弃置装备 ${equipCard.name},翻面,防止了对 ${target.name} 的伤害`);
    markSkillSound(g, '仁心');
    
    // 清理pending状态
    g.pending = null;
    
    return g;
  });
}

// 取消仁心
function cancelRenxin() {
  tx(g => {
    if (g.pending.type !== 'renxinChoose' || g.pending.seat !== mySeat) return g;
    
    const me = g.players[mySeat];
    
    g.log = pushLog(g.log, `${me.name} 取消发动【仁心】`);
    
    // 清理pending状态，继续正常的伤害处理
    g.pending = null;
    
    return g;
  });
}
```

---

## 五、渲染集成（render-controls.js）

### 称象选择UI

```javascript
// 在 renderControls 中添加称象选择状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 称象选择阶段
  if (g.pending && g.pending.type === 'chengxiangChoose' && g.pending.seat === seat) {
    const pending = g.pending;
    const { revealedCards, cardValues, sumLimit, selectable } = pending;
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【称象】选择牌</h4>
        <p>从亮出的4张牌中选择任意张（点数和 ≤ ${sumLimit}）：</p>
        <div class="card-grid">
    `;
    
    // 显示亮出的牌
    revealedCards.forEach((card, idx) => {
      const value = cardValues[idx].value;
      const cardName = getCardName(card); // 需要实现或使用现有函数
      
      ui.innerHTML += `
        <div class="card-option" data-index="${idx}" data-value="${value}">
          <span class="card-name">${cardName}</span>
          <span class="card-value">点数:${value}</span>
        </div>
      `;
    });
    
    ui.innerHTML += `
        </div>
        <div class="selection-info">
          <p>当前选择：<span id="chengxiang-selected">无</span></p>
          <p>点数和：<span id="chengxiang-sum">0</span></p>
        </div>
        <button onclick="confirmChengxiangSelection()" class="skill-btn" style="background: #4a90d9;">
          确认选择
        </button>
        <button onclick="cancelChengxiang()" class="skill-btn" style="background: #999;">
          取消
        </button>
      </div>
    `;
    
    return;
  }
}

// 称象选择逻辑
let chengxiangSelectedIndices = [];

function toggleChengxiangCard(idx) {
  const pending = g.pending;
  if (!pending || pending.type !== 'chengxiangChoose' || pending.seat !== mySeat) return;
  
  const cardValue = pending.cardValues[idx].value;
  const currentSum = chengxiangSelectedIndices.reduce(
    (sum, i) => sum + pending.cardValues[i].value, 0
  );
  const newSum = chengxiangSelectedIndices.includes(idx) 
    ? currentSum - cardValue 
    : currentSum + cardValue;
  
  // 检查点数和是否超出限制
  if (newSum <= pending.sumLimit) {
    if (chengxiangSelectedIndices.includes(idx)) {
      // 取消选择
      chengxiangSelectedIndices = chengxiangSelectedIndices.filter(i => i !== idx);
    } else {
      // 添加选择
      chengxiangSelectedIndices.push(idx);
    }
    
    updateChengxiangUI();
  }
}

function updateChengxiangUI() {
  const pending = g.pending;
  if (!pending || pending.type !== 'chengxiangChoose') return;
  
  const sum = chengxiangSelectedIndices.reduce(
    (s, i) => s + pending.cardValues[i].value, 0
  );
  
  document.getElementById('chengxiang-selected').textContent = 
    chengxiangSelectedIndices.length > 0 
      ? chengxiangSelectedIndices.map(i => getCardName(pending.revealedCards[i])).join(',') 
      : '无';
  document.getElementById('chengxiang-sum').textContent = sum;
}

function confirmChengxiangSelection() {
  const pending = g.pending;
  if (!pending || pending.type !== 'chengxiangChoose' || pending.seat !== mySeat) return;
  
  if (chengxiangSelectedIndices.length === 0) {
    alert('请至少选择一张牌');
    return;
  }
  
  const sum = chengxiangSelectedIndices.reduce(
    (s, i) => s + pending.cardValues[i].value, 0
  );
  
  if (sum > pending.sumLimit) {
    alert(`点数和不能超过${pending.sumLimit}`);
    return;
  }
  
  // 找到对应的selectable选项
  const selection = pending.selectable.find(
    s => arraysEqual(s.indices.sort(), chengxiangSelectedIndices.sort())
  );
  
  if (selection) {
    confirmChengxiang(selection);
    chengxiangSelectedIndices = [];
  }
}

// 辅助函数：比较两个数组是否相等
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
```

### 仁心选择UI

```javascript
// 仁心选择阶段
if (g.pending && g.pending.type === 'renxinChoose' && g.pending.seat === seat) {
  const pending = g.pending;
  const target = g.players[pending.target];
  const me = g.players[seat];
  
  ui.innerHTML += `
    <div class="skill-choose">
      <h4>【仁心】保护 ${target.name}</h4>
      <p>你可以翻面并弃置一张装备牌，防止此伤害：</p>
      <div class="equip-grid">
  `;
  
  // 显示可弃置的装备牌
  pending.equipIndices.forEach(equipIndex => {
    const equipCard = me.equip[equipIndex];
    if (equipCard) {
      const equipName = getCardName(equipCard);
      ui.innerHTML += `
        <button onclick="chooseRenxinEquip(${equipIndex})" class="equip-btn">
          弃置 ${equipName}
        </button>
      `;
    }
  });
  
  ui.innerHTML += `
      </div>
      <button onclick="cancelRenxin()" class="skill-btn" style="background: #999;">
        取消
      </button>
    </div>
  `;
  
  return;
}
```

---

## 六、音效标识

在 `markSkillSound` 中添加：
```javascript
const SKILL_SOUNDS = {
  // ... 现有技能 ...
  '称象': 'chengxiang',
  '仁心': 'renxin',
};
```

---

## 七、边界条件处理

### 称象
1. **牌堆不足4张**：使用 `ensureDeck(g, 4)` 确保牌堆有足够的牌
2. **无合法组合**：若所有牌组合的点数和都大于13，则只能选择空集（即不获得任何牌）
3. **选择空集**：允许玩家选择不获得任何牌（相当于放弃发动）
4. **牌的点数计算**：
   - 数字牌：面值即为点数（2-10）
   - J=11, Q=12, K=13, A=1
   - 其他特殊牌（如无主牌）点数为0
5. **多次发动**：每次受到伤害后都可以发动称象
6. **取消发动**：亮出的牌全部置入弃牌堆

### 仁心
1. **目标体力不为1**：不触发仁心
2. **自己处于背面朝上**：不能发动仁心（因为需要翻面）
3. **无装备牌**：不能发动仁心
4. **目标角色死亡**：在伤害处理前检查，若目标已死亡则不触发
5. **多个仁心触发**：每次伤害只能发动一次仁心
6. **伤害来源**：不限定伤害来源，任何角色对体力为1的角色造成伤害时都可以触发
7. **翻面后状态**：翻面后不能使用主动技能，但可以使用被动技能

### 与其他技能的交互
1. **与翻面相关技能的交互**：
   - 仁心的翻面效果应与其他翻面技能正常叠加
   - 翻面后的状态变化应触发相关的翻面响应技能
2. **与装备相关技能的交互**：
   - 仁心弃置装备牌后，装备相关的buff应同时移除
   - 装备区空缺应允许重新装备
3. **与伤害相关技能的交互**：
   - 仁心防止的伤害不触发任何伤害结算后的效果
   - 伤害来源不获得任何好处（如吸血等）

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| 称象：受到伤害，牌堆>=4张 | 亮出4张牌，可以选择点数和<=13的任意组合 |
| 称象：受到伤害，牌堆<4张 | 使用ensureDeck补足牌堆后亮出4张 |
| 称象：所有牌组合点数和>13 | 只能选择空集（不获得任何牌） |
| 称象：选择有效组合 | 获得选择的牌，其余牌置入弃牌堆 |
| 称象：取消发动 | 所有亮出的牌置入弃牌堆 |
| 称象：连续受到伤害 | 每次伤害后都可以发动 |
| 仁心：他人体力=1受到伤害 | 可以选择发动仁心 |
| 仁心：他人体力>1受到伤害 | 不触发仁心 |
| 仁心：自己背面朝上时 | 不能发动仁心 |
| 仁心：自己无装备牌 | 不能发动仁心 |
| 仁心：有多个装备牌 | 可以选择任意一个装备牌弃置 |
| 仁心：发动后 | 自己翻面，弃置装备牌，目标不受伤害 |
| 仁心：取消发动 | 正常进行伤害结算 |
| 仁心+称象：同时满足条件 | 可以连续发动两个技能 |

---

## 九、实现优先级

1. **数据定义优先**：添加曹冲武将基本定义
2. **状态管理优先**：添加pending状态防御
3. **核心逻辑优先**：实现称象的牌组合计算和选择逻辑
4. **仁心核心逻辑**：实现仁心的触发条件和效果
5. **UI集成优先**：添加两个技能的选择界面
6. **边界处理**：处理牌堆不足、无合法组合等边界条件
7. **音效集成**：添加技能音效
8. **测试验证**：确保所有场景都通过测试

---

## 十、集成要点

### 与现有系统的集成

1. **伤害系统**：
   - 称象集成到 `afterDamage` 流程
   - 仁心集成到 `beforeDamage` 流程
   - 确保伤害处理的原子性

2. **牌操作系统**：
   - 使用 `ensureDeck` 确保牌堆足够
   - 使用 `g.discard` 管理弃牌堆
   - 使用 `g.deck` 管理牌堆

3. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程
   - 使用 `g.pending` 管理技能选择状态

4. **UI系统**：
   - 使用现有的render模式
   - 确保选择界面的用户体验

### 需要修改的文件

1. **data.js**：
   - 添加曹冲武将定义

2. **game.js**：
   - `normalize()`：添加称象和仁心的pending状态防御
   - 修改 `afterDamage` 函数：集成称象触发逻辑
   - 修改 `beforeDamage` 函数：集成仁心触发逻辑
   - 添加 `getCardValue` 函数：计算牌的点数
   - 添加 `calculateChengxiangOptions` 函数：计算称象可选组合
   - 添加 `confirmChengxiang` 函数：确认称象选择
   - 添加 `cancelChengxiang` 函数：取消称象
   - 添加 `chooseRenxinEquip` 函数：选择仁心弃置的装备
   - 添加 `cancelRenxin` 函数：取消仁心

3. **render-controls.js**：
   - 添加称象选择界面
   - 添加仁心选择界面
   - 添加交互逻辑

---

## 十一、流程图

### 称象完整流程

```
受到伤害后
    ↓
检查是否拥有称象技能
    ↓
是：确保牌堆有至少4张牌
    ↓
亮出牌堆顶4张牌
    ↓
计算每张牌的点数
    ↓
计算所有可能的选择组合（点数和<=13）
    ↓
进入称象选择阶段
    ↓
玩家选择牌的组合
    ↓
确认选择：获得选择的牌，其余牌置入弃牌堆
    ↓
或者取消：所有牌置入弃牌堆
```

### 仁心完整流程

```
其他角色受到伤害时
    ↓
检查受伤角色体力是否为1
    ↓
是：检查自己是否有仁心技能
    ↓
是：检查自己是否正面朝上且有装备牌
    ↓
是：进入仁心选择阶段
    ↓
玩家选择要弃置的装备牌
    ↓
弃置装备牌，自己翻面
    ↓
防止此次伤害（伤害值置0）
    ↓
或者取消：正常进行伤害处理
```

---

## 十二、特殊说明

### 关于曹冲的技能定位

曹冲作为3体力的魏国武将，以其聪明才智著称。两个技能体现了其智慧和仁爱的特点：

**称象（智慧的体现）：**
- 通过受到伤害触发，展现其在不利情况下的应对智慧
- 点数限制（≤13）体现了其对数字的精通（曹冲称象的典故）
- 可以从伤害中获得资源，体现其化被动为主动的能力

**仁心（仁爱的体现）：**
- 保护濒危角色，体现其仁慈的品格
- 需要付出代价（翻面+弃置装备），体现其是有限度的仁爱
- 与魏国其他武将的协同性良好，可以保护队友

### 关于技能平衡性

**称象的平衡：**
- 触发时机是受到伤害后，属于被动触发
- 可以获得1-4张牌，但受点数限制
- 平均每次可能获得1-2张牌，资源获取能力适中
- 3体力的武将有较多受伤机会，可以多次触发

**仁心的平衡：**
- 触发条件较严格（他人体力=1且自己有装备牌）
- 需要付出较大代价（翻面+失去装备）
- 效果强大（完全防止伤害），但代价也很明确
- 可以有效保护队友的残血角色

**整体平衡：**
- 两个技能都有明确的触发条件和代价
- 称象提供资源获取，仁心提供保护能力
- 3体力设定与技能强度相匹配
- 与魏国其他武将的协同性良好

### 关于与其他技能的交互

1. **与手牌相关技能的交互**：
   - 称象获得的牌可以触发手牌相关的连锁效果
   - 获得的牌直接进入手牌，不经过摸牌阶段

2. **与装备相关技能的交互**：
   - 仁心弃置装备牌后，相关的装备效果应同时失效
   - 装备区的空缺可以重新装备

3. **与翻面相关技能的交 Burk：**
   - 仁心的翻面效果应与其他翻面技能正常叠加
   - 翻面后的状态应正确触发相关的翻面响应

---

## 十三、修正记录

*文档状态：设计阶段*
*创建时间：2026-07-13*
*负责人：Mistral Vibe*

### 待实装项

- [ ] **data.js**: 添加曹冲武将定义
- [ ] **game.js**: 
  - [ ] normalize函数：添加称象和仁心的pending状态防御
  - [ ] 修改afterDamage函数：集成称象触发逻辑
  - [ ] 修改beforeDamage函数：集成仁心触发逻辑
  - [ ] 添加getCardValue函数：计算牌的点数
  - [ ] 添加calculateChengxiangOptions函数：计算称象可选组合
  - [ ] 添加confirmChengxiang函数：确认称象选择
  - [ ] 添加cancelChengxiang函数：取消称象
  - [ ] 添加chooseRenxinEquip函数：选择仁心弃置的装备
  - [ ] 添加cancelRenxin函数：取消仁心

- [ ] **render-controls.js**: 
  - [ ] 添加称象选择界面
  - [ ] 添加仁心选择界面
  - [ ] 添加交互逻辑

### 待优化项

- 音效文件：需要添加assets/audio/chengxiang.mp3和assets/audio/renxin.mp3
- UI/UX：优化称象和仁心选择界面的用户体验
- 兼容性：确保与现有所有技能的兼容性，特别是其他伤害相关技能和装备相关技能
- 性能：确保组合计算的性能，避免不必要的计算（4张牌的组合数为2^4-1=15种，性能可接受）

---

*注意：本文档中的代码示例为伪代码，实际实现时需要根据项目的具体API进行调整。*