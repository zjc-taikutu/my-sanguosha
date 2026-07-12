# 贾诩 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `jiaxu` |
| **武将名称** | 贾诩 |
| **势力** | 群 |
| **性别** | male |
| **体力上限** | 3 |
| **技能** | 完杀 / 乱武 / 帷幕 |

---

## 二、技能说明

### 完杀（锁定技）
**时机**：你的回合内，当一名角色进入濒死状态时

**效果**：
除你和其以外的角色不能对其使用【桃】直到此次濒死结算结束。

**设计要点**：
- 属于**锁定技**，无需玩家操作，自动生效
- 仅在**自己回合内**生效
- 触发时机：角色进入濒死状态（`hp <= 0` 且未死亡）
- 限制对象：除贾诩本人和濒死角色以外的**所有其他角色**
- 限制内容：不能对该濒死角色使用【桃】（包括普通桃、酒桃等所有桃类牌）
- 效果持续：直到此次濒死结算**完全结束**（即该角色被救活或死亡）
- 需要集成到濒死流程中，在濒死结算前设置标志位

### 乱武（限定技）
**时机**：出牌阶段

**效果**：
你可以令所有其他角色依次选择一项：
1. 对距离最近的另一名角色使用一张【杀】
2. 失去1点体力

**设计要点**：
- 属于**限定技**，游戏内只能发动一次
- 发动时机：出牌阶段，主动技能
- 影响范围：**所有其他角色**（即除了贾诩本人外的所有存活角色）
- 执行顺序：**依次**选择（按座位顺序或随机顺序，项目中通常使用座位顺序）
- 选项1：必须对**距离最近的另一名角色**使用【杀】（需检查：是否有杀、距离计算、是否在攻击范围内）
- 选项2：直接失去1点体力（无条件）
- 若角色选择使用杀但无法满足条件（无杀、无合法目标等），则必须选择失去体力
- 需要完整的状态机控制多个角色的依次选择流程

### 帷幕（锁定技）
**时机**：持续生效

**效果**：
你不能成为黑色锦囊牌的目标。

