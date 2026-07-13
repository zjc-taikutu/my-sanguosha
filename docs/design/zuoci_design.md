# 左慈 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `zuoci` |
| **武将名称** | 左慈 |
| **势力** | 群 |
| **性别** | male |
| **体力上限** | 3 |
| **技能** | 化身 / 新生 |

---

## 二、技能说明

### 化身
**时机**：①游戏开始时；②回合开始或结束时

**效果**：
1. **初始化**：游戏开始时，你随机获得两张武将牌作为"化身"牌
2. **选择技能**：你选择其中一张"化身"牌的一个技能并亮出之
3. **获得效果**：你视为拥有此技能，且性别和势力视为与"化身"牌相同
4. **重置**：回合开始或结束时，你可以重新进行一次"化身"（重新随机获得两张武将牌并选择技能）

**设计要点**：
- 属于**游戏开始时的初始化技能**和**回合开始/结束时的可选触发技能**
- 需要维护左慈当前的"化身"状态，包括：当前化身武将、当前化身技能、当前性别、当前势力
- 需要从武将牌堆中随机抽取两张武将牌（不能是左慈自己）
- 技能选择阶段需要展示可选的技能列表供玩家选择
- 重新化身时，需要清除之前的化身状态，并重新获取新的武将牌和技能
- 化身获得的技能需要视为左慈自身拥有，能正常触发和被其他技能检测到
- 性别和势力的变化会影响相关判定（如锦囊的目标选择、势力相关技能等）

### 新生
**时机**：当你受到1点伤害后

**效果**：
若你有技能"化身"，你可以随机获得一张新的"化身"牌。

**设计要点**：
- 属于**受到伤害后的触发技能**，在伤害结算后检查
- 触发条件：**受到1点伤害**（每次受到1点伤害都可以独立触发）
- 触发时机：伤害结算完成后
- 需要检查左慈是否有"化身"技能（即是否还存活，因为化身技能在左慈死亡时失效）
- 获得新的化身牌后，需要重新选择技能（或保持当前选择的技能，根据规则理解）
- 新的化身牌会替换掉当前的其中一张化身牌，或者直接添加到化身牌池中

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
zuoci: {
  id: 'zuoci',
  name: '左慈',
  gender: 'male',
  maxHp: 3,
  skill: '化身/新生',
  desc: '化身:①游戏开始时,你随机获得两张武将牌作为"化身"牌,然后你选择其中一张"化身"牌的一个技能并亮出之,然后你视为拥有此技能,且性别和势力视为与"化身"牌相同。②回合开始或结束时,你可以重新进行一次"化身".新生:当你受到1点伤害后,若你有技能"化身",你可以随机获得一张新的"化身"牌。',
  caps: { huashen: true, xinsheng: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 左慈【化身】:化身状态
// 需要存储：化身武将列表、当前选择的化身武将、当前选择的技能、原始性别、原始势力
if(typeof g.huashen !== 'object') g.huashen = {};
if(typeof g.huashen.seat !== 'number') g.huashen.seat = null; // 使用化身的玩家座位
if(!Array.isArray(g.huashen.availGenerals)) g.huashen.availGenerals = []; // 可选的化身武将列表
if(typeof g.huashen.currentGeneral !== 'string') g.huashen.currentGeneral = null; // 当前选择的化身武将ID
if(typeof g.huashen.currentSkill !== 'string') g.huashen.currentSkill = null; // 当前选择的化身技能
if(typeof g.huashen.originalGender !== 'string') g.huashen.originalGender = 'male'; // 原始性别
if(typeof g.huashen.originalKingdom !== 'string') g.huashen.originalKingdom = 'qun'; // 原始势力
if(typeof g.huashen.phase !== 'string') g.huashen.phase = null; // 化身阶段：null, 'chooseGeneral', 'chooseSkill'

// 左慈【化身】:选择阶段的pending状态
if(g.pending && g.pending.type==='huashenChooseGeneral'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     !Array.isArray(d.availGenerals) || d.availGenerals.length !== 2 ||
     d.availGenerals.some(id => typeof id !== 'string' || !DATA.generals[id])){
    g.pending = null;
    g.huashen.phase = null;
  }
}

if(g.pending && g.pending.type==='huashenChooseSkill'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     typeof d.generalId !== 'string' || !DATA.generals[d.generalId] ||
     !Array.isArray(d.availableSkills) || d.availableSkills.length === 0 ||
     d.availableSkills.some(skill => typeof skill !== 'string')){
    g.pending = null;
    g.huashen.phase = null;
  }
}

