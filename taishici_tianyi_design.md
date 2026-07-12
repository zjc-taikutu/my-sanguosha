# 太史慈 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `taishici` |
| **武将名称** | 太史慈 |
| **势力** | 吴 |
| **性别** | male |
| **体力上限** | 4 |
| **技能** | 天义 |

---

## 二、技能说明

### 天义（出牌阶段限一次）
**时机**：出牌阶段

**效果**：
1. 你可以与一名其他角色拼点
2. 然后本阶段内：
   - 若你赢，则：
     - 你使用【杀】的次数上限+1（即本阶段可以多使用1张【杀】）
     - 你使用【杀】无距离限制
     - 你使用【杀】的目标数上限+1（即每张【杀】可以多选择1个目标）
   - 若你没赢，则：你不能使用【杀】

**设计要点**：
- 属于**出牌阶段限一次**的主动技能，需 `g.tianyiUsed` 标志位
- 拼点机制参考荀彧【驱虎】，使用点数比较（`rank` 值，数值大的赢）
- 赢后的效果持续**本出牌阶段**内，使用阶段标志位 `g.tianyiWin` 记录
- 失败后的禁用效果同样持续**本出牌阶段**内，使用阶段标志位 `g.tianyiLose` 记录
- 需要与现有的杀使用系统集成，包括：
  - 次数限制：`g.shaUsed` 相关逻辑
  - 距离限制：`canReachSha` 检查
  - 目标数上限：`CARD_PLAYS['杀'].canPlay` 中的目标数检查

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
taishici: {
  id: 'taishici',
  name: '太史慈',
  gender: 'male',
  maxHp: 4,
  skill: '天义',
  desc: '天义:出牌阶段限一次,你可以与一名角色拼点,然后本阶段:若你赢,则你使用【杀】的次数上限+1、使用【杀】无距离限制、使用【杀】的目标数上限+1;否则你不能使用【杀】。',
  caps: { tianyi: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 太史慈【天义】:回合内使用标记
if(typeof g.tianyiUsed!=='boolean') g.tianyiUsed=false;

// 太史慈【天义】:本阶段拼点赢标记（影响杀的次数、距离、目标数）
if(typeof g.tianyiWin!=='boolean') g.tianyiWin=false;

// 太史慈【天义】:本阶段拼点输标记（禁止使用杀）
if(typeof g.tianyiLose!=='boolean') g.tianyiLose=false;

// 太史慈【天义】拼点阶段:pending 应包含 type、seat、targetSeat、selfCard 等字段
if(g.pending && g.pending.type==='tianyiRespond'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
     !d.selfCard || typeof d.selfCard.rank!=='number'){
    g.pending = null;
    g.phase = 'play';
  }
}
```

在 `startTurn` 函数中添加重置：
```javascript
g.tianyiUsed = false;
g.tianyiWin = false;
g.tianyiLose = false;
```

在出牌阶段开始时重置阶段标志：
```javascript
// 在 enterPlayPhase 或类似位置添加
if(g.phase === 'play') {
  g.tianyiWin = false;
  g.tianyiLose = false;
}
```

---

## 四、技能实现

### 核心机制

天义技能的核心是**在出牌阶段与一名角色拼点，根据结果改变本阶段内杀的使用规则**。

**关键时机点**：
1. **技能触发点**：出牌阶段，玩家点击【天义】按钮
2. **拼点选择点**：选择一张手牌用于拼点，然后选择拼点目标
3. **拼点响应点**：目标角色选择一张手牌拼点
4. **效果应用点**：拼点结果确定后，根据赢输应用不同的杀使用规则

### 拼点触发逻辑

```javascript
// 在 render-controls.js 中添加天义按钮
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 天义：出牌阶段可以发动
  if (hasCap(me, 'tianyi') && !g.tianyiUsed && g.phase === 'play' && g.turn === mySeat) {
    ui.innerHTML += `
      <button onclick="startTianyi()" class="skill-btn" style="background: #4a90d9;">
        天义
      </button>
    `;
  }
}
```

```javascript
// 在 skills.js 中添加天义发动函数
let tianyiCardIdx = null;
let tianyiTargetSeat = null;

function startTianyi() {
  tx(g => {
    if (g.phase !== 'play' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me || !me.alive || !hasCap(me, 'tianyi') || g.tianyiUsed) return g;
    
    // 进入天义选择模式：先选牌，再选目标
    g.pending = {
      type: 'tianyiPickCard',
      seat: mySeat
    };
    g.phase = 'tianyiPickCard';
    g.log = pushLog(g.log, `${me.name} 发动【天义】,请选择一张手牌用于拼点`);
    markSkillSound(g, '天义');
    
    return g;
  });
}

