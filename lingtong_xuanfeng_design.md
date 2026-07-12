# 凌统 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `lingtong` |
| **武将名称** | 凌统 |
| **势力** | 吴 |
| **性别** | male |
| **体力上限** | 4 |
| **技能** | 旋风 |
| **技能描述** | 当你于弃牌阶段弃置过至少两张牌，或当你失去装备区里的牌后，你可以依次弃置任意名其他角色的共计至多两张牌。 |

---

## 二、技能说明

### 旋风
**时机**：
1. 弃牌阶段结束后（弃置过至少两张牌时）
2. 失去装备区里的牌后

**效果**：
1. 你可以发动旋风
2. 依次选择任意名其他角色
3. 弃置这些角色的共计至多两张牌

**设计要点**：
- **双触发条件**：需同时监听弃牌阶段结束事件和装备区丢失事件
- **可选发动**：玩家可以选择是否发动旋风
- **多目标选择**：可以选择任意数量的其他角色（0到N个，N=场上其他存活角色数量）
- **牌数限制**：所有被选择的角色弃置的牌总数不能超过2张
- **依次弃置**：按照选择顺序依次处理每个目标的弃牌
- **其他角色限制**：不能选择自己
- **每次触发只能发动一次**：同一个触发条件下，旋风只能发动一次

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
lingtong: {
  id: 'lingtong',
  name: '凌统',
  gender: 'male',
  maxHp: 4,
  skill: '旋风',
  desc: '旋风:当你于弃牌阶段弃置过至少两张牌,或当你失去装备区里的牌后,你可以依次弃置任意名其他角色的共计至多两张牌。',
  caps: { xuanfeng: true },
  hooks: {
    onLoseEquip: null,  // 将在 game.js 中实现
    onDiscardPhaseEnd: null  // 将在 game.js 中实现
  }
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 凌统【旋风】:弃牌阶段触发选择阶段
if(g.pending && g.pending.type==='xuanfengPick'){
  const d = g.pending;
  if(typeof d.from!=='number' || !g.players[d.from] || !g.players[d.from].alive ||
     d.from !== mySeat ||
     !Array.isArray(d.targets) ||
     !Array.isArray(d.discardedCounts) ||
     d.discardedCounts.length !== d.targets.length ||
     d.discardedCounts.some(c => typeof c !== 'number' || c < 0)){
    g.pending = null;
    g.phase = g.phase === 'xuanfengPick' ? 'discard' : g.phase;
  }
}

// 凌统【旋风】:装备丢失触发选择阶段
if(g.pending && g.pending.type==='xuanfengFromEquip'){
  const d = g.pending;
  if(typeof d.from!=='number' || !g.players[d.from] || !g.players[d.from].alive ||
     d.from !== mySeat ||
     !Array.isArray(d.targets) ||
     !Array.isArray(d.discardedCounts) ||
     d.discardedCounts.length !== d.targets.length ||
     d.discardedCounts.some(c => typeof c !== 'number' || c < 0)){
    g.pending = null;
  }
}

// 凌统【旋风】:每回合弃牌阶段是否已触发过旋风
if(typeof g.xuanfengDiscardUsed !== 'boolean') g.xuanfengDiscardUsed = false;

// 凌统【旋风】:每次装备丢失是否已触发过旋风
if(typeof g.xuanfengEquipUsed !== 'boolean') g.xuanfengEquipUsed = false;
```

在 `startTurn` 函数中添加重置：
```javascript
g.xuanfengDiscardUsed = false;  // 弃牌阶段旋风触发标志重置
g.xuanfengEquipUsed = false;    // 装备丢失旋风触发标志重置
```

---

## 四、技能实现

### 旋风实现

#### 弃牌阶段触发集成点

**集成点**：`finishDiscardPhase` 函数（弃牌阶段结束后）

```javascript
// 在 finishDiscardPhase 函数中添加旋风触发逻辑
function finishDiscardPhase(g) {
  tx(g => {
    if (g.phase !== 'discard' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    
    // 旋风：弃牌阶段弃置过至少两张牌时触发
    if (generalHasCap(me, 'xuanfeng') && me.alive && !g.xuanfengDiscardUsed) {
      // 计算本次弃牌阶段弃置的牌数
      const discardCount = g.discard.length - (g.prevDiscardCount || 0);
      
      if (discardCount >= 2) {
        // 进入旋风选择阶段
        g.pending = {
          type: 'xuanfengPick',
          from: mySeat,
          trigger: 'discard',
          targets: [],
          discardedCounts: [],
          maxRemaining: 2,
          stage: 'selecting'
        };
        g.xuanfengDiscardUsed = true;
        g.phase = 'xuanfengPick';
        g.log = pushLog(g.log, `${me.name} 可以发动【旋风】,弃置其他角色的共计至多两张牌`);
        return g;
      }
    }
    
    // 正常结束弃牌阶段
    g.phase = 'end';
    return g;
  });
}
```

#### 装备丢失触发集成点

**集成点**：`onLoseEquip` 钩子函数

```javascript
// 在 game.js 中添加旋风的 onLoseEquip 钩子处理
g.hooks.onLoseEquip = g.hooks.onLoseEquip || [];
g.hooks.onLoseEquip.push(function(g, seat, ctx) {
  const me = g.players[seat];
  
  // 旋风：失去装备区的牌后触发
  if (generalHasCap(me, 'xuanfeng') && me.alive && !g.xuanfengEquipUsed && g.turn === seat) {
    // 进入旋风选择阶段
    g.pending = {
      type: 'xuanfengPick',
      from: seat,
      trigger: 'equip',
      targets: [],
      discardedCounts: [],
      maxRemaining: 2,
      stage: 'selecting'
    };
    g.xuanfengEquipUsed = true;
    g.phase = 'xuanfengPick';
    g.log = pushLog(g.log, `${me.name} 失去装备,可以发动【旋风】,弃置其他角色的共计至多两张牌`);
  }
  
  return g;
});
```

#### 旋风选择和执行函数

```javascript
// 选择旋风目标
function pickXuanfengTarget(seat) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'xuanfengPick' || pending.from !== mySeat) return g;
    
    const me = g.players[mySeat];
    const target = g.players[seat];
    
    // 不能选择自己
    if (seat === mySeat) {
      g.log = pushLog(g.log, `${me.name} 不能选择自己作为【旋风】目标`);
      return g;
    }
    
    // 目标必须存活
    if (!target || !target.alive) {
      g.log = pushLog(g.log, `${me.name} 选择的目标 ${target ? target.name : '未知角色'} 已死亡`);
      return g;
    }
    
    // 如果已有目标，且剩余可弃置牌数为0，则开始执行
    if (pending.targets.length > 0 && pending.maxRemaining <= 0) {
      executeXuanfeng(g);
      return g;
    }
    
    // 添加目标
    if (!pending.targets.includes(seat)) {
      pending.targets.push(seat);
      pending.discardedCounts.push(0);
    }
    
    // 进入选择弃牌数量阶段
    pending.stage = 'chooseCount';
    pending.currentTargetIndex = pending.targets.indexOf(seat);
    
    g.log = pushLog(g.log, `${me.name} 选择 ${target.name} 作为【旋风】目标,请选择弃置牌数`);
    
    return g;
  });
}

