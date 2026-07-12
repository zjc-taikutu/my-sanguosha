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
- **距离效果通过 `getAttackDistance` 修改，保留目标合法性检查**
- **次数限制通过 `getSlashLimit` 和 `onUseSlash` 统一管理**

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
caozhang: {
  id: 'caozhang',
  name: '曹彰',
  gender: 'male',
  maxHp: 4,
  skills: ['jiangchi'], // 统一用skills数组
  desc: '将驰:摸牌阶段,你可以选择一项:1.额外摸一张牌,本回合不能使用或打出【杀】;2.少摸一张牌,本回合使用【杀】无距离限制且可以多使用一张【杀】。',
  caps: { jiangchi: true },
  hooks: {}
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
  if (typeof p.marks.jiangchi_enhanced !== 'boolean') p.marks.jiangchi_enhanced = false;
  if (typeof p.marks.jiangchi_distance !== 'boolean') p.marks.jiangchi_distance = false;
  if (typeof p.marks.jiangchi_used !== 'number') p.marks.jiangchi_used = 0;
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
// 清理将驰状态（回合开始和结束时调用）
function clearJiangchi(g, seat) {
  const p = g.players[seat];
  if (!p || !p.marks) return;
  p.marks.jiangchi_noSlash = false;
  p.marks.jiangchi_enhanced = false;
  p.marks.jiangchi_distance = false;
  p.marks.jiangchi_used = 0;
}
```

在 `startTurn(g, seat)` 中调用：
```javascript
clearJiangchi(g, seat);
```

在 `endTurn(g, seat)` 中调用：
```javascript
clearJiangchi(g, seat);
```

### 4.3 摸牌阶段核心逻辑

**修改 `doDraw` 函数：**
```javascript
function doDraw(g) {
  tx(g => {
    if (g.phase !== 'draw' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me.alive) return g;

    // 将驰：可选发动，检查是否已有将驰效果（防止重复发动）
    if (generalHasCap(me, 'jiangchi') && !me.marks.jiangchi_enhanced && !me.marks.jiangchi_noSlash) {
      const baseDraw = getBaseDrawNum(g, mySeat); // 动态获取基础摸牌数
      
      g.pending = {
        type: 'jiangchiChoose',
        seat: mySeat,
        baseDraw: baseDraw,
        options: [
          { id: 'jiangchi_more', desc: `多摸一张牌(摸${baseDraw + 1}张)，本回合不能使用或打出【杀】` },
          { id: 'jiangchi_less', desc: `少摸一张牌(摸${Math.max(0, baseDraw - 1)}张)，本回合【杀】无距离限制且可多用一张` },
          { id: 'jiangchi_cancel', desc: `不发动，正常摸${baseDraw}张` }
        ]
      };
      g.phase = 'jiangchiChoose';
      g.log = pushLog(g.log, `${me.name} 是否发动【将驰】？`);
      return g;
    }

    // 正常摸牌流程
    const toDraw = getBaseDrawNum(g, mySeat);
    ensureDeck(g, toDraw);
    drawN(g, mySeat, toDraw);
    g.phase = 'play';
    return g;
  });
}
```

**添加 `chooseJiangchi` 函数：**
```javascript
function chooseJiangchi(optionId) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'jiangchiChoose' || pending.seat !== mySeat) return g;
    
    const me = g.players[mySeat];
    if (!me || !me.alive) return g;
    
    const baseDraw = pending.baseDraw || 2;

    if (optionId === 'jiangchi_more') {
      // 选项1：多摸一张牌，本回合不能使用或打出【杀】
      const toDraw = baseDraw + 1;
      ensureDeck(g, toDraw);
      drawN(g, mySeat, toDraw);
      
      me.marks.jiangchi_noSlash = true;
      g.log = pushLog(g.log, `${me.name} 发动【将驰】，多摸一张牌，本回合不能使用或打出【杀】`);
      markSkillSound(g, 'jiangchi');
    } else if (optionId === 'jiangchi_less') {
      // 选项2：少摸一张牌，本回合【杀】无距离限制且可多用一张
      const toDraw = Math.max(0, baseDraw - 1);
      ensureDeck(g, toDraw);
      if (toDraw > 0) {
        drawN(g, mySeat, toDraw);
      }
      
      me.marks.jiangchi_enhanced = true;
      me.marks.jiangchi_distance = true;
      me.marks.jiangchi_used = 0;
      g.log = pushLog(g.log, `${me.name} 发动【将驰】，少摸一张牌，本回合【杀】无距离限制且可多用一张`);
      markSkillSound(g, 'jiangchi');
    } else { // jiangchi_cancel
      // 选项3：不发动，正常摸牌
      ensureDeck(g, baseDraw);
      drawN(g, mySeat, baseDraw);
      g.log = pushLog(g.log, `${me.name} 不发动【将驰】`);
    }

    // 清理pending状态
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}

