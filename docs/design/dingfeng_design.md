# 丁奉 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `dingfeng` |
| **武将名称** | 丁奉 |
| **势力** | 吴 |
| **性别** | male |
| **体力上限** | 4 |
| **技能** | 短兵 / 奋迅 |

---

## 二、技能说明

### 短兵
**时机**：使用【杀】时

**效果**：
1. 你可以多选择一名距离为1的角色为目标

**设计要点**：
- 属于**使用杀时的目标选择扩展**，需集成到杀的使用流程中
- 多选择的目标必须满足**距离为1**的条件
- 正常情况下杀只能选择一名目标，发动短兵后可以选择**两名目标**（一名正常目标 + 一名距离1的额外目标）
- 可选发动：玩家可以选择是否使用短兵效果
- 需要验证距离计算逻辑：`getDistance(g, mySeat, targetSeat) === 1`

### 奋迅
**时机**：出牌阶段限一次

**效果**：
1. 你可以弃置一张牌
2. 令你本回合计算与一名其他角色的距离视为1

**设计要点**：
- 属于**出牌阶段的主动技能**，每回合限一次
- 需要标志位 `g.fenxunUsed` 控制每回合使用次数
- 弃置一张牌后，选择一名其他角色，本回合内与该角色的距离计算视为1
- 距离修正效果**仅限本回合**，需要在回合结束时清理状态
- 选择的目标角色需要在出牌阶段内存活
- 距离视为1的效果需要集成到所有距离计算函数中

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
dingfeng: {
  id: 'dingfeng',
  name: '丁奉',
  gender: 'male',
  maxHp: 4,
  skill: '短兵/奋迅',
  desc: '短兵:你使用【杀】时可以多选择一名距离为1的角色为目标。奋迅:出牌阶段限一次,你可以弃置一张牌,令你本回合计算与一名其他角色的距离视为1。',
  caps: { duanbing: true, fenxun: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 丁奉【奋迅】:回合内使用标记
if(typeof g.fenxunUsed!=='boolean') g.fenxunUsed=false;

// 丁奉【奋迅】:距离修正目标（本回合内与该座位的距离视为1）
if(typeof g.fenxunTarget!=='number') g.fenxunTarget=null;

// 丁奉【短兵】:使用杀时的额外目标选择阶段
// pending 应包含 type、sourceSeat（丁奉的座位）、baseTarget（原始目标）、availableTargets（可选的距离1的额外目标列表）
if(g.pending && g.pending.type==='duanbingChoose'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.baseTarget!=='number' || !g.players[d.baseTarget] || !g.players[d.baseTarget].alive ||
     !Array.isArray(d.availableTargets) || d.availableTargets.length===0 ||
     d.sourceSeat !== mySeat){
    g.pending = null;
    g.phase = 'play';
  }
}

// 丁奉【奋迅】:弃牌选择阶段
// pending 应包含 type、seat（丁奉的座位）
if(g.pending && g.pending.type==='fenxunDiscard'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     d.seat !== mySeat){
    g.pending = null;
    g.phase = 'play';
  }
}