// 选择弃置的牌数
function chooseXuanfengDiscardCount(count) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'xuanfengPick' || pending.from !== mySeat) return g;
    
    if (pending.stage !== 'chooseCount') return g;
    
    const me = g.players[mySeat];
    const targetSeat = pending.targets[pending.currentTargetIndex];
    const target = g.players[targetSeat];
    
    // 检查数量是否合法
    if (count < 0 || count > pending.maxRemaining) {
      g.log = pushLog(g.log, `${me.name} 选择的弃牌数无效`);
      return g;
    }
    
    // 更新弃牌数量
    pending.discardedCounts[pending.currentTargetIndex] = count;
    pending.maxRemaining -= count;
    
    // 如果还有剩余可弃置牌数且还有其他目标可以选择
    if (pending.maxRemaining > 0) {
      // 回到目标选择阶段
      pending.stage = 'selecting';
      g.log = pushLog(g.log, `${me.name} 还可以弃置${pending.maxRemaining}张牌,请继续选择目标`);
    } else {
      // 开始执行旋风
      executeXuanfeng(g);
    }
    
    return g;
  });
}

// 执行旋风效果
function executeXuanfeng(g) {
  const pending = g.pending;
  if (!pending || pending.type !== 'xuanfengPick') return g;
  
  const me = g.players[pending.from];
  const targets = pending.targets;
  const counts = pending.discardedCounts;
  
  // 按照目标顺序依次弃置牌
  for (let i = 0; i < targets.length; i++) {
    const targetSeat = targets[i];
    const target = g.players[targetSeat];
    const discardCount = counts[i];
    
    if (!target || !target.alive || discardCount <= 0) continue;
    
    // 弃置目标角色的牌
    const cardsToDiscard = [];
    
    // 优先弃置手牌
    const hand = target.hand || [];
    if (hand.length > 0) {
      const toDiscard = Math.min(discardCount, hand.length);
      cardsToDiscard.push(...hand.splice(0, toDiscard));
    }
    
    // 如果手牌不足，继续弃置装备区的牌
    if (cardsToDiscard.length < discardCount && target.equips) {
      const equipSlots = ['weapon', 'armor', 'horse1', 'horse2'];
      for (const slot of equipSlots) {
        if (cardsToDiscard.length >= discardCount) break;
        if (target.equips[slot]) {
          cardsToDiscard.push(target.equips[slot]);
          target.equips[slot] = null;
          // 触发失去装备钩子
          triggerHook(g, targetSeat, 'onLoseEquip', { count: 1 });
        }
      }
    }
    
    // 如果仍然不足，弃置判定区的牌
    if (cardsToDiscard.length < discardCount && target.delays) {
      const delays = target.delays || [];
      const toDiscard = discardCount - cardsToDiscard.length;
      cardsToDiscard.push(...delays.splice(0, toDiscard));
    }
    
    // 将弃置的牌放入弃牌堆
    g.discard.push(...cardsToDiscard);
    
    g.log = pushLog(g.log, `${me.name} 发动【旋风】,令 ${target.name} 弃置${cardsToDiscard.length}张牌`);
  }
  
  // 清理pending状态
  g.pending = null;
  g.phase = pending.trigger === 'discard' ? 'end' : g.phase;
  
  markSkillSound(g, '旋风');
  
  return g;
}

