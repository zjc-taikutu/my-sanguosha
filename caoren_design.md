# 曹仁 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `caoren` |
| **武将名称** | 曹仁 |
| **势力** | 魏 |
| **性别** | male |
| **体力上限** | 4 |
| **技能** | 据守 |

---

## 二、技能说明

### 据守
**时机**：结束阶段

**效果**：
1. 你可以摸三张牌
2. 然后将你的武将牌翻面

**设计要点**：
- 属于**结束阶段**的主动技能，需在 `endPhase` 或结束阶段处理函数中集成
- 翻面逻辑：使用 `flipPlayer(g, seat)` 函数或直接修改 `g.players[seat].upsideDown` 字段
- 摸牌逻辑：使用 `drawN(g, seat, 3)` 函数
- 技能为**可选发动**，玩家可以选择是否使用
- **翻面状态说明**：武将牌处于背面朝上的状态称为翻面，翻面状态的角色在其回合开始时会**跳过整个回合**并自动翻回正面

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
caoren: {
  id: 'caoren',
  name: '曹仁',
  gender: 'male',
  maxHp: 4,
  skill: '据守',
  desc: '据守:结束阶段,你可以摸三张牌,然后将你的武将牌翻面。',
  caps: { jushou: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 曹仁【据守】:选择阶段
// pending 应包含 type、seat（曹仁的座位）
if(g.pending && g.pending.type==='jushouChoose'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     d.seat !== mySeat){
    g.pending = null;
    g.phase = 'end';
  }
}
```

在 `startTurn` 函数中无需添加重置项（翻面状态由游戏引擎自动处理）

---

## 四、技能实现

### 据守实现

**集成点**：`endPhase` 函数（结束阶段入口）

```javascript
// 修改 endPhase 函数，添加据守触发逻辑
function endPhase(g) {
  tx(g => {
    if (g.phase !== 'end' || g.turn !== mySeat) return g;
    const me = g.players[mySeat];
    
    // 据守：结束阶段可选触发（仅未翻面时可发动）
    if (generalHasCap(me, 'jushou') && me.alive && !me.upsideDown) {
      // 进入据守选择阶段
      g.pending = {
        type: 'jushouChoose',
        seat: mySeat
      };
      g.phase = 'jushouChoose';
      g.log = pushLog(g.log, `${me.name} 可以发动【据守】,是否摸三张牌并翻面?`);
      return g;
    }
    
    // 正常结束回合
    g.phase = 'end';
    return g;
  });
}
```

```javascript
// 据守确认发动
function confirmJushou() {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'jushouChoose' || pending.seat !== mySeat) return g;
    
    const me = g.players[mySeat];
    if (!me || !me.alive) return g;
    
    // 执行据守效果：摸三张牌
    drawN(g, mySeat, 3);
    
    // 翻面
    me.upsideDown = !me.upsideDown;
    g.log = pushLog(g.log, `${me.name} 发动【据守】,摸了三张牌并翻面`);
    markSkillSound(g, '据守');
    
    // 清理状态
    g.pending = null;
    g.phase = 'end';
    
    return g;
  });
}
```

```javascript
// 据守取消发动
function cancelJushou() {
  tx(g => {
    if (g.pending && g.pending.type === 'jushouChoose' && g.pending.seat === mySeat) {
      const me = g.players[mySeat];
      g.pending = null;
      g.phase = 'end';
      g.log = pushLog(g.log, `${me.name} 取消发动【据守】`);
    }
    return g;
  });
}
```

---

## 五、渲染集成（render-controls.js）

### 据守 UI 集成

```javascript
// 在 renderControls 中添加据守选择状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 据守：选择阶段
  if (g.pending && g.pending.type === 'jushouChoose' && g.pending.seat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【据守】发动</h4>
        <p>是否摸三张牌并翻面?</p>
        <button onclick="confirmJushou()" class="skill-btn" style="background: #d4a762;">
          确认发动
        </button>
        <button onclick="cancelJushou()" class="cancel-btn">
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
  '据守': 'jushou',
};
```

---

## 七、边界条件处理

### 据守
1. **牌堆不足**：使用 `ensureDeck(g)` 确保有足够的牌可摸，若牌堆+弃牌堆总牌数<3，则摸完所有剩余的牌
2. **角色死亡**：角色死亡时不能发动据守
3. **已翻面状态**：仅未翻面时可以发动据守
4. **多次发动**：每回合结束阶段只能发动一次
5. **取消操作**：在选择阶段应能取消

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| 据守：结束阶段，牌堆足够3张 | 摸3张牌，武将牌翻面 |
| 据守：结束阶段，牌堆仅1张 | 摸1张牌，武将牌翻面 |
| 据守：结束阶段，牌堆为空 | 不摸牌，武将牌仍翻面 |
| 据守：结束阶段，取消发动 | 不摸牌，不翻面 |
| 据守：结束阶段，角色已翻面 | 不能发动 |
| 据守：结束阶段，角色死亡 | 不触发 |
| 边界：连续两个回合发动据守 | 第一个回合翻面，第二个回合被跳过，第三个回合可再次发动 |
| 边界：连续发动时牌堆不足 | 按实际剩余牌数摸牌，并翻面 |

---

## 九、实现优先级

1. **数据定义优先**：添加武将基本定义
2. **状态管理优先**：添加pending状态防御
3. **核心逻辑优先**：实现摸牌和翻面的核心效果
4. **UI集成优先**：添加技能选择界面
5. **音效集成**：添加技能音效
6. **边界处理**：处理牌堆不足等边界条件
7. **测试验证**：确保所有场景都通过测试

---

## 十、集成要点

### 与现有系统的集成

1. **翻面系统**：
   - 复用现有的翻面状态处理，确保翻面后角色无法使用主动技能

2. **摸牌系统**：
   - 复用 `drawN` 函数和 `ensureDeck` 函数
   - 确保摸牌逻辑与其他摸牌技能一致

3. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 状态机控制流程

4. **日志系统**：
   - 为据守的发动添加对应的日志记录
   - 确保日志清晰地反映技能的发动和效果

### 需要修改的文件

1. **data.js**：
   - 添加曹仁武将定义

2. **game.js**：
   - `normalize()`：添加据守状态字段防御
   - 修改 `endPhase` 函数：添加据守触发逻辑
   - 添加 `confirmJushou`、`cancelJushou` 函数

3. **render-controls.js**：
   - 添加据守的UI界面
   - 添加技能选择和确认界面

---

## 十一、流程图

### 据守完整流程
```
结束阶段开始
    ↓