// 丁奉【奋迅】:目标选择阶段
// pending 应包含 type、seat（丁奉的座位）、availableTargets（可选目标列表）
if(g.pending && g.pending.type==='fenxunTarget'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     !Array.isArray(d.availableTargets) || d.availableTargets.length===0 ||
     d.seat !== mySeat){
    g.pending = null;
    g.phase = 'play';
  }
}
```

在 `startTurn` 函数中添加重置：
```javascript
g.fenxunUsed = false;  // 在其他标志位重置的同一行
g.fenxunTarget = null;
```

---

## 四、技能实现

### 短兵实现

**集成点**：`useCard` 函数（使用杀时的目标选择）

```javascript
// 修改 useCard 函数，在使用杀时添加短兵触发检查
function useCard(g, cardType, cardIndices) {
  tx(g => {
    if (g.phase !== 'play' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    
    if (!me || !me.alive) return g;
    
    // 处理杀的使用
    if (cardType === '杀') {
      // 正常选择一名目标
      // ... 现有的目标选择逻辑 ...
      
      // 短兵：如果有短兵技能，可以多选择一名距离为1的目标
      if (generalHasCap(me, 'duanbing')) {
        // 等待玩家选择是否发动短兵
        // 首先完成基础目标选择，然后询问是否发动短兵
        const aliveSeats = [];
        for (let i = 0; i < g.players.length; i++) {
          if (g.players[i] && g.players[i].alive && i !== mySeat) {
            // 计算距离
            const dist = getDistance(g, mySeat, i);
            if (dist === 1) {
              aliveSeats.push(i);
            }
          }
        }
        
        if (aliveSeats.length > 0) {
          // 存储原始目标，等待选择额外目标
          g.pending = {
            type: 'duanbingChoose',
            sourceSeat: mySeat,
            baseTarget: baseTarget, // 已选择的基础目标
            availableTargets: aliveSeats
          };
          g.phase = 'duanbingChoose';
          g.log = pushLog(g.log, `${me.name} 可以发动【短兵】,多选择一名距离为1的角色为目标`);
          markSkillSound(g, '短兵');
          return g;
        }
      }
      
      // 正常使用杀（单目标）
      // ... 现有逻辑 ...
    }
    
    return g;
  });
}
```

```javascript
// 短兵选择额外目标函数
function triggerDuanbing(extraTarget) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'duanbingChoose' || pending.sourceSeat !== mySeat) return g;
    
    if (!pending.availableTargets.includes(extraTarget)) return g;
    
    const me = g.players[mySeat];
    const extra = g.players[extraTarget];
    
    if (!me || !me.alive || !extra || !extra.alive) return g;
    
    // 使用杀，目标为基础目标和额外目标
    const targets = [pending.baseTarget, extraTarget];
    
    // 检查是否可以对这两个目标使用杀
    // ... 执行杀的效果逻辑 ...
    
    g.log = pushLog(g.log, `${me.name} 发动【短兵】,对 ${g.players[pending.baseTarget].name} 和 ${extra.name} 使用【杀】`);
    markSkillSound(g, '短兵');
    
    // 清理状态
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}
```

```javascript
// 短兵取消发动
function cancelDuanbing() {
  tx(g => {
    if (g.pending && g.pending.type === 'duanbingChoose' && g.pending.sourceSeat === mySeat) {
      const me = g.players[mySeat];
      // 直接使用原始目标的杀
      const baseTarget = g.pending.baseTarget;
      
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${me.name} 取消发动【短兵】,使用【杀】对 ${g.players[baseTarget].name} 生效`);
      
      // 执行正常的杀逻辑
      // ... 使用杀对单目标的逻辑 ...
    }
    return g;
  });
}
```

### 奋迅实现

**UI触发点**：`render-controls.js` 添加奋迅按钮

```javascript
// 在 renderControls 中添加奋迅触发逻辑
function renderControls(g, me) {
  // ... 现有代码 ...
  
  if (hasCap(me, 'fenxun') && !g.fenxunUsed && g.phase === 'play' && g.turn === mySeat) {
    ui.innerHTML += `
      <button onclick="startFenxun()" class="skill-btn" style="background: #e67e22;">
        奋迅
      </button>
    `;
  }
}
```

```javascript
// 奋迅选择流程：首先选择要弃置的牌
function startFenxun() {
  tx(g => {
    const me = g.players[mySeat];
    if (!me || !me.alive) return g;
    
    if (!hasCap(me, 'fenxun') || g.fenxunUsed) return g;
    
    const hand = me.hand || [];
    if (hand.length === 0) {
      g.log = pushLog(g.log, `${me.name} 手牌为空,无法发动【奋迅】`);
      return g;
    }
    
    // 进入弃牌选择阶段
    g.pending = {
      type: 'fenxunDiscard',
      seat: mySeat
    };
    g.phase = 'fenxunDiscard';
    g.log = pushLog(g.log, `${me.name} 发动【奋迅】,请选择要弃置的一张牌`);
    markSkillSound(g, '奋迅');
    
    return g;
  });
}
```

```javascript
// 奋迅选择弃置的牌
function pickFenxunDiscard(cardIndex) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'fenxunDiscard' || pending.seat !== mySeat) return g;
    
    const me = g.players[mySeat];
    if (!me || !me.alive || !me.hand || cardIndex >= me.hand.length) return g;
    
    // 弃置选中的牌
    const card = me.hand[cardIndex];
    me.hand.splice(cardIndex, 1);
    g.discard.push(card);
    
    // 进入目标选择阶段
    const availableTargets = [];
    for (let i = 0; i < g.players.length; i++) {
      if (g.players[i] && g.players[i].alive && i !== mySeat) {
        availableTargets.push(i);
      }
    }
    
    g.pending = {
      type: 'fenxunTarget',
      seat: mySeat,
      availableTargets: availableTargets
    };
    g.phase = 'fenxunTarget';
    g.log = pushLog(g.log, `${me.name} 弃置了【${card.name}】,请选择一名其他角色`);
    
    return g;
  });
}
```

```javascript
// 奋迅选择目标角色
function pickFenxunTarget(targetSeat) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'fenxunTarget' || pending.seat !== mySeat) return g;
    
    if (!pending.availableTargets.includes(targetSeat)) return g;
    
    const me = g.players[mySeat];
    const target = g.players[targetSeat];
    
    if (!me || !me.alive || !target || !target.alive) return g;
    
    // 设置距离修正目标
    g.fenxunTarget = targetSeat;
    g.fenxunUsed = true;
    
    g.log = pushLog(g.log, `${me.name} 发动【奋迅】,本回合内与 ${target.name} 的距离视为1`);
    markSkillSound(g, '奋迅');
    
    // 清理pending状态
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}
```

```javascript
// 奋迅取消
function cancelFenxun() {
  tx(g => {
    if (g.pending && (g.pending.type === 'fenxunDiscard' || g.pending.type === 'fenxunTarget') &&
        g.pending.seat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【奋迅】`);
    }
    return g;
  });
}
```

**距离计算修正**：

需要修改 `getDistance` 函数，集成奋迅的距离修正效果：

```javascript
// 修改 getDistance 函数，在计算丁奉的距离时考虑奋迅效果
function getDistance(g, from, to) {
  // 奋迅效果：丁奉本回合内与特定角色的距离视为1
  if (g.turn === from && g.fenxunTarget === to && hasCap(g.players[from], 'fenxun')) {
    return 1;
  }
  
  // 奋迅效果：其他角色与丁奉的距离（如果丁奉是目标）
  if (g.turn === to && g.fenxunTarget === from && hasCap(g.players[to], 'fenxun')) {
    return 1;
  }
  
  // 原有的距离计算逻辑
  // ... 现有代码 ...
}
```

---

## 五、渲染集成（render-controls.js）

### 短兵 UI 集成

```javascript
// 在 renderControls 中添加短兵选择状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 短兵：选择额外目标
  if (g.pending && g.pending.type === 'duanbingChoose' && g.pending.sourceSeat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【短兵】发动</h4>
        <p>你可以多选择一名距离为1的角色为目标</p>
        <p>当前目标: ${g.players[g.pending.baseTarget].name}</p>
        <div class="target-options">
    `;
    
    // 渲染可选的距离1的目标
    for (const targetSeat of g.pending.availableTargets) {
      const target = g.players[targetSeat];
      if (target && target.alive) {
        ui.innerHTML += `
          <button onclick="triggerDuanbing(${targetSeat})" class="target-btn">
            选择 ${target.name}
          </button>
        `;
      }
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelDuanbing()" class="cancel-btn">
          取消（仅对${g.players[g.pending.baseTarget].name}使用杀）
        </button>
      </div>
    `;
    return;
  }
}
```

### 奋迅 UI 集成

```javascript
// 在 renderControls 中添加奋迅选择状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 奋迅：弃牌选择
  if (g.pending && g.pending.type === 'fenxunDiscard' && g.pending.seat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【奋迅】发动</h4>
        <p>请选择要弃置的一张牌</p>
        <div class="hand-options">
    `;
    
    // 渲染手牌选项
    const hand = p.hand || [];
    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      ui.innerHTML += `
        <button onclick="pickFenxunDiscard(${i})" class="card-btn">
          弃置 【${card.name}】(${card.suit}${rankText(card.rank)})
        </button>
      `;
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelFenxun()" class="cancel-btn">
          取消
        </button>
      </div>
    `;
    return;
  }

  // 奋迅：目标选择
  if (g.pending && g.pending.type === 'fenxunTarget' && g.pending.seat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【奋迅】选择目标</h4>
        <p>请选择一名其他角色，本回合内与其距离视为1</p>
        <div class="target-options">
    `;
    
    // 渲染可选目标
    for (const targetSeat of g.pending.availableTargets) {
      const target = g.players[targetSeat];
      if (target && target.alive) {
        ui.innerHTML += `
          <button onclick="pickFenxunTarget(${targetSeat})" class="target-btn">
            选择 ${target.name}
          </button>
        `;
      }
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelFenxun()" class="cancel-btn">
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
  '短兵': 'duanbing',
  '奋迅': 'fenxun',
};
```

---

## 七、边界条件处理

### 短兵
1. **无距离1的目标**：若场上没有其他距离为1的角色，则不能发动短兵
2. **目标死亡**：在选择阶段验证目标是否存活，死亡则不能选择
3. **杀的使用限制**：正常情况下杀每回合使用次数限制仍然生效
4. **目标重复**：不能选择同一个目标两次
5. **距离计算**：需要正确计算座位之间的距离

### 奋迅
1. **无手牌**：若丁奉手牌为空，不能发动奋迅
2. **无其他角色**：若场上没有其他存活角色，不能发动奋迅
3. **每回合限一次**：`g.fenxunUsed` 标志位确保每回合只能发动一次
4. **距离修正范围**：仅限**丁奉**本回合内的距离计算，不影响其他角色
5. **目标死亡**：若目标角色在出牌阶段内死亡，距离修正效果仍然生效（因为是针对座位而非角色）
6. **回合结束清理**：在回合结束时需要清理 `g.fenxunTarget` 状态
7. **多个丁奉**：若场上有多个丁奉，各自的奋迅效果独立计算

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **短兵** |
| 短兵：使用杀，场上有距离1的角色 | 可以选择两名目标（基础目标+距离1目标） |
| 短兵：使用杀，场上无距离1的角色 | 只能选择一名目标 |
| 短兵：使用杀，选择距离1目标后，该目标死亡 | 不能选择死亡目标，回到单目标使用 |
| 短兵：使用杀，两个目标中一个死亡 | 只对存活目标生效 |
| 短兵：不发动短兵 | 正常使用杀对单目标 |
| **奋迅** |
| 奋迅：出牌阶段，手牌充足 | 可以发动，弃置一张牌，选择目标后距离视为1 |
| 奋迅：出牌阶段，手牌为空 | 不能发动 |
| 奋迅：出牌阶段，无其他角色 | 不能发动 |
| 奋迅：出牌阶段，已发动过 | 不能再次发动 |
| 奋迅：使用杀后发动奋迅，目标为距离2的角色 | 弃置牌后，使用杀可以选择该角色 |
| 奋迅：发动后，下回合距离恢复正常 | 奋迅效果仅限本回合 |
| **组合测试** |
| 短兵+奋迅：使用杀发动短兵，同时发动奋迅 | 可以选择两名目标，且其中一名可能受到奋迅距离修正 |
| 短兵+奋迅：先发动奋迅，再使用杀发动短兵 | 奋迅修正的距离可能影响短兵可选目标范围 |
| 边界：连续使用杀，短兵每次都可发动 | 每次使用杀都可以选择是否发动短兵 |

---

## 九、实现优先级

1. **数据定义优先**：添加丁奉武将定义
2. **状态管理优先**：添加pending状态防御和回合标志位
3. **距离修正系统优先**：修改getDistance函数，集成奋迅效果
4. **短兵核心逻辑优先**：实现杀的多目标选择
5. **奋迅核心逻辑优先**：实现弃牌和距离修正
6. **UI集成优先**：添加短兵和奋迅的界面
7. **音效集成**：添加技能音效
8. **边界处理**：处理无目标、无手牌等边界条件
9. **测试验证**：确保所有场景都通过测试

---

## 十、集成要点

### 与现有系统的集成

1. **距离计算系统**：
   - 修改 `getDistance()` 函数，集成奋迅的距离修正效果
   - 确保修正后的距离在所有使用到距离的地方都生效
   
2. **杀使用系统**：
   - 在 `useCard` 函数中集成短兵的触发检查
   - 确保多目标选择逻辑与现有杀使用逻辑兼容
   
3. **弃牌系统**：
   - 使用现有的弃牌逻辑，将牌移动到弃牌堆
   
4. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程
   - 使用 `g.pending` 存储技能发动的中间状态
   
5. **目标选择系统**：
   - 复用现有的目标选择和筛选逻辑
   - 添加距离为1的目标筛选

### 需要修改的文件

1. **data.js**：
   - 添加丁奉武将定义

2. **game.js**：
   - `normalize()`：添加奋迅状态字段防御
   - `startTurn()`：添加奋迅标志位重置
   - `getDistance()`：集成奋迅距离修正
   - `useCard()`：添加短兵触发检查
   - 添加 `triggerDuanbing`、`cancelDuanbing` 函数
   - 添加 `startFenxun`、`pickFenxunDiscard`、`pickFenxunTarget`、`cancelFenxun` 函数

3. **render-controls.js**：
   - 添加短兵和奋迅的UI界面
   - 添加技能选择和确认界面

---

## 十一、流程图

### 短兵完整流程
```
使用【杀】
    ↓
检查是否有短兵技能
    ↓
是：检查场上是否有距离为1的其他角色
    ↓
有：进入短兵选择阶段
    ↓
玩家选择是否发动短兵
    ↓
发动：选择一名距离1的额外目标
    ↓
对两名目标使用【杀】
    ↓
否：仅对原始目标使用【杀】
    ↓
清理状态，继续游戏
```

### 奋迅完整流程
```
出牌阶段
    ↓
丁奉选择发动奋迅
    ↓
选择要弃置的一张手牌
    ↓
弃置该牌
    ↓
选择一名其他角色
    ↓
设置本回合内与该角色距离视为1
    ↓
标记奋迅已使用
    ↓
清理pending状态
    ↓
继续出牌阶段
```

---

## 十二、特殊说明

### 关于短兵的技能定位

短兵是丁奉的攻击辅助技能，体现了其近战能力强的特点。通过允许多选择一名距离1的目标，丁奉可以在使用杀时同时命中两个近距离的敌人，增加输出效率。

**技能特点**：
- 可选发动：玩家可以根据场上形势选择是否使用
- 增加输出：一次杀可以攻击两个目标
- 距离限制：仅限距离为1的角色，体现"短兵"的近战特性
- 与杀机制结合：依赖于杀的使用，与游戏核心机制紧密结合

### 关于奋迅的技能定位

奋迅是丁奉的机动性技能，体现了其奋勇争先的特点。通过弃置一张牌，丁奉可以暂时忽视距离限制，与远距离的敌人进行交互。

**技能特点**：
- 主动技能：需要玩家主动发动
- 每回合限一次：确保技能不会过于强力
- 临时性：距离修正效果仅限本回合
- 资源消耗：需要弃置一张牌作为代价
- 灵活性：可以选择任何一名角色作为目标

### 关于距离计算

距离计算使用 `getDistance(g, from, to)` 函数，奋迅的效果会影响该函数的返回值。需要确保：
- 奋迅效果仅对丁奉本人生效
- 奋迅效果仅在丁奉的回合内生效
- 奋迅效果仅对特定目标生效
- 其他角色的距离计算不受影响

### 关于多目标杀的处理

短兵允许杀选择两名目标，这会涉及到：
- 伤害计算：每个目标独立进行伤害判定
- 闪的使用：每个目标需要独立使用闪来抵消
- 目标效果：每个目标的特效（如装备效果）独立计算
- 顺序处理：按照目标的座位顺序依次处理

---

## 十三、修正记录

*文档状态：设计阶段*
*创建时间：2026-07-13*
*负责人：Mistral Vibe*

### 待实装项

- [ ] **data.js**: 添加丁奉武将定义
- [ ] **game.js**: 
  - [ ] normalize函数：添加奋迅状态字段防御
  - [ ] startTurn函数：添加奋迅标志位重置
  - [ ] getDistance函数：集成奋迅距离修正
  - [ ] useCard函数：添加短兵触发检查
  - [ ] 添加短兵相关函数
  - [ ] 添加奋迅相关函数
- [ ] **render-controls.js**: 
  - [ ] 添加短兵UI界面
  - [ ] 添加奋迅UI界面

### 待优化项

- 音效文件：需要添加assets/audio/duanbing.mp3和assets/audio/fenxun.mp3
- UI/UX：短兵和奋迅选择界面的用户体验优化
- 性能：确保距离计算和多目标选择时的性能
- 兼容性：确保与现有所有技能的兼容性（特别是其他涉及距离计算的技能）