// 动态获取基础摸牌数（兼容英姿等技能）
function getBaseDrawNum(g, seat) {
  const p = g.players[seat];
  let num = 2; // 默认值
  
  // 这里可以集成其他影响基础摸牌数的技能
  // 例如：英姿 +1，神诸葛等
  if (p.caps && p.caps.yingzi) {
    num += 1;
  }
  if (p.caps && p.caps.shenzhuge) {
    num += 1;
  }
  
  return num;
}
```

### 4.4 选项1效果实现（禁止使用/打出杀）

**修改 `canUseCard` 函数：**
```javascript
function canUseCard(g, seat, card) {
  // ... 现有代码 ...
  
  // 将驰选项1效果：本回合不能使用或打出【杀】
  const p = g.players[seat];
  if (p && p.marks && p.marks.jiangchi_noSlash && card.type === 'slash') {
    if (g.turn === seat) return false;
  }
  
  // ... 其余代码 ...
  return true;
}
```

**修改 `canRespond` 函数（响应阶段的禁止效果）：**
```javascript
function canRespond(g, seat, card, needType) {
  // ... 现有代码 ...
  
  // 将驰选项1效果：本回合不能打出【杀】作为响应
  const p = g.players[seat];
  if (p && p.marks && p.marks.jiangchi_noSlash && needType === 'slash' && card.type === 'slash') {
    if (g.turn === seat) return false;
  }
  
  // ... 其余代码 ...
  return true;
}
```

### 4.5 选项2效果实现（杀无距离限制且可多用一张）

**修改 `getAttackDistance` 函数：**
```javascript
function getAttackDistance(g, from, to) {
  const fp = g.players[from];
  
  // 将驰选项2效果：无距离限制（但保留其他合法性检查）
  if (fp && fp.marks && fp.marks.jiangchi_distance && g.turn === from) {
    return 1; // 直接视为距离1，即可攻击
  }
  
  return calcOriginalDistance(g, from, to);
}
```

**修改 `getSlashLimit` 函数：**
```javascript
function getSlashLimit(g, seat) {
  let limit = getBaseSlashLimit(g, seat); // 原本一般是1，咆哮是999等
  
  const p = g.players[seat];
  // 将驰选项2效果：多使用一张【杀】（基础次数+1，可叠加）
  if (p && p.marks && p.marks.jiangchi_enhanced && g.turn === seat) {
    limit = limit + 1;
  }
  
  return limit;
}

