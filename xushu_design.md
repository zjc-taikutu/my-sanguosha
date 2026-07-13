# 徐庶 武将设计文档

> **审核基准**：对照当前仓库 `data.js` / `game.js` / `skills.js` / `render.js` / `render-controls.js` 真实实现（2026-07-13）。
> 本文只写**可落地**方案，不发明项目里不存在的 API。

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `xushu` |
| **武将名称** | 徐庶 |
| **势力** | 蜀 |
| **性别** | male |
| **体力上限** | 3 |
| **技能** | 无言 / 举荐 |

---

## 二、技能说明（本项目采用的版本）

### 无言（锁定技）
**时机**：伤害结算扣血前（`dealDamage` 内）

**效果**：
1. 你使用锦囊牌对其他角色造成伤害时，防止此伤害
2. 你受到锦囊牌造成的伤害时，防止此伤害

**口径**：
- 判定“是不是锦囊伤害”：`sourceCard` 存在且 `isTrickCardName(sourceCard.name)` 为真
  - `isTrickCardName` 已在 `game.js`：`!BASIC_CARDS.includes(name) && !getEquip(name)`
  - 因此覆盖普通锦囊、延时锦囊（如闪电）、火攻等；不含基本牌/装备牌
- **连环传导同样算原牌伤害**：`propagateChainedDamage` 会带着原 `sourceCard` 再进 `dealDamage` 且 `skipChain=true`。无言**仍应防止**（不要用 `!skipChain` 排除传导）
- 防止方式：不扣血、不触发受伤后钩子、不进濒死；`return false`（表示“本次未挂起”，调用方按“伤害未造成后续”继续；与制蛮防止伤害后的返回语义一致）
- 徐庶自己用南蛮/万箭：每个目标结算伤害时 `sourceSeat` 是徐庶、`sourceCard` 是该锦囊 → **每个目标的伤害都被防止**（不是“只防自己”）

### 举荐
**时机**：结束阶段（本项目里等价于 `endTurn()` 即将 `finishTurn` 前，与曹仁【据守】同一挂点）

**效果**：
1. 你可以弃置一张**非基本牌**（锦囊或装备，手牌）
2. 令一名其他存活角色选择一项：
   - 摸两张牌
   - 回复 1 点体力（已满血则无实际回复，但可选）
   - 复原武将牌（`faceup=true` 且 `chained=false`）

**口径**：
- 非基本牌：`!BASIC_CARDS.includes(card.name)`  
  **不要**写成 `isTrickCardName`——那会漏掉装备牌
- 限一次：挂在**玩家字段** `p.jujianUsed`（布尔），`startTurn` 重置；**不要**用全局 `g.jujianUsed`，也**不要**发明 `p.marks.*`（项目主流是顶层玩家字段，如 `fenxunUsed`）
- 弃牌时机：选完目标后再弃，避免“选牌后取消丢牌”
- 效果选择权限：仅 `targetSeat === mySeat` 的被举荐者可点

---

## 三、数据定义（data.js）

```javascript
xushu: {
  id: 'xushu',
  name: '徐庶',
  gender: 'male',
  maxHp: 3,
  skill: '无言/举荐',
  desc: '无言:锁定技,你使用锦囊牌造成伤害时防止之;你受到锦囊牌伤害时防止之。举荐:结束阶段,你可以弃置一张非基本牌,令一名其他角色选择:摸两张牌/回复1点体力/复原武将牌。',
  caps: { wuyan: true, jujian: true }
}
```

无言锁定技只靠 `caps`，不需要 `hooks`。

---

## 四、关键 API 约束（写代码时必须遵守）

