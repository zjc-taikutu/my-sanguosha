# 陈宫 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `chengong` |
| **武将名称** | 陈宫 |
| **势力** | 群 |
| **性别** | male |
| **体力上限** | 3 |
| **技能** | 明策 / 智迟 |

---

## 二、技能说明

### 明策
**时机**：出牌阶段限一次

**效果**：
1. 你可以交给一名其他角色一张装备牌或【'杀'】
2. 并选择其攻击范围内的另一名角色（若无则不选择）
3. 令其选择一项：
   - 1. 视为对你选择的角色使用一张普通【'杀'】
   - 2. 摸一张牌

**设计要点**：
- 属于**出牌阶段**的主动技能，每回合限一次
- 交给的牌必须是**装备牌**或**'杀'**
- 需要选择**两个目标**：
  - 第一个目标：接收牌的角色（必须存活且不是自己）
  - 第二个目标：被选择使用杀的目标（必须在第一个目标的攻击范围内）
- 第二个目标是**可选的**——如果第一个目标攻击范围内没有其他角色，则不选择
- 令第一个目标选择：使用杀或摸牌
- 如果选择使用杀，视为**普通'杀'**（即无属性、无特效的基础杀）
- 交给牌后，牌的所有权立即转移

### 智迟（锁定技）
**时机**：回合外受到伤害后

**效果**：
【'杀'】和普通锦囊牌对你无效直至本回合结束。

**设计要点**：
- 属于**锁定技**，无需玩家操作，自动生效
- 触发时机：**回合外**受到伤害**后**（即伤害结算完成后）
- 效果持续：**直至本回合结束**（即当前回合的角色回合结束时）
- 无效化的牌类型：
  - 所有【'杀'】（普通杀、属性杀等）
  - 普通锦囊牌（非延时锦囊）
- 实现方式：在目标选择或使用判定时过滤
- 需要区分**回合内**和**回合外**的状态

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
chengong: {
  id: 'chengong',
  name: '陈宫',
  gender: 'male',
  maxHp: 3,
  skill: '明策/智迟',
  desc: '明策:出牌阶段限一次,你可以交给一名其他角色一张装备牌或【杀】,并选择其攻击范围内的另一名角色(若无则不选择),令其选择一项:1.视为对你选择的角色使用一张普通【杀】;2.摸一张牌。智迟:锁定技,当你于回合外受到伤害后,【杀】和普通锦囊牌对你无效直至本回合结束。',
  caps: { mingce: true, zhichi: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 陈宫【明策】:回合内使用标记
if(typeof g.mingceUsed!=='boolean') g.mingceUsed=false;

// 陈宫【明策】:选择阶段
// pending 应包含 type、sourceSeat（陈宫座位）、targetSeat（接收牌的角色）、target2Seat（被攻击的目标，可选）
if(g.pending && g.pending.type==='mingcePick'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
     (d.target2Seat!==null && (typeof d.target2Seat!=='number' || !g.players[d.target2Seat] || !g.players[d.target2Seat].alive))||
     !Array.isArray(d.cardToGive) || d.cardToGive.length===0){
    g.pending = null;
    g.phase = 'play';
  }
}

// 陈宫【明策】:第二个目标选择阶段
if(g.pending && g.pending.type==='mingcePickTarget2'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
     !Array.isArray(d.candidates) || d.candidates.length===0 ||
     !Array.isArray(d.cardToGive) || d.cardToGive.length===0){
    g.pending = null;
    g.phase = 'play';
  }
}

// 陈宫【明策】:接收牌的角色选择阶段
if(g.pending && g.pending.type==='mingceChoice'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
     (d.target2Seat!==null && (typeof d.target2Seat!=='number' || !g.players[d.target2Seat] || !g.players[d.target2Seat].alive))||
     !Array.isArray(d.cardToGive) || d.cardToGive.length===0){
    g.pending = null;
    g.phase = 'play';
  }
}

