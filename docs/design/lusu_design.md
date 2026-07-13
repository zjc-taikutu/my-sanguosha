# 鲁肃 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `lusu` |
| **武将名称** | 鲁肃 |
| **势力** | 吴 |
| **性别** | male |
| **体力上限** | 3 |
| **技能** | 好施 / 缔盟 |

---

## 二、技能说明

### 好施（锁定技）
**时机**：摸牌阶段
**效果**：
1. 你可以多摸两张牌
2. 若你的手牌数大于5，你将**一半的手牌（向下取整）**交给除你以外**全场手牌数最少的一名其他角色**

**设计要点**：
- 属于**摸牌阶段替代/额外行为**，需与 `doDraw` 流程集成
- 手牌分配逻辑：`Math.floor(hand.length / 2)`
- 目标选择：排除自己后，找手牌数最少的存活角色（多个相同最少时，由玩家选择）

---

### 缔盟
**时机**：出牌阶段限一次
**效果**：
1. 选择**两名其他角色**
2. 弃置 **X张牌**（X = 这两名角色的**手牌数之差）**
3. 令这两名角色**交换手牌**

**设计要点**：
- 每回合限一次，需 `g.dimengUsed` 标志位
- X = `Math.abs(handA.length - handB.length)`
- 弃牌数量不能为负数，向下取整处理
- 手牌交换为**同步操作**，需注意数组引用问题

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
lusu: {
  id: 'lusu',
  name: '鲁肃',
  gender: 'male',
  maxHp: 3,
  skill: '好施/缔盟',
  desc: '好施:摸牌阶段,你可以多摸两张牌,然后若你的手牌数大于5,你将一半的手牌(向下取整)交给除你以外全场手牌数最少的一名其他角色。缔盟:出牌阶段限一次,你可以选择两名其他角色并弃置X张牌(X为这两名角色的手牌数之差),令他们交换手牌。',
  caps: { haoshi: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 鲁肃【缔盟】:回合内使用标记
if(typeof g.dimengUsed!=='boolean') g.dimengUsed=false;

// 鲁肃【好施】选择目标阶段:seat 应是数字且存活, candidates 应是非空数组
if(g.pending && g.pending.type==='haoshiPick'){
  const d=g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     !Array.isArray(d.candidates) || d.candidates.length===0 ||
     !Number.isInteger(d.half) || d.half<=0){
    g.pending=null; g.phase='play';
  }
}
```

在 `startTurn` 函数中添加重置：
```javascript
g.dimengUsed=false;  // 在其他标志位重置的同一行
```

---

## 四、技能实现

### 好施实现

**集成点**：`doDraw` 函数（摸牌阶段入口）

```javascript
// 修改 doDraw 函数，在摸牌前检查好施
function doDraw(g) {
  tx(g => {
    if (g.phase !== 'draw' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];

    // 好施：额外摸两张
    const extra = generalHasCap(me, 'haoshi') ? 2 : 0;
    const toDraw = START_HAND + extra;

    // 执行摸牌
    drawN(g, mySeat, toDraw);

    // 好施后续：手牌数>5时分配一半给手牌最少的其他角色
    if (generalHasCap(me, 'haoshi') && (me.hand || []).length > 5) {
      const half = Math.floor(me.hand.length / 2);
      if (half > 0) {
        // 找手牌最少的其他存活角色
        let targetSeat = null;
        let minHand = Infinity;

        for (let i = 0; i < g.players.length; i++) {
          if (i === mySeat || !g.players[i] || !g.players[i].alive) continue;
          const handCount = (g.players[i].hand || []).length;
          if (handCount < minHand) {
            minHand = handCount;
            targetSeat = i;
          }
        }

        // 分配手牌
        if (targetSeat !== null) {
          const cardsToGive = me.hand.splice(0, half);
          g.players[targetSeat].hand.push(...cardsToGive);
          g.log = pushLog(g.log, `${me.name} 发动【好施】,将${half}张手牌交给 ${g.players[targetSeat].name}`);
          markSkillSound(g, '好施');
        }
      }
    }

    g.phase = 'play';
    return g;
  });
}
```

---

### 缔盟实现

**UI触发点**：`render-controls.js` 添加缔盟按钮

```javascript
// 在 renderControls 中添加缔盟选择逻辑
function renderControls(g, me) {
  // ... 现有代码 ...

  if (hasCap(me, 'dimeng') && !g.dimengUsed && g.phase === 'play' && g.turn === mySeat) {
    ui.innerHTML += `
      <button onclick="startDimeng()" class="skill-btn" style="background: #4a90d9;">
        缔盟
      </button>
    `;
  }
}

// 缔盟选择流程
let dimengSeatA = null;
let dimengSeatB = null;

function startDimeng() {
  dimengSeatA = null;
  dimengSeatB = null;
  g.pending = { type: 'dimengPick', stage: 'first' };
  g.log = pushLog(g.log, `${me.name} 发动【缔盟】,选择第一名角色…`);
  render();
}

function pickDimengTarget(seat) {
  if (seat === mySeat) return;

  tx(g => {
    if (g.pending.type !== 'dimengPick') return g;

    const me = g.players[mySeat];
    const target = g.players[seat];

    if (!target || !target.alive) return g;

    if (g.pending.stage === 'first') {
      dimengSeatA = seat;
      g.pending.stage = 'second';
      g.log = pushLog(g.log, `${me.name} 选择了第一个目标: ${target.name}, 请选择第二个目标…`);
    } else if (g.pending.stage === 'second') {
      if (seat === dimengSeatA) return g; // 不能选同一个人

      dimengSeatB = seat;

      // 计算X = 手牌数之差
      const handA = (g.players[dimengSeatA].hand || []).length;
      const handB = (g.players[dimengSeatB].hand || []).length;
      const X = Math.abs(handA - handB);

      // 检查是否能弃置X张牌
      if ((me.hand || []).length < X) {
        g.log = pushLog(g.log, `${me.name} 手牌不足${X}张,无法发动【缔盟】`);
        resetDimeng();
        return g;
      }

      // 弃置X张牌
      const cardsToDiscard = me.hand.splice(0, X);
      g.discard.push(...cardsToDiscard);

      // 交换两名角色的手牌
      const tempA = g.players[dimengSeatA].hand || [];
      const tempB = g.players[dimengSeatB].hand || [];
      g.players[dimengSeatA].hand = tempB;
      g.players[dimengSeatB].hand = tempA;

      g.dimengUsed = true;
      g.log = pushLog(g.log, `${me.name} 发动【缔盟】,弃置${X}张牌,令 ${g.players[dimengSeatA].name} 与 ${g.players[dimengSeatB].name} 交换手牌`);
      markSkillSound(g, '缔盟');

      resetDimeng();
    }

    return g;
  });
}

function resetDimeng() {
  dimengSeatA = null;
  dimengSeatB = null;
  delete g.pending;
  render();
}
```

---

## 五、渲染集成（render-controls.js）

### 缔盟目标选择UI

```javascript
// 在 renderControls 中添加缔盟目标选择状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 缔盟第一目标选择
  if (g.pending && g.pending.type === 'dimengPick' && g.pending.stage === 'first') {
    for (let i = 0; i < g.players.length; i++) {
      if (i === seat || !g.players[i] || !g.players[i].alive) continue;
      // 为每个可选目标添加点击处理
      if (isSeatClickable(i)) {
        ui.innerHTML += `
          <button onclick="pickDimengTarget(${i})" class="target-btn">
            选择 ${g.players[i].name}
          </button>
        `;
      }
    }
    return;
  }

  // 缔盟第二目标选择
  if (g.pending && g.pending.type === 'dimengPick' && g.pending.stage === 'second') {
    for (let i = 0; i < g.players.length; i++) {
      if (i === seat || !g.players[i] || !g.players[i].alive || i === dimengSeatA) continue;
      // 为每个可选目标添加点击处理
      if (isSeatClickable(i)) {
        ui.innerHTML += `
          <button onclick="pickDimengTarget(${i})" class="target-btn">
            选择 ${g.players[i].name}
          </button>
        `;
      }
    }
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
  '好施': 'haoshi',
  '缔盟': 'dimeng',
};
```

---

## 七、边界条件处理

### 好施
1. **牌堆不足**：使用 `ensureDeck(g)` 确保有足够的牌可摸
2. **无合法目标**：若场上无其他存活角色，或所有人手牌数相同，则跳过分配
3. **手牌数小于等于5**：不触发分配

### 缔盟
1. **场上不足2名其他角色**：按钮不显示
2. **手牌数相同**：X=0，无需弃置牌，直接交换手牌
3. **弃置牌数量大于手牌数**：检查并提示无法发动
4. **目标角色阵亡**：在选择阶段实时验证

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| 好施：摸牌阶段，手牌<=5 | 多摸2张，不分配 |
| 好施：摸牌阶段，手牌=6 | 多摸2张(变8张)，分配4张给手牌最少的其他角色 |
| 好施：摸牌阶段，手牌=7 | 多摸2张(变9张)，分配4张（向下取整） |
| 好施：无其他存活角色 | 多摸2张，不分配 |
| 缔盟：选择2名手牌数相同的角色 | 弃置0张牌，交换手牌 |
| 缔盟：选择2名手牌数差3的角色 | 弃置3张牌，交换手牌 |
| 缔盟：发动者手牌<X | 不能发动，提示错误 |
| 缔盟：每回合多次点击 | 仅第一次生效 |

---

**实现优先级**：好施 > 缔盟（好施为被动触发，缔盟为主动技能，好施更易集成到现有流程中）
