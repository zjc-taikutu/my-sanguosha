# 曹植 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `caozhi` |
| **武将名称** | 曹植 |
| **势力** | 魏 |
| **性别** | male |
| **体力上限** | 3 |
| **技能** | 落英 / 酒诗 |

---

## 二、技能说明

### 落英
**时机**：其他角色的♣️牌因判定或弃置而置入弃牌堆时

**效果**：
你可以获得这些♣️牌。

**设计要点**：
- 属于**被动触发技能**，需监听牌置入弃牌堆的事件
- 触发条件：
  - 牌的来源是**其他角色**（非自己）
  - 牌的花色是**♣️（梅花）**
  - 牌置入弃牌堆的方式是**判定**或**弃置**（非损失等其他方式）
- 获得时机：**牌置入弃牌堆后**，在下一个动作前询问是否获得
- 可选择性：**可以获得**或**不获得**，需提供选择界面

---

### 酒诗
**时机**：
1. 当你需要使用【酒】时
2. 当你受到伤害后

**效果**：
1. 若你的武将牌**正面朝上**，你可以翻面，视为使用一张【酒】
2. 若你的武将牌**背面朝上**且于受到此伤害时也背面朝上，你可以翻面

**设计要点**：
- **酒诗①**是**主动发动的视为使用**技能，需集成到【酒】使用流程中
- **酒诗②**是**受到伤害后的触发技能**，需集成到伤害结算流程中
- 武将牌朝向状态需在游戏状态中维护
- 翻面操作为**可选行为**，需提供选择界面
- 视为使用【酒】后，正常触发【酒】的后续效果（如桃的效果）
- 翻面不改变当前回合的阶段

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
caozhi: {
  id: 'caozhi',
  name: '曹植',
  gender: 'male',
  maxHp: 3,
  skill: '落英/酒诗',
  desc: '落英:当其他角色的♣️牌因判定或弃置而置入弃牌堆时,你可以获得之。酒诗:①当你需要使用【酒】时,若你的武将牌正面朝上,你可以翻面,视为使用一张【酒】;②当你受到伤害后,若你的武将牌背面朝上且于受到此伤害时也背面朝上,你可以翻面。',
  caps: { luoying: true, jiushi: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 曹植【酒诗】:武将牌朝向状态（true=正面朝上，false=背面朝上）
if(typeof g.playerFacedown !== 'object') g.playerFacedown = {};
for(let i = 0; i < g.players.length; i++) {
  if(typeof g.playerFacedown[i] !== 'boolean') g.playerFacedown[i] = false;
}

// 曹植【落英】:处理牌置入弃牌堆的pending状态
if(g.pending && g.pending.type === 'luoyingGain') {
  const d = g.pending;
  if(!Array.isArray(d.cards) || d.cards.length === 0 ||
     typeof d.fromSeat !== 'number' || !g.players[d.fromSeat] ||
     !g.players[d.fromSeat].alive ||
     typeof d.seat !== 'number' || !g.players[d.seat] ||
     !g.players[d.seat].alive) {
    g.pending = null;
  }
}

// 曹植【酒诗】:使用酒的pending状态
if(g.pending && g.pending.type === 'jiushiUseWine') {
  const d = g.pending;
  if(typeof d.seat !== 'number' || !g.players[d.seat] || !g.players[d.seat].alive) {
    g.pending = null;
  }
}

// 曹植【酒诗】:受到伤害后翻面的pending状态
if(g.pending && g.pending.type === 'jiushiFlip') {
  const d = g.pending;
  if(typeof d.seat !== 'number' || !g.players[d.seat] || !g.players[d.seat].alive) {
    g.pending = null;
  }
}
```

在 `startTurn` 函数中添加重置（如有需要）：
```javascript
// 武将牌朝向在回合开始时不自动重置
// 但可以根据游戏规则在特定时机重置（如回合结束时自动翻回正面）
// 根据三国杀标准规则，武将牌在回合结束时自动翻回正面
for(let i = 0; i < g.players.length; i++) {
  g.playerFacedown[i] = false; // 回合结束时翻回正面
}
```

---

## 四、技能实现

### 落英实现

**集成点**：牌置入弃牌堆的通用处理函数

```javascript
// 在牌置入弃牌堆时触发落英
function handleDiscardToPile(g, cards, fromSeat, reason) {
  // reason: 'judge' (判定), 'discard' (弃置), 'lose' (损失) 等
  
  if (!['judge', 'discard'].includes(reason)) return;
  
  // 遍历所有置入弃牌堆的牌
  for (const card of cards) {
    if (card.suit === 'club') { // ♣️梅花
      // 检查所有存活的曹植
      for (let i = 0; i < g.players.length; i++) {
        if (i === fromSeat) continue; // 排除牌的来源角色
        if (!g.players[i] || !g.players[i].alive) continue;
        if (!generalHasCap(g.players[i], 'luoying')) continue;
        
        // 为每个符合条件的曹植创建pending
        g.pending = {
          type: 'luoyingGain',
          seat: i,
          fromSeat: fromSeat,
          cards: [card],
          reason: reason
        };
        g.log = pushLog(g.log, `${g.players[i].name} 可以发动【落英】获得 ${card.name}`);
        markSkillSound(g, '落英');
        
        // 注意：如果多个曹植同时存在，需处理多个pending的情况
        // 这里简化处理，实际实现可能需要更复杂的逻辑
        break; // 先处理一个，实际需要根据游戏规则决定
      }
    }
  }
}

// 落英获得牌的选择处理
function handleLuoyingGain(accept) {
  tx(g => {
    if (g.pending.type !== 'luoyingGain' || !g.pending.cards || g.pending.cards.length === 0) return g;
    
    const me = g.players[g.pending.seat];
    const fromSeat = g.pending.fromSeat;
    const cards = g.pending.cards;
    
    if (!me || !me.alive) return g;
    
    if (accept) {
      // 获得这些牌
      me.hand.push(...cards);
      // 从弃牌堆中移除这些牌
      for (const card of cards) {
        const index = g.discard.indexOf(card);
        if (index > -1) {
          g.discard.splice(index, 1);
        }
      }
      g.log = pushLog(g.log, `${me.name} 发动【落英】,获得了 ${cards.map(c => c.name).join('、')}`);
    } else {
      g.log = pushLog(g.log, `${me.name} 未发动【落英】`);
    }
    
    g.pending = null;
    return g;
  });
}
```

---

### 酒诗实现

**集成点**：
1. 需要使用【酒】的时机（如使用桃时）
2. 受到伤害后的流程

```javascript
// 酒诗①：当需要使用酒时
// 在需要使用酒的流程中集成
function needUseWine(g, seat) {
  const me = g.players[seat];
  
  // 检查是否可以发动酒诗
  if (me && me.alive && generalHasCap(me, 'jiushi') && !g.playerFacedown[seat]) {
    // 武将牌正面朝上，可以翻面视为使用酒
    g.pending = {
      type: 'jiushiUseWine',
      seat: seat
    };
    g.log = pushLog(g.log, `${me.name} 可以发动【酒诗】翻面视为使用【酒】`);
    markSkillSound(g, '酒诗');
    return true; // 表示有等待选择
  }
  return false;
}

// 处理酒诗使用酒的选择
function handleJiushiUseWine(accept) {
  tx(g => {
    if (g.pending.type !== 'jiushiUseWine') return g;
    
    const me = g.players[g.pending.seat];
    if (!me || !me.alive) return g;
    
    if (accept) {
      // 翻面
      g.playerFacedown[g.pending.seat] = true;
      g.log = pushLog(g.log, `${me.name} 发动【酒诗】,翻面视为使用【酒】`);
      
      // 视为使用酒，继续后续流程
      // 这里需要根据具体使用酒的场景调用相应的函数
      // 例如：如果是在使用桃，则继续桃的效果
      return continueAfterWine(g, g.pending.seat);
    } else {
      g.log = pushLog(g.log, `${me.name} 未发动【酒诗】`);
      // 继续其他使用酒的方式
    }
    
    g.pending = null;
    return g;
  });
}

// 酒诗②：当受到伤害后
// 在 damage settlement 后集成
function handleDamageAfter(g, damagedSeat, damageInfo) {
  const me = g.players[damagedSeat];
  
  // 检查是否可以发动酒诗②
  if (me && me.alive && generalHasCap(me, 'jiushi') && 
      g.playerFacedown[damagedSeat] &&
      damageInfo.facedownAtDamage) {
    
    g.pending = {
      type: 'jiushiFlip',
      seat: damagedSeat
    };
    g.log = pushLog(g.log, `${me.name} 可以发动【酒诗】翻面`);
    markSkillSound(g, '酒诗');
  }
}

// 处理酒诗翻面的选择
function handleJiushiFlip(accept) {
  tx(g => {
    if (g.pending.type !== 'jiushiFlip') return g;
    
    const me = g.players[g.pending.seat];
    if (!me || !me.alive) return g;
    
    if (accept) {
      // 翻面
      g.playerFacedown[g.pending.seat] = false;
      g.log = pushLog(g.log, `${me.name} 发动【酒诗】,翻回正面`);
    } else {
      g.log = pushLog(g.log, `${me.name} 未发动【酒诗】`);
    }
    
    g.pending = null;
    return g;
  });
}

// 在 dealDamage 函数中记录受到伤害时的朝向状态
function dealDamage(g, targetSeat, amount, sourceSeat, reason, skill) {
  const target = g.players[targetSeat];
  if (!target || !target.alive) return g;
  
  // 记录受到伤害时的朝向状态
  const facedownAtDamage = g.playerFacedown[targetSeat] || false;
  
  // ... 处理伤害 ...
  
  // 在伤害结算后调用酒诗②的检查
  const damageInfo = {
    amount: amount,
    sourceSeat: sourceSeat,
    reason: reason,
    skill: skill,
    facedownAtDamage: facedownAtDamage
  };
  
  handleDamageAfter(g, targetSeat, damageInfo);
  
  return g;
}
```

---

## 五、渲染集成（render-controls.js）

### 落英获得选择UI

```javascript
// 在 renderControls 中添加落英获得选择
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 落英获得选择
  if (g.pending && g.pending.type === 'luoyingGain' && g.pending.seat === seat) {
    const cards = g.pending.cards || [];
    const fromPlayer = g.players[g.pending.fromSeat];
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【落英】获得牌</h4>
        <p>${fromPlayer.name} 的 ${cards.map(c => c.name).join('、')} 因 ${g.pending.reason === 'judge' ? '判定' : '弃置'} 置入弃牌堆</p>
        <p>你可以获得这些♣️牌</p>
        <button onclick="handleLuoyingGain(true)" class="confirm-btn" style="background: #4a90d9;">
          获得
        </button>
        <button onclick="handleLuoyingGain(false)" class="cancel-btn">
          不获得
        </button>
      </div>
    `;
    return;
  }
}
```

### 酒诗使用酒选择UI

```javascript
// 酒诗使用酒选择
if (g.pending && g.pending.type === 'jiushiUseWine' && g.pending.seat === seat) {
  ui.innerHTML += `
    <div class="skill-choose">
      <h4>【酒诗】视为使用酒</h4>
      <p>你需要使用【酒】，可以翻面视为使用</p>
      <button onclick="handleJiushiUseWine(true)" class="confirm-btn" style="background: #d4a762;">
        翻面视为使用酒
      </button>
      <button onclick="handleJiushiUseWine(false)" class="cancel-btn">
        不发动
      </button>
    </div>
  `;
  return;
}

// 酒诗受到伤害后翻面选择
if (g.pending && g.pending.type === 'jiushiFlip' && g.pending.seat === seat) {
  ui.innerHTML += `
    <div class="skill-choose">
      <h4>【酒诗】翻面</h4>
      <p>你受到伤害且武将牌背面朝上，可以翻回正面</p>
      <button onclick="handleJiushiFlip(true)" class="confirm-btn" style="background: #d4a762;">
        翻回正面
      </button>
      <button onclick="handleJiushiFlip(false)" class="cancel-btn">
        不翻面
      </button>
    </div>
  `;
  return;
}
```

### 武将牌朝向显示

在 `render.js` 中添加武将牌朝向的显示：

```javascript
function renderPlayer(g, seat) {
  // ... 现有代码 ...
  
  const isFacedown = g.playerFacedown && g.playerFacedown[seat];
  
  if (isFacedown) {
    // 显示背面朝上的武将牌
    playerElement.classList.add('facedown');
    // 可以添加背面朝上的视觉效果
  } else {
    playerElement.classList.remove('facedown');
  }
  
  // ... 其余代码 ...
}
```

---

## 六、音效标识

在 `markSkillSound` 中添加：
```javascript
const SKILL_SOUNDS = {
  // ... 现有技能 ...
  '落英': 'luoying',
  '酒诗': 'jiushi',
};
```

---

## 七、边界条件处理

### 落英
1. **多张♣️牌同时置入弃牌堆**：可以一次性获得所有符合条件的♣️牌
2. **多个曹植同时存在**：每个曹植都可以独立选择是否获得牌
3. **牌的来源是自己**：不触发落英（技能描述为"其他角色"）
4. **牌置入方式不是判定或弃置**：不触发（如因损失、移交等置入弃牌堆）
5. **弃牌堆为空**：不触发
6. **获得到非♣️牌**：需要验证牌的花色
7. **目标角色不存活**：在pending验证时排除

### 酒诗
1. **武将牌正面朝上时需要使用酒**：
   - 可以选择翻面视为使用酒
   - 翻面后武将牌变为背面朝上
2. **武将牌背面朝上时需要使用酒**：无法发动酒诗①
3. **受到伤害时武将牌正面朝上**：无法发动酒诗②
4. **受到伤害时武将牌背面朝上，但伤害结算后翻回正面**：
   - 需要判断的是"受到此伤害时"的状态
   - 在伤害结算时记录当前状态
5. **多次受到伤害**：每次受到伤害后都可以独立发动酒诗②
6. **翻面时武将牌不存活**：pending验证时排除
7. **连锁触发**：酒诗翻面后可能触发其他技能

### 武将牌朝向状态管理
1. **回合开始时**：武将牌应为正面朝上
2. **回合结束时**：武将牌翻回正面朝上（根据标准三国杀规则）
3. **多个技能翻面**：需要正确处理武将牌朝向的变化
4. **游戏开始时**：所有武将牌默认为正面朝上

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **落英**：其他角色判定♣️牌置入弃牌堆 | 曹植可以选择获得此牌 |
| **落英**：其他角色弃置♣️牌置入弃牌堆 | 曹植可以选择获得此牌 |
| **落英**：其他角色判定非♣️牌置入弃牌堆 | 曹植不触发落英 |
| **落英**：曹植自己判定♣️牌置入弃牌堆 | 曹植不触发落英（非其他角色） |
| **落英**：其他角色弃置多张♣️牌 | 曹植可以选择获得所有这些牌 |
| **落英**：多个曹植同时存在 | 每个曹植都可以独立选择是否获得牌 |
| **落英**：选择不获得牌 | 牌留在弃牌堆，不触发后续效果 |
| **酒诗①**：需要使用酒且武将牌正面朝上 | 可以选择翻面视为使用酒 |
| **酒诗①**：需要使用酒且武将牌背面朝上 | 无法发动酒诗① |
| **酒诗①**：翻面视为使用酒后 | 正常触发酒的后续效果 |
| **酒诗②**：受到伤害且武将牌背面朝上 | 可以选择翻回正面 |
| **酒诗②**：受到伤害且武将牌正面朝上 | 无法发动酒诗② |
| **酒诗②**：受到伤害时武将牌背面朝上，伤害后翻回正面 | 可以发动酒诗② |
| **酒诗②**：受到多次伤害 | 每次都可以独立发动酒诗② |
| **酒诗**：翻面操作 | 武将牌朝向状态正确切换 |
| **酒诗+落英**：同时触发两个技能 | 两个技能独立处理，不互相干扰 |
| **回合开始**：武将牌状态 | 武将牌应为正面朝上 |
| **回合结束**：武将牌状态 | 武将牌翻回正面朝上 |

---

## 九、实现优先级

1. **武将牌朝向状态管理**（最高优先级）- 整个酒诗技能的基础
2. **落英触发机制** - 被动技能，相对简单
3. **酒诗②受到伤害后的翻面** - 逻辑清晰，与朝向状态直接相关
4. **酒诗①使用酒的视为机制** - 需要集成到现有的酒使用流程中
5. **UI集成** - 所有技能都需要界面支持
6. **边界条件处理** - 确保所有特殊情况正确处理

---

## 十、集成要点

### 与现有系统的集成

1. **阶段系统**：
   - 复用现有的 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程

2. **牌处理系统**：
   - 复用现有的牌置入弃牌堆的监听机制
   - 正确处理牌从弃牌堆移除并添加到手牌的操作

3. **伤害系统**：
   - 在 `dealDamage` 中集成酒诗②的检查
   - 记录受到伤害时的武将牌朝向状态

4. **酒使用系统**：
   - 在需要使用酒的流程中集成酒诗①的检查
   - 视为使用酒后继续后续流程

5. **状态管理**：
   - 在 `normalize` 中初始化武将牌朝向状态
   - 在 `startTurn` 中重置武将牌朝向（根据规则）

### 需要修改的文件

1. **data.js**：添加曹植武将定义
2. **game.js**：
   - `normalize()`：添加状态字段防御
   - `startTurn()`：重置武将牌朝向状态
   - 牌置入弃牌堆的处理函数：集成落英触发
   - `dealDamage()`：集成酒诗②的检查
3. **skills.js**：添加落英和酒诗技能辅助函数
4. **render-controls.js**：添加落英和酒诗的UI界面
5. **render.js**：添加武将牌朝向状态的显示

---

## 十一、流程图

### 落英发动流程
```
其他角色的♣️牌因判定或弃置置入弃牌堆
    ↓
检查是否有曹植（且非牌的来源角色）
    ↓
有: 为每个符合条件的曹植创建pending
    ↓
玩家选择是否获得牌
    ↓
  ┌─ 获得 → 牌从弃牌堆移除，添加到曹植手牌
  │
  └─ 不获得 → 牌留在弃牌堆
    ↓
清理pending
```

### 酒诗①发动流程
```
需要使用【酒】
    ↓
检查是否为曹植且武将牌正面朝上
    ↓
是: 创建pending询问是否发动
    ↓
玩家选择是否翻面
    ↓
  ┌─ 翻面 → 武将牌翻面（背面朝上），视为使用【酒】
  │         ↓
  │         继续酒的后续效果
  │
  └─ 不发动 → 继续其他使用酒的方式
    ↓
清理pending
```

### 酒诗②发动流程
```
角色受到伤害
    ↓
记录受到伤害时的武将牌朝向状态
    ↓
伤害结算完成
    ↓
检查是否为曹植且武将牌背面朝上且受到伤害时也背面朝上
    ↓
是: 创建pending询问是否翻面
    ↓
玩家选择是否翻面
    ↓
  ┌─ 翻面 → 武将牌翻回正面
  └─ 不翻面 → 保持背面朝上
    ↓
清理pending
```

---

## 十二、特殊说明

### 关于落英的触发时机

落英的触发时机是"当其他角色的♣️牌因判定或弃置而置入弃牌堆时"。需要特别注意：

1. **判定**：指判定区的牌判定完成后置入弃牌堆
2. **弃置**：指玩家主动弃置手牌或装备区的牌
3. **其他方式**：如因技能效果损失牌、移交牌等，不触发落英

在实现时，需要在牌置入弃牌堆的统一入口处添加落英的触发检查。

### 关于酒诗的两个效果

酒诗包含两个独立的效果：

1. **效果①**：是主动发动的"视为使用"技能，当需要使用酒时可以选择发动
2. **效果②**：是受到伤害后的触发技能，满足条件时可以选择发动

这两个效果互相独立，发动一个不影响另一个的发动。

### 关于武将牌朝向状态

武将牌的朝向状态在游戏中具有重要意义：
- 正面朝上（false）：武将牌显示正面，可以正常发动技能
- 背面朝上（true）：武将牌显示背面，可能限制某些技能的发动

根据标准三国杀规则：
- 武将牌在回合开始时应为正面朝上
- 武将牌在回合结束时自动翻回正面朝上
- 翻面是一个可以被其他技能或效果影响的状态

### 与其他技能的协同

1. **与酒相关的技能**：酒诗①视为使用酒，可以触发其他与酒相关的技能
2. **与翻面相关的技能**：酒诗的翻面可以与其他翻面技能产生协同
3. **与获得牌相关的技能**：落英获得牌可以触发其他获得牌时的技能
4. **与弃牌相关的技能**：落英的触发依赖于其他角色的弃牌动作

---

*文档状态：设计阶段*
*创建时间：2026-07-13*
*修正时间：2026-07-13*
*负责人：Mistral Vibe*
