# 袁术 武将设计文档

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `yuanshu` |
| **武将名称** | 袁术 |
| **势力** | 群 |
| **性别** | male |
| **体力上限** | 4 |
| **技能** | 妄尊 / 同疾 |

---

## 二、技能说明

### 妄尊
**时机**：主公的准备阶段

**效果**：
1. 你可以摸一张牌
2. 然后其本回合的手牌上限-1

**设计要点**：
- 触发时机：**主公的准备阶段**（即主公角色的回合开始前的准备阶段）
- **身份技能**：该技能需要主公身份系统支持，当前项目未实装身份系统
- 目标对象：**主公角色**
- 效果分为两部分：摸牌（+1手牌）和手牌上限减少（-1）
- 手牌上限修正仅在**本回合**生效
- 由于身份系统未实装，该技能**暂不实现**，仅做设计说明

### 同疾（锁定技）
**时机**：持续生效

**效果**：
若你的手牌数大于体力值，攻击范围内包含你的其他角色使用【杀】不能指定除你以外的角色为目标。

**设计要点**：
- 属于**锁定技**，无需玩家操作，自动生效
- 触发条件：**当前手牌数 > 当前体力值**
- 影响范围：**攻击范围内包含袁术的其他角色**（即所有能攻击到袁术的角色）
- 限制内容：这些角色使用【杀】时，**只能选择袁术为目标**，不能选择其他角色
- 需要集成到【杀】的目标选择验证流程中
- 当条件不满足时（手牌数 <= 体力值），技能效果自动消失

---

## 三、数据定义（data.js）

### 武将表条目
```javascript
yuanshu: {
  id: 'yuanshu',
  name: '袁术',
  gender: 'male',
  maxHp: 4,
  skill: '妄尊/同疾',
  desc: '妄尊:主公的准备阶段,你可以摸一张牌,然后其本回合的手牌上限-1。同疾:锁定技,若你的手牌数大于体力值,攻击范围内包含你的其他角色使用【杀】不能指定除你以外的角色为目标。',
  caps: { tongji: true },
  hooks: {}
}
```

### 状态字段扩展（normalize）

在 `game.js` 的 `normalize(g)` 函数中添加：
```javascript
// 袁术【同疾】:无需额外状态字段，效果在目标选择时动态计算
// 但可添加辅助标志位用于性能优化（可选）
if(typeof g.tongjiActive!=='boolean') g.tongjiActive=false;
```

---

## 四、技能实现

### 妄尊实现

**状态**：暂不实现

**原因**：
- 该技能需要**主公身份系统**支持
- 当前项目未实装身份系统
- 需要识别主公角色并监听其准备阶段

**设计思路（供后续实装参考）**：

**集成点**：回合开始前的准备阶段

```javascript
// 在 startTurn 函数中，准备阶段添加妄尊检查
function startTurn(g) {
  tx(g => {
    // ... 现有准备阶段逻辑 ...
    
    // 检查是否有袁术且当前回合角色是主公
    const yuanshuSeat = findPlayerWithCap(g, 'wangzun');
    if (yuanshuSeat !== null && g.players[g.turn] && isZhu(g.players[g.turn])) {
      // 妄尊：摸一张牌
      drawN(g, yuanshuSeat, 1);
      
      // 本回合手牌上限-1
      if (!g.handLimitModifiers) g.handLimitModifiers = {};
      if (!g.handLimitModifiers[g.turn]) g.handLimitModifiers[g.turn] = 0;
      g.handLimitModifiers[g.turn]--;
      
      g.log = pushLog(g.log, `${g.players[yuanshuSeat].name} 发动【妄尊】,摸一张牌,主公本回合手牌上限-1`);
      markSkillSound(g, '妄尊');
    }
    
    return g;
  });
}

// 辅助函数：判断角色是否为主公
function isZhu(player) {
  return player && player.role === 'zhu';
}
```

### 同疾实现

**集成点**：【杀】目标选择验证函数，如 `canUseSha` 或 `validateShaTargets`

