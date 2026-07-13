# 曹植 武将设计文档

> **审核基准**：对照当前仓库 `data.js` / `game.js` / `skills.js` / `render.js` / `render-controls.js` 真实实现（2026-07-13）。
> 本文只写**可落地**方案，不发明项目里不存在的 API。

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `caozhi` |
| **武将名称** | 曹植 |
| **势力** | 魏 |
| **性别** | male |
| **体力上限** | 3 |
| **技能** | 落英 / 酒诗 |

---

## 二、技能说明（对齐本项目能力边界）

### 落英
**时机**：其他角色的梅花牌因**判定**或**弃置**进入弃牌堆时  

**效果**：你可以获得这些梅花牌。

**本项目可接入的真实入口（必须写清，避免“监听弃牌堆事件”空话）**：

| 入口 | 是否算“判定/弃置” | 是否接入落英 |
|------|-------------------|--------------|
| `judge()` / 延时锦囊 `finishDelayCard` 消费判定牌 | 判定 | **是**（来源座位=判定所属角色） |
| `discardCard` / `discardCards` | 弃置 | **是** |
| 装备替换 `equipCard` 旧装备进弃牌堆 | 更接近“被替换置入” | **默认否**（除非产品明确要求） |
| 顺手/拆桥拆掉的牌、技能弃牌代价 | 部分是弃置 | **建议第一版只做弃牌阶段 + 判定**，其它弃置点第二版再扫 |
| 阵亡弃牌 | 死亡结算 | **否** |

**花色**：项目用 `card.suit === '♣'`（不是 `'club'`）。

### 酒诗
官方两段：
1. 当你需要使用【酒】时，若武将牌正面向上，可将武将牌翻面，视为使用【酒】  
2. 当你受到伤害后，若武将牌背面向上，且**受到此伤害时**也背面向上，可将武将牌翻回正面  

**本项目硬限制：当前没有【酒】牌与“酒状态”系统**（`BASIC_CARDS` 仅杀/火杀/雷杀/闪/桃；`CARD_PLAYS` 无酒）。

**落地策略（二选一，实现前必须定案）**：

#### 方案 A（推荐，最小可玩）——只做酒诗② + 翻面基础设施
- 完整实现酒诗②（受伤后可选翻回正面）
- 酒诗①标注为 **依赖【酒】系统，暂缓**
- 翻面继续用现有 `p.faceup`（`false`=背面；`startTurn` 已对背面角色“跳过回合并翻回正面”——见下）

#### 方案 B——同时引入简化【酒】
- 牌堆加【酒】、`BASIC_CARDS` 加 `'酒'`、出杀伤害前检查“酒标记”等  
- **工作量远大于一个武将**，不应塞进曹植单卡设计“顺手做完”

**本文默认采用方案 A**；酒诗①仅保留接口草图。

---

## 三、翻面状态：项目真实语义（旧稿多处写错）

| 字段 | 真实含义 | 用途 |
|------|----------|------|
| `p.faceup` | `true` 正面；`false` 背面 | 据守翻面、悲歌翻面、`startTurn` 跳回合 |
| `p.turnedOver` | normalize 有默认 `false` | **当前技能逻辑几乎不用**；涅槃等清它，**新技能应统一用 faceup** |

`startTurn` 现有逻辑（必须遵守，不要再写“回合结束全体 faceup=true”这种与代码相反的规则）：

```text
若 p.faceup === false：
  记日志“处于翻面状态，跳过回合并翻回正面”
  p.faceup = true
  跳过本回合（切下家）
```

因此：
- 酒诗①若将来翻到背面：曹植会在**自己下一回合开始时被跳过并翻回正面**（与据守一致）
- **不要**在 `endTurn` 再写“全体翻回正面”——会与现有 skip-turn 语义冲突
- 酒诗②的价值：在背面时受伤，可**立即**翻回正面，避免下一回合被跳过

---

## 四、数据定义（data.js）