// 左慈【新生】:触发阶段
if(g.pending && g.pending.type==='xinshengChoose'){
  const d = g.pending;
  if(typeof d.seat!=='number' || !g.players[d.seat] || !g.players[d.seat].alive ||
     !Array.isArray(d.newGeneral) || d.newGeneral.length !== 1 ||
     typeof d.newGeneral[0] !== 'string' || !DATA.generals[d.newGeneral[0]]){
    g.pending = null;
  }
}
```

在 `startTurn` 函数中添加重置：
```javascript
// 左慈【化身】:回合开始时可以重新化身
// 在回合开始时检查是否需要触发化身选择
if(g.players[g.turn] && hasCap(g.players[g.turn], 'huashen')){
  // 可以在这里添加标志位，但在实际触发时再处理
}
```

---

## 四、技能实现

### 化身实现

**集成点**：游戏初始化阶段、回合开始阶段、回合结束阶段、伤害结算阶段

```javascript
// 在 game.js 的 initGame 函数中添加化身初始化
function initGame(g, playerCount) {
  tx(g => {
    // ... 现有初始化代码 ...
    
    // 左慈【化身】初始化
    for (let i = 0; i < g.players.length; i++) {
      const player = g.players[i];
      if (player && hasCap(player, 'huashen')) {
        // 获取两个随机的其他武将作为化身牌
        const availGenerals = getRandomGeneralsForHuashen(g, player, 2);
        
        if (availGenerals.length === 2) {
          g.huashen = {
            seat: i,
            availGenerals: availGenerals,
            currentGeneral: null,
            currentSkill: null,
            originalGender: player.gender,
            originalKingdom: player.kingdom || 'qun',
            phase: 'chooseGeneral'
          };
          
          // 进入化身选择阶段
          g.pending = {
            type: 'huashenChooseGeneral',
            seat: i,
            availGenerals: availGenerals
          };
          g.log = pushLog(g.log, `${player.name} 发动【化身】,获得化身牌: ${DATA.generals[availGenerals[0]].name} 和 ${DATA.generals[availGenerals[1]].name}`);
          markSkillSound(g, '化身');
          
          break; // 一个游戏中只可能有一个左慈
        }
      }
    }
    
    return g;
  });
}

// 获取随机武将用于化身
function getRandomGeneralsForHuashen(g, zuociPlayer, count) {
  const allGeneralIds = Object.keys(DATA.generals);
  const result = [];
  const zuociId = zuociPlayer.id;
  
  // 过滤掉左慈自己
  const available = allGeneralIds.filter(id => id !== zuociId);
  
  if (available.length < count) {
    return result; // 不够武将可选
  }
  
  // 随机选择count个武将
  for (let i = 0; i < count; i++) {
    const randomIdx = Math.floor(Math.random() * available.length);
    result.push(available[randomIdx]);
    available.splice(randomIdx, 1); // 确保不重复
  }
  
  return result;
}

// 选择化身武将
function chooseHuashenGeneral(generalId) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'huashenChooseGeneral' || pending.seat !== mySeat) return g;
    
    const seat = pending.seat;
    const player = g.players[seat];
    
    if (!player || !player.alive) return g;
    
    if (!pending.availGenerals.includes(generalId)) return g;
    
    const general = DATA.generals[generalId];
    if (!general) return g;
    
    // 获取该武将的所有技能
    const skills = general.skill ? general.skill.split('/') : [];
    
    // 进入技能选择阶段
    g.huashen.phase = 'chooseSkill';
    g.huashen.currentGeneral = generalId;
    g.pending = {
      type: 'huashenChooseSkill',
      seat: seat,
      generalId: generalId,
      availableSkills: skills
    };
    g.log = pushLog(g.log, `${player.name} 选择 ${general.name} 为化身武将,请选择一个技能`);
    
    return g;
  });
}

