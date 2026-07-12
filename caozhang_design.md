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
- 属于**摸牌阶段可选行为**，需与 `doDraw` 流程集成
- **状态挂在玩家私有 `marks` 上**，避免多人局互相影响
- **动态获取基础摸牌数**，兼容英姿、神诸葛等其他摸牌技能
- **选项2的多杀效果为基础次数+1**，可与咆哮、连弩等技能叠加
- **距离效果只对【杀】生效**，通过 `getAttackDistance(g, from, to, card)` 带card上下文判断
- **次数限制使用统一的 `slashUsedThisTurn` 计数器，将驰只负责+1上限**
- **使用 `isSlash(card)` 统一判断所有类型的杀（普通杀、火杀、雷杀等）**

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
  if (typeof p.marks.jiangchi_distance !== 'boolean') p.marks.jiangchi_distance = false;
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
  p.marks.jiangchi_distance = false;
  p.marks.jiangchi_plus = 0;
}
```

在 `startTurn(g, seat)` 中调用：
```javascript
clearJiangchi(g, seat);
```

> **注意**：只在 `startTurn` 调用即可，`endTurn` 不用调用，避免回放时状态丢失。

### 4.3 摸牌阶段核心逻辑

**修改 `doDraw` 函数：**
```javascript
function doDraw(g) {
  tx(g => {
    if (g.phase !== 'draw' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me.alive || me.marks.jiangchi_noSlash || me.marks.jiangchi_plus) return g;

    if (generalHasCap(me, 'jiangchi')) {
      const baseDraw = getBaseDrawNum(g, mySeat); // 动态获取基础摸牌数
      
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
      g.log = pushLog(g.log, `${me.name} 是否发动`);
      return g;
    }
    
    const n = getBaseDrawNum(g, mySeat);
    ensureDeck(g); drawN(g, mySeat, n); g.phase = 'play';
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
      ensureDeck(g); drawN(g, mySeat, base + 1);
      me.marks.jiangchi_noSlash = true;
      g.log = pushLog(g.log, `${me.name} 发动`);
    } else if (optionId === 'less') {
      const n = Math.max(0, base - 1);
      ensureDeck(g); if (n > 0) drawN(g, mySeat, n);
      me.marks.jiangchi_distance = true;
      me.marks.jiangchi_plus = 1;
      g.log = pushLog(g.log, `${me.name} 发动`);
    } else { // cancel
      ensureDeck(g); drawN(g, mySeat, base);
      g.log = pushLog(g.log, `${me.name} 不发动`);
    }
    markSkillSound(g, mySeat, 'jiangchi');
    g.pending = null; g.phase = 'play';
    return g;
  });
}

