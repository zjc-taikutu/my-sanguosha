# 蔡文姬 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `caiwenji` |
| **武将名称** | 蔡文姬 |
| **势力** | 魏 |
| **性别** | female |
| **体力上限** | 3 |
| **技能** | 悲歌 / 断肠 |

---

## 二、技能说明

### 悲歌
**时机**：当一名角色受到【杀】造成的伤害后

**效果**：
1. 你可以弃置一张牌
2. 令受伤角色进行一次判定
3. 根据判定结果：
   - 红桃：其回复1点体力
   - 方块：其摸两张牌
   - 梅花：伤害来源弃置两张牌
   - 黑桃：伤害来源翻面

**设计要点**：
- 属于**伤害结算后的触发技能**，需要集成到伤害处理流程中
- 可以选择是否发动（弃置一张牌作为代价）
- 判定结果影响不同的效果目标（受伤者或伤害来源）
- 需要支持判定改判系统（如鬼才、鬼道等）
- 弃置的牌可以是手牌或装备区的牌
- 每次【杀】伤害后都可以独立触发

### 断肠
**时机**：当你死亡时（锁定技）

**效果**：
杀死你的角色失去所有武将技能。

**设计要点**：
- **锁定技**：无法选择不发动
- 需要在死亡结算时触发
- 影响的是**杀死蔡文姬的角色**（即造成致命伤害的角色）
- 该角色失去**所有武将技能**（包括主公技、限定技等）
- 技能失去是**永久性**的，不随回合恢复

---

## 三、翻面机制说明

**翻面状态定义**：
- 角色的 `faceup` 属性表示其武将牌是否正面朝上
- `faceup = true`：正面朝上（正常状态）
- `faceup = false`：背面朝上（翻面状态）

**翻面效果**：
当一名处于翻面状态（背面朝上，即 `faceup = false`）的角色轮到其回合时：
1. 该角色**不进行任何回合内的阶段**（直接跳过整个回合）
2. 回合结束后，**直接将武将牌翻转回正面朝上**（即设置 `faceup = true`）

**实现要点**：
- 在回合开始阶段（`startTurn` 函数中）检查当前角色的 `faceup` 状态
- 若 `faceup === false`，则跳过回合，并在回合结束后设置 `faceup = true`
- 翻面操作仅切换 `faceup` 状态，不直接触发回合跳过（回合跳过由回合开始逻辑处理）

---

## 四、数据定义（data.js）

### 武将表条目
```javascript
caiwenji: {
  id: 'caiwenji',
  name: '蔡文姬',
  gender: 'female',
  maxHp: 3,
  skill: '悲歌/断肠',
  desc: '悲歌:当一名角色受到【杀】造成的伤害后,你可以弃置一张牌,令其判定,若结果为:红桃,其回复1点体力;方块,其摸两张牌;梅花,伤害来源弃置两张牌;黑桃,伤害来源翻面。断肠:锁定技,当你死亡时,杀死你的角色失去所有武将技能。',
  caps: { beige: true, duanchang: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 蔡文姬【悲歌】:伤害后选择是否发动
// pending 应包含 type、sourceSeat（蔡文姬的座位）、damagedSeat（受伤角色的座位）、damageSource（伤害来源座位）
if(g.pending && g.pending.type==='beigeChoose'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.damagedSeat!=='number' || !g.players[d.damagedSeat] || !g.players[d.damagedSeat].alive ||
     d.sourceSeat !== mySeat ||
     (d.damageSource !== null && typeof d.damageSource === 'number' && (!g.players[d.damageSource] || !g.players[d.damageSource].alive))){
    g.pending = null;
    g.phase = g.phase === 'beigeChoose' ? 'play' : g.phase;
  }
}

// 蔡文姬【悲歌】:判定阶段
// pending 应包含 type、sourceSeat、damagedSeat、damageSource、resume
if(g.pending && g.pending.type==='beigeJudge'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.damagedSeat!=='number' || !g.players[d.damagedSeat] || !g.players[d.damagedSeat].alive ||
     d.sourceSeat !== mySeat ||
     !d.resume || typeof d.resume.kind!=='string'){
    g.pending = null;
    g.phase = 'play';
  }
}

// 蔡文姬【断肠】:死亡结算标记
// 使用 g.dyingSource 记录造成致命伤害的角色座位
if(typeof g.dyingSource !== 'number' && g.dyingSource !== null) g.dyingSource = null;

// 翻面状态：确保所有角色都有 faceup 属性
for (let i = 0; i < g.players.length; i++) {
  if (g.players[i] && typeof g.players[i].faceup !== 'boolean') {
    g.players[i].faceup = true; // 默认正面朝上
  }
}
```