// 取消旋风发动
function cancelXuanfeng() {
  tx(g => {
    if (g.pending && (g.pending.type === 'xuanfengPick' || g.pending.type === 'xuanfengFromEquip') && g.pending.from === mySeat) {
      const me = g.players[mySeat];
      g.pending = null;
      g.phase = 'discard';
      g.log = pushLog(g.log, `${me.name} 取消发动【旋风】`);
    }
    return g;
  });
}
```

---

## 五、渲染集成（render-controls.js）

### 旋风 UI 集成

```javascript
// 在 renderControls 中添加旋风选择状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 旋风：选择目标阶段
  if (g.pending && g.pending.type === 'xuanfengPick' && g.pending.from === seat) {
    if (g.pending.stage === 'selecting') {
      ui.innerHTML += `
        <div class="skill-choose">
          <h4>【旋风】发动</h4>
          <p>请选择目标角色（可选择多个，共计弃置至多${g.pending.maxRemaining}张牌）</p>
          <div class="target-select">
      `;
      
      // 显示所有可选目标
      for (let i = 0; i < g.players.length; i++) {
        if (i === seat || !g.players[i] || !g.players[i].alive) continue;
        if (isSeatClickable(i)) {
          ui.innerHTML += `
            <button onclick="pickXuanfengTarget(${i})" class="target-btn">
              选择 ${g.players[i].name}
            </button>
          `;
        }
      }
      
      ui.innerHTML += `
          </div>
          <button onclick="cancelXuanfeng()" class="cancel-btn">
            取消
          </button>
        </div>
      `;
      return;
    }
    
    // 旋风：选择弃牌数量阶段
    if (g.pending.stage === 'chooseCount') {
      const currentTargetIndex = g.pending.currentTargetIndex;
      const targetSeat = g.pending.targets[currentTargetIndex];
      const target = g.players[targetSeat];
      const maxAvailable = Math.min(g.pending.maxRemaining, 
        (target.hand || []).length + 
        Object.values(target.equips || {}).filter(e => e !== null).length +
        (target.delays || []).length
      );
      
      ui.innerHTML += `
        <div class="skill-choose">
          <h4>【旋风】设置弃牌数</h4>
          <p>为 ${target.name} 选择弃置牌数（0-${Math.min(g.pending.maxRemaining, maxAvailable)}张）</p>
          <div class="count-select">
      `;
      
      // 显示可选数量按钮
      for (let count = 0; count <= Math.min(g.pending.maxRemaining, maxAvailable); count++) {
        ui.innerHTML += `
          <button onclick="chooseXuanfengDiscardCount(${count})" class="count-btn">
            ${count}张
          </button>
        `;
      }
      
      ui.innerHTML += `
          </div>
          <button onclick="chooseXuanfengDiscardCount(0)" class="cancel-btn">
            取消
          </button>
        </div>
      `;
      return;
    }
  }
}