| 项目现状 | 错误写法 | 正确写法 |
|----------|----------|----------|
| `markSkillSound(g, skillName)` 只收**中文技能名** | `markSkillSound(g, seat, 'wuyan')` | `markSkillSound(g, '无言')` |
| 音效表是 `render.js` 的 `SKILL_PINYIN` | 新建 `SKILL_SOUNDS` | `SKILL_PINYIN['无言']='wuyan'` 等 |
| `ensureDeck(g)` 无第二参数 | `ensureDeck(g, 2)` | `ensureDeck(g); drawN(g, seat, 2)` |
| 无 `recoverHp` | `recoverHp(g, seat, 1)` | `p.hp = Math.min(p.maxHp, p.hp+1)`（可先判断 `p.hp < p.maxHp`） |
| 翻面字段是 `p.faceup`（`false`=背面） | `flipped` / 只改 `turnedOver` | 复原：`p.faceup = true` |
| 连环字段是 `p.chained` | 忽略连环 | 复原同时 `p.chained = false` |
| 无 `disabledSlots` | 清理废除栏 | **不要写** |
| 无 `p.marks` 体系 | `p.marks.jujian_used` | `p.jujianUsed` |
| `endTurn` 入口 `phase==='discard'` | 假设稳定 `phase==='end'` 再挂技能 | 仿据守：在 `endTurn` 里设 `phase='jujianPickCard'` 后 `return g` |
| `dealDamage` 返回值 | `return false` 当“阻止并中断一切” | `true`=挂起（濒死/询问）；`false`=本次未挂起（含“伤害被防止后正常返回”） |

---

## 五、无言实现（game.js · dealDamage）

插入位置：函数开头、`maybeStartZhengyi` / `maybeStartTianxiang` / 扣血 **之前**。

```javascript
// 徐庶【无言】：锦囊伤害防止（锁定技）
// sourceCard 走 isTrickCardName；连环传导仍带原 sourceCard，同样防止
if (amount > 0 && sourceCard && isTrickCardName(sourceCard.name)) {
  const src = (typeof sourceSeat === 'number') ? g.players[sourceSeat] : null;
  const tgt = g.players[seat];
  // 1) 徐庶使用锦囊造成伤害
  if (src && src.alive && generalHasCap(src, 'wuyan')) {
    g.log = pushLog(g.log, src.name + ' 发动【无言】,防止其锦囊造成的伤害');
    markSkillSound(g, '无言');
    return false;
  }
  // 2) 徐庶受到锦囊伤害
  if (tgt && tgt.alive && generalHasCap(tgt, 'wuyan')) {
    g.log = pushLog(g.log, tgt.name + ' 发动【无言】,防止锦囊伤害');
    markSkillSound(g, '无言');
    return false;
  }
}
```

**不要**写 `if (... && !skipChain)`。

---

## 六、举荐实现

### 6.1 状态字段

`normalize`：
```javascript
g.players.forEach(p => {
  if (!p) return;
  if (typeof p.jujianUsed !== 'boolean') p.jujianUsed = false;
});
// pending 防御
if (g.pending && (g.pending.type === 'jujianPickCard' ||
                  g.pending.type === 'jujianPickTarget' ||
                  g.pending.type === 'jujianChooseEffect')) {
  const d = g.pending;
  const srcOk = Number.isInteger(d.sourceSeat) && g.players[d.sourceSeat] && g.players[d.sourceSeat].alive;
  if (!srcOk) {
    g.pending = null;
    // 无法可靠恢复结束阶段流程时，交给 finishTurn 更安全的做法：
    // 若 phase 仍是 jujian*，直接 finishTurn(g, g.turn) 可能重复切回合——
    // 推荐：仅清空 pending，并把 phase 设回 'discard'，由当前回合玩家再次点结束；
    // 或在 pending 里始终带 endingSeat，失败时 finishTurn(g, endingSeat)。
    if (String(g.phase || '').startsWith('jujian')) g.phase = 'discard';
  }
}
```

`startTurn` 重置（仅当前回合座位）：
```javascript
if (p) p.jujianUsed = false;
```

### 6.2 挂点：endTurn（与据守并列）

```javascript
// 在 endTurn 里，据守检查之前或之后均可，但必须在 finishTurn 之前
if (generalHasCap(me, 'jujian') && me.alive && !me.jujianUsed) {
  const hasNonBasic = (me.hand || []).some(c => c && !BASIC_CARDS.includes(c.name));
  const hasOther = g.players.some((p, i) => i !== mySeat && p && p.alive);
  if (hasNonBasic && hasOther) {
    g.pending = { type: 'jujianPickCard', sourceSeat: mySeat, endingSeat: mySeat };
    g.phase = 'jujianPickCard';
    g.log = pushLog(g.log, me.name + ' 是否发动【举荐】…');
    return g;
  }
}
// 其后才是据守 / finishTurn
```

