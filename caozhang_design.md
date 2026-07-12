# 曹彰 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `caozhang` |
| **武将名称** | 曹彰 |
| **势力** | 魏 |
| **性别** | male |
| **体力上限** | 4 |
| **技能** | 将驰 |

---

## 二、技能说明

### 将驰
**时机**：摸牌阶段（可选发动）

**效果**：
你可以选择以下一项执行：
1. **额外摸一张牌**，然后本回合你不能使用或者打出【杀】；
2. **少摸一张牌**，然后本回合你使用【杀】无距离限制且你可以多使用一张【杀】；
3. **不发动**，正常摸牌。

**设计要点**：
- 属于**摸牌阶段可选行为**，需与 `doDraw` -> `drawPhaseCount` 流程集成
- **状态挂在玩家私有 `marks` 上**，避免多人局互相影响
- **基础摸牌数通过 `drawPhaseCount(g, seat)` 动态获取**，兼容英姿（extraDrawPhase=1）等技能
- **选项2的多杀效果为基础次数+1**，可与咆哮（unlimitedSha）、连弩（unlimitedSha）等技能叠加
- **距离效果只对【杀】生效**，通过修改 `canReachSha` 实现，保留目标合法性检查
- **次数限制使用全局的 `g.shaUsed` 标志**，将驰只负责+1上限
- **使用 `isShaName(card.name)` 统一判断所有类型的杀（普通杀、火杀、雷杀）**

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
caozhang: {
  id: 'caozhang',
  name: '曹彰',
  gender: 'male',
  maxHp: 4,
  skills: ['jiangchi'],
  desc: '将驰:摸牌阶段,你可以选择一项:1.额外摸一张牌,本回合不能使用或打出杀;2.少摸一张牌,本回合使用杀无距离限制且可以多使用一张杀。',
  caps: { jiangchi: true }
}
```

---

## 四、技能实现

### 4.1 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 将驰状态挂在玩家身上（玩家私有marks）
g.players.forEach(p => {
  if (!p.marks) p.marks = {};
  if (typeof p.marks.jiangchi_noSlash !== 'boolean') p.marks.jiangchi_noSlash = false;
  if (typeof p.marks.jiangchi_noDistance !== 'boolean') p.marks.jiangchi_noDistance = false;
  if (typeof p.marks.jiangchi_plus !== 'number') p.marks.jiangchi_plus = 0; // 只存+1，不存已用
});

// 将驰pending防御（服务端纯函数，不能用mySeat）
if (g.pending && g.pending.type === 'jiangchiChoose') {
  const d = g.pending;
  if (typeof d.seat !== 'number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     !Array.isArray(d.options) || d.options.length !== 3) {  // 3个选项：发动1、发动2、不发动
    g.pending = null;
    if (g.phase === 'jiangchiChoose') g.phase = 'draw';
  }
}
```

### 4.2 状态重置函数

```javascript
// 清理将驰状态（仅在回合开始时调用）
function clearJiangchi(g, seat) {
  const p = g.players[seat];
  if (!p?.marks) return;
  p.marks.jiangchi_noSlash = false;
  p.marks.jiangchi_noDistance = false;
  p.marks.jiangchi_plus = 0;
}
```

在 `startTurn(g, seat)` 中调用（紧跟其他状态重置之后）：
```javascript
// ... 现有重置代码 ...
g.shaUsed = false;
g.shaPlayedInDuel = false;
// ... 其他重置 ...

// 将驰状态重置
clearJiangchi(g, seat);
```

> **注意**：只在 `startTurn` 调用即可，`endTurn` 不用调用，避免回放时状态丢失。

### 4.3 摸牌阶段核心逻辑

**修改 `doDraw` 函数：**
```javascript
function doDraw() {
  tx(g => {
    if (g.phase !== 'draw' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me.alive || me.marks.jiangchi_noSlash || me.marks.jiangchi_plus) return g;

    if (generalHasCap(me, 'jiangchi')) {
      const baseDraw = drawPhaseCount(g, mySeat); // 使用项目现有的基础摸牌数计算
      
      g.pending = {
        type: 'jiangchiChoose',
        seat: mySeat,
        baseDraw: baseDraw,
        options: [
          { id: 'more', desc: `额外摸1张(共${baseDraw + 1}张)，本回合不能用打出杀` },
          { id: 'less', desc: `少摸1张(共${Math.max(0, baseDraw - 1)}张)，杀无距且+1` },
          { id: 'cancel', desc: `不发动，摸${baseDraw}张` }
        ]
      };
      g.phase = 'jiangchiChoose';
      g.log = pushLog(g.log, `${me.name} 是否发动【将驰】？`);
      return g;
    }
    
    finishDrawPhase(g, mySeat, drawPhaseCount(g, mySeat));
    return g;
  });
}
```

