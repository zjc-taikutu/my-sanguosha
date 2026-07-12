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
**时机**：持续生效

**效果**：
1. 当你使用锦囊牌造成伤害时，防止此伤害
2. 当你受到锦囊牌造成的伤害时，防止此伤害

**设计要点**：
- 属于**锁定技**，无需玩家操作，自动触发
- 分为两个独立的触发条件：
  - **造成伤害时**：在伤害计算前检测，如果是使用锦囊牌造成的伤害，则防止此伤害
  - **受到伤害时**：在伤害计算前检测，如果是锦囊牌造成的伤害，则防止此伤害
- 需要判断伤害的来源是否为**锦囊牌**（card.type === 'trick'）
- 需要判断伤害的**使用者**或**目标**是否为徐庶
- 防止伤害意味着：不扣减体力，不触发其他相关效果（如濒死、角色死亡等）
- 锦囊牌的判断：通过 `card.type === 'trick'` 或预设的锦囊牌类型列表判断

### 举荐
**时机**：结束阶段

**效果**：
1. 你可以弃置一张非基本牌
2. 令一名其他角色选择一项：
   - 1. 摸两张牌
   - 2. 回复1点体力
   - 3. 复原武将牌

**设计要点**：
- 属于**结束阶段主动技能**，每回合可使用一次
- 需要 `g.jujiuUsed` 标志位控制使用次数（或直接在结束阶段处理）
- **非基本牌**的判断：`card.type !== 'basic'`，即锦囊牌（trick）和装备牌（equip）
- 流程分为多个步骤：
  - 选择要弃置的非基本牌
  - 选择目标角色
  - 目标角色选择效果
- 需要验证：徐庶有非基本牌可弃置
- 需要验证：场上有其他存活角色可选择
- 复原武将牌：将目标角色的武将牌从横置状态变为正置状态

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
  caps: { wuyan: true, jujian: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 徐庶【举荐】:回合内使用标记
if(typeof g.jujiuUsed!=='boolean') g.jujiuUsed=false;

// 徐庶【举荐】选择非基本牌阶段: pending 应包含 type、sourceSeat
if(g.pending && g.pending.type==='jujianPickCard'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     !Array.isArray(d.nonBasicCards) || d.nonBasicCards.length===0){
    g.pending = null;
    g.phase = 'play';
  }
}

// 徐庶【举荐】选择目标角色阶段
if(g.pending && g.pending.type==='jujianPickTarget'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     !Array.isArray(d.candidates) || d.candidates.length===0 ||
     !g.pending.discardCard || typeof g.pending.discardCard !== 'object'){
    g.pending = null;
    g.phase = 'play';
  }
}

// 徐庶【举荐】目标选择效果阶段
if(g.pending && g.pending.type==='jujianChooseEffect'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
     !g.pending.discardCard || typeof g.pending.discardCard !== 'object'){
    g.pending = null;
    g.phase = 'play';
  }
}
```

在 `startTurn` 函数中添加重置：
```javascript
g.jujiuUsed = false;  // 在其他标志位重置的同一行
```

---

## 四、技能实现

### 无言实现

**集成点1**：伤害计算前的处理函数（如 `calculateDamage` 或 `beforeDamage`）

```javascript
// 在伤害处理函数中添加无言触发检查
function resolveDamage(g, sourceSeat, targetSeat, damage, card) {
  tx(g => {
    const source = g.players[sourceSeat];
    const target = g.players[targetSeat];
    
    if (!source || !source.alive || !target || !target.alive) return g;
    
    // 无言触发：当徐庶使用锦囊牌造成伤害时，防止此伤害
    if (hasCap(source, 'wuyan') && card && isTrickCard(card)) {
      g.log = pushLog(g.log, `${source.name} 发动【无言】,防止了使用锦囊牌造成的伤害`);
      markSkillSound(g, '无言');
      return g; // 防止伤害，直接返回，不执行后续伤害逻辑
    }
    
    // 无言触发：当徐庶受到锦囊牌造成的伤害时，防止此伤害
    if (hasCap(target, 'wuyan') && card && isTrickCard(card)) {
      g.log = pushLog(g.log, `${target.name} 发动【无言】,防止了锦囊牌造成的伤害`);
      markSkillSound(g, '无言');
      return g; // 防止伤害，直接返回，不执行后续伤害逻辑
    }
    
    // 正常执行伤害逻辑...
    // ...
    
    return g;
  });
}

