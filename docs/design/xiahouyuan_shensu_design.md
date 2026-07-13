# 夏侯渊 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `xiahouyuan` |
| **武将名称** | 夏侯渊 |
| **势力** | 魏 |
| **性别** | male |
| **体力上限** | 4 |
| **技能** | 神速 |

---

## 二、技能说明

### 神速（每回合限一次）
**时机**：当前回合的特定阶段

**效果**：

【神速1】（跳过判定和摸牌）：
- 在**判定阶段开始前**发动（即准备阶段结束后）
- 视为使用一张无距离限制的普通【杀】
- 该【杀】结算完毕后，**当前回合直接进入出牌阶段**（跳过判定阶段和摸牌阶段）

【神速2】（跳过出牌并弃置装备）：
- 在**摸牌阶段结束后，即将进入出牌阶段前**发动
- 或在**刚发动完神速1后，即将进入出牌阶段前**发动
- 弃置一张装备区或手牌中的装备牌
- 视为使用一张无距离限制的普通【杀】
- 该【杀】结算完毕后，**当前回合直接进入弃牌阶段**（跳过出牌阶段）

**设计要点**：
- 属于**当前回合内的阶段跳过技能**，与下回合无关
- 每回合限发动一次神速（可以选择发动神速1、神速2，或两者都发动）
- **消耗的是当前正在进行的回合的阶段**
- 可以灵活选择发动方式：
  1. 只发动神速1：不摸牌，免费砍一刀，然后正常出牌
  2. 只发动神速2：正常摸牌，但不出牌，扔装备砍一刀
  3. 同一回合内连续发动神速1和神速2：放弃本回合的判定、摸牌和出牌，消耗一张装备牌，换取两刀无距离限制的【杀】

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
xiahouyuan: {
  id: 'xiahouyuan',
  name: '夏侯渊',
  gender: 'male',
  maxHp: 4,
  skill: '神速',
  desc: '神速:每回合限一次,你可以选择:1.判定阶段开始前,可以跳过判定和摸牌阶段,视为使用一张无距离限制的【杀】,然后进入出牌阶段;2.摸牌阶段结束后,可以跳过出牌阶段并弃置一张装备牌,视为使用一张无距离限制的【杀】,然后进入弃牌阶段。',
  caps: { shensu: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 夏侯渊【神速】:回合内使用标记
if(typeof g.shensuUsed!=='boolean') g.shensuUsed=false;

// 夏侯渊【神速】:当前回合是否已跳过判定和摸牌阶段（神速1效果）
if(typeof g.shensuSkipJudgingAndDraw!=='boolean') g.shensuSkipJudgingAndDraw=false;

// 夏侯渊【神速】:当前回合是否已跳过出牌阶段（神速2效果）
if(typeof g.shensuSkipPlay!=='boolean') g.shensuSkipPlay=false;

// 夏侯渊【神速】:待使用的无距离杀数量
if(typeof g.shensuShaRemaining!=='number') g.shensuShaRemaining=0;

// 夏侯渊【神速】选择阶段:pending 应包含 type、seat 等字段
if(g.pending && g.pending.type==='shensuChoose1'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
    g.pending = null;
    g.phase = 'judge';
  }
}

if(g.pending && g.pending.type==='shensuChoose2'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
    g.pending = null;
    g.phase = 'play';
  }
}

