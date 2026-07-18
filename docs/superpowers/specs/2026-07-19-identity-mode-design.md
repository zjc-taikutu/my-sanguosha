# 身份模式（主公局）设计规格

> 日期：2026-07-19  
> 状态：待用户审阅  
> 范围：B 档身份局 + 开局模式选择（乱斗 / 主公局）  
> 实现方案：模式开关 + 最小侵入（方案 1）

---

## 1. 目标与非目标

### 1.1 目标

在现有网页联机三国杀上增加**经典身份模式（主公局）**，并与现有**乱斗模式**并存：

- 开局前可选择：乱斗（现有）或 主公局（新）
- 主公局覆盖 **4~8 人**
- B 档规则：发身份、胜负、主公 +1 血、杀人奖惩、主公先手、标准身份隐藏显示、主公先选将（5 选 1）

### 1.2 非目标（本版明确不做）

- 主公技（激将 / 护驾 / 制霸 / 妄尊等）——继续标「暂不实现」
- 2~3 人身份局
- Firebase 身份真隐藏（DB 读权限）——界面按标准藏，朋友局接受控制台可读
- 全公开教学身份局
- 按势力限制主公选将
- 内奸复杂 FAQ / 特殊胜利动画
- 身份牌独立大 UI / 整卡按身份染色边框

---

## 2. 需求摘要（已对齐）

| 项 | 决定 |
|---|---|
| 人数 | 主公局 4~8；2~3 可点主公局但拦截并提示至少 4 人 |
| 深度 | B 档，不做主公技 |
| 模式入口 | 先选乱斗/主公局，再点随机武将或三选一 |
| 主公血量 | 固定 `maxHp + 1`（4~8 人相同） |
| 奖惩 | 杀反贼摸 3；主公杀死忠臣弃光手牌+装备+判定区 |
| 先手 | 随机座位发身份 → 亮主公 → 从主公座位 `startTurn` |
| 信息 | 主公公开；自己可见自己的；死后翻开；存活隐藏身份不显示 |
| 选将 | 主公先选、5 选 1；其余按座 3 选 1 |
| 主死且无反无内 | **无胜者** |

---

## 3. 架构方案

**采用：模式开关 + 最小侵入。**

- `g.gameMode = 'ffa' | 'identity'`
- 乱斗：现有 `checkWin` / 起手 / 选将几乎不动
- 主公局：身份表、胜负、主公 +1、奖惩、主公起手、选将拆分
- 所有新逻辑优先 `if (g.gameMode !== 'identity')` 走旧路径，保证乱斗零回归

不采用：两套平行开局流水线（易分叉）；先做全公开再藏（与需求不符、返工）。

---

## 4. 数据模型

### 4.1 对局字段

| 字段 | 类型 | 含义 |
|---|---|---|
| `g.gameMode` | `'ffa' \| 'identity' \| null` | 乱斗 / 主公局；大厅未确认前可为 `null` |
| `g.winSide` | `'fan' \| 'nei' \| 'lord' \| 'none' \| null` | 身份局胜方结构化结果（可选但推荐）；乱斗不用 |

### 4.2 玩家字段

| 字段 | 类型 | 含义 |
|---|---|---|
| `p.role` | `'zhu' \| 'zhong' \| 'fan' \| 'nei' \| null` | 身份；乱斗恒 `null` |
| `p.roleRevealed` | `boolean` | 是否已对全场公开。主公开局即 `true`；其余死后 `true` |

### 4.3 normalize

- `g.gameMode`：仅允许 `'ffa'|'identity'`，否则 `null`；`null`/缺失 → **按 ffa 行为**
- `p.role`：不在枚举内 → `null`
- `p.roleRevealed`：非布尔 → `false`
- 乱斗：可强制清理脏 `role`（防旧房污染）
- `g.winSide`：非法 → `null`

### 4.4 身份配比（仅 4~8）

```
n=4 → 主1 忠1 反1 内1
n=5 → 主1 忠1 反2 内1
n=6 → 主1 忠1 反3 内1
n=7 → 主1 忠2 反3 内1
n=8 → 主1 忠2 反4 内1
```

实现：`IDENTITY_TABLE` 常量；开局洗牌后按座位写入 `p.role`。

### 4.5 主公 +1 体力上限

在 `finishGeneralAssign`（武将已定、写 `maxHp`/`hp` 处）：

```
p.maxHp = generalMaxHp(p.general)
if (g.gameMode === 'identity' && p.role === 'zhu') p.maxHp += 1
p.hp = p.maxHp
```

乱斗不走 +1。

### 4.6 与势力字段的关系

- 势力（`faction` / `generalFaction`）≠ 身份（`role`）
- 两套独立；身份不改动势力系统

---

## 5. 开局与选将流程

### 5.1 大厅 UI 顺序

```
加人
  → 必选模式：乱斗 | 主公局（未选则随机/三选一禁用，或点了提示先选模式）
  → 选开局方式：随机武将 | 三选一
```

