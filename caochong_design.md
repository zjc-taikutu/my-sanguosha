# 曹冲 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `caochong` |
| **武将名称** | 曹冲 |
| **势力** | 魏 |
| **性别** | male |
| **体力上限** | 3 |
| **技能** | 称象 / 仁心 |

---

## 二、技能说明

### 称象（可选发动）
**时机**：受到伤害后

**效果**：
1. 你**可以选择**是否发动【称象】
2. 若发动，亮出牌堆顶的四张牌
3. 从中获得**任意张点数之和不大于13的牌**
4. 未选择的牌置入弃牌堆

**设计要点**：
- 属于**受到伤害后的可选触发技**，需与 `afterDamage` 流程集成
- **必须先询问玩家是否发动**，不能直接亮牌（避免白嫖看牌）
- 亮出4张牌后，从中选择任意张牌获取，但选择的牌的点数之和必须不大于13
- 需要计算牌的点数：J=11, Q=12, K=13, A=1（其他牌为面值）
- **核心修正**：引擎逻辑中不能使用 `mySeat`，必须基于角色自身判定

---

### 仁心
**时机**：其他角色受到伤害时

**效果**：
1. 若其体力值为1
2. 你可以**弃置一张装备牌**并**翻面**
3. 防止此伤害

**设计要点**：
- 属于**他人受到伤害时的响应技**，需与 `beforeDamage` 流程集成
- 触发条件：目标角色体力值为1
- **发动条件**：只要有装备牌即可发动，**无论当前是正面还是背面**
- 需要弃置你的**一张装备牌**作为代价
- 成功发动后，**防止此次伤害**（伤害值置0）
- **核心修正**：翻面是**状态反转** (`faceUp = !faceUp`)，不是只能从正面变背面

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
caochong: {
  id: 'caochong',
  name: '曹冲',
  gender: 'male',
  maxHp: 3,
  skill: '称象/仁心',
  desc: '称象:当你受到伤害后,你可以亮出牌堆顶的四张牌,获得其中任意张点数之和不大于13的牌。仁心:当其他角色受到伤害时,若其体力值为1,你可以翻面并弃置一张装备牌,防止此伤害。',
  caps: { chengxiang: true, renxin: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 曹冲【称象】: 询问是否发动阶段
if(g.pending && g.pending.type==='chengxiangAsk'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     typeof d.damageInfo!=='object' || d.damageInfo === null){
    g.pending = null;
  }
}

// 曹冲【称象】: 选择牌阶段
if(g.pending && g.pending.type==='chengxiangChoose'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     !Array.isArray(d.revealedCards) || d.revealedCards.length === 0 ||
     !Array.isArray(d.selectable) || !Number.isInteger(d.sumLimit) || d.sumLimit <= 0){
    g.pending = null;
  }
}

// 曹冲【仁心】: 选择装备牌阶段
if(g.pending && g.pending.type==='renxinChoose'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     typeof d.target!=='number' || !g.players[d.target] || !g.players[d.target].alive ||
     g.players[d.target].hp > 1 ||
     !Array.isArray(d.equipIndices) || d.equipIndices.length === 0 ||
     typeof d.originalDamageInfo!=='object'){
    g.pending = null;
  }
}
```

---

## 四、技能实现

### 称象实现

**集成点**：`afterDamage` 函数（受到伤害后）

```javascript
// ⚠️ 核心修正：使用 targetSeat 而不是 mySeat，确保AI和联机兼容
function afterDamage(g, damageInfo) {
  tx(g => {
    const { targetSeat, sourceSeat, damage, cardType } = damageInfo;
    const target = g.players[targetSeat];
    
    // 称象触发：受到伤害后，检查受伤者是否有称象技能
    if (target && target.alive && generalHasCap(target, 'chengxiang')) {
      // 进入询问阶段：是否发动称象
      g.pending = {
        type: 'chengxiangAsk',
        seat: targetSeat,
        damageInfo: damageInfo
      };
      g.log = pushLog(g.log, `${target.name} 受到伤害，可发动【称象】`);
      return g;
    }
    
    return g;
  });
}