// 陈宫【智迟】:免疫状态标记
// 记录智迟的免疫状态：{ seat: 陈宫座位, turn: 当前回合的角色座位（即伤害来源的回合）}
if(typeof g.zhichiImmunity!=='object' || g.zhichiImmunity===null) g.zhichiImmunity=null;
```

在 `startTurn` 函数中添加重置：
```javascript
g.mingceUsed = false;  // 重置明策使用标记
```

在 `endTurn` 函数中添加清理：
```javascript
// 陈宫【智迟】：在回合结束时清理免疫状态
if(g.zhichiImmunity && g.zhichiImmunity.turn === g.turn){
  g.zhichiImmunity = null;
}
```

---

## 四、技能实现

### 明策实现

**集成点**：`render-controls.js` 添加明策按钮

```javascript
// 在 renderControls 中添加明策按钮
function renderControls(g, me) {
  // ... 现有代码 ...

  // 明策：出牌阶段可以发动（每回合限一次）
  if (hasCap(me, 'mingce') && !g.mingceUsed && g.phase === 'play' && g.turn === mySeat) {
    // 检查是否有可交给的牌（装备牌或杀）
    const hasEquipOrSha = checkMingceCard(me);
    // 检查是否有其他存活角色
    const otherAliveCount = g.players.filter((p, i) => 
      i !== mySeat && p && p.alive 
    ).length;
    
    if (hasEquipOrSha && otherAliveCount > 0) {
      ui.innerHTML += `
        <button onclick="startMingce()" class="skill-btn" style="background: #4a90d9;">
          明策
        </button>
      `;
    }
  }
}

// 辅助函数：检查是否有可以用于明策的牌
function checkMingceCard(player) {
  if (!player || !player.alive) return false;
  
  // 检查手牌
  const hand = player.hand || [];
  for (const card of hand) {
    if (isEquipment(card) || canUseAs(player, card, '杀')) {
      return true;
    }
  }
  
  // 检查装备区
  const equips = player.equip || {};
  const equipSlots = ['weapon', 'armor', 'horse1', 'horse2', 'treasure'];
  for (const slot of equipSlots) {
    const equipCard = equips[slot];
    if (equipCard) {
      return true;
    }
  }
  
  return false;
}
```

```javascript
// 明策发动起始函数
function startMingce() {
  tx(g => {
    if (g.phase !== 'play' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me || !me.alive || !hasCap(me, 'mingce') || g.mingceUsed) return g;
    
    // 进入明策第一步：选择要交给的牌
    g.pending = {
      type: 'mingcePickCard',
      sourceSeat: mySeat
    };
    g.phase = 'mingcePickCard';
    g.log = pushLog(g.log, `${me.name} 发动【明策】,请选择一张装备牌或【杀】…`);
    markSkillSound(g, '明策');
    
    return g;
  });
}

// 明策：选择要交给的牌
function pickMingceCard(cardIndex, fromEquip) {
  tx(g => {
    if (g.pending.type !== 'mingcePickCard' || g.pending.sourceSeat !== mySeat) return g;
    
    const me = g.players[mySeat];
    if (!me || !me.alive) return g;
    
    let card = null;
    let cardName = '';
    
    if (fromEquip) {
      // 从装备区选择
      const equips = me.equip || {};
      const equipSlots = ['weapon', 'armor', 'horse1', 'horse2', 'treasure'];
      if (cardIndex >= 0 && cardIndex < equipSlots.length) {
        const slot = equipSlots[cardIndex];
        card = equips[slot];
        if (card) {
          cardName = card.name;
          // 移除装备
          equips[slot] = null;
          me.equip = equips;
        }
      }
    } else {
      // 从手牌选择
      const hand = me.hand || [];
      if (cardIndex >= 0 && cardIndex < hand.length) {
        card = hand[cardIndex];
        cardName = card.name;
        // 移除手牌
        hand.splice(cardIndex, 1);
        me.hand = hand;
      }
    }
    
    if (!card) return g;
    
    // 检查牌类型是否合法
    if (!isEquipment(card) && !canUseAs(me, card, '杀')) {
      // 非法牌类型，归还牌
      if (fromEquip) {
        const equips = me.equip || {};
        const equipSlots = ['weapon', 'armor', 'horse1', 'horse2', 'treasure'];
        if (cardIndex >= 0 && cardIndex < equipSlots.length) {
          equips[equipSlots[cardIndex]] = card;
          me.equip = equips;
        }
      } else {
        (me.hand || []).splice(cardIndex, 0, card);
      }
      g.log = pushLog(g.log, `选择的牌 ${cardName} 不是装备牌或【杀】，请重新选择`);
      return g;
    }
    
    // 进入明策第二步：选择接收牌的目标
    g.pending = {
      type: 'mingcePickTarget',
      sourceSeat: mySeat,
      cardToGive: [card],
      cardName: cardName
    };
    g.phase = 'mingcePickTarget';
    g.log = pushLog(g.log, `${me.name} 选择了 ${cardName},请选择接收牌的角色…`);
    
    return g;
  });
}