**添加 `chooseJiangchi` 函数：**
```javascript
function chooseJiangchi(optionId) {
  tx(g => {
    const d = g.pending;
    if (!d || d.type !== 'jiangchiChoose' || d.seat !== mySeat) return g;
    const me = g.players[mySeat];
    const base = d.baseDraw || 2;

    if (optionId === 'more') {
      // 选项1：多摸一张牌，本回合不能使用或打出杀
      ensureDeck(g); 
      drawN(g, mySeat, base + 1);
      me.marks.jiangchi_noSlash = true;
      g.log = pushLog(g.log, `${me.name} 发动【将驰】，多摸一张牌，本回合不能使用或打出杀`);
    } else if (optionId === 'less') {
      // 选项2：少摸一张牌，本回合杀无距离限制且可多用一张
      const n = Math.max(0, base - 1);
      ensureDeck(g); 
      if (n > 0) drawN(g, mySeat, n);
      me.marks.jiangchi_noDistance = true;
      me.marks.jiangchi_plus = 1; // +1 上限
      g.log = pushLog(g.log, `${me.name} 发动【将驰】，少摸一张牌，本回合使用杀无距离限制且可多用一张`);
    } else { // cancel
      // 选项3：不发动，正常摸牌
      ensureDeck(g); 
      drawN(g, mySeat, base);
      g.log = pushLog(g.log, `${me.name} 不发动【将驰】`);
    }
    markSkillSound(g, mySeat, 'jiangchi');
    g.pending = null; 
    g.phase = 'play';
    return g;
  });
}
```

### 4.4 选项1效果实现（禁止使用/打出杀）

**修改 `CARD_PLAYS['杀'].canPlay`：**
```javascript
'杀': {
  target: true,
  canPlay: (g, me, card) => {
    // ... 现有代码 ...
    
    // 将驰选项1效果：本回合不能使用或打出杀
    if (me.marks?.jiangchi_noSlash && isShaName(card.name) && g.turn === mySeat) {
      return false;
    }
    
    return canUseAs(me, card, '杀') && (!g.shaUsed || hasCap(me, 'unlimitedSha'));
  },
  // ... 其余代码 ...
}
```

**在决斗响应中集成选项1的禁止效果：**
```javascript
// 在 duelResponse 函数中添加检查
function duelResponse(useSha, cardIdx) {
  tx(g => {
    // ... 现有代码 ...
    
    // 将驰选项1效果：本回合不能打出杀作为决斗响应
    const me = g.players[mySeat];
    if (me.marks?.jiangchi_noSlash && useSha) {
      g.log = pushLog(g.log, `${me.name} 不能打出杀作为决斗响应（将驰效果）`);
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // ... 其余代码 ...
  });
}
```

**在AOE响应中集成选项1的禁止效果：**
```javascript
// 在 aoeRespond 函数中添加检查
function aoeRespond(use, cardIdx) {
  tx(g => {
    // ... 现有代码 ...
    
    // 将驰选项1效果：本回合不能打出杀作为AOE响应
    const me = g.players[mySeat];
    if (me.marks?.jiangchi_noSlash && g.aoe.need === '杀' && use) {
      g.log = pushLog(g.log, `${me.name} 不能打出杀作为${g.aoe.trick}响应（将驰效果）`);
      g.pending = null;
      g.phase = 'aoe';
      return g;
    }
    
    // ... 其余代码 ...
  });
}
```

### 4.5 选项2效果实现（杀无距离限制且可多用一张）

**修改 `canReachSha` 函数（只对杀生效，带card上下文）:**
```javascript
function canReachSha(g, fromSeat, targetSeat, card) {
  // 将驰选项2效果：只对杀生效，无距离限制
  const from = g.players[fromSeat];
  if (card && from?.marks?.jiangchi_noDistance && isShaName(card.name) && g.turn === fromSeat) {
    return true; // 无距离限制，直接返回true
  }
  
  return distance(g, fromSeat, targetSeat) <= attackRange(g, fromSeat);
}
```

