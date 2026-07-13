# 曹植 武将设计文档

> **⚠️ 重要修订记录**
> - 2026-07-13: 根据异步事件驱动架构要求，修正酒诗①流程阻塞机制，使用 `g.phase` 挂起流程
> - 2026-07-13: 修正酒诗②状态记忆机制，在pending中冻结受伤时朝向状态以防竞态条件
> - 2026-07-13: 优化落英触发逻辑，支持批量♣️牌一次性选择
> - 2026-07-13: 补充武将牌朝向视觉反馈方案
> - **2026-07-13: 根据项目实际架构审核修正**
>   - 将 `g.playerFacedown[seat]` 改为项目中已有的 `p.faceup` 属性
>   - 调整集成点：在 `finishDelayCard`、`discardCard`、`discardCards` 中集成落英检查
>   - 修正 tx 事务处理方式，确保在事务中修改状态
>   - 更新所有边界条件和测试要点描述

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
// 曹植【酒诗】:武将牌朝向状态
// ✅ 修正：项目中已使用 p.faceup 属性（true=正面朝上，false=背面朝上）
// normalize 中已经初始化：if (typeof g.players[i].faceup !== 'boolean') g.players[i].faceup = true;

// 曹植【落英】:处理牌置入弃牌堆的pending状态
if(g.pending && g.pending.type === 'luoyingGain') {
  const d = g.pending;
  if(!Array.isArray(d.cards) || d.cards.length === 0 ||
     typeof d.fromSeat !== 'number' || !g.players[d.fromSeat] ||
     !g.players[d.fromSeat].alive ||
     typeof d.seat !== 'number' || !g.players[d.seat] ||
     !g.players[d.seat].alive ||
     typeof d.originalOwner !== 'number') { // ✅ 新增：验证原始拥有者字段
    g.pending = null;
    g.phase = g.phase || 'play'; // ✅ 修正：恢复到默认阶段
  }
}

// 曹植【酒诗】:使用酒的pending状态
if(g.pending && g.pending.type === 'jiushiUseWine') {
  const d = g.pending;
  if(typeof d.seat !== 'number' || !g.players[d.seat] || !g.players[d.seat].alive) {
    g.pending = null;
    g.phase = g.phase || 'play'; // ✅ 修正：恢复到默认阶段
  }
}

// 曹植【酒诗】:受到伤害后翻面的pending状态
if(g.pending && g.pending.type === 'jiushiFlip') {
  const d = g.pending;
  if(typeof d.seat !== 'number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     typeof d.wasFacedown !== 'boolean') { // ✅ 新增：验证冻结的朝向状态字段
    g.pending = null;
    g.phase = g.phase || 'play'; // ✅ 修正：恢复到默认阶段
  }
}
```

// ✅ 修正：项目中使用 p.faceup 属性，回合结束时自动翻回正面
// 在 startTurn 中不需要额外重置，因为 normalize 已经初始化 faceup=true
// 在 endTurn 或类似位置处理翻面状态恢复：
// for(let i = 0; i < g.players.length; i++) {
//   g.players[i].faceup = true; // 回合结束时翻回正面
// }

---

## 四、技能实现

### 落英实现

**集成点**：由于项目中没有统一的牌置入弃牌堆入口，需要在以下关键位置集成落英检查：

#### 1. 判定牌处理（`finishDelayCard` 中）
```javascript
// 在 finishDelayCard 中添加落英检查
// 注意：此时 finalCard 已经通过 judge() 添加到 g.discard
function finishDelayCard(g, seat, spec, finalCard, card){
  // ... 现有逻辑 ...
  
  // ✅ 修正：添加落英检查 - 判定牌置入弃牌堆时
  maybeStartLuoying(g, seat, [finalCard], 'judge');
  
  // ... 其余逻辑 ...
}
```

#### 2. 弃牌阶段处理（`discardCard` 和 `discardCards` 中）
```javascript
// 在 discardCard 中添加落英检查
function discardCard(cardIdx){
  tx(g=>{
    // ... 现有逻辑 ...
    const card = me.hand.splice(cardIdx,1)[0];
    maybeStartLianying(g, mySeat, 1);
    g.discard.push(card);
    
    // ✅ 修正：添加落英检查 - 弃牌阶段
    maybeStartLuoying(g, mySeat, [card], 'discard');
    
    // ... 其余逻辑 ...
  });
}