// 明策：选择接收牌的目标
function pickMingceTarget(seat) {
  tx(g => {
    if (g.pending.type !== 'mingcePickTarget' || g.pending.sourceSeat !== mySeat) return g;
    
    const me = g.players[mySeat];
    const target = g.players[seat];
    
    if (!me || !me.alive || !target || !target.alive || seat === mySeat) return g;
    
    const cardToGive = g.pending.cardToGive || [];
    const cardName = g.pending.cardName || '';
    
    // 计算目标的攻击范围
    const attackRange = getAttackRange(target);
    
    // 找出攻击范围内的其他角色（排除接收牌的角色自己和陈宫）
    const candidates = [];
    for (let i = 0; i < g.players.length; i++) {
      if (i === mySeat || i === seat) continue;
      const p = g.players[i];
      if (p && p.alive && distance(g, seat, i) <= attackRange) {
        candidates.push(i);
      }
    }
    
    if (candidates.length > 0) {
      // 有可选的第二个目标，进入选择阶段
      g.pending = {
        type: 'mingcePickTarget2',
        sourceSeat: mySeat,
        targetSeat: seat,
        cardToGive: cardToGive,
        cardName: cardName,
        candidates: candidates
      };
      g.phase = 'mingcePickTarget2';
      g.log = pushLog(g.log, `${me.name} 选择了 ${target.name},请选择其攻击范围内的另一名角色…`);
    } else {
      // 没有可选的第二个目标，直接进入选择阶段（不选择第二个目标）
      // 交给牌
      target.hand = (target.hand || []).concat(cardToGive);
      
      g.pending = {
        type: 'mingceChoice',
        sourceSeat: mySeat,
        targetSeat: seat,
        target2Seat: null,
        cardToGive: [],
        cardName: cardName
      };
      g.phase = 'mingceChoice';
      g.log = pushLog(g.log, `${me.name} 将 ${cardName} 交给 ${target.name},其攻击范围内无其他角色,请选择…`);
      
      // 标记明策已使用
      g.mingceUsed = true;
    }
    
    return g;
  });
}

// 明策：选择第二个目标（被攻击的角色）
function pickMingceTarget2(seat) {
  tx(g => {
    if (g.pending.type !== 'mingcePickTarget2' || g.pending.sourceSeat !== mySeat) return g;
    
    const me = g.players[mySeat];
    const target1 = g.players[g.pending.targetSeat];
    const target2 = g.players[seat];
    
    if (!me || !me.alive || !target1 || !target1.alive || !target2 || !target2.alive) return g;
    
    // 检查是否在候选列表中
    if (!g.pending.candidates.includes(seat)) return g;
    
    const cardToGive = g.pending.cardToGive || [];
    const cardName = g.pending.cardName || '';
    
    // 交给牌
    target1.hand = (target1.hand || []).concat(cardToGive);
    
    // 进入选择阶段
    g.pending = {
      type: 'mingceChoice',
      sourceSeat: mySeat,
      targetSeat: g.pending.targetSeat,
      target2Seat: seat,
      cardToGive: [],
      cardName: cardName
    };
    g.phase = 'mingceChoice';
    g.log = pushLog(g.log, `${me.name} 将 ${cardName} 交给 ${target1.name},选择 ${target2.name} 为目标,请选择…`);
    
    // 标记明策已使用
    g.mingceUsed = true;
    
    return g;
  });
}