```javascript
// 在杀的目标选择验证中添加同疾检查
function canUseSha(g, sourceSeat, targetSeats, card) {
  // ... 现有的基础判断（距离、目标数量等）...
  
  // 袁术【同疾】：检查是否受到同疾效果限制
  const yuanshuSeat = findPlayerWithCap(g, 'tongji');
  if (yuanshuSeat !== null) {
    const yuanshu = g.players[yuanshuSeat];
    
    // 检查袁术是否存活
    if (yuanshu && yuanshu.alive) {
      // 检查同疾条件：手牌数 > 体力值
      const handCount = (yuanshu.hand || []).length;
      const hp = yuanshu.hp || 0;
      
      if (handCount > hp) {
        // 检查发动者是否在袁术的攻击范围内
        const source = g.players[sourceSeat];
        if (source && source.alive && sourceSeat !== yuanshuSeat) {
          const dist = distance(g, sourceSeat, yuanshuSeat);
          const attackRange = getAttackRange(source);
          
          if (dist <= attackRange) {
            // 发动者在袁术攻击范围内，检查目标选择
            // 只能选择袁术为目标，不能选择其他角色
            for (const targetSeat of targetSeats) {
              if (targetSeat !== yuanshuSeat && targetSeat !== sourceSeat) {
                return false; // 目标包含非袁术的角色，不合法
              }
            }
            
            // 如果目标列表为空，必须包含袁术
            if (targetSeats.length === 0) {
              return false; // 必须指定袁术为目标
            }
            
            // 如果目标列表只包含袁术，合法
            if (targetSeats.length === 1 && targetSeats[0] === yuanshuSeat) {
              return true;
            }
          }
        }
      }
    }
  }
  
  return true; // 其他情况下正常判断
}

// 在单目标杀的验证中也需要集成
function canTargetSha(g, sourceSeat, targetSeat, card) {
  // ... 现有判断 ...
  
  // 袁术【同疾】：特殊情况处理
  const yuanshuSeat = findPlayerWithCap(g, 'tongji');
  if (yuanshuSeat !== null) {
    const yuanshu = g.players[yuanshuSeat];
    
    if (yuanshu && yuanshu.alive) {
      const handCount = (yuanshu.hand || []).length;
      const hp = yuanshu.hp || 0;
      
      if (handCount > hp) {
        const source = g.players[sourceSeat];
        if (source && source.alive && sourceSeat !== yuanshuSeat) {
          const dist = distance(g, sourceSeat, yuanshuSeat);
          const attackRange = getAttackRange(source);
          
          if (dist <= attackRange) {
            // 只能选择袁术为目标
            if (targetSeat !== yuanshuSeat) {
              return false;
            }
          }
        }
      }
    }
  }
  
  return true;
}

// 在目标选择UI中过滤同疾效果
function getAvailableShaTargets(g, sourceSeat, card) {
  const targets = [];
  const yuanshuSeat = findPlayerWithCap(g, 'tongji');
  const source = g.players[sourceSeat];
  
  if (!source || !source.alive) return targets;
  
  const attackRange = getAttackRange(source);
  
  for (let i = 0; i < g.players.length; i++) {
    const target = g.players[i];
    if (!target || !target.alive || i === sourceSeat) continue;
    
    const dist = distance(g, sourceSeat, i);
    
    // 基础条件：在攻击范围内
    if (dist > attackRange) continue;
    
    // 袁术【同疾】：检查是否受限制
    if (yuanshuSeat !== null) {
      const yuanshu = g.players[yuanshuSeat];
      if (yuanshu && yuanshu.alive && yuanshuSeat !== sourceSeat) {
        const handCount = (yuanshu.hand || []).length;
        const hp = yuanshu.hp || 0;
        
        if (handCount > hp) {
          const distToYuanshu = distance(g, sourceSeat, yuanshuSeat);
          if (distToYuanshu <= attackRange) {
            // 发动者在袁术攻击范围内，只能选择袁术
            if (i !== yuanshuSeat) {
              continue; // 跳过非袁术的目标
            }
          }
        }
      }
    }
    
    targets.push(i);
  }
  
  return targets;
}
```

**集成到使用杀的流程中**：

```javascript
// 在 useSha 函数中集成同疾检查
function useSha(g, sourceSeat, targetSeats, card) {
  tx(g => {
    // ... 现有逻辑 ...
    
    // 同疾效果验证
    const yuanshuSeat = findPlayerWithCap(g, 'tongji');
    if (yuanshuSeat !== null) {
      const yuanshu = g.players[yuanshuSeat];
      const source = g.players[sourceSeat];
      
      if (yuanshu && yuanshu.alive && source && source.alive && sourceSeat !== yuanshuSeat) {
        const handCount = (yuanshu.hand || []).length;
        const hp = yuanshu.hp || 0;
        
        if (handCount > hp) {
          const dist = distance(g, sourceSeat, yuanshuSeat);
          const attackRange = getAttackRange(source);
          
          if (dist <= attackRange) {
            // 必须包含袁术在目标中
            const hasYuanshu = targetSeats.includes(yuanshuSeat);
            const hasOther = targetSeats.some(s => s !== yuanshuSeat && s !== sourceSeat);
            
            if (!hasYuanshu || hasOther) {
              g.log = pushLog(g.log, `${source.name} 受到【同疾】效果影响,只能对 ${yuanshu.name} 使用【杀】`);
              return g; // 拒绝使用
            }
          }
        }
      }
    }
    
    // ... 继续现有逻辑 ...
    return g;
  });
}
```