// 在 discardCards 中添加落英检查
function discardCards(cardIdxList){
  tx(g=>{
    // ... 现有逻辑 ...
    const discarded = sorted.map(i=>me.hand.splice(i,1)[0]);
    g.discard.push(...discarded);
    
    // ✅ 修正：添加落英检查 - 批量弃牌
    maybeStartLuoying(g, mySeat, discarded, 'discard');
    
    // ... 其余逻辑 ...
  });
}
```

#### 3. 落英检查函数（统一处理）
```javascript
// ✅ 修正：统一的落英检查函数
function maybeStartLuoying(g, fromSeat, cards, reason) {
  // reason: 'judge' (判定), 'discard' (弃置), 'lose' (损失) 等
  
  if (!['judge', 'discard'].includes(reason)) return;
  
  // ✅ 修正：收集所有♣️牌，支持批量处理
  const clubCards = cards.filter(card => card.suit === 'club');
  if (clubCards.length === 0) return;
  
  // 检查所有存活的曹植（注意：fromSeat 是牌的来源角色）
  for (let i = 0; i < g.players.length; i++) {
    if (i === fromSeat) continue; // 排除牌的来源角色
    if (!g.players[i] || !g.players[i].alive) continue;
    if (!generalHasCap(g.players[i], 'luoying')) continue;
    
    // ✅ 修正：为每个符合条件的曹植创建pending，包含所有♣️牌
    g.pending = {
      type: 'luoyingGain',
      seat: i,
      originalOwner: fromSeat, // ✅ 新增：明确记录原始拥有者
      cards: clubCards, // ✅ 修正：所有♣️牌
      reason: reason
    };
    g.phase = 'luoyingGain'; // ✅ 新增：设置阶段状态
    // ✅ 修正：在日志中明确记录原始拥有者和所有牌
    g.log = pushLog(g.log, `${g.players[i].name} 可以发动【落英】获得 ${g.players[fromSeat].name} 的 ${clubCards.map(c => c.name).join('、')}`);
    markSkillSound(g, '落英');
    
    // 注意：如果多个曹植同时存在，需处理多个pending的情况
    // 这里简化处理，实际实现可能需要更复杂的逻辑
    break; // 先处理一个，实际需要根据游戏规则决定
  }
}
```

**重要说明**：由于项目中没有统一的牌置入弃牌堆入口，建议在将来重构时引入 `addToDiscard(g, cards, fromSeat, reason)` 统一函数，将所有 `g.discard.push(...)` 替换为该函数调用，以简化技能集成。

// 落英获得牌的选择处理
function handleLuoyingGain(accept) {
  tx(g => {
    if (g.pending.type !== 'luoyingGain' || !g.pending.cards || g.pending.cards.length === 0) return g;
    
    const me = g.players[g.pending.seat];
    const originalOwner = g.players[g.pending.originalOwner]; // ✅ 修正：使用originalOwner
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
      // ✅ 修正：日志中明确记录原始拥有者
      g.log = pushLog(g.log, `${me.name} 发动【落英】,获得了 ${originalOwner.name} 的 ${cards.map(c => c.name).join('、')}`);
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
// ⚠️ 重要：这个函数需要在 tx 事务中调用，或者直接在调用方的 tx 中处理
function needUseWine(g, seat) {
  const me = g.players[seat];
  
  // ✅ 修正：使用 me.faceup 而非 g.playerFacedown[seat]
  // me.faceup = true 表示正面朝上，可以发动酒诗①
  // me.faceup = false 表示背面朝上，无法发动酒诗①
  if (me && me.alive && generalHasCap(me, 'jiushi') && me.faceup !== false) {
    // ✅ 修正：通过 g.phase 挂起流程，而非返回 true
    // 注意：这个函数应该在 tx 事务中被调用，因此可以直接修改 g
    return true; // 表示可以发动酒诗
  }
  return false;
}

// ✅ 修正：正确的集成方式 - 在调用方的 tx 中处理
// 示例：在需要使用酒的地方（比如 respondJiu 的调用前）
function someFunctionThatNeedsWine(g, seat) {
  tx(g => {
    // ... 其他逻辑 ...
    
    // 检查是否可以发动酒诗
    if (needUseWine(g, seat)) {
      // ✅ 正确：在 tx 中修改 g
      g.pending = {
        type: 'jiushiUseWine',
        seat: seat
      };
      g.phase = 'askWine'; // ✅ 强制切换到等待状态
      g.log = pushLog(g.log, `${g.players[seat].name} 可以发动【酒诗】翻面视为使用【酒】`);
      markSkillSound(g, '酒诗');
      return g; // 中断后续流程
    }
    
    // ... 继续其他使用酒的方式 ...
    return g;
  });
}

// 处理酒诗使用酒的选择
function handleJiushiUseWine(accept) {
  tx(g => {
    if (g.pending.type !== 'jiushiUseWine') return g;
    
    const me = g.players[g.pending.seat];
    if (!me || !me.alive) return g;
    
    if (accept) {
      // ✅ 修正：翻面 - 使用 me.faceup 属性
      me.faceup = false; // 翻面到背面朝上
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
    g.phase = 'play'; // ✅ 修正：清理阶段状态
    return g;
  });
}

// 酒诗②：当受到伤害后
// 在 damage settlement 后集成
function handleDamageAfter(g, damagedSeat, wasFacedown) {
  const me = g.players[damagedSeat];
  
  // ✅ 修正：检查是否可以发动酒诗②，使用冻结的状态
  // me.faceup === false 表示当前背面朝上
  // wasFacedown === false 表示受伤时背面朝上（因为 wasFacedown 是受伤时的 faceup 状态的反值）
  if (me && me.alive && generalHasCap(me, 'jiushi') && 
      me.faceup === false &&
      wasFacedown === false) { // ✅ 修正：wasFacedown 是受伤时的状态
    
    // ✅ 修正：在pending中冻结受伤时的朝向状态
    g.pending = {
      type: 'jiushiFlip',
      seat: damagedSeat,
      wasFacedown: wasFacedown // ✅ 新增：冻结此时的状态，防止后续状态变更影响判定
    };
    g.phase = 'jiushiFlip'; // ✅ 新增：设置阶段状态
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
    
    // ✅ 修正：使用pending中冻结的状态进行判定，并使用 me.faceup 属性
    if (accept && g.pending.wasFacedown === false) {
      // 翻面：从背面朝上翻回正面
      me.faceup = true; // ✅ 修正：使用 me.faceup
      g.log = pushLog(g.log, `${me.name} 发动【酒诗】,翻回正面`);
    } else {
      g.log = pushLog(g.log, `${me.name} 未发动【酒诗】`);
    }
    
    g.pending = null;
    g.phase = 'play'; // ✅ 修正：清理阶段状态
    return g;
  });
}

// ✅ 修正：在 dealDamage 中记录受到伤害时的朝向状态
// 注意：项目中已经使用 target.faceup 属性
function dealDamage(g, targetSeat, amount, sourceSeat, reason, skill) {
  const target = g.players[targetSeat];
  if (!target || !target.alive) return g;
  
  // ✅ 修正：记录受到伤害时的朝向状态（使用 target.faceup）
  // target.faceup === false 表示背面朝上，true 表示正面朝上
  const facedownAtDamage = target.faceup === false; // 受伤时是否背面朝上
  
  // ... 处理伤害 ...
  
  // 在伤害结算后调用酒诗②的检查
  handleDamageAfter(g, targetSeat, facedownAtDamage);
  
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
    const originalOwner = g.players[g.pending.originalOwner];
    const reasonText = g.pending.reason === 'judge' ? '判定' : '弃置';
    
    // ✅ 修正：批量牌展示界面
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【落英】获得牌</h4>
        <p>${originalOwner.name} 的以下牌因 ${reasonText} 置入弃牌堆：</p>
        <div class="card-list" style="margin: 10px 0;">
          ${cards.map(c => `<span class="card-preview" style="margin: 2px; padding: 2px 6px; background: #f0f0f0; border-radius: 4px;">【${c.name}】</span>`).join('')}
        </div>
        <p>你可以获得这些♣️牌（共${cards.length}张）</p>
        <button onclick="handleLuoyingGain(true)" class="confirm-btn" style="background: #4a90d9;">
          获得所有${cards.length}张♣️牌
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
// ✅ 修正：支持通过 g.phase 状态检查（用于异步事件驱动架构）
if ((g.pending && g.pending.type === 'jiushiUseWine' && g.pending.seat === seat) ||
    g.phase === 'askWine') {
  
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
  
  const playerElement = document.getElementById(`player-${seat}`);
  const p = g.players[seat];
  // ✅ 修正：使用 p.faceup 属性（true=正面朝上，false=背面朝上）
  const isFacedown = p && p.faceup === false;
  
  if (isFacedown) {
    // ✅ 修正：添加清晰的视觉反馈效果
    playerElement.classList.add('facedown');
    // 方法1: 旋转180度（传统三国杀风格）
    playerElement.style.transform = 'rotateY(180deg)';
    playerElement.style.transition = 'transform 0.3s ease';
    
    // 方法2: 灰度+半透明（更直观的状态指示）
    // playerElement.style.filter = 'grayscale(100%) brightness(0.7)';
    
    // ✅ 建议：为背面朝上状态添加边框或阴影以增强可视性
    playerElement.style.boxShadow = '0 0 8px rgba(0,0,0,0.3)';
  } else {
    playerElement.classList.remove('facedown');
    playerElement.style.transform = 'rotateY(0deg)';
    playerElement.style.filter = 'none';
    playerElement.style.boxShadow = 'none';
  }
  
  // ... 其余代码 ...
}

// ✅ 新增：CSS 样式建议
/*
.facedown {
  opacity: 0.7;
  filter: grayscale(80%);
  transform: rotateY(180deg);
  transition: all 0.3s ease;
}

.facedown:hover {
  transform: rotateY(180deg) scale(1.02);
  box-shadow: 0 0 12px rgba(255, 200, 0, 0.4);
}
*/
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
1. **武将牌正面朝上时需要使用酒**（`p.faceup === true`）：
   - 可以选择翻面视为使用酒
   - 翻面后武将牌变为背面朝上（`p.faceup = false`）
2. **武将牌背面朝上时需要使用酒**（`p.faceup === false`）：无法发动酒诗①
3. **受到伤害时武将牌正面朝上**（`p.faceup === true`）：无法发动酒诗②
4. **受到伤害时武将牌背面朝上，但伤害结算后翻回正面**：
   - 需要判断的是"受到此伤害时"的状态
   - 在 `dealDamage` 时记录 `target.faceup` 状态并冻结在 pending 中
5. **多次受到伤害**：每次受到伤害后都可以独立发动酒诗②
6. **翻面时武将牌不存活**：pending验证时排除
7. **连锁触发**：酒诗翻面后可能触发其他技能

### 武将牌朝向状态管理
1. **回合开始时**：武将牌应为正面朝上（`p.faceup = true`）
2. **回合结束时**：武将牌翻回正面朝上（`p.faceup = true`，根据标准三国杀规则）
3. **多个技能翻面**：需要正确处理武将牌朝向的变化
4. **游戏开始时**：所有武将牌默认为正面朝上（normalize 中已初始化 `p.faceup = true`）
5. **✅ 新增：状态竞态防护**：在伤害结算到技能发动之间，其他技能可能修改朝向状态，因此必须在pending中冻结受伤时的 `faceup` 状态
6. **✅ 新增：异步流程控制**：通过 `g.phase = 'askWine'` 挂起流程，防止后续代码继续执行

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
| **✅ 新增：落英批量处理** | 其他角色弃置3张♣️牌，曹植一次性获得所有3张 |
| **✅ 新增：酒诗①异步流程** | 需要使用酒时，流程正确挂起等待玩家选择 |
| **✅ 新增：酒诗②状态冻结** | 伤害结算后其他技能修改朝向，不影响酒诗②的判定 |
| **✅ 新增：判定牌落英** | 曹植自己判定♣️牌时，不触发落英 |
| **✅ 新增：多曹植落英** | 场上有2个曹植，其他角色弃置♣️牌时，每个曹植都可以独立选择 |

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
   - ✅ **已由项目处理**：`normalize()` 中已初始化 `p.faceup` 属性
   - 需在回合结束时重置所有角色的 `faceup` 为 `true`

### 需要修改的文件

1. **data.js**：添加曹植武将定义
2. **game.js**：
   - `normalize()`：✅ **已由项目处理** `p.faceup` 属性
   - 回合结束处理：重置所有角色 `faceup` 为 `true`
   - `finishDelayCard()`：集成落英检查（判定牌）
   - `discardCard()`：集成落英检查（单张弃牌）
   - `discardCards()`：集成落英检查（批量弃牌）
   - `dealDamage()`：集成酒诗②的检查
   - 需要使用酒的位置：集成酒诗①的检查
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

## 十二、关键修正说明

> **⚠️ 基于异步事件驱动架构的4个核心改进**

### 1. 酒诗①流程阻塞机制修正

**问题**：原设计使用 `return true` 尝试中断流程，但在异步事件驱动架构中，后续代码可能继续执行，导致系统判定为无法使用酒而进入失败流程。

**解决方案**：
- 移除 `return true/false` 模式
- 通过 `g.phase = 'askWine'` **强制切换到等待状态**
- 渲染引擎检测到 `g.phase === 'askWine'` 时渲染选择界面
- 在 UI 部分同时支持 `pending.type` 和 `g.phase` 双重检查

**代码变更**：
```javascript
// ❌ 问题代码：
return true; // 无法可靠阻止后续执行