**注意**：需要更新 `CARD_PLAYS['杀'].canTarget` 中的调用：
```javascript
canTarget: (g, me, card, targetSeat) => {
  // ... 现有代码（空城等检查） ...
  
  // 将距离检查改为带card参数
  return canReachSha(g, mySeat, targetSeat, card);
}
```

**修改 `CARD_PLAYS['杀'].canPlay` 加入多杀效果：**
```javascript
'杀': {
  target: true,
  canPlay: (g, me, card) => {
    // 将驰选项1效果：本回合不能使用或打出杀
    if (me.marks?.jiangchi_noSlash && isShaName(card.name) && g.turn === mySeat) {
      return false;
    }
    
    // 将驰选项2效果：多使用一张杀（基础次数+1）
    let shaLimit = 1;
    if (me.marks?.jiangchi_plus && g.turn === mySeat) {
      shaLimit += me.marks.jiangchi_plus;
    }
    
    // 检查是否已用完次数
    const isUnlimited = hasCap(me, 'unlimitedSha');
    const canUse = canUseAs(me, card, '杀');
    
    // 如果有无限杀，直接允许
    if (isUnlimited) return canUse;
    
    // 否则检查次数限制
    // 注意：g.shaUsed 是全局标志，这里需要特殊处理
    // 由于将驰的+1上限需要和g.shaUsed协调，我们使用以下逻辑：
    // 基础次数为1，将驰+1后为2（如果有将驰）
    const effectiveLimit = hasCap(me, 'unlimitedSha') ? 999 : (1 + (me.marks?.jiangchi_plus || 0));
    
    // 使用全局的shaUsed计数器
    if (g.shaUsed) {
      // 已经使用过1次杀了，如果有将驰+1，可以再用1次
      if (me.marks?.jiangchi_plus && g.turn === mySeat) {
        // 检查是否是第二次使用（将驰+1的那一次）
        // 这里需要更复杂的逻辑，见下文说明
        return canUse;
      }
      return false;
    }
    
    return canUse;
  },
  // ... 其余代码 ...
}
```

**更精确的多杀次数控制方案：**

由于项目使用全局 `g.shaUsed` 标志，而将驰需要+1上限，我们需要更精确的控制。建议使用专用的计数器：

```javascript
// 在 startTurn 中添加重置
function startTurn(g, seat) {
  // ... 现有代码 ...
  g.shaUsed = false;
  g.jiangchiShaUsed = 0; // 将驰专用的出杀计数器
  // ... 其余代码 ...
}

// 在 normalize 中添加防御
if (typeof g.jiangchiShaUsed !== 'number') g.jiangchiShaUsed = 0;

// 修改 CARD_PLAYS['杀'].canPlay
'杀': {
  target: true,
  canPlay: (g, me, card) => {
    // 将驰选项1效果：本回合不能使用或打出杀
    if (me.marks?.jiangchi_noSlash && isShaName(card.name) && g.turn === mySeat) {
      return false;
    }
    
    const canUse = canUseAs(me, card, '杀');
    if (!canUse) return false;
    
    // 检查出杀次数限制
    if (hasCap(me, 'unlimitedSha')) return true; // 无限杀直接允许
    
    // 计算有效上限
    const baseLimit = 1;
    const jiangchiPlus = (me.marks?.jiangchi_plus && g.turn === mySeat) ? me.marks.jiangchi_plus : 0;
    const effectiveLimit = baseLimit + jiangchiPlus;
    
    // 计算已使用次数
    const baseUsed = g.shaUsed ? 1 : 0;
    const jiangchiUsed = (g.jiangchiShaUsed > 0 && g.turn === mySeat) ? g.jiangchiShaUsed : 0;
    const totalUsed = baseUsed + jiangchiUsed;
    
    return totalUsed < effectiveLimit;
  },
  effect: (g, me, card, targetSeat) => {
    const usedAs = isShaName(card.name) ? '出【'+card.name+'】' : '出【'+card.name+'】当【杀】';
    
    // 标记使用
    g.shaUsed = true; // 基础次数
    
    // 将驰的+1次数
    if (me.marks?.jiangchi_plus && g.turn === mySeat) {
      g.jiangchiShaUsed = (g.jiangchiShaUsed || 0) + 1;
    }
    
    // ... 其余效果 ...
    triggerJiangOnTarget(g, mySeat, targetSeat, 'sha', isRed(card));
    
    // ... 其他处理 ...
  },
  // ... 其余代码 ...
}
```