> 说明：不要单独发明稳定 `phase==='end'`。本项目结束阶段技能都是 `discard` 收尾路径上的挂起。

### 6.3 响应函数（skills.js）

```javascript
function isNonBasicCard(card) {
  return !!(card && card.name && !BASIC_CARDS.includes(card.name));
}

// 选弃置牌（暂不弃）
function respondJujianPickCard(cardIdx) {
  tx(g => {
    if (g.phase !== 'jujianPickCard' || !g.pending || g.pending.type !== 'jujianPickCard') return g;
    if (g.pending.sourceSeat !== mySeat) return g;
    const me = g.players[mySeat];
    const card = me.hand[cardIdx];
    if (!isNonBasicCard(card)) return g;
    const candidates = [];
    for (let i = 0; i < g.players.length; i++) {
      if (i !== mySeat && g.players[i] && g.players[i].alive) candidates.push(i);
    }
    if (!candidates.length) return g;
    g.pending = {
      type: 'jujianPickTarget',
      sourceSeat: mySeat,
      endingSeat: g.pending.endingSeat,
      cardIdx,
      cardId: card.id,
      candidates
    };
    g.phase = 'jujianPickTarget';
    return g;
  });
}

// 选目标 → 真正弃牌 → 交给对方选效果
function respondJujianPickTarget(targetSeat) {
  tx(g => {
    if (g.phase !== 'jujianPickTarget' || !g.pending || g.pending.type !== 'jujianPickTarget') return g;
    if (g.pending.sourceSeat !== mySeat) return g;
    if (!(g.pending.candidates || []).includes(targetSeat)) return g;
    const me = g.players[mySeat];
    let idx = g.pending.cardIdx;
    let card = me.hand[idx];
    if (!card || card.id !== g.pending.cardId) {
      idx = (me.hand || []).findIndex(c => c && c.id === g.pending.cardId);
      if (idx < 0) {
        g.pending = null;
        finishTurn(g, g.pending ? g.pending.endingSeat : mySeat); // 注意：先取 endingSeat 再清空
        return g;
      }
      card = me.hand[idx];
    }
    if (!isNonBasicCard(card)) return g;
    me.hand.splice(idx, 1);
    g.discard.push(card);
    g.pending = {
      type: 'jujianChooseEffect',
      sourceSeat: mySeat,
      endingSeat: g.pending.endingSeat,
      targetSeat,
      discardCard: card
    };
    g.phase = 'jujianChooseEffect';
    g.log = pushLog(g.log, me.name + ' 发动【举荐】,弃置【' + card.name + '】,令 ' + g.players[targetSeat].name + ' 选择一项');
    markSkillSound(g, '举荐');
    return g;
  });
}

// 仅被举荐者选择
function respondJujianEffect(opt) {
  tx(g => {
    if (g.phase !== 'jujianChooseEffect' || !g.pending || g.pending.type !== 'jujianChooseEffect') return g;
    if (g.pending.targetSeat !== mySeat) return g; // 越权拒绝
    const src = g.players[g.pending.sourceSeat];
    const tgt = g.players[g.pending.targetSeat];
    const endingSeat = g.pending.endingSeat;
    if (!tgt || !tgt.alive) {
      if (src) src.jujianUsed = true;
      g.pending = null;
      finishTurn(g, endingSeat);
      return g;
    }
    if (opt === 'draw') {
      drawN(g, g.pending.targetSeat, 2);
      g.log = pushLog(g.log, tgt.name + ' 因【举荐】摸2张牌');
    } else if (opt === 'recover') {
      if (tgt.hp < tgt.maxHp) {
        tgt.hp++;
        g.log = pushLog(g.log, tgt.name + ' 因【举荐】回复1点体力');
      } else {
        g.log = pushLog(g.log, tgt.name + ' 体力已满,【举荐】回复无效果');
      }
    } else if (opt === 'reset') {
      const beforeFace = tgt.faceup !== false;
      const beforeChain = !!tgt.chained;
      tgt.faceup = true;
      tgt.chained = false;
      g.log = pushLog(g.log, (!beforeFace || beforeChain)
        ? (tgt.name + ' 因【举荐】复原武将牌')
        : (tgt.name + ' 无需复原'));
    } else {
      return g;
    }
    if (src) src.jujianUsed = true;
    g.pending = null;
    finishTurn(g, endingSeat);
    return g;
  });
}

// 取消：仅允许在尚未弃牌的阶段
function cancelJujian() {
  tx(g => {
    if (!g.pending) return g;
    if (g.pending.type === 'jujianChooseEffect') return g; // 已弃牌不可取消
    if (g.pending.sourceSeat !== mySeat) return g;
    if (g.pending.type !== 'jujianPickCard' && g.pending.type !== 'jujianPickTarget') return g;
    const endingSeat = g.pending.endingSeat;
    g.pending = null;
    g.log = pushLog(g.log, g.players[mySeat].name + ' 取消【举荐】');
    finishTurn(g, endingSeat);
    return g;
  });
}
```