// 夏侯渊【神速】杀目标选择阶段
if(g.pending && g.pending.type==='shensuSha'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     typeof d.remaining!=='number' || d.remaining <= 0 ||
     typeof d.noDistance!=='boolean'){
    g.pending = null;
    g.phase = g.shensuSkipJudgingAndDraw ? 'play' : (g.shensuSkipPlay ? 'discard' : 'play');
  }
}
```

在 `startTurn` 函数中添加重置：
```javascript
g.shensuUsed = false;
g.shensuSkipJudgingAndDraw = false;
g.shensuSkipPlay = false;
g.shensuShaRemaining = 0;
```

---

## 四、技能实现

### 核心机制

神速技能的核心是**在特定阶段点触发，跳过当前回合的后续阶段**，每选择一项效果就视为使用一张无距离限制的普通【杀】。

**关键时机点**：
1. **神速1触发点**：`enterDrawPhase` 函数开始处理判定阶段时
2. **神速2触发点**：`doDraw` 函数摸牌结束后，即将进入出牌阶段时

### 阶段跳过逻辑

```javascript
// 在 enterDrawPhase 函数中添加神速1的触发检查
function enterDrawPhase(g) {
  const p = g.players[g.turn];
  if (!p || !p.alive) return;
  
  // 神速1：在判定阶段开始前检查是否可以发动
  if (hasCap(p, 'shensu') && !g.shensuUsed && !g.shensuSkipJudgingAndDraw) {
    // 设置神速1发动的 pending
    g.pending = {
      type: 'shensuChoose1',
      seat: g.turn
    };
    g.phase = 'shensuChoose1';
    g.log = pushLog(g.log, `${p.name} 可以发动【神速】跳过判定和摸牌阶段`);
    return;
  }
  
  // ✅ 神速2的第二个触发点：刚发动完神速1后，即将进入出牌阶段前
  if (hasCap(p, 'shensu') && g.shensuSkipJudgingAndDraw && !g.shensuUsed) {
    g.pending = {
      type: 'shensuChoose2',
      seat: g.turn
    };
    g.phase = 'shensuChoose2';
    g.log = pushLog(g.log, `${p.name} 可以发动【神速2】跳过出牌阶段并弃置装备牌`);
    return;
  }
  
  // 检查神速1效果：如果已经发动神速1并需要跳过判定和摸牌
  if (g.shensuSkipJudgingAndDraw) {
    g.shensuSkipJudgingAndDraw = false;
    // 直接进入出牌阶段
    g.phase = 'play';
    g.log = pushLog(g.log, `${p.name} 【神速1】效果生效，跳过判定和摸牌阶段`);
    return;
  }
  
  // 正常进入判定阶段
  g.phase = 'judge';
  resolveDelayTricks(g, g.turn);
}
```

```javascript
// 在 doDraw 函数结束时添加神速2的触发检查
function doDraw(g) {
  tx(g => {
    if (g.phase !== 'draw' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    
    // ... 正常摸牌逻辑 ...
    const extra = generalCapValue(me, 'extraDrawPhase', 0);
    drawN(g, mySeat, START_HAND + extra);
    
    // 渲染更新
    render();
    
    // 摸牌完成后，检查是否可以发动神速2
    // 条件：有神速技能，且本回合未发动过神速
    if (hasCap(me, 'shensu') && !g.shensuUsed) {
      // 设置神速2发动的 pending
      g.pending = {
        type: 'shensuChoose2',
        seat: mySeat
      };
      g.phase = 'shensuChoose2';
      g.log = pushLog(g.log, `${me.name} 可以发动【神速】跳过出牌阶段并弃置装备牌`);
      return g;
    }
    
    // 检查神速1效果：如果已经发动神速1并跳过摸牌，这里不应该到达
    // 正常进入出牌阶段
    g.phase = 'play';
    return g;
  });
}
```

### 神速选择流程

```javascript
// 发动神速1
function triggerShensu1() {
  tx(g => {
    const seat = g.turn;
    const p = g.players[seat];
    
    if (!p || !p.alive || !hasCap(p, 'shensu') || g.shensuUsed) return g;
    
    // 标记神速已使用
    g.shensuUsed = true;
    
    // 设置跳过判定和摸牌标记
    g.shensuSkipJudgingAndDraw = true;
    
    // 标记需要使用1张无距离限制的杀
    g.shensuShaRemaining = 1;
    
    // 设置杀的目标选择
    g.pending = {
      type: 'shensuSha',
      seat: seat,
      remaining: 1,
      noDistance: true,
      fromShensu: 'shensu1'
    };
    
    g.phase = 'shensuSha';
    g.log = pushLog(g.log, `${p.name} 发动【神速1】,跳过判定和摸牌阶段,需使用1张无距离限制的【杀】`);
    markSkillSound(g, '神速');
    
    return g;
  });
}

// 发动神速2
function triggerShensu2() {
  tx(g => {
    const seat = mySeat;
    const p = g.players[seat];
    
    if (!p || !p.alive || !hasCap(p, 'shensu') || g.shensuUsed) return g;
    
    // 标记神速已使用
    g.shensuUsed = true;
    
    // 检查是否有装备牌可以弃置
    let equipToDiscard = findEquipToDiscard(p);
    if (!equipToDiscard) {
      // 检查手牌中的装备牌
      const equipInHand = findEquipCardInHand(p);
      if (equipInHand !== null) {
        equipToDiscard = { type: 'hand', index: equipInHand };
      }
    }
    
    if (!equipToDiscard) {
      g.log = pushLog(g.log, `${p.name} 没有装备牌可弃置,无法发动【神速2】`);
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 弃置装备牌
    if (equipToDiscard.type === 'equip') {
      discardOneEquip(g, seat, equipToDiscard);
    } else if (equipToDiscard.type === 'hand') {
      discardOneCardFromHand(g, seat, equipToDiscard.index);
    }
    
    // 设置跳过出牌阶段标记
    g.shensuSkipPlay = true;
    
    // 计算需要使用的杀数量
    // 如果已经发动过神速1，那么这是第二刀杀
    const shaCount = g.shensuShaRemaining + 1;
    g.shensuShaRemaining = shaCount;
    
    // 设置杀的目标选择
    g.pending = {
      type: 'shensuSha',
      seat: seat,
      remaining: shaCount,
      noDistance: true,
      fromShensu: g.shensuShaRemaining > 1 ? 'shensu1+2' : 'shensu2'
    };
    
    g.phase = 'shensuSha';
    g.log = pushLog(g.log, `${p.name} 发动【神速2】,跳过出牌阶段并弃置装备牌,需使用${shaCount}张无距离限制的【杀】`);
    markSkillSound(g, '神速');
    
    return g;
  });
}

// 辅助函数：查找要弃置的装备牌（装备区）
function findEquipToDiscard(player) {
  const equips = player.equips || {};
  const slots = ['weapon', 'armor', 'plus1', 'minus1'];
  
  for (const slot of slots) {
    if (equips[slot]) {
      return { type: 'equip', slot, card: equips[slot] };
    }
  }
  return null;
}

// 辅助函数：查找手牌中的装备牌
function findEquipCardInHand(player) {
  const hand = player.hand || [];
  // 装备牌列表
  const equipNames = ['诸葛连弩', '丈八蛇矛', '青釭剑', '麒麟弓', '青龙偃月刀', 
                     '寒冰剑', '方天画戟', '古锭刀', '贯石斧', '的卢', '绝影', 
                     '爪黄飞电', '大宛', '赤兔', '紫骍', '骕骦', '八卦阵', '仁王盾'];
  
  for (let i = 0; i < hand.length; i++) {
    if (hand[i] && equipNames.includes(hand[i].name)) {
      return i; // 返回手牌中的索引
    }
  }
  return null;
}

// 辅助函数：弃置一张装备
function discardOneEquip(g, seat, equipInfo) {
  const player = g.players[seat];
  if (!player || !player.alive) return;
  
  const slot = equipInfo.slot;
  const card = equipInfo.card;
  
  if (player.equips && player.equips[slot] === card) {
    player.equips[slot] = null;
    g.discard.push(card);
    g.log = pushLog(g.log, `${player.name} 弃置了装备牌【${card.name}】`);
  }
}

// 辅助函数：从手牌中弃置一张装备牌
function discardOneCardFromHand(g, seat, cardIndex) {
  const player = g.players[seat];
  if (!player || !player.alive) return;
  
  const card = player.hand[cardIndex];
  if (card) {
    player.hand.splice(cardIndex, 1);
    g.discard.push(card);
    g.log = pushLog(g.log, `${player.name} 弃置了手牌中的装备牌【${card.name}】`);
  }
}
```

### 杀的目标选择和结算

```javascript
// 处理神速杀的目标选择
function respondShensuSha(targetSeat) {
  tx(g => {
    if (g.pending.type !== 'shensuSha' || g.pending.seat !== mySeat) return g;
    
    const me = g.players[mySeat];
    const target = g.players[targetSeat];
    
    if (!target || !target.alive) return g;
    
    // 使用一张无距离限制的普通杀
    const sha = { 
      name: '杀', 
      suit: '♠', 
      rank: 2, 
      id: 'shensu_sha_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)
    };
    
    // 调用标准的杀处理函数，传递无距离标记和不计入次数限制的标记
    const shaInfo = {
      noDistance: true,
      fromShensu: true,
      shensuType: g.pending.fromShensu,
      // 神速的杀不计入出杀次数限制
      skipShaLimit: true
    };
    
    // 专用的神速杀处理函数，不设置 g.shaUsed
    playShensuSha(g, mySeat, targetSeat, sha, shaInfo);
    
    // 减少剩余杀数量
    let remaining = (g.pending.remaining || 1) - 1;
    
    if (remaining > 0) {
      // 更新剩余数量，继续等待选择下一个目标
      g.pending.remaining = remaining;
      g.log = pushLog(g.log, `${me.name} 还需要使用${remaining}张无距离限制的普通【杀】`);
    } else {
      // 完成所有杀的使用
      g.pending = null;
      g.shensuShaRemaining = 0;
      
      // 检查是否需要跳过阶段
      if (g.shensuSkipJudgingAndDraw && g.shensuSkipPlay) {
        // 同时发动了神速1和神速2
        g.shensuSkipJudgingAndDraw = false;
        g.shensuSkipPlay = false;
        g.phase = 'discard';
        g.log = pushLog(g.log, `${me.name} 【神速1+2】效果生效，跳过判定、摸牌和出牌阶段，进入弃牌阶段`);
      } else if (g.shensuSkipJudgingAndDraw) {
        // 只发动了神速1
        g.shensuSkipJudgingAndDraw = false;
        g.phase = 'play';
        g.log = pushLog(g.log, `${me.name} 【神速1】效果生效，跳过判定和摸牌阶段，进入出牌阶段`);
      } else if (g.shensuSkipPlay) {
        // 只发动了神速2
        g.shensuSkipPlay = false;
        g.phase = 'discard';
        g.log = pushLog(g.log, `${me.name} 【神速2】效果生效，跳过出牌阶段，进入弃牌阶段`);
      } else {
        // 正常返回出牌阶段
        g.phase = 'play';
      }
    }
    
    return g;
  });
}

// 专用的神速杀处理函数（不计入出杀次数限制）
function playShensuSha(g, sourceSeat, targetSeat, sha, shaInfo) {
  tx(g => {
    const source = g.players[sourceSeat];
    const target = g.players[targetSeat];
    
    if (!source || !source.alive || !target || !target.alive) return g;
    
    // 记录使用的杀到日志
    g.log = pushLog(g.log, `${source.name} 使用无距离限制的【杀】攻击 ${target.name}`);
    
    // 检查目标是否可以响应
    const canRespond = target.alive && findUsableAs(target.hand, target, '闪').length > 0;
    
    if (canRespond) {
      // 进入响应阶段
      g.pending = {
        type: 'shensuShaRespond',
        sourceSeat: sourceSeat,
        targetSeat: targetSeat,
        sha: sha,
        shaInfo: shaInfo,
        needed: 1,
        played: 0
      };
      g.phase = 'shensuShaRespond';
    } else {
      // 目标无法响应，直接造成伤害
      dealDamage(g, targetSeat, 1, sourceSeat, `${source.name} 的【杀】`, 'sha', sha);
    }
    
    return g;
  });
}

```

---

## 五、渲染集成（render-controls.js）

### 神速1触发UI

```javascript
// 在 renderControls 中添加神速1的触发按钮
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 神速1：在判定阶段开始前的触发点
  if (g.phase === 'shensuChoose1' && g.pending && g.pending.type === 'shensuChoose1' && g.pending.seat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【神速】发动时机</h4>
        <p>你可以发动【神速1】跳过判定和摸牌阶段，视为使用一张无距离限制的【杀】</p>
        <button onclick="triggerShensu1()" class="skill-btn" style="background: #d4a762;">
          发动神速1
        </button>
        <button onclick="skipShensu1()" class="cancel-btn">
          不发动
        </button>
      </div>
    `;
    return;
  }

  // 神速2：在摸牌结束后的触发点
  if (g.phase === 'shensuChoose2' && g.pending && g.pending.type === 'shensuChoose2' && g.pending.seat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【神速】发动时机</h4>
        <p>你可以发动【神速2】跳过出牌阶段并弃置一张装备牌，视为使用一张无距离限制的【杀】</p>
        <button onclick="triggerShensu2()" class="skill-btn" style="background: #d4a762;">
          发动神速2
        </button>
        <button onclick="skipShensu2()" class="cancel-btn">
          不发动
        </button>
      </div>
    `;
    return;
  }

  // 神速杀目标选择
  if (g.pending && g.pending.type === 'shensuSha' && g.pending.seat === seat) {
    const remaining = g.pending.remaining || 1;
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>选择【神速】的目标</h4>
        <p>请选择第${(g.shensuShaRemaining - remaining + 1)}张无距离限制的普通【杀】的目标（还需${remaining}次）</p>
    `;
    
    // 渲染目标选择
    renderShaTargetSelection(g, me, 'respondShensuSha', '无距离限制的【杀】');
    
    ui.innerHTML += `
      <button onclick="cancelShensuSha()" class="cancel-btn">取消</button>
      </div>
    `;
    return;
  }
}

// 跳过神速1
function skipShensu1() {
  tx(g => {
    if (g.pending && g.pending.type === 'shensuChoose1' && g.pending.seat === mySeat) {
      g.pending = null;
      g.phase = 'judge';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 选择不发动【神速1】`);
    }
    return g;
  });
}