```javascript
caozhi: {
  id: 'caozhi',
  name: '曹植',
  gender: 'male',
  maxHp: 3,
  skill: '落英/酒诗',
  desc: '落英:当其他角色的梅花牌因判定或弃置进入弃牌堆时,你可以获得之。酒诗:当你受到伤害后,若你的武将牌背面朝上且受伤时也背面朝上,你可以翻回正面。(酒诗“视为使用酒”待酒系统)',
  caps: { luoying: true, jiushi: true }
}
```

`hooks` 可空；酒诗②建议直接在 `dealDamage` 受伤后挂起，与称象/悲歌同类，不一定非要 `hooks.onDamaged`。

---

## 五、关键 API 约束

| 项目现状 | 错误写法 | 正确写法 |
|----------|----------|----------|
| 梅花 | `card.suit === 'club'` | `card.suit === '♣'` |
| `markSkillSound(g, '落英')` | `markSkillSound(g, seat, 'luoying')` 或 `markSkillSound(g, '落英')` 在“仅询问”时调用 | **仅在真正发动时**播；询问阶段只 pushLog |
| 音效表 | `SKILL_SOUNDS` | `SKILL_PINYIN` |
| `dealDamage` 签名 | 自造 `(g,target,amount,source,reason,skill)` | `(g, seat, amount, sourceSeat, reason, srcType, sourceCard, skipTianxiang, skipZhengyi, skipChain)` |
| 挂起返回值 | 随意 | 开 pending 后 `return true`，让调用方停尾巴 |
| 弃牌堆取回 | 假设对象引用仍 `indexOf` 必中 | 优先 `card.id` 匹配，引用匹配兜底（Firebase 读回引用会变） |
| 无统一 `addToDiscard` | 假设已有事件总线 | 在具体入口调 `maybeStartLuoying` |
| 酒 | 假设全项目有酒 | 方案 A 不做酒诗① |

---

## 六、落英实现

### 6.1 统一入口

```javascript
// skills.js
function isClubCard(card) {
  return !!(card && card.suit === '♣');
}

// fromSeat: 牌的所属/弃置者/判定所属角色
// cards: 本次进入弃牌堆的牌数组（已 push 进 g.discard 之后调用）
// reason: 'judge' | 'discard'
// resume: 可选，落英结束后如何接回（默认 null → phase 回 play 或由调用方处理）
function maybeStartLuoying(g, fromSeat, cards, reason, resume) {
  if (reason !== 'judge' && reason !== 'discard') return false;
  if (!Array.isArray(cards) || !cards.length) return false;
  const clubCards = cards.filter(isClubCard);
  if (!clubCards.length) return false;

  // 找一名有落英的其他存活角色（多人同时：第一版只问座位序最小/从 fromSeat 起 next 的第一个；或排队）
  for (let k = 0; k < g.players.length; k++) {
    const i = (fromSeat + 1 + k) % g.players.length;
    if (i === fromSeat) continue;
    const p = g.players[i];
    if (!p || !p.alive || !generalHasCap(p, 'luoying')) continue;

    // 注意：若已有更高优先级 pending（濒死等），不要覆盖——调用方应在安全点调用
    g.pending = {
      type: 'luoyingAsk',
      seat: i,
      fromSeat,
      reason,
      // 存 id 列表，结算时从 discard 按 id 取回
      cardIds: clubCards.map(c => c.id).filter(id => id != null),
      // 可选缓存展示用浅拷贝字段
      cardsPreview: clubCards.map(c => ({ id: c.id, name: c.name, suit: c.suit, rank: c.rank })),
      resume: resume || null
    };
    g.phase = 'luoyingAsk';
    g.log = pushLog(g.log, p.name + ' 是否发动【落英】获得 ' + clubCards.length + '张梅花牌…');
    return true;
  }
  return false;
}

function respondLuoying(activate) {
  tx(g => {
    if (g.phase !== 'luoyingAsk' || !g.pending || g.pending.type !== 'luoyingAsk') return g;
    if (g.pending.seat !== mySeat) return g;
    const me = g.players[mySeat];
    const resume = g.pending.resume;
    if (!me || !me.alive) {
      g.pending = null;
      // resume 处理略
      return g;
    }
    if (activate) {
      const got = [];
      (g.pending.cardIds || []).forEach(id => {
        const idx = (g.discard || []).findIndex(c => c && c.id === id);
        if (idx >= 0) {
          const [card] = g.discard.splice(idx, 1);
          got.push(card);
        }
      });
      if (got.length) {
        me.hand.push(...got);
        g.log = pushLog(g.log, me.name + ' 发动【落英】,获得' + got.length + '张牌');
        markSkillSound(g, '落英');
      } else {
        g.log = pushLog(g.log, me.name + ' 发动【落英】,但牌已不在弃牌堆');
      }
    } else {
      g.log = pushLog(g.log, me.name + '：不发动【落英】');
    }
    g.pending = null;
    // 第一版：若无 resume，phase 设回 play（弃牌阶段触发时可能应回 discard——见下）
    if (resume && resume.phase) g.phase = resume.phase;
    else g.phase = 'play';
    return g;
  });
}
```