// 确认发动称象（从询问阶段进入选择阶段）
function confirmChengxiangAsk() {
  tx(g => {
    if (g.pending.type !== 'chengxiangAsk') return g;
    
    const seat = g.pending.seat;
    const me = g.players[seat];
    
    // 确保牌堆有至少4张牌
    ensureDeck(g, 4);
    
    // 亮出牌堆顶的 min(4, remaining) 张牌
    const drawCount = Math.min(4, g.deck.length);
    const revealed = g.deck.splice(0, drawCount);
    
    // 如果牌堆为空，直接取消
    if (revealed.length === 0) {
      g.pending = null;
      g.log = pushLog(g.log, `${me.name} 牌堆为空，无法发动【称象】`);
      return g;
    }
    
    // 计算每张牌的点数
    const cardValues = revealed.map(card => ({ 
      card, 
      value: getCardValue(card) 
    }));
    
    // 预计算所有可能的选择组合
    const selectable = calculateChengxiangOptions(cardValues, 13);
    
    // 进入选择阶段
    g.pending = {
      type: 'chengxiangChoose',
      seat: seat,
      revealedCards: revealed,
      cardValues: cardValues,
      sumLimit: 13,
      selectable: selectable
    };
    
    g.log = pushLog(g.log, `${me.name} 发动【称象】,亮出了 ${drawCount} 张牌`);
    markSkillSound(g, '称象');
    return g;
  });
}

// 取消发动称象
function cancelChengxiangAsk() {
  tx(g => {
    if (g.pending.type !== 'chengxiangAsk') return g;
    g.pending = null;
    return g;
  });
}

// 获取牌的点数
function getCardValue(card) {
  const rank = card.rank;
  if (rank === 'A' || rank === 'a') return 1;
  if (rank === 'J' || rank === 'j') return 11;
  if (rank === 'Q' || rank === 'q') return 12;
  if (rank === 'K' || rank === 'k') return 13;
  const num = parseInt(rank);
  return isNaN(num) ? 0 : num;
}

// 计算可选组合，包含空集
function calculateChengxiangOptions(cardValues, sumLimit) {
  const n = cardValues.length;
  const selectable = [];
  
  for (let mask = 0; mask < (1 << n); mask++) {
    let sum = 0;
    const indices = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += cardValues[i].value;
        indices.push(i);
      }
    }
    if (sum <= sumLimit) {
      selectable.push({ indices, sum });
    }
  }
  
  if (selectable.length === 0) {
    selectable.push({ indices: [], sum: 0 });
  }
  
  return selectable;
}

// 称象选择完成
function confirmChengxiang(selection) {
  tx(g => {
    if (g.pending.type !== 'chengxiangChoose') return g;
    const seat = g.pending.seat;
    const me = g.players[seat];
    const pending = g.pending;
    
    const selectedIndices = selection.indices || [];
    const selectedCards = selectedIndices.map(idx => pending.revealedCards[idx]);
    
    if (selectedCards.length > 0) {
      me.hand = me.hand || [];
      me.hand.push(...selectedCards);
    }
    
    const unselectedCards = pending.revealedCards.filter(
      (_, idx) => !selectedIndices.includes(idx)
    );
    g.discard = g.discard || [];
    g.discard.push(...unselectedCards);
    
    g.log = pushLog(g.log, `${me.name} 获得了${selectedIndices.length > 0 ? selectedCards.map(c => getCardName(c)).join(',') : '0张牌'}`);
    g.pending = null;
    return g;
  });
}

// 选择0张牌
function cancelChengxiang() {
  tx(g => {
    if (g.pending.type !== 'chengxiangChoose') return g;
    const seat = g.pending.seat;
    const me = g.players[seat];
    g.discard = g.discard || [];
    g.discard.push(...g.pending.revealedCards);
    g.log = pushLog(g.log, `${me.name} 选择了0张牌，所有牌置入弃牌堆`);
    g.pending = null;
    return g;
  });
}
```

### 仁心实现

**集成点**：`beforeDamage` 函数（受到伤害前）

```javascript
// 循环查找所有可能的曹冲
function beforeDamage(g, damageInfo) {
  tx(g => {
    const { targetSeat, sourceSeat, damage } = damageInfo;
    const target = g.players[targetSeat];
    
    if (target && target.alive && target.hp === 1 && damage > 0) {
      for (let i = 0; i < g.players.length; i++) {
        const p = g.players[i];
        if (i !== targetSeat && p && p.alive && generalHasCap(p, 'renxin')) {
          const equipIndices = p.equip ? 
            p.equip.map((e, idx) => e ? idx : -1).filter(idx => idx !== -1) : [];
          
          if (equipIndices.length > 0) {
            g.pending = {
              type: 'renxinChoose',
              seat: i,
              target: targetSeat,
              damage: damage,
              sourceSeat: sourceSeat,
              equipIndices: equipIndices,
              originalDamageInfo: damageInfo
            };
            g.log = pushLog(g.log, `${p.name} 可以发动【仁心】,保护 ${target.name}`);
            return g;
          }
        }
      }
    }
    return g;
  });
}