function pickTianyiCard(cardIdx) {
  tx(g => {
    if (g.pending.type !== 'tianyiPickCard' || g.pending.seat !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me || !me.alive) return g;
    
    const card = me.hand[cardIdx];
    if (!card) return g;
    
    // 存储选择的牌
    tianyiCardIdx = cardIdx;
    
    // 进入选择目标阶段
    g.pending = {
      type: 'tianyiPickTarget',
      seat: mySeat,
      cardIdx: cardIdx
    };
    g.phase = 'tianyiPickTarget';
    g.log = pushLog(g.log, `${me.name} 选择了拼点牌,请选择一名其他角色拼点`);
    
    return g;
  });
}

function pickTianyiTarget(targetSeat) {
  tx(g => {
    if (g.pending.type !== 'tianyiPickTarget' || g.pending.seat !== mySeat) return g;
    const me = g.players[mySeat];
    const target = g.players[targetSeat];
    
    if (!me || !me.alive || !target || !target.alive) return g;
    if (targetSeat === mySeat) return g; // 不能选自己
    if ((target.hand || []).length === 0) return g; // 目标没有手牌
    
    const cardIdx = g.pending.cardIdx;
    const card = me.hand[cardIdx];
    if (!card) return g;
    
    // 执行拼点：从玩家手牌中移除拼点牌
    me.hand.splice(cardIdx, 1);
    g.discard.push(card);
    
    // 设置拼点响应状态
    g.tianyiUsed = true;
    g.pending = {
      type: 'tianyiRespond',
      seat: mySeat,
      targetSeat: targetSeat,
      selfCard: card
    };
    g.phase = 'tianyiRespond';
    g.log = pushLog(g.log, `${me.name} 发动【天义】,与 ${target.name} 拼点`);
    
    return g;
  });
}

function respondTianyi(cardIdx) {
  tx(g => {
    if (g.phase !== 'tianyiRespond' || !g.pending || g.pending.type !== 'tianyiRespond' || 
        g.pending.targetSeat !== mySeat) return g;
    
    const {seat, targetSeat, selfCard} = g.pending;
    const source = g.players[seat];
    const target = g.players[targetSeat];
    
    if (!source || !target || !source.alive || !target.alive) {
      finishTianyi(g);
      return g;
    }
    
    const card = target.hand[cardIdx];
    if (!card) return g;
    
    // 移除目标的拼点牌
    target.hand.splice(cardIdx, 1);
    g.discard.push(card);
    
    // 判断拼点结果：点数大的赢（数值比较）
    const tianyiWin = (selfCard.rank || 0) > (card.rank || 0);
    
    g.log = pushLog(g.log, 
      `${source.name} 出 ${pointText(selfCard)}, ${target.name} 出 ${pointText(card)},拼点${tianyiWin ? source.name + '赢' : source.name + '没赢'}`);
    
    if (tianyiWin) {
      // 赢：设置本阶段的增益效果
      g.tianyiWin = true;
      g.log = pushLog(g.log, `${source.name} 【天义】拼点赢,本阶段内使用【杀】的次数上限+1、无距离限制、目标数上限+1`);
    } else {
      // 输：设置本阶段的禁用效果
      g.tianyiLose = true;
      g.log = pushLog(g.log, `${source.name} 【天义】拼点输,本阶段内不能使用【杀】`);
    }
    
    finishTianyi(g);
    return g;
  });
}

function finishTianyi(g) {
  g.pending = null;
  if (checkWin(g)) return;
  g.phase = 'play';
}