**简化方案（推荐）**：

考虑到项目架构，推荐使用更简单的方案，直接修改 `g.shaUsed` 的检查逻辑：

```javascript
// 修改 CARD_PLAYS['杀'].canPlay
'杀': {
  target: true,
  canPlay: (g, me, card) => {
    // 将驰选项1效果：本回合不能使用或打出杀
    if (me.marks?.jiangchi_noSlash && isShaName(card.name) && g.turn === mySeat) {
      return false;
    }
    
    return canUseAs(me, card, '杀') && (!g.shaUsed || hasCap(me, 'unlimitedSha') || 
           (me.marks?.jiangchi_plus && g.turn === mySeat && g.shaUsed && g.jiangchiShaCount < 1));
  },
  // ... 其余代码 ...
}

// 添加全局变量
// 在 startTurn 中添加
function startTurn(g, seat) {
  // ... 现有代码 ...
  g.shaUsed = false;
  g.jiangchiShaCount = 0; // 将驰的额外次数计数
  // ... 其余代码 ...
}

// 在 normalize 中添加
if (typeof g.jiangchiShaCount !== 'number') g.jiangchiShaCount = 0;

// 修改 CARD_PLAYS['杀'].effect
'杀': {
  target: true,
  canPlay: (g, me, card) => {
    // 将驰选项1效果
    if (me.marks?.jiangchi_noSlash && isShaName(card.name) && g.turn === mySeat) {
      return false;
    }
    
    // 基础判断
    const canUse = canUseAs(me, card, '杀');
    if (!canUse) return false;
    
    // 无限杀
    if (hasCap(me, 'unlimitedSha')) return true;
    
    // 基础次数检查
    if (!g.shaUsed) return true;
    
    // 将驰+1次数检查
    if (me.marks?.jiangchi_plus && g.turn === mySeat && g.jiangchiShaCount < 1) {
      return true;
    }
    
    return false;
  },
  effect: (g, me, card, targetSeat) => {
    const usedAs = isShaName(card.name) ? '出【'+card.name+'】' : '出【'+card.name+'】当【杀】';
    
    // 标记使用
    if (!g.shaUsed) {
      g.shaUsed = true; // 第一次使用
    } else if (me.marks?.jiangchi_plus && g.turn === mySeat) {
      g.jiangchiShaCount = (g.jiangchiShaCount || 0) + 1; // 第二次使用（将驰+1）
    }
    
    triggerJiangOnTarget(g, mySeat, targetSeat, 'sha', isRed(card));
    
    // ... 其他处理 ...
  },
  // ... 其余代码 ...
}
```

---

## 五、渲染集成（render-controls.js）

### 将驰选项选择UI

```javascript
function renderControls(g) {
  const seat = mySeat;
  const p = g.players[seat];

  // 将驰：选择阶段（安全渲染，避免注入风险）
  if (g.pending?.type === 'jiangchiChoose' && g.pending.seat === seat) {
    const wrap = document.createElement('div');
    wrap.className = 'skill-choose-panel';
    wrap.innerHTML = '<h4>【将驰】请选择</h4>';
    
    g.pending.options.forEach(opt => {
      const b = document.createElement('button');
      b.className = 'skill-btn';
      b.textContent = opt.desc;
      b.onclick = () => chooseJiangchi(opt.id);
      wrap.appendChild(b);
    });
    
    ui.appendChild(wrap);
    return; // 阻断后续出牌UI
  }
}
```

---

## 六、音效标识

在 `markSkillSound` 中添加：
```javascript
const SKILL_SOUNDS = {
  // ... 现有技能 ...
  '将驰': 'jiangchi',
};
```

---

## 七、边界条件处理

### 将驰
1. **牌堆不足**：
   - 所有选项都使用 `ensureDeck(g)` 确保有足够的牌可摸
   - 选项2：若基础摸牌数为1，则少摸后为0张，仍可正常选择