// 获取基础杀次数限制
function getBaseSlashLimit(g, seat) {
  // 默认值为1，可被咆哮等技能修改
  return 1;
}
```

**修改 `onUseSlash` 函数：**
```javascript
function onUseSlash(g, seat) {
  const p = g.players[seat];
  
  // 将驰选项2效果：记录使用的杀数量
  if (p && p.marks && p.marks.jiangchi_enhanced && g.turn === seat) {
    p.marks.jiangchi_used++;
  }
}
```

**在使用杀的地方调用检查：**
```javascript
function canUseSlay(g, from, to) {
  // ... 现有的目标合法性检查（死亡、翻面等） ...
  
  // 检查距离
  const distance = getAttackDistance(g, from, to);
  if (distance > getAttackRange(g, from)) {
    return false;
  }
  
  // 检查次数限制
  const slashUsed = g.players[from].marks ? (g.players[from].marks.jiangchi_used || 0) : 0;
  const slashLimit = getSlashLimit(g, from);
  if (slashUsed >= slashLimit) {
    return false;
  }
  
  // ... 其余检查 ...
  return true;
}
```

---

## 五、渲染集成（render-controls.js）

### 将驰选项选择UI

```javascript
// 在 renderControls 中添加将驰选择状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 将驰：选择阶段（安全渲染，避免注入风险）
  if (g.pending && g.pending.type === 'jiangchiChoose' && g.pending.seat === seat) {
    const container = document.createElement('div');
    container.className = 'skill-choose-panel';
    container.innerHTML = '<h4>【将驰】请选择</h4>';

    const options = g.pending.options || [];
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'skill-btn';
      btn.textContent = opt.desc;
      btn.onclick = () => window.chooseJiangchi(opt.id);
      container.appendChild(btn);
    });

    ui.appendChild(container);
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
   - 所有选项都使用 `ensureDeck(g, num)` 确保有足够的牌可摸
   - 选项2：若基础摸牌数为1，则少摸后为0张，仍可正常选择
2. **无合法选项**：若牌堆为空，所有选项都将摸0张牌，但仍应允许选择
3. **角色死亡**：在 `doDraw` 和 `chooseJiangchi` 中检查角色是否存活
4. **多次发动**：检查 `jiangchi_noSlash` 和 `jiangchi_enhanced` 标志，防止重复发动
5. **选项1与选项2互斥**：选择一种选项后，另一种选项的效果不生效
6. **杀的限制**：
   - 选项1：严格禁止使用/打出任何【杀】，包括作为响应
   - 选项2：无距离限制效果通过 `getAttackDistance` 实现，保留目标合法性检查
   - 选项2：多使用一张【杀】的限制为基础次数+1，可与咆哮等技能叠加

### 与其他技能的交互
1. **与摸牌相关技能的交互**（英姿、神诸葛等）：
   - 通过 `getBaseDrawNum(g, seat)` 动态获取基础摸牌数，与其他技能正常叠加
   - 选项1：基础摸牌数 + 1
   - 选项2：基础摸牌数 - 1
2. **与杀相关技能的交互**（咆哮、连弩等）：
   - 选项2的多杀效果是基础次数+1，通过 `getSlashLimit` 实现
   - 可以与咆哮（设置基础次数为999）等技能正常叠加
3. **与回合相关技能的交互**：
   - 将驰的效果仅在当前回合生效
   - 回合开始和结束时都清理将驰状态，确保不影响下回合
