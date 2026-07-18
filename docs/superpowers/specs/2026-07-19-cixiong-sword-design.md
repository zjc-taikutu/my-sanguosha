# 雌雄双股剑 设计规格

> 日期：2026-07-19  
> 状态：待用户审阅  
> 范围：标准版武器【雌雄双股剑】完整特效 + 入牌堆  

---

## 1. 目标与非目标

### 1.1 目标

实现标准版武器 **雌雄双股剑**：

- 装备可打出、射程 2
- 使用【杀】指定异性目标后可选发动
- 目标二选一：弃 1 张手牌 / 令你摸 1 张
- 无手牌时强制令你摸 1
- 入 `buildDeck`（♠2，1 张）
- 性别走既有 `generalGender` / `isMale`（含左慈化身跟随）

### 1.2 非目标

- 不改性别数据模型（已有 `gender` + `generalGender`）
- 不做国战/OL 异版规则
- 不主动卸载装备
- 不改其它武器结算顺序（仅在既有杀链上插入挂点）

---

## 2. 官方规则（已交叉确认）

| 项 | 内容 |
|---|---|
| 类型 | 武器 |
| 射程 | 2 |
| 牌面 | 标准版 ♠2，1 张 |
| 时机 | 你使用【杀】**指定**一名与你**性别不同**的角色为**目标后** |
| 可选 | 攻击者可选不发动 |
| 效果 | 令该目标选择：①弃置一张**手牌**；②令你摸一张牌 |
| 无手牌 | 目标无法选① → 结算为你摸一张 |
| 性别 | 看**武将**性别，不是真人玩家 |
| 弃牌范围 | 仅手牌，不可弃装备/判定区 |
| 谁选弃/摸 | **目标**选，不是攻击者 |

### 2.1 FAQ 关键点

1. **流离之后**：大乔流离后，对新目标再判定是否异性、是否发动。
2. **武将技先于武器**：铁骑/烈弓等先问完，再问雌雄。
3. **仁王盾/毅重**：黑杀可先发动雌雄，再因盾/毅重无效（杀无效但特效已可发动）。
4. **空城**：目标弃最后一张手牌后进入空城，本张杀仍正常结算（若未因其它原因无效）。

---

## 3. 与现有代码的衔接

### 3.1 已有能力

- `GENERALS[*].gender` + `generalGender(player)` / `isMale(player)`（离间、化身已用）
- `EQUIPS` + `equipPlay` 自动挂 `CARD_PLAYS`
- 杀链：`resolveShaUse` → 流离 → `resolveShaUseNoLiuli` → 毅重/仁王 → 铁骑/烈弓 → `continueShaAfterTieqi` → 八卦/闪
- 武器挂起模式：麒麟/寒冰/青龙等 `maybeStart*` + `respond*`（`weapons.js`）

### 3.2 挂点顺序（必须）

```
resolveShaUse
  → maybeStartLiuli（若挂起则 return）
  → resolveShaUseNoLiuli
       → [距离等]
       → 铁骑 / 烈弓（若挂起则 return，结束后回到 continue 路径）
       → ★ maybeStartCixiong（新）
            异性且 hasCap(from,'cixiong') 时：
              - 攻击者可选发动
              - 目标二选一或无手牌直接摸
              - 结束后再 continue
       → 毅重 / 仁王盾 无效短路
       → continueShaAfterTieqi（八卦 / 出闪 …）
```

**说明：**

- 铁骑/烈弓结束后必须仍有机会触发雌雄 → 在 `continueShaAfterTieqi` **入口**或铁骑/烈弓收尾里统一走 `maybeStartCixiong` 再进原尾巴，避免只插在 `resolveShaUseNoLiuli` 前半导致铁骑后漏触发。
- **推荐结构**：抽出 `afterShaTargetConfirmed(g, from, to, …)` 或在所有进入「目标已确定、尚未无效/出闪」的路径上调用：

```
function proceedAfterShaSkills(g, from, to, noShan, sourceCard, shaColor, shaInfo){
  if(maybeStartCixiong(g, from, to, noShan, sourceCard, shaColor, shaInfo)) return;
  // 原 continueShaAfterTieqi 里毅重已在 NoLiuli 做过；
  // 若毅重在 NoLiuli，则此处只负责雌雄后再进 continueShaAfterTieqi 的后半
  continueShaAfterTieqi(...);
}
```

实现时以「铁骑/烈弓结束后仍触发雌雄，且在仁王无效之前」为准，允许小幅调整函数边界，但不改变其它武器语义。

