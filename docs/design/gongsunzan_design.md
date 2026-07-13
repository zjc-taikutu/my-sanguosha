# 公孙瓒 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `gongsunzan` |
| **武将名称** | 公孙瓒 |
| **势力** | 群 |
| **性别** | male |
| **体力上限** | 4 |
| **技能** | 趫猛 / 义从 |

---

## 二、技能说明

### 趫猛
**时机**：当你使用黑色【杀】对一名角色造成伤害后

**效果**：
1. 你可以选择其装备区里的一张牌
2. 若此牌：
   - 为坐骑牌，你获得之（置入手牌）
   - 不为坐骑牌，你弃置之

**设计要点**：
- 属于**伤害结算后的触发技能**，在 `resolveDamageEffect` 或类似伤害结算函数中集成
- 需要判断造成伤害的【杀】是否为**黑色**（♠黑桃或♣梅花）
- 需要检查目标角色的**装备区**是否有牌可选择
- 需要判断装备牌是否为**坐骑牌**：可以通过 `getEquip(card.name)` 检查是否有 `slot` 属性为 'plus1' 或 'minus1'
- 若选择获得坐骑牌，需要处理装备转移（目标失去该坐骑，你获得该坐骑进入手牌）
- 若选择弃置非坐骑牌，直接将牌置入弃牌堆

### 义从（锁定技）
**时机**：持续生效

**效果**：
1. 若你的体力值大于2，你计算与其他角色的距离-1
2. 若你的体力值不大于2，其他角色计算与你的距离+1