### 6.2 接入点示例

**弃牌阶段**（`discardCards` 末尾，牌已进 discard）：

```javascript
// discarded 已 push
if (maybeStartLuoying(g, mySeat, discarded, 'discard', { phase: 'discard' })) {
  return g; // 挂起，玩家稍后再继续弃/结束回合
}
```

**判定**（`finishDelayCard` 在判定牌进弃牌堆且天妒等处理完后）：

```javascript
// finalCard 已在 discard
if (maybeStartLuoying(g, seat, [finalCard], 'judge', { kind: 'delayJudgeContinue', seat })) {
  return 'pending'; // 需与 continueDelayResolution 的 pending 语义对齐
}
```

> 延时锦囊链路对 `'pending'` 很敏感；实现时必须接 `resumeAfterInterrupt` / `continueDelayResolution` 同类模式，**禁止**简单 `phase='play'` 打断判定链。

### 6.3 多曹植

第一版：只询问环形顺序上的第一个落英角色；其选择结束后**不再**问第二个（简化）。  
若要全员可获：用队列 `g.luoyingQueue`，与无懈/骁果同款推进。

---

## 七、酒诗实现

### 7.1 酒诗②（可做）

在 `dealDamage`：**扣血之后、非濒死（或濒死救回后？）**  

官方是“受到伤害后”。本项目同类技能（称象）在 `amount>0` 且仍存活时挂起。建议：

```javascript
// 扣血后、if(p.hp<=0) 濒死分支之前或之后？
// 若掉到 0 进濒死，酒诗②通常仍算“受到伤害后”，但 pending 会被濒死占用。
// 推荐：仅当 p.hp>0 时在 dealDamage 内直接挂起；
// 若进入濒死，把 facedownAtDamage 写入 dying resume，finishDying(false) 后再问酒诗。

const facedownAtDamage = (p.faceup === false);
// ... 扣血 ...
if (p.hp > 0 && amount > 0 && generalHasCap(p, 'jiushi') && p.faceup === false && facedownAtDamage) {
  const pendingBefore = g.pending;
  g.pending = {
    type: 'jiushiFlipAsk',
    seat,
    wasFacedown: true, // 受伤时背面
    resume: { type: srcType } // 供 resumeAfterInterrupt
  };
  g.phase = 'jiushiFlipAsk';
  g.log = pushLog(g.log, p.name + ' 是否发动【酒诗】翻回正面…');
  return true;
}
```

```javascript
function respondJiushiFlip(activate) {
  tx(g => {
    if (g.phase !== 'jiushiFlipAsk' || !g.pending || g.pending.type !== 'jiushiFlipAsk') return g;
    if (g.pending.seat !== mySeat) return g;
    const me = g.players[mySeat];
    const resume = g.pending.resume;
    if (activate && me && me.alive && g.pending.wasFacedown) {
      me.faceup = true;
      g.log = pushLog(g.log, me.name + ' 发动【酒诗】,翻回正面');
      markSkillSound(g, '酒诗');
    } else {
      g.log = pushLog(g.log, me.name + '：不发动【酒诗】');
    }
    g.pending = null;
    resumeAfterInterrupt(g, resume || { type: 'sha' }, mySeat);
    return g;
  });
}
```

