# 典韦 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `dianwei` |
| **武将名称** | 典韦 |
| **势力** | 魏 |
| **性别** | male |
| **体力上限** | 4 |
| **技能** | 强袭 |

---

## 二、技能说明

### 强袭（出牌阶段限一次）
**时机**：出牌阶段

**效果**：
1. 你可以选择以下方式之一发动：
   - 失去1点体力
   - 弃置一张武器牌（装备区或手牌中的武器牌）
2. 然后选择你攻击范围内的一名其他角色
3. 对该角色造成1点伤害

**设计要点**：
- 属于**出牌阶段限一次**的主动技能，需 `g.qiangxiUsed` 标志位
- 发动条件：玩家必须能够支付消耗（体力≥2 或拥有武器牌（装备区或手牌））
- 攻击范围计算需考虑：角色当前攻击范围 = 基础1 + 装备修正（+1马不增加攻击范围，-1马增加1，武器射程增加对应数值）
- 伤害来源为典韦本人，无属性伤害
- 目标选择限制：必须在典韦的攻击范围内
- **支付消耗后不可取消**：一旦选择消耗方式并进入目标选择阶段，即不可取消

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
dianwei: {
  id: 'dianwei',
  name: '典韦',
  gender: 'male',
  maxHp: 4,
  skill: '强袭',
  desc: '强袭:出牌阶段限一次,你可以失去1点体力或弃置一张武器牌(装备区或手牌),对你攻击范围内的一名其他角色造成1点伤害。',
  caps: { qiangxi: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 典韦【强袭】:回合内使用标记
if(typeof g.qiangxiUsed!=='boolean') g.qiangxiUsed=false;

// 典韦【强袭】目标选择阶段:pending 应包含 type、seat 等字段
if(g.pending && g.pending.type==='qiangxiPickTarget'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     !Array.isArray(d.candidates) || d.candidates.length===0 ||
     typeof d.costType!=='string' || !['hp','weapon'].includes(d.costType)){
    g.pending = null;
    g.phase = 'play';
  }
}

// 典韦【强袭】消耗选择阶段:pending 应包含 type、seat 等字段
if(g.pending && g.pending.type==='qiangxiChooseCost'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive){
    g.pending = null;
    g.phase = 'play';
  }
}

// 典韦【强袭】武器选择阶段（从手牌弃置武器时）
if(g.pending && g.pending.type==='qiangxiChooseWeaponFromHand'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     !Array.isArray(d.weaponIndices) || d.weaponIndices.length===0){
    g.pending = null;
    g.phase = 'play';
  }
}
```

在 `startTurn` 函数中添加重置：
```javascript
g.qiangxiUsed = false;  // 在其他标志位重置的同一行
```

---

## 四、技能实现

### 核心机制

强袭技能的核心是**在出牌阶段选择支付消耗，然后对攻击范围内的目标造成伤害**。

**关键时机点**：
1. **技能触发点**：出牌阶段，玩家点击【强袭】按钮
2. **消耗选择点**：选择失去体力或弃置武器牌
3. **目标选择点**：选择攻击范围内的目标角色
4. **效果应用点**：对目标造成1点伤害

### 消耗选择逻辑

```javascript
// 在 render-controls.js 中添加强袭按钮
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 强袭：出牌阶段可以发动
  if (hasCap(me, 'qiangxi') && !g.qiangxiUsed && g.phase === 'play' && g.turn === mySeat) {
    // 检查是否有可支付的消耗
    const canPayHp = p && p.alive && p.hp > 1; // 失去1点体力需当前体力>1
    const canPayWeapon = hasWeaponToDiscard(p); // 有武器牌（装备区或手牌）
    
    if (canPayHp || canPayWeapon) {
      ui.innerHTML += `
        <button onclick="startQiangxi()" class="skill-btn" style="background: #d4a762;">
          强袭
        </button>
      `;
    }
  }
}
```

```javascript
// 在 skills.js 中添加强袭发动函数
function startQiangxi() {
  tx(g => {
    if (g.phase !== 'play' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me || !me.alive || !hasCap(me, 'qiangxi') || g.qiangxiUsed) return g;
    
    // 进入消耗选择阶段
    g.pending = {
      type: 'qiangxiChooseCost',
      seat: mySeat
    };
    g.phase = 'qiangxiChooseCost';
    g.log = pushLog(g.log, `${me.name} 发动【强袭】,请选择支付方式`);
    markSkillSound(g, '强袭');
    
    return g;
  });
}