// 辅助函数：判断是否为锦囊牌
function isTrickCard(card) {
  return card && card.type === 'trick';
}
```

**集成点2**：在使用牌造成伤害的函数中集成（如 `useCard`）

```javascript
// 在 useCard 函数中，当使用锦囊牌时检查无言
function useCard(g, seat, cardIndex, targets) {
  tx(g => {
    const me = g.players[seat];
    const card = me.hand[cardIndex];
    
    // ... 现有代码 ...
    
    // 如果是锦囊牌且目标包含徐庶，检查无言
    if (card.type === 'trick') {
      // 检查使用者是否是徐庶
      if (hasCap(me, 'wuyan')) {
        g.log = pushLog(g.log, `${me.name} 发动【无言】,防止了使用锦囊牌造成的伤害`);
        markSkillSound(g, '无言');
        // 不造成伤害，直接返回
        return g;
      }
      
      // 检查目标是否包含徐庶
      for (let i = 0; i < targets.length; i++) {
        const target = g.players[targets[i]];
        if (target && target.alive && hasCap(target, 'wuyan')) {
          g.log = pushLog(g.log, `${target.name} 发动【无言】,防止了锦囊牌造成的伤害`);
          markSkillSound(g, '无言');
          // 从目标列表中移除徐庶
          targets.splice(i, 1);
          i--;
        }
      }
    }
    
    // ... 后续逻辑 ...
    
    return g;
  });
}
```

### 举荐实现

**UI触发点**：在结束阶段处理函数中添加举荐按钮

```javascript
// 在 endPhase 函数中添加举荐选择逻辑
function endPhase(g) {
  tx(g => {
    const me = g.players[mySeat];
    
    if (g.phase !== 'end' || g.turn !== mySeat) return g;
    
    // 举荐：检查是否有非基本牌且未使用过
    if (hasCap(me, 'jujian') && !g.jujiuUsed) {
      const nonBasicCards = (me.hand || []).filter(card => card.type !== 'basic');
      
      if (nonBasicCards.length > 0) {
        // 进入举荐选择非基本牌阶段
        g.pending = {
          type: 'jujianPickCard',
          sourceSeat: mySeat,
          nonBasicCards: nonBasicCards,
          candidates: nonBasicCards.map((_, idx) => idx)
        };
        g.log = pushLog(g.log, `${me.name} 发动【举荐】,选择要弃置的非基本牌…`);
        markSkillSound(g, '举荐');
        return g;
      }
    }
    
    // 结束阶段正常流程
    g.phase = 'draw';
    g.turn = (g.turn + 1) % g.players.length;
    startTurn(g);
    
    return g;
  });
}

// 举荐：选择要弃置的非基本牌
function pickJujianCard(cardIndex) {
  tx(g => {
    if (g.pending.type !== 'jujianPickCard') return g;
    
    const me = g.players[mySeat];
    
    if (cardIndex < 0 || cardIndex >= g.pending.nonBasicCards.length) return g;
    if (!g.pending.candidates.includes(cardIndex)) return g;
    
    const discardCard = g.pending.nonBasicCards[cardIndex];
    
    // 从手牌中移除这张牌
    const hand = me.hand || [];
    const idx = hand.findIndex(c => c.id === discardCard.id);
    if (idx !== -1) {
      hand.splice(idx, 1);
    }
    
    // 添加到弃牌堆
    g.discard.push(discardCard);
    
    // 进入选择目标角色阶段
    g.pending = {
      type: 'jujianPickTarget',
      sourceSeat: mySeat,
      discardCard: discardCard,
      candidates: []
    };
    
    // 计算可选目标（其他存活角色）
    for (let i = 0; i < g.players.length; i++) {
      if (i !== mySeat && g.players[i] && g.players[i].alive) {
        g.pending.candidates.push(i);
      }
    }
    
    g.log = pushLog(g.log, `${me.name} 选择了要弃置的非基本牌【${discardCard.name}】,请选择目标角色…`);
    
    return g;
  });
}

// 举荐：选择目标角色
function pickJujianTarget(seat) {
  tx(g => {
    if (g.pending.type !== 'jujianPickTarget') return g;
    
    const me = g.players[mySeat];
    const target = g.players[seat];
    
    if (!target || !target.alive) return g;
    if (!g.pending.candidates.includes(seat)) return g;
    
    // 进入目标选择效果阶段
    g.pending = {
      type: 'jujianChooseEffect',
      sourceSeat: mySeat,
      targetSeat: seat,
      discardCard: g.pending.discardCard
    };
    
    g.log = pushLog(g.log, `${me.name} 选择了目标角色 ${target.name},请选择效果`);
    
    return g;
  });
}

