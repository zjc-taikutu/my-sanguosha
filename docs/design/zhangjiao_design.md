# 张角 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `zhangjiao` |
| **武将名称** | 张角 |
| **势力** | 群 |
| **性别** | male |
| **体力上限** | 3 |
| **技能** | 雷击 / 鬼道 |

---

## 二、技能说明

### 雷击
**时机**：当你使用或打出【闪】时

**效果**：
1. 你可以令一名角色进行一次判定
2. 若结果为♠黑桃，你对其造成2点雷电伤害

**设计要点**：
- 属于**使用或打出闪后的触发技能**，需要集成到闪的使用/打出流程中
- 判定结果只检查花色是否为♠黑桃
- 伤害类型为**雷电伤害**（需要区分伤害类型）
- 可以选择是否发动，可以选择目标角色
- 发动后需要进入判定流程，支持鬼才等改判技能

### 鬼道
**时机**：当一名角色的判定牌生效前

**效果**：
你可以打出一张黑色牌替换之。

**设计要点**：
- 触发时机：判定牌**生效前**（即判定结果即将应用时）
- 可以替换任何判定牌（包括延时锦囊、技能判定等）
- 替换条件：打出一张**黑色牌**（♠黑桃或♣梅花）
- 需要集成到现有的判定改判系统中（与鬼才类似）
- **改判顺序**：从当前回合角色开始，按逆时针座次顺序依次询问
- **后手优势**：后发动的改判技能会覆盖之前的改判结果

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
zhangjiao: {
  id: 'zhangjiao',
  name: '张角',
  gender: 'male',
  maxHp: 3,
  skill: '雷击/鬼道',
  desc: '雷击:当你使用或打出【闪】时,你可以令一名角色进行一次判定,若结果为♠,你对其造成2点雷电伤害。鬼道:当一名角色的判定牌生效前,你可以打出一张黑色牌替换之。',
  caps: { leiji: true, guidu: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 张角【雷击】:使用或打出闪后的雷击选择阶段
// pending 应包含 type、sourceSeat（张角的座位）、availableTargets（可选目标列表）
if(g.pending && g.pending.type==='leijiChoose'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     !Array.isArray(d.availableTargets) || d.availableTargets.length===0 ||
     d.sourceSeat !== mySeat){
    g.pending = null;
    g.phase = 'play';
  }
}

// 张角【雷击】:雷击判定阶段
// pending 应包含 type、sourceSeat、targetSeat（判定目标）、resume（返回信息）
if(g.pending && g.pending.type==='leijiJudge'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
     !d.resume || typeof d.resume.kind!=='string'){
    g.pending = null;
    g.phase = 'play';
  }
}