// 选择化身技能
function chooseHuashenSkill(skill) {
  tx(g => {
    const pending = g.pending;
    if (!pending || pending.type !== 'huashenChooseSkill' || pending.seat !== mySeat) return g;
    
    const seat = pending.seat;
    const player = g.players[seat];
    
    if (!player || !player.alive) return g;
    if (!pending.availableSkills.includes(skill)) return g;
    
    const general = DATA.generals[pending.generalId];
    if (!general) return g;
    
    // 设置化身状态
    g.huashen.currentGeneral = pending.generalId;
    g.huashen.currentSkill = skill;
    g.huashen.phase = null;
    
    // 更新玩家的性别和势力（视为拥有化身武将的性别和势力）
    player.gender = general.gender;
    player.kingdom = general.kingdom;
    
    // 为左慈添加化身技能的cap
    // 需要将化身技能添加到玩家的caps中
    if (!player.caps) player.caps = {};
    player.caps[skill] = true;
    
    // 清理pending
    g.pending = null;
    
    g.log = pushLog(g.log, `${player.name} 选择化身技能【${skill}】,性别视为${general.gender},势力视为${general.kingdom}`);
    
    return g;
  });
}

// 重新进行化身（回合开始或结束时）
function redoHuashen() {
  tx(g => {
    const me = g.players[mySeat];
    
    if (!me || !me.alive || !hasCap(me, 'huashen')) return g;
    if (g.phase !== 'start' && g.phase !== 'end') return g;
    
    // 检查是否是左慈的回合
    if (g.turn !== mySeat) return g;
    
    // 获取新的两个随机武将
    const newGenerals = getRandomGeneralsForHuashen(g, me, 2);
    
    if (newGenerals.length === 2) {
      // 清理当前的化身状态
      // 移除之前的化身技能
      if (g.huashen && g.huashen.currentSkill && me.caps) {
        delete me.caps[g.huashen.currentSkill];
      }
      
      // 恢复原始性别和势力
      if (g.huashen) {
        me.gender = g.huashen.originalGender;
        me.kingdom = g.huashen.originalKingdom;
      }
      
      // 设置新的化身状态
      g.huashen.availGenerals = newGenerals;
      g.huashen.currentGeneral = null;
      g.huashen.currentSkill = null;
      g.huashen.phase = 'chooseGeneral';
      
      g.pending = {
        type: 'huashenChooseGeneral',
        seat: mySeat,
        availGenerals: newGenerals
      };
      
      g.log = pushLog(g.log, `${me.name} 发动【化身】,重新获得化身牌: ${DATA.generals[newGenerals[0]].name} 和 ${DATA.generals[newGenerals[1]].name}`);
      markSkillSound(g, '化身');
    }
    
    return g;
  });
}

// 取消化身选择
function cancelHuashen() {
  tx(g => {
    if (g.pending && (g.pending.type === 'huashenChooseGeneral' || g.pending.type === 'huashenChooseSkill') &&
        g.pending.seat === mySeat) {
      g.pending = null;
      g.huashen.phase = null;
      g.log = pushLog(g.log, `${g.players[mySeat].name} 取消发动【化身】`);
    }
    return g;
  });
}