---

## 五、渲染集成（render-controls.js）

### 同疾状态显示

```javascript
// 在 renderStatus 中显示同疾状态
function renderStatus(g, me) {
  const yuanshuSeat = findPlayerWithCap(g, 'tongji');
  
  if (yuanshuSeat !== null) {
    const yuanshu = g.players[yuanshuSeat];
    if (yuanshu && yuanshu.alive) {
      const handCount = (yuanshu.hand || []).length;
      const hp = yuanshu.hp || 0;
      
      if (handCount > hp) {
        ui.innerHTML += `
          <div class="skill-status">
            <span style="color: #e74c3c;">【同疾】: ${yuanshu.name} 手牌数(${handCount}) > 体力值(${hp})，攻击范围内的角色只能对其使用【杀】</span>
          </div>
        `;
      }
    }
  }
}

// 在杀的目标选择界面中添加同疾提示
function renderControls(g, me) {
  const seat = mySeat;
  const p = g.players[seat];
  
  // 杀目标选择时检查同疾效果
  if (g.pending && g.pending.type === 'shaTargetSelect' && g.pending.sourceSeat === seat) {
    const yuanshuSeat = findPlayerWithCap(g, 'tongji');
    
    if (yuanshuSeat !== null) {
      const yuanshu = g.players[yuanshuSeat];
      if (yuanshu && yuanshu.alive && seat !== yuanshuSeat) {
        const handCount = (yuanshu.hand || []).length;
        const hp = yuanshu.hp || 0;
        
        if (handCount > hp) {
          const dist = distance(g, seat, yuanshuSeat);
          const attackRange = getAttackRange(p);
          
          if (dist <= attackRange) {
            ui.innerHTML += `
              <div class="skill-hint">
                <span style="color: #e74c3c;">（受到【同疾】效果影响，只能选择 ${yuanshu.name} 为目标）</span>
              </div>
            `;
          }
        }
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
  '妄尊': 'wangzun',
  '同疾': 'tongji',
};
```

---

## 七、边界条件处理

### 妄尊

1. **主公身份缺失**：当前项目未实装身份系统，技能暂不实现
2. **主公不存在**：若游戏中没有主公角色，技能不触发
3. **袁术死亡**：袁术死亡后，技能不再触发
4. **主公准备阶段**：需要在准备阶段的合适时机触发
5. **手牌上限修正**：修正仅在本回合生效，回合结束后重置
6. **多个主公**：正常游戏中只有一个主公，无需考虑

### 同疾

1. **手牌数 <= 体力值**：条件不满足，技能效果不生效
2. **袁术死亡**：袁术死亡后，技能效果消失
3. **发动者即袁术**：袁术自己使用杀不受同疾限制
5. **攻击范围计算**：需要考虑武器、坐骑等距离修正
6. **杀的目标数量**：同疾限制的是目标选择，无论是单目标杀还是多目标杀
7. **多个符合条件的角色**：同疾效果对每个符合条件的角色独立生效
8. **目标选择界面**：在UI中应该只显示袁术作为可选目标（若发动者在袁术攻击范围内且条件满足）
11. **手牌数变化**：手牌数或体力值变化时，效果实时更新

---

## 八、测试要点

| 测试场景 | 预期结果 |
|----------|----------|
| **同疾** |
| 同疾：袁术手牌数=5，体力=4，发动者在攻击范围内 | 只能选择袁术为杀的目标 |
| 同疾：袁术手牌数=4，体力=4 | 无限制，可以正常选择目标 |
| 同疾：袁术手牌数=3，体力=4 | 无限制，可以正常选择目标 |
| 同疾：袁术手牌数=5，体力=4，发动者不在攻击范围内 | 无限制，可以正常选择目标 |
| 同疾：袁术手牌数=5，体力=4，发动者是袁术自己 | 无限制，可以正常选择目标 |
| 同疾：袁术手牌数=5，体力=4，使用多目标杀 | 目标中必须包含袁术，不能有其他目标 |
| 同疾：袁术手牌数=5，体力=4，使用单目标杀选择非袁术角色 | 不合法，无法使用 |
| 同疾：袁术死亡后 | 同疾效果消失，无限制 |
| 同疾：袁术手牌数=5，体力=4，发动者无合法目标（只有袁术） | 只能选择袁术 |
| 同疾：袁术手牌数=5，体力=4，多个发动者在攻击范围内 | 每个发动者都只能选择袁术 |
| 同疾：使用杀时目标包含袁术和其他角色 | 若发动者在袁术攻击范围内，则不合法 |
| **妄尊** |
| 妄尊：当前无主公身份系统 | 技能不触发（暂不实现） |