**设计要点**：
- 属于**锁定技**，无需玩家操作，在距离计算函数中自动生效
- 需要在 `distance(g, from, to)` 函数中集成
- 当 `from` 是公孙瓒且 `g.players[from].hp > 2` 时，距离-1
- 当 `to` 是公孙瓒且 `g.players[to].hp <= 2` 时，距离+1
- 与其他距离修正效果（坐骑、武器等）同时存在时，**效果叠加**

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
gongsunzan: {
  id: 'gongsunzan',
  name: '公孙瓒',
  gender: 'male',
  maxHp: 4,
  skill: '趫猛/义从',
  desc: '趫猛:当你使用黑色【杀】对一名角色造成伤害后,你可以选择其装备区里的一张牌,若此牌:为坐骑牌,你获得之;不为坐骑牌,你弃置之。义从:锁定技,①若你的体力值大于2,你计算与其他角色的距离-1;②若你的体力值不大于2,其他角色计算与你的距离+1。',
  caps: { qiaomeng: true, yicong: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 公孙瓒【趫猛】:伤害结算后的选择阶段
// pending 应包含 type、sourceSeat（伤害来源）、targetSeat（受伤目标）、shaColor（杀的颜色）
if(g.pending && g.pending.type==='qiaomengChoose'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
     d.shaColor !== '♠' && d.shaColor !== '♣'){
    g.pending = null;
    g.phase = 'play';
  }
}

// 公孙瓒【趫猛】:装备选择阶段
if(g.pending && g.pending.type==='qiaomengPickEquip'){
  const d = g.pending;
  if(typeof d.sourceSeat!=='number' || !g.players[d.sourceSeat] || !g.players[d.sourceSeat].alive ||
     typeof d.targetSeat!=='number' || !g.players[d.targetSeat] || !g.players[d.targetSeat].alive ||
     typeof d.cardIdx!=='number' || d.cardIdx < 0 ||
     !g.players[d.targetSeat].equips || Object.keys(g.players[d.targetSeat].equips).length === 0){
    g.pending = null;
    g.phase = 'play';
  }
}
```

---

## 四、技能实现

### 趫猛实现

**集成点**：`resolveDamageEffect` 或 `resolveShaUse` 函数（伤害结算后）

```javascript
// 在 resolveShaUse 或类似伤害结算函数中添加趫猛触发检查
function resolveShaUse(g, sha, sourceSeat, targetSeat, shaInfo) {
  tx(g => {
    const source = g.players[sourceSeat];
    const target = g.players[targetSeat];
    
    if (!source || !source.alive || !target || !target.alive) return g;
    
    // 检查是否是黑色杀
    const isBlackSha = sha.suit === '♠' || sha.suit === '♣';
    
    // 检查是否有趫猛技能
    if (hasCap(source, 'qiaomeng') && isBlackSha) {
      // 进入趫猛选择阶段
      g.pending = {
        type: 'qiaomengChoose',
        sourceSeat: sourceSeat,
        targetSeat: targetSeat,
        shaColor: sha.suit
      };
      g.phase = 'qiaomengChoose';
      g.log = pushLog(g.log, `${source.name} 发动【趫猛】,可以选择 ${target.name} 的一张装备牌`);
      markSkillSound(g, '趫猛');
    }
    
    return g;
  });
}
```

```javascript
// 趫猛选择装备牌函数
function triggerQiaomeng() {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'qiaomengChoose' || pending.sourceSeat !== mySeat) return g;
    
    const source = g.players[mySeat];
    const target = g.players[pending.targetSeat];
    
    if (!source || !source.alive || !target || !target.alive) return g;
    
    // 检查目标是否有装备
    const equips = target.equips || {};
    const equipSlots = Object.keys(equips).filter(slot => equips[slot] !== null);
    
    if (equipSlots.length === 0) {
      g.log = pushLog(g.log, `${target.name} 没有装备牌,【趫猛】无法发动`);
      g.pending = null;
      g.phase = 'play';
      return g;
    }
    
    // 进入装备选择阶段
    g.pending = {
      type: 'qiaomengPickEquip',
      sourceSeat: mySeat,
      targetSeat: pending.targetSeat,
      availableSlots: equipSlots
    };
    g.phase = 'qiaomengPickEquip';
    g.log = pushLog(g.log, `${source.name} 选择要获取或弃置的装备牌`);
    
    return g;
  });
}
```

```javascript
// 趫猛选择具体装备卡
function pickQiaomengEquip(slot) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'qiaomengPickEquip' || pending.sourceSeat !== mySeat) return g;
    
    const source = g.players[mySeat];
    const target = g.players[pending.targetSeat];
    
    if (!source || !source.alive || !target || !target.alive) return g;
    if (!pending.availableSlots.includes(slot)) return g;
    
    const card = target.equips[slot];
    if (!card) return g;
    
    // 判断是否为坐骑牌
    const isMount = isMountCard(card);
    
    if (isMount) {
      // 获得坐骑牌
      // 移除目标的坐骑
      target.equips[slot] = null;
      
      // 获得坐骑：直接置入手牌
      if (!source.hand) source.hand = [];
      source.hand.push(card);
      g.log = pushLog(g.log, `${source.name} 获得 ${target.name} 的坐骑牌【${card.name}】并置入手牌`);
    } else {
      // 弃置非坐骑牌
      target.equips[slot] = null;
      g.discard.push(card);
      g.log = pushLog(g.log, `${source.name} 弃置 ${target.name} 的装备牌【${card.name}】`);
    }
    
    // 清理状态
    g.pending = null;
    g.phase = 'play';
    
    return g;
  });
}

// 辅助函数：判断卡片是否为坐骑牌
function isMountCard(card) {
  if (!card || !card.name) return false;
  const mountNames = ['的卢', '绝影', '爪黄飞电', '大宛', '赤兔', '紫骍'];
  return mountNames.includes(card.name);
}

