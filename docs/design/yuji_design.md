# 于吉 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `yuji` |
| **武将名称** | 于吉 |
| **势力** | 群 |
| **性别** | male |
| **体力上限** | 3 |
| **技能** | 蛊惑 |

---

## 二、技能说明

### 蛊惑
**时机**：出牌阶段

**效果**：
1. 你可以扣置一张手牌（将手牌扣置于武将牌上），将此牌当任意一张**基本牌**或**普通锦囊牌**使用或打出
2. 若有其他角色**质疑**则翻开此牌且此牌作废
3. 质疑结果：
   - 若为**假**（即被质疑的牌不是其声称的牌）：质疑者各摸一张牌
   - 若为**真**（即被质疑的牌是其声称的牌）：质疑者各失去1点体力
4. 若被质疑的牌的**花色为♥红桃**，此牌**依旧进行结算**（即使被质疑为真，仍然生效）

**设计要点**：
- 属于**视为使用**技能，需要集成到出牌阶段的牌选择流程中
- 需要选择一张手牌**扣置**（暂时隐藏，不展示给其他玩家）
- 扣置的牌可以声称为**任意基本牌**（杀、闪、桃）或**普通锦囊牌**（过河拆桥、顺手牵羊、无中生有、决斗、借刀杀人、无懈可击、五谷丰登、桃园结义等）
- 其他角色可以选择**质疑**或**不质疑**
- 质疑后翻开牌，根据真假决定后续效果
- 如果被质疑的牌是红桃花色且为真，牌仍然生效（结算声称的牌的效果）
- 质疑者可以是多个角色（所有其他存活角色都可以选择是否质疑）
- 如果多个角色质疑，所有质疑者都承担相应的后果（真：都失去1点体力；假：都各摸一张牌）

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
yuji: {
  id: 'yuji',
  name: '于吉',
  gender: 'male',
  maxHp: 3,
  skill: '蛊惑',
  desc: '蛊惑:出牌阶段,你可以扣置一张手牌,将此牌当任意一张基本牌或普通锦囊牌使用或打出。若有其他角色质疑则翻开此牌且此牌作废,若为:假,质疑者各摸一张牌;真,质疑者各失去1点体力,然后若被质疑的牌的花色为♥,此牌依旧进行结算。',
  caps: { guhuo: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 于吉【蛊惑】:选择扣置牌阶段
// pending 应包含 type、sourceSeat（于吉的座位）、availableCards（可选的手牌索引列表）
if(g.pending && g.pending.type==='guhuoChooseCard'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     !Array.isArray(d.availableCards) || d.availableCards.length===0 ||
     d.sourceSeat !== mySeat){
    g.pending = null;
    g.phase = 'play';
  }
}

// 于吉【蛊惑】:声称牌阶段
// pending 应包含 type、sourceSeat、chosenCardIndex（选择的牌索引）
if(g.pending && g.pending.type==='guhuoClaim'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.chosenCardIndex!=='number' ||
     d.sourceSeat !== mySeat){
    g.pending = null;
    g.phase = 'play';
  }
}

// 于吉【蛊惑】:其他角色质疑阶段
// pending 应包含 type、sourceSeat、chosenCardIndex、claimedCard（声称的牌）、questioners（已质疑的座位列表）
if(g.pending && g.pending.type==='guhuoQuestion'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.chosenCardIndex!=='number' ||
     !d.claimedCard || typeof d.claimedCard.name!=='string' ||
     !Array.isArray(d.questioners)){
    g.pending = null;
    g.phase = 'play';
  }
}

