# 祝融 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `zhurong` |
| **武将名称** | 祝融 |
| **势力** | 蜀 |
| **性别** | female |
| **体力上限** | 4 |
| **技能** | 巨象 / 烈刃 |

---

## 二、技能说明

### 巨象（锁定技）
**时机**：持续生效

**效果**：
1. 【南蛮入侵】对你无效；
2. 当其他角色使用的【南蛮入侵】结算结束后置入弃牌堆时，你获得之。

**设计要点**：
- 属于**锁定技**，无需玩家操作，自动生效
- 效果①：在 `aoeAdvance` 函数中跳过祝融（南蛮入侵对其无效），类似孟获【祸首】的实现
- 效果②：在南蛮入侵结算结束后（`aoeAdvance` 完成所有目标结算后），检查是否有祝融且当前锦囊是南蛮入侵，若是则将该锦囊牌置入祝融的手牌
- 需要在 `finishAoeTrick` 或类似南蛮入侵最终结算函数中集成获得牌的逻辑
- 获得的牌是**锦囊牌本身**（即南蛮入侵这张牌），而不是结算过程中产生的其他牌
- 只对**其他角色使用的**南蛮入侵生效，祝融自己使用南蛮入侵不获得自身的锦囊牌

### 烈刃
**时机**：当你使用【杀】对目标角色造成伤害后

**效果**：
1. 你可以与该目标角色拼点
2. 若你赢，你获得该角色的一张牌（随机获取一张手牌或装备区中的牌）