// 取消趫猛
function cancelQiaomeng() {
  tx(g => {
    if (g.pending && (g.pending.type === 'qiaomengChoose' || g.pending.type === 'qiaomengPickEquip') &&
        g.pending.sourceSeat === mySeat) {
      g.pending = null;
      g.phase = 'play';
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【趫猛】`);
    }
    return g;
  });
}
```

### 义从实现

**集成点**：`distance(g, from, to)` 函数

```javascript
// 修改 distance 函数，集成义从效果
function distance(g, from, to) {
  if (from === to) return 0;
  
  const alive = g.players.map((p, i) => i).filter(i => g.players[i] && g.players[i].alive);
  const m = alive.length;
  const pf = alive.indexOf(from), pt = alive.indexOf(to);
  if (pf < 0 || pt < 0 || m < 2) return 1;
  
  const cw = (((pt - pf) % m) + m) % m;
  const base = Math.min(cw, m - cw);
  
  // 义从效果：公孙瓒体力>2时，自己计算与其他角色的距离-1
  const yicongFromModifier = (hasCap(g.players[from], 'yicong') && 
                              g.players[from] && g.players[from].alive && 
                              (g.players[from].hp || g.players[from].maxHp) > 2) ? -1 : 0;
  
  // 义从效果：公孙瓒体力<=2时，其他角色计算与他的距离+1
  const yicongToModifier = (hasCap(g.players[to], 'yicong') && 
                            g.players[to] && g.players[to].alive && 
                            (g.players[to].hp || g.players[to].maxHp) <= 2) ? 1 : 0;
  
  const fromMinus1 = equipDist(g.players[from], 'minus1') + (hasCap(g.players[from], 'extraMinus1') ? -1 : 0);
  const d = base + equipDist(g.players[to], 'plus1') + fromMinus1 + yicongFromModifier + yicongToModifier;
  
  return Math.max(1, d);
}
```

---

## 五、渲染集成（render-controls.js）

### 趫猛 UI 集成

```javascript
// 在 renderControls 中添加趫猛相关状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 趫猛：伤害结算后的触发选择
  if (g.pending && g.pending.type === 'qiaomengChoose' && g.pending.sourceSeat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【趫猛】发动</h4>
        <p>你使用黑色【杀】对 ${g.players[g.pending.targetSeat].name} 造成了伤害</p>
        <p>可以选择其装备区里的一张牌</p>
        <button onclick="triggerQiaomeng()" class="skill-btn" style="background: #d4a762;">
          选择装备牌
        </button>
        <button onclick="cancelQiaomeng()" class="cancel-btn">
          不发动
        </button>
      </div>
    `;
    return;
  }

  // 趫猛：选择装备牌
  if (g.pending && g.pending.type === 'qiaomengPickEquip' && g.pending.sourceSeat === seat) {
    const target = g.players[g.pending.targetSeat];
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【趫猛】选择装备牌</h4>
        <p>选择 ${target.name} 的一张装备牌：</p>
        <div class="equip-options">
    `;
    
    // 渲染可选装备
    const equips = target.equips || {};
    const equipNames = {
      weapon: '武器',
      armor: '防具',
      plus1: '防御马',
      minus1: '进攻马'
    };
    
    for (const slot of g.pending.availableSlots) {
      const card = equips[slot];
      if (card) {
        const isMount = isMountCard(card);
        ui.innerHTML += `
          <button onclick="pickQiaomengEquip('${slot}')" class="equip-btn">
            ${equipNames[slot] || slot}【${card.name}】${isMount ? '(坐骑-获得)' : '(弃置)'}
          </button>
        `;
      }
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelQiaomeng()" class="cancel-btn">取消</button>
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
  '趫猛': 'qiaomeng',
  '义从': 'yicong',
};
```

---

## 七、边界条件处理

### 趫猛

1. **目标无装备牌**：提示无法发动趫猛，直接清理状态
2. **目标装备区为空**：跳过选择流程
3. **黑色杀未造成伤害**：趫猛不触发（例如目标使用闪抵消了伤害）
4. **同时触发多次趫猛**：每次使用黑色杀造成伤害都可以独立触发趫猛
5. **目标阵亡**：在选择前验证目标是否存活，阵亡则取消
6. **非坐骑装备牌**：直接弃置到弃牌堆

### 义从

1. **体力值变化**：义从效果根据**当前体力值**动态变化，无需特别处理
2. **体力值为0**：视为不大于2，其他角色计算与公孙瓒的距离+1
3. **与其他距离修正叠加**：
   - 与-1马（赤兔、大宛、紫骍）：距离修正相加
   - 与+1马（的卢、绝影、爪黄飞电）：距离修正相加
   - 与武器射程：不影响，武器射程是攻击距离而非计算距离
4. **多个公孙瓒同时在场**：每个公孙瓒的义从效果独立计算

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| 趫猛：使用黑色杀造成伤害，目标有坐骑 | 可以选择获得该坐骑并置入手牌 |
| 趫猛：使用黑色杀造成伤害，目标有非坐骑装备 | 可以选择弃置该装备 |
| 趫猛：使用红色杀造成伤害 | 趫猛不触发 |
| 趫猛：使用黑色杀但目标闪抵消了伤害 | 趫猛不触发 |
| 趫猛：目标无装备 | 不能发动趫猛，提示错误 |
| 趫猛：同时使用黑色杀攻击多个目标 | 每个目标受到伤害后都可以独立触发趫猛 |
| 义从：体力>2时计算距离 | 与其他角色的距离-1 |
| 义从：体力<=2时，其他角色计算与我的距离 | 距离+1 |
| 义从：体力=3时 | 距离-1（大于2） |
| 义从：体力=2时 | 距离+1（不大于2） |
| 义从：体力=1时 | 距离+1（不大于2） |
| 义从：体力=0时 | 距离+1（不大于2） |
| 义从：与-1马同时存在 | 距离修正相加 |
| 义从：与+1马同时存在 | 距离修正相加 |
| 义从：多个公孙瓒同时在场 | 每个公孙瓒的义从效果独立计算 |

---

## 九、实现优先级

1. **义从优先**：锁定技，仅需要修改 distance 函数，实现简单
2. **趫猛优先**：需要集成到伤害结算流程中，涉及装备选择逻辑
3. **UI集成优先**：趫猛的选择界面渲染
4. **边界处理优先**：无装备等特殊情况

---

## 十、集成要点

### 与现有系统的集成

1. **伤害结算系统**：
   - 复用现有的伤害结算函数
   - 在伤害结算后添加趫猛触发检查

2. **距离计算系统**：
   - 修改 `distance` 函数以支持义从效果
   - 确保与现有距离修正机制（坐骑、马超马术等）叠加

3. **装备系统**：
   - 复用现有的装备槽定义（weapon, armor, plus1, minus1）
   - 使用 `isMountCard` 函数判断坐骑牌

4. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程

### 需要修改的文件

1. **data.js**：添加公孙瓒武将定义
2. **game.js**：
   - `normalize()`：添加趫猛状态字段防御
   - `distance()`：集成义从效果
   - `resolveShaUse()` 或伤害结算函数：添加趫猛触发检查
3. **skills.js**：添加趫猛技能辅助函数
4. **render-controls.js**：添加趫猛UI界面
5. **render.js**：可能需要添加状态显示

---

## 十一、流程图

### 趫猛完整流程
```
使用黑色【杀】
    ↓
造成伤害后
    ↓
检查是否有趫猛技能
    ↓
是：进入趫猛选择阶段
    ↓
玩家选择是否发动
    ↓
发动：选择目标装备区的一张牌
    ↓
判断是否为坐骑牌
    ↓
是：获得该坐骑（置入手牌）
    ↓
否：弃置该装备牌
    ↓
清理状态，回到出牌阶段
```

### 义从效果流程
```
计算距离时
    ↓
检查 from 是否为公孙瓒
    ↓
是且体力>2：距离-1
    ↓
检查 to 是否为公孙瓒
    ↓
是且体力<=2：距离+1
    ↓
与其他距离修正叠加
    ↓
返回最终距离值
```

---

## 十二、特殊说明

### 关于趫猛的触发时机

趫猛的触发时机是**当你使用黑色【杀】对一名角色造成伤害后**，这意味着：
- 必须是你**使用**的杀（不是借刀杀人等其他方式）
- 必须是**黑色**的杀（黑桃♠或梅花♣）
- 必须**造成了伤害**（目标未用闪抵消）
- 每次造成伤害都可以独立触发趫猛

### 关于义从的距离修正

义从是**锁定技**，持续生效：
- 当公孙瓒体力值**大于2**时，其他角色距离公孙瓒-1（公孙瓒更容易攻击到别人）
- 当公孙瓒体力值**不大于2**时，其他角色距离公孙瓒+1（公孙瓒更难被别人攻击到）
- 该效果**随时生效**，无需玩家操作

### 关于坐骑牌的判断

通过 `getEquip(card.name).slot` 检查是否为 'plus1' 或 'minus1'。

---

## 十三、修正记录

*文档状态：已实装*
*创建时间：2026-07-12*
*实装时间：2026-07-12*
*负责人：Mistral Vibe*

### 实装说明
- **data.js**: 添加了公孙瓒武将定义
- **game.js**: 
  - normalize函数：添加趫猛pending状态防御
  - distance函数：集成义从距离修正效果
  - maybeStartQiaomeng函数：趫猛触发检查
  - respondShan函数：添加趫猛触发调用
- **skills.js**: 添加isMountCard、triggerQiaomeng、pickQiaomengEquip、cancelQiaomeng函数
- **render-controls.js**: 添加趫猛UI界面

### 待优化项
- 音效文件：需要添加assets/audio/qiaomeng.mp3和assets/audio/yicong.mp3