**设计要点**：
- 属于**锁定技**，无需玩家操作，自动生效
- 适用范围：**黑色锦囊牌**（即♠黑桃和♣梅花的锦囊牌）
- 目标限制：贾诩不能被选为这些牌的**使用目标**
- 实现方式：在目标选择阶段过滤掉贾诩
- 需要识别锦囊牌的类型和颜色

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
jiaxu: {
  id: 'jiaxu',
  name: '贾诩',
  gender: 'male',
  maxHp: 3,
  skill: '完杀/乱武/帷幕',
  desc: '完杀:锁定技,你的回合内,当一名角色进入濒死状态时,除你和其以外的角色不能对其使用【桃】直到此次濒死结算结束。乱武:限定技,出牌阶段,你可以令所有其他角色依次选择一项:1.对距离最近的另一名角色使用一张【杀】;2.失去1点体力。帷幕:锁定技,你不能成为黑色锦囊牌的目标。',
  caps: { wansha: true, luanwu: true, weimu: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 贾诩【乱武】:游戏内使用标记（限定技，全局只能使用一次）
if(typeof g.luanwuUsed!=='boolean') g.luanwuUsed=false;

// 贾诩【乱武】:乱武选择阶段
// pending 应包含 type、currentSeat（当前需要选择的角色座位）、remainingSeats（剩余需要选择的角色列表）
if(g.pending && g.pending.type==='luanwuChoose'){
  const d = g.pending;
  if(typeof d.currentSeat!=='number' || !g.players[d.currentSeat] || !g.players[d.currentSeat].alive ||
     !Array.isArray(d.remainingSeats) || d.remainingSeats.length===0){
    g.pending = null;
    g.phase = 'play';
  }
}

// 贾诩【完杀】:回合内濒死状态标记
// 记录当前回合内哪些角色处于濒死状态时触发了完杀
if(typeof g.wanshaActive!=='boolean') g.wanshaActive=false;
if(typeof g.wanshaDyingSeat!=='number') g.wanshaDyingSeat=null;
```

在 `startTurn` 函数中添加重置：
```javascript
// 贾诩完杀：回合开始时重置状态
g.wanshaActive = false;
g.wanshaDyingSeat = null;
```

在 `endTurn` 函数中添加清理：
```javascript
// 贾诩完杀：回合结束时重置状态
g.wanshaActive = false;
g.wanshaDyingSeat = null;
```

---

## 四、技能实现

### 完杀实现

**集成点**：濒死流程 `enterDyingPhase` 或类似函数

```javascript
// 在 enterDyingPhase 函数中添加完杀检查
function enterDyingPhase(g, seat) {
  tx(g => {
    const player = g.players[seat];
    if (!player || !player.alive) return g;
    
    // 设置濒死状态
    player.hp = 0; // 或保持为负
    
    // 贾诩【完杀】：检查是否在贾诩的回合内
    const jiaxuSeat = findPlayerWithCap(g, 'wansha');
    if (jiaxuSeat !== null && jiaxuSeat === g.turn) {
      // 濒死角色进入完杀效果范围
      g.wanshaActive = true;
      g.wanshaDyingSeat = seat;
      g.log = pushLog(g.log, `【完杀】发动,除 ${g.players[jiaxuSeat].name} 和 ${player.name} 以外的角色不能使用【桃】`);
      markSkillSound(g, '完杀');
    }
    
    // 进入濒死结算流程
    // ... 现有的濒死流程
    
    return g;
  });
}
```

```javascript
// 在使用桃的检查中添加完杀限制
function canUsePeach(g, sourceSeat, targetSeat, card) {
  // 检查完杀效果
  if (g.wanshaActive && g.wanshaDyingSeat === targetSeat) {
    const jiaxuSeat = findPlayerWithCap(g, 'wansha');
    if (jiaxuSeat !== null && jiaxuSeat === g.turn) {
      // 只有贾诩和濒死角色自己可以使用桃
      if (sourceSeat !== jiaxuSeat && sourceSeat !== g.wanshaDyingSeat) {
        return false; // 不能使用桃
      }
    }
  }
  
  // 正常判断
  return isCardType(card, '桃') && canUseAs(g.players[sourceSeat], card, '桃');
}
```

```javascript
// 在濒死结算结束后清理完杀状态
function finishDyingPhase(g, seat) {
  tx(g => {
    // ... 现有的濒死结束逻辑
    
    // 清理完杀状态
    if (g.wanshaActive && g.wanshaDyingSeat === seat) {
      g.wanshaActive = false;
      g.wanshaDyingSeat = null;
      g.log = pushLog(g.log, `【完杀】效果结束`);
    }
    
    return g;
  });
}
```

### 乱武实现

**集成点**：`render-controls.js` 添加乱武按钮

```javascript
// 在 renderControls 中添加乱武按钮
function renderControls(g, me) {
  // ... 现有代码 ...

  // 乱武：出牌阶段可以发动（限定技，只能发动一次）
  if (hasCap(me, 'luanwu') && !g.luanwuUsed && g.phase === 'play' && g.turn === mySeat) {
    // 检查是否有其他存活角色
    const otherAliveCount = g.players.filter((p, i) => 
      i !== mySeat && p && p.alive 
    ).length;
    
    if (otherAliveCount > 0) {
      ui.innerHTML += `
        <button onclick="startLuanwu()" class="skill-btn" style="background: #e74c3c;">
          乱武
        </button>
      `;
    }
  }
}
```

```javascript
// 在 skills.js 中添加乱武发动函数
let luanwuTargetMap = {}; // 存储每个角色的最近目标（用于选项1）

function startLuanwu() {
  tx(g => {
    if (g.phase !== 'play' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me || !me.alive || !hasCap(me, 'luanwu') || g.luanwuUsed) return g;
    
    // 标记乱武已使用
    g.luanwuUsed = true;
    
    // 准备乱武选择流程
    // 找出所有其他存活角色
    const otherSeats = [];
    for (let i = 0; i < g.players.length; i++) {
      if (i === mySeat || !g.players[i] || !g.players[i].alive) continue;
      otherSeats.push(i);
    }
    
    if (otherSeats.length === 0) {
      g.log = pushLog(g.log, `${me.name} 发动【乱武】时，场上无其他角色`);
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 为每个角色预计算最近的目标
    const targetMap = {};
    for (const seat of otherSeats) {
      const nearest = findNearestTarget(g, seat, mySeat);
      targetMap[seat] = nearest;
    }
    luanwuTargetMap = targetMap;
    
    // 进入乱武选择阶段，从第一个角色开始
    g.pending = {
      type: 'luanwuChoose',
      currentSeat: otherSeats[0],
      remainingSeats: otherSeats.slice(1),
      sourceSeat: mySeat,
      targetMap: targetMap
    };
    g.phase = 'luanwuChoose';
    g.log = pushLog(g.log, `${me.name} 发动【乱武】,令所有其他角色依次选择`);
    markSkillSound(g, '乱武');
    
    return g;
  });
}

// 辅助函数：找到一个角色距离最近的其他角色（排除自己和源头）
function findNearestTarget(g, seat, excludeSeat) {
  const aliveSeats = g.players.map((p, i) => i).filter(i => 
    g.players[i] && g.players[i].alive && i !== seat && i !== excludeSeat
  );
  
  if (aliveSeats.length === 0) return null;
  
  let nearestSeat = null;
  let minDistance = Infinity;
  
  for (const targetSeat of aliveSeats) {
    const dist = distance(g, seat, targetSeat);
    if (dist < minDistance) {
      minDistance = dist;
      nearestSeat = targetSeat;
    }
  }
  
  return nearestSeat;
}
```

```javascript
// 乱武选择处理
function chooseLuanwuOption(option) {
  tx(g => {
    if (g.pending.type !== 'luanwuChoose') return g;
    
    const currentSeat = g.pending.currentSeat;
    const sourceSeat = g.pending.sourceSeat;
    const currentPlayer = g.players[currentSeat];
    
    if (!currentPlayer || !currentPlayer.alive) {
      // 当前角色已死亡，跳过
      return proceedToNextLuanwu(g);
    }
    
    // 处理选择
    if (option === 'sha') {
      // 尝试使用杀
      const targetSeat = luanwuTargetMap[currentSeat];
      
      if (targetSeat !== null && targetSeat !== currentSeat) {
        const target = g.players[targetSeat];
        
        // 检查是否有杀
        const hasSha = hasShaCard(g, currentSeat);
        
        // 检查距离是否在攻击范围内
        const canAttack = canReachSha(g, currentSeat, targetSeat);
        
        if (hasSha && canAttack) {
          // 使用杀
          useShaForLuanwu(g, currentSeat, targetSeat);
        } else {
          // 不能使用杀，必须失去体力
          loseHpForLuanwu(g, currentSeat);
        }
      } else {
        // 无合法目标，必须失去体力
        loseHpForLuanwu(g, currentSeat);
      }
    } else if (option === 'hp') {
      // 直接失去体力
      loseHpForLuanwu(g, currentSeat);
    }
    
    return g;
  });
}

// 辅助函数：检查角色是否有杀
function hasShaCard(g, seat) {
  const player = g.players[seat];
  if (!player || !player.alive) return false;
  
  // 检查手牌
  const hand = player.hand || [];
  for (const card of hand) {
    if (canUseAs(player, card, '杀')) {
      return true;
    }
  }
  
  // 检查装备区（武器等是否可以转化为杀）
  // 根据项目规则，装备区的武器通常不能直接作为杀使用
  return false;
}

// 使用杀处理
function useShaForLuanwu(g, sourceSeat, targetSeat) {
  const source = g.players[sourceSeat];
  const target = g.players[targetSeat];
  
  if (!source || !source.alive || !target || !target.alive) return g;
  
  // 找到一张杀
  let shaCard = null;
  let shaIndex = -1;
  
  for (let i = 0; i < (source.hand || []).length; i++) {
    if (canUseAs(source, source.hand[i], '杀')) {
      shaCard = source.hand[i];
      shaIndex = i;
      break;
    }
  }
  
  if (!shaCard) return g;
  
  // 移除杀
  source.hand.splice(shaIndex, 1);
  g.discard.push(shaCard);
  
  // 造成伤害
  dealDamage(g, targetSeat, 1, sourceSeat, `${source.name} 的【乱武】效果`, 'luanwu');
  
  g.log = pushLog(g.log, `${source.name} 选择对 ${target.name} 使用【杀】`);
}

// 失去体力处理
function loseHpForLuanwu(g, seat) {
  const player = g.players[seat];
  if (!player || !player.alive) return g;
  
  player.hp--;
  g.log = pushLog(g.log, `${player.name} 选择失去1点体力`);
  
  // 检查是否死亡
  if (player.hp <= 0) {
    enterDyingPhase(g, seat);
  }
}

// 继续下一个角色的乱武选择
function proceedToNextLuanwu(g) {
  if (g.pending.type !== 'luanwuChoose') return g;
  
  const remainingSeats = g.pending.remainingSeats || [];
  
  if (remainingSeats.length > 0) {
    // 还有角色需要选择
    g.pending.currentSeat = remainingSeats[0];
    g.pending.remainingSeats = remainingSeats.slice(1);
    g.phase = 'luanwuChoose';
  } else {
    // 所有角色都选择完毕
    g.pending = null;
    g.phase = 'play';
    g.log = pushLog(g.log, `【乱武】结算完毕`);
    
    // 检查游戏胜负
    checkWin(g);
  }
  
  return g;
}

// 取消乱武
function cancelLuanwu() {
  tx(g => {
    if (g.pending && g.pending.type === 'luanwuChoose' && g.pending.sourceSeat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【乱武】`);
    }
    return g;
  });
}
```

### 帷幕实现

**集成点**：目标选择函数，如 `canTarget` 或类似函数

```javascript
// 在目标选择验证中添加帷幕检查
function canTarget(g, sourceSeat, targetSeat, card) {
  // 贾诩【帷幕】：不能成为黑色锦囊牌的目标
  if (targetSeat === mySeat && hasCap(g.players[mySeat], 'weimu')) {
    // 检查是否为黑色锦囊牌
    if (isBlackTactics(card)) {
      return false; // 不能成为目标
    }
  }
  
  // 正常判断
  return true;
}

// 辅助函数：判断是否为黑色锦囊牌
function isBlackTactics(card) {
  if (!card || !card.suit) return false;
  
  // 黑色：♠黑桃或♣梅花
  const isBlack = card.suit === '♠' || card.suit === '♣';
  
  // 锦囊牌：根据项目定义，锦囊牌通常有特定的类型
  // 假设 CARD_TYPES 或类似对象中定义了锦囊牌
  const isTactics = CARD_TYPES[card.name] === 'tactics' || 
                    CARD_TYPES[card.name] === 'trick' ||
                    isTacticsCard(card.name);
  
  return isBlack && isTactics;
}

// 更准确的锦囊牌判断
function isTacticsCard(cardName) {
  if (!cardName) return false;
  
  // 常见锦囊牌列表
  const tacticsCards = [
    '过河拆桥', '顺手牵羊', '无中生有', '决斗', '借刀杀人',
    '无懈可击', '五谷丰登', '桃园结义', '南蛮入侵', '万箭齐发',
    '调虎离山', '理确κου', '兵粮寸断', '乐不思蜀'
  ];
  
  return tacticsCards.includes(cardName);
}
```

**集成点**：在使用锦囊牌时的目标选择中应用

```javascript
// 在 CARD_PLAYS 中修改锦囊牌的 canPlay 和 effect
// 例如，对于【过河拆桥】：
CARD_PLAYS['过河拆桥'] = {
  canPlay: (g, me, card) => {
    const can = canUseAs(me, card, card.name);
    if (!can) return false;
    
    // 检查目标选择
    // ... 现有逻辑
    
    // 贾诩帷幕：检查所有目标是否包含贾诩
    // 如果 card 为黑色锦囊，且目标包含贾诩，则不能使用
    if (isBlackTactics(card)) {
      const jiaxuSeat = findPlayerWithCap(g, 'weimu');
      if (jiaxuSeat !== null) {
        // 在目标选择中排除贾诩
        return true; // 但实际选择时会过滤掉
      }
    }
    
    return true;
  },
  effect: (g, me, card) => {
    // ... 现有逻辑
  }
};
```

---

## 五、渲染集成（render-controls.js）

### 完杀状态显示

```javascript
// 在 renderStatus 中显示完杀状态
function renderStatus(g, me) {
  if (g.wanshaActive && g.wanshaDyingSeat !== null) {
    const dyingPlayer = g.players[g.wanshaDyingSeat];
    const jiaxuSeat = findPlayerWithCap(g, 'wansha');
    if (jiaxuSeat !== null && jiaxuSeat === g.turn) {
      ui.innerHTML += `
        <div class="skill-status">
          <span style="color: #e74c3c;">【完杀】: 除 ${g.players[jiaxuSeat].name} 和 ${dyingPlayer.name} 以外的角色不能使用【桃】</span>
        </div>
      `;
    }
  }
}
```

### 乱武 UI 集成

```javascript
// 在 renderControls 中添加乱武相关状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 乱武：选择阶段（当前选择的角色）
  if (g.pending && g.pending.type === 'luanwuChoose' && g.pending.currentSeat === seat) {
    const sourcePlayer = g.players[g.pending.sourceSeat];
    const nearestSeat = luanwuTargetMap[seat];
    const nearestPlayer = nearestSeat !== null && nearestSeat !== seat ? g.players[nearestSeat] : null;
    
    // 检查是否有杀
    const hasSha = hasShaCard(g, seat);
    // 检查距离
    const canAttack = nearestSeat !== null && canReachSha(g, seat, nearestSeat);
    const shaAvailable = hasSha && canAttack && nearestPlayer && nearestPlayer.alive;
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>${sourcePlayer.name} 发动【乱武】</h4>
        <p>请选择：</p>
    `;
    
    // 选项1：使用杀（如果可行）
    if (shaAvailable) {
      ui.innerHTML += `
        <button onclick="chooseLuanwuOption('sha')" class="skill-btn" style="background: #e74c3c;">
          对 ${nearestPlayer.name} 使用【杀】
        </button>
      `;
    }
    
    // 选项2：失去体力
    ui.innerHTML += `
        <button onclick="chooseLuanwuOption('hp')" class="skill-btn" style="background: #8e44ad;">
          失去1点体力
        </button>
    `;
    
    // 如果选项1不可行，只能选择选项2
    if (!shaAvailable) {
      ui.innerHTML += `
        <p style="color: #7f8c8d;">（无法使用杀，只能选择失去体力）</p>
      `;
    }
    
    ui.innerHTML += `
      </div>
    `;
    return;
  }
}

// 在 render 中显示乱武状态
function render(g) {
  // ... 现有渲染逻辑
  
  // 乱武进行中
  if (g.pending && g.pending.type === 'luanwuChoose') {
    const currentSeat = g.pending.currentSeat;
    const currentPlayer = g.players[currentSeat];
    if (currentPlayer && currentPlayer.alive) {
      // 突出显示当前需要选择的角色
      // ... 突出显示逻辑
    }
  }
}
```

### 帷幕状态显示

```javascript
// 在 renderControls 中提示帷幕效果
function renderControls(g, me) {
  // ... 现有代码
  
  // 如果当前使用的牌是黑色锦囊，提示不能选择贾诩
  if (g.pending && g.pending.type === 'cardTargetSelect' && g.pending.card) {
    const card = g.pending.card;
    if (isBlackTactics(card)) {
      const jiaxuSeat = findPlayerWithCap(g, 'weimu');
      if (jiaxuSeat !== null && jiaxuSeat !== mySeat) {
        ui.innerHTML += `
          <div class="skill-hint">
            <span style="color: #7f8c8d;">（${g.players[jiaxuSeat].name} 因【帷幕】不能成为目标）</span>
          </div>
        `;
      }
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
  '完杀': 'wansha',
  '乱武': 'luanwu',
  '帷幕': 'weimu',
};
```

---

## 七、边界条件处理

### 完杀

1. **非贾诩回合**：完杀不触发，任何角色都可以使用桃
2. **贾诩死亡**：完杀效果消失
3. **濒死角色死亡**：完杀效果在濒死结算结束后自动清理
4. **多名角色濒死**：完杀效果只针对**当前**进入濒死状态的角色
5. **桃的类型**：所有桃类牌（普通桃、酒桃等）都受限制
6. **贾诩自己使用桃**：允许，完杀不限制贾诩本人
7. **濒死角色使用桃**：允许，完杀不限制濒死角色本人
8. **同一回合多次濒死**：完杀效果在每次濒死时独立触发

### 乱武

1. **无其他角色**：乱武按钮不显示
2. **场上只有1名其他角色**：该角色必须选择使用杀或失去体力
3. **角色无法使用杀**：
   - 无杀：必须选择失去体力
   - 无合法目标：必须选择失去体力
   - 目标已死亡：必须选择失去体力
4. **使用杀时的限制**：
   - 需要有杀
   - 需要在攻击范围内
   - 目标必须是距离最近的角色
5. **失去体力时的处理**：
   - 体力直接减少，可能触发濒死
   - 濒死结算完成后继续乱武流程
6. **乱武进行中角色死亡**：
   - 当前选择的角色死亡：跳过，继续下一个
   - 源头（贾诩）死亡：乱武中断，清理状态
7. **限定技使用**：全局只能使用一次，游戏重新开始后重置
8. **座位顺序**：按座位顺序依次选择，确保公平

### 帷幕

1. **非黑色锦囊**：不受帷幕影响（红色锦囊、基本牌、装备牌等都可以选择贾诩）
2. **非锦囊的黑色牌**：不受帷幕影响（如黑色基本牌、黑色装备牌）
3. **贾诩作为使用者**：帷幕是防护技能，贾诩使用黑色锦囊牌不受影响
4. **多个贾诩**：每个贾诩的帷幕独立生效
5. **目标选择界面**：在选择目标时自动过滤掉贾诩（不显示贾诩作为可选目标）
6. **锦囊牌的识别**：确保正确识别所有锦囊牌类型

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **完杀** |
| 完杀：贾诩回合内，其他角色濒死，第三方使用桃 | 不能使用桃，提示受到完杀限制 |
| 完杀：贾诩回合内，其他角色濒死，贾诩使用桃 | 可以使用桃 |
| 完杀：贾诩回合内，其他角色濒死，濒死角色自己使用桃 | 可以使用桃 |
| 完杀：非贾诩回合，其他角色濒死 | 任何角色都可以使用桃 |
| 完杀：贾诩回合内，多名角色濒死 | 每个濒死角色独立触发完杀效果 |
| 完杀：贾诩死亡后，完杀效果 | 完杀效果消失 |
| **乱武** |
| 乱武：正常发动，所有其他角色选择使用杀 | 每个角色对最近目标使用杀，造成伤害 |
| 乱武：正常发动，所有其他角色选择失去体力 | 每个角色失去1点体力 |
| 乱武：角色无杀，选择使用杀 | 强制失去体力 |
| 乱武：角色有杀但无合法目标 | 强制失去体力 |
| 乱武：场上只有贾诩 | 按钮不显示 |
| 乱武：场上只有贾诩和1名其他角色 | 该角色必须选择使用杀或失去体力 |
| 乱武：角色选择失去体力后死亡 | 进入濒死流程，完成后继续乱武 |
| 乱武：贾诩死亡 | 乱武中断 |
| 乱武：每局游戏发动2次 | 仅第一次生效，第二次按钮不显示 |
| **帷幕** |
| 帷幕：使用黑色锦囊牌，选择贾诩为目标 | 不能选择贾诩 |
| 帷幕：使用红色锦囊牌，选择贾诩为目标 | 可以选择贾诩 |
| 帷幕：使用黑色基本牌，选择贾诩为目标 | 可以选择贾诩 |
| 帷幕：贾诩使用黑色锦囊牌 | 可以正常使用 |
| 帷幕：多个贾诩，使用黑色锦囊 | 所有贾诩都不能被选为目标 |
| **组合测试** |
| 完杀+乱武：贾诩回合发动乱武，导致角色濒死 | 乱武继续，完杀效果在濒死结算时生效 |
| 乱武+帷幕：乱武中使用黑色锦囊牌 | 不能选择贾诩为目标 |
| 三技能联动：贾诩回合发动乱武，自己使用黑色锦囊 | 乱武正常进行，帷幕保护自己不被选为目标 |

---

## 九、实现优先级

1. **帷幕优先**：锁定技，仅需要在目标选择时过滤，实现最简单
2. **完杀优先**：锁定技，需要集成到濒死流程中，涉及状态管理
3. **乱武优先**：限定技，涉及复杂的多角色选择流程和状态机
4. **状态管理优先**：确保完杀和乱武的状态标志位正确设置和清理
5. **UI集成优先**：乱武的选择界面和完杀的状态显示
6. **边界处理优先**：无目标、死亡、消耗不足等特殊情况

---

## 十、集成要点

### 与现有系统的集成

1. **濒死系统**：
   - 复用现有的 `enterDyingPhase` 和 `finishDyingPhase` 流程
   - 在濒死流程中集成完杀的检查和状态设置

2. **目标选择系统**：
   - 修改目标选择验证函数，集成帷幕的过滤逻辑
   - 确保黑色锦囊牌不能选择贾诩

3. **伤害系统**：
   - 复用现有的 `dealDamage` 函数处理乱武中的杀伤害
   - 确保乱武的伤害来源和类型正确标记

4. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制乱武的多步流程
   - 在 `normalize` 中初始化状态字段

5. **距离计算系统**：
   - 复用现有的 `distance` 函数计算最近目标
   - 确保乱武中选择的目标是距离最近的角色

### 需要修改的文件

1. **data.js**：添加贾诩武将定义
2. **game.js**：
   - `normalize()`：添加状态字段防御
   - `startTurn()`：重置完杀相关标志位
   - `endTurn()`：清理完杀状态
   - `enterDyingPhase()`：集成完杀触发
   - `finishDyingPhase()`：清理完杀状态
   - `canTarget()` 或类似函数：集成帷幕过滤
3. **skills.js**：添加乱武、完杀、帷幕技能辅助函数
4. **render-controls.js**：添加乱武UI界面和状态显示
5. **render.js**：添加完杀和帷幕的状态显示

---

## 十一、流程图

### 完杀效果流程
```
贾诩回合开始
    ↓
其他角色进入濒死状态
    ↓
检查是否在贾诩回合内
    ↓
是：设置 g.wanshaActive = true
    ↓
设置 g.wanshaDyingSeat = 濒死角色座位
    ↓
濒死结算开始
    ↓
其他角色尝试使用桃
    ↓
检查是否受到完杀限制（非贾诩且非濒死角色）
    ↓
是：拒绝使用桃
    ↓
否：允许使用桃
    ↓
濒死结算结束
    ↓
清理 g.wanshaActive 和 g.wanshaDyingSeat
    ↓
回到正常流程
```

### 乱武完整流程
```
贾诩出牌阶段
    ↓
玩家点击【乱武】按钮
    ↓
检查是否已使用过乱武（g.luanwuUsed）
    ↓
未使用：设置 g.luanwuUsed = true
    ↓
找出所有其他存活角色
    ↓
为每个角色计算距离最近的目标
    ↓
设置 pending 为 luanwuChoose 状态
    ↓
从第一个角色开始选择
    ↓
角色选择：使用杀 或 失去体力
    ↓
  ┌─ 使用杀 → 检查是否有杀且在攻击范围内
  │      ↓
  │    是：使用杀，造成伤害
  │      ↓
  │    否：强制失去体力
  │
  └─ 失去体力 → 直接失去1点体力（可能触发濒死）
    ↓
检查是否有下一个角色
    ↓
是：继续下一个角色的选择
    ↓
否：清理状态，回到出牌阶段
```

### 帷幕效果流程
```
使用黑色锦囊牌
    ↓
选择目标时
    ↓
检查目标是否为贾诩
    ↓
是：检查是否为黑色锦囊牌
    ↓
是：过滤掉贾诩（不能选为目标）
    ↓
否：允许选择
    ↓
否：允许选择
```

---

## 十二、特殊说明

### 关于完杀的触发时机

完杀的触发时机是**你的回合内，当一名角色进入濒死状态时**，这意味着：
- 必须是贾诩的回合（从回合开始到回合结束）
- 必须是角色**进入**濒死状态（hp ≤ 0 且未死亡）
- 触发后，效果持续到该次濒死**完全结算结束**
- 每次有角色进入濒死状态时都会独立触发完杀效果

### 关于乱武的执行顺序

乱武令**所有其他角色依次选择**，这意味着：
- 按照一定的顺序（项目中使用座位顺序）依次进行
- 每个角色必须选择一个选项（使用杀或失去体力）
- 如果角色无法使用杀（无杀、无目标等），则必须选择失去体力
- 前一个角色的选择可能会影响后续角色的选择（如目标死亡、自己死亡等）

### 关于帷幕的适用范围

帷幕的效果是**你不能成为黑色锦囊牌的目标**，这意味着：
- 仅适用于**黑色**（♠黑桃、♣梅花）的**锦囊牌**
- 不适用于红色锦囊牌
- 不适用于非锦囊的黑色牌（基本牌、装备牌等）
- 仅防护贾诩**成为目标**，不影响贾诩使用黑色锦囊牌

### 关于限定技的实现

乱武是**限定技**，意味着：
- 整个游戏内只能发动一次
- 需要全局状态标志位 `g.luanwuUsed`
- 该标志位在游戏开始时初始化为 false
- 发动后设置为 true，直到游戏结束

---

## 十三、修正记录

*文档状态：设计阶段*
*创建时间：2026-07-12*
*负责人：Mistral Vibe*

### 待实装项

- [ ] **data.js**: 添加贾诩武将定义
- [ ] **game.js**: 
  - [ ] normalize函数：添加状态字段防御
  - [ ] startTurn函数：重置完杀状态
  - [ ] endTurn函数：清理完杀状态
  - [ ] enterDyingPhase函数：集成完杀触发
  - [ ] finishDyingPhase函数：清理完杀状态
  - [ ] canTarget函数：集成帷幕过滤
- [ ] **skills.js**: 
  - [ ] 完杀辅助函数
  - [ ] 乱武发动函数
  - [ ] 乱武选择处理函数
  - [ ] 帷幕目标过滤函数
- [ ] **render-controls.js**: 
  - [ ] 乱武按钮和选择界面
  - [ ] 完杀状态显示
  - [ ] 帷幕效果提示
- [ ] **render.js**: 乱武状态显示

### 待优化项

- 音效文件：需要添加assets/audio/wansha.mp3、assets/audio/luanwu.mp3、assets/audio/weimu.mp3
- UI/UX：乱武选择界面的用户体验优化
- 性能：乱武中多角色选择时的性能优化