// 张角【鬼道】:询问是否发动鬼道阶段
// pending 应包含 type、sourceSeat（当前询问的张角座位）、judgedSeat（判定角色的座位）、judgeCard（原判定牌）、resume（返回信息）
// askedSeats（已询问的座位列表）
if(g.pending && g.pending.type==='guiduAsk'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.judgedSeat!=='number' || !g.players[d.judgedSeat] || !g.players[d.judgedSeat].alive ||
     !d.judgeCard || !d.judgeCard.suit ||
     !d.resume || typeof d.resume.kind!=='string' ||
     !Array.isArray(d.askedSeats)){
    g.pending = null;
    g.phase = 'play';
  }
}
```

---

## 四、技能实现

### 雷击实现

**集成点**：闪的使用/打出流程，包括 `respondShan` 和 `useCard` 等函数

```javascript
// 在 respondShan 函数中添加雷击触发检查
function respondShan(g, seat, to, card) {
  tx(g => {
    // ... 现有的闪抵消逻辑 ...
    
    // 雷击触发：当张角使用或打出闪时
    if(g.players[seat] && hasCap(g.players[seat], 'leiji') && card && getCardType(card) === '闪'){
      // 进入雷击选择阶段
      const aliveSeats = [];
      for(let i = 0; i < g.players.length; i++){
        if(g.players[i] && g.players[i].alive && i !== seat){
          aliveSeats.push(i);
        }
      }
      
      if(aliveSeats.length > 0){
        g.pending = {
          type: 'leijiChoose',
          sourceSeat: seat,
          availableTargets: aliveSeats,
          shanCard: card
        };
        g.phase = 'leijiChoose';
        g.log = pushLog(g.log, `${g.players[seat].name} 可以发动【雷击】,选择一名角色进行判定`);
        markSkillSound(g, '雷击');
        return g;
      }
    }
    
    return g;
  });
}
```

```javascript
// 雷击选择目标函数
function triggerLeiji(targetSeat) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'leijiChoose' || pending.sourceSeat !== mySeat) return g;
    
    if(!pending.availableTargets.includes(targetSeat)) return g;
    
    const source = g.players[mySeat];
    const target = g.players[targetSeat];
    
    if (!source || !source.alive || !target || !target.alive) return g;
    
    // 进入雷击判定阶段
    g.pending = {
      type: 'leijiJudge',
      sourceSeat: mySeat,
      targetSeat: targetSeat,
      resume: { kind: 'leijiJudge', sourceSeat: mySeat, targetSeat: targetSeat }
    };
    g.phase = 'leijiJudge';
    g.log = pushLog(g.log, `${source.name} 对 ${target.name} 发动【雷击】,进行判定`);
    
    return g;
  });
}
```

```javascript
// 雷击判定处理函数
function doLeijiJudge(g) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'leijiJudge') return g;
    
    const { sourceSeat, targetSeat, resume } = pending;
    const source = g.players[sourceSeat];
    const target = g.players[targetSeat];
    
    if (!source || !source.alive || !target || !target.alive) {
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
    
    // 检查判定结果
    if(judgeCard.suit === '♠'){
      // 造成2点雷电伤害
      dealDamage(g, targetSeat, 2, sourceSeat, `${source.name} 的【雷击】效果`, 'leiji');
      g.log = pushLog(g.log, `${target.name} 判定为${judgeCard.suit}${rankText(judgeCard.rank)},受到2点雷电伤害`);
    } else {
      g.log = pushLog(g.log, `${target.name} 判定为${judgeCard.suit}${rankText(judgeCard.rank)},【雷击】无效`);
    }
    
    // 清理状态
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}
```

```javascript
// 取消雷击
function cancelLeiji() {
  tx(g => {
    if (g.pending && (g.pending.type === 'leijiChoose' || g.pending.type === 'leijiJudge') &&
        g.pending.sourceSeat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【雷击】`);
    }
    return g;
  });
}
```

### 鬼道实现

**集成点**：判定系统，需要修改 `maybeGuicai` 函数或创建新的 `maybeGuidu` 函数

```javascript
// 鬼道改判函数：当判定牌即将生效时，检查是否有张角可以发动鬼道
// 遵循规则：从当前回合角色开始，按逆时针座次顺序依次询问
function maybeGuidu(g, judgedSeat, judgeCard, resume) {
  // 获取当前回合角色
  const currentTurn = g.turn;
  const n = g.players.length;
  
  // 从当前回合角色开始，逆时针方向（即座位递减方向）寻找有资格的张角
  // 座位顺序：0,1,2,3... -> 逆时针：currentTurn, (currentTurn-1+n)%n, (currentTurn-2+n)%n...
  for(let k = 0; k < n; k++){
    const s = (currentTurn - k + n) % n;
    const p = g.players[s];
    
    if(p && p.alive && hasCap(p, 'guidu')) {
      // 检查是否有黑色手牌可以打出
      const hand = p.hand || [];
      for(const card of hand){
        if(card.suit === '♠' || card.suit === '♣'){
          // 找到第一个有资格的张角
          g.pending = {
            type: 'guiduAsk',
            sourceSeat: s,
            judgedSeat: judgedSeat,
            judgeCard: judgeCard,
            resume: resume,
            // 用于继续询问下一个张角
            askedSeats: [],
            nextAskIndex: 0
          };
          g.phase = 'guiduAsk';
          g.log = pushLog(g.log, `询问 ${p.name} 是否发动【鬼道】替换 ${g.players[judgedSeat].name} 的判定牌`);
          return 'pending';
        }
      }
    }
  }
  
  return null;
}
```

```javascript
// 鬼道选择替换牌函数
function triggerGuidu(cardIndex) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'guiduAsk' || pending.sourceSeat !== mySeat) return g;
    
    const source = g.players[mySeat];
    const judgedSeat = pending.judgedSeat;
    const judgeCard = pending.judgeCard;
    const resume = pending.resume;
    
    if (!source || !source.alive || !source.hand || cardIndex >= source.hand.length) return g;
    
    const replaceCard = source.hand[cardIndex];
    
    // 检查是否为黑色牌
    if(replaceCard.suit !== '♠' && replaceCard.suit !== '♣') {
      g.log = pushLog(g.log, `${source.name} 只能打出黑色牌发动【鬼道】`);
      // 继续询问下一个张角
      return askNextGuidu(g);
    }
    
    // 打出黑色牌
    source.hand.splice(cardIndex, 1);
    g.discard.push(replaceCard);
    
    g.log = pushLog(g.log, `${source.name} 发动【鬼道】,用【${replaceCard.name}】替换判定牌`);
    markSkillSound(g, '鬼道');
    
    // 记录已询问的座位
    if(!pending.askedSeats) pending.askedSeats = [];
    pending.askedSeats.push(mySeat);
    
    // 继续询问下一个张角（支持后手优势）
    return askNextGuidu(g, replaceCard);
  });
}

// 询问下一个张角的函数
function askNextGuidu(g, currentReplaceCard = null) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'guiduAsk') {
      if(currentReplaceCard) {
        // 没有其他张角需要询问，使用当前替换牌作为最终判定牌
        return finishGuidu(g, pending.judgedSeat, currentReplaceCard, pending.resume);
      }
      return g;
    }
    
    const currentTurn = g.turn;
    const n = g.players.length;
    const judgedSeat = pending.judgedSeat;
    const askedSeats = pending.askedSeats || [];
    
    // 从当前回合角色开始，逆时针寻找下一个有资格的张角
    for(let k = 0; k < n; k++){
      const s = (currentTurn - k + n) % n;
      const p = g.players[s];
      
      // 跳过已经询问过的
      if(askedSeats.includes(s)) continue;
      
      if(p && p.alive && hasCap(p, 'guidu')) {
        // 检查是否有黑色手牌可以打出
        const hand = p.hand || [];
        for(const card of hand){
          if(card.suit === '♠' || card.suit === '♣'){
            // 找到下一个有资格的张角
            pending.askedSeats = askedSeats;
            pending.sourceSeat = s;
            g.phase = 'guiduAsk';
            g.log = pushLog(g.log, `询问 ${p.name} 是否发动【鬼道】替换 ${g.players[judgedSeat].name} 的判定牌`);
            return g;
          }
        }
        // 标记为已询问（但无黑色牌）
        askedSeats.push(s);
      }
    }
    
    // 没有其他张角需要询问
    if(currentReplaceCard) {
      // 使用当前替换牌作为最终判定牌
      g.pending = null;
      return finishGuidu(g, pending.judgedSeat, currentReplaceCard, pending.resume);
    } else {
      // 无人发动鬼道
      g.pending = null;
      g.phase = 'play';
      return g;
    }
  });
}
```

```javascript
// 鬼道替换后的处理函数
function finishGuidu(g, judgedSeat, replaceCard, resume) {
  // 使用替换后的牌作为判定结果
  // 调用对应的判定处理函数
  
  if(resume.kind === 'bagua'){
    // 八卦阵判定
    return finishBaguaColor(g, judgedSeat, replaceCard);
  } else if(resume.kind === 'delayJudge'){
    // 延时锦囊判定
    return finishDelayCard(g, judgedSeat, DELAY_TRICKS[resume.trickName], replaceCard, resume.card);
  } else if(resume.kind === 'tieqiJudge'){
    // 铁骑判定
    return finishTieqiJudge(g, resume.from, resume.to, replaceCard, resume.sourceCard, undefined);
  } else if(resume.kind === 'luoshenJudge'){
    // 洛神判定
    return finishLuoshenJudge(g, resume.seat, replaceCard);
  } else if(resume.kind === 'shuangxiongJudge'){
    // 双雄判定
    return finishShuangxiongJudge(g, resume.seat, replaceCard);
  } else if(resume.kind === 'ganglieJudge'){
    // 刚烈判定
    return finishGanglieJudge(g, replaceCard, resume.seat, resume.sourceSeat, resume.resume);
  } else if(resume.kind === 'leijiJudge'){
    // 雷击判定（特殊情况）
    const { sourceSeat, targetSeat } = resume;
    const target = g.players[targetSeat];
    if(replaceCard.suit === '♠'){
      dealDamage(g, targetSeat, 2, sourceSeat, `${g.players[sourceSeat].name} 的【雷击】效果`, 'leiji');
      g.log = pushLog(g.log, `${target.name} 被替换判定为${replaceCard.suit}${rankText(replaceCard.rank)},受到2点雷电伤害`);
    } else {
      g.log = pushLog(g.log, `${target.name} 被替换判定为${replaceCard.suit}${rankText(replaceCard.rank)},【雷击】无效`);
    }
  }
  
  // 清理状态
  g.pending = null;
  g.phase = 'play';
  
  return g;
}
```

```javascript
// 取消鬼道
function cancelGuidu() {
  tx(g => {
    if (g.pending && g.pending.type === 'guiduAsk' && g.pending.sourceSeat === mySeat) {
      const pending = g.pending;
      // 记录已询问的座位
      if(!pending.askedSeats) pending.askedSeats = [];
      pending.askedSeats.push(mySeat);
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【鬼道】`);
      // 继续询问下一个张角
      return askNextGuidu(g);
    }
    return g;
  });
}
```

**修改现有判定函数**：
需要在所有判定入口处调用 `maybeGuidu` 检查是否可以发动鬼道。

**重要**：由于存在后手优势，所有改判技能（包括鬼道和鬼才）应该使用相同的询问逻辑，遵循"从当前回合角色开始，按逆时针座次顺序"的原则。

```javascript
// 修改 maybeGuicai 函数，集成所有改判技能的统一询问逻辑
// 所有改判技能（鬼道、鬼才等）都应使用相同的顺序规则
function maybeGuicai(g, judgedSeat, card, resume) {
  // 先检查鬼道（但所有改判都应使用相同的顺序规则）
  if(maybeGuidu(g, judgedSeat, card, resume) === 'pending') return 'pending';
  
  // 然后是原有的鬼才逻辑
  const asker = firstGuicaiAsker(g, judgedSeat);
  if(asker === null) return null;
  
  g.pending = {type:'guicai', seat:judgedSeat, asking:asker, judgeCard:card, resume};
  g.phase='guicai';
  g.log=pushLog(g.log, g.players[judgedSeat].name+' 判定得到 '+card.suit+rankText(card.rank)+',询问 '+g.players[asker].name+' 是否发动【鬼才】替换判定牌…');
  return 'pending';
}