4. **与距离相关技能的交互**：
   - 选项2的无距离限制通过 `getAttackDistance` 实现
   - 可以与其他距离修正效果正常叠加

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **基本功能** | |
| 将驰：选择选项1，牌堆充足 | 多摸1张牌（基于基础摸牌数），本回合不能使用/打出【杀】 |
| 将驰：选择选项1，牌堆仅1张 | 多摸1张牌（实际摸完所有剩余牌），本回合不能使用/打出【杀】 |
| 将驰：选择选项2，牌堆充足 | 少摸1张牌（基于基础摸牌数），本回合【杀】无距离限制且可多用一张 |
| 将驰：选择选项2，牌堆为空 | 摸0张牌，本回合【杀】无距离限制且可多用一张 |
| 将驰：选择选项3（不发动） | 正常摸牌（基础摸牌数） |
| **选项1禁止效果** | |
| 将驰：选项1后尝试出牌阶段使用杀 | 不能使用【杀】 |
| 将驰：选项1后尝试响应使用杀 | 不能打出【杀】作为响应 |
| **选项2增强效果** | |
| 将驰：选项2时距离检查 | 使用【杀】时忽略距离限制（但保留目标合法性检查） |
| 将驰：选项2时杀数量限制 | 本回合最多使用基础次数+1张【杀】 |
| 将驰：选项2 + 咆哮 | 咆哮设置基础次数为999，将驰+1后为1000次（理论上） |
| **与其他技能叠加** | |
| 将驰 + 英姿：选择选项1 | 基础3张 + 1 = 4张牌 |
| 将驰 + 英姿：选择选项2 | 基础3张 - 1 = 2张牌 |
| 将驰 + 咆哮：选择选项2 | 基础次数999 + 1 = 1000次（理论上） |
| **多人局** | |
| 多人局：A发动将驰选项1 | 只影响A本回合，B可以正常使用杀 |
| 多人局：A发动将驰选项2 | 只影响A本回合，B使用杀时无增强效果 |
| **回合切换** | |
| 将驰：回合结束重置 | 所有将驰标志在下回合开始时重置 |
| 将驰：连续多个回合发动 | 每个回合独立计算，互不影响 |

---

## 九、实现优先级

1. **数据定义优先**：添加武将基本定义
2. **状态管理优先**：添加pending状态防御和玩家marks字段
3. **核心逻辑优先**：实现将驰的三个选项的核心效果
4. **辅助函数优先**：实现 `getBaseDrawNum`、`getSlashLimit`、`clearJiangchi` 等
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
   - 通过 `getBaseDrawNum` 动态获取基础摸牌数，确保与其他摸牌技能兼容

2. **技能使用系统**：
   - 在 `canUseCard` 和 `canRespond` 中集成选项1的禁止效果
   - 通过 `getAttackDistance` 集成选项2的无距离限制效果
   - 通过 `getSlashLimit` 和 `onUseSlash` 集成选项2的多杀效果

3. **状态管理**：
   - 使用玩家私有的 `marks` 存储状态，避免多人局冲突
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程

4. **日志系统**：
   - 为将驰的发动添加对应的日志记录
   - 确保日志清晰地反映技能的发动和效果

### 需要修改的文件

1. **data.js**：
   - 添加曹彰武将定义

2. **game.js**：
   - `normalize()`：添加将驰玩家marks字段防御
   - 修改 `doDraw` 函数：添加将驰触发逻辑
   - 添加 `chooseJiangchi` 函数
   - 添加 `clearJiangchi` 函数
   - 添加 `getBaseDrawNum` 函数
   - 添加 `getSlashLimit` 函数
   - 添加 `getAttackDistance` 函数
   - 添加 `onUseSlash` 函数
   - 修改 `canUseCard` 函数：集成选项1的禁止效果
   - 修改 `canRespond` 函数：集成选项1的禁止效果
   - 修改 `canUseSlay` 函数：使用 `getAttackDistance` 和 `getSlashLimit`
   - 修改 `startTurn` 函数：调用 `clearJiangchi`
   - 修改 `endTurn` 函数：调用 `clearJiangchi`

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
是：进入将驰选择阶段，动态计算基础摸牌数
    ↓
显示3个选项：多摸1张、少摸1张、不发动
    ↓
玩家选择选项
    ↓
选项1: 多摸1张 → 设置marks.jiangchi_noSlash=true → 进入出牌阶段
    ↓
选项2: 少摸1张 → 设置marks.jiangchi_enhanced=true, marks.jiangchi_distance=true, marks.jiangchi_used=0 → 进入出牌阶段
    ↓
选项3: 不发动 → 正常摸牌 → 进入出牌阶段
    ↓
回合开始/结束时：调用clearJiangchi清理所有状态
```

### 将驰效果流程

**选项1效果流程：**
```
出牌阶段/响应阶段
    ↓