// 检查左慈是否有化身技能（用于新生触发条件）
function zuociHasHuashen(g, seat) {
  const player = g.players[seat];
  if (!player || !player.alive) return false;
  
  // 检查是否是左慈且有化身技能
  if (player.id === 'zuoci' && hasCap(player, 'huashen')) {
    // 检查是否已经有化身状态
    return g.huashen && g.huashen.seat === seat && g.huashen.currentGeneral !== null;
  }
  return false;
}
```

### 新生实现

**集成点**：伤害结算后的阶段

```javascript
// 在 resolveDamageEffect 或类似伤害结算函数中添加新生触发检查
function resolveDamage(g, damageInfo) {
  tx(g => {
    // ... 现有伤害结算逻辑 ...
    
    const { sourceSeat, targetSeat, damage, card } = damageInfo;
    
    // 左慈【新生】:受到1点伤害后触发
    if (zuociHasHuashen(g, targetSeat) && damage === 1) {
      const target = g.players[targetSeat];
      
      if (target && target.alive) {
        // 获得一个新的化身牌
        const allGeneralIds = Object.keys(DATA.generals);
        const zuociId = target.id;
        const available = allGeneralIds.filter(id => id !== zuociId);
        
        if (available.length > 0) {
          const randomIdx = Math.floor(Math.random() * available.length);
          const newGeneralId = available[randomIdx];
          
          // 将新的化身牌添加到可选列表中
          // 根据规则描述，"随机获得一张新的化身牌"，理解为替换其中一张或直接添加
          // 这里采用替换当前未被选择的那张化身牌
          if (g.huashen && g.huashen.availGenerals) {
            // 找到当前未被选择的化身牌
            const currentGenerals = g.huashen.availGenerals;
            const unselectedGenerals = currentGenerals.filter(id => id !== g.huashen.currentGeneral);
            
            if (unselectedGenerals.length > 0) {
              // 替换第一张未被选择的化身牌
              const replaceIdx = currentGenerals.indexOf(unselectedGenerals[0]);
              currentGenerals[replaceIdx] = newGeneralId;
            } else {
              // 如果两张都是当前选择的，就替换第二张
              currentGenerals[1] = newGeneralId;
            }
            
            g.huashen.availGenerals = currentGenerals;
          }
          
          g.log = pushLog(g.log, `${target.name} 受到伤害,发动【新生】,获得新的化身牌: ${DATA.generals[newGeneralId].name}`);
          markSkillSound(g, '新生');
        }
      }
    }
    
    return g;
  });
}