在 `startTurn` 函数中无需添加重置项（悲歌不限次数，断肠只在死亡时触发）

---

## 五、技能实现

### 悲歌实现

**集成点**：伤害处理流程，需要在 `dealDamage` 或 `afterDamage` 等函数中添加触发检查

```javascript
// 在伤害结算完成后添加悲歌触发检查
function dealDamage(g, targetSeat, damage, sourceSeat, reason, damageType) {
  tx(g => {
    // ... 现有的伤害处理逻辑 ...
    
    // 伤害结算完成后检查是否可以触发悲歌
    // 仅对【杀】造成的伤害生效
    if (reason && reason.includes('【杀】') && g.players[targetSeat] && g.players[targetSeat].alive) {
      // 寻找所有有【悲歌】技能的蔡文姬
      for (let i = 0; i < g.players.length; i++) {
        const p = g.players[i];
        if (p && p.alive && hasCap(p, 'beige') && i !== targetSeat) {
          // 进入悲歌选择阶段
          g.pending = {
            type: 'beigeChoose',
            sourceSeat: i,
            damagedSeat: targetSeat,
            damageSource: sourceSeat,
            reason: reason
          };
          g.phase = 'beigeChoose';
          g.log = pushLog(g.log, `${p.name} 可以发动【悲歌】,是否弃置一张牌令 ${g.players[targetSeat].name} 进行判定?`);
          markSkillSound(g, '悲歌');
          return g;
        }
      }
    }
    
    return g;
  });
}
```

```javascript
// 悲歌选择是否发动
function triggerBeige(doTrigger) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'beigeChoose' || pending.sourceSeat !== mySeat) return g;
    
    if (!doTrigger) {
      // 不发动
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【悲歌】`);
      return g;
    }
    
    const source = g.players[mySeat];
    const damagedSeat = pending.damagedSeat;
    const damageSource = pending.damageSource;
    
    if (!source || !source.alive || !g.players[damagedSeat] || !g.players[damagedSeat].alive) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 检查是否有牌可以弃置（手牌或装备）
    const canDiscard = (source.hand && source.hand.length > 0) || 
                      (source.equip && Object.values(source.equip).some(eq => eq && eq.length > 0));
    
    if (!canDiscard) {
      g.log = pushLog(g.log, `${source.name} 没有牌可以弃置,无法发动【悲歌】`);
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 进入弃牌选择阶段
    g.pending = {
      type: 'beigeDiscard',
      sourceSeat: mySeat,
      damagedSeat: damagedSeat,
      damageSource: damageSource,
      reason: pending.reason
    };
    g.phase = 'beigeDiscard';
    g.log = pushLog(g.log, `${source.name} 发动【悲歌】,请选择一张牌弃置`);
    
    return g;
  });
}
```

```javascript
// 悲歌选择弃置的牌
function beigeDiscard(cardIndex, isEquip, equipType) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'beigeDiscard' || pending.sourceSeat !== mySeat) return g;
    
    const source = g.players[mySeat];
    const damagedSeat = pending.damagedSeat;
    const damageSource = pending.damageSource;
    
    if (!source || !source.alive || !g.players[damagedSeat] || !g.players[damagedSeat].alive) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    let discardedCard = null;
    
    if (isEquip && equipType) {
      // 弃置装备
      if (source.equip && source.equip[equipType] && source.equip[equipType].length > cardIndex) {
        discardedCard = source.equip[equipType][cardIndex];
        source.equip[equipType].splice(cardIndex, 1);
      }
    } else {
      // 弃置手牌
      if (source.hand && source.hand.length > cardIndex) {
        discardedCard = source.hand[cardIndex];
        source.hand.splice(cardIndex, 1);
      }
    }
    
    if (!discardedCard) {
      g.log = pushLog(g.log, `${source.name} 弃牌失败`);
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 弃置牌到弃牌堆
    g.discard.push(discardedCard);
    g.log = pushLog(g.log, `${source.name} 弃置了【${discardedCard.name}】`);
    
    // 进入判定阶段
    g.pending = {
      type: 'beigeJudge',
      sourceSeat: mySeat,
      damagedSeat: damagedSeat,
      damageSource: damageSource,
      resume: { kind: 'beigeJudge', sourceSeat: mySeat, damagedSeat: damagedSeat, damageSource: damageSource }
    };
    g.phase = 'beigeJudge';
    g.log = pushLog(g.log, `${g.players[damagedSeat].name} 进行判定…`);
    
    return g;
  });
}
```

```javascript
// 悲歌判定处理
function doBeigeJudge() {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'beigeJudge' || pending.sourceSeat !== mySeat) return g;
    
    const { sourceSeat, damagedSeat, damageSource, resume } = pending;
    const source = g.players[sourceSeat];
    const damaged = g.players[damagedSeat];
    
    if (!source || !source.alive || !damaged || !damaged.alive) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 进行判定
    const judgeCard = judge(g);
    if(!judgeCard) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    g.log = pushLog(g.log, `${damaged.name} 判定为${judgeCard.suit}${rankText(judgeCard.rank)}`);
    
    // 检查是否有改判技能需要处理
    // 先保存判定结果，等待可能的改判
    if(maybeGuicai(g, damagedSeat, judgeCard, resume) === 'pending') {
      return g; // 等待改判处理
    }
    
    // 处理判定结果
    return processBeigeJudgeResult(g, judgeCard, sourceSeat, damagedSeat, damageSource);
  });
}