**更简且稳妥的落点（实现首选）：**

1. `resolveShaUseNoLiuli` 里：毅重/仁王判断**之前**不插雌雄（否则与「铁骑先」冲突）。
2. 铁骑/烈弓若触发，在其 `respond*` 收尾改为：先 `maybeStartCixiong`，否则 `continueShaAfterTieqi`。
3. 无铁骑/烈弓时：在进入 `continueShaAfterTieqi` **之前** `maybeStartCixiong`。
4. `continueShaAfterTieqi` 开头：若 pending 已是雌雄相关则不再重入。

仁王/毅重保持在 `resolveShaUseNoLiuli` 前段 → 与 FAQ「可先发动再无效」冲突。

**修正后的最终顺序（与 FAQ 对齐）：**

```
流离完成
→ 铁骑/烈弓（可选）
→ 雌雄（可选）          ← 此时杀尚未因仁王无效
→ 仁王/毅重无效？
→ 八卦/出闪/伤害
```

因此 **仁王/毅重判断必须移到雌雄之后**，或雌雄插在当前仁王判断之前且铁骑之后。

当前代码仁王在铁骑之前。实现时需：

1. 将「毅重/仁王无效」从 `resolveShaUseNoLiuli` 前段挪到 `continueShaAfterTieqi` 开头（或雌雄结束之后），**或**
2. 保持仁王位置，接受「仁王无效后不再雌雄」——**不采用**（违反 FAQ）。

**采用 1**：仁王/毅重短路挪到雌雄结算完成之后、八卦之前。这是对 `resolveShaUseNoLiuli` / `continueShaAfterTieqi` 的必要顺序调整，需回归测试仁王/毅重/铁骑/烈弓组合。

---

## 4. 数据

### 4.1 EQUIPS

```js
'雌雄双股剑': {
  slot: 'weapon',
  range: 2,
  cap: 'cixiong',
  desc: '武器,射程2。当你使用【杀】指定与你性别不同的角色为目标后，你可以令其选择一项：1.弃置一张手牌；2.令你摸一张牌。'
}
```

### 4.2 buildDeck

在标准版装备段加入：

```js
['雌雄双股剑', S, 2],
```

注释改为已实现；总数 +1。

### 4.3 CARD_PINYIN

```js
'雌雄双股剑': 'cixiongshuanggujian',
```

（若有卡图则 `assets/cards/cixiongshuanggujian.jpg`，无图走 no-art。）

### 4.4 性别 helper（可选增强）

```js
function isOppositeGender(a, b){
  return generalGender(a) !== generalGender(b);
}
```

业务用 `isOppositeGender(attacker, target)`，不硬编码男女。

---

## 5. 状态机

### 5.1 阶段 A：攻击者是否发动

```
g.phase = 'cixiongAsk'
g.pending = {
  type: 'cixiongAsk',
  from, to,
  noShan, shaColor, sourceCard,  // 透传给后续杀结算
  shaInfo 相关字段按现有铁骑 pending 惯例
}
```

- 仅 `from === mySeat` 可操作
- `respondCixiongAsk(true)` → 进入阶段 B 或无手牌直接摸并 continue
- `respondCixiongAsk(false)` → 不发动，continue 杀结算

### 5.2 阶段 B：目标选择

```
g.phase = 'cixiongChoice'
g.pending = { type:'cixiongChoice', from, to, ...透传 }
```

- 仅 `to === mySeat` 可操作
- 有手牌：按钮「弃一张手牌」/「令对方摸一张」
- 弃牌：客户端选一张手牌下标 → `respondCixiongChoice('discard', cardIdx)`；服务端校验手牌存在后弃入弃牌堆
- 摸牌：`respondCixiongChoice('draw')` → `drawN(g, from, 1)`
- 无手牌：不进 B，A 发动后直接 `drawN(from,1)` 再 continue

### 5.3 雌雄本身是单目标特效（不是多目标武器）

- **雌雄双股剑不提供「选择多个目标」**，只在「杀已经指定的那一个目标」上，于异性时可选发动一次。
- 与**方天画戟**的关系：二者都是武器，**同一角色武器槽互斥，不能同时装备**。因此不存在「我既用方天多目标、又发动雌雄」的组合。
- 文档若提及「多目标杀链」：仅指项目里**其它机制**（当前主要是方天的 `fangtianQueue`）让一张杀对多个目标**依次**调用 `resolveShaUse` 时，每个目标会各自走完整杀链；若该次结算的攻击者恰好有雌雄（例如借刀等边缘、或将来其它多目标杀来源），则**每个目标独立**判定异性/是否发动。这不是雌雄自己的多选能力，也**无需**雌雄专用多目标队列。
- **实现默认场景**：装备雌雄时出杀 = 单目标，最多询问 **1 次**。