// 跳过神速2
function skipShensu2() {
  tx(g => {
    if (g.pending && g.pending.type === 'shensuChoose2' && g.pending.seat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 选择不发动【神速2】`);
    }
    return g;
  });
}

// 取消神速杀选择
function cancelShensuSha() {
  tx(g => {
    if (g.pending && g.pending.type === 'shensuSha' && g.pending.seat === mySeat) {
      g.pending = null;
      g.shensuShaRemaining = 0;
      
      // 检查是否有阶段跳过效果需要处理
      if (g.shensuSkipJudgingAndDraw && g.shensuSkipPlay) {
        g.shensuSkipJudgingAndDraw = false;
        g.shensuSkipPlay = false;
        g.phase = 'discard';
        g.log = pushLog(g.log, `${g.players[mySeat].name} 取消使用【杀】，但【神速1+2】阶段跳过效果仍生效`);
      } else if (g.shensuSkipJudgingAndDraw) {
        g.shensuSkipJudgingAndDraw = false;
        g.phase = 'play';
        g.log = pushLog(g.log, `${g.players[mySeat].name} 取消使用【杀】，但【神速1】阶段跳过效果仍生效`);
      } else if (g.shensuSkipPlay) {
        g.shensuSkipPlay = false;
        g.phase = 'discard';
        g.log = pushLog(g.log, `${g.players[mySeat].name} 取消使用【杀】，但【神速2】阶段跳过效果仍生效`);
      } else {
        g.phase = 'play';
      }
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
  '神速': 'shensu',
};
```

---

## 七、状态字段扩展（normalize）

在 `normalize(g)` 函数的玩家循环中添加：

```javascript
g.players.forEach(p=>{
  if(p){
    // ... 现有字段 ...
  }
});
```

---

## 八、边界条件处理

### 神速技能

1. **场上无其他存活角色**：无距离限制的杀无法指定目标，神速仍可发动，但无法使用杀
2. **无装备牌**：选择神速2时，无法弃置装备牌，神速2无法发动
3. **手牌中有装备牌**：神速2可以弃置手牌中的装备牌
4. **同时发动神速1和神速2**：
   - 先发动神速1：跳过判定和摸牌，使用1张无距离杀
   - 在进入出牌阶段前，再发动神速2：弃置装备，使用第2张无距离杀
   - 最终效果：放弃本回合的判定、摸牌和出牌，消耗一张装备牌，换取两刀无距离限制的【杀】
5. **每回合限一次**：神速整体每回合限发动一次，神速1和神速2可以在同一回合内连续发动
6. **发动顺序**：神速1必须在神速2之前发动（因为神速1在判定阶段前，神速2在摸牌阶段后）

### 无距离限制的杀

1. **目标选择**：可以选择任意存活角色，不受距离限制
2. **连续使用**：同时发动神速1和神速2时，需要连续使用两张无距离限制的杀
3. **杀的性质**：
   - 普通杀（非火杀、非雷杀）
   - 无距离限制，不检查距离
   - 需要正常触发闪的响应流程
4. **取消选择**：如果玩家在选择目标时取消，神速效果仍然生效（阶段跳过），但不会使用杀
5. **不计入出杀次数限制**：**神速的杀不占用每回合出杀次数限制**，即使用神速的杀时**不应设置 `g.shaUsed=true`**
   - 这与借刀杀人、青龙偃月刀等技能类似，属于"视为使用"但不计入配额的情况
   - 这意味着即使本回合已经使用过普通杀，仍然可以发动神速并使用无距离限制的杀
   - 在 `playShaWithTarget` 或相关函数中，需要特别处理神速的杀，跳过 `g.shaUsed=true` 的设置

---

## 九、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| 神速1：准备阶段发动 | 跳过判定和摸牌阶段，视为使用1张无距离限制的杀，然后进入出牌阶段 |
| 神速2：摸牌阶段后发动 | 弃置一张装备牌，视为使用1张无距离限制的杀，然后进入弃牌阶段 |
| 神速1+2：连续发动 | 跳过判定、摸牌和出牌阶段，弃置装备，视为使用2张无距离限制的杀，进入弃牌阶段 |
| 神速：无装备时发动神速2 | 无法发动神速2，提示错误信息 |
| 神速：场上无其他角色 | 可以发动神速，但无法使用杀（无目标），阶段跳过仍然生效 |
| 神速：每回合多次点击 | 仅第一次生效 |
| 神速：使用杀时目标死亡 | 正常结算该杀，然后继续后续流程 |
| 神速：使用第一张杀后取消第二张 | 第一张杀正常使用，神速效果生效，但只使用1张杀 |
| 神速：手牌中有装备牌时发动神速2 | 可以弃置手牌中的装备牌 |
| 神速：神速1发动后正常摸牌 | 不应该发生，神速1应该跳过摸牌阶段 |

---

## 十、实现优先级

1. **核心逻辑优先**：状态标志位的设置和清理
2. **触发时机优先**：在enterDrawPhase和doDraw中添加神速触发检查
3. **阶段跳过优先**：神速1和神速2的阶段跳过逻辑
4. **杀使用优先**：无距离限制的杀的目标选择和使用流程
5. **UI集成优先**：选择界面的渲染和交互
6. **边界处理优先**：无装备、无目标等特殊情况

---

## 十一、集成要点

### 与现有系统的集成

1. **阶段系统**：
   - 复用现有的 `enterDrawPhase`/`doDraw`/`endPlay` 等阶段处理函数
   - 在关键阶段点插入神速的触发检查

2. **杀使用系统**：
   - 复用现有的 `playShaWithTarget` 等杀处理函数
   - 添加 `noDistance: true` 标记以跳过距离检查

3. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程

### 需要修改的文件

1. **data.js**：添加夏侯渊武将定义
2. **game.js**：
   - `normalize()`：添加状态字段防御
   - `startTurn()`：重置神速相关标志位
   - `enterDrawPhase()`：添加神速1的触发和跳过逻辑
   - `doDraw()`：添加神速2的触发逻辑
3. **skills.js**：添加神速技能辅助函数
4. **render-controls.js**：添加神速UI界面
5. **render.js**：可能需要添加状态显示

---

## 十二、流程图

### 神速1流程
```
回合开始 → 准备阶段结束
    ↓
enterDrawPhase: 检查神速1触发条件（判定阶段开始前）
    ↓
玩家选择是否发动神速1
    ↓
发动: 标记shensuUsed=true, shensuSkipJudgingAndDraw=true
    ↓
选择目标使用1张无距离杀
    ↓
杀结算完成
    ↓
shensuSkipJudgingAndDraw=true
    ↓
重新进入enterDrawPhase → 检查shensuSkipJudgingAndDraw
    ↓
✅ 检查神速2第二触发点（神速1已发动，是否继续发动神速2）
    ↓
如果发动神速2 → 弃置装备 → 使用第2张无距离杀 → 进入弃牌阶段
    ↓
如果不发动 → 跳过判定和摸牌阶段，直接进入出牌阶段
```

### 神速2流程
```
doDraw: 摸牌完成
    ↓
检查神速2触发条件（未发动过神速）
    ↓
玩家选择是否发动神速2
    ↓
发动: 弃置装备, 标记shensuUsed=true, shensuSkipPlay=true
    ↓
选择目标使用1张无距离杀（如果神速1已发动，则是第2张）
    ↓
杀结算完成
    ↓
shensuSkipPlay=true
    ↓
doDraw结束后，检查shensuSkipPlay
    ↓
跳过出牌阶段，直接进入弃牌阶段
```

### 神速1+2连续发动流程
```
回合开始 → 准备阶段结束
    ↓
enterDrawPhase: 发动神速1
    ↓
使用1张无距离杀
    ↓
shensuSkipJudgingAndDraw=true
    ↓
重新进入enterDrawPhase
    ↓
✅ 检查神速2第二触发点（神速1已发动）
    ↓
发动神速2
    ↓
弃置装备牌
    ↓
使用第2张无距离杀
    ↓
shensuSkipPlay=true
    ↓
进入弃牌阶段（跳过判定、摸牌和出牌）
```

---

## 十三、特殊说明

### 关于"当前回合"的理解

神速技能的核心特点是**消耗当前正在进行的回合的阶段**，而不是影响下一个回合。这与许多其他技能不同。

- 神速1：在判定阶段开始前发动，跳过**当前回合**的判定和摸牌阶段
- 神速2：在摸牌阶段结束后发动，跳过**当前回合**的出牌阶段

这意味着神速的效果**全部发生在同一个回合内**。

### 关于无距离限制的实现

无距离限制的实现需要在杀的处理函数中跳过距离检查：

```javascript
// 在 resolveShaUse 或相关函数中添加
function resolveShaUse(g, sha, sourceSeat, targetSeat, shaInfo) {
  // 检查是否是神速的杀
  if (shaInfo && shaInfo.noDistance) {
    // 跳过距离检查
    // 直接进行后续处理
    return true; // 可以命中目标
  }
  
  // 原有的距离检查逻辑
  return canReachSha(g, sourceSeat, targetSeat);
}
```

### 关于装备牌的弃置

神速2要求"弃置一张装备牌"，这里的装备牌可以是：
1. 装备区中的装备牌
2. 手牌中的装备牌

需要检查这两个位置来查找可以弃置的装备牌。

---

## 十四、修正记录

### v1.0 → v2.0 修正

**问题**：
1. 最初设计中将神速1理解为"跳过下个回合的判定和摸牌阶段"，这是错误的
2. 武将表条目错误地使用了 `xiahoudun`（夏侯惇的ID）
3. 缺失神速2的第二个触发时机（神速1发动后，即将进入出牌阶段前）

**修正**：根据正确的三国杀规则，神速消耗的是**当前回合**的阶段，而不是下个回合。

**具体变更**：
- 将武将表条目从 `xiahoudun` 修正为 `xiahouyuan`（避免与夏侯惇冲突）
- 将技能描述从"出牌阶段限一次"修正为"每回合限一次"
- 将神速1触发时机描述从"准备阶段结束后"修正为"判定阶段开始前"
- **新增**：在 `enterDrawPhase` 中添加神速2的第二个触发检查（处理 `g.shensuSkipJudgingAndDraw` 之前）
- 将阶段跳过逻辑从"下个回合"更改为"当前回合"
- 重新设计触发时机和流程
- 修正了神速1和神速2的发动时机
- 修正了阶段跳过的逻辑
- 更新流程图，添加神速2第二触发点的说明

---

*文档状态：设计阶段（已按正确规则修正）**  
*创建时间：2026-07-12*  
*修正时间：2026-07-12*  
*负责人：Mistral Vibe*