// 处理悲歌判定结果
function processBeigeJudgeResult(g, judgeCard, sourceSeat, damagedSeat, damageSource) {
  tx(g => {
    const damaged = g.players[damagedSeat];
    
    if (!damaged || !damaged.alive) {
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 根据花色执行不同效果
    switch(judgeCard.suit) {
      case '♥': // 红桃 - 受伤角色回复1点体力
        heal(g, damagedSeat, 1, sourceSeat, '悲歌');
        g.log = pushLog(g.log, `${damaged.name} 回复1点体力`);
        break;
        
      case '♦': // 方块 - 受伤角色摸两张牌
        drawN(g, damagedSeat, 2);
        g.log = pushLog(g.log, `${damaged.name} 摸两张牌`);
        break;
        
      case '♣': // 梅花 - 伤害来源弃置两张牌
        if (damageSource !== null && g.players[damageSource] && g.players[damageSource].alive) {
          const sourcePlayer = g.players[damageSource];
          const cardsToDiscard = [];
          
          // 先弃置手牌
          if (sourcePlayer.hand && sourcePlayer.hand.length > 0) {
            const discardCount = Math.min(2, sourcePlayer.hand.length);
            for (let i = 0; i < discardCount; i++) {
              cardsToDiscard.push(sourcePlayer.hand.shift());
            }
          }
          
          // 如果手牌不足2张，继续弃置装备
          if (cardsToDiscard.length < 2 && sourcePlayer.equip) {
            const equipTypes = ['weapon', 'armor', 'horse1', 'horse2', 'treasure'];
            for (const eqType of equipTypes) {
              if (cardsToDiscard.length >= 2) break;
              if (sourcePlayer.equip[eqType] && sourcePlayer.equip[eqType].length > 0) {
                cardsToDiscard.push(sourcePlayer.equip[eqType].shift());
              }
            }
          }
          
          g.discard.push(...cardsToDiscard);
          g.log = pushLog(g.log, `${sourcePlayer.name} 弃置了${cardsToDiscard.length}张牌`);
        }
        break;
        
      case '♠': // 黑桃 - 伤害来源翻面
        if (damageSource !== null && g.players[damageSource] && g.players[damageSource].alive) {
          const sourcePlayer = g.players[damageSource];
          sourcePlayer.faceup = !sourcePlayer.faceup;
          g.log = pushLog(g.log, `${sourcePlayer.name} 翻面`);
        }
        break;
    }
    
    // 清理状态
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}
```

```javascript
// 取消悲歌
function cancelBeige() {
  tx(g => {
    if (g.pending && (g.pending.type === 'beigeChoose' || 
                      g.pending.type === 'beigeDiscard' || 
                      g.pending.type === 'beigeJudge') &&
        g.pending.sourceSeat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【悲歌】`);
    }
    return g;
  });
}
```

### 断肠实现

**集成点**：死亡处理流程，需要在角色死亡时触发

```javascript
// 修改死亡处理函数，添加断肠触发
function killPlayer(g, seat) {
  tx(g => {
    const player = g.players[seat];
    if (!player || !player.alive) return g;
    
    // 记录造成致命伤害的角色
    const killerSeat = g.dyingSource || null;
    
    // 标记玩家为死亡
    player.alive = false;
    player.hand = [];
    player.equip = { weapon: [], armor: [], horse1: [], horse2: [], treasure: [] };
    
    // 处理断肠效果
    if (hasCap(player, 'duanchang') && killerSeat !== null && g.players[killerSeat]) {
      const killer = g.players[killerSeat];
      if (killer && killer.alive) {
        // 杀死蔡文姬的角色失去所有武将技能
        // 清空caps（技能标记）
        killer.caps = {};
        // 清空skills数组（如果存在）
        if (killer.skills) killer.skills = [];
        // 更新武将表中的技能描述
        if (g.players[killerSeat].skill) {
          g.players[killerSeat].skill = '（已失去所有技能）';
        }
        
        g.log = pushLog(g.log, `${killer.name} 失去了所有武将技能（【断肠】效果）`);
        markSkillSound(g, '断肠');
      }
    }
    
    // 其他死亡处理逻辑...
    g.log = pushLog(g.log, `${player.name} 阵亡`);
    
    // 清理死亡相关状态
    g.dyingSource = null;
    
    return g;
  });
}
```

**修改伤害处理，记录致命伤害来源**：
```javascript
// 修改 dealDamage 函数，在造成致命伤害时记录伤害来源
function dealDamage(g, targetSeat, damage, sourceSeat, reason, damageType) {
  tx(g => {
    const target = g.players[targetSeat];
    if (!target || !target.alive) return g;
    
    // 计算实际伤害
    const actualDamage = damage;
    
    // 扣减体力
    target.hp -= actualDamage;
    
    // 检查是否死亡
    if (target.hp <= 0) {
      target.hp = 0;
      // 记录致命伤害来源（用于断肠）
      g.dyingSource = sourceSeat;
    }
    
    // 添加伤害日志
    g.log = pushLog(g.log, `${target.name} 受到了${actualDamage}点伤害（来自：${sourceSeat !== null ? g.players[sourceSeat].name : '无来源'}）`);
    
    // 检查是否触发悲歌（仅对【杀】伤害）
    if (reason && reason.includes('【杀】')) {
      // ... 悲歌触发逻辑 ...
    }
    
    // 如果死亡，执行死亡处理
    if (target.hp <= 0) {
      return killPlayer(g, targetSeat);
    }
    
    return g;
  });
}
```

### 翻面机制实现

**集成点**：回合开始处理流程

```javascript
// 修改 startTurn 函数，添加翻面状态检查
function startTurn(g, seat) {
  tx(g => {
    const player = g.players[seat];
    if (!player || !player.alive) return g;
    
    // 检查翻面状态：如果处于翻面状态（背面朝上），则跳过回合
    if (player.faceup === false) {
      g.log = pushLog(g.log, `${player.name} 处于翻面状态，跳过回合并翻回正面`);
      // 翻回正面
      player.faceup = true;
      // 跳过回合，直接进入下一角色
      return endTurn(g);
    }
    
    // ... 现有的回合开始逻辑 ...
    
    return g;
  });
}
```

---

## 六、渲染集成（render-controls.js）

### 悲歌 UI 集成

```javascript
// 在 renderControls 中添加悲歌相关状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 悲歌：选择是否发动
  if (g.pending && g.pending.type === 'beigeChoose' && g.pending.sourceSeat === seat) {
    const damaged = g.players[g.pending.damagedSeat];
    const source = g.players[g.pending.damageSource];
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【悲歌】发动</h4>
        <p>${damaged.name} 受到【杀】伤害后,你可以弃置一张牌令其进行判定</p>
        <p>判定结果：红桃回复1体力；方块摸2牌；梅花伤害来源弃2牌；黑桃伤害来源翻面</p>
        <div class="action-buttons">
          <button onclick="triggerBeige(true)" class="skill-btn" style="background: #e74c3c;">
            发动
          </button>
          <button onclick="triggerBeige(false)" class="cancel-btn">
            不发动
          </button>
        </div>
      </div>
    `;
    return;
  }

  // 悲歌：选择弃置的牌
  if (g.pending && g.pending.type === 'beigeDiscard' && g.pending.sourceSeat === seat) {
    const damaged = g.players[g.pending.damagedSeat];
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【悲歌】弃置牌</h4>
        <p>为 ${damaged.name} 发动【悲歌】,请选择一张牌弃置</p>
        <div class="card-options">
          <h5>手牌：</h5>
    `;
    
    // 渲染可弃置的手牌
    const hand = p.hand || [];
    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      ui.innerHTML += `
        <button onclick="beigeDiscard(${i}, false, '')" class="card-btn">
          弃置【${card.name}】(${card.suit}${rankText(card.rank)})
        </button>
      `;
    }
    
    // 渲染可弃置的装备
    ui.innerHTML += `<h5>装备：</h5>`;
    const equipTypes = ['weapon', 'armor', 'horse1', 'horse2', 'treasure'];
    const equipNames = ['武器', '防具', '坐骑1', '坐骑2', '宝物'];
    
    for (let i = 0; i < equipTypes.length; i++) {
      const eqType = equipTypes[i];
      const eqName = equipNames[i];
      if (p.equip && p.equip[eqType] && p.equip[eqType].length > 0) {
        for (let j = 0; j < p.equip[eqType].length; j++) {
          const eqCard = p.equip[eqType][j];
          ui.innerHTML += `
            <button onclick="beigeDiscard(${j}, true, '${eqType}')" class="card-btn">
              弃置${eqName}【${eqCard.name}】
            </button>
          `;
        }
      }
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelBeige()" class="cancel-btn">
          取消
        </button>
      </div>
    `;
    return;
  }

  // 悲歌：判定阶段
  if (g.pending && g.pending.type === 'beigeJudge' && g.pending.sourceSeat === seat) {
    const damaged = g.players[g.pending.damagedSeat];
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【悲歌】判定</h4>
        <p>等待 ${damaged.name} 的判定结果...</p>
        <button onclick="doBeigeJudge()" class="skill-btn" style="background: #f39c12;">
          进行判定
        </button>
        <button onclick="cancelBeige()" class="cancel-btn">
          取消
        </button>
      </div>
    `;
    return;
  }
}
```

### 翻面状态 UI 显示

```javascript
// 在 renderTable 中添加翻面状态显示
function renderTable(g, me) {
  // ... 现有代码 ...
  
  for (let i = 0; i < g.players.length; i++) {
    const p = g.players[i];
    if (!p) continue;
    
    // 添加翻面状态标识
    if (p.faceup === false) {
      // 显示背面朝上的视觉效果
      table.innerHTML += `<div class="player-flipped" title="翻面状态">`;
    } else {
      table.innerHTML += `<div class="player-normal">`;
    }
    
    // ... 其他渲染逻辑 ...
    
    if (p.faceup === false) {
      table.innerHTML += `</div>`;
    } else {
      table.innerHTML += `</div>`;
    }
  }
}

// 在 renderControls 中显示翻面状态提示
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];
  
  // 如果当前角色处于翻面状态，显示提示
  if (p && p.faceup === false) {
    ui.innerHTML += `
      <div class="status-notice">
        <p>你处于翻面状态，本回合将被跳过并自动翻回正面</p>
      </div>
    `;
  }
  
  // ... 其他控制渲染逻辑 ...
}
```

---

## 七、音效标识

在 `markSkillSound` 中添加：
```javascript
const SKILL_SOUNDS = {
  // ... 现有技能 ...
  '悲歌': 'beige',
  '断肠': 'duanchang',
};
```

---

## 八、边界条件处理

### 悲歌
2. **无牌可以弃置**：若蔡文姬没有手牌和装备，无法发动悲歌
3. **受伤角色死亡**：在判定前验证受伤角色是否存活，死亡则取消
4. **伤害来源不存在**：若伤害来源为null（如反弹伤害等），梅花和黑桃效果无法触发
5. **伤害来源手牌不足2张**：梅花效果弃置所有手牌（可能少于2张）
6. **判定改判**：支持鬼才、鬼道等改判技能
7. **连锁触发**：每次【杀】伤害后都可以独立触发悲歌
8. **多个蔡文姬**：若场上有多个蔡文姬，按座位顺序依次询问
9. **非【杀】伤害**：悲歌仅对【杀】造成的伤害生效
10. **伤害来源已翻面**：黑桃效果可以使其翻回正面

### 断肠
1. **无杀死者**：若蔡文姬因其他原因死亡，断肠不生效
2. **杀死者已死亡**：若杀死蔡文姬的角色在断肠生效前已经死亡，则不处理
3. **技能失去的范围**：失去**所有**武将技能，包括主公技、限定技、觉醒技等
4. **技能失去的永久性**：失去的技能不会在任何情况下恢复
5. **多个蔡文姬死亡**：每个蔡文姬死亡时都独立触发断肠
6. **连环死亡**：若杀死蔡文姬的角色同时死亡，断肠仍然生效

---

## 九、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **悲歌** |
| 悲歌：角色受到【杀】伤害，蔡文姬有手牌 | 可以发动悲歌，选择弃置手牌，受伤角色进行判定 |
| 悲歌：角色受到【杀】伤害，蔡文姬无手牌但有装备 | 可以弃置装备发动悲歌 |
| 悲歌：角色受到【杀】伤害，蔡文姬无牌 | 不能发动悲歌 |
| 悲歌：判定为红桃 | 受伤角色回复1点体力 |
| 悲歌：判定为方块 | 受伤角色摸两张牌 |
| 悲歌：判定为梅花，伤害来源有2张手牌 | 伤害来源弃置2张手牌 |
| 悲歌：判定为梅花，伤害来源有1张手牌 | 伤害来源弃置所有手牌（1张） |
| 悲歌：判定为梅花，伤害来源无手牌 | 伤害来源无牌可弃，效果不生效 |
| 悲歌：判定为黑桃 | 伤害来源翻面 |
| 悲歌：判定为黑桃，伤害来源已翻面 | 伤害来源翻回正面 |
| 悲歌：伤害来源不存在（null） | 梅花和黑桃效果无法触发 |
| 悲歌：受伤角色在判定前死亡 | 悲歌取消 |
| 悲歌：判定时发动鬼才/鬼道 | 改判后的结果决定悲歌效果 |
| 悲歌：角色受到非【杀】伤害 | 悲歌不触发 |
| 悲歌：多个蔡文姬同时在场 | 按座位顺序依次询问 |
| **断肠** |
| 断肠：蔡文姬被【杀】击杀 | 击杀者失去所有武将技能 |
| 断肠：蔡文姬被锦囊击杀 | 使用锦囊的角色失去所有武将技能 |
| 断肠：蔡文姬自杀死亡 | 断肠不触发（无杀死者） |
| 断肠：蔡文姬因绝境死亡 | 断肠不触发（无杀死者） |
| 断肠：击杀者在断肠生效前死亡 | 断肠不生效 |
| 断肠：击杀者失去技能后 | 该角色的所有武将技能都无法使用 |
| 断肠：多个蔡文姬被同一角色击杀 | 每个蔡文姬死亡时都触发断肠 |
| **翻面机制** |
| 翻面：角色处于翻面状态，轮到其回合 | 跳过整个回合，回合结束后自动翻回正面 |
| 翻面：角色翻面后被翻回正面 | 下个回合可正常行动 |
| 翻面：角色处于翻面状态时受到伤害 | 正常受到伤害，不影响翻面状态 |
| 翻面：角色在翻面状态时使用牌 | 不可以使用牌（因为跳过整个回合） |
| **组合测试** |
| 悲歌+断肠：蔡文姬受到伤害发动悲歌，判定为黑桃使伤害来源翻面，之后蔡文姬被杀 | 击杀者失去所有技能 |
| 悲歌+鬼才：悲歌判定时其他角色发动鬼才 | 使用鬼才的牌作为判定结果 |
| 悲歌+鬼道：悲歌判定时张角发动鬼道 | 使用黑色牌作为判定结果 |
| 悲歌+刚烈：悲歌判定时孙乾发动刚烈 | 判定后根据结果决定是否造成伤害 |
| 悲歌+翻面：蔡文姬发动悲歌使伤害来源翻面，下个回合到该角色 | 该角色跳过回合并自动翻回正面 |
| 断肠+技能依赖：击杀者失去技能后，依赖该技能的效果（如连环） | 相关效果无法生效 |

---

## 十、实现优先级

1. **翻面机制优先**：基础机制，需要先实现回合跳过逻辑
2. **断肠优先**：锁定技，实现简单但需要集成到死亡处理流程中
3. **悲歌判定处理优先**：判定结果的不同效果需要分别实现
4. **悲歌弃牌逻辑优先**：支持手牌和装备的弃置
5. **UI集成优先**：悲歌的多阶段选择界面和翻面状态显示
6. **边界处理优先**：无目标、无牌、目标死亡等特殊情况
7. **音效集成**：添加技能音效
8. **测试验证**：确保所有场景都通过测试

---

## 十一、集成要点

### 与现有系统的集成

1. **伤害系统**：
   - 复用现有的 `dealDamage` 函数
   - 在伤害结算后添加悲歌触发检查
   - 记录致命伤害来源用于断肠

2. **判定系统**：
   - 复用现有的 `judge()` 函数进行判定
   - 集成改判系统（鬼才、鬼道等）
   - 确保判定结果可以被改判技能修改

3. **死亡系统**：
   - 在 `killPlayer` 函数中添加断肠效果处理
   - 处理技能失去的逻辑

4. **回合系统**：
   - 修改 `startTurn` 函数，添加翻面状态检查
   - 处理翻面角色的回合跳过逻辑

5. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程
   - 使用 `g.pending` 保存中间状态

5. **目标选择系统**：
   - 悲歌的弃牌选择需要支持手牌和装备
   - 判定目标自动确定

6. **牌操作系统**：
   - 弃牌逻辑支持手牌和装备
   - 摸牌、回复体力等操作复用现有函数

### 需要修改的文件

1. **data.js**：
   - 添加蔡文姬武将定义（ID: `caiwenji`）

2. **game.js**：
   - `normalize()`：添加悲歌、断肠状态字段防御和翻面状态初始化
   - `dealDamage()`：添加悲歌触发检查和致命伤害来源记录
   - `killPlayer()`：添加断肠效果处理
   - `startTurn()`：添加翻面状态检查
   - 添加 `triggerBeige`、`beigeDiscard`、`doBeigeJudge`、`cancelBeige` 函数
   - 添加 `processBeigeJudgeResult` 函数

3. **render-controls.js**：
   - 添加悲歌的多阶段UI界面
   - 添加弃牌选择界面
   - 添加翻面状态提示

4. **render-table.js**（如需要）：
   - 添加翻面状态的视觉显示
   - 添加弃牌选择界面

4. **render.js**（如需要）：
   - 添加断肠效果的视觉显示（如技能失去的提示）

---

## 十二、流程图

### 悲歌完整流程
```
【杀】造成伤害后
    ↓
检查是否有蔡文姬
    ↓
是：蔡文姬选择是否发动
    ↓
发动：蔡文姬选择弃置一张牌（手牌或装备）
    ↓
弃置牌进入弃牌堆
    ↓
受伤角色进行判定
    ↓
检查是否有改判技能（鬼才、鬼道等）
    ↓
有：等待改判处理
    ↓
无/改判完成：根据判定结果执行效果
    ↓
红桃：受伤角色回复1体力
方块：受伤角色摸2牌
梅花：伤害来源弃置2张牌
黑桃：伤害来源翻面
    ↓
清理状态，回到出牌阶段
```

### 断肠完整流程
```
蔡文姬受到致命伤害
    ↓
记录致命伤害来源
    ↓
蔡文姬死亡
    ↓
检查是否有断肠技能
    ↓
是：杀死蔡文姬的角色失去所有武将技能
    ↓
清理死亡相关状态
    ↓
继续游戏流程
```

### 翻面机制流程
```
角色翻面（设置 faceup = false）
    ↓
轮到该角色回合
    ↓
检查 faceup 状态
    ↓
faceup === false？
    ↓
是：跳过整个回合
    ↓
设置 faceup = true
    ↓
继续下一角色的回合
    ↓
否：正常进行回合
    ↓
回合结束
```

---

## 十三、特殊说明

### 关于悲歌的设计定位

悲歌是蔡文姬的核心辅助技能，体现了她的音乐才华和悲天悯人的性格特点。通过判定的随机性，悲歌可以为队友提供多种支持效果：
- 回复体力（红桃）：直接治疗
- 摸牌（方块）：资源补充
- 困扰对手（梅花）：迫使对手弃牌
- 控制（黑桃）：翻面干扰

**技能特点**：
- 触发时机广泛：任何【杀】伤害后都可触发
- 成本适中：弃置一张牌
- 效果多样：根据判定结果有不同效果
- 团队性强：主要为队友提供支持

### 关于断肠的设计定位

断肠是蔡文姬的锁定死亡技，体现了她悲剧的一生。当她死亡时，会给击杀她的角色带来永久性的惩罚——失去所有武将技能。

**技能特点**：
- 锁定技：必须发动
- 触发时机：死亡时
- 效果永久：技能失去不会恢复
- 惩罚性强：严重削弱击杀者的战斗力

### 关于技能平衡性

蔡文姬作为3体力的辅助型武将：
- **悲歌**：提供多样化的辅助效果，但需要消耗牌，且结果依赖运气
- **断肠**：作为死亡惩罚，平衡了她体力较低的劣势
- **翻面控制**：黑桃效果提供强力的控制手段
- 整体定位为团队辅助，适合在队友频繁受到【杀】伤害的局势中使用

### 关于翻面机制

翻面是三国杀中的一种控制机制，具有以下特点：
- **惩罚性大**：翻面会导致角色跳过一个完整的回合
- **自动恢复**：翻面状态只在一个回合内生效，之后自动恢复
- **控制性强**：可以用来打断对手的节奏和计划
- **组合性好**：可以与多种技能配合使用

**翻面 vs 失去体力**：
- 翻面：跳过一个回合，但不影响体力
- 失去体力：直接减少体力，可能导致死亡
- 翻面的惩罚更"温和"但更"持久"（影响整个回合）

### 关于与其他技能的交互

1. **与判定改判技能的交互**：
   - 悲歌的判定可以被鬼才、鬼道等改判技能影响
   - 改判后的结果决定悲歌的最终效果

2. **与连环的交互**：
   - 若伤害来源处于连环状态，梅花和黑桃效果仍然作用于伤害来源本人

3. **与技能失去相关技能的交互**：
   - 断肠导致的技能失去是永久性的
   - 失去的技能包括所有类型：主动技、被动技、锁定技、限定技等

4. **与翻面相关技能的交互**：
   - 黑桃效果的翻面可以被其它技能影响
   - 翻面状态在回合开始时自动处理
   - 多个翻面效果叠加时，只需要处理 `faceup` 状态即可

---

## 十四、修正记录

*文档状态：设计阶段*
*创建时间：2026-07-12*
*最后修正：2026-07-13*
*负责人：Mistral Vibe*

### 待实装项

- [ ] **data.js**: 添加蔡文姬武将定义（ID: `caiwenji`）
- [ ] **game.js**: 
  - [ ] normalize函数：添加悲歌、断肠状态字段防御和翻面状态初始化
  - [ ] dealDamage函数：添加悲歌触发检查和致命伤害来源记录
  - [ ] killPlayer函数：添加断肠效果处理
  - [ ] startTurn函数：添加翻面状态检查
  - [ ] 添加悲歌相关函数（triggerBeige、beigeDiscard、doBeigeJudge、cancelBeige、processBeigeJudgeResult）
- [ ] **render-controls.js**: 
  - [ ] 添加悲歌的多阶段UI界面
  - [ ] 添加弃牌选择界面
  - [ ] 添加翻面状态提示
- [ ] **render-table.js**（如需要）：
  - [ ] 添加翻面状态的视觉显示

### 待优化项

- 音效文件：需要添加assets/audio/beige.mp3和assets/audio/duanchang.mp3
- UI/UX：悲歌选择界面的用户体验优化
- 性能：判定和效果处理的性能优化
- 兼容性：确保与现有所有技能的兼容性

### 修正说明

1. **武将ID修正**：从 `caifuren` 改为 `caiwenji`，符合蔡文姬的正确拼音
2. **翻面机制说明**：添加了完整的翻面机制说明，包括：
   - 翻面状态的定义（faceup 属性）
   - 翻面效果的规则（跳过回合并自动恢复）
   - 翻面机制的实现要点
   - 翻面相关的边界条件和测试要点
3. **数据定义统一**：确保所有地方都使用 `caiwenji` 作为武将ID
4. **翻面UI集成**：添加了翻面状态的UI显示说明
5. **实现优先级调整**：将翻面机制的实现优先级提高，作为基础机制