拦截：

- `gameMode === 'identity' && players.length < 4` → 提示「主公局至少需要 4 名玩家」，return
- 乱斗仍 `MIN_PLAYERS = 2`

命名分离（避免参数混用）：

| 概念 | 字段/参数 |
|---|---|
| 对战模式 | `g.gameMode = 'ffa'\|'identity'` |
| 武将分配 | 现有 `startGame('random'\|'pick')` / `g.generalMode` |

客户端可选 `selectedGameMode`，**点开始时写入** `g.gameMode`。

### 5.2 主公局 `startGame` 流水线

```
1. 校验未开局、人数 4~8（identity）
2. g.gameMode = 'identity'
3. 按 IDENTITY_TABLE[n] 洗牌，按座位写 p.role
4. 主公 p.roleRevealed = true；其余 false
5. 日志：「本局为身份模式，主公是 XXX」（不暴露隐藏身份）
6. 武将分配（random / pick，见下）
7. 全员武将确定 → finishGeneralAssign（含主公+1）
8. startTurn(g, lordSeat)  // 非写死 0
```

乱斗：`g.gameMode = 'ffa'`，不发 role，`startTurn(g, 0)` 保持现状。

### 5.3 主公局 + 随机武将

- 洗武将池，不放回
- 先给主公 1 张，再给其他人各 1
- 无选将阶段，直接 `finishGeneralAssign`

### 5.4 主公局 + 三选一

| 阶段 | `g.phase` | 操作者 | 候选 |
|---|---|---|---|
| 主公选将 | `pickingLordGeneral` | 仅主公 | **5** 张 |
| 他人选将 | `pickingGeneral` | 非主公 | 主公选完后，剩余池每人 **3** 张 |

```
startGame('pick') + identity
  → 切 5 张给主公 → phase = pickingLordGeneral
  → 主公 respondPickLordGeneral(id)
  → 剩余池给每个非主公 3 张
  → phase = pickingGeneral（复用 respondPickGeneral，跳过已有 general 的主公）
  → 全员有 general → finishGeneralAssign → startTurn(lordSeat)
```

规则：

- 主公选完前，他人只见「等待主公选将…」，不可见主公 5 张候选
- 调试选将：主公阶段仅主公；他人阶段同现有
- 池不够：`5 + 3*(n-1)` 不足时安全退化随机（与现有退化同思路）
- 选将阶段 `g.started === false`，不提前公开武将立绘（沿用现有 `avatarReady`）

### 5.5 座次

- 加入顺序仍决定 `players[]` 下标
- 身份洗牌贴座，主公不一定是 index 0
- `lordSeat = players.findIndex(p => p.role === 'zhu')`
- `nextAlive` 等环形逻辑不改

### 5.6 清理

`newGame` / `cleanupRoom` / `backToLobby`：清空 `gameMode`、`winSide`、所有 `role` / `roleRevealed`。

---

## 6. 胜负与阵亡奖惩

### 6.1 乱斗 `checkWin`

保持：

```
aliveCount <= 1 → phase=over，winner = 最后存活者名（或「无」）
```

### 6.2 主公局 `checkWin`

在真正死亡后调用（`finishDying(actuallyDied=true)`；奖惩在 checkWin **之前**）。

```
lordAlive = 存在 role==='zhu' && alive
fanAlive  = 存在 role==='fan' && alive
neiAlive  = 存在 role==='nei' && alive
```

| 条件 | 结果 | winSide | winner 文案 |
|---|---|---|---|
| 主公死，场上还有反贼 | 反贼胜 | `fan` | `反贼` |
| 主公死，无反贼，有内奸 | 内奸胜 | `nei` | `内奸` |
| 主公死，无反无内 | **无胜者** | `none` | `无` |
| 主公仍活，全部反贼+内奸已死 | 主忠胜 | `lord` | `主公与忠臣` |

内奸「先清场再刀主」无需单独状态机：主死且无反有内 → 内奸胜。

### 6.3 死亡公开身份

`finishDying(g, true)` 且 identity：

```
p.roleRevealed = true
日志：XXX 死亡，身份是【主公/忠臣/反贼/内奸】
```

### 6.4 击杀奖惩（仅 identity）

杀手 = 本次致死伤害的 `sourceSeat`。  
`sourceSeat` 非数字（闪电等）→ **无奖惩**。  
杀手已死 / 自杀 → 无奖惩。

| 条件 | 效果 |
|---|---|
| `victim.role === 'fan'` 且杀手存活 | 杀手 `drawN(..., 3)`；日志杀死反贼摸三张 |
| `victim.role === 'zhong'` 且杀手 `role === 'zhu'` 且存活 | 主公弃光**手牌+装备+判定区**；弃装备**触发** `onLoseEquip`（主公仍存活，不同于阵亡弃装）；日志误杀忠臣 |

其他击杀组合：无额外奖惩。

### 6.5 结束展示