2. **无合法选项**：若牌堆为空，所有选项都将摸0张牌，但仍应允许选择
3. **角色死亡**：在 `doDraw` 和 `chooseJiangchi` 中检查角色是否存活
4. **多次发动**：检查 `jiangchi_noSlash` 和 `jiangchi_plus` 标志，防止重复发动
5. **选项1与选项2互斥**：选择一种选项后，另一种选项的效果不生效
6. **杀的限制**：
   - 选项1：严格禁止使用/打出任何类型的【杀】（普通杀、火杀、雷杀等），包括作为主动出牌、决斗响应、AOE响应
   - 选项2：无距离限制效果**只对【杀】生效**，通过修改 `canReachSha` 实现
   - 选项2：多使用一张【杀】的限制为基础次数+1，使用 `g.jiangchiShaCount` 专用计数器

### 与其他技能的交互
1. **与摸牌相关技能的交互**（英姿等）：
   - 通过 `drawPhaseCount(g, seat)` 动态获取基础摸牌数，与其他技能正常叠加
   - 选项1：基础摸牌数 + 1
   - 选项2：基础摸牌数 - 1
2. **与杀相关技能的交互**（咆哮、连弩等）：
   - 选项1的禁止效果使用 `isShaName(card.name)` 统一判断，覆盖所有类型的杀
   - 选项2的无距离限制**只对杀生效**，通过card上下文判断
   - 选项2的多杀效果使用 `g.jiangchiShaCount` 专用计数器，可与咆哮（unlimitedSha）等技能叠加
3. **与距离相关技能的交互**（顺手牵羊、乐不思蜀等）：
   - 选项2的无距离限制**只对【杀】生效**，非杀牌（顺手牵羊、乐不思蜀等）不受影响
4. **与回合相关技能的交互**：
   - 将驰的效果仅在当前回合生效
   - 回合开始时自动重置所有标志

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **基本功能** | |
| 将驰：选择选项1，牌堆充足 | 多摸1张牌（基于drawPhaseCount），本回合不能使用/打出任何类型的杀 |
| 将驰：选择选项1，牌堆仅1张 | 多摸1张牌（实际摸完所有剩余牌），本回合不能使用/打出任何类型的杀 |
| 将驰：选择选项2，牌堆充足 | 少摸1张牌（基于drawPhaseCount），本回合【杀】无距离限制且可多用一张 |
| 将驰：选择选项2，牌堆为空 | 摸0张牌，本回合【杀】无距离限制且可多用一张 |
| 将驰：选择选项3（不发动） | 正常摸牌（drawPhaseCount） |
| **选项1禁止效果** | |
| 将驰：选项1后尝试使用普通杀 | 不能使用 |
| 将驰：选项1后尝试使用火杀 | 不能使用 |
| 将驰：选项1后尝试使用雷杀 | 不能使用 |
| 将驰：选项1后尝试决斗应战出杀 | 不能打出 |
| 将驰：选项1后尝试南蛮入侵响应出杀 | 不能打出 |
| **选项2增强效果** | |
| 将驰：选项2时使用普通杀距离检查 | 忽略距离限制 |
| 将驰：选项2时使用火杀距离检查 | 忽略距离限制 |
| 将驰：选项2时使用顺手牵羊距离检查 | 正常距离检查（不受将驰影响） |
| 将驰：选项2时使用乐不思蜀距离检查 | 正常距离检查（不受将驰影响） |
| 将驰：选项2时杀数量限制 | 本回合最多使用基础次数+1张【杀】 |
| **与其他技能叠加** | |
| 将驰 + 英姿：选择选项1 | 基础3张 + 1 = 4张牌 |
| 将驰 + 英姿：选择选项2 | 基础3张 - 1 = 2张牌 |
| 将驰 + 咆哮：选择选项2 | 基础次数无限 + 1 = 无限（但实际受牌数限制） |
| 将驰 + 连弩：选择选项2 | 基础次数无限 + 1 = 无限（但实际受牌数限制） |
| **多人局** | |
| 多人局：A发动将驰选项1 | 只影响A本回合，B可以正常使用所有类型的杀 |
| 多人局：A发动将驰选项2 | 只影响A本回合的【杀】，B使用杀时无增强效果 |
| **回合切换** | |
| 将驰：回合结束重置 | 所有将驰标志在下回合开始时重置 |
| 将驰：连续多个回合发动 | 每个回合独立计算，互不影响 |

---

## 九、实现优先级