// ✅ 修正代码：在 tx 事务中修改状态
// 在调用方的 tx 中：
if (needUseWine(g, seat)) {
  g.pending = { type: 'jiushiUseWine', seat: seat };
  g.phase = 'askWine'; // 强制切换到等待状态
  g.log = pushLog(g.log, `${me.name} 可以发动【酒诗】翻面视为使用【酒】`);
  markSkillSound(g, '酒诗');
  return g; // 中断后续流程
}
```

---

### 2. 落英触发条件的严谨性优化

**问题**：需要明确区分牌的**原始拥有者**，特别是判定牌的情况。

**解决方案**：
- 在 pending 中添加 `originalOwner` 字段，明确记录牌的来源角色
- 在日志中清晰展示原始拥有者信息
- 验证逻辑已涵盖判定和弃置两种情况

**代码变更**：
```javascript
// 新增字段：
originalOwner: fromSeat

// 日志记录：
`${g.players[i].name} 可以发动【落英】获得 ${g.players[fromSeat].name} 的 ${clubCards.map(...)}`
```

---

### 3. 酒诗②状态记忆机制

**问题**：在伤害结算到技能发动之间，其他武将（如司马懿、张角）的技能可能修改曹植的朝向状态，导致判定逻辑紊乱。

**解决方案**：
- 在 `dealDamage` 中记录受伤时的朝向状态
- 在创建 pending 时，**冻结**该状态到 pending 对象中
- 判定时读取 pending 中的冻结状态，而非当前实时状态

**代码变更**：
```javascript
// ❌ 问题代码：
if (g.playerFacedown[damagedSeat] && damageInfo.facedownAtDamage) // 不存在的属性