- 乱斗：胜者玩家名（现有）
- 身份：胜方文案 + 结束时可展示全员身份
- `g.winSide` 供 UI；`g.winner` 写中文兼容旧展示

### 6.6 多死

每个 `finishDying(true)` 各做：翻身份 → 奖惩 → `checkWin`；一旦 `over` 后续 short-circuit。

---

## 7. UI 显示规则

### 7.1 可见性

```
canSeeRole(g, viewerSeat, targetSeat):
  if g.gameMode !== 'identity' → false
  if target.role === 'zhu' → true
  if target.roleRevealed → true
  if viewerSeat === targetSeat → true
  else → false
```

### 7.2 座位卡 `.seat-identity`

| role | 字 | 底色方向 |
|---|---|---|
| zhu | 主 | 金/黄 |
| zhong | 忠 | 橙或深红 |
| fan | 反 | 绿 |
| nei | 内 | 蓝灰 |

- 不透明底 + 白字（对比度不随立绘变，对齐势力块）
- `canSeeRole` 为假：保持空壳，不显示「?」暗示，不用颜色泄露
- 乱斗：全部空壳

### 7.3 日志

允许：开局主公名、死亡翻身份、奖惩、胜方。  
禁止：隐藏身份未死前写出忠/反/内。

### 7.4 大厅

- 互斥：乱斗 | 主公局  
- 未选模式：不可开始（或明确提示）  
- 主公局可提示「需 4~8 人」  
- n&lt;4 点开始 → 拦截提示

### 7.5 选将 banner

- 主公：从 5 名武将中选择  
- 他人等待主公；之后他人三选一同现有

### 7.6 朋友局说明

帮助/文档一句：界面标准隐藏；数据库仍全开，与手牌策略相同。

---

## 8. 乱斗兼容

| 路径 | identity | ffa |
|---|---|---|
| `checkWin` | 阵营/无胜者 | 存活≤1 |
| `finishDying` | 翻身份、奖惩 | 无 role 逻辑 |
| `finishGeneralAssign` | 主公+1、主公起手 | 原 maxHp、`startTurn(0)` |
| `startGame` | 发身份、主公选将 | 现有 |
| `.seat-identity` | canSeeRole | 空壳 |

---

## 9. 实现顺序

1. 数据 + 配比表 + normalize + 大厅选模式  
2. 开局发身份 + 主公+1 + 主公起手 + identity 随机武将  
3. `checkWin` 身份胜负 + 死亡翻身份  
4. 击杀奖惩  
5. 三选一：主公 5 选 1 → 他人 3 选 1  
6. UI 身份块 + 结束文案 + 日志  
7. 回归：ffa 冒烟 + identity 场景表  

---

## 10. 测试场景

| # | 场景 | 期望 |
|---|---|---|
| 1 | ffa 2 人互杀 | 与现网一致 |
| 2 | identity 4 人配比 | 主1忠1反1内1 |
| 3 | 5~8 配比 | 与表一致 |
| 4 | n=3 点主公局开始 | 拒绝+提示 |
| 5 | 主公 maxHp | 原+1，开局满血 |
| 6 | 首回合 | `g.turn === lordSeat` |
| 7 | 反+内灭，主活 | 主忠胜 |
| 8 | 主死有反 | 反贼胜 |
| 9 | 主死无反有内 | 内奸胜 |
| 10 | 主死无反无内 | **无胜者** |
| 11 | 杀反 | 杀手摸 3 |
| 12 | 主杀忠 | 主弃手牌+装备+判定区 |
| 13 | 闪电劈死主 | 无奖惩，只判胜负 |
| 14 | 死亡 | `roleRevealed` + 日志含身份 |
| 15 | canSeeRole | 主公全可见；己可见己；生藏不可见；死后可见 |
| 16 | 主公 5 选 1 后他人 3 选 1 | 池不重叠、主公先 |
| 17 | newGame/回大厅 | role/mode 清空 |

---

## 11. 风险

1. `startGame` 的 `random/pick` 与 `gameMode` 命名混淆  
2. 奖惩弃装备与 `onLoseEquip`/旋风 pending 顺序  
3. 主杀忠弃装须触发 `onLoseEquip`（非阵亡路径）  
4. 选将阶段不泄露武将立绘  
5. DB 身份可读——文档诚实说明  

---

## 12. 文档收尾（实现完成后）

- CLAUDE.md：身份场从待做移到已完成，写清 B 档范围  
- 主公技仍列待做  
- 帮助文案增加模式说明  
- `?v=` 同步 + commit/push 按项目惯例  

---

## 13. 审批记录

| 块 | 内容 | 状态 |
|---|---|---|
| 1 | 数据模型 + 配比 | 已确认 |
| 2 | 开局/选将 | 已确认 |
| 3 | 胜负+奖惩（主死无反无内→无胜者） | 已确认 |
| 4 | UI | 已确认 |
| 5 | 兼容+测试+顺序 | 已确认 |