**设计要点**：
- 属于**可发动的技能**，需要玩家选择是否发动
- 触发时机在伤害结算后，需要集成到 `resolveDamageEffect` 或类似伤害结算函数中
- 拼点机制复用现有的拼点系统（参考荀彧【驱虎】、太史慈【天义】的实现）
- 若祝融赢得拼点，从目标角色处随机获得一张牌
- 拼点失敗則流程直接結束，無任何效果
- 每次使用殺造成傷害后都可以独立觸發烈刃（無次數限制）

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
zhurong: {
  id: 'zhurong',
  name: '祝融',
  gender: 'female',
  maxHp: 4,
  skill: '巨象/烈刃',
  desc: '巨象:锁定技,①【南蛮入侵】对你无效;②当其他角色使用的【南蛮入侵】结算结束后置入弃牌堆时,你获得之。烈刃:当你使用【杀】对目标角色造成伤害后,你可以与其拼点,若你赢,你获得该角色的一张牌。',
  caps: { juxiang: true, lieRen: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 祝融【巨象】:南蛮入侵结算阶段
// pending 应包含 type、trickName（当前锦囊名称）、sourceSeat（使用者座位）等字段
if(g.pending && g.pending.type==='juxiangGain'){
  const d = g.pending;
  if(typeof d.trickName!=='string' || d.trickName!=='南蛮入侵' ||
     typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     !Array.isArray(d.zhurongSeats) || d.zhurongSeats.length === 0){
    g.pending = null;
    g.phase = 'play';
  }
}

// 祝融【烈刃】:拼点选择阶段
// pending 应包含 type、sourceSeat（祝融的座位）、targetSeat（被杀伤的目标）等字段
if(g.pending && g.pending.type==='lieRenChoose'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive){
    g.pending = null;
    g.phase = 'play';
  }
}

// 祝融【烈刃】:拼点响应阶段
// pending 应包含 type、sourceSeat、targetSeat、sourceCard（祝融的拼点牌）等字段
if(g.pending && g.pending.type==='lieRenRespond'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
     !d.sourceCard || typeof d.sourceCard.rank!=='number'){
    g.pending = null;
    g.phase = 'play';
  }
}
```

在 `startTurn` 函数中无需添加重置项（巨象和烈刃都不限次数）

---

## 四、技能实现

### 巨象实现

**集成点**：`aoeAdvance` 函数（南蛮入侵结算）和 `finishAoeTrick` 函数（锦囊最终结算）

```javascript
// 在 aoeAdvance 函数中添加巨象效果①：跳过祝融
function aoeAdvance(g) {
  tx(g => {
    const aoe = g.aoe;
    if (!aoe || !aoe.trick) return g;

    // 巨象效果①：南蛮入侵对祝融无效
    if (aoe.trick === '南蛮入侵') {
      const next = nextAlive(g, aoe.from, 1);
      if (next !== null) {
        // 检查所有祝融角色
        const zhurongSeats = [];
        for (let i = 0; i < g.players.length; i++) {
          if (g.players[i] && g.players[i].alive && hasCap(g.players[i], 'juxiang')) {
            zhurongSeats.push(i);
          }
        }
        
        if (zhurongSeats.includes(next)) {
          g.log = pushLog(g.log, `${g.players[next].name}【巨象】发动,南蛮入侵对其无效`);
          // 跳过祝融，继续寻找下一个目标
          const nextNext = nextAlive(g, next, 1);
          if (nextNext !== null) {
            aoe.to = nextNext;
            aoe.stage = 'wait';
            return g;
          } else {
            // 没有更多目标，进入结算阶段
            aoe.to = null;
            aoe.stage = 'finish';
            return g;
          }
        }
      }
    }

    // ... 现有代码 ...
    return g;
  });
}
```

```javascript
// 在 finishAoeTrick 或类似最终结算函数中添加巨象效果②：获得南蛮入侵牌
function finishAoeTrick(g) {
  tx(g => {
    if (!g.aoe || g.aoe.trick !== '南蛮入侵') return g;

    // 巨象效果②：其他角色使用南蛮入侵结算后，所有祝融获得该锦囊牌
    const zhurongSeats = [];
    for (let i = 0; i < g.players.length; i++) {
      if (g.players[i] && g.players[i].alive && hasCap(g.players[i], 'juxiang')) {
        zhurongSeats.push(i);
      }
    }

    if (zhurongSeats.length > 0 && g.aoe.from !== null && g.players[g.aoe.from]) {
      // 只有其他角色使用的南蛮入侵才会触发
      const isFromZhurong = hasCap(g.players[g.aoe.from], 'juxiang');
      
      if (!isFromZhurong) {
        // 寻找南蛮入侵牌（在弃牌堆中或最后使用的锦囊记录中）
        const nanmanCard = g.discard.find(card => card && card.name === '南蛮入侵');
        
        if (nanmanCard) {
          // 为每个祝融都获得一张南蛮入侵牌
          for (const seat of zhurongSeats) {
            const zhurong = g.players[seat];
            if (zhurong && zhurong.alive) {
              if (!zhurong.hand) zhurong.hand = [];
              zhurong.hand.push(nanmanCard);
              g.log = pushLog(g.log, `${zhurong.name}【巨象】发动,获得了【南蛮入侵】`);
            }
          }
          // 从弃牌堆中移除该南蛮入侵牌
          const index = g.discard.findIndex(card => card && card.name === '南蛮入侵');
          if (index !== -1) {
            g.discard.splice(index, 1);
          }
        }
      }
    }

    // 清理 aoe 状态
    g.aoe = null;
    g.phase = g.turn === mySeat ? 'play' : 'wait';
    
    return g;
  });
}
```

### 烈刃实现

**集成点**：`resolveDamageEffect` 或 `resolveShaUse` 函数（伤害结算后）

```javascript
// 在 resolveShaUse 或类似伤害结算函数中添加烈刃触发检查
function resolveShaUse(g, sha, sourceSeat, targetSeat, shaInfo) {
  tx(g => {
    const source = g.players[sourceSeat];
    const target = g.players[targetSeat];
    
    if (!source || !source.alive || !target || !target.alive) return g;

    // 检查是否有烈刃技能
    if (hasCap(source, 'lieRen')) {
      // 进入烈刃选择阶段
      g.pending = {
        type: 'lieRenChoose',
        sourceSeat: sourceSeat,
        targetSeat: targetSeat
      };
      g.phase = 'lieRenChoose';
      g.log = pushLog(g.log, `${source.name} 可以发动【烈刃】,与 ${target.name} 拼点`);
    }
    
    return g;
  });
}
```

```javascript
// 烈刃选择拼点函数
function triggerLieRen() {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'lieRenChoose' || pending.sourceSeat !== mySeat) return g;
    
    const me = g.players[mySeat];
    const target = g.players[pending.targetSeat];
    
    if (!me || !me.alive || !target || !target.alive) return g;

    // 选择一张手牌用于拼点
    g.pending = {
      type: 'lieRenPickCard',
      sourceSeat: mySeat,
      targetSeat: pending.targetSeat
    };
    g.phase = 'lieRenPickCard';
    g.log = pushLog(g.log, `${me.name} 发动【烈刃】,请选择一张手牌用于拼点`);
    markSkillSound(g, '烈刃');
    
    return g;
  });
}