> `respondJujianPickTarget` 里“找不到牌”分支的 `finishTurn` 写法示例中注意：**先保存 `endingSeat` 再 `g.pending=null`**。

---

## 七、UI（render-controls.js）

- 阶段：`jujianPickCard` / `jujianPickTarget` / `jujianChooseEffect`
- 旁观者：`setBanner` / `waitAskBanner` 风格，不剧透手牌
- 选牌：只高亮 `!BASIC_CARDS.includes(name)` 的手牌
- 选目标：其他存活座位
- 选效果：仅 `pending.targetSeat===mySeat` 显示三按钮
- 用 DOM API 或现有 `confirmAndPlay` 风格，避免把未转义玩家名塞进 `innerHTML` 拼接

---

## 八、音效

`render.js`：
```javascript
// SKILL_PINYIN 增补
'无言': 'wuyan',
'举荐': 'jujian',
```
素材：`assets/audio/wuyan.mp3`、`assets/audio/jujian.mp3`（用户自备）。

---

## 九、边界与测试

| 场景 | 预期 |
|------|------|
| 徐庶用火攻造成伤害 | 伤害被防止，目标不掉血 |
| 徐庶被南蛮结算伤害 | 该次伤害被防止 |
| 徐庶用南蛮 | **所有目标**对该南蛮的伤害均被防止 |
| 连环传导的锦囊属性伤害打到徐庶 | **仍防止** |
| 杀/决斗伤害 | 不触发无言 |
| 结束阶段无非基本牌 | 不出现举荐入口 |
| 选牌后取消 | 牌仍在手，正常 `finishTurn` |
| 已弃牌后 | 不可取消；由目标选效果 |
| 复原 | `faceup=true` 且 `chained=false` |
| 满血选回复 | 不涨超上限 |
| 两名徐庶 | 各自 `jujianUsed` 独立 |

---

## 十、文件改动清单

1. `data.js`：注册 `GENERALS.xushu`
2. `game.js`：`dealDamage` 无言；`normalize`/`startTurn` 举荐字段；`endTurn` 挂起
3. `skills.js`：举荐响应函数
4. `render-controls.js`：三阶段 UI
5. `render.js`：`SKILL_PINYIN`
6. 回归测试：`test_xushu.js`（无言防止/传导/南蛮；举荐弃牌时机与权限）

---

## 十一、修正记录（相对旧稿）

1. 删除不存在的 `beforeDamage` / `p.marks` / `recoverHp` / `disabledSlots` / `SKILL_SOUNDS` / `ensureDeck(g,n)`
2. `markSkillSound` 改为中文单参数
3. 非基本牌定义改为 `!BASIC_CARDS.includes`（含装备）
4. 无言**不再**用 `!skipChain` 放行传导
5. 徐庶用群体锦囊：防止对**所有目标**的锦囊伤害（旧测试表写反）
6. 举荐挂点对齐据守：`endTurn` → pending → `finishTurn`
7. 复原武将牌对齐 `faceup` + `chained`
8. 限次标志改为 `p.jujianUsed`

*文档状态：已按当前代码审核修正，待实装*  
*审核时间：2026-07-13*