---

## 九、实现优先级

1. **同疾优先**：锁定技，仅需要在杀的目标选择验证中集成，实现相对简单
2. **UI集成优先**：同疾状态显示和目标选择界面的提示
3. **边界处理优先**：手牌数和体力值的边界条件测试
4. **妄尊技能**：等待身份系统实装后再考虑实现

---

## 十、集成要点

### 与现有系统的集成

1. **目标选择系统**：
   - 修改杀的目标选择验证函数，集成同疾的过滤逻辑
   - 确保同疾效果与其他目标限制技能（如帷幕）可以正确叠加

2. **距离计算系统**：
   - 复用现有的 `distance()` 函数计算攻击范围
   - 确保考虑武器、坐骑等距离修正

3. **状态管理**：
   - 使用 `tx` 事务函数确保状态变化的原子性
   - 同疾效果在每次判断时动态计算，无需持久化状态

4. **手牌上限系统**（妄尊后续）**：
   - 需要 `handLimitModifiers` 或类似机制支持
   - 修正仅在本回合生效

### 需要修改的文件

1. **data.js**：添加袁术武将定义
2. **game.js**：
   - `normalize()`：添加同疾状态字段（可选）
   - `canUseSha()` 或类似函数：集成同疾效果验证
   - `getAvailableShaTargets()`：集成同疾目标过滤
3. **skills.js**：
   - `findPlayerWithCap()`：确保能正确找到袁术
   - `distance()`：已存在，直接使用
4. **render-controls.js**：添加同疾状态显示和目标选择提示
5. **render.js**：可能需要添加状态显示

---

## 十一、流程图

### 同疾效果流程
```
使用【杀】
    ↓
检查是否有袁术
    ↓
是：检查袁术是否存活
    ↓
是：检查手牌数 > 体力值
    ↓
是：检查使用者是否在袁术攻击范围内
    ↓
是：检查目标选择
    ↓
    ├── 目标包含非袁术的角色 → 不合法，拒绝使用
    └── 目标只包含袁术或使用者自己 → 合法，允许使用
    ↓
否：正常目标选择流程
    ↓
继续游戏
```

---

## 十二、特殊说明

### 关于妄尊的实装状态

妄尊技能需要**主公身份系统**支持，当前项目未实装身份系统，因此：
- 该技能**暂不实现**
- 在武将定义中仍保留技能描述，方便后续实装
- 设计文档中提供完整的实现思路，供身份系统实装后参考
- 后续可通过 `player.role === 'zhu'` 判断主公身份

### 关于同疾的锁定技性质

同疾是**锁定技**，这意味着：
- 无需玩家操作，自动生效
- 不能被无效（除非有特定的技能可以无效锁定技）
- 效果持续到条件不满足（手牌数 <= 体力值）或袁术死亡
- 实时检查，无需特殊标志位

### 关于攻击范围的计算

同疾效果的判定基于**攻击范围**，即：
- 基础攻击范围：角色的默认攻击范围（通常为1）
- + 武器提供的额外攻击范围
- + 技能提供的攻击范围修正
- - 其他减少攻击范围的效果

使用 `distance(g, from, to) <= getAttackRange(player)` 判断

### 关于目标选择的处理

同疾效果影响的是**目标选择**，具体表现为：
- 在目标选择界面中，只显示袁术作为可选目标（若条件满足）
- 在验证阶段，检查目标列表是否只包含袁术
- 对多目标杀，要求所有目标都必须是袁术（即只能选择袁术）

---

## 十三、修正记录

*文档状态：设计阶段*
*创建时间：2026-07-12*
*负责人：Mistral Vibe*

### 待实装项

- [x] **data.js**: 添加袁术武将定义
- [ ] **game.js**: 
  - [ ] `normalize()`: 添加状态字段（可选）
  - [ ] `canUseSha()`: 集成同疾效果验证
  - [ ] `getAvailableShaTargets()`: 集成同疾目标过滤
- [ ] **skills.js**: 
  - [ ] 确保 `findPlayerWithCap()` 可找到袁术
- [ ] **render-controls.js**: 
  - [ ] 添加同疾状态显示
  - [ ] 添加目标选择提示
- [ ] **render.js**: 添加状态显示（如需要）
- [ ] **妄尊技能**: 等待身份系统实装后实现

### 待优化项

- 音效文件：需要添加assets/audio/wangzun.mp3和assets/audio/tongji.mp3
- 性能优化：同疾效果的检查可添加缓存机制
- UI/UX：目标选择界面的过滤逻辑优化
- 兼容性：确保与现有所有技能的兼容性

---

*注：妄尊技能因依赖身份系统，当前仅做设计说明，实际实装待身份系统完成后进行。同疾技能可独立实装。*