// 举荐：目标选择效果
function chooseJujianEffect(option) {
  // option: 'draw' (摸两张牌), 'recover' (回复1点体力), 'reset' (复原武将牌)
  tx(g => {
    if (g.pending.type !== 'jujianChooseEffect') return g;
    
    const me = g.players[g.pending.sourceSeat];
    const target = g.players[g.pending.targetSeat];
    
    if (!me || !me.alive || !target || !target.alive) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    let effectName = '';
    
    if (option === 'draw') {
      // 摸两张牌
      drawN(g, g.pending.targetSeat, 2);
      effectName = '摸两张牌';
    } else if (option === 'recover') {
      // 回复1点体力
      target.hp = Math.min(target.maxHp, (target.hp || 0) + 1);
      effectName = '回复1点体力';
    } else if (option === 'reset') {
      // 复原武将牌（将横置的武将牌变为正置）
      if (target.chained) {
        target.chained = false;
        effectName = '复原武将牌';
      } else {
        // 如果武将牌已经是正置，则提示
        g.log = pushLog(g.log, `${target.name} 的武将牌已经是正置状态`);
      }
    }
    
    if (effectName) {
      g.log = pushLog(g.log, `${target.name} 选择了【举荐】效果：${effectName}`);
    }
    
    // 标记已使用举荐
    g.jujiuUsed = true;
    
    // 清理状态
    g.pending = null;
    g.phase = 'end';
    
    return g;
  });
}