1. **数据定义优先**：添加武将基本定义到 `data.js`
2. **状态管理优先**：添加pending状态防御和玩家marks字段，添加全局计数器
3. **核心逻辑优先**：实现将驰的三个选项的核心效果
4. **距离系统集成**：修改 `canReachSha` 函数
5. **出杀系统集成**：修改 `CARD_PLAYS['杀'].canPlay` 和 `effect`
6. **响应系统集成**：在决斗、AOE响应中集成选项1的禁止效果
7. **UI集成优先**：添加技能选择界面
8. **音效集成**：添加技能音效
9. **边界处理**：处理牌堆不足等边界条件
10. **测试验证**：确保所有场景都通过测试

---

## 十、集成要点

### 与现有系统的集成

1. **摸牌系统**：
   - 复用 `drawPhaseCount(g, seat)` 获取基础摸牌数
   - 复用 `drawN`、`ensureDeck` 函数

2. **技能使用系统**：
   - 在 `CARD_PLAYS['杀'].canPlay` 中集成选项1的禁止效果和选项2的多杀效果
   - 在决斗响应 (`duelResponse`) 中集成选项1的禁止效果
   - 在AOE响应 (`aoeRespond`) 中集成选项1的禁止效果

3. **距离系统**：
   - 通过修改 `canReachSha` 集成选项2的无距离限制效果
   - 使用 `distance()` 和 `attackRange()` 现有函数

4. **状态管理**：
   - 使用玩家私有的 `marks` 存储状态，避免多人局冲突
   - 使用全局的 `g.shaUsed` 和 `g.jiangchiShaCount` 控制出杀次数
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程

5. **卡牌类型判断**：
   - 使用 `isShaName(card.name)` 统一判断所有类型的杀

6. **技能检测**：
   - 使用 `generalHasCap(player, 'jiangchi')` 检测是否拥有将驰技能

7. **日志系统**：
   - 为将驰的发动添加对应的日志记录

### 需要修改的文件

1. **data.js**：
   - 添加曹彰武将定义到 `GENERALS`

2. **game.js**：
   - `normalize()`：添加将驰玩家marks字段防御和全局计数器防御
   - 修改 `doDraw` 函数：添加将驰触发逻辑
   - 添加 `chooseJiangchi` 函数
   - 添加 `clearJiangchi` 函数
   - 修改 `canReachSha` 函数：带card参数，集成选项2的无距离限制
   - 修改 `CARD_PLAYS['杀'].canPlay`：集成选项1的禁止效果和选项2的多杀效果
   - 修改 `CARD_PLAYS['杀'].effect`：集成选项2的计数逻辑
   - 修改 `startTurn` 函数：重置将驰相关状态
   - 修改 `duelResponse` 函数：集成选项1的禁止效果
   - 修改 `aoeRespond` 函数：集成选项1的禁止效果

3. **render-controls.js**：
   - 添加将驰的UI界面
   - 添加技能选择界面

---

## 十一、流程图

### 将驰完整流程

```
摸牌阶段开始
    ↓
检查是否拥有将驰技能且未发动过
    ↓
是：进入将驰选择阶段，动态计算基础摸牌数（drawPhaseCount）
    ↓
显示3个选项：多摸1张、少摸1张、不发动
    ↓
玩家选择选项
    ↓
选项1: 多摸1张 → 设置marks.jiangchi_noSlash=true → 进入出牌阶段
    ↓
选项2: 少摸1张 → 设置marks.jiangchi_noDistance=true, marks.jiangchi_plus=1 → 进入出牌阶段
    ↓
选项3: 不发动 → 正常摸牌 → 进入出牌阶段
    ↓
回合开始时：调用clearJiangchi清理所有状态
```

### 将驰效果流程

**选项1效果流程：**
```
出牌阶段/响应阶段
    ↓
尝试使用/打出卡牌
    ↓
检查isShaName(card.name) && marks.jiangchi_noSlash && g.turn === mySeat
    ↓
是：禁止使用/打出 → 返回false
```

