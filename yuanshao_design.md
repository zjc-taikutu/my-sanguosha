# 袁绍 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `yuanshao` |
| **武将名称** | 袁绍 |
| **势力** | 群 |
| **性别** | male |
| **体力上限** | 4 |
| **技能** | 乱击 |

---

## 二、技能说明

### 乱击
**时机**：出牌阶段

**效果**：
你可以将两张花色相同的手牌当【万箭齐发】使用。

**设计要点**：
- 属于**视为使用**技能，需要集成到出牌阶段的牌选择流程中
- 需要选择两张**花色相同**的手牌（红桃、黑桃、梅花、方块各自独立计算）
- 视为使用的是【万箭齐发】，因此触发万箭齐发的正常效果：其他所有角色各需打出一张【闪】，打不出的受到1点伤害
- 使用后这两张牌被弃置，正常进入弃牌堆
- 需要检查使用者是否在出牌阶段
- 需要验证使用者手牌中是否有至少两张花色相同的手牌

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
yuanshao: {
  id: 'yuanshao',
  name: '袁绍',
  gender: 'male',
  maxHp: 4,
  skill: '乱击',
  desc: '乱击:出牌阶段,你可以将两张花色相同的手牌当【万箭齐发】使用。',
  caps: { luanji: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 袁绍【乱击】:选择阶段
// pending 应包含 type、sourceSeat（袁绍的座位）、availablePairs（可选的花色相同的牌对）
if(g.pending && g.pending.type==='luanjiChoose'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     !Array.isArray(d.availablePairs) || d.availablePairs.length===0 ||
     d.sourceSeat !== mySeat){
    g.pending = null;
    g.phase = 'play';
  }
}

// 袁绍【乱击】:确认使用阶段
// pending 应包含 type、sourceSeat、cardIndices（选择的两张牌的索引）
if(g.pending && g.pending.type==='luanjiConfirm'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     !Array.isArray(d.cardIndices) || d.cardIndices.length !== 2 ||
     d.sourceSeat !== mySeat){
    g.pending = null;
    g.phase = 'play';
  }
}
```

在 `startTurn` 函数中无需添加重置项（乱击不限次数）

---

## 四、技能实现

### 乱击实现

**UI触发点**：`render-controls.js` 添加乱击按钮

```javascript
// 在 renderControls 中添加乱击选择逻辑
function renderControls(g, me) {
  // ... 现有代码 ...

  if (hasCap(me, 'luanji') && g.phase === 'play' && g.turn === mySeat) {
    // 检查是否有至少两张花色相同的手牌
    const suitCount = {};
    const hand = me.hand || [];
    for (const card of hand) {
      const suit = card.suit;
      suitCount[suit] = (suitCount[suit] || 0) + 1;
    }
    
    const hasPairs = Object.values(suitCount).some(count => count >= 2);
    
    if (hasPairs) {
      ui.innerHTML += `
        <button onclick="startLuanji()" class="skill-btn" style="background: #9b59b6;">
          乱击
        </button>
      `;
    }
  }
}
```

```javascript
// 乱击选择流程
function startLuanji() {
  tx(g => {
    const me = g.players[mySeat];
    if (!me || !me.alive || g.phase !== 'play' || g.turn !== mySeat) return g;
    
    // 检查手牌中花色相同的牌
    const hand = me.hand || [];
    const suitGroups = {}; // 按花色分组
    
    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      const suit = card.suit;
      if (!suitGroups[suit]) {
        suitGroups[suit] = [];
      }
      suitGroups[suit].push(i);
    }
    
    // 找出所有可以组合的牌对（至少两张相同花色）
    const availablePairs = [];
    for (const [suit, indices] of Object.entries(suitGroups)) {
      if (indices.length >= 2) {
        // 生成所有可能的牌对组合
        for (let i = 0; i < indices.length; i++) {
          for (let j = i + 1; j < indices.length; j++) {
            availablePairs.push([indices[i], indices[j]]);
          }
        }
      }
    }
    
    if (availablePairs.length === 0) {
      g.log = pushLog(g.log, `${me.name} 发动【乱击】失败:没有花色相同的手牌`);
      return g;
    }
    
    // 进入乱击选择阶段
    g.pending = {
      type: 'luanjiChoose',
      sourceSeat: mySeat,
      availablePairs: availablePairs
    };
    g.phase = 'luanjiChoose';
    g.log = pushLog(g.log, `${me.name} 发动【乱击】,选择两张花色相同的手牌当【万箭齐发】使用`);
    markSkillSound(g, '乱击');
    
    return g;
  });
}
```

```javascript
// 乱击选择牌对函数
function pickLuanjiPair(pairIndex) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'luanjiChoose' || pending.sourceSeat !== mySeat) return g;
    
    if (pairIndex < 0 || pairIndex >= pending.availablePairs.length) return g;
    
    const me = g.players[mySeat];
    const cardIndices = pending.availablePairs[pairIndex];
    const cards = [me.hand[cardIndices[0]], me.hand[cardIndices[1]]];
    
    // 验证这两张牌是否仍然存在且花色相同
    if (!cards[0] || !cards[1] || cards[0].suit !== cards[1].suit) {
      g.log = pushLog(g.log, `${me.name} 选择的牌组合无效`);
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 进入确认阶段
    g.pending = {
      type: 'luanjiConfirm',
      sourceSeat: mySeat,
      cardIndices: cardIndices
    };
    g.phase = 'luanjiConfirm';
    g.log = pushLog(g.log, `${me.name} 选择了【${cards[0].name}】和【${cards[1].name}】,确认当【万箭齐发】使用吗?`);
    
    return g;
  });
}
```

```javascript
// 确认使用乱击
function confirmLuanji() {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'luanjiConfirm' || pending.sourceSeat !== mySeat) return g;
    
    const me = g.players[mySeat];
    const cardIndices = pending.cardIndices;
    
    // 移除这两张手牌
    const removedCards = [];
    const hand = me.hand || [];
    
    // 按降序排列索引，避免移除后影响后面的索引
    cardIndices.sort((a, b) => b - a);
    
    for (const idx of cardIndices) {
      if (idx >= 0 && idx < hand.length) {
        removedCards.push(hand.splice(idx, 1)[0]);
      }
    }
    
    if (removedCards.length !== 2) {
      g.log = pushLog(g.log, `${me.name} 使用【乱击】失败:牌数量不足`);
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 视为使用万箭齐发
    g.log = pushLog(g.log, `${me.name} 将【${removedCards[0].name}】和【${removedCards[1].name}】当【万箭齐发】使用`);
    
    // 执行万箭齐发效果
    const wanjianEffect = CARD_PLAYS['万箭齐发'];
    if (wanjianEffect && wanjianEffect.effect) {
      wanjianEffect.effect(g, me, { name: '万箭齐发', suit: removedCards[0].suit });
    }
    
    // 清理状态
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}
```

```javascript
// 取消乱击
function cancelLuanji() {
  tx(g => {
    if (g.pending && (g.pending.type === 'luanjiChoose' || g.pending.type === 'luanjiConfirm') &&
        g.pending.sourceSeat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【乱击】`);
    }
    return g;
  });
}
```

---

## 五、渲染集成（render-controls.js）

### 乱击 UI 集成

```javascript
// 在 renderControls 中添加乱击选择状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 乱击：选择牌对阶段
  if (g.pending && g.pending.type === 'luanjiChoose' && g.pending.sourceSeat === seat) {
    const hand = p.hand || [];
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【乱击】发动</h4>
        <p>请选择两张花色相同的手牌当【万箭齐发】使用</p>
        <div class="hand-options">
    `;
    
    // 按花色分组显示
    const suitGroups = {};
    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      const suit = card.suit;
      if (!suitGroups[suit]) {
        suitGroups[suit] = [];
      }
      suitGroups[suit].push({ index: i, card: card });
    }
    
    // 为每个花色组显示可选的牌对
    for (const [suit, cards] of Object.entries(suitGroups)) {
      if (cards.length >= 2) {
        ui.innerHTML += `<h5>${suit}花色组:</h5>`;
        
        // 显示所有可能的牌对
        for (let i = 0; i < cards.length; i++) {
          for (let j = i + 1; j < cards.length; j++) {
            const pairIndex = g.pending.availablePairs.findIndex(
              pair => pair[0] === cards[i].index && pair[1] === cards[j].index
            );
            
            ui.innerHTML += `
              <button onclick="pickLuanjiPair(${pairIndex})" class="card-btn">
                【${cards[i].card.name}】+【${cards[j].card.name}】
              </button>
            `;
          }
        }
      }
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelLuanji()" class="cancel-btn">
          不发动
        </button>
      </div>
    `;
    return;
  }

  // 乱击：确认阶段
  if (g.pending && g.pending.type === 'luanjiConfirm' && g.pending.sourceSeat === seat) {
    const cardIndices = g.pending.cardIndices;
    const cards = [p.hand[cardIndices[0]], p.hand[cardIndices[1]]];
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【乱击】确认</h4>
        <p>确认使用【${cards[0].name}】和【${cards[1].name}】当【万箭齐发】使用吗?</p>
        <button onclick="confirmLuanji()" class="skill-btn" style="background: #27ae60;">
          确认
        </button>
        <button onclick="cancelLuanji()" class="cancel-btn">
          取消
        </button>
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
  '乱击': 'luanji',
};
```

---

## 七、边界条件处理

### 乱击
1. **无花色相同的手牌**：按钮不显示，或者显示但提示无法使用
2. **手牌数量不足**：按钮不显示，或者显示但提示无法使用
3. **万箭齐发效果触发**：确保正确执行万箭齐发的群体效果
4. **使用后的牌处理**：两张牌被弃置，正常进入弃牌堆
5. **目标选择**：万箭齐发的目标是除使用者外的所有角色
6. **连锁处理**：乱击使用后的结算应与普通万箭齐发一致
7. **取消操作**：在选择和确认阶段都应能取消

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **乱击** |
| 乱击：出牌阶段，有两张红桃手牌 | 可以发动乱击，选择两张红桃当万箭齐发使用 |
| 乱击：出牌阶段，有两张方块手牌 | 可以发动乱击，选择两张方块当万箭齐发使用 |
| 乱击：出牌阶段，有三张梅花手牌 | 可以选择任意两张梅花当万箭齐发使用 |
| 乱击：出牌阶段，无花色相同的手牌 | 乱击按钮不显示或显示为不可用 |
| 乱击：出牌阶段，只有1张手牌 | 乱击按钮不显示 |
| 乱击：使用后，其他角色需打出闪 | 触发万箭齐发效果，所有其他角色需响应 |
| 乱击：其他角色打不出闪 | 受到1点伤害 |
| 乱击：取消选择 | 回到出牌阶段，不消耗手牌 |
| 边界：牌堆不足，使用乱击 | 乱击仍然可以发动，万箭齐发效果正常执行 |

---

## 九、实现优先级

1. **乱击优先**：需要新的UI交互流程，涉及牌的选择和确认
2. **UI集成优先**：乱击的牌选择界面
3. **边界处理优先**：无合法牌、取消操作等边界条件
4. **音效集成**：添加技能音效
5. **测试验证**：确保所有场景都通过测试

---

## 十、集成要点

### 与现有系统的集成

1. **万箭齐发系统**：
   - 复用现有的 `aoeEffect` 函数和万箭齐发的效果处理
   - 确保乱击视为的万箭齐发与真实的万箭齐发具有相同的效果

2. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程

3. **目标选择系统**：
   - 乱击的牌选择需要特殊的选择界面

4. **日志系统**：
   - 为乱击的发动添加对应的日志记录
   - 确保日志清晰地反映技能的发动和效果

### 需要修改的文件

1. **data.js**：
   - 添加袁绍武将定义

2. **game.js**：
   - `normalize()`：添加乱击状态字段防御
   - 添加 `startLuanji`、`pickLuanjiPair`、`confirmLuanji`、`cancelLuanji` 函数

3. **render-controls.js**：
   - 添加乱击的UI界面
   - 添加技能按钮和交互逻辑

4. **render.js**（如需要）：
   - 添加状态显示（如需要）

---

## 十一、流程图

### 乱击完整流程
```
出牌阶段
    ↓
检查是否有至少两张花色相同的手牌
    ↓
是：显示乱击按钮
    ↓
玩家点击乱击按钮
    ↓
进入乱击选择阶段，显示可选的牌对
    ↓
玩家选择一对花色相同的手牌
    ↓
进入确认阶段
    ↓
玩家确认使用
    ↓
移除选中的两张手牌
    ↓
视为使用万箭齐发
    ↓
执行万箭齐发效果（所有其他角色需打出闪）
    ↓
清理状态，回到出牌阶段
```

---

## 十二、特殊说明

### 关于乱击的技能定位

乱击是袁绍的主要输出手段之一，允许他通过牺牲两张同花色的手牌来发动群体攻击。这体现了袁绍作为群雄的领袖角色，具备一定的群体控制能力。

**技能特点**：
- 无次数限制：出牌阶段可以多次使用乱击（只要有足够的同花色手牌）
- 资源消耗：每次使用需要消耗两张手牌
- 群体效果：相当于免费使用万箭齐发，对所有其他角色造成压力

### 关于技能平衡性

袁绍作为4体力的群雄武将，乱击提供了群体攻击手段：
- 乱击提供了群体攻击手段
- 这与标准三国杀中的袁绍定位一致，作为群雄势力的代表，具备一定的战斗力

### 关于与其他技能的交互

1. **与锦囊的交互**：
   - 乱击视为的万箭齐发应正常触发相关的锦囊效果
   - 其他角色可以用无懈可击响应乱击产生的万箭齐发

---

## 十三、修正记录

*文档状态：设计阶段*
*创建时间：2026-07-12*
*负责人：Mistral Vibe*

### 待实装项

- [ ] **data.js**: 添加袁绍武将定义
- [ ] **game.js**: 
  - [ ] normalize函数：添加乱击状态字段防御
  - [ ] 添加乱击相关函数
- [ ] **render-controls.js**: 
  - [ ] 添加乱击UI界面
- [ ] **render.js**: 添加状态显示（如需要）

### 待优化项

- 音效文件：需要添加assets/audio/luanji.mp3
- UI/UX：乱击选择界面的用户体验优化
- 性能：牌选择时的性能优化
- 兼容性：确保与现有所有技能的兼容性