// 烈刃选择拼点牌
function pickLieRenCard(cardIndex) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'lieRenPickCard' || pending.sourceSeat !== mySeat) return g;
    
    const me = g.players[mySeat];
    const target = g.players[pending.targetSeat];
    
    if (!me || !me.alive || !target || !target.alive) return g;
    if (!me.hand || cardIndex < 0 || cardIndex >= me.hand.length) return g;
    
    const card = me.hand[cardIndex];
    if (!card) return g;
    
    // 进入目标选择拼点阶段（等待目标选择拼点牌）
    g.pending = {
      type: 'lieRenRespond',
      sourceSeat: mySeat,
      targetSeat: pending.targetSeat,
      sourceCard: card
    };
    g.phase = 'lieRenRespond';
    g.log = pushLog(g.log, `${me.name} 选择了拼点牌,等待 ${target.name} 选择拼点牌`);
    
    return g;
  });
}

// 烈刃目标响应拼点
function respondLieRen(cardIndex) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'lieRenRespond' || pending.targetSeat !== mySeat) return g;
    
    const source = g.players[pending.sourceSeat];
    const target = g.players[mySeat];
    
    if (!source || !source.alive || !target || !target.alive) return g;
    if (!target.hand || cardIndex < 0 || cardIndex >= target.hand.length) return g;
    
    const targetCard = target.hand[cardIndex];
    if (!targetCard) return g;
    
    const sourceCard = pending.sourceCard;
    
    // 判断拼点结果：点数大的赢
    const sourceRank = sourceCard.rank;
    const targetRank = targetCard.rank;
    const lieRenWin = sourceRank > targetRank;
    
    // 移除双方的拼点牌
    const sourceCardIndex = source.hand.findIndex(c => c === sourceCard);
    if (sourceCardIndex !== -1) {
      source.hand.splice(sourceCardIndex, 1);
    }
    
    const targetCardIndex = target.hand.findIndex(c => c === targetCard);
    if (targetCardIndex !== -1) {
      target.hand.splice(targetCardIndex, 1);
    }
    
    // 将拼点牌置入弃牌堆
    g.discard.push(sourceCard, targetCard);
    
    const pointText = (c) => c.suit + getRankText(c.rank);
    g.log = pushLog(g.log, `${source.name} 出 ${pointText(sourceCard)}, ${target.name} 出 ${pointText(targetCard)},拼点${lieRenWin ? source.name + '赢' : source.name + '没赢'}`);
    
    if (lieRenWin) {
      // 祝融赢，从目标处获得一张牌
      const targetCards = [];
      // 收集目标的手牌
      if (target.hand && target.hand.length > 0) {
        targetCards.push(...target.hand);
      }
      // 收集目标的装备牌
      if (target.equips) {
        for (const slot of Object.keys(target.equips)) {
          if (target.equips[slot]) {
            targetCards.push(target.equips[slot]);
          }
        }
      }
      
      if (targetCards.length > 0) {
        // 随机选择一张牌
        const randomIndex = Math.floor(Math.random() * targetCards.length);
        const cardToGain = targetCards[randomIndex];
        
        // 从目标处移除该牌
        let cardFound = false;
        
        // 先尝试从手牌中移除
        if (target.hand) {
          const handIndex = target.hand.findIndex(c => c === cardToGain);
          if (handIndex !== -1) {
            target.hand.splice(handIndex, 1);
            cardFound = true;
          }
        }
        
        // 再尝试从装备区中移除
        if (!cardFound && target.equips) {
          for (const slot of Object.keys(target.equips)) {
            if (target.equips[slot] === cardToGain) {
              target.equips[slot] = null;
              cardFound = true;
              break;
            }
          }
        }
        
        if (cardFound) {
          // 祝融获得该牌
          if (!source.hand) source.hand = [];
          source.hand.push(cardToGain);
          g.log = pushLog(g.log, `${source.name} 【烈刃】拼点赢,获得 ${target.name} 的一张牌【${cardToGain.name}】`);
        }
      } else {
        g.log = pushLog(g.log, `${source.name} 【烈刃】拼点赢,但 ${target.name} 没有牌`);
      }
    } else {
      g.log = pushLog(g.log, `${source.name} 【烈刃】拼点没赢`);
    }
    
    // 清理状态
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}