**选项2效果流程：**
```
使用卡牌时（CARD_PLAYS['杀'].canTarget）
    ↓
检查isShaName(card.name) && marks.jiangchi_noDistance && g.turn === mySeat
    ↓
是：canReachSha 直接返回true（无距离限制）
    ↓
否：正常距离检查

出牌时（CARD_PLAYS['杀'].canPlay）
    ↓
检查计数器 < (1 + jiangchi_plus)
    ↓
是：允许使用
    ↓
否：禁止使用

使用后（CARD_PLAYS['杀'].effect）
    ↓
更新g.shaUsed和g.jiangchiShaCount计数器
```

---

## 十二、特殊说明

### 关于将驰的技能定位

将驰是曹彰的进攻型技能，体现了其骁勇善战的特点。通过在摸牌阶段的选择，曹彰可以在不同场合发挥不同的作用：

**选项1（多摸一张牌，不能用杀）：**
- 适用于需要手牌但不需要攻击的场合
- 可以快速积累手牌资源
- 适合防御或准备大招的回合
- **注意：完全禁止使用/打出任何类型的杀（普通杀、火杀、雷杀等），包括主动出牌、决斗应战、AOE响应**

**选项2（少摸一张牌，杀增强）：**
- 适用于进攻回合，特别针对高防御目标
- **无距离限制只对【杀】生效**，其他牌（顺手牵羊、乐不思蜀等）不受影响
- 多使用一张杀可以快速清场
- **注意：多杀效果是基础次数+1，可与咆哮、连弩等技能叠加**

**选项3（不发动）：**
- 保持正常摸牌
- 适用于需要保持灵活性的场合

### 关于技能平衡性

曹彰作为4体力的魏国武将，将驰提供了灵活的选择：

**选项1的平衡：**
- 多摸1张牌提供额外资源
- 代价是本回合完全不能使用任何类型的杀，限制了进攻能力
- 需要玩家权衡资源和进攻的关系

**选项2的平衡：**
- 少摸1张牌减少资源获取
- 但获得强大的杀增强效果：无距离限制（只对杀）+ 多一张杀
- 可以有效压制对手的防御策略

**整体平衡：**
- 三个选项都有明确的收益和代价
- 玩家需要根据场上形势选择最优策略
- 与魏国其他武将的协同性良好

### 关于与项目架构的适配

本设计书充分考虑了项目的实际架构：

1. **摸牌系统**：使用 `drawPhaseCount` 动态计算，兼容英姿等技能
2. **出杀系统**：使用 `g.shaUsed` 全局标志 + `g.jiangchiShaCount` 专用计数器
3. **距离系统**：修改 `canReachSha` 函数，保留原有逻辑
4. **技能检测**：使用 `generalHasCap` 检测技能
5. **卡牌判断**：使用 `isShaName` 统一判断所有杀类型
6. **状态管理**：使用 `marks` 存储玩家私有状态，全局标志控制次数

---

## 十三、修正记录

*文档状态：已完全符合项目实际代码*
*创建时间：2026-07-13*
*最终校对时间：2026-07-13*
*负责人：Mistral Vibe*

### 已修正的致命问题

#### 第一批7个致命问题（已修正）

✅ **问题1：状态挂在 `g` 上** → **修正：状态挂在玩家私有 `marks` 上**
- 原：`g.jiangchiNoSlash` 导致多人局A选了多摸，B也不能出杀
- 修正：`p.marks.jiangchi_noSlash` 只影响当前玩家

✅ **问题2：强制发动** → **修正：添加不发动选项**
- 原：直接进入pending，没有取消选项
- 修正：添加第三个选项「不发动，正常摸牌」

✅ **问题3：`canUseSlay` 逻辑自杀** → **修正：分离距离和次数检查**
- 原：先`if(enhanced) return true`，后面判断次数走不到
- 修正：通过 `canReachSha` 和 `CARD_PLAYS['杀'].canPlay` 分离检查，保留所有合法性检查

✅ **问题4：`START_HAND` 硬编码** → **修正：使用 `drawPhaseCount` 动态计算**
- 原：`toDraw = START_HAND + 1` 与英姿等冲突
- 修正：使用 `drawPhaseCount(g, seat)` 动态计算，START_HAND=4是初始手牌数

✅ **问题5：`normalize` 里用 `mySeat`** → **修正：使用服务端纯函数逻辑**
- 原：`d.seat !== mySeat` 依赖客户端变量
- 修正：直接检查座位号和角色状态，不依赖客户端变量

✅ **问题6：距离实现粗暴** → **修正：保留目标合法性检查**
- 原：`canUseSlay` 里直接 `return true` 跳过所有检查
- 修正：通过 `canReachSha` 返回true，但只对杀生效，保留其他检查