// 于吉【蛊惑】:质疑结果处理阶段
// pending 应包含 type、sourceSeat、chosenCardIndex、claimedCard、actualCard（实际牌）、isTrue（是否为真）、questioners
if(g.pending && g.pending.type==='guhuoResolve'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.chosenCardIndex!=='number' ||
     !d.claimedCard || typeof d.claimedCard.name!=='string' ||
     !d.actualCard ||
     typeof d.isTrue!=='boolean' ||
     !Array.isArray(d.questioners)){
    g.pending = null;
    g.phase = 'play';
  }
}
```

在 `startTurn` 函数中无需添加重置项（蛊惑不限次数）

---

## 四、技能实现

### 蛊惑实现

**UI触发点**：`render-controls.js` 添加蛊惑按钮

```javascript
// 在 renderControls 中添加蛊惑选择逻辑
function renderControls(g, me) {
  // ... 现有代码 ...

  if (hasCap(me, 'guhuo') && g.phase === 'play' && g.turn === mySeat) {
    // 检查是否有手牌可以扣置
    const hand = me.hand || [];
    if (hand.length > 0) {
      ui.innerHTML += `
        <button onclick="startGuhuo()" class="skill-btn" style="background: #8e44ad;">
          蛊惑
        </button>
      `;
    }
  }
}
```

```javascript
// 蛊惑选择流程
function startGuhuo() {
  tx(g => {
    const me = g.players[mySeat];
    if (!me || !me.alive || g.phase !== 'play' || g.turn !== mySeat) return g;
    
    const hand = me.hand || [];
    if (hand.length === 0) {
      g.log = pushLog(g.log, `${me.name} 发动【蛊惑】失败:无手牌可扣置`);
      return g;
    }
    
    // 所有手牌都可以选择扣置
    const availableCards = Array.from({length: hand.length}, (_, i) => i);
    
    // 进入蛊惑选择牌阶段
    g.pending = {
      type: 'guhuoChooseCard',
      sourceSeat: mySeat,
      availableCards: availableCards
    };
    g.phase = 'guhuoChooseCard';
    g.log = pushLog(g.log, `${me.name} 发动【蛊惑】,选择一张手牌扣置`);
    markSkillSound(g, '蛊惑');
    
    return g;
  });
}
```

```javascript
// 选择扣置的牌
function pickGuhuoCard(cardIndex) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'guhuoChooseCard' || pending.sourceSeat !== mySeat) return g;
    
    if (!pending.availableCards.includes(cardIndex)) return g;
    
    const me = g.players[mySeat];
    const hand = me.hand || [];
    
    if (cardIndex < 0 || cardIndex >= hand.length) return g;
    
    const chosenCard = hand[cardIndex];
    if (!chosenCard) return g;
    
    // 进入声称牌类型阶段
    g.pending = {
      type: 'guhuoClaim',
      sourceSeat: mySeat,
      chosenCardIndex: cardIndex
    };
    g.phase = 'guhuoClaim';
    g.log = pushLog(g.log, `${me.name} 选择了【${chosenCard.name}】,声称其为何种牌?`);
    
    return g;
  });
}
```

```javascript
// 声称牌的类型
function claimGuhuoCard(cardName) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'guhuoClaim' || pending.sourceSeat !== mySeat) return g;
    
    const me = g.players[mySeat];
    const hand = me.hand || [];
    const cardIndex = pending.chosenCardIndex;
    
    if (cardIndex < 0 || cardIndex >= hand.length) return g;
    
    const actualCard = hand[cardIndex];
    if (!actualCard) return g;
    
    // 验证声称的牌是否为有效的基本牌或普通锦囊牌
    const validCards = [...BASIC_CARDS, '过河拆桥', '顺手牵羊', '无中生有', '决斗', '借刀杀人', '无懈可击', '五谷丰登', '桃园结义'];
    
    if (!validCards.includes(cardName)) {
      g.log = pushLog(g.log, `${me.name} 声称的牌类型无效`);
      return g;
    }
    
    // 进入其他角色质疑阶段
    const otherSeats = [];
    for (let i = 0; i < g.players.length; i++) {
      if (i !== mySeat && g.players[i] && g.players[i].alive) {
        otherSeats.push(i);
      }
    }
    
    g.pending = {
      type: 'guhuoQuestion',
      sourceSeat: mySeat,
      chosenCardIndex: cardIndex,
      claimedCard: { name: cardName },
      questioners: []
    };
    g.phase = 'guhuoQuestion';
    g.log = pushLog(g.log, `${me.name} 声称【${actualCard.name}】为【${cardName}】,其他角色可以选择是否质疑`);
    
    return g;
  });
}
```

```javascript
// 其他角色选择是否质疑
function questionGuhuo(doQuestion) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'guhuoQuestion') return g;
    
    const me = g.players[mySeat];
    if (!me || !me.alive) return g;
    
    // 只有非于吉的角色可以质疑
    if (mySeat === pending.sourceSeat) return g;
    
    // 已经质疑过的角色不能再次质疑
    if (pending.questioners.includes(mySeat)) return g;
    
    if (doQuestion) {
      // 添加到质疑者列表
      pending.questioners.push(mySeat);
      g.log = pushLog(g.log, `${me.name} 发动质疑`);
    } else {
      g.log = pushLog(g.log, `${me.name} 选择不质疑`);
    }
    
    // 检查是否所有其他角色都已做出选择
    const allOthersResponded = [];
    for (let i = 0; i < g.players.length; i++) {
      if (i !== pending.sourceSeat && g.players[i] && g.players[i].alive) {
        if (!pending.questioners.includes(i)) {
          // 该角色还未做出选择（选择不质疑也算做出选择）
          // 我们需要追踪每个角色的选择状态
          return g;
        }
      }
    }
    
    // 如果有质疑者，进入翻开牌并处理结果阶段
    if (pending.questioners.length > 0) {
      return resolveGuhuoQuestion(g);
    } else {
      // 无人质疑，直接进行结算
      return executeGuhuoWithoutQuestion(g);
    }
  });
}
```

```javascript
// 处理质疑结果
function resolveGuhuoQuestion(g) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'guhuoQuestion') return g;
    
    const sourceSeat = pending.sourceSeat;
    const me = g.players[sourceSeat];
    if (!me || !me.alive) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    const hand = me.hand || [];
    const cardIndex = pending.chosenCardIndex;
    const claimedCard = pending.claimedCard;
    const questioners = pending.questioners;
    
    if (cardIndex < 0 || cardIndex >= hand.length) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    const actualCard = hand[cardIndex];
    if (!actualCard) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 判断是否为真（实际牌的名称是否等于声称的牌）
    const isTrue = actualCard.name === claimedCard.name;
    
    // 移除扣置的牌
    hand.splice(cardIndex, 1);
    
    // 翻开牌并处理结果
    if (isTrue) {
      // 为真：质疑者各失去1点体力
      for (const qSeat of questioners) {
        const qPlayer = g.players[qSeat];
        if (qPlayer && qPlayer.alive) {
          dealDamage(g, qSeat, 1, sourceSeat, `${me.name} 的【蛊惑】效果(真)`);
        }
      }
      
      g.log = pushLog(g.log, `${me.name} 的扣置牌为【${actualCard.name}】,与声称的【${claimedCard.name}】一致,质疑者各失去1点体力`);
      
      // 若被质疑的牌的花色为♥,此牌依旧进行结算
      if (actualCard.suit === '♥') {
        // 移除actualCard（已经从手牌中移除）
        // 执行声称牌的效果
        g.pending = {
          type: 'guhuoResolve',
          sourceSeat: sourceSeat,
          chosenCardIndex: cardIndex,
          claimedCard: claimedCard,
          actualCard: actualCard,
          isTrue: true,
          questioners: questioners,
          shouldResolve: true
        };
        g.phase = 'guhuoResolve';
        g.log = pushLog(g.log, `由于牌的花色为♥红桃,【${claimedCard.name}】仍然进行结算`);
        return g;
      } else {
        // 不进行结算
        g.log = pushLog(g.log, `牌的花色为${actualCard.suit},不进行结算`);
        g.pending = null;
        g.phase = 'play';
        g.discard.push(actualCard);
        return g;
      }
    } else {
      // 为假：质疑者各摸一张牌
      for (const qSeat of questioners) {
        drawN(g, qSeat, 1);
      }
      
      g.log = pushLog(g.log, `${me.name} 的扣置牌为【${actualCard.name}】,与声称的【${claimedCard.name}】不一致,质疑者各摸一张牌`);
      
      // 作废
      g.pending = null;
      g.phase = 'play';
      g.discard.push(actualCard);
      return g;
    }
  });
}
```

```javascript
// 无人质疑时直接进行结算
function executeGuhuoWithoutQuestion(g) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'guhuoQuestion') return g;
    
    const sourceSeat = pending.sourceSeat;
    const me = g.players[sourceSeat];
    if (!me || !me.alive) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    const hand = me.hand || [];
    const cardIndex = pending.chosenCardIndex;
    const claimedCard = pending.claimedCard;
    
    if (cardIndex < 0 || cardIndex >= hand.length) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    const actualCard = hand[cardIndex];
    if (!actualCard) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 移除扣置的牌
    hand.splice(cardIndex, 1);
    
    // 无人质疑，直接结算声称的牌
    g.log = pushLog(g.log, `${me.name} 的【蛊惑】无人质疑,【${actualCard.name}】当【${claimedCard.name}】使用`);
    
    // 执行声称牌的效果
    g.pending = {
      type: 'guhuoResolve',
      sourceSeat: sourceSeat,
      chosenCardIndex: cardIndex,
      claimedCard: claimedCard,
      actualCard: actualCard,
      isTrue: true,
      questioners: [],
      shouldResolve: true
    };
    g.phase = 'guhuoResolve';
    
    return g;
  });
}
```

```javascript
// 执行蛊惑的实际效果
function executeGuhuoEffect(g) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'guhuoResolve') return g;
    
    const sourceSeat = pending.sourceSeat;
    const me = g.players[sourceSeat];
    if (!me || !me.alive) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    const claimedCard = pending.claimedCard;
    const actualCard = pending.actualCard;
    
    if (!pending.shouldResolve) {
      g.pending = null;
      g.phase = 'play';
      g.discard.push(actualCard);
      return g;
    }
    
    // 根据声称的牌类型执行不同的效果
    const cardName = claimedCard.name;
    
    // 基本牌处理
    if (BASIC_CARDS.includes(cardName)) {
      // 视为使用/打出基本牌
      const cardPlay = CARD_PLAYS[cardName];
      if (cardPlay && cardPlay.effect) {
        // 构造一个虚拟牌
        const virtualCard = {
          id: actualCard.id,
          name: cardName,
          suit: actualCard.suit,
          rank: actualCard.rank
        };
        
        // 根据牌类型调用不同的使用逻辑
        if (cardName === '杀') {
          // 需要选择目标
          g.pending = {
            type: 'guhuoUseCard',
            sourceSeat: sourceSeat,
            card: virtualCard,
            resume: { type: 'guhuo' }
          };
          g.phase = 'guhuoUseCard';
          g.log = pushLog(g.log, `${me.name} 使用【${cardName}】,选择目标`);
          return g;
        } else if (cardName === '闪') {
          // 闪需要目标（响应某张牌）
          // 这里需要更复杂的处理，暂时标记为可使用
          g.log = pushLog(g.log, `${me.name} 使用【闪】`);
          // 将虚拟牌放入弃牌堆
          g.discard.push(virtualCard);
        } else if (cardName === '桃') {
          // 桃可以对自己或其他角色使用
          g.pending = {
            type: 'guhuoUseTao',
            sourceSeat: sourceSeat,
            card: virtualCard,
            resume: { type: 'guhuo' }
          };
          g.phase = 'guhuoUseTao';
          g.log = pushLog(g.log, `${me.name} 使用【桃】,选择目标`);
          return g;
        }
      }
    } else {
      // 普通锦囊牌处理
      const trickPlay = CARD_PLAYS[cardName];
      if (trickPlay && trickPlay.effect) {
        // 执行锦囊牌效果
        trickPlay.effect(g, me, claimedCard);
        
        // 将实际牌放入弃牌堆
        g.discard.push(actualCard);
      }
    }
    
    // 清理状态
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}
```

```javascript
// 取消蛊惑
function cancelGuhuo() {
  tx(g => {
    if (g.pending && (g.pending.type === 'guhuoChooseCard' || 
                      g.pending.type === 'guhuoClaim' ||
                      g.pending.type === 'guhuoQuestion') &&
        g.pending.sourceSeat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【蛊惑】`);
    }
    return g;
  });
}
```

---

## 五、渲染集成（render-controls.js）

### 蛊惑 UI 集成

```javascript
// 在 renderControls 中添加蛊惑选择状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 蛊惑：选择扣置牌阶段
  if (g.pending && g.pending.type === 'guhuoChooseCard' && g.pending.sourceSeat === seat) {
    const hand = p.hand || [];
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【蛊惑】发动</h4>
        <p>请选择一张手牌扣置</p>
        <div class="hand-options">
    `;
    
    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      if (card) {
        ui.innerHTML += `
          <button onclick="pickGuhuoCard(${i})" class="card-btn">
            选择【${card.name}】(${card.suit}${rankText(card.rank)})
          </button>
        `;
      }
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelGuhuo()" class="cancel-btn">
          取消
        </button>
      </div>
    `;
    return;
  }

  // 蛊惑：声称牌类型阶段
  if (g.pending && g.pending.type === 'guhuoClaim' && g.pending.sourceSeat === seat) {
    const basicCards = ['杀', '闪', '桃'];
    const trickCards = ['过河拆桥', '顺手牵羊', '无中生有', '决斗', '借刀杀人', '无懈可击', '五谷丰登', '桃园结义'];
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【蛊惑】声称牌</h4>
        <p>请选择要声称的牌类型</p>
        <h5>基本牌:</h5>
        <div class="card-type-options">
    `;
    
    for (const cardName of basicCards) {
      ui.innerHTML += `
        <button onclick="claimGuhuoCard('${cardName}')" class="card-type-btn">
          【${cardName}】
        </button>
      `;
    }
    
    ui.innerHTML += `
        </div>
        <h5>普通锦囊牌:</h5>
        <div class="card-type-options">
    `;
    
    for (const cardName of trickCards) {
      ui.innerHTML += `
        <button onclick="claimGuhuoCard('${cardName}')" class="card-type-btn">
          【${cardName}】
        </button>
      `;
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelGuhuo()" class="cancel-btn">
          取消
        </button>
      </div>
    `;
    return;
  }

  // 蛊惑：其他角色质疑阶段
  if (g.pending && g.pending.type === 'guhuoQuestion' && g.pending.sourceSeat !== seat) {
    const source = g.players[g.pending.sourceSeat];
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【蛊惑】质疑</h4>
        <p>${source.name} 发动【蛊惑】,声称扣置的牌为【${g.pending.claimedCard.name}】</p>
        <p>是否质疑?</p>
        <button onclick="questionGuhuo(true)" class="skill-btn" style="background: #e74c3c;">
          质疑
        </button>
        <button onclick="questionGuhuo(false)" class="cancel-btn">
          不质疑
        </button>
      </div>
    `;
    return;
  }

  // 蛊惑：使用牌选择目标阶段（示例：杀）
  if (g.pending && g.pending.type === 'guhuoUseCard' && g.pending.sourceSeat === seat) {
    const card = g.pending.card;
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【蛊惑】使用【${card.name}】</h4>
        <p>请选择目标</p>
        <div class="target-options">
    `;
    
    for (let i = 0; i < g.players.length; i++) {
      const target = g.players[i];
      if (target && target.alive && i !== seat && isInRange(g, seat, i)) {
        ui.innerHTML += `
          <button onclick="useGuhuoCardTo(${i})" class="target-btn">
            选择 ${target.name}
          </button>
        `;
      }
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelGuhuo()" class="cancel-btn">
          取消
        </button>
      </div>
    `;
    return;
  }

  // 蛊惑：使用桃选择目标阶段
  if (g.pending && g.pending.type === 'guhuoUseTao' && g.pending.sourceSeat === seat) {
    const card = g.pending.card;
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【蛊惑】使用【${card.name}】</h4>
        <p>请选择目标</p>
        <div class="target-options">
    `;
    
    for (let i = 0; i < g.players.length; i++) {
      const target = g.players[i];
      if (target && target.alive) {
        ui.innerHTML += `
          <button onclick="useGuhuoTaoTo(${i})" class="target-btn">
            选择 ${target.name}
          </button>
        `;
      }
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelGuhuo()" class="cancel-btn">
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
  '蛊惑': 'guhuo',
};
```

---

## 七、边界条件处理

### 蛊惑
1. **无手牌**：按钮不显示
2. **选择无效牌**：验证选择的牌索引是否在合法范围内
3. **声称无效牌类型**：验证声称的牌是否为基本牌或普通锦囊牌
4. **无其他存活角色**：若场上只有于吉一人存活，则无法被质疑，直接结算
5. **质疑阶段目标死亡**：在质疑前验证于吉是否仍然存活，如于吉死亡则取消技能
6. **牌的结算逻辑**：
   - 被质疑且为真时，若牌为红桃花色，仍然结算
   - 被质疑且为真时，若牌非红桃花色，不结算
   - 无人质疑时，无论花色如何，都进行结算
   - 被质疑且为假时，不结算，作废
7. **多个质疑者**：所有质疑者都承担相应的后果
8. **质疑者在结果处理前死亡**：在处理质疑结果时验证质疑者是否仍然存活
9. **目标选择**：某些牌（如杀）需要选择目标，确保目标选择合法
10. **牌的实际效果**：根据声称的牌类型执行对应的效果

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **蛊惑** |
| 蛊惑：出牌阶段，有手牌 | 可以发动蛊惑，选择一张手牌扣置 |
| 蛊惑：无手牌 | 蛊惑按钮不显示 |
| 蛊惑：声称为基本牌（杀） | 可以声称为杀，需要选择目标 |
| 蛊惑：声称为普通锦囊牌（过河拆桥） | 可以声称为过河拆桥，需要选择目标 |
| 蛊惑：其他角色质疑，为真且非红桃 | 质疑者各失去1点体力，牌不结算 |
| 蛊惑：其他角色质疑，为真且红桃 | 质疑者各失去1点体力，牌仍然结算 |
| 蛊惑：其他角色质疑，为假 | 质疑者各摸一张牌，牌作废 |
| 蛊惑：无人质疑 | 直接结算声称的牌效果 |
| 蛊惑：多个角色质疑 | 所有质疑者都承担后果 |
| 蛊惑：于吉在质疑阶段死亡 | 取消技能，不结算 |
| 蛊惑：质疑者在结果处理前死亡 | 跳过该质疑者的处理 |
| 蛊惑：声称无效牌类型 | 提示无效，返回上一步 |
| 边界：场上只有于吉一人 | 无人质疑，直接结算 |
| 边界：手牌数量为1 | 可以发动蛊惑 |

---

## 九、实现优先级

1. **蛊惑核心逻辑优先**：扣置牌、声称牌类型、质疑机制
2. **UI集成优先**：蛊惑的多阶段选择界面
3. **质疑处理优先**：其他角色的质疑选择和结果处理
4. **牌效果结算优先**：根据声称牌类型执行实际效果
5. **边界处理优先**：无目标、角色死亡等边界条件
6. **音效集成**：添加技能音效
7. **测试验证**：确保所有场景都通过测试

---

## 十、集成要点

### 与现有系统的集成

1. **牌使用系统**：
   - 复用现有的牌使用流程（useCard、respondCard等）
   - 视为使用的牌需要构造虚拟牌对象
   - 确保蛊惑视为的牌与真实牌具有相同的效果

2. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制复杂的多阶段流程
   - 使用 `g.pending` 存储中间状态

3. **目标选择系统**：
   - 蛊惑的目标选择复用现有的目标选择逻辑
   - 需要根据声称的牌类型动态调整可选目标

4. **伤害系统**：
   - 复用现有的 `dealDamage` 函数处理质疑为真时的体力损失
   - 复用现有的 `drawN` 函数处理质疑为假时的摸牌

5. **日志系统**：
   - 为蛊惑的每个阶段添加对应的日志记录
   - 确保日志清晰地反映技能的发动、质疑、结果等关键节点

6. **判定系统**：
   - 不需要判定系统，但需要注意某些锦囊牌（如过河拆桥）可能涉及判定

### 需要修改的文件

1. **data.js**：
   - 添加于吉武将定义
   - 添加蛊惑技能的caps标识

2. **game.js**：
   - `normalize()`：添加蛊惑状态字段防御
   - 添加 `startGuhuo`、`pickGuhuoCard`、`claimGuhuoCard`、`questionGuhuo`、`resolveGuhuoQuestion`、`executeGuhuoWithoutQuestion`、`executeGuhuoEffect`、`cancelGuhuo` 函数
   - 可能需要添加 `useGuhuoCardTo`、`useGuhuoTaoTo` 等辅助函数

3. **render-controls.js**：
   - 添加蛊惑的完整UI界面
   - 添加技能按钮和各阶段的交互逻辑

4. **render.js**（如需要）：
   - 添加状态显示（如需要）

5. **skills.js**（可能需要）：
   - 添加辅助函数

---

## 十一、流程图

### 蛊惑完整流程
```
出牌阶段
    ↓
检查是否有手牌
    ↓
是：显示蛊惑按钮
    ↓
玩家点击蛊惑按钮
    ↓
进入蛊惑选择阶段，显示可选的手牌
    ↓
玩家选择一张手牌扣置
    ↓
进入声称牌类型阶段
    ↓
玩家选择要声称的基本牌或普通锦囊牌类型
    ↓
其他角色依次选择是否质疑
    ↓
检查是否有质疑者
    ↓
是：翻开扣置的牌
    ↓
判断是否为真
    ↓
是（真）：质疑者各失去1点体力
    ↓
    检查牌的花色是否为♥
    ↓
    是（红桃）：牌仍然进行结算
    ↓
    否：牌不结算，作废
    ↓
否（假）：质疑者各摸一张牌，牌作废
    ↓
无质疑者：直接结算声称的牌效果
    ↓
清理状态，回到出牌阶段
```

---

## 十二、特殊说明

### 关于蛊惑的技能定位

蛊惑是于吉的核心技能，体现了其通过欺骗手段达到目的的特点。这是一个高风险高收益的技能：

**技能特点**：
- 无次数限制：出牌阶段可以多次使用蛊惑（只要有手牌可以扣置）
- 资源消耗：每次使用需要消耗一张手牌
- 风险与收益并存：若被质疑且为假，仅损失一张牌；若被质疑且为真，所有质疑者都受到惩罚
- 策略性强：玩家需要判断其他角色是否会质疑，以及质疑的后果

### 关于技能平衡性

于吉作为3体力的群雄武将，蛊惑提供了强大的灵活性：
- 可以灵活地使用/打出任何基本牌或普通锦囊牌
- 通过质疑机制，可以对对手造成心理压力
- 红桃牌的特殊规则增加了技能的复杂性和策略深度
- 3体力的限制平衡了技能的强大

### 关于与其他技能的交互

1. **与锦囊的交互**：
   - 蛊惑视为的锦囊牌应正常触发相关的锦囊效果
   - 其他角色可以用无懈可击响应蛊惑产生的锦囊牌

2. **与质疑机制的交互**：
   - 所有其他存活角色都可以选择是否质疑
   - 质疑的决定需要在有限时间内完成

3. **与判定相关技能的交互**：
   - 若蛊惑声称的牌涉及判定（如乐不思蜀、兵粮寸断等），则正常进行判定
   - 判定结果会影响牌的实际效果

4. **与无懈可击的交互**：
   - 如果蛊惑声称的牌是锦囊牌，其他角色可以使用无懈可击抵消
   - 无懈可击的使用时机在牌生效前

---

## 十三、修正记录

*文档状态：设计阶段*
*创建时间：2026-07-12*
*负责人：Mistral Vibe*

### 待实装项

- [ ] **data.js**: 添加于吉武将定义
- [ ] **game.js**: 
  - [ ] normalize函数：添加蛊惑状态字段防御
  - [ ] 添加蛊惑相关函数
  - [ ] 处理牌效果的实际结算
- [ ] **render-controls.js**: 
  - [ ] 添加蛊惑UI界面
- [ ] **render.js**: 添加状态显示（如需要）
- [ ] **skills.js**: 添加辅助函数（如需要）

### 待优化项

- 音效文件：需要添加assets/audio/guhuo.mp3
- UI/UX：蛊惑多阶段选择界面的用户体验优化
- 性能：复杂状态机的性能优化
- 兼容性：确保与现有所有技能的兼容性
- 国际化：考虑多语言支持（如需要）

### 已知问题与限制

1. **复杂的牌效果结算**：不同的牌类型（基本牌、锦囊牌）需要不同的处理逻辑，需要详细分析每种牌的效果
2. **质疑时机**：需要明确所有角色的质疑选择时机和顺序
3. **红桃牌的特殊处理**：需要确保在被质疑且为真且花色为红桃时，牌仍然结算
4. **牌的展示**：扣置的牌在翻开前不展示给其他玩家，需要特殊的UI处理