// 取消举荐
function cancelJujian() {
  tx(g => {
    if (g.pending && (g.pending.type === 'jujianPickCard' || 
        g.pending.type === 'jujianPickTarget' || 
        g.pending.type === 'jujianChooseEffect') &&
        g.pending.sourceSeat === mySeat) {
      g.pending = null;
      g.phase = 'end';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【举荐】`);
    }
    return g;
  });
}
```

---

## 五、渲染集成（render-controls.js）

### 无言 UI 集成

```javascript
// 无言为锁定技，无需UI操作，但在状态显示中可以标注
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 在武将技能显示中标注无言为锁定技
  if (hasCap(p, 'wuyan') && g.phase === 'play') {
    ui.innerHTML += `
      <div class="skill-indicator">
        <span class="locked-skill">【无言】(锁定技)</span>
      </div>
    `;
  }
}
```

### 举荐 UI 集成

```javascript
// 在 renderControls 中添加举荐相关状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 举荐：选择非基本牌
  if (g.pending && g.pending.type === 'jujianPickCard' && g.pending.sourceSeat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【举荐】选择非基本牌</h4>
        <p>选择要弃置的非基本牌：</p>
        <div class="card-options">
    `;
    
    for (let i = 0; i < g.pending.nonBasicCards.length; i++) {
      const card = g.pending.nonBasicCards[i];
      const isClickable = g.pending.candidates.includes(i);
      const cardClass = isClickable ? 'card-btn' : 'card-btn disabled';
      ui.innerHTML += `
        <button onclick="pickJujianCard(${i})" class="${cardClass}" ${isClickable ? '' : 'disabled'}>
          【${card.name}】
        </button>
      `;
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelJujian()" class="cancel-btn">取消</button>
      </div>
    `;
    return;
  }

  // 举荐：选择目标角色
  if (g.pending && g.pending.type === 'jujianPickTarget' && g.pending.sourceSeat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【举荐】选择目标角色</h4>
        <p>选择要赋予效果的角色：</p>
        <div class="target-options">
    `;
    
    for (let i = 0; i < g.pending.candidates.length; i++) {
      const tSeat = g.pending.candidates[i];
      const target = g.players[tSeat];
      ui.innerHTML += `
        <button onclick="pickJujianTarget(${tSeat})" class="target-btn">
          ${target.name}
        </button>
      `;
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelJujian()" class="cancel-btn">取消</button>
      </div>
    `;
    return;
  }

  // 举荐：目标选择效果
  if (g.pending && g.pending.type === 'jujianChooseEffect' && g.pending.targetSeat === seat) {
    const source = g.players[g.pending.sourceSeat];
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【举荐】选择效果</h4>
        <p>${source.name} 对你使用【举荐】，请选择：</p>
        <div class="options">
          <button onclick="chooseJujianEffect('draw')" class="skill-btn">
            摸两张牌
          </button>
          <button onclick="chooseJujianEffect('recover')" class="skill-btn">
            回复1点体力
          </button>
          <button onclick="chooseJujianEffect('reset')" class="skill-btn">
            复原武将牌
          </button>
        </div>
        <button onclick="cancelJujian()" class="cancel-btn">取消</button>
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
  '无言': 'wuyan',
  '举荐': 'jujian',
};
```

---

## 七、边界条件处理

### 无言

1. **非锦囊牌**：仅对锦囊牌（type === 'trick'）生效，基本牌和装备牌不触发
2. **自己对自己使用锦囊牌**：如果徐庶自己使用锦囊牌对自己造成伤害，不触发（因为是自己使用的）
3. **锦囊牌不造成伤害**：部分锦囊牌可能不造成伤害（如【无中生有】），需要验证是否为伤害类锦囊牌
4. **多个目标**：当锦囊牌对多个目标造成伤害时，徐庶作为其中一个目标时，仅防止对徐庶的伤害
5. **连锁效应**：防止伤害后，不触发其他与伤害相关的效果（如濒死、角色死亡等）
6. **牌的类型判断**：确保 `card.type` 字段存在且准确
7. **伤害来源验证**：需要确认伤害的来源是否为徐庶（使用锦囊牌）或目标是否为徐庶（受到锦囊牌伤害）

### 举荐

1. **没有非基本牌**：按钮不显示，直接进入结束阶段
2. **场上无其他存活角色**：选择非基本牌后，如果无其他存活角色，则提示无法继续，取消技能
3. **目标角色阵亡**：在选择效果阶段前验证目标角色是否存活
4. **武将牌已经正置**：选择复原武将牌效果时，如果目标角色武将牌已经是正置状态，则提示并重新选择或取消
5. **体力已满**：选择回复1点体力效果时，如果目标角色体力已满，则直接设置为最大体力值
6. **牌堆不足**：摸两张牌时，如果牌堆不足2张，使用 `ensureDeck(g)` 确保有足够的牌
7. **每回合多次使用**：使用 `g.jujiuUsed` 标志位确保每回合仅能使用一次
8. **取消技能**：在任何步骤都可以取消，恢复原始状态
9. **非基本牌的判断**：确保 `card.type !== 'basic'` 正确过滤基本牌

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **无言** | |
| 无言：徐庶使用锦囊牌攻击其他角色 | 防止此伤害，不扣减目标体力 |
| 无言：徐庶受到其他角色使用锦囊牌造成的伤害 | 防止此伤害，徐庶不扣减体力 |
| 无言：徐庶使用基本牌攻击其他角色 | 正常造成伤害 |
| 无言：徐庶受到其他角色使用基本牌造成的伤害 | 正常扣减体力 |
| 无言：徐庶使用锦囊牌对自己造成伤害 | 防止此伤害 |
| 无言：多个目标受到锦囊牌伤害，徐庶为其中之一 | 仅防止对徐庶的伤害，其他目标正常受伤 |
| **举荐** | |
| 举荐：徐庶有非基本牌，结束阶段 | 可以发动举荐 |
| 举荐：徐庶只有基本牌，结束阶段 | 不显示举荐按钮 |
| 举荐：场上无其他存活角色 | 提示无法继续，取消技能 |
| 举荐：选择弃置锦囊牌 | 进入选择目标角色阶段 |
| 举荐：选择弃置装备牌 | 进入选择目标角色阶段 |
| 举荐：选择弃置基本牌 | 无法选择，提示错误 |
| 举荐：目标选择摸两张牌 | 目标角色摸两张牌 |
| 举荐：目标选择回复1点体力 | 目标角色回复1点体力（不超过上限） |
| 举荐：目标选择复原武将牌（武将牌横置） | 武将牌变为正置 |
| 举荐：目标选择复原武将牌（武将牌已正置） | 提示已正置，无效果 |
| 举荐：目标体力已满，选择回复体力 | 体力保持最大值 |
| 举荐：牌堆仅剩1张牌，选择摸两张牌 | 先摸1张，再通过 ensureDeck 处理 |
| 举荐：每回合多次发动 | 仅第一次生效 |
| 举荐：取消技能 | 任何步骤都可以取消，状态恢复 |
| 举荐：发动过程中角色阵亡 | 清理状态，回到结束阶段 |

---

## 九、实现优先级

1. **无言优先**：锁定技，需要在伤害处理系统中集成，实现简单但需要覆盖所有伤害入口
2. **举荐选择非基本牌优先**：在结束阶段集成选择逻辑
3. **举荐选择目标角色优先**：目标选择和效果传递
4. **举荐效果实现优先**：摸牌、回复体力、复原武将牌三个效果的具体实现
5. **UI集成优先**：无言的状态显示和举荐的选择界面渲染
6. **边界处理优先**：特殊情况的处理和验证
7. **音效集成**：最后添加音效标识

---

## 十、集成要点

### 与现有系统的集成

1. **伤害系统**：
   - 复用现有的 `resolveDamage` 或 `damagePlayer` 函数
   - 在伤害计算前添加无言触发检查
   - 确保防止伤害后不触发后续效果

2. **阶段系统**：
   - 复用现有的结束阶段逻辑
   - 在 `endPhase` 中集成举荐触发

3. **牌类型系统**：
   - 使用现有的 `card.type` 字段判断牌的类型
   - 基本牌：'basic'，锦囊牌：'trick'，装备牌：'equip'

4. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程
   - 使用 `g.pending` 存储中间状态

5. **选择系统**：
   - 复用现有的 `isSeatClickable` 等函数
   - 为不同的选择阶段提供适当的UI

### 需要修改的文件

1. **data.js**：添加徐庶武将定义
2. **game.js**：
   - `normalize()`：添加举荐状态字段防御
   - `startTurn()`：添加举荐使用标志位重置
   - `resolveDamage()` 或 `damagePlayer()`：集成无言触发检查
   - `endPhase()`：集成举荐技能触发
3. **skills.js**：添加无言和举荐技能辅助函数
4. **render-controls.js**：添加举荐UI界面
5. **render.js**：可能需要添加状态显示

---

## 十一、流程图

### 无言完整流程

**造成伤害时**：
```
徐庶使用锦囊牌
    ↓
检查是否为锦囊牌（type === 'trick'）
    ↓
是：防止此伤害
    ↓
不执行伤害逻辑，直接返回
```

**受到伤害时**：
```
徐庶受到锦囊牌伤害
    ↓
检查是否为锦囊牌（type === 'trick'）
    ↓
是：防止此伤害
    ↓
不扣减体力，不触发后续效果
```

### 举荐完整流程

```
结束阶段
    ↓
检查是否有举荐技能且未使用过
    ↓
检查是否有非基本牌
    ↓
是：进入举荐流程
    ↓
选择要弃置的非基本牌
    ↓
弃置该牌到弃牌堆
    ↓
选择目标角色
    ↓
目标角色选择效果（摸牌/回复体力/复原武将牌）
    ↓
执行选择的效果
    ↓
标记举荐已使用
    ↓
回到结束阶段
```

---

## 十二、特殊说明

### 关于无言的触发时机

无言的触发分为两个独立的部分：

1. **使用锦囊牌造成伤害时**：当徐庶使用锦囊牌对其他角色造成伤害时
   - 必须是徐庶**使用**锦囊牌
   - 必须是该锦囊牌**造成伤害**
   - 防止的是对**所有目标**的伤害

2. **受到锦囊牌造成的伤害时**：当徐庶受到锦囊牌对自己造成的伤害时
   - 必须是**其他角色**使用锦囊牌对徐庶造成伤害
   - 防止的是对徐庶自身的伤害

### 关于举荐的流程

举荐是一个**多步骤**的技能，流程如下：

1. **选择牌**：在结束阶段，从手牌中选择一张非基本牌（锦囊牌或装备牌）
2. **弃置牌**：将选中的牌弃置到弃牌堆
3. **选择目标**：选择一名其他角色作为效果目标
4. **目标选择**：目标角色选择摸两张牌、回复1点体力或复原武将牌中的一个效果

注意：
- 每回合限使用一次
- 需要有非基本牌
- 需要场上有其他存活角色
- 复原武将牌仅对横置的武将牌生效

### 关于非基本牌的判断

通过 `card.type !== 'basic'` 来判断是否为非基本牌：
- 基本牌：type === 'basic'（如杀、闪、桃等）
- 非基本牌：type === 'trick'（锦囊牌）或 type === 'equip'（装备牌）

---

## 十三、修正记录

*文档状态：设计完成*
*创建时间：2026-07-13*
*负责人：Mistral Vibe*

### 设计说明
- **武将定位**：徐庶作为蜀国的谋士武将，技能设计体现其"言不尽意"（无言）和"举贤荐能"（举荐）的特点
- **无言**：锁定技，体现徐庶的"不言"特性，使其在锦囊牌交锋中具有免疫力
- **举荐**：主动技能，通过弃置非基本牌为他人提供多种益处，体现徐庶的"荐贤"特性

### 待实装项
- [ ] data.js: 添加徐庶武将定义
- [ ] game.js: 状态字段扩展和回合重置
- [ ] game.js: 无言伤害防止集成
- [ ] game.js: 举荐技能集成
- [ ] skills.js: 无言和举荐技能函数
- [ ] render-controls.js: 举荐UI界面
- [ ] 音效文件：需要添加assets/audio/wuyan.mp3和assets/audio/jujian.mp3

### 待优化项
- 收集更多测试场景
- 优化多步骤选择的用户体验
- 考虑AI决策逻辑的集成