✅ **问题7：上限写死为2** → **修正：基础次数+1**
- 原：`slashLimit = 2` 覆盖咆哮等技能
- 修正：使用 `g.jiangchiShaCount` 专用计数器，基础次数+jiangchi_plus

#### 第二批3个隐藏Bug（已修正）

✅ **问题8：距离穿透所有牌** → **修正：距离函数带card上下文，只对杀生效**
- 原：`getAttackDistance` 返回1会让顺手牵羊、乐不思蜀也无距离了
- 修正：`canReachSha(g, fromSeat, targetSeat, card)` 带card参数，只对isShaName(card.name)生效

✅ **问题9：火杀雷杀漏判** → **修正：使用isShaName(card.name)统一判断**
- 原：`card.type === 'slash'` 只匹配普通杀，火杀fire_slash会绕过禁止
- 修正：使用 `isShaName(card.name)` 覆盖所有类型的杀（普通杀、火杀、雷杀等）

✅ **问题10：出杀计数器混淆** → **修正：分开计数，将驰只负责+1上限**
- 原：`jiangchi_used` 当总出杀次数，但咆哮、连弩也用总次数，导致计数错误
- 修正：使用 `g.shaUsed` 全局标志 + `g.jiangchiShaCount` 专用计数器，将驰只存 `jiangchi_plus=1`（+1上限）

### 与项目实际代码的差异修正

✅ **修正1：基础摸牌数** → **使用 `drawPhaseCount(g, seat)`**
- 原：假设START_HAND=2
- 修正：项目中START_HAND=4（初始手牌数），每回合摸牌数由 `drawPhaseCount(g, seat)` 返回2 + extraDrawPhase

✅ **修正2：出杀次数机制** → **使用 `g.shaUsed` 全局标志**
- 原：假设使用 `slashUsedThisTurn`
- 修正：项目使用全局 `g.shaUsed` 标志，配合 `hasCap(me, 'unlimitedSha')` 检测无限杀

✅ **修正3：距离系统** → **使用 `canReachSha` 函数**
- 原：假设使用 `getAttackDistance`
- 修正：项目使用 `canReachSha(g, fromSeat, targetSeat)`，基于 `distance()` 和 `attackRange()`

✅ **修正4：技能检测** → **使用 `generalHasCap`**
- 原：假设使用 `hasCap`
- 修正：项目中 `hasCap` 和 `generalHasCap` 都是可用的，但更推荐 `generalHasCap(player, cap)`

✅ **修正5：卡牌类型判断** → **使用 `isShaName(card.name)`**
- 原：假设使用 `isSlash(card)`
- 修正：项目中使用 `isShaName(name)` 判断卡牌名称，更符合项目架构

### 待实装项

- [ ] **data.js**: 
  - [ ] 添加曹彰武将定义到 `GENERALS`

- [ ] **game.js**: 
  - [ ] `normalize()`：添加将驰玩家marks字段防御和全局计数器防御
  - [ ] 修改 `doDraw` 函数：添加将驰触发逻辑
  - [ ] 添加 `chooseJiangchi` 函数
  - [ ] 添加 `clearJiangchi` 函数
  - [ ] 修改 `canReachSha` 函数：带card参数，集成选项2的无距离限制
  - [ ] 修改 `CARD_PLAYS['杀'].canPlay`：集成选项1的禁止效果和选项2的多杀效果
  - [ ] 修改 `CARD_PLAYS['杀'].effect`：集成选项2的计数逻辑
  - [ ] 修改 `CARD_PLAYS['杀'].canTarget`：使用带card参数的canReachSha
  - [ ] 修改 `startTurn` 函数：重置将驰相关状态
  - [ ] 修改 `duelResponse` 函数：集成选项1的禁止效果
  - [ ] 修改 `aoeRespond` 函数：集成选项1的禁止效果

- [ ] **render-controls.js**: 
  - [ ] 添加将驰的UI界面
  - [ ] 添加技能选择界面

### 待优化项

- 音效文件：需要添加 `assets/audio/jiangchi.mp3`
- UI/UX：将驰选择界面的用户体验优化
- 兼容性：确保与现有所有技能的兼容性测试，特别是英姿、咆哮、连弩、空城等技能