// 仁心选择装备牌弃置
function chooseRenxinEquip(equipIndex) {
  tx(g => {
    if (g.pending.type !== 'renxinChoose') return g;
    const seat = g.pending.seat;
    const me = g.players[seat];
    const target = g.players[g.pending.target];
    const pending = g.pending;
    
    if (!pending.equipIndices.includes(equipIndex) || !me.equip || !me.equip[equipIndex]) {
      return g;
    }
    
    const equipCard = me.equip[equipIndex];
    me.equip[equipIndex] = null;
    g.discard = g.discard || [];
    g.discard.push(equipCard);
    
    // 状态反转
    me.faceUp = !me.faceUp;
    
    pending.originalDamageInfo.damage = 0;
    
    g.log = pushLog(g.log, `${me.name} 发动【仁心】,弃置装备 ${getCardName(equipCard)},${me.faceUp ? '正面朝上' : '背面朝上'},防止了对 ${target.name} 的伤害`);
    markSkillSound(g, '仁心');
    g.pending = null;
    return g;
  });
}

// 取消仁心
function cancelRenxin() {
  tx(g => {
    if (g.pending.type !== 'renxinChoose') return g;
    g.pending = null;
    return g;
  });
}
```

---

## 五、渲染集成

### 称象UI

```javascript
// 询问阶段
if (g.pending && g.pending.type === 'chengxiangAsk' && g.pending.seat === mySeat) {
  ui.innerHTML += `
    <div class="skill-choose">
      <h4>【称象】</h4>
      <p>你受到伤害，是否发动【称象】？</p>
      <button onclick="confirmChengxiangAsk()" class="skill-btn" style="background: #4a90d9;">发动</button>
      <button onclick="cancelChengxiangAsk()" class="skill-btn" style="background: #999;">不发动</button>
    </div>
  `;
  return;
}

// 选择阶段
if (g.pending && g.pending.type === 'chengxiangChoose' && g.pending.seat === mySeat) {
  const p = g.pending;
  let selectedHtml = chengxiangSelectedIndices.length > 0 
    ? p.revealedCards.filter((_,i) => chengxiangSelectedIndices.includes(i)).map(c => getCardName(c)).join(',')
    : '无';
  let sum = chengxiangSelectedIndices.reduce((s,i) => s + p.cardValues[i].value, 0);
  
  ui.innerHTML += `
    <div class="skill-choose">
      <h4>【称象】选择牌</h4>
      <p>点数和 ≤ ${p.sumLimit}，选择任意张：</p>
      <div class="card-grid">
        ${p.revealedCards.map((c, i) => `
          <div class="card-option" onclick="toggleChengxiangCard(${i})" style="cursor:pointer;">
            ${getCardName(c)} (${p.cardValues[i].value}点)
          </div>
        `).join('')}
      </div>
      <p>已选：<strong>${selectedHtml}</strong>，点数和：<strong>${sum}</strong></p>
      <button onclick="confirmChengxiangSelection()">确认</button>
      <button onclick="cancelChengxiang()">选0张</button>
    </div>
  `;
  return;
}

let chengxiangSelectedIndices = [];
function toggleChengxiangCard(idx) {
  const p = g.pending;
  if (!p || p.type !== 'chengxiangChoose' || p.seat !== mySeat) return;
  
  let newSum = chengxiangSelectedIndices.reduce((s,i) => s + p.cardValues[i].value, 0);
  let val = p.cardValues[idx].value;
  let idxIn = chengxiangSelectedIndices.indexOf(idx);
  if (idxIn >= 0) {
    newSum -= val;
    chengxiangSelectedIndices.splice(idxIn, 1);
  } else {
    newSum += val;
    if (newSum <= p.sumLimit) chengxiangSelectedIndices.push(idx);
  }
  render();
}