尝试使用/打出【杀】
    ↓
检查marks.jiangchi_noSlash标志
    ↓
是：禁止使用/打出 → 返回false
```

**选项2效果流程：**
```
使用【杀】时
    ↓
检查目标合法性（死亡、翻面等）
    ↓
通过getAttackDistance计算距离
    ↓
marks.jiangchi_distance=true时：返回距离1
    ↓
检查getSlashLimit（基础次数+1）
    ↓
marks.jiangchi_used < limit时：允许使用，调用onUseSlash记录使用次数
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
- **注意：完全禁止使用/打出任何【杀】，包括作为响应**

**选项2（少摸一张牌，杀增强）：**
- 适用于进攻回合，特别针对高防御目标
- 无距离限制可以攻击任意目标
- 多使用一张杀可以快速清场
- **注意：多杀效果是基础次数+1，可与咆哮等技能叠加**

**选项3（不发动）：**
- 保持正常摸牌
- 适用于需要保持灵活性的场合

### 关于技能平衡性

曹彰作为4体力的魏国武将，将驰提供了灵活的选择：

**选项1的平衡：**
- 多摸1张牌提供额外资源
- 代价是本回合完全不能使用任何杀，限制了进攻能力
- 需要玩家权衡资源和进攻的关系

**选项2的平衡：**
- 少摸1张牌减少资源获取
- 但获得强大的杀增强效果：无距离限制 + 多一张杀
- 可以有效压制对手的防御策略

**整体平衡：**
- 三个选项都有明确的收益和代价
- 玩家需要根据场上形势选择最优策略
- 与魏国其他武将的协同性良好

### 关于与其他技能的交互

1. **与手牌相关技能的交互**：
   - 将驰的摸牌效果通过 `getBaseDrawNum` 动态计算，与其他手牌相关的技能正常叠加
   - 选项1的额外手牌可以触发手牌上限相关的效果

2. **与攻击相关技能的交互**：
   - 选项1的禁止效果应优先于其他允许使用杀的效果
   - 选项2的无距离限制与其他距离修正效果正常叠加
   - 选项2的多杀效果是基础次数+1，**可与咆哮、连弩等技能叠加**

3. **与回合相关技能的交互**：
   - 将驰的效果仅在当前回合生效
   - 回合结束时自动重置所有标志

---

## 十三、修正记录

*文档状态：已修正致命问题*
*创建时间：2026-07-13*
*修正时间：2026-07-13*
*负责人：Mistral Vibe*

### 已修正的致命问题

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
- 修正：`limit = getBaseSlashLimit() + 1` 可与其他加次数技能叠加

### 待实装项

- [ ] **data.js**: 添加曹彰武将定义
- [ ] **game.js**: 
  - [ ] normalize函数：添加将驰玩家marks字段防御
  - [ ] 修改doDraw函数：添加将驰触发逻辑
  - [ ] 添加chooseJiangchi函数
  - [ ] 添加clearJiangchi函数
  - [ ] 添加getBaseDrawNum函数
  - [ ] 添加getSlashLimit函数
  - [ ] 添加getAttackDistance函数
  - [ ] 添加onUseSlash函数
  - [ ] 修改canUseCard函数：集成选项1的禁止效果
  - [ ] 修改canRespond函数：集成选项1的禁止效果
  - [ ] 修改canUseSlay函数：使用getAttackDistance和getSlashLimit
  - [ ] 修改startTurn函数：调用clearJiangchi
  - [ ] 修改endTurn函数：调用clearJiangchi
- [ ] **render-controls.js**: 
  - [ ] 添加将驰的UI界面
  - [ ] 添加技能选择界面

### 待优化项

- 音效文件：需要添加assets/audio/jiangchi.mp3
- UI/UX：将驰选择界面的用户体验优化
- 兼容性：确保与现有所有技能的兼容性测试，特别是英姿、咆哮、连弩等技能