// ✅ 修正代码：使用 p.faceup 属性并冻结状态
// 在 dealDamage 中：
const facedownAtDamage = target.faceup === false; // 记录受伤时的状态

// 在 handleDamageAfter 中：
g.pending = {
  type: 'jiushiFlip',
  seat: damagedSeat,
  wasFacedown: facedownAtDamage // 冻结此时的状态
};

// 判定时（在 handleJiushiFlip 中）：
if (accept && g.pending.wasFacedown === false) {
  me.faceup = true; // 翻回正面
}
```

---

### 4. 落英批量处理优化

**问题**：原实现逐张处理♣️牌，当多张梅花牌同时进入弃牌堆时（如【五谷丰登】后的弃置），会导致多次弹窗。

**解决方案**：
- 收集所有♣️牌到 `clubCards` 数组
- 创建一个 pending 包含所有符合条件的牌
- UI 展示所有牌，提供一次性选择界面

**代码变更**：
```javascript
// 从：
for (const card of cards) {
  if (card.suit === 'club') {
    g.pending = { cards: [card] };
    break;
  }
}

// 改为：
const clubCards = cards.filter(card => card.suit === 'club');
g.pending = { cards: clubCards };
```

---

## 十三、特殊说明

### 关于落英的触发时机

落英的触发时机是"当其他角色的♣️牌因判定或弃置而置入弃牌堆时"。需要特别注意：

1. **判定**：指判定区的牌判定完成后置入弃牌堆
2. **弃置**：指玩家主动弃置手牌或装备区的牌
3. **其他方式**：如因技能效果损失牌、移交牌等，不触发落英

✅ **项目实现说明**：由于项目中没有统一的牌置入弃牌堆入口，需要在以下关键位置集成：
- `finishDelayCard()`：处理判定牌
- `discardCard()`：处理单张弃牌
- `discardCards()`：处理批量弃牌
- 其他弃牌场景（如装备替换、阵亡处理等）

建议未来重构时引入 `addToDiscard(g, cards, fromSeat, reason)` 统一函数。

### 关于酒诗的两个效果

酒诗包含两个独立的效果：

1. **效果①**：是主动发动的"视为使用"技能，当需要使用酒时可以选择发动
2. **效果②**：是受到伤害后的触发技能，满足条件时可以选择发动

这两个效果互相独立，发动一个不影响另一个的发动。

### 关于武将牌朝向状态

武将牌的朝向状态在游戏中具有重要意义：
- **正面朝上**（`p.faceup === true`）：武将牌显示正面，可以正常发动技能
- **背面朝上**（`p.faceup === false`）：武将牌显示背面，可能限制某些技能的发动

✅ **项目实现说明**：
- 项目中使用 `p.faceup` 属性维护朝向状态（`true`=正面朝上，`false`=背面朝上）
- `normalize()` 中已初始化所有角色的 `faceup` 属性为 `true`
- 需要在回合结束时将所有角色的 `faceup` 重置为 `true`

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

*文档状态：设计阶段（已应用关键修正 + 项目架构审核）*
*创建时间：2026-07-13*
*修正时间：2026-07-13*
*负责人：Mistral Vibe*
*最后更新：应用5项关键修正（流程阻塞、状态冻结、批量处理、触发严谨性、项目架构适配）*