// 说明：由于后手优势，如果张角和司马懿同时存在，且张角在司马懿之后被询问：
// 1. 先询问司马懿是否发动【鬼才】
// 2. 如果司马懿发动，使用他的手牌替换判定牌
// 3. 然后继续询问张角是否发动【鬼道】（后手优势）
// 4. 如果张角发动【鬼道】，用黑色牌覆盖司马懿的替换牌
// 5. 最终判定结果以最后一个发动改判技能的牌为准
```

---

## 五、渲染集成（render-controls.js）

### 雷击 UI 集成

```javascript
// 在 renderControls 中添加雷击相关状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 雷击：使用或打出闪后的触发选择
  if (g.pending && g.pending.type === 'leijiChoose' && g.pending.sourceSeat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【雷击】发动</h4>
        <p>你使用或打出了【闪】,可以选择一名角色进行判定</p>
        <p>若判定为♠黑桃,你将对其造成2点雷电伤害</p>
        <div class="target-options">
    `;
    
    // 渲染可选目标
    for (const targetSeat of g.pending.availableTargets) {
      const target = g.players[targetSeat];
      if (target && target.alive) {
        ui.innerHTML += `
          <button onclick="triggerLeiji(${targetSeat})" class="target-btn">
            选择 ${target.name}
          </button>
        `;
      }
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelLeiji()" class="cancel-btn">
          不发动
        </button>
      </div>
    `;
    return;
  }

  // 雷击：判定阶段（等待判定结果）
  if (g.pending && g.pending.type === 'leijiJudge' && g.pending.sourceSeat === seat) {
    const target = g.players[g.pending.targetSeat];
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【雷击】判定中</h4>
        <p>等待 ${target.name} 的判定结果...</p>
        <button onclick="doLeijiJudge()" class="skill-btn" style="background: #f39c12;">
          进行判定
        </button>
      </div>
    `;
    return;
  }
}
```

### 鬼道 UI 集成

```javascript
// 在 renderControls 中添加鬼道相关状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 鬼道：替换判定牌选择
  if (g.pending && g.pending.type === 'guiduAsk' && g.pending.sourceSeat === seat) {
    const judgedPlayer = g.players[g.pending.judgedSeat];
    const judgeCard = g.pending.judgeCard;
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【鬼道】发动</h4>
        <p>${judgedPlayer.name} 判定得到 ${judgeCard.suit}${rankText(judgeCard.rank)}</p>
        <p>你可以打出一张黑色牌替换之</p>
        <div class="hand-options">
    `;
    
    // 渲染可选黑色手牌
    const hand = p.hand || [];
    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      if (card.suit === '♠' || card.suit === '♣') {
        ui.innerHTML += `
          <button onclick="triggerGuidu(${i})" class="card-btn" style="background: #2c3e50; color: white;">
            打出【${card.name}】(${card.suit}${rankText(card.rank)})
          </button>
        `;
      }
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelGuidu()" class="cancel-btn">
          不发动
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
  '雷击': 'leiji',
  '鬼道': 'guidu',
};
```

---

## 七、边界条件处理

### 雷击


2. **目标死亡**：在判定前验证目标是否存活，死亡则取消

4. **非♠结果**：只有♠黑桃才触发伤害，其他花色无效
5. **伤害类型**：雷电伤害需要特殊处理（可能影响某些技能的触发）
6. **连锁触发**：每次使用或打出闪都可以独立触发雷击
7. **多个目标**：可以对同一角色多次发动雷击

### 鬼道

1. **无黑色手牌**：若张角手牌中没有黑色牌，鬼道不能发动
2. **多个张角**：若场上有多个张角，按座位顺序依次询问
3. **判定牌生效时机**：只在判定牌**生效前**可以替换
4. **替换后的判定**：使用张角打出的黑色牌作为新的判定牌
5. **与鬼才共存**：后手优势 - 若司马懿先发动【鬼才】改判，张角后发动【鬼道】可用黑色牌覆盖司马懿的判定牌
6. **判定者自己发动**：
7. **黑色牌的定义**：♠黑桃和♣梅花的牌都算黑色牌
8. **任意判定**：可以替换任何判定牌（技能判定、延时锦囊判定等）

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **雷击** |
| 雷击：使用闪抵消杀，选择目标 | 目标进行判定，若为♠则受到2点雷电伤害 |
| 雷击：打出闪作为目标，选择目标 | 目标进行判定，若为♠则受到2点雷电伤害 |
| 雷击：判定为♥ | 无效，不造成伤害 |
| 雷击：判定为♦ | 无效，不造成伤害 |
| 雷击：判定为♣ | 无效，不造成伤害 |
| 雷击：无其他存活角色 | 不能发动雷击 |
| 雷击：目标在判定前死亡 | 雷击取消 |
| 雷击：牌堆无牌 | 无法判定，雷击无效 |
| **鬼道** |
| 鬼道：张角有黑色手牌，他人判定 | 可以发动鬼道替换判定牌 |
| 鬼道：张角无黑色手牌 | 不能发动鬼道 |
| 鬼道：判定牌为♠，替换为♣ | 使用♣作为新的判定牌 |
| 鬼道：判定牌为♦，替换为♠ | 使用♠作为新的判定牌 |
| 鬼道：多个张角同时在场 | 按座位顺序依次询问 |
| 鬼道：判定者是张角自己 | 自己可以优先发动鬼道 |
| 鬼道：替换延时锦囊判定 | 新的判定牌决定延时锦囊是否生效 |
| 鬼道：替换八卦阵判定 | 新的判定牌决定是否视为闪 |
| **组合测试** |
| 雷击+鬼道：使用闪发动雷击，雷击判定时张角发动鬼道 | 先询问鬼道替换雷击判定牌，再根据最终判定结果决定是否造成伤害 |
| 雷击+鬼才：雷击判定时其他鬼才角色 | 从当前回合角色开始，按逆时针座次顺序询问所有改判技能；后发动的改判覆盖前一次结果 |
| 鬼道+鬼才：同时存在张角和鬼才角色 | 从当前回合角色开始，按逆时针座次顺序询问；后发动的改判覆盖前一次改判结果 |
| 雷击+铁骑：使用闪抵消铁骑的杀 | 先触发铁骑判定，然后可以发动雷击 |

---

## 九、实现优先级

1. **鬼道优先**：锁定技，需要集成到判定系统中，实现复杂但影响更广泛
2. **雷击优先**：需要集成到闪的使用流程中，涉及判定和伤害处理
3. **UI集成优先**：雷击和鬼道的选择界面渲染
4. **边界处理优先**：无目标、无黑色牌、判定失败等特殊情况
5. **音效集成**：添加技能音效

---

## 十、集成要点

### 与现有系统的集成

1. **判定系统**：
   - 复用现有的 `judge()` 函数进行判定
   - 修改 `maybeGuicai` 函数，在其中集成鬼道的检查
   - 确保鬼道和鬼才可以正确叠加

2. **闪使用系统**：
   - 在 `respondShan` 函数中添加雷击触发检查
   - 在 `useCard` 函数中检查闪的使用

3. **伤害系统**：
   - 复用现有的 `dealDamage` 函数处理雷击伤害
   - 添加雷电伤害类型的支持

4. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程

5. **目标选择系统**：
   - 雷击的目标选择复用现有的目标选择逻辑
   - 鬼道的黑色牌选择需要筛选手牌

### 需要修改的文件

1. **data.js**：添加张角武将定义
2. **game.js**：
   - `normalize()`：添加雷击和鬼道状态字段防御
   - `respondShan()`：添加雷击触发检查
   - `maybeGuicai()`：集成鬼道检查
   - 添加 `triggerLeiji`、`doLeijiJudge`、`cancelLeiji` 函数
   - 添加 `triggerGuidu`、`finishGuidu`、`cancelGuidu` 函数
   - 添加 `maybeGuidu` 函数
3. **skills.js**：可能需要添加辅助函数
4. **render-controls.js**：添加雷击和鬼道的UI界面
5. **render.js**：可能需要添加状态显示

---

## 十一、流程图

### 雷击完整流程
```
使用或打出【闪】
    ↓