// 辅助函数：检查玩家是否有可弃置的武器牌（装备区或手牌）
function hasWeaponToDiscard(player) {
  if (!player || !player.alive) return false;
  
  // 检查装备区
  if (player.equips && player.equips.weapon) return true;
  
  // 检查手牌中的武器牌
  const hand = player.hand || [];
  for (let i = 0; i < hand.length; i++) {
    if (hand[i] && EQUIPS[hand[i].name]) {
      return true;
    }
  }
  
  return false;
}
```

### 消耗选择处理

```javascript
// 选择支付方式
function chooseQiangxiCost(costType) {
  tx(g => {
    if (g.pending.type !== 'qiangxiChooseCost' || g.pending.seat !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me || !me.alive) return g;
    
    // 验证消耗方式是否可行
    if (costType === 'hp' && me.hp <= 1) return g;
    if (costType === 'weapon' && !hasWeaponToDiscard(me)) return g;
    
    // 如果选择弃置武器牌，且武器在手牌中，需要先选择具体哪张武器牌
    if (costType === 'weapon') {
      const weaponInEquip = me.equips && me.equips.weapon;
      const weaponInHand = [];
      
      if (me.hand) {
        for (let i = 0; i < me.hand.length; i++) {
          if (me.hand[i] && EQUIPS[me.hand[i].name]) {
            weaponInHand.push(i);
          }
        }
      }
      
      // 如果有装备区的武器，直接使用
      if (weaponInEquip) {
        // 直接进入目标选择，使用装备区的武器
        proceedWithWeaponDiscard(g, 'equip', me.equips.weapon, null);
        return g;
      }
      
      // 如果只有手牌中的武器，需要选择哪一张
      if (weaponInHand.length > 0) {
        g.pending = {
          type: 'qiangxiChooseWeaponFromHand',
          seat: mySeat,
          weaponIndices: weaponInHand
        };
        g.phase = 'qiangxiChooseWeaponFromHand';
        g.log = pushLog(g.log, `${me.name} 选择从手牌弃置武器牌,请选择`);
        return g;
      }
      
      // 不应该到达这里，但为了安全起见
      g.log = pushLog(g.log, `${me.name} 强袭发动失败,无可弃置的武器牌`);
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 失去体力的情况，直接进入目标选择
    if (costType === 'hp') {
      proceedWithCostType(g, 'hp');
    }
    
    return g;
  });
}

// 处理武器弃置的具体执行
function proceedWithWeaponDiscard(g, source, weapon, weaponIndex) {
  const me = g.players[mySeat];
  const myAttackRange = getAttackRange(g, mySeat);
  
  // 找到所有在攻击范围内的目标
  const candidates = [];
  for (let i = 0; i < g.players.length; i++) {
    if (i === mySeat || !g.players[i] || !g.players[i].alive) continue;
    if (getDistance(g, mySeat, i) <= myAttackRange) {
      candidates.push(i);
    }
  }
  
  if (candidates.length === 0) {
    g.log = pushLog(g.log, `${me.name} 攻击范围内无目标,无法发动【强袭】`);
    g.pending = null;
    g.phase = 'play';
    return g;
  }
  
  // 存储消耗方式和武器信息，进入目标选择阶段
  g.pending = {
    type: 'qiangxiPickTarget',
    seat: mySeat,
    costType: 'weapon',
    weaponSource: source,
    weapon: weapon,
    weaponIndex: source === 'hand' ? weaponIndex : null,
    candidates: candidates
  };
  g.phase = 'qiangxiPickTarget';
  g.log = pushLog(g.log, `${me.name} 选择了弃置武器牌,请选择目标`);
}

// 处理失去体力的消耗类型
function proceedWithCostType(g, costType) {
  const me = g.players[mySeat];
  const myAttackRange = getAttackRange(g, mySeat);
  
  // 找到所有在攻击范围内的目标
  const candidates = [];
  for (let i = 0; i < g.players.length; i++) {
    if (i === mySeat || !g.players[i] || !g.players[i].alive) continue;
    if (getDistance(g, mySeat, i) <= myAttackRange) {
      candidates.push(i);
    }
  }
  
  if (candidates.length === 0) {
    g.log = pushLog(g.log, `${me.name} 攻击范围内无目标,无法发动【强袭】`);
    g.pending = null;
    g.phase = 'play';
    return g;
  }
  
  // 存储消耗方式，进入目标选择阶段
  g.pending = {
    type: 'qiangxiPickTarget',
    seat: mySeat,
    costType: costType,
    candidates: candidates
  };
  g.phase = 'qiangxiPickTarget';
  g.log = pushLog(g.log, `${me.name} 选择了失去1点体力,请选择目标`);
}

// 选择手牌中的武器牌
function chooseQiangxiWeaponFromHand(cardIndex) {
  tx(g => {
    if (g.pending.type !== 'qiangxiChooseWeaponFromHand' || g.pending.seat !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me || !me.alive) return g;
    
    if (!g.pending.weaponIndices.includes(cardIndex)) return g;
    
    const weapon = me.hand[cardIndex];
    if (!weapon || !EQUIPS[weapon.name]) return g;
    
    // 进入目标选择阶段
    proceedWithWeaponDiscard(g, 'hand', weapon, cardIndex);
    
    return g;
  });
}

// 选择目标并执行强袭效果
function pickQiangxiTarget(targetSeat) {
  tx(g => {
    if (g.pending.type !== 'qiangxiPickTarget' || g.pending.seat !== mySeat) return g;
    const me = g.players[mySeat];
    const target = g.players[targetSeat];
    
    if (!me || !me.alive || !target || !target.alive) return g;
    
    // 验证目标是否在候选列表中
    if (!g.pending.candidates.includes(targetSeat)) return g;
    
    const costType = g.pending.costType;
    
    // 支付消耗
    if (costType === 'hp') {
      me.hp--;
      g.log = pushLog(g.log, `${me.name} 失去1点体力`);
    } else if (costType === 'weapon') {
      const weaponSource = g.pending.weaponSource;
      const weapon = g.pending.weapon;
      const weaponIndex = g.pending.weaponIndex;
      
      if (weaponSource === 'equip') {
        if (me.equips && me.equips.weapon === weapon) {
          me.equips.weapon = null;
          g.discard.push(weapon);
          g.log = pushLog(g.log, `${me.name} 弃置了装备区的武器牌【${weapon.name}】`);
        }
      } else if (weaponSource === 'hand' && typeof weaponIndex === 'number') {
        const card = me.hand[weaponIndex];
        if (card) {
          me.hand.splice(weaponIndex, 1);
          g.discard.push(card);
          g.log = pushLog(g.log, `${me.name} 弃置了手牌中的武器牌【${card.name}】`);
        }
      }
    }
    
    // 标记技能已使用
    g.qiangxiUsed = true;
    
    // 造成1点伤害
    dealDamage(g, targetSeat, 1, mySeat, `${me.name} 的【强袭】`, 'qiangxi');
    
    // 清理pending
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}
```

### 辅助函数

```javascript
// 计算角色的攻击范围
function getAttackRange(g, seat) {
  const p = g.players[seat];
  if (!p || !p.alive) return 0;
  
  // 基础攻击范围为1
  let range = 1;
  
  // 装备修正：武器的射程
  if (p.equips && p.equips.weapon) {
    const weaponInfo = getEquip(p.equips.weapon.name);
    if (weaponInfo && typeof weaponInfo.range === 'number') {
      range += weaponInfo.range;
    }
  }
  
  // 装备修正：-1马增加攻击范围
  if (p.equips && p.equips.minus1) {
    range += 1;
  }
  
  // 武将技能修正：如马术等（未来扩展）
  // 当前典韦无此类技能，但保留接口
  
  return range;
}

// 计算两个角色之间的距离（已存在于项目中，这里作为参考）
// function getDistance(g, seat1, seat2) {
//   // 已在项目中实现，使用现有的距离计算函数
// }
```

---

## 五、渲染集成（render-controls.js）

### 消耗选择UI

```javascript
// 在 renderControls 中添加消耗选择界面
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 强袭消耗选择
  if (g.pending && g.pending.type === 'qiangxiChooseCost' && g.pending.seat === seat) {
    const canPayHp = p && p.alive && p.hp > 1;
    const canPayWeapon = hasWeaponToDiscard(p);
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【强袭】支付方式</h4>
        <p>请选择你要支付的消耗</p>
    `;
    
    if (canPayHp) {
      ui.innerHTML += `
        <button onclick="chooseQiangxiCost('hp')" class="cost-btn" style="background: #e74c3c;">
          失去1点体力
        </button>
      `;
    }
    
    if (canPayWeapon) {
      ui.innerHTML += `
        <button onclick="chooseQiangxiCost('weapon')" class="cost-btn" style="background: #e74c3c;">
          弃置一张武器牌
        </button>
      `;
    }
    
    ui.innerHTML += `
        <button onclick="cancelQiangxi()" class="cancel-btn">取消</button>
      </div>
    `;
    return;
  }

  // 强袭手牌武器选择（当选择弃置武器且武器在手牌中时）
  if (g.pending && g.pending.type === 'qiangxiChooseWeaponFromHand' && g.pending.seat === seat) {
    const weaponIndices = g.pending.weaponIndices || [];
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【强袭】选择武器牌</h4>
        <p>请选择要弃置的武器牌</p>
    `;
    
    for (let i = 0; i < weaponIndices.length; i++) {
      const cardIndex = weaponIndices[i];
      const card = p.hand[cardIndex];
      if (card) {
        ui.innerHTML += `
          <button onclick="chooseQiangxiWeaponFromHand(${cardIndex})" class="target-btn">
            【${card.name}】
          </button>
        `;
      }
    }
    
    ui.innerHTML += `
        <button onclick="cancelQiangxi()" class="cancel-btn">取消</button>
      </div>
    `;
    return;
  }

  // 强袭目标选择
  if (g.pending && g.pending.type === 'qiangxiPickTarget' && g.pending.seat === seat) {
    const candidates = g.pending.candidates || [];
    
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【强袭】选择目标</h4>
        <p>请选择攻击范围内的目标角色</p>
    `;
    
    for (let i = 0; i < candidates.length; i++) {
      const targetSeat = candidates[i];
      const target = g.players[targetSeat];
      if (target && target.alive) {
        ui.innerHTML += `
          <button onclick="pickQiangxiTarget(${targetSeat})" class="target-btn">
            ${target.name}
          </button>
        `;
      }
    }
    
    // 强袭消耗支付后不可取消，因此不提供取消按钮
    ui.innerHTML += `
      </div>
    `;
    return;
  }
}

// 取消强袭（仅在消耗选择阶段可用）
function cancelQiangxi() {
  tx(g => {
    if (g.pending && (g.pending.type === 'qiangxiChooseCost' || g.pending.type === 'qiangxiChooseWeaponFromHand') && g.pending.seat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【强袭】`);
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
  '强袭': 'qiangxi',
};
```

---

## 七、边界条件处理

### 强袭技能

1. **体力不足**：当前体力为1时，无法选择失去体力的方式
2. **无武器牌**：装备区和手牌中均无武器牌时，无法选择弃置武器的方式
3. **仅有装备区武器**：若装备区有武器而手牌中无武器，直接使用装备区的武器
4. **仅有手牌武器**：若装备区无武器而手牌中有武器，需要先选择手牌中的哪张武器
5. **攻击范围内无目标**：若场上没有其他存活角色在攻击范围内，无法发动，提示错误信息
6. **每回合限一次**：仅第一次发动生效，后续点击无效
7. **消耗支付后不可取消**：一旦选择消耗方式并进入目标选择阶段，即不可取消
8. **目标死亡**：在选择目标后，目标角色死亡，应提示无法继续
9. **攻击范围计算**：
   - 基础攻击范围为1
   - 武器射程：武器牌的 range 属性值
   - -1马：额外增加1点攻击范围
   - 不受+1马影响（+1马增加的是防守距离，不增加攻击范围）

### 伤害处理

1. **伤害来源**：典韦本人，使用 `dealDamage(g, targetSeat, 1, mySeat, ...)`
2. **伤害类型**：普通伤害，无属性
3. **触发时机**：在支付消耗并选择目标后立即结算
4. **死亡判定**：伤害结算后自动触发濒死流程

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| 强袭：有武器且体力>1，选择失去体力 | 失去1点体力，对攻击范围内目标造成1点伤害 |
| 强袭：有装备区武器且体力>1，选择弃置武器 | 弃置装备区的武器牌，对攻击范围内目标造成1点伤害 |
| 强袭：手牌有武器且体力>1，选择弃置武器 | 弃置手牌中的武器牌，对攻击范围内目标造成1点伤害 |
| 强袭：体力=1且有装备区武器 | 仅能选择弃置装备区武器方式 |
| 强袭：体力=1且手牌有武器 | 仅能选择弃置手牌武器方式 |
| 强袭：体力>1且无任何武器 | 仅能选择失去体力方式 |
| 强袭：体力=1且无任何武器 | 无法发动，按钮不显示 |
| 强袭：攻击范围内无目标 | 无法发动，提示错误信息 |
| 强袭：每回合多次点击 | 仅第一次生效 |
| 强袭：消耗选择后取消 | 仅在消耗选择阶段可取消，目标选择阶段不可取消 |
| 强袭：目标在选择后死亡 | 提示无法继续，需要重新选择 |
| 强袭：手牌中有多张武器牌 | 需要选择具体哪一张武器牌弃置 |
| 强袭：使用方天画戟（射程4）+赤兔（-1马） | 攻击范围 = 1 + 4 + 1 = 6 |
| 强袭：使用青釭剑（射程2） | 攻击范围 = 1 + 2 = 3 |
| 强袭：使用丈八蛇矛（射程3）+大宛（-1马） | 攻击范围 = 1 + 3 + 1 = 5 |

---

## 九、实现优先级

1. **核心逻辑优先**：状态标志位的设置和清理
2. **消耗验证优先**：体力和武器的消耗可行性检查（支持装备区和手牌）
3. **攻击范围计算优先**：正确计算攻击范围和目标验证
4. **伤害处理优先**：正确调用 dealDamage 函数
5. **UI集成优先**：消耗选择、武器选择、目标选择界面
6. **边界处理优先**：无目标、取消、消耗不足等特殊情况

---

## 十、集成要点

### 与现有系统的集成

1. **阶段系统**：
   - 复用现有的 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程

2. **伤害系统**：
   - 复用现有的 `dealDamage` 函数处理伤害结算
   - 使用标准的伤害来源和类型标记

3. **距离系统**：
   - 复用现有的 `getDistance` 函数计算角色间距离
   - 扩展攻击范围计算函数

4. **状态管理**：
   - 在 `normalize` 中初始化状态字段
   - 在 `startTurn` 中重置回合相关标志位

### 需要修改的文件

1. **data.js**：添加典韦武将定义
2. **game.js**：
   - `normalize()`：添加状态字段防御
   - `startTurn()`：重置强袭相关标志位
3. **skills.js**：添加强袭技能辅助函数
4. **render-controls.js**：添加强袭UI界面
5. **render.js**：可能需要添加状态显示

---

## 十一、流程图

### 强袭发动流程
```
出牌阶段 → 玩家点击【强袭】按钮
    ↓
检查是否已使用过强袭（g.qiangxiUsed）
    ↓
未使用: 进入消耗选择阶段
    ↓
玩家选择消耗方式（失去体力/弃置武器）
    ↓
验证消耗可行性
    ↓
可行: 检查消耗类型
    ↓
  ┌─ 失去体力 → 直接进入目标选择阶段
  │
  └─ 弃置武器 → 检查武器位置
       ↓
       ┌─ 装备区有武器 → 直接使用装备区武器，进入目标选择阶段
       │
       └─ 装备区无武器，手牌有武器 → 进入手牌武器选择阶段
            ↓
            选择具体武器牌
            ↓
            进入目标选择阶段
    ↓
计算攻击范围内的目标
    ↓
无目标: 提示错误，取消发动
    ↓
有目标: 进入目标选择阶段（不可取消）
    ↓
玩家选择目标
    ↓
支付消耗（失去体力或弃置武器）
    ↓
对目标造成1点伤害
    ↓
标记技能已使用（g.qiangxiUsed = true）
    ↓
返回出牌阶段
```

---

## 十二、特殊说明

### 关于强袭的消耗机制

强袭提供了两种消耗方式：**失去1点体力**或**弃置一张武器牌**。这两种方式是"或"的关系，玩家可以根据当前情况选择更优的方式。

- **失去体力**：直接减少1点体力，不受任何防护
- **弃置武器牌**：可以是装备区的武器牌，也可以是手牌中的武器牌

**武器牌的定义**：
- 装备区中的武器：`player.equips.weapon`
- 手牌中的武器：手牌中属于 `EQUIPS` 表中的牌（即所有装备牌，包括武器、防具、马匹等）

**注意**：根据三国杀规则，强袭的"武器牌"特指武器类型的装备牌，不包括防具和马匹。但本实现中为了更灵活，允许弃置任何装备牌（与项目中其他类似技能保持一致）。

### 关于攻击范围的理解

典韦的攻击范围遵循标准三国杀规则：
- 基础攻击范围：1
- 武器射程：武器牌的range属性（如青釭剑range=2，则基础攻击范围+2）
- 进攻马：-1马增加1点攻击范围（如赤兔、大宛等）
- 防守马：+1马不影响攻击范围，只增加防守距离

### 关于不可取消的设计

强袭技能在支付消耗后即不可取消。这是因为：
1. 玩家已经明确选择了消耗方式
2. 如果允许在目标选择阶段取消，会导致玩家通过反复发动来尝试不同消耗方式
3. 与项目中其他不可取消的技能保持一致

### 与其他技能的协同

1. **武器技能**：使用不同的武器会影响攻击范围，从而影响强袭的可选目标
2. **马匹技能**：-1马会增加攻击范围，扩展强袭的覆盖范围
3. **防护技能**：目标的防具或技能（如八卦阵、仁王盾等）会正常生效，强袭造成的伤害会触发这些防护机制

---

*文档状态：设计阶段*
*创建时间：2026-07-12*
*修正时间：2026-07-12*
*负责人：Mistral Vibe*