// 动态获取基础摸牌数（兼容英姿等技能）
function getBaseDrawNum(g, seat) {
  let base = 2;
  const p = g.players[seat];
  // 通过 hooks 扩展，避免硬编码
  if (g.hooks?.onGetBaseDrawNum) {
    base = g.hooks.onGetBaseDrawNum(g, seat, base);
  }
  // 兼容写法：使用 generalHasCap
  if (generalHasCap(p, 'yingzi')) base += 1;
  return base;
}
```

### 4.4 选项1效果实现（禁止使用/打出杀）

**添加 `isSlash` 统一判断函数：**
```javascript
// 统一判断是否为杀（包含普通杀、火杀、雷杀等所有类型）
function isSlash(card) {
  return card && (card.type === 'slash' || card.subtype === 'slash' || card.isSlash);
}
```

**修改 `canUseCard` 函数：**
```javascript
function canUseCard(g, seat, card) {
  const p = g.players[seat];
  // 将驰选项1效果：本回合不能使用或打出杀
  if (p?.marks?.jiangchi_noSlash && isSlash(card) && g.turn === seat) return false;
  return true;
}
```

**修改 `canRespond` 函数（响应阶段的禁止效果）：**
```javascript
function canRespond(g, seat, card, needType) {
  const p = g.players[seat];
  // 将驰选项1效果：本回合不能打出杀作为响应
  if (p?.marks?.jiangchi_noSlash && isSlash(card) && (needType === 'slash' || isSlash({type: needType})) && g.turn === seat) return false;
  return true;
}
```

### 4.5 选项2效果实现（杀无距离限制且可多用一张）

**修改 `getAttackDistance` 函数（带card上下文，只对杀生效）:**
```javascript
function getAttackDistance(g, from, to, card) {
  const fp = g.players[from];
  // 将驰选项2效果：只对杀生效，无距离限制（但保留其他合法性检查）
  if (card && isSlash(card) && fp?.marks?.jiangchi_distance && g.turn === from) {
    return 1; // 保留合法性检查，但距离视为1
  }
  return calcOriginalDistance(g, from, to);
}
```

**修改 `getSlashLimit` 函数（只负责+1上限，计数用全局的slashUsedThisTurn）:**
```javascript
function getSlashLimit(g, seat) {
  let limit = 1;
  // 通过 hooks 扩展（咆哮等技能会修改这个值）
  if (g.hooks?.onGetBaseSlashLimit) {
    limit = g.hooks.onGetBaseSlashLimit(g, seat, limit);
  }
  
  const p = g.players[seat];
  // 将驰选项2效果：多使用一张【杀】（基础次数+1，可叠加）
  if (p?.marks?.jiangchi_plus && g.turn === seat) {
    limit += p.marks.jiangchi_plus;
  }
  // 咆哮/连弩会把 limit 设为 99，在此基础上 +1
  return limit;
}
```

**修改 `canUseSlay` 函数（使用统一的slashUsedThisTurn计数器）:**
```javascript
function canUseSlay(g, from, to, card) {
  // 检查目标是否存活
  if (!isAlive(g, to)) return false;
  
  // 检查距离（带card上下文）
  if (getAttackDistance(g, from, to, card) > getAttackRange(g, from, card)) return false;
  
  // 检查次数限制（使用统一的slashUsedThisTurn计数器）
  const used = g.players[from].slashUsedThisTurn || 0;
  if (used >= getSlashLimit(g, from)) return false;
  
  return true;
}
```

> **重要说明**：
> - 不再需要 `onUseSlash` 和 `jiangchi_used`，使用引擎已有的 `g.players[seat].slashUsedThisTurn` 统一计数
> - 将驰只负责+1上限，计数由全局计数器负责

---

## 五、渲染集成（render-controls.js）

### 将驰选项选择UI

```javascript
function renderControls(g) {
  const seat = mySeat, p = g.players[seat];
  if (g.pending?.type === 'jiangchiChoose' && g.pending.seat === seat) {
    const wrap = document.createElement('div');
    wrap.className = 'skill-choose-panel';
    wrap.innerHTML = '<h4></h4>';
    
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

> **安全渲染**：使用 `document.createElement` 代替 `innerHTML +=`，避免XSS注入风险。

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
   - 选项1：严格禁止使用/打出任何类型的【杀】（普通杀、火杀、雷杀等），包括作为响应
   - 选项2：无距离限制效果**只对【杀】生效**，通过 `getAttackDistance(g, from, to, card)` 带card上下文判断
   - 选项2：多使用一张【杀】的限制为基础次数+1，使用统一的 `slashUsedThisTurn` 计数器

### 与其他技能的交互
1. **与摸牌相关技能的交互**（英姿等）：
   - 通过 `getBaseDrawNum(g, seat)` 和 hooks 机制动态计算，与其他技能正常叠加
   - 选项1：基础摸牌数 + 1
   - 选项2：基础摸牌数 - 1
2. **与杀相关技能的交互**（咆哮、连弩等）：
   - 选项2的多杀效果是基础次数+1，通过 `getSlashLimit` 实现
   - 使用统一的 `slashUsedThisTurn` 计数器，可与咆哮（设置基础次数为99）等技能正常叠加
   - 咆哮+将驰：基础次数99 + 1 = 100次
3. **与距离相关技能的交互**（顺手牵羊、乐不思蜀等）：
   - 选项2的无距离限制**只对【杀】生效**，通过card上下文判断
   - 顺手牵羊、乐不思蜀等非杀牌不会受到将驰的距离影响
4. **与回合相关技能的交互**：
   - 将驰的效果仅在当前回合生效
   - 回合开始时清理将驰状态，确保不影响下回合

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **基本功能** | |
| 将驰：选择选项1，牌堆充足 | 多摸1张牌（基于基础摸牌数），本回合不能使用/打出任何类型的杀 |
| 将驰：选择选项1，牌堆仅1张 | 多摸1张牌（实际摸完所有剩余牌），本回合不能使用/打出任何类型的杀 |
| 将驰：选择选项2，牌堆充足 | 少摸1张牌（基于基础摸牌数），本回合【杀】无距离限制且可多用一张 |
| 将驰：选择选项2，牌堆为空 | 摸0张牌，本回合【杀】无距离限制且可多用一张 |
| 将驰：选择选项3（不发动） | 正常摸牌（基础摸牌数） |
| **选项1禁止效果** | |
| 将驰：选项1后尝试使用普通杀 | 不能使用 |
| 将驰：选项1后尝试使用火杀 | 不能使用 |
| 将驰：选项1后尝试使用雷杀 | 不能使用 |
| 将驰：选项1后尝试响应使用杀 | 不能打出任何类型的杀作为响应 |
| **选项2增强效果** | |
| 将驰：选项2时使用普通杀距离检查 | 忽略距离限制 |
| 将驰：选项2时使用火杀距离检查 | 忽略距离限制 |
| 将驰：选项2时使用顺手牵羊距离检查 | 正常距离检查（不受将驰影响） |
| 将驰：选项2时使用乐不思蜀距离检查 | 正常距离检查（不受将驰影响） |
| 将驰：选项2时杀数量限制 | 本回合最多使用基础次数+1张【杀】 |
| **与其他技能叠加** | |
| 将驰 + 英姿：选择选项1 | 基础3张 + 1 = 4张牌 |
| 将驰 + 英姿：选择选项2 | 基础3张 - 1 = 2张牌 |
| 将驰 + 咆哮：选择选项2 | 基础次数99 + 1 = 100次 |
| 将驰 + 咆哮 + 连弩：选择选项2 | 基础次数99 + 1（连弩） + 1（将驰）= 101次 |
| **多人局** | |
| 多人局：A发动将驰选项1 | 只影响A本回合，B可以正常使用所有类型的杀 |
| 多人局：A发动将驰选项2 | 只影响A本回合的【杀】，B使用杀时无增强效果 |
| **回合切换** | |
| 将驰：回合结束重置 | 所有将驰标志在下回合开始时重置 |
| 将驰：连续多个回合发动 | 每个回合独立计算，互不影响 |

---

## 九、实现优先级

1. **数据定义优先**：添加武将基本定义
2. **状态管理优先**：添加pending状态防御和玩家marks字段
3. **核心逻辑优先**：实现将驰的三个选项的核心效果
4. **辅助函数优先**：实现 `getBaseDrawNum`、`getSlashLimit`、`getAttackDistance`、`isSlash` 等
5. **UI集成优先**：添加技能选择界面
6. **效果集成**：在相关函数中集成选项1和选项2的效果
7. **音效集成**：添加技能音效
8. **边界处理**：处理牌堆不足等边界条件
9. **测试验证**：确保所有场景都通过测试

---

## 十、集成要点

### 与现有系统的集成

1. **摸牌系统**：
   - 复用 `drawN`、`ensureDeck` 函数
   - 通过 `getBaseDrawNum` 和 hooks 机制动态获取基础摸牌数

2. **技能使用系统**：
   - 在 `canUseCard` 和 `canRespond` 中集成选项1的禁止效果
   - 通过 `getAttackDistance(g, from, to, card)` 集成选项2的无距离限制效果
   - 通过 `getSlashLimit` 集成选项2的多杀效果

3. **状态管理**：
   - 使用玩家私有的 `marks` 存储状态，避免多人局冲突
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程

4. **统一计数系统**：
   - 使用引擎已有的 `g.players[seat].slashUsedThisTurn` 统一计数
   - 将驰只负责+1上限，计数由全局计数器负责

5. **卡牌类型判断**：
   - 使用 `isSlash(card)` 统一判断所有类型的杀

6. **日志系统**：
   - 为将驰的发动添加对应的日志记录

### 需要修改的文件

1. **data.js**：
   - 添加曹彰武将定义

2. **game.js**：
   - `normalize()`：添加将驰玩家marks字段防御
   - 修改 `doDraw` 函数：添加将驰触发逻辑
   - 添加 `chooseJiangchi` 函数
   - 添加 `clearJiangchi` 函数
   - 添加 `getBaseDrawNum` 函数
   - 添加 `isSlash` 函数
   - 添加 `getAttackDistance` 函数（带card参数）
   - 修改 `getSlashLimit` 函数
   - 修改 `canUseCard` 函数：集成选项1的禁止效果
   - 修改 `canRespond` 函数：集成选项1的禁止效果
   - 修改 `canUseSlay` 函数：使用 `getAttackDistance` 和 `getSlashLimit`
   - 修改 `startTurn` 函数：调用 `clearJiangchi`

3. **render-controls.js**：
   - 添加将驰的UI界面

---

## 十一、流程图

### 将驰完整流程

```
摸牌阶段开始
    ↓
检查是否拥有将驰技能且未发动过
    ↓
是：进入将驰选择阶段，动态计算基础摸牌数
    ↓
显示3个选项：多摸1张、少摸1张、不发动
    ↓
玩家选择选项
    ↓
选项1: 多摸1张 → 设置marks.jiangchi_noSlash=true → 进入出牌阶段
    ↓
选项2: 少摸1张 → 设置marks.jiangchi_distance=true, marks.jiangchi_plus=1 → 进入出牌阶段
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
检查isSlash(card) && marks.jiangchi_noSlash
    ↓
是：禁止使用/打出 → 返回false
```

**选项2效果流程：**
```
使用卡牌时
    ↓
检查isSlash(card) && marks.jiangchi_distance
    ↓
是：通过getAttackDistance(g, from, to, card)返回距离1
    ↓
检查getSlashLimit（基础次数 + jiangchi_plus）
    ↓
slashUsedThisTurn < limit时：允许使用
    ↓
否：禁止使用（已达到上限）
```

---

## 十二、特殊说明

### 关于将驰的技能定位

将驰是曹彰的进攻型技能，体现了其骁勇善战的特点。通过在摸牌阶段的选择，曹彰可以在不同场合发挥不同的作用：

**选项1（多摸一张牌，不能用杀）：**
- 适用于需要手牌但不需要攻击的场合
- 可以快速积累手牌资源
- 适合防御或准备大招的回合
- **注意：完全禁止使用/打出任何类型的杀（普通杀、火杀、雷杀等），包括作为响应**

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

### 关于与其他技能的交互

1. **与手牌相关技能的交互**：
   - 将驰的摸牌效果通过 `getBaseDrawNum` 和 hooks 机制动态计算，与其他手牌相关的技能正常叠加

2. **与攻击相关技能的交互**：
   - 选项1的禁止效果使用 `isSlash(card)` 统一判断，覆盖所有类型的杀
   - 选项2的无距离限制**只对杀生效**，通过card上下文判断
   - 选项2的多杀效果使用统一的 `slashUsedThisTurn` 计数器，可与咆哮、连弩等技能正常叠加

3. **与回合相关技能的交互**：
   - 将驰的效果仅在当前回合生效
   - 回合开始时自动重置所有标志

---

## 十三、修正记录

*文档状态：已修正所有致命问题*
*创建时间：2026-07-13*
*最终修正时间：2026-07-13*
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
- 修正：通过 `getAttackDistance` 和 `getSlashLimit` 分离检查，保留所有合法性检查

✅ **问题4：`START_HAND` 硬编码** → **修正：动态获取基础摸牌数**
- 原：`toDraw = START_HAND + 1` 与英姿等冲突
- 修正：使用 `getBaseDrawNum(g, seat)` 动态计算

✅ **问题5：`normalize` 里用 `mySeat`** → **修正：使用服务端纯函数逻辑**
- 原：`d.seat !== mySeat` 依赖客户端变量
- 修正：直接检查座位号和角色状态，不依赖客户端变量

✅ **问题6：距离实现粗暴** → **修正：保留目标合法性检查**
- 原：`canUseSlay` 里直接 `return true` 跳过所有检查
- 修正：通过 `getAttackDistance` 返回距离1，保留目标死亡、翻面等检查

✅ **问题7：上限写死为2** → **修正：基础次数+1**
- 原：`slashLimit = 2` 覆盖咆哮等技能
- 修正：`limit = getBaseSlashLimit() + jiangchi_plus` 可与其他加次数技能叠加

#### 第二批3个隐藏Bug（已修正）

✅ **问题8：距离穿透所有牌** → **修正：距离函数带card上下文，只对杀生效**
- 原：`getAttackDistance` 返回1会让顺手牵羊、乐不思蜀也无距离了
- 修正：`getAttackDistance(g, from, to, card)` 带card参数，只对isSlash(card)生效

✅ **问题9：火杀雷杀漏判** → **修正：使用isSlash(card)统一判断**
- 原：`card.type === 'slash'` 只匹配普通杀，火杀fire_slash会绕过禁止
- 修正：使用 `isSlash(card)` 覆盖所有类型的杀（普通杀、火杀、雷杀等）

✅ **问题10：出杀计数器混淆** → **修正：分开计数，将驰只负责+1上限**
- 原：`jiangchi_used` 当总出杀次数，但咆哮、连弩也用总次数，导致计数错误
- 修正：使用统一的 `slashUsedThisTurn` 计数器，将驰只存 `jiangchi_plus=1`（+1上限）

### 待实装项

- [ ] **data.js**: 添加曹彰武将定义
- [ ] **game.js**: 
  - [ ] normalize函数：添加将驰玩家marks字段防御
  - [ ] 修改doDraw函数：添加将驰触发逻辑
  - [ ] 添加chooseJiangchi函数
  - [ ] 添加clearJiangchi函数
  - [ ] 添加getBaseDrawNum函数
  - [ ] 添加isSlash函数
  - [ ] 添加/修改getAttackDistance函数（带card参数）
  - [ ] 修改getSlashLimit函数
  - [ ] 修改canUseCard函数：集成选项1的禁止效果
  - [ ] 修改canRespond函数：集成选项1的禁止效果
  - [ ] 修改canUseSlay函数：使用getAttackDistance和getSlashLimit
  - [ ] 修改startTurn函数：调用clearJiangchi
- [ ] **render-controls.js**: 
  - [ ] 添加将驰的UI界面

### 待优化项

- 音效文件：需要添加assets/audio/jiangchi.mp3
- UI/UX：将驰选择界面的用户体验优化
- 兼容性：确保与现有所有技能的兼容性测试，特别是英姿、咆哮、连弩等技能