检查是否有雷击技能
    ↓
是：进入雷击选择阶段
    ↓
玩家选择是否发动
    ↓
发动：选择目标角色
    ↓
进行判定
    ↓
检查判定结果
    ↓
是♠黑桃：对目标造成2点雷电伤害
    ↓
否：无效
    ↓
清理状态，回到出牌阶段
```

### 鬼道完整流程
```
判定牌即将生效
    ↓
检查是否有张角可以发动鬼道
    ↓
是：优先询问判定者（如果是张角）
    ↓
否则：按座位顺序询问其他张角
    ↓
张角选择是否发动
    ↓
发动：选择一张黑色手牌打出
    ↓
替换判定牌
    ↓
使用新的判定牌生效
    ↓
清理状态，继续游戏流程
```

---

## 十二、特殊说明

### 关于雷击的触发时机

雷击的触发时机是**当你使用或打出【闪】时**，这意味着：
- 使用闪抵消杀时可以触发
- 使用闪抵消需要闪的锦囊时可以触发
- 作为目标被要求打出闪时也可以触发
- 每次使用或打出闪都可以独立触发雷击
- 可以选择不同的目标角色

### 关于鬼道的触发时机

鬼道的触发时机是**当一名角色的判定牌生效前**，这意味着：
- 可以替换任何判定牌（技能判定、延时锦囊判定等）
- 触发时机在判定牌亮出后，生效前
- 支持后手优势：后发动的改判技能会覆盖之前的改判结果
- **改判顺序**：从当前回合角色开始，按逆时针座次顺序依次询问所有改判技能持有者

### 关于雷电伤害

雷击造成的伤害为**雷电伤害**，这意味着：
- 伤害类型不同于普通伤害、火焰伤害等
- 可能与某些特定技能或装备产生特殊交互
- 在伤害记录中需要特殊标记

### 关于黑色牌的判断

鬼道需要打出黑色牌替换判定，黑色牌的定义为：
- ♠黑桃的牌
- ♣梅花的牌
- 包括基本牌、锦囊牌、装备牌等所有类型
- 颜色判断使用 `card.suit === '♠' || card.suit === '♣'`

---

## 十三、修正记录

*文档状态：已实装*
*创建时间：2026-07-12*
*实装时间：2026-07-12*
*负责人：Mistral Vibe*

### 实装说明
- **data.js**: ✅ 添加了张角武将定义
- **game.js**: ✅ 
  - ✅ normalize函数：添加雷击和鬼道状态字段防御
  - ✅ respondShan函数：添加雷击触发检查
  - ✅ maybeGuicai函数：集成鬼道检查
  - ✅ 添加maybeStartLeiji、triggerLeiji、doLeijiJudge、cancelLeiji函数
  - ✅ 添加maybeGuidu、triggerGuidu、askNextGuidu、finishGuidu、cancelGuidu函数
- **render-controls.js**: ✅ 添加了雷击和鬼道的UI界面
- **render.js**: ✅ 添加了雷击和鬼道的音效标识

### 待优化项

- 音效文件：需要添加assets/audio/leiji.mp3和assets/audio/guidu.mp3
- UI/UX：雷击和鬼道选择界面的用户体验优化
- 性能：判定替换时的性能优化
- 兼容性：确保与现有所有技能的兼容性