**wasFacedown 语义**：旧稿把 `wasFacedown === false` 当“背面”自相矛盾。  
统一：`wasFacedown === true` 表示受伤时背面朝上。

### 7.2 酒诗①（暂缓）

待【酒】系统存在后：

- 在“需要使用酒”的唯一入口询问
- 条件：`faceup !== false`
- 发动：`faceup=false`，再走酒效果
- **禁止**假设 `needUseWine` 全局回调已存在

---

## 八、normalize 防御

```javascript
if (g.pending && g.pending.type === 'luoyingAsk') {
  const d = g.pending;
  if (!Number.isInteger(d.seat) || !g.players[d.seat] || !g.players[d.seat].alive ||
      !Array.isArray(d.cardIds)) {
    g.pending = null;
    if (g.phase === 'luoyingAsk') g.phase = 'play';
  }
}
if (g.pending && g.pending.type === 'jiushiFlipAsk') {
  const d = g.pending;
  if (!Number.isInteger(d.seat) || !g.players[d.seat] || !g.players[d.seat].alive ||
      typeof d.wasFacedown !== 'boolean') {
    g.pending = null;
    if (g.phase === 'jiushiFlipAsk') g.phase = 'play';
  }
}
// faceup 已有 normalize，无需重复造 g.playerFacedown
```

---

## 九、UI

### 落英
- `phase==='luoyingAsk' && pending.seat===mySeat`：展示 `cardsPreview`，按钮获得/不获得  
- 旁观：不剧透完整牌面以外的信息（梅花张数可显示）

### 酒诗②
- `jiushiFlipAsk`：翻回正面 / 不发动

### 朝向显示
项目已有：
- `render.js` 座位 `p.faceup===false ? ' flipped'`
- `render-controls.js` `renderFaceupStatus`

**不要**再发明 `player-${seat}` DOM id 旋转方案，除非确认 HTML 结构真有这些 id。

---

## 十、音效

```javascript
// SKILL_PINYIN
'落英': 'luoying',
'酒诗': 'jiushi',
```

---

## 十一、边界与测试

| 场景 | 预期 |
|------|------|
| 他人弃牌阶段弃 2 张♣ | 曹植可一次获得 2 张 |
| 他人判定♣ | 可获得（判定牌） |
| 自己弃♣ | 不触发 |
| 他人弃♥ | 不触发 |
| 获得时牌已被洗回牌堆 | 获得 0 张，不崩 |
| 据守翻面后受伤（仍背面） | 可酒诗②翻回正面 |
| 正面受伤 | 不触发酒诗② |
| 掉到 0 血 | 优先濒死；酒诗②延后或本版简化为仅 hp>0 |
| startTurn 背面 | 跳过回合并翻回正面（既有） |

---

## 十二、文件改动清单

1. `data.js`：注册曹植  
2. `game.js`：`discardCards`/`discardCard`/`finishDelayCard` 落英；`dealDamage` 酒诗②；normalize  
3. `skills.js`：`maybeStartLuoying` / `respondLuoying` / `respondJiushiFlip`  
4. `render-controls.js`：两套询问 UI  
5. `render.js`：`SKILL_PINYIN`  
6. `test_caozhi.js`  
7. **不做**：酒系统、酒诗①（除非单独立项）

---

## 十三、修正记录（相对旧稿）

1. `'club'` → `'♣'`  
2. 删除“回合结束全体 faceup=true”；对齐 `startTurn` 跳回合语义  
3. 删除虚构 `g.playerFacedown`、错误 `dealDamage` 签名、询问阶段乱播 `markSkillSound`  
4. 明确**无酒则不做酒诗①**  
5. 落英必须按 id 从弃牌堆取回；写清真实接入点  
6. `wasFacedown` 语义修正  
7. 延时判定链 resume 警告  
8. UI 对齐现有 flipped class，不造不存在的 DOM  

*文档状态：已按当前代码审核修正，待实装（酒诗①暂缓）*  
*审核时间：2026-07-13*