### 5.4 normalize

```js
// cixiongAsk / cixiongChoice：from/to 为合法座位且存活，否则清空 pending，phase 回 play（或 finishSingleShaTarget 防软锁）
```

与 guanshi/qinglong 同款防御。

---

## 6. UI

| phase | 谁 | UI |
|---|---|---|
| `cixiongAsk` | 攻击者 | banner「是否发动【雌雄双股剑】？」+ 发动 / 不发动 |
| `cixiongAsk` | 他人 | 等待 XX 决定是否发动雌雄双股剑 |
| `cixiongChoice` | 目标有手牌 | 「弃一张手牌」→ 选手牌；「令对方摸一张」 |
| `cixiongChoice` | 目标无手牌 | 不应出现（已在服务端直接摸） |
| `cixiongChoice` | 他人 | 等待目标选择 |

手牌选择：复用响应选牌/弃牌点选手牌模式（与贯石斧/寒冰类似，仅限手牌）。

---

## 7. 边界

| 场景 | 行为 |
|---|---|
| 同性目标 | 不询问 |
| 无 cap / 卸下 | 不触发 |
| 目标无手牌且发动 | 攻击者摸 1，继续杀 |
| 目标弃最后手牌变空城 | 杀继续结算 |
| 黑杀 + 仁王 | 雌雄可先结算，再无效 |
| 借刀杀人 | A 装备雌雄、对 B 出杀：A/B 性别不同则可触发（A 为使用者） |
| 丈八/武圣转化杀 | 同普通杀，看使用者与目标性别 |
| 神速视为杀 | 同普通杀 |
| 攻击者/目标中途死亡 | pending 校验存活，否则 finishSingleShaTarget / 清 pending |

---

## 8. 文件改动清单

| 文件 | 改动 |
|---|---|
| `data.js` | EQUIPS 项、buildDeck、可选 `isOppositeGender`、导出 |
| `weapons.js` | `maybeStartCixiong` / `respondCixiongAsk` / `respondCixiongChoice` |
| `game.js` | 杀链顺序：铁骑/烈弓后 → 雌雄 → 仁王/毅重 → 原 continue；normalize |
| `render-controls.js` | 两阶段 UI + 状态 reset |
| `render.js` | CARD_PINYIN；phase 清理 reset |
| `index.html` | `?v=` +1 |
| `run_cixiong_test.js` | 新建回归 |
| `CLAUDE.md` | 装备列表与进度 |

---

## 9. 测试场景

| # | 场景 | 期望 |
|---|---|---|
| 1 | 男杀女，发动，女弃手牌 | 手牌-1，杀继续 |
| 2 | 男杀女，发动，女选令摸 | 男手牌+1，杀继续 |
| 3 | 男杀女，不发动 | 直接出闪流程 |
| 4 | 男杀男 | 无雌雄询问 |
| 5 | 女无手牌，男发动 | 男直接摸 1 |
| 6 | 黑杀+仁王+异性 | 可雌雄，再因仁王无效 |
| 7 | 铁骑后仍可雌雄 | 铁骑结束后出现 cixiongAsk |
| 8 | 流离换目标 | 对新目标判性别 |
| 9 | buildDeck 含 1 张 ♠2 | 张数+1 |
| 10 | 卸下后无 cap | 不触发 |
| 11 | ffa/identity 均可用 | 与模式无关 |

---

## 10. 风险

1. **杀链顺序调整**（仁王挪后）是最大风险 → 必须回归仁王/毅重/铁骑/烈弓/青龙/贯石斧  
2. pending 透传 `noShan/shaColor/sourceCard` 勿丢  
3. 弃牌仅手牌，UI 勿列出装备  
4. 左慈化身改性别后实时生效（`generalGender` 已动态）

---

## 11. 审批记录

| 项 | 状态 |
|---|---|
| 官方效果 | 已确认 |
| 实现路径（pending 链 + 杀链顺序） | 用户确认「可以」 |
| 雌雄为单目标特效；与方天武器互斥，无「雌雄多选目标」 | 用户澄清后已写入 §5.3 |