检查是否拥有据守技能
    ↓
是：进入据守选择阶段，显示确认界面
    ↓
玩家选择确认发动
    ↓
摸三张牌
    ↓
武将牌翻面
    ↓
清理pending状态
    ↓
结束回合
```

---

## 十二、特殊说明

### 关于据守的技能定位

据守是曹仁的守成型技能，体现了其防御稳健的特点。通过在结束阶段摸牌并翻面，曹仁可以获得额外的手牌资源。

**翻面状态说明**：
武将牌处于背面朝上的状态称为翻面。翻面状态的角色在其回合开始时会**跳过整个回合**并自动翻回正面。因此，发动据守后的下一个回合将无法进行任何操作。

**技能特点**：
- 可选发动：玩家可以根据场上形势选择是否发动
- 资源获取：每次发动可以获得3张手牌
- 翻面代价：下回合将被跳过
- 发动限制：每回合结束阶段可发动一次，且仅未翻面时可发动

### 关于技能平衡性

曹仁作为4体力的魏国武将，据守提供了手牌补给：
- 每回合可以获得3张额外手牌
- 翻面导致下回合跳过，这是技能的平衡机制
- 仅未翻面时可发动，限制了技能的连续使用
- 与其他魏国武将的协同性良好

### 关于与其他技能的交互

1. **与翻面相关技能的交互**：
   - 若场上有其他翻面相关的技能，需确保据守的翻面效果能够正确叠加

2. **与摸牌相关技能的交互**：
   - 据守的摸牌效果应正常触发其他摸牌相关的技能效果

---

## 十三、修正记录

*文档状态：设计阶段*
*创建时间：2026-07-12*
*负责人：Mistral Vibe*

### 待实装项

- [ ] **data.js**: 添加曹仁武将定义
- [ ] **game.js**: 
  - [ ] normalize函数：添加据守状态字段防御
  - [ ] 修改endPhase函数：添加据守触发逻辑
  - [ ] 添加据守相关函数
- [ ] **render-controls.js**: 
  - [ ] 添加据守UI界面

### 待优化项

- 音效文件：需要添加assets/audio/jushou.mp3
- UI/UX：据守选择界面的用户体验优化
- 性能：确保摸牌时的性能
- 兼容性：确保与现有所有技能的兼容性