// 辅助函数：牌的点数描述（复用荀彧驱虎的实现）
function pointText(card) {
  return card ? card.suit + rankText(card.rank) + '【' + card.name + '】' : '?';
}
```

### 杀使用规则修改

需要在多个位置修改杀的使用规则，以支持天义的效果：

```javascript
// 在 CARD_PLAYS['杀'].canPlay 中添加天义赢的判断
canPlay: (g, me, card) => {
  // 天义赢：无视出杀次数限制（次数上限+1 的效果）
  if (g.tianyiWin && hasCap(me, 'tianyi')) {
    return canUseAs(me, card, '杀');
  }
  // 正常判断
  return canUseAs(me, card, '杀') && (!g.shaUsed || hasCap(me, 'unlimitedSha'));
}
```

```javascript
// 在 CARD_PLAYS['杀'].effect 中处理天义赢的次数限制
// 修改后的 effect 需要考虑天义赢时不设置 g.shaUsed
effect: (g, me, card) => {
  tx(g => {
    if (g.phase !== 'play' || g.turn !== mySeat) return g;
    if (!canUseAs(me, card, '杀')) return g;
    
    // 天义赢：不设置 g.shaUsed（即不消耗次数上限）
    // 但仍然需要记录使用了杀，用于目标数上限检查
    if (!g.tianyiWin || !hasCap(me, 'tianyi')) {
      g.shaUsed = true; // 正常情况下设置次数限制
    }
    
    // ... 其余杀处理逻辑
    // 需要传递天义赢的标志位，以便后续处理
    const shaInfo = {
      noDistance: g.tianyiWin && hasCap(me, 'tianyi'), // 无距离限制
      extraTarget: g.tianyiWin && hasCap(me, 'tianyi') ? 1 : 0, // 目标数上限+1
      fromTianyi: g.tianyiWin && hasCap(me, 'tianyi')
    };
    
    // 调用杀目标选择
    g.pending = {
      type: 'shaTargetSelect',
      card: card,
      cardIdx: g.hand.indexOf(card),
      shaInfo: shaInfo,
      played: 0,
      maxTargets: 1 + (shaInfo.extraTarget || 0) // 基础1个目标 + 天义赢的+1
    };
    g.phase = 'shaTargetSelect';
    
    return g;
  });
}
```

```javascript
// 在 resolveShaUse 中处理无距离限制
action resolveShaUse(g, sourceSeat, targetSeat, usedAs, shaColor, shaInfo = {}) {
  // 检查是否是天义赢的杀（无距离限制）
  if (shaInfo && shaInfo.noDistance) {
    // 跳过距离检查，直接进行后续处理
    return continueShaResolution(g, sourceSeat, targetSeat, usedAs, shaColor, shaInfo);
  }
  
  // 原有的距离检查逻辑
  if (!canReachSha(g, sourceSeat, targetSeat)) {
    g.log = pushLog(g.log, `${g.players[sourceSeat].name} 对 ${g.players[targetSeat].name} 使用【杀】超出攻击范围`);
    return false;
  }
  
  return continueShaResolution(g, sourceSeat, targetSeat, usedAs, shaColor, shaInfo);
}
```

### 目标数上限处理

```javascript
// 在 CARD_PLAYS['杀'].effect 的目标选择中处理
// 修改目标选择逻辑，支持多目标
effect: (g, me, card) => {
  tx(g => {
    if (g.phase !== 'play' || g.turn !== mySeat) return g;
    if (!canUseAs(me, card, '杀')) return g;
    
    // 计算最大目标数
    const maxTargets = 1 + (g.tianyiWin && hasCap(me, 'tianyi') ? 1 : 0);
    
    // 设置杀的目标选择
    g.pending = {
      type: 'shaTargetSelect',
      card: card,
      cardIdx: me.hand.indexOf(card),
      maxTargets: maxTargets,
      selected: [],
      shaInfo: {
        noDistance: g.tianyiWin && hasCap(me, 'tianyi'),
        fromTianyi: g.tianyiWin && hasCap(me, 'tianyi')
      }
    };
    g.phase = 'shaTargetSelect';
    g.log = pushLog(g.log, `${me.name} 使用【杀】,可以选择${maxTargets}个目标`);
    
    return g;
  });
}
```

### 禁止使用杀的处理

```javascript
// 在 render-controls.js 中检查天义输的状态
function renderControls(g, me) {
  // ... 现有代码 ...
  
  // 天义输：不能使用杀
  const canUseSha = !(g.tianyiLose && hasCap(me, 'tianyi')) && 
                    canUseAs(me, card, '杀') && 
                    (!g.shaUsed || hasCap(me, 'unlimitedSha'));
  
  // 在杀按钮渲染中添加检查
  if (card.name === '杀' && !canUseSha) {
    // 不渲染杀按钮或渲染为禁用状态
    return;
  }
}

