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
**时机**：摸牌阶段

**效果**：
你可以选择以下一项执行：
1. **多摸一张牌**，然后本回合你不能使用或者打出【杀】；
2. **少摸一张牌**，然后本回合你使用【杀】无距离限制且你可以多使用一张【杀】。

**设计要点**：
- 属于**摸牌阶段替代行为**，需与 `doDraw` 流程集成
- 需要在摸牌阶段提供两个选项供玩家选择
- 选项1：额外摸1张牌，但本回合禁止使用/打出【杀】
- 选项2：少摸1张牌，但本回合【杀】无距离限制且可多使用1张【杀】
- 需要跟踪本回合的【杀】使用限制状态
- 需要标记本回合是否选择了将驰选项1

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
caozhang: {
  id: 'caozhang',
  name: '曹彰',
  gender: 'male',
  maxHp: 4,
  skill: '将驰',
  desc: '将驰:摸牌阶段,你可以选择一项:1.多摸一张牌,然后本回合你不能使用或打出【杀】;2.少摸一张牌,然后本回合你使用【杀】无距离限制且你可以多使用一张【杀】。',
  caps: { jiangchi: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 曹彰【将驰】:本回合是否选择了选项1（不能使用/打出杀）
if(typeof g.jiangchiNoSlash!=='boolean') g.jiangchiNoSlash=false;

// 曹彰【将驰】:本回合是否选择了选项2（杀无距离限制且可多用一张杀）
if(typeof g.jiangchiEnhancedSlash!=='boolean') g.jiangchiEnhancedSlash=false;

// 曹彰【将驰】:本回合已使用的杀数量（用于限制选项2的多杀效果）
if(typeof g.jiangchiSlashUsed!=='number') g.jiangchiSlashUsed=0;

// 曹彰【将驰】:选择阶段
if(g.pending && g.pending.type==='jiangchiChoose'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     d.seat !== mySeat || !Array.isArray(d.options) || d.options.length !== 2){
    g.pending = null;
    g.phase = 'draw';
  }
}
```

在 `startTurn` 函数中添加重置：
```javascript
g.jiangchiNoSlash = false;
g.jiangchiEnhancedSlash = false;
g.jiangchiSlashUsed = 0;  // 在其他标志位重置的同一行
```

---

## 四、技能实现

### 将驰实现

**集成点**：`doDraw` 函数（摸牌阶段入口）

```javascript
// 修改 doDraw 函数，在摸牌前检查将驰
function doDraw(g) {
  tx(g => {
    if (g.phase !== 'draw' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];

    // 将驰：提供选项选择
    if (generalHasCap(me, 'jiangchi')) {
      // 进入将驰选择阶段
      g.pending = {
        type: 'jiangchiChoose',
        seat: mySeat,
        options: [
          { id: 'option1', desc: '多摸一张牌，本回合不能使用或打出【杀】' },
          { id: 'option2', desc: '少摸一张牌，本回合【杀】无距离限制且可多用一张【杀】' }
        ]
      };
      g.phase = 'jiangchiChoose';
      g.log = pushLog(g.log, `${me.name} 发动【将驰】,请选择一项效果`);
      return g;
    }

    // 正常摸牌流程
    const toDraw = START_HAND;
    drawN(g, mySeat, toDraw);
    g.phase = 'play';
    return g;
  });
}
```

```javascript
// 将驰选项选择
function chooseJiangchi(optionId) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'jiangchiChoose' || pending.seat !== mySeat) return g;

    const me = g.players[mySeat];
    if (!me || !me.alive) return g;

    if (optionId === 'option1') {
      // 选项1：多摸一张牌，本回合不能使用或打出【杀】
      const toDraw = START_HAND + 1;
      drawN(g, mySeat, toDraw);
      
      g.jiangchiNoSlash = true;
      g.jiangchiEnhancedSlash = false;
      g.log = pushLog(g.log, `${me.name} 选择【将驰】效果1:多摸一张牌，本回合不能使用或打出【杀】`);
      markSkillSound(g, '将驰');
    } else if (optionId === 'option2') {
      // 选项2：少摸一张牌，本回合【杀】无距离限制且可多用一张【杀】
      const toDraw = Math.max(0, START_HAND - 1);
      if (toDraw > 0) {
        drawN(g, mySeat, toDraw);
      }
      
      g.jiangchiEnhancedSlash = true;
      g.jiangchiNoSlash = false;
      g.log = pushLog(g.log, `${me.name} 选择【将驰】效果2:少摸一张牌，本回合【杀】无距离限制且可多用一张【杀】`);
      markSkillSound(g, '将驰');
    }

    // 清理pending状态
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}
```

### 将驰选项1效果实现（禁止使用/打出杀）

在 `canUseCard` 函数中添加检查：
```javascript
function canUseCard(g, cardType, targetSeat) {
  // ... 现有代码 ...
  
  // 将驰选项1效果：本回合不能使用或打出【杀】
  if (cardType === 'slay' && g.jiangchiNoSlash && g.turn === mySeat) {
    return false;
  }
  
  // ... 其余代码 ...
}
```

在 `canPlayAsResponse` 函数中添加检查：
```javascript
function canPlayAsResponse(g, card, responseType) {
  // ... 现有代码 ...
  
  // 将驰选项1效果：本回合不能打出【杀】
  if (responseType === 'slay' && g.jiangchiNoSlash && g.turn === mySeat) {
    return false;
  }
  
  // ... 其余代码 ...
}
```

### 将驰选项2效果实现（杀无距离限制且可多用一张）

在 `canUseSlay` 函数中添加检查：
```javascript
function canUseSlay(g, targetSeat) {
  // ... 现有距离检查 ...
  
  // 将驰选项2效果：杀无距离限制
  if (g.jiangchiEnhancedSlash && g.turn === mySeat) {
    // 跳过距离检查
    return true;
  }
  
  // ... 其余距离检查 ...
}
```

在 `useSlay` 函数中添加多杀效果：
```javascript
function useSlay(g, targetSeat) {
  // ... 现有使用杀的逻辑 ...
  
  // 将驰选项2效果：记录使用的杀数量
  if (g.jiangchiEnhancedSlash && g.turn === mySeat) {
    g.jiangchiSlashUsed = (g.jiangchiSlashUsed || 0) + 1;
  }
  
  // ... 其余逻辑 ...
}
```

在 `canUseSlay` 函数中添加多杀限制：
```javascript
function canUseSlay(g, targetSeat) {
  // ... 现有检查 ...
  
  // 将驰选项2效果：最多可以使用2张杀（基础1张 + 额外1张）
  if (g.jiangchiEnhancedSlash && g.turn === mySeat) {
    const slashLimit = 2; // 基础1张 + 额外1张
    if ((g.jiangchiSlashUsed || 0) >= slashLimit) {
      return false;
    }
  }
  
  // ... 其余检查 ...
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

  // 将驰：选择阶段
  if (g.pending && g.pending.type === 'jiangchiChoose' && g.pending.seat === seat) {
    const options = g.pending.options || [];
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【将驰】选择效果</h4>
        <p>请选择一项效果:</p>
    `;
    
    options.forEach((option, index) => {
      ui.innerHTML += `
        <button onclick="chooseJiangchi('${option.id}')" class="skill-btn" style="background: #d4a762; margin: 5px;">
          ${index + 1}. ${option.desc}
        </button>
      `;
    });
    
    ui.innerHTML += `
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
  '将驰': 'jiangchi',
};
```

---

## 七、边界条件处理

### 将驰
1. **牌堆不足**：
   - 选项1：使用 `ensureDeck(g)` 确保有足够的牌可摸
   - 选项2：若START_HAND=2，则少摸后为1张，若牌堆为空则摸0张
2. **无合法选项**：若牌堆为空且START_HAND=1，选项2将摸0张牌，仍应允许选择
3. **角色死亡**：角色死亡时不能发动将驰
4. **多次发动**：每回合摸牌阶段只能发动一次将驰
5. **选项1与选项2互斥**：选择一种选项后，另一种选项的效果不生效
6. **杀的限制**：
   - 选项1：严格禁止使用/打出任何【杀】，包括作为响应
   - 选项2：无距离限制效果在任何使用【杀】的场合都生效
   - 选项2：多使用一张【杀】的限制为本回合内最多2张（基础1张+额外1张）

### 与其他技能的交互
1. **与摸牌相关技能的交互**：
   - 将驰的摸牌效果应与其他摸牌技能正常叠加
   - 选项1的额外摸牌和选项2的减少摸牌都基于START_HAND计算
2. **与杀相关技能的交互**：
   - 选项1的禁止效果应覆盖其他所有允许使用杀的情况
   - 选项2的无距离限制应与其他距离相关效果正常叠加
3. **与回合相关技能的交互**：
   - 将驰的效果仅在本回合生效
   - 回合结束时自动重置所有标志

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| 将驰：选择选项1，牌堆充足 | 多摸1张牌（共3张），本回合不能使用/打出【杀】 |
| 将驰：选择选项1，牌堆仅1张 | 多摸1张牌（共2张），本回合不能使用/打出【杀】 |
| 将驰：选择选项2，牌堆充足 | 少摸1张牌（共1张），本回合【杀】无距离限制且可使用2张【杀】 |
| 将驰：选择选项2，牌堆为空 | 摸0张牌，本回合【杀】无距离限制且可使用2张【杀】 |
| 将驰：尝试在选项1后使用杀 | 不能使用任何【杀】，包括作为响应 |
| 将驰：选项2时距离检查 | 使用【杀】时忽略距离限制 |
| 将驰：选项2时杀数量限制 | 本回合最多使用2张【杀】 |
| 将驰：取消选择 | 回到正常摸牌流程（摸2张牌） |
| 将驰：回合结束重置 | 所有将驰标志在下回合开始时重置 |
| 将驰：与其他摸牌技能叠加 | 将驰的摸牌效果与其他技能正常叠加 |
| 将驰：与其他杀相关技能叠加 | 将驰的杀相关效果与其他技能正常叠加 |

---

## 九、实现优先级

1. **数据定义优先**：添加武将基本定义
2. **状态管理优先**：添加pending状态防御和回合标志
3. **核心逻辑优先**：实现将驰的两个选项的核心效果
4. **UI集成优先**：添加技能选择界面
5. **效果集成**：在相关函数中集成选项1和选项2的效果
6. **音效集成**：添加技能音效
7. **边界处理**：处理牌堆不足等边界条件
8. **测试验证**：确保所有场景都通过测试

---

## 十、集成要点

### 与现有系统的集成

1. **摸牌系统**：
   - 复用 `drawN` 函数和 `ensureDeck` 函数
   - 确保摸牌逻辑与其他摸牌技能一致

2. **技能使用系统**：
   - 在 `canUseCard` 和 `canPlayAsResponse` 中集成选项1的禁止效果
   - 在 `canUseSlay` 中集成选项2的无距离限制效果

3. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程
   - 使用回合标志跟踪将驰的效果

4. **日志系统**：
   - 为将驰的发动添加对应的日志记录
   - 确保日志清晰地反映技能的发动和效果

### 需要修改的文件

1. **data.js**：
   - 添加曹彰武将定义

2. **game.js**：
   - `normalize()`：添加将驰状态字段防御
   - 修改 `doDraw` 函数：添加将驰触发逻辑
   - 添加 `chooseJiangchi` 函数
   - 修改 `canUseCard` 函数：集成选项1的禁止效果
   - 修改 `canPlayAsResponse` 函数：集成选项1的禁止效果
   - 修改 `canUseSlay` 函数：集成选项2的无距离限制和多杀效果
   - 修改 `useSlay` 函数：记录选项2的杀使用数量
   - `startTurn` 函数：重置将驰标志

3. **render-controls.js**：
   - 添加将驰的UI界面
   - 添加技能选择界面

---

## 十一、流程图

### 将驰完整流程

```
摸牌阶段开始
    ↓
检查是否拥有将驰技能
    ↓
是：进入将驰选择阶段，显示两个选项
    ↓
玩家选择选项
    ↓
选项1: 多摸1张牌 → 设置jiangchiNoSlash=true → 进入出牌阶段
    ↓
选项2: 少摸1张牌 → 设置jiangchiEnhancedSlash=true → 重置jiangchiSlashUsed=0 → 进入出牌阶段
    ↓
回合结束时：重置所有将驰标志
```

### 将驰效果流程

**选项1效果流程：**
```
出牌阶段/响应阶段
    ↓
尝试使用/打出【杀】
    ↓
检查jiangchiNoSlash标志
    ↓
是：禁止使用/打出 → 返回false
```

**选项2效果流程：**
```
使用【杀】时
    ↓
检查jiangchiEnhancedSlash标志
    ↓
是：忽略距离检查
    ↓
检查jiangchiSlashUsed < 2
    ↓
是：允许使用，jiangchiSlashUsed++
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

**选项2（少摸一张牌，杀增强）：**
- 适用于进攻回合，特别针对高防御目标
- 无距离限制可以攻击任意目标
- 多使用一张杀可以快速清场

### 关于技能平衡性

曹彰作为4体力的魏国武将，将驰提供了灵活的选择：

**选项1的平衡：**
- 多摸1张牌（从2张到3张）提供额外资源
- 代价是本回合完全不能使用任何杀，限制了进攻能力
- 需要玩家权衡资源和进攻的关系

**选项2的平衡：**
- 少摸1张牌（从2张到1张）减少资源获取
- 但获得强大的杀增强效果：无距离限制 + 多一张杀
- 可以有效压制对手的防御策略

**整体平衡：**
- 两个选项都有明确的收益和代价
- 玩家需要根据场上形势选择最优策略
- 与魏国其他武将的协同性良好

### 关于与其他技能的交互

1. **与手牌相关技能的交互**：
   - 将驰的摸牌效果应正常触发其他手牌相关的技能
   - 选项1的额外手牌可以触发手牌上限相关的效果

2. **与攻击相关技能的交互**：
   - 选项1的禁止效果应优先于其他允许使用杀的效果
   - 选项2的无距离限制应与其他距离修正效果正常叠加

3. **与回合相关技能的交互**：
   - 将驰的效果仅在当前回合生效
   - 下回合所有效果自动重置

---

## 十三、修正记录

*文档状态：设计阶段*
*创建时间：2026-07-13*
*负责人：Mistral Vibe*

### 待实装项

- [ ] **data.js**: 添加曹彰武将定义
- [ ] **game.js**: 
  - [ ] normalize函数：添加将驰状态字段防御
  - [ ] 修改doDraw函数：添加将驰触发逻辑
  - [ ] 添加chooseJiangchi函数
  - [ ] 修改canUseCard函数：集成选项1的禁止效果
  - [ ] 修改canPlayAsResponse函数：集成选项1的禁止效果
  - [ ] 修改canUseSlay函数：集成选项2的无距离限制和多杀效果
  - [ ] 修改useSlay函数：记录选项2的杀使用数量
  - [ ] startTurn函数：重置将驰标志
- [ ] **render-controls.js**: 
  - [ ] 添加将驰的UI界面
  - [ ] 添加技能选择界面

### 待优化项

- 音效文件：需要添加assets/audio/jiangchi.mp3
- UI/UX：将驰选择界面的用户体验优化
- 兼容性：确保与现有所有技能的兼容性，特别是其他摸牌技能和杀相关技能
- 性能：确保选择逻辑的性能，避免不必要的计算