// 取消烈刃
function cancelLieRen() {
  tx(g => {
    if (g.pending && (g.pending.type === 'lieRenChoose' || g.pending.type === 'lieRenPickCard') &&
        g.pending.sourceSeat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【烈刃】`);
    }
    return g;
  });
}
```

### 辅助函数

```javascript
// 获取点数的文本表示
function getRankText(rank) {
  const rankMap = {1: 'A', 11: 'J', 12: 'Q', 13: 'K'};
  return rankMap[rank] || rank;
}

// 检查是否有指定技能
function hasCap(player, cap) {
  if (!player || !player.caps) return false;
  return player.caps[cap] === true;
}
```

---

## 五、渲染集成（render-controls.js）

### 巨象 UI 集成

巨象作为锁定技，无需玩家操作，无UI界面。只需要在日志中显示相关信息即可。

### 烈刃 UI 集成

```javascript
// 在 renderControls 中添加烈刃相关状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 烈刃：伤害结算后的触发选择
  if (g.pending && g.pending.type === 'lieRenChoose' && g.pending.sourceSeat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【烈刃】发动</h4>
        <p>你使用【杀】对 ${g.players[g.pending.targetSeat].name} 造成了伤害</p>
        <p>可以与其拼点，若你赢，你获得其一张牌</p>
        <button onclick="triggerLieRen()" class="skill-btn" style="background: #e74c3c;">
          发动烈刃
        </button>
        <button onclick="cancelLieRen()" class="cancel-btn">
          不发动
        </button>
      </div>
    `;
    return;
  }

  // 烈刃：选择拼点牌
  if (g.pending && g.pending.type === 'lieRenPickCard' && g.pending.sourceSeat === seat) {
    const hand = p.hand || [];
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【烈刃】选择拼点牌</h4>
        <p>请选择一张手牌用于拼点</p>
        <div class="hand-options">
    `;
    
    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      if (card) {
        ui.innerHTML += `
          <button onclick="pickLieRenCard(${i})" class="card-btn">
            【${card.name}】${card.suit}${getRankText(card.rank)}
          </button>
        `;
      }
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelLieRen()" class="cancel-btn">取消</button>
      </div>
    `;
    return;
  }

  // 烈刃：目标响应拼点（被烈刃的玩家）
  if (g.pending && g.pending.type === 'lieRenRespond' && g.pending.targetSeat === seat) {
    const hand = p.hand || [];
    const source = g.players[g.pending.sourceSeat];
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【烈刃】拼点响应</h4>
        <p>${source ? source.name : '祝融'} 对你发动【烈刃】,请选择一张手牌拼点</p>
        <div class="hand-options">
    `;
    
    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      if (card) {
        ui.innerHTML += `
          <button onclick="respondLieRen(${i})" class="card-btn">
            【${card.name}】${card.suit}${getRankText(card.rank)}
          </button>
        `;
      }
    }
    
    ui.innerHTML += `
        </div>
      </div>
    `;
    return;
  }
}

// 在 setBanner 中添加烈刃等待状态
function setBanner(text, noLog) {
  // ... 现有代码 ...
  
  // 烈刃特殊状态
  if (g.pending && g.pending.type === 'lieRenRespond' && g.pending.sourceSeat !== mySeat && g.pending.targetSeat !== mySeat) {
    const source = g.players[g.pending.sourceSeat];
    const target = g.players[g.pending.targetSeat];
    if (source && target) {
      text = `${source.name} 对 ${target.name} 发动【烈刃】,等待 ${target.name} 选择拼点牌…`;
    }
  }
  
  // ... 现有代码 ...
}
```

---

## 六、音效标识

在 `markSkillSound` 中添加：
```javascript
const SKILL_SOUNDS = {
  // ... 现有技能 ...
  '巨象': 'juxiang',
  '烈刃': 'lieRen',
};
```

---

## 七、边界条件处理

### 巨象

1. **多个祝融同时在场**：每个祝融都独立享有巨象效果，都会跳过南蛮入侵的结算，并且都会在结算后获得南蛮入侵牌
2. **祝融自己使用南蛮入侵**：巨象效果①仍然生效（自己对自己无效），效果②不触发（自己使用的不获得）
3. **南蛮入侵在弃牌堆中不存在**：若弃牌堆中没有南蛮入侵牌（可能被其他效果移除），则不获得牌
4. **南蛮入侵结算中途中断**：若南蛮入侵结算因某种原因中断，巨象效果②在最终结算时仍然生效
5. **多个南蛮入侵同时结算**：理论上不可能（南蛮入侵为单次完整结算流程），若存在异常情况则每个南蛮入侵都独立触发巨象效果

### 烈刃

1. **目标无手牌且无装备牌**：拼点赢后提示目标没有牌可获得
2. **拼点过程中角色死亡**：
   - 如果发动者死亡：拼点中断，清理状态
   - 如果目标死亡：拼点中断，清理状态
3. **目标装备区中的牌**：烈刃获得的装备牌置入手牌（不是装备区）
4. **非目标角色的牌**：只能从当前被杀伤的目标角色获得牌，不能从其他角色获得
5. **拼点相同点数**：按规则，点数相同算作没赢（不算赢也不算输，直接无效果）
6. **多次触发**：每次使用杀造成伤害后都可以独立触发烈刃，无次数限制
7. **连环状态下的伤害**：若目标处于连环状态，烈刃仍然可以触发，但可能涉及多个目标

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **巨象** |
| 巨象：其他角色使用南蛮入侵 | 祝融被跳过，不受南蛮入侵影响 |
| 巨象：其他角色使用南蛮入侵结算后 | 祝融获得该南蛮入侵牌 |
| 巨象：祝融自己使用南蛮入侵 | 祝融自己被跳过（无效），但不获得牌 |
| 巨象：多个祝融同时在场，其他角色使用南蛮入侵 | 所有祝融都被跳过，所有祝融都获得南蛮入侵牌 |
| 巨象：南蛮入侵弃牌堆中不存在该牌 | 祝融不获得牌 |
| **烈刃** |
| 烈刃：使用杀造成伤害，目标有手牌 | 可以发动烈刃，拼点赢后获得目标一张手牌 |
| 烈刃：使用杀造成伤害，目标有装备牌 | 可以发动烈刃，拼点赢后获得目标一张装备牌 |
| 烈刃：使用杀造成伤害，目标无手牌且无装备 | 可以发动烈刃，但拼点赢后提示目标没有牌 |
| 烈刃：使用杀但未造成伤害（被闪抵消） | 不触发烈刃 |
| 烈刃：拼点赢，目标有多张牌 | 随机获得其中一张 |
| 烈刃：拼点输 | 无任何效果 |
| 烈刃：拼点过程中发动者死亡 | 拼点中断，清理状态 |
| 烈刃：拼点过程中目标死亡 | 拼点中断，清理状态 |
| 烈刃：多次使用杀造成伤害 | 每次都可以独立触发烈刃 |
| **组合测试** |
| 巨象+烈刃：同时发动两个技能 | 两个技能独立生效，不互相干扰 |
| 连环状态+烈刃：对连环目标使用杀造成伤害 | 烈刃正常触发，可以从连环目标获得牌 |

---

## 九、实现优先级

1. **巨象优先**：锁定技，需要集成到南蛮入侵的结算流程中，是核心特性
2. **巨象效果①优先**：跳过祝融的逻辑相对简单，先实现
3. **巨象效果②优先**：获得南蛮入侵牌的逻辑需要处理弃牌堆的牌
4. **烈刃优先**：需要集成到伤害结算流程中，涉及拼点机制
5. **拼点机制优先**：复用现有的拼点系统，确保与其他拼点技能不冲突
6. **UI集成优先**：烈刃的选择界面和拼点响应界面
7. **边界处理优先**：无牌、角色死亡等特殊情况
8. **音效集成**：添加技能音效

---

## 十、集成要点

### 与现有系统的集成

1. **南蛮入侵系统**：
   - 复用现有的 `aoeAdvance` 函数和南蛮入侵的效果处理
   - 在 `aoeAdvance` 中添加巨象的跳过逻辑
   - 在 `finishAoeTrick` 中添加巨象的获得牌逻辑

2. **伤害结算系统**：
   - 复用现有的 `resolveShaUse` 或 `resolveDamageEffect` 函数
   - 在伤害结算后添加烈刃的触发检查

3. **拼点系统**：
   - 复用荀彧【驱虎】和太史慈【天义】的拼点机制
   - 确保拼点信息不提前泄露

4. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程
   - 在 `normalize` 中初始化状态字段防御

5. **日志系统**：
   - 为巨象和烈刃的发动添加对应的日志记录
   - 确保日志清晰地反映技能的发动和效果

### 需要修改的文件

1. **data.js**：
   - 添加祝融武将定义

2. **game.js**：
   - `normalize()`：添加巨象和烈刃的状态字段防御
   - `aoeAdvance()`：集成巨象效果①（跳过祝融）
   - `finishAoeTrick()`：集成巨象效果②（获得南蛮入侵牌）
   - `resolveShaUse()` 或伤害结算函数：添加烈刃触发检查

3. **skills.js**：
   - 添加烈刃技能辅助函数（`triggerLieRen`, `pickLieRenCard`, `respondLieRen`, `cancelLieRen`）

4. **render-controls.js**：
   - 添加烈刃的UI界面
   - 添加技能按钮和交互逻辑

5. **render.js**：
   - 可能需要添加状态显示

---

## 十一、流程图

### 巨象完整流程

#### 效果①：南蛮入侵无效
```
其他角色使用南蛮入侵
    ↓
南蛮入侵进入结算阶段（aoeAdvance）
    ↓
检查当前目标是否为祝融
    ↓
是：日志提示【巨象】发动
    ↓
跳过祝融，继续寻找下一个目标
    ↓
无：正常结算南蛮入侵对当前目标的效果
```

#### 效果②：获得南蛮入侵牌
```
其他角色使用南蛮入侵
    ↓
南蛮入侵完成所有目标结算（finishAoeTrick）
    ↓
检查是否为南蛮入侵且使用者不是祝融
    ↓
是：寻找场上所有祝融
    ↓
是：在弃牌堆中找到南蛮入侵牌
    ↓
是：每个祝融获得一张南蛮入侵牌
    ↓
是：从弃牌堆中移除该南蛮入侵牌
```

### 烈刃完整流程
```
祝融使用【杀】对目标造成伤害
    ↓
伤害结算完成
    ↓
检查是否有烈刃技能
    ↓
是：进入烈刃选择阶段
    ↓
玩家选择是否发动
    ↓
发动：选择一张手牌用于拼点
    ↓
等待目标选择拼点牌
    ↓
双方出牌，判断拼点结果
    ↓
祝融赢：随机获得目标一张牌（手牌或装备）
    ↓
祝融输：无任何效果
    ↓
清理状态，回到出牌阶段
```

---

## 十二、特殊说明

### 关于巨象的锁定技性质

巨象是**锁定技**，这意味着：
- 无法被无效（除非有特定的技能可以无效锁定技）
- 不能选择不发动，必然生效
- 效果①在南蛮入侵结算时自动生效，无需玩家操作
- 效果②在南蛮入侵最终结算时自动生效，无需玩家操作

**注意**：巨象的两个效果是独立的，效果①是"无效"，效果②是"获得牌"。两个效果都只对南蛮入侵生效，对其他锦囊牌无效。

### 关于巨象的触发条件

1. **效果①**：对**所有**南蛮入侵都生效，包括其他角色使用的和祝融自己使用的
2. **效果②**：只对**其他角色使用的**南蛮入侵生效，祝融自己使用的南蛮入侵不会触发
3. **触发时机**：效果①在每个目标结算时生效，效果②在整个南蛮入侵结算完成后生效

### 关于烈刃的拼点机制

烈刃的拼点机制与荀彧【驱虎】、太史慈【天义】使用相同的拼点规则：
- 使用点数比较，数值大的赢
- 点数相同算作没赢
- 拼点牌从手牌中选择
- 拼点结果公开，双方牌面都会在日志中显示

**特别之处**：
- 烈刃的拼点**必须**由祝融发动，目标必须响应
- 若目标拒绝或无法响应（如无手牌），则烈刃不生效
- 烈刃的拼点赢后，从目标处**随机**获得一张牌

### 关于烈刃的牌获得机制

烈刃拼点赢后获得的牌：
1. 优先从目标的**手牌**中随机选择
2. 若目标无手牌，则从**装备区**中随机选择一张装备牌
3. 获得的牌**置入祝融的手牌**（不是装备区）
4. 若目标既无手牌也无装备牌，则提示目标没有牌

### 关于与其他技能的协同

1. **武器技能**：使用不同的武器会影响祝融的攻击范围，从而影响杀的使用
2. **马匹技能**：坐骑会影响祝融的距离计算
3. **防护技能**：目标的防具或技能会正常生效，烈刃的拼点不影响这些防护机制
4. **其他拼点技能**：烈刃的拼点机制与其他拼点技能独立，可以同时存在
5. **连环状态**：若目标处于连环状态，烈刃仍然可以正常触发

---

## 十三、修正记录

*文档状态：设计阶段*
*创建时间：2026-07-12*
*负责人：Mistral Vibe*

### 待实装项

- [ ] **data.js**: 添加祝融武将定义
- [ ] **game.js**: 
  - [ ] normalize函数：添加巨象和烈刃状态字段防御
  - [ ] aoeAdvance函数：集成巨象效果①（跳过祝融）
  - [ ] finishAoeTrick函数：集成巨象效果②（获得南蛮入侵牌）
  - [ ] resolveShaUse函数：添加烈刃触发检查
- [ ] **skills.js**: 
  - [ ] 添加烈刃技能辅助函数
- [ ] **render-controls.js**: 
  - [ ] 添加烈刃UI界面
- [ ] **render.js**: 添加状态显示（如需要）

### 待优化项

- 音效文件：需要添加assets/audio/juxiang.mp3和assets/audio/lieRen.mp3
- UI/UX：烈刃拼点选择界面的用户体验优化
- 性能：牌选择时的性能优化
- 兼容性：确保与现有所有技能的兼容性

---

## 十四、参考实现

### 与孟获【祸首】的对比

孟获的祸首技能也与南蛮入侵相关：
- 祸首：锁定技，①南蛮入侵对孟获无效；②其他角色使用南蛮入侵结算时，孟获成为伤害来源

祝融的巨象与祸首类似但有区别：
- 巨象：①南蛮入侵对祝融无效；②其他角色使用南蛮入侵结算**结束后置入弃牌堆时**，祝融**获得之**

两者的共同点：
- 都是锁定技
- 都使南蛮入侵对自己无效
- 都需要在aoeAdvance中跳过自己

不同点：
- 祸首改变伤害来源，巨象获得锦囊牌
- 祸首在结算过程中生效，巨象在结算结束后生效

### 与太史慈【天义】的对比

太史慈的天义技能也使用拼点机制：
- 天义：出牌阶段限一次，可以与一名角色拼点，然后本阶段内改变杀的使用规则

祝融的烈刃与天义的异同：
- 相同点：都使用拼点机制，点数大的赢
- 不同点：
  - 天义是出牌阶段主动发动，烈刃是伤害结算后触发
  - 天义改变杀的使用规则，烈刃获得目标的一张牌
  - 天义限每回合一次，烈刃无次数限制
  - 天义需要选择拼点目标，烈刃的目标是造成伤害的目标

烈刃的拼点机制可以复用天义的部分实现逻辑。