// 更精确的新生触发：在每次受到1点伤害后
function triggerXinsheng(g, targetSeat, damage) {
  tx(g => {
    // 检查是否是左慈且有化身
    if (!zuociHasHuashen(g, targetSeat)) return g;
    if (damage !== 1) return g; // 只对1点伤害触发
    
    const target = g.players[targetSeat];
    if (!target || !target.alive) return g;
    
    // 获得一个新的化身牌
    const allGeneralIds = Object.keys(DATA.generals);
    const zuociId = target.id;
    const available = allGeneralIds.filter(id => id !== zuociId);
    
    if (available.length === 0) return g;
    
    const randomIdx = Math.floor(Math.random() * available.length);
    const newGeneralId = available[randomIdx];
    
    // 添加到化身牌池中
    if (!g.huashen) {
      g.huashen = {
        seat: targetSeat,
        availGenerals: [],
        currentGeneral: null,
        currentSkill: null,
        originalGender: 'male',
        originalKingdom: 'qun'
      };
    }
    
    // 替换其中一张化身牌（这里采用随机替换）
    if (g.huashen.availGenerals && g.huashen.availGenerals.length >= 2) {
      const replaceIdx = Math.floor(Math.random() * 2);
      g.huashen.availGenerals[replaceIdx] = newGeneralId;
    } else {
      // 如果没有化身牌，就初始化两张（这种情况不应该发生）
      g.huashen.availGenerals = [newGeneralId, getRandomGeneralsForHuashen(g, target, 1)[0] || newGeneralId];
    }
    
    // 如果新生获得的化身牌更好，可以考虑让玩家选择是否切换
    // 但根据规则描述，只说"随机获得一张新的化身牌"，没有说是否可以切换技能
    // 所以这里仅获得牌，不自动切换技能
    
    g.log = pushLog(g.log, `${target.name} 发动【新生】,获得新的化身牌: ${DATA.generals[newGeneralId].name}`);
    markSkillSound(g, '新生');
    
    return g;
  });
}
```

---

## 五、渲染集成（render-controls.js）

### 化身 UI 集成

```javascript
// 在 renderControls 中添加化身相关状态
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];

  // 化身：选择武将阶段
  if (g.pending && g.pending.type === 'huashenChooseGeneral' && g.pending.seat === seat) {
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【化身】选择武将</h4>
        <p>请选择一张武将牌作为化身：</p>
        <div class="general-options">
    `;
    
    for (const generalId of g.pending.availGenerals) {
      const general = DATA.generals[generalId];
      if (general) {
        ui.innerHTML += `
          <button onclick="chooseHuashenGeneral('${generalId}')" class="general-btn">
            ${general.name} (${general.kingdom})<br>
            <small>技能: ${general.skill || '无'}</small>
          </button>
        `;
      }
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelHuashen()" class="cancel-btn">取消</button>
      </div>
    `;
    return;
  }

  // 化身：选择技能阶段
  if (g.pending && g.pending.type === 'huashenChooseSkill' && g.pending.seat === seat) {
    const general = DATA.generals[g.pending.generalId];
    ui.innerHTML += `
      <div class="skill-choose">
        <h4>【化身】选择技能</h4>
        <p>为 ${general.name} 选择一个技能：</p>
        <div class="skill-options">
    `;
    
    for (const skill of g.pending.availableSkills) {
      ui.innerHTML += `
        <button onclick="chooseHuashenSkill('${skill}')" class="skill-btn">
          【${skill}】
        </button>
      `;
    }
    
    ui.innerHTML += `
        </div>
        <button onclick="cancelHuashen()" class="cancel-btn">取消</button>
      </div>
    `;
    return;
  }

  // 化身：回合开始/结束时的重新化身按钮
  if (hasCap(me, 'huashen') && (g.phase === 'start' || g.phase === 'end') && g.turn === seat) {
    ui.innerHTML += `
      <button onclick="redoHuashen()" class="skill-btn" style="background: #9b59b6;">
        重新化身
      </button>
    `;
  }

  // 显示当前化身状态
  if (g.huashen && g.huashen.seat === seat && g.huashen.currentGeneral) {
    const general = DATA.generals[g.huashen.currentGeneral];
    const currentSkill = g.huashen.currentSkill;
    
    ui.innerHTML += `
      <div class="huashen-status">
        <span style="color: #9b59b6;">
          化身: ${general.name} (${general.kingdom}) | 技能: 【${currentSkill}】
        </span>
      </div>
    `;
  }
}
```

---

## 六、音效标识

在 `markSkillSound` 中添加：
```javascript
const SKILL_SOUNDS = {
  // ... 现有技能 ...
  '化身': 'huashen',
  '新生': 'xinsheng',
};
```

---

## 七、边界条件处理

### 化身

1. **武将牌堆不足**：若可选的武将牌数量不足2张，则化身失败，保持原样
2. **没有技能的武将**：若随机到的武将没有技能，则无法选择技能，需要重新随机
3. **重复的武将**：确保随机的两张化身牌不重复
4. **左慈死亡**：左慈死亡后，化身状态自动清理
5. **多个左慈**：游戏中不应存在多个左慈，但需防御性编程
6. **技能冲突**：若化身获得的技能与左慈自身或其他技能冲突，需要处理优先级
7. **性别/势力变化**：性别和势力的变化需要影响后续的判定（如锦囊、技能触发条件等）
8. **回合开始/结束时机**：确保在正确的时机触发重新化身的选择
9. **取消操作**：在选择武将和技能阶段都应能取消
10. **状态持久化**：化身状态需要在回合之间保持，直到左慈死亡或重新化身

### 新生

1. **受到大于1点的伤害**：新生只对每1点伤害触发一次，若受到3点伤害，应触发3次新生
2. **左慈死亡**：左慈死亡后，新生不再触发
3. **没有化身技能**：若左慈没有化身技能（即未完成化身选择），新生不触发
4. **武将牌堆不足**：若没有足够的武将牌可选，新生失败
5. **重复获得相同武将**：允许获得相同的武将牌
6. **新生与化身的关系**：新生获得的化身牌是否可以立即使用？根据规则，需要明确
7. **连锁触发**：受到多次1点伤害时，每次都可以独立触发新生

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **化身** |
| 化身：游戏开始时左慈获得两张随机武将牌 | 进入化身武将选择阶段 |
| 化身：选择武将后进入技能选择阶段 | 显示该武将的所有技能供选择 |
| 化身：选择技能后完成化身 | 左慈获得该技能，性别和势力变化 |
| 化身：回合开始时选择重新化身 | 重新获得两张武将牌，重新选择技能 |
| 化身：回合结束时选择重新化身 | 重新获得两张武将牌，重新选择技能 |
| 化身：武将没有技能 | 跳过技能选择，或重新随机武将 |
| 化身：取消选择 | 回到之前的状态，保持原样 |
| 化身：左慈死亡后 | 化身状态清理，技能失效 |
| 化身：性别变化影响技能判定 | 正确使用新的性别进行判定 |
| 化身：势力变化影响锦囊 | 正确使用新的势力进行判定 |
| **新生** |
| 新生：左慈受到1点伤害 | 触发新生，获得一张新的化身牌 |
| 新生：左慈受到3点伤害 | 触发3次新生（每1点伤害触发一次） |
| 新生：左慈没有化身技能 | 新生不触发 |
| 新生：武将牌堆不足 | 新生失败，保持原样 |
| 新生：获得的化身牌与当前相同 | 正常添加，可以替换 |
| **组合测试** |
| 化身+新生：化身后受到伤害 | 先触发新生获得新化身牌，然后可以重新选择 |
| 化身+新生：多次受伤 | 每次受伤都触发新生，化身牌池不断更新 |

---

## 九、实现优先级

1. **化身优先**：这是左慈的核心技能，需要先实现
   - 游戏初始化时的化身选择
   - 武将和技能的选择UI
   - 性别和势力的动态变化
   - 化身技能的集成
2. **新生优先**：在化身基础上实现新生
   - 伤害触发机制
   - 化身牌的更新逻辑
3. **UI集成优先**：完整的化身选择界面
4. **边界处理优先**：各种边界条件的测试和修复
5. **音效集成**：添加技能音效

---

## 十、集成要点

### 与现有系统的集成

1. **游戏初始化系统**：
   - 在 `initGame` 中集成化身的初始触发
   - 确保在玩家初始化后执行

2. **回合开始/结束系统**：
   - 在 `startTurn` 和 `endTurn` 中添加重新化身的触发点
   - 需要正确的时机判断

3. **伤害结算系统**：
   - 在 `resolveDamage` 中集成新生的触发检查
   - 每次受到1点伤害都独立触发

4. **状态管理系统**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 使用 `g.phase` 和 `g.pending` 状态机控制流程

5. **技能系统**：
   - 化身获得的技能需要添加到玩家的 `caps` 中
   - 需要确保化身技能能被 `hasCap` 检测到
   - 需要处理技能可能的冲突和优先级

6. **性别和势力系统**：
   - 左慈的性别和势力会动态变化
   - 需要更新所有相关的判定逻辑
   - 可能需要添加辅助函数来获取左慈的当前性别和势力

### 需要修改的文件

1. **data.js**：
   - 添加左慈武将定义

2. **game.js**：
   - `normalize()`：添加化身状态字段防御
   - `initGame()`：添加化身初始化
   - `startTurn()`：添加重新化身的触发点
   - `endTurn()`：添加重新化身的触发点
   - `resolveDamage()`：添加新生触发检查
   - 添加 `getRandomGeneralsForHuashen`、`chooseHuashenGeneral`、`chooseHuashenSkill`、`redoHuashen`、`cancelHuashen`、`zuociHasHuashen` 等函数

3. **skills.js**：
   - 可能需要添加辅助函数

4. **render-controls.js**：
   - 添加化身选择UI界面
   - 添加重新化身按钮
   - 添加化身状态显示

5. **render.js**：
   - 可能需要添加化身状态的显示

---

## 十一、流程图

### 化身完整流程
```
游戏开始
    ↓