// 在 CARD_PLAYS['杀'].canPlay 中添加天义输的检查
canPlay: (g, me, card) => {
  // 天义输：不能使用杀
  if (g.tianyiLose && hasCap(me, 'tianyi')) {
    return false;
  }
  // 正常判断
  return canUseAs(me, card, '杀') && (!g.shaUsed || hasCap(me, 'unlimitedSha'));
}
```

---

## 五、渲染集成（render-controls.js）

### 天义 UI 集成

```javascript
// 在 renderControls 中添加天义相关状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 天义：出牌阶段可以发动
  if (hasCap(me, 'tianyi') && !g.tianyiUsed && g.phase === 'play' && g.turn === mySeat) {
    ui.innerHTML += `
      <button onclick="startTianyi()" class="skill-btn" style="background: #4a90d9;">
        天义
      </button>
    `;
  }

  // 天义：选择拼点牌
  if (g.pending && g.pending.type === 'tianyiPickCard' && g.pending.seat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【天义】选择拼点牌</h4>
        <p>请选择一张手牌用于拼点</p>
        <button onclick="cancelTianyi()" class="cancel-btn">取消</button>
      </div>
    `;
    return;
  }

  // 天义：选择拼点目标
  if (g.pending && g.pending.type === 'tianyiPickTarget' && g.pending.seat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【天义】选择拼点目标</h4>
        <p>请选择一名其他角色进行拼点</p>
        <button onclick="cancelTianyi()" class="cancel-btn">取消</button>
      </div>
    `;
    
    // 渲染可选目标
    for (let i = 0; i < g.players.length; i++) {
      if (i === seat || !g.players[i] || !g.players[i].alive || (g.players[i].hand || []).length === 0) 
        continue;
      if (isSeatClickable(i)) {
        ui.innerHTML += `
          <button onclick="pickTianyiTarget(${i})" class="target-btn">
            选择 ${g.players[i].name}
          </button>
        `;
      }
    }
    return;
  }

  // 天义：拼点响应（被拼点的玩家）
  if (g.pending && g.pending.type === 'tianyiRespond' && g.pending.targetSeat === seat) {
    const source = g.players[g.pending.seat];
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>${source ? source.name : '对方'} 发动【天义】</h4>
        <p>请选择一张手牌拼点</p>
      </div>
    `;
    
    // 渲染手牌选择
    const hand = me.hand || [];
    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      if (card) {
        ui.innerHTML += `
          <button onclick="respondTianyi(${i})" class="hand-card-btn">
            ${card.suit}${rankText(card.rank)}【${card.name}】
          </button>
        `;
      }
    }
    return;
  }
}

// 取消天义
function cancelTianyi() {
  tx(g => {
    if (g.pending && (g.pending.type === 'tianyiPickCard' || g.pending.type === 'tianyiPickTarget') && 
        g.pending.seat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【天义】`);
    }
    return g;
  });
}
```

---

## 六、音效标识

在 `markSkillSound` 中添加：
```javascript
const SKILL_SOUNDS = {
  // ... 现有技能 ...
  '天义': 'tianyi',
};
```

---

## 七、边界条件处理

### 天义技能

1. **场上无其他存活角色**：无法选择拼点目标，技能无法发动
2. **目标角色无手牌**：无法选择该目标拼点
3. **自己无手牌**：无法发动天义（需要至少一张手牌用于拼点）
4. **拼点阶段角色死亡**：
   - 如果发动者死亡：拼点中断，清理状态
   - 如果目标死亡：拼点中断，清理状态
5. **同时发动多个天义**：每回合限一次，不能重复发动
6. **天义赢 + 无限杀**：效果叠加，可以使用更多张杀
7. **天义赢 + 武器特效**：无距离限制效果叠加
8. **天义输 + 无限杀**：天义输的效果优先，仍然不能使用杀

### 杀的使用规则

1. **天义赢的次数上限+1**：
   - 如果已经使用过杀，天义赢后还可以再使用1张杀
   - 与诸葛连弩【无限杀】等技能叠加
2. **天义赢的无距离限制**：
   - 不检查 `canReachSha`，可以攻击任意距离的目标
   - 与武器的射程效果叠加
3. **天义赢的目标数上限+1**：
   - 每张杀可以多选择1个目标
   - 与方天画戟等武器效果叠加
4. **天义输的禁止使用杀**：
   - 完全禁止使用杀，包括普通杀、火杀、雷杀
   - 但可以使用锦囊牌等其他牌

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| 天义：正常发动，拼点赢 | 可以使用2张杀（次数+1），杀无距离限制，每张杀可以选2个目标 |
| 天义：正常发动，拼点输 | 本阶段内不能使用杀 |
| 天义：无其他角色 | 无法发动，按钮不显示 |
| 天义：目标无手牌 | 无法选择该目标 |
| 天义：自己无手牌 | 无法发动 |
| 天义：拼点中发动者死亡 | 拼点中断，清理状态 |
| 天义：拼点中目标死亡 | 拼点中断，清理状态 |
| 天义：每回合多次点击 | 仅第一次生效 |
| 天义：赢后使用杀时目标死亡 | 正常结算该杀，不影响后续杀的使用 |
| 天义：赢后使用第一张杀后取消第二张 | 第一张杀正常使用，天义效果仍然生效 |
| 天义：赢 + 无限杀（张飞） | 可以使用任意数量的杀 |
| 天义：赢 + 诸葛连弩 | 可以使用任意数量的杀 |
| 天义：输 + 无限杀 | 天义输效果优先，不能使用杀 |
| 天义：赢 + 方天画戟 | 每张杀可以选3个目标（1+1+1） |

---

## 九、实现优先级

1. **核心逻辑优先**：状态标志位的设置和清理（`g.tianyiUsed`、`g.tianyiWin`、`g.tianyiLose`）
2. **拼点机制优先**：参考荀彧驱虎，实现拼点的完整流程
3. **效果应用优先**：天义赢和输的效果在杀使用系统中的集成
4. **次数限制优先**：天义赢的次数上限+1效果
5. **距离限制优先**：天义赢的无距离限制效果
6. **目标数限制优先**：天义赢的目标数上限+1效果
7. **UI集成优先**：选择界面的渲染和交互
8. **边界处理优先**：无目标、死亡等特殊情况

---

## 十、集成要点

### 与现有系统的集成

1. **阶段系统**：
   - 在出牌阶段开始时重置 `g.tianyiWin` 和 `g.tianyiLose`
   - 确保效果仅在本阶段内生效

2. **杀使用系统**：
   - 修改 `CARD_PLAYS['杀'].canPlay` 以支持天义效果
   - 修改 `CARD_PLAYS['杀'].effect` 以支持多目标选择
   - 修改 `resolveShaUse` 以支持无距离限制

3. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程

4. **拼点系统**：
   - 复用荀彧驱虎的拼点机制
   - 确保拼点信息不提前泄露

### 需要修改的文件

1. **data.js**：添加太史慈武将定义
2. **game.js**：
   - `normalize()`：添加状态字段防御
   - `startTurn()`：重置天义相关标志位
   - 出牌阶段开始处：重置阶段标志位
3. **skills.js**：添加天义技能辅助函数
4. **render-controls.js**：添加天义UI界面
5. **render.js**：可能需要添加状态显示

---

## 十一、流程图

### 天义完整流程
```
出牌阶段
    ↓