// 在 render 中添加旋风目标选择高亮显示
function render(g) {
  // ... 现有代码 ...
  
  // 旋风选择阶段：高亮可选目标
  if (g.pending && g.pending.type === 'xuanfengPick' && g.pending.from === mySeat && g.pending.stage === 'selecting') {
    for (let i = 0; i < g.players.length; i++) {
      if (i === mySeat || !g.players[i] || !g.players[i].alive) continue;
      
      // 标记可点击状态
      g.players[i].clickable = true;
      g.players[i].onclick = `pickXuanfengTarget(${i})`;
      g.players[i].highlight = 'xuanfeng';
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
  '旋风': 'xuanfeng',
};
```

---

## 七、边界条件处理

### 旋风

1. **无其他存活角色**：按钮不显示，技能无法发动
2. **目标无牌可弃置**：目标的弃牌数量自动设置为0，继续下一个目标选择
3. **弃牌阶段未弃置2张牌**：不触发旋风
4. **装备区无装备时失去装备**：不触发旋风（因为没有实际失去牌）
5. **同一回合多次失去装备**：每次都可以触发旋风，但每次装备丢失只能发动一次旋风
6. **旋风目标选择过程中角色死亡**：实时验证目标存活状态
7. **弃置牌数超过目标拥有的牌数**：自动弃置目标所有的牌
8. **弃牌阶段旋风与装备丢失旋风的触发冲突**：每个触发条件独立计算，可以在同一回合多次发动旋风
9. **自己失去装备时**：可以发动旋风（因为技能描述是"当你失去装备区里的牌后")
10. **多个凌统同时存在**：每个凌统独立计算自己的旋风触发

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **弃牌阶段触发** |
| 旋风：弃牌阶段弃置0张牌 | 不触发旋风 |
| 旋风：弃牌阶段弃置1张牌 | 不触发旋风 |
| 旋风：弃牌阶段弃置2张牌 | 触发旋风，可以选择目标 |
| 旋风：弃牌阶段弃置3张牌 | 触发旋风，可以选择目标 |
| **装备丢失触发** |
| 旋风：失去1件装备 | 触发旋风，可以选择目标 |
| 旋风：失去多件装备（同一次操作） | 只触发一次旋风 |
| 旋风：连续失去装备（不同操作） | 每次都触发旋风 |
| **目标选择** |
| 旋风：选择1个目标，弃置2张牌 | 成功执行 |
| 旋风：选择2个目标，各弃置1张牌 | 成功执行 |
| 旋风：选择3个目标，各弃置1张牌 | 只弃置前2个目标的牌 |
| 旋风：选择1个目标，弃置0张牌 | 无效，需要重新选择 |
| **牌不足处理** |
| 旋风：目标只有1张牌，选择弃置2张 | 弃置1张牌 |
| 旋风：目标无手牌，有装备 | 弃置装备 |
| 旋风：目标无手牌和装备，有判定区牌 | 弃置判定区牌 |
| 旋风：目标完全无牌 | 自动设置弃置数为0 |
| **取消操作** |
| 旋风：选择目标后取消 | 返回出牌阶段 |
| 旋风：选择弃牌数后取消 | 返回目标选择 |
| **连锁触发** |
| 旋风：弃牌阶段触发后装备丢失触发 | 两次都可以发动 |
| 旋风：装备丢失触发后弃牌阶段触发 | 两次都可以发动 |

---

## 九、实现优先级

1. **数据定义优先**：添加凌统武将定义和 caps 标记
2. **状态管理优先**：添加pending状态防御和回合重置
3. **核心逻辑优先**：实现旋风的触发条件检测和目标选择逻辑
4. **弃牌执行优先**：实现依次弃置目标角色牌的核心逻辑
5. **UI集成优先**：添加旋风的选择界面和交互
6. **边界处理**：处理无牌、死亡、取消等边界条件
7. **音效集成**：添加技能音效
8. **测试验证**：确保所有场景都通过测试

---

## 十、集成要点

### 与现有系统的集成

1. **弃牌阶段系统**：
   - 复用现有的 `finishDiscardPhase` 函数
   - 监听弃牌数量变化
   - 确保旋风的触发不影响正常弃牌阶段流程

2. **装备区系统**：
   - 接入现有的 `onLoseEquip` 钩子
   - 确保装备丢失时正确触发旋风
   - 与孙尚香【枭姬】等其他装备丢失相关技能不冲突

3. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程
   - 使用 pending 状态保存旋风的选择信息

4. **日志系统**：
   - 为旋风的各个阶段添加对应的日志记录
   - 确保日志清晰地反映技能的发动和效果

5. **UI交互系统**：
   - 复用现有的目标选择和数量选择UI模式
   - 确保旋风的选择界面与其他技能界面风格一致

### 需要修改的文件

1. **data.js**：
   - 添加凌统武将定义

2. **game.js**：
   - `normalize()`：添加旋风状态字段防御
   - `startTurn()`：添加旋风触发标志位重置
   - `finishDiscardPhase()`：添加弃牌阶段旋风触发逻辑
   - 添加旋风相关钩子函数
   - 添加 `pickXuanfengTarget()`、`chooseXuanfengDiscardCount()`、`executeXuanfeng()`、`cancelXuanfeng()` 函数

3. **render-controls.js**：
   - 添加旋风的UI界面
   - 添加目标选择和弃牌数量选择界面

4. **render.js**：
   - 添加旋风选择阶段的高亮显示

---

## 十一、流程图

### 旋风完整流程

```
弃牌阶段结束或失去装备
    ↓
检查是否满足触发条件
    ↓
是：进入旋风选择阶段
    ↓
玩家选择目标角色
    ↓
选择弃置牌数量（0-剩余可弃置数）
    ↓
是否还有剩余可弃置牌数？
    ├── 是：返回选择目标
    └── 否：执行旋风效果
    ↓
按顺序弃置每个目标角色的牌
    ↓
清理pending状态
    ↓
返回正常流程
```

---

## 十二、特殊说明

### 关于旋风的技能定位

旋风是凌统的控制型技能，体现了其勇猛善战、乘胜追击的特点。通过在特定时机触发后可以强制其他角色弃置牌，凌统可以干扰对手的手牌资源，从而掌握战场主动权。

**技能特点**：
- **双触发条件**：既可以在弃牌阶段触发，也可以在装备丢失时触发，增加了技能的发动机会
- **灵活的目标选择**：可以选择任意数量的其他角色，但总弃牌数限制在2张
- **依次弃置机制**：按照选择顺序依次处理，确保公平性
- **控制性强**：可以针对特定角色进行干扰
- **无次数限制**：每次满足触发条件都可以发动

### 关于技能平衡性

凌统作为4体力的吴国武将，旋风提供了强大的控制能力：
- 弃牌阶段触发需要弃置至少2张牌，有一定的代价
- 装备丢失触发通常是被动情况，可以转IZH为主动优势
- 每次最多弃置2张牌，防止过于强力
- 可以针对多个目标，增加了战术灵活性
- 与吴国其他武将的协同性良好

### 关于与其他技能的交互

1. **与弃牌相关技能的交互**：
   - 旋风触发后的弃牌不计入弃牌阶段的弃牌数量（因为是在弃牌阶段结束后触发）
   - 其他武将的弃牌技能正常触发

2. **与装备相关技能的交互**：
   - 失去装备触发旋风，旋风本身也可能导致其他角色失去装备
   - 与孙尚香【枭姬】等装备丢失技能不冲突

3. **与手牌数量相关技能的交互**：
   - 旋风弃置的牌进入弃牌堆，可能被其他技能利用
   - 弃置后的手牌数量变化可能影响其他技能的判定

---

## 十三、修正记录

*文档状态：设计阶段*
*创建时间：2026-07-13*
*负责人：Mistral Vibe*

### 待实装项

- [ ] **data.js**: 添加凌统武将定义
- [ ] **game.js**: 
  - [ ] normalize函数：添加旋风状态字段防御
  - [ ] startTurn函数：添加旋风触发标志位重置
  - [ ] finishDiscardPhase函数：添加弃牌阶段旋风触发逻辑
  - [ ] 添加onLoseEquip钩子函数
  - [ ] 添加旋风相关函数（pickXuanfengTarget, chooseXuanfengDiscardCount, executeXuanfeng, cancelXuanfeng）
- [ ] **render-controls.js**: 
  - [ ] 添加旋风UI界面
  - [ ] 添加目标选择界面
  - [ ] 添加弃牌数量选择界面
- [ ] **render.js**: 
  - [ ] 添加旋风选择阶段的高亮显示

### 待优化项

- 音效文件：需要添加assets/audio/xuanfeng.mp3
- UI/UX：旋风选择界面的用户体验优化
- 性能：确保旋风选择时的性能
- 兼容性：确保与现有所有技能的兼容性
- 文本描述：优化技能描述的表述准确性