检查是否有左慈
    ↓
是：随机获得两张武将牌作为化身牌
    ↓
进入化身武将选择阶段
    ↓
玩家选择一张武将
    ↓
进入化身技能选择阶段
    ↓
玩家选择一个技能
    ↓
左慈获得该技能，性别和势力变化
    ↓
清理pending状态，化身完成
    ↓
回合开始/结束时
    ↓
玩家可以选择重新化身
    ↓
重复上述流程
```

### 新生完整流程
```
左慈受到伤害
    ↓
检查伤害点数是否为1
    ↓
是：检查是否有化身技能
    ↓
是：随机获得一张新的化身牌
    ↓
将新化身牌添加到化身牌池
    ↓
触发新生音效和日志
    ↓
继续游戏
```

---

## 十二、特殊说明

### 关于化身的技能定位

化身是左慈的核心特色技能，体现了左慈"道术"的设定：
- **多变性**：通过化身不同武将，左慈可以灵活应对不同局面
- **随机性**：化身牌是随机获得的，增加了游戏的不确定性
- **策略性**：玩家需要根据当前局面选择合适的化身武将和技能
- **限制性**：每次只能选择一个技能，且性别和势力也会相应变化

**技能特点**：
- 游戏开始时自动触发，无需玩家操作
- 回合开始/结束时可以主动重新化身
- 化身获得的技能视为左慈自身拥有
- 性别和势力的变化会影响后续判定

### 关于化身的平衡性

左慈作为3体力的群雄武将，化身提供了强大的灵活性：
- **优势**：可以获得其他武将的强力技能，适应不同局面
- **劣势**：体力较低（3点），且化身牌是随机的，可能获得弱势武将的技能
- **随机性**：化身牌的随机性使得左慈的强度有波动，但整体上通过新生技能可以持续获得新的化身牌

### 关于新生的触发时机

新生的触发时机是**当你受到1点伤害后**，这意味着：
- 每次受到**1点**伤害都可以独立触发一次新生
- 若受到3点伤害，可以触发3次新生，获得3张新的化身牌
- 但化身牌池只有2个位置，所以后续的新生会替换掉原有的化身牌

### 关于化身牌池的管理

化身牌池包含2张武将牌：
- 初始时：随机获得2张
- 重新化身时：重新随机获得2张
- 新生触发时：随机替换掉其中一张

玩家选择化身技能时，只能从当前的2张武将牌中选择一个技能。

### 关于性别和势力的处理

左慈的性别和势力会根据当前的化身武将而变化：
- 当选择化身武将后，左慈的性别和势力立即变为该武将的性别和势力
- 重新化身时，性别和势力会重新变化
- 这会影响所有依赖性别或势力的判定，例如：
  - 性别：某些技能只对特定性别有效（如贾诩的乱武只能对男性角色使用）
  - 势力：某些技能只对特定势力有效，或者锦囊的目标选择

---

## 十三、修正记录

*文档状态：设计阶段*
*创建时间：2026-07-12*
*负责人：Mistral Vibe*

### 待实装项

- [ ] **data.js**: 添加左慈武将定义
- [ ] **game.js**: 
  - [ ] `normalize()`: 添加化身和新生状态字段防御
  - [ ] `initGame()`: 添加化身初始化
  - [ ] `startTurn()`: 添加重新化身触发点
  - [ ] `endTurn()`: 添加重新化身触发点
  - [ ] `resolveDamage()`: 添加新生触发检查
  - [ ] 添加化身相关辅助函数
- [ ] **render-controls.js**: 
  - [ ] 添加化身选择UI界面
  - [ ] 添加重新化身按钮
  - [ ] 添加化身状态显示
- [ ] **render.js**: 添加化身状态显示（如需要）

### 待优化项

- 音效文件：需要添加assets/audio/huashen.mp3和assets/audio/xinsheng.mp3
- UI/UX：化身选择界面的用户体验优化
- 性能：化身武将选择时的随机算法优化
- 兼容性：确保与现有所有技能的兼容性（特别是那些依赖性别、势力的技能）
- 动画：化身切换时的视觉效果

### 实现难点

1. **化身技能的动态集成**：化身获得的技能需要视为左慈自身拥有，这需要确保技能系统能够动态处理
2. **性别和势力的动态变化**：需要更新所有相关的判定逻辑，确保正确使用当前的性别和势力
3. **状态管理**：化身状态需要在回合之间保持，且需要处理多个状态字段
4. **与现有技能的兼容性**：需要确保化身和新生不会与现有技能产生冲突

---

*注：化身技能是左慈的核心机制，实现复杂度较高，需要特别注意状态管理和与现有系统的集成。新生技能相对简单，但在伤害结算中需要正确触发。*