玩家点击【天义】按钮
    ↓
startTianyi()：设置 pending 为 tianyiPickCard
    ↓
选择一张手牌作为拼点牌
    ↓
pickTianyiCard()：设置 pending 为 tianyiPickTarget
    ↓
选择一名其他角色作为拼点目标
    ↓
pickTianyiTarget()：移除拼点牌，设置 pending 为 tianyiRespond
    ↓
目标角色选择一张手牌拼点
    ↓
respondTianyi()：比较点数，根据结果设置 g.tianyiWin 或 g.tianyiLose
    ↓
finishTianyi()：清理 pending，回到出牌阶段
    ↓
天义效果在本出牌阶段内生效
```

### 天义赢效果流程
```
本出牌阶段内
    ↓
使用【杀】时
    ↓
检查 g.tianyiWin：跳过 g.shaUsed 检查（次数+1）
    ↓
检查 g.tianyiWin：跳过距离检查（无距离限制）
    ↓
检查 g.tianyiWin：目标数上限 +1
    ↓
正常使用杀
```

### 天义输效果流程
```
本出牌阶段内
    ↓
使用【杀】时
    ↓
检查 g.tianyiLose：返回 false，禁止使用杀
    ↓
不能使用任何杀
```

---

## 十二、特殊说明

### 关于天义效果的持续时间

天义的效果明确为**本阶段**，即从拼点结束后到出牌阶段结束。这意味着：
- 如果在天义赢后进入弃牌阶段，天义的效果不再生效
- 如果在天义输后进入弃牌阶段，天义的禁用效果也不再生效
- 每个出牌阶段内只能发动一次天义

### 关于天义与其他技能的交互

1. **与武器技能**：天义赢的无距离限制效果与武器的射程效果可以叠加
2. **与其他杀增益技能**：天义赢的次数上限+1效果与诸葛连弩、张飞咆哮等技能可以叠加
3. **与杀限制技能**：天义输的效果会覆盖其他允许使用杀的技能（如无限杀），即天义输时完全不能使用杀

### 关于拼点的实现

拼点使用点数比较，数值大的赢。具体实现：
- 使用牌的 `rank` 属性进行数值比较
- A=1, 2-10=2-10, J=11, Q=12, K=13
- 点数相同算目标赢（即发动者输）

---

## 十三、修正记录

*文档状态：设计阶段*
*创建时间：2026-07-12*
*负责人：Mistral Vibe*