function confirmChengxiangSelection() {
  const p = g.pending;
  if (!p || p.type !== 'chengxiangChoose') return;
  let selection = p.selectable.find(s => 
    s.indices.length === chengxiangSelectedIndices.length &&
    s.indices.every(i => chengxiangSelectedIndices.includes(i))
  );
  if (selection) {
    confirmChengxiang(selection);
    chengxiangSelectedIndices = [];
  }
}
```

### 仁心UI

```javascript
// 选择阶段
if (g.pending && g.pending.type === 'renxinChoose' && g.pending.seat === mySeat) {
  const p = g.pending;
  const target = g.players[p.target];
  ui.innerHTML += `
    <div class="skill-choose">
      <h4>【仁心】保护 ${target.name}</h4>
      <p>弃置一张装备牌并翻面：</p>
      <div class="equip-grid">
        ${p.equipIndices.map(idx => `
          <button onclick="chooseRenxinEquip(${idx})">
            弃置 ${getCardName(g.players[mySeat].equip[idx])}
          </button>
        `).join('')}
      </div>
      <button onclick="cancelRenxin()">取消</button>
    </div>
  `;
  return;
}
```

---

## 六、音效标识

```javascript
const SKILL_SOUNDS = {
  '称象': 'chengxiang',
  '仁心': 'renxin',
};
```

---

## 七、边界条件处理

### 称象
1. **牌堆不足**：亮出 `min(4, deck.length)` 张牌
2. **牌堆为空**：直接取消发动，不亮牌
3. **无合法组合**：始终有空集选项（选择0张牌）
4. **点数计算**：支持A/J/Q/K大小写
5. **AI/联机**：所有判定基于 `g.players[seat]`，不依赖 `mySeat`

### 仁心
1. **目标体力>1**：不触发
2. **无装备牌**：不能发动
3. **翻面逻辑**：`faceUp = !faceUp`（真正的状态反转）
4. **AI/联机**：循环查找所有玩家，不依赖 `mySeat`
5. **防止伤害**：`damage = 0`
6. **不能自救**：`i !== targetSeat` 确保不能为自己发动

---

## 八、测试要点

### 称象测试场景
| 场景 | 预期 |
|------|------|
| AI曹冲受到伤害 | 可以发动称象 |
| 联机曹冲受到伤害 | 可以发动称象 |
| 玩家选择发动 | 进入亮牌选择阶段 |
| 玩家选择不发动 | 直接跳过，不亮牌 |
| 牌堆有4张 | 亮4张牌 |
| 牌堆有2张 | 亮2张牌 |
| 牌堆为空 | 无法发动，提示牌堆为空 |
| 所有组合点数>13 | 只能选0张 |
| 选择有效组合 | 获得牌，其余弃牌 |
| 选择0张 | 所有牌弃牌 |

### 仁心测试场景
| 场景 | 预期 |
|------|------|
| AI曹冲保护他人 | 可以发动仁心 |
| 联机曹冲保护他人 | 可以发动仁心 |
| 目标体力=1 | 可以发动 |
| 目标体力>1 | 不触发 |
| 曹冲背面朝上 | 可以发动，翻回正面 |
| 曹冲正面朝上 | 可以发动，变背面 |
| 无装备牌 | 不能发动 |
| 多个装备 | 可选任意一个 |
| 自己受伤 | 不能为自己发动 |

---

## 九、实现优先级

1. 修正 `mySeat` 问题（架构层面）
2. 添加数据定义
3. 添加pending状态防御
4. 实现称象询问-亮牌-选择流程
5. 实现仁心触发和翻面逻辑
6. UI集成
7. 边界处理
8. 测试验证

---

## 十、修正记录

**已修正核心问题：**

1. ✅ **`mySeat` 滥用**：引擎逻辑全部改用 `targetSeat` 和循环查找，确保AI和联机兼容
2. ✅ **白嫖看牌**：拆分为询问阶段 + 亮牌阶段，必须先确认发动才亮牌
3. ✅ **翻面机制**：修正为真正的状态反转 (`faceUp = !faceUp`)，支持背面状态发动仁心
4. ✅ **边界条件**：补充空集选项，处理牌堆不足和为空情况

**技术债务清理：**
- 原版设计中 `afterDamage` 和 `beforeDamage` 使用 `mySeat` 判定，已全部修改为基于角色座位号
- 原版设计中称象直接亮牌，已拆分为询问阶段和选择阶段
- 原版设计中仁心要求 `faceUp === true`，已修改为无状态限制，翻面逻辑改为反转

**⚠️ 引擎对接注意事项：**
- `chooseRenxinEquip` 中直接置空装备数组（`me.equip[equipIndex] = null`）可能导致装备附加属性（距离、攻击范围、防具效果等）残留。建议检查引擎是否有 `loseEquip` 或 `unequipCard` 等专用函数。若有，应调用该函数；若无，需补充移除装备附加属性的逻辑

*文档状态：修正版（已完整处理所有已知问题）*
*创建时间：2026-07-13*
*最后修正：2026-07-13*
*负责人：Mistral Vibe*