// 明策：接收牌的角色选择如何响应
function chooseMingceOption(option) {
  tx(g => {
    if (g.pending.type !== 'mingceChoice') return g;
    
    const source = g.players[g.pending.sourceSeat];
    const target = g.players[g.pending.targetSeat];
    const target2 = g.pending.target2Seat !== null ? g.players[g.pending.target2Seat] : null;
    
    if (!source || !source.alive || !target || !target.alive) return g;
    
    // 如果选择了使用杀，需要有目标
    if (option === 'sha' && g.pending.target2Seat === null) {
      g.log = pushLog(g.log, `${target.name} 选择使用【杀】,但无合法目标,视为放弃`);
      // 清理状态
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    if (option === 'sha' && (!target2 || !target2.alive)) {
      g.log = pushLog(g.log, `${target.name} 选择使用【杀】,但目标已死亡,视为放弃`);
      // 清理状态
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    if (option === 'sha') {
      // 视为使用普通杀
      // 直接造成伤害（无需实际使用杀牌）
      dealDamage(g, g.pending.target2Seat, 1, g.pending.targetSeat, 
        `${target.name} 发动【明策】效果,视为对 ${target2.name} 使用普通【杀】`, 'mingce');
      
      g.log = pushLog(g.log, `${target.name} 选择对 ${target2.name} 使用普通【杀】`);
    } else if (option === 'draw') {
      // 摸一张牌
      ensureDeck(g, 1);
      const card = g.deck.pop();
      if (card) {
        (target.hand || []).push(card);
        g.log = pushLog(g.log, `${target.name} 选择摸一张牌`);
      }
    }
    
    // 清理状态
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}

// 取消明策
function cancelMingce() {
  tx(g => {
    if (g.pending && g.pending.type && g.pending.type.startsWith('mingce') && g.pending.sourceSeat === mySeat) {
      const me = g.players[mySeat];
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${me.name} 取消发动【明策】`);
    }
    return g;
  });
}
```

### 智迟实现

**集成点**：伤害结算函数 `dealDamage` 或类似函数

```javascript
// 在 dealDamage 函数中添加智迟触发检查
function dealDamage(g, targetSeat, damage, sourceSeat, reason, skillType) {
  tx(g => {
    // ... 现有的伤害逻辑 ...
    
    const target = g.players[targetSeat];
    const source = g.players[sourceSeat];
    
    if (!target || !target.alive) return g;
    
    // 应用伤害
    target.hp -= damage;
    
    // 陈宫【智迟】：当陈宫于回合外受到伤害后触发
    if (target && hasCap(target, 'zhichi') && target.alive && target.hp > 0) {
      // 检查是否是回合外受到的伤害
      // 回合外：当前回合不是陈宫的回合，且伤害来源不是陈宫自己
      if (g.turn !== targetSeat && sourceSeat !== targetSeat) {
        // 设置免疫状态
        g.zhichiImmunity = {
          seat: targetSeat,
          turn: g.turn  // 记录当前回合的角色
        };
        g.log = pushLog(g.log, `${target.name} 发动【智迟】,【杀】和普通锦囊牌对其无效直至本回合结束`);
        markSkillSound(g, '智迟');
      }
    }
    
    // ... 伤害后续处理 ...
    
    return g;
  });
}
```

**目标过滤集成**：

```javascript
// 在 canTarget 或 canUseCardTo 函数中添加智迟检查
function canTarget(g, sourceSeat, targetSeat, card) {
  // 陈宫【智迟】：检查免疫状态
  if (g.zhichiImmunity && g.zhichiImmunity.seat === targetSeat) {
    // 当前免疫是否仍然有效（即当前回合是否为触发时的回合）
    if (g.zhichiImmunity.turn === g.turn) {
      // 检查是否为【杀】或普通锦囊牌
      const isSha = card.name === '杀' || (card.name && card.name.includes('杀'));
      const isNormalTactics = isNormalTacticsCard(card);
      
      if (isSha || isNormalTactics) {
        return false; // 无法成为目标
      }
    }
  }
  
  // 正常判断
  return true;
}

// 辅助函数：判断是否为普通锦囊牌（非延时）
function isNormalTacticsCard(card) {
  if (!card || !card.name) return false;
  
  const normalTactics = [
    '过河拆桥', '顺手牵羊', '无中生有', '决斗', '借刀杀人',
    '无懈可击', '调虎离山', '兵粮寸断'
  ];
  
  return normalTactics.includes(card.name);
}

// 在使用牌时的检查
function canUseCardTo(g, sourceSeat, targetSeat, card) {
  // 陈宫【智迟】：检查免疫状态
  if (g.zhichiImmunity && g.zhichiImmunity.seat === targetSeat) {
    if (g.zhichiImmunity.turn === g.turn) {
      const isSha = card.name === '杀' || (card.name && card.name.includes('杀'));
      const isNormalTactics = isNormalTacticsCard(card);
      
      if (isSha || isNormalTactics) {
        return false;
      }
    }
  }
  
  return true;
}
```

---

## 五、渲染集成（render-controls.js）

### 明策 UI 集成

```javascript
// 在 renderControls 中添加明策各阶段状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 明策：选择牌阶段
  if (g.pending && g.pending.type === 'mingcePickCard' && g.pending.sourceSeat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【明策】选择牌</h4>
        <p>请选择一张装备牌或【杀】</p>
        <button onclick="cancelMingce()" class="cancel-btn">
          取消
        </button>
      </div>
    `;
    
    // 显示可选的手牌
    if (p && p.hand) {
      ui.innerHTML += '<div class="card-select">';
      for (let i = 0; i < p.hand.length; i++) {
        const card = p.hand[i];
        const isValid = isEquipment(card) || canUseAs(p, card, '杀');
        if (isValid) {
          ui.innerHTML += `
            <button onclick="pickMingceCard(${i}, false)" class="card-btn">
              ${card.name}
            </button>
          `;
        }
      }
      ui.innerHTML += '</div>';
    }
    
    // 显示可选的装备
    if (p && p.equip) {
      const equips = p.equip;
      const equipSlots = ['weapon', 'armor', 'horse1', 'horse2', 'treasure'];
      ui.innerHTML += '<div class="equip-select">';
      for (let i = 0; i < equipSlots.length; i++) {
        const slot = equipSlots[i];
        const equip = equips[slot];
        if (equip) {
          ui.innerHTML += `
            <button onclick="pickMingceCard(${i}, true)" class="card-btn">
              ${equip.name} (${slot})
            </button>
          `;
        }
      }
      ui.innerHTML += '</div>';
    }
    
    return;
  }

  // 明策：选择接收牌的目标阶段
  if (g.pending && g.pending.type === 'mingcePickTarget' && g.pending.sourceSeat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【明策】选择目标</h4>
        <p>请选择接收 ${g.pending.cardName} 的角色</p>
        <button onclick="cancelMingce()" class="cancel-btn">
          取消
        </button>
      </div>
    `;
    
    // 显示所有其他存活角色
    for (let i = 0; i < g.players.length; i++) {
      if (i === seat) continue;
      const target = g.players[i];
      if (target && target.alive && isSeatClickable(i)) {
        ui.innerHTML += `
          <button onclick="pickMingceTarget(${i})" class="target-btn">
            选择 ${target.name}
          </button>
        `;
      }
    }
    return;
  }

  // 明策：选择第二个目标阶段
  if (g.pending && g.pending.type === 'mingcePickTarget2' && g.pending.sourceSeat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【明策】选择攻击目标</h4>
        <p>请选择 ${g.players[g.pending.targetSeat].name} 攻击范围内的角色作为【杀】的目标</p>
        <button onclick="cancelMingce()" class="cancel-btn">
          取消
        </button>
      </div>
    `;
    
    // 显示可选的目标
    for (const candidateSeat of g.pending.candidates) {
      const target = g.players[candidateSeat];
      if (target && target.alive && isSeatClickable(candidateSeat)) {
        ui.innerHTML += `
          <button onclick="pickMingceTarget2(${candidateSeat})" class="target-btn">
            选择 ${target.name}
          </button>
        `;
      }
    }
    return;
  }

  // 明策：接收牌的角色选择阶段
  if (g.pending && g.pending.type === 'mingceChoice' && g.pending.targetSeat === seat) {
    const source = g.players[g.pending.sourceSeat];
    const target2 = g.pending.target2Seat !== null ? g.players[g.pending.target2Seat] : null;
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>${source.name} 发动【明策】</h4>
    `;
    
    if (target2 && target2.alive) {
      ui.innerHTML += `
        <p>${source.name} 将 ${g.pending.cardName} 交给你,并选择了 ${target2.name} 为目标</p>
        <p>请选择：</p>
        <button onclick="chooseMingceOption('sha')" class="skill-btn" style="background: #e74c3c;">
          对 ${target2.name} 使用普通【杀】
        </button>
        <button onclick="chooseMingceOption('draw')" class="skill-btn" style="background: #4a90d9;">
          摸一张牌
        </button>
      `;
    } else {
      ui.innerHTML += `
        <p>${source.name} 将 ${g.pending.cardName} 交给你,其攻击范围内无其他角色</p>
        <p>请选择：</p>
        <button onclick="chooseMingceOption('draw')" class="skill-btn" style="background: #4a90d9;">
          摸一张牌
        </button>
      `;
    }
    
    ui.innerHTML += `
      </div>
    `;
    return;
  }
}
```

### 智迟状态显示

```javascript
// 在 renderStatus 中显示智迟状态
function renderStatus(g, me) {
  if (g.zhichiImmunity && g.zhichiImmunity.turn === g.turn) {
    const chengongSeat = g.zhichiImmunity.seat;
    const chengong = g.players[chengongSeat];
    if (chengong && chengong.alive) {
      ui.innerHTML += `
        <div class="skill-status">
          <span style="color: #9b59b6;">【智迟】: ${chengong.name} 本回合内免疫【杀】和普通锦囊牌</span>
        </div>
      `;
    }
  }
}
```

---

## 六、音效标识

在 `markSkillSound` 中添加：
```javascript
const SKILL_SOUNDS = {
  // ... 现有技能 ...
  '明策': 'mingce',
  '智迟': 'zhichi',
};
```

---

## 七、边界条件处理

### 明策

1. **无可交给的牌**：明策按钮不显示
2. **无其他存活角色**：明策按钮不显示
3. **目标攻击范围内无其他角色**：不选择第二个目标，直接进入选择阶段
4. **交给牌后目标死亡**：如果接收牌的角色死亡，技能中断，牌归还给陈宫
5. **选择目标后目标死亡**：在选择阶段实时验证目标存活状态
6. **使用杀时目标死亡**：选择摸牌
7. **牌堆为空**：摸牌时如果牌堆为空，直接结束
8. **交给的牌类型非法**：非装备牌或杀，提示并重新选择
9. **陈宫死亡**：明策效果中断
10. **接收牌的角色死亡**：明策效果中断

### 智迟

1. **陈宫死亡**：智迟效果立即消失
2. **触发回合结束**：智迟效果在回合结束时自动清理
3. **多次受到伤害**：仅第一次回合外受到的伤害触发智迟，后续伤害不重复触发
4. **自己回合受到伤害**：不触发智迟（智迟仅在**回合外**受到伤害时触发）
5. **伤害来源是自己**：不触发智迟
6. **延时锦囊牌**：智迟仅对**普通**锦囊牌有效，延时锦囊牌（如乐不思蜀、五谷丰登等）不受影响
7. **装备牌**：智迟对装备牌无效，仅对杀和普通锦囊牌有效
8. **陈宫使用杀或锦囊**：智迟是防护技能，不影响陈宫使用这些牌
9. **多个陈宫**：每个陈宫的智迟独立生效

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **明策** |
| 明策：有装备牌和其他角色 | 可以发动，选择装备牌并选择目标 |
| 明策：有杀和其他角色 | 可以发动，选择杀并选择目标 |
| 明策：只有非装备非杀的牌 | 按钮不显示 |
| 明策：无其他存活角色 | 按钮不显示 |
| 明策：目标攻击范围内无其他角色 | 不选择第二个目标，直接进入选择阶段 |
| 明策：目标攻击范围内有多个角色 | 可以选择其中一个作为第二个目标 |
| 明策：选择使用杀 | 视为对第二个目标使用普通杀，造成伤害 |
| 明策：选择摸牌 | 接收牌的角色摸一张牌 |
| 明策：使用杀时目标已死亡 | 无法选择使用杀，只能选择摸牌 |
| 明策：交给牌后接收目标死亡 | 技能中断，牌归还 |
| 明策：牌堆为空时选择摸牌 | 不摸牌，直接结束 |
| 明策：每回合多次发动 | 仅第一次生效 |
| 明策：取消操作 | 可以在各个阶段取消 |
| **智迟** |
| 智迟：回合外受到伤害 | 触发智迟，免疫生效 |
| 智迟：回合内受到伤害 | 不触发智迟 |
| 智迟：自己使用杀或锦囊 | 正常使用，不受智迟影响 |
| 智迟：其他角色对陈宫使用杀 | 无效，无法成为目标 |
| 智迟：其他角色对陈宫使用普通锦囊 | 无效，无法成为目标 |
| 智迟：其他角色对陈宫使用延时锦囊 | 有效，可以成为目标 |
| 智迟：其他角色对陈宫使用装备牌 | 有效，可以成为目标 |
| 智迟：陈宫死亡后 | 智迟效果消失 |
| 智迟：触发回合结束后 | 智迟效果自动清理 |
| 智迟：多次回合外受到伤害 | 仅第一次生效 |
| **组合测试** |
| 明策+智迟：使用明策后受到回合外伤害 | 智迟正常触发 |
| 明策+智迟：明策中接收牌的角色使用杀 | 正常使用，不受陈宫智迟影响 |
| 明策+智迟：陈宫对自己使用明策 | 不可行，必须选择其他角色 |

---

## 九、实现优先级

1. **数据定义优先**：添加陈宫武将定义
2. **状态管理优先**：添加状态字段防御和重置逻辑
3. **智迟核心逻辑优先**：实现免疫状态设置和清理（相对简单，为锁定技）
4. **明策核心逻辑优先**：实现牌的交付和选择流程
5. **明策UI集成优先**：添加多阶段选择界面
6. **智迟目标过滤优先**：集成到目标选择系统中
7. **音效集成**：添加技能音效
8. **边界处理优先**：处理无目标、死亡、牌堆不足等特殊情况
9. **测试验证**：确保所有场景都通过测试

---

## 十、集成要点

### 与现有系统的集成

1. **状态管理系统**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制明策的多步流程
   - 使用 `g.pending` 管理各个阶段的状态

2. **伤害系统**：
   - 在 `dealDamage` 中集成智迟的触发逻辑
   - 确保伤害结算时正确判断回合内外

3. **目标选择系统**：
   - 修改 `canTarget` 或 `canUseCardTo` 函数，集成智迟的过滤逻辑
   - 确保免疫状态正确应用

4. **攻击范围系统**：
   - 复用现有的 `getAttackRange` 函数
   - 正确计算角色的攻击范围

5. **距离计算系统**：
   - 复用现有的 `distance` 函数
   - 用于判断是否在攻击范围内

6. **牌类型判断系统**：
   - 复用现有的 `isEquipment`、`canUseAs` 等函数
   - 正确识别装备牌和杀

7. **摸牌系统**：
   - 复用 `ensureDeck` 和 `drawN` 函数
   - 确保摸牌逻辑与其他技能一致

8. **伤害处理系统**：
   - 复用 `dealDamage` 函数处理明策中的伤害
   - 确保伤害来源和类型正确标记

### 需要修改的文件

1. **data.js**：
   - 添加陈宫武将定义

2. **game.js**：
   - `normalize()`：添加明策和智迟状态字段防御
   - `startTurn()`：重置明策使用标记
   - `endTurn()`：清理智迟免疫状态
   - `dealDamage()`：集成智迟触发逻辑
   - `canTarget()` 或类似函数：集成智迟目标过滤

3. **skills.js** 或相关文件：
   - 添加明策发动函数
   - 添加明策各阶段选择函数
   - 添加智迟辅助函数

4. **render-controls.js**：
   - 添加明策多阶段选择界面
   - 添加明策按钮
   - 添加智迟状态显示

5. **render.js**：
   - 添加明策和智迟的状态显示

---

## 十一、流程图

### 明策完整流程
```
出牌阶段
    ↓
陈宫点击【明策】按钮
    ↓
检查是否有装备牌或【杀】
    ↓
是：选择要交给的牌
    ↓
检查是否有其他存活角色
    ↓
是：选择接收牌的目标
    ↓
计算目标的攻击范围
    ↓
检查攻击范围内是否有其他角色
    ↓
┌─ 有：选择第二个目标（被攻击的角色）
│      ↓
│  交给牌
│      ↓
│  显示选择界面
└─ 无：直接进入选择界面
       ↓
接收牌的角色选择：
       ↓
  ┌─ 使用普通【杀】 → 检查是否有第二个目标
  │      ↓
  │    是：对第二个目标造成1点伤害
  │      ↓
  │    否：无法选择，视为放弃
  │
  └─ 摸一张牌 → 接收牌的角色摸一张牌
       ↓
清理状态，回到出牌阶段
```

### 智迟效果流程
```
陈宫于回合外受到伤害
    ↓
检查是否在陈宫的回合内
    ↓
否（即回合外）
    ↓
设置 g.zhichiImmunity 免疫状态
    ↓
记录当前回合的角色
    ↓
【杀】和普通锦囊牌对陈宫无效
    ↓
当前回合结束
    ↓
清理 g.zhichiImmunity 免疫状态
    ↓
回到正常状态
```

---

## 十二、特殊说明

### 关于明策的技能定位

明策是陈宫的控制型主动技能，体现了其运筹帷幄、调度有方的特点。通过交给牌物来创造选择空间：
- **交给装备牌**：可以削弱对方的装备优势，同时给予对方选择的压力
- **交给杀**：可以增加场上杀的数量，同时给接收者造成使用或摸牌的两难选择
- **选择机制**：接收者必须在攻击他人或获取资源之间做出选择，体现了陈宫的谋略

**技能特点**：
- 消耗性：需要消耗一张装备牌或杀
- 控制性：可以强制对方做出选择，可能影响战局走向
- 灵活性：可选择不同的目标组合，适应不同的场上局势
- 限制性：每回合限一次，防止过度强力

### 关于明策的选择机制

明策的选择机制需要注意几点：
1. **第二个目标的选择**：第二个目标必须在第一个目标（接收牌的角色）的攻击范围内
2. **视为使用普通杀**：使用杀时，不需要实际消耗杀牌，直接造成1点伤害，且为**普通**杀（无属性、无特效）
3. **选择的强制性**：接收牌的角色必须做出选择，没有放弃选项

### 关于智迟的免疫范围

智迟的免疫范围需要明确：
- **生效范围**：仅对陈宫本人生效
- **生效时机**：仅在陈宫于**回合外**受到伤害后生效
- **生效持续**：直至**当前回合**结束（即造成伤害的角色的回合结束）
- **免疫类型**：
  - 所有【杀】（普通杀、属性杀等）
  - 普通锦囊牌（非延时锦囊）
- **不免疫**：
  - 延时锦囊牌（如乐不思蜀、五谷丰登等）
  - 装备牌
  - 基本牌中的桃、酒等

### 关于回合内外的判定

智迟的触发依赖于**回合内外**的准确判定：
- **回合内**：从角色的回合开始阶段到回合结束阶段
- **回合外**：除了角色自己的回合之外的所有时间
- 判定依据：`g.turn === 陈宫座位`

---

## 十三、修正记录

*文档状态：设计阶段*
*创建时间：2026-07-13*
*负责人：Mistral Vibe*

### 待实装项

- [ ] **data.js**: 添加陈宫武将定义
- [ ] **game.js**: 
  - [ ] normalize函数：添加明策和智迟状态字段防御
  - [ ] startTurn函数：重置明策使用标记
  - [ ] endTurn函数：清理智迟免疫状态
  - [ ] dealDamage函数：集成智迟触发逻辑
  - [ ] canTarget/canUseCardTo函数：集成智迟目标过滤
- [ ] **skills.js**: 
  - [ ] 明策发动函数
  - [ ] 明策各阶段选择函数
  - [ ] 智迟辅助函数
- [ ] **render-controls.js**: 
  - [ ] 明策多阶段选择界面
  - [ ] 明策按钮
  - [ ] 智迟状态显示
- [ ] **render.js**: 明策和智迟状态显示

### 待优化项

- 音效文件：需要添加assets/audio/mingce.mp3、assets/audio/zhichi.mp3
- UI/UX：明策多阶段选择界面的用户体验优化
- 性能：确保明策流程中的各个阶段性能良好
- 兼容性：确保与现有所有技能的兼容性
- 辅助函数：可能需要添加新的辅助函数用于牌类型判断和攻击范围计算
