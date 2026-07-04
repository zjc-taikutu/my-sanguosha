# CLAUDE.md — 项目说明与协作守则

> 这个文件是给 Claude Code 读的。每次启动请先读它，了解项目现状、架构约定和改动原则，再动手。

## 一、项目是什么

一个**网页版联机三国杀**，给我和朋友玩。

- **单文件**：全部代码在 `index.html` 里（HTML + CSS + JS 一体）。
- **联机**：2~3 人，各自在浏览器打开同一网址、填同一房间号即可对战。
- **同步**：用 **Firebase 实时数据库（Realtime Database）** 做状态同步，compat 版 SDK 通过 `<script>` 加载。所有玩家订阅同一份房间状态，谁操作就改它，其他人实时更新。
- **部署**：改完重新部署（拖到 Netlify Drop / 或 Firebase Hosting）才能让大家访问。
- **现状**：基础流程 + 完整锦囊 + 5 个武将 + 可变人数（2/3 人）都已完成，仍在持续扩展。

## 二、整体架构与关键约定（改动必须遵守）

### 状态与事务
- 房间状态存在 Firebase 的 `rooms/{房间号}/game` 下，代码里用 `gameRef` 指向它。
- **所有状态变更必须走 `tx(fn)`**（封装了 Firebase transaction，保证多人并发下串行化）。不要在 `tx` 外直接改共享状态。
- `tx` 内部会先调 `normalize(g)` 再执行你的逻辑。

### Firebase 的关键坑（最容易出 bug 的地方）
- **Firebase 不保存空数组/空对象**：存进去的空数组，读回来会变成 `undefined`。
- 因此**任何新增的数组字段，都必须在 `normalize(g)` 里补默认值**，否则读到 `undefined.length` 会崩。
- 标量字段（数字、字符串、布尔）不受此影响，但数字 0、布尔 false 要确认不会被误判。

### 伤害与胜负（统一入口，不要绕过）
- **所有掉血走 `dealDamage(g, seat, amount, sourceSeat, reason, srcType)`**：只负责扣血 + 死亡判定挂起 + 日志。**返回值语义**：`true` = 已挂起进入濒死流程（调用方应立即 `return`，不做后续收尾——收尾延后到濒死解决时统一处理，见下条「濒死求桃」）；`false` = 本次伤害未致命，正常继续。**不代表"是否真死"**——挂起后可能被桃救回。不推进阶段、不判胜负。
- **濒死求桃**：`hp<=0` 时不立刻死亡，`dealDamage` 转调 `startDying(g, seat, srcType)` 挂起，按座位顺序（从濒死者本人开始，复用 `nextAskee`）逐个询问是否打出【桃】救援，`respondDying(useTao)` 结算。问完一圈无人救 / 无人有桃 → `finishDying(g, true)` 才真正阵亡（原「阵亡弃牌」逻辑就在这里）；中途回血 >0 → `finishDying(g, false)` 救回。`finishDying` 还负责接回被打断的那条流程的尾巴——用 `pending.resume.type`（值就是调用方传的 `srcType`：`'sha'`/`'duel'`/`'aoe'`）决定 `checkWin` 之后该怎么继续（攻击者继续出牌 / 回合切换 / `aoeAdvance` 到下个目标），这段尾巴和原来 `respondShan`/`duelResponse`/`aoeRespond` 各自的收尾代码完全一致，只是延后执行。三个调用点因此**不需要各自实现濒死逻辑**，只需在 `dealDamage` 返回 `true` 时 `return g` 跳过自己的尾巴。
- **胜负走 `checkWin(g)`**：存活 ≤1 则置 `over`/`winner`、清 `pending`/`aoe`、记日志，返回 true。
- 标准用法（无濒死时不变）：`dealDamage(...)` → 若返回 `true` 则 `return g`（濒死流程接管）→ 否则 `if(checkWin(g)) return g;` → 否则继续各自的阶段推进。

### 武将技能系统（核心，扩展时照这套来）
- 武将集中定义在 **`GENERALS` 表**（id → {name, maxHp, skill, desc, caps?, hooks?}）。
- **唯一查询入口是 `getGeneral(id)`** —— 业务代码永远通过它查武将，**绝不硬编码武将名**（不要写 `if 玩家是张飞`）。
- 技能有三种表达方式：
  - **`caps`（被动能力）**：声明在武将上，业务点用 `generalHasCap(player, cap)`（布尔）或 `generalCapValue(player, cap, fallback)`（数值）查询。
    - 例：张飞咆哮 `caps:{unlimitedSha:true}`（布尔）；数值型 cap 如 `extraDrawPhase`（摸牌阶段多摸 N 张，`startGame` 摸牌处 `generalCapValue(me,'extraDrawPhase',0)` 已接入）——seam 保留通用，当前暂无武将/装备使用。
    - **能力可来自武将或装备——统一走 `hasCap(player, cap)`**：`hasCap = generalHasCap(player,cap) || equipHasCap(player,cap)`，业务层只问「有没有这个能力」，不关心来源、也不硬编码武将名/装备名。装备侧在 `EQUIPS` 里用 `cap:'xxx'` 声明（见「装备区」），如诸葛连弩 `cap:'unlimitedSha'`。**新增「无武将/无装备来源之分」的布尔能力时，判定一律调 `hasCap`，不要只调 `generalHasCap`**（后者只查武将来源，会漏掉装备）。实时查询无缓存，装备卸下/替换即失效。
  - **`hooks`（触发型）**：在某时机执行一段效果，用 `triggerHook(g, seat, hookName, ctx)` 分发。
    - 例：郭嘉天妒、司马懿反馈都挂在 `hooks.onDamaged` 上（在 `dealDamage` 里触发，ctx 含 `{amount, sourceSeat}`）。孙尚香枭姬挂在 `hooks.onLoseEquip` 上（失去装备时触发，ctx 含 `{count}`，见「失去装备钩子」）。
  - **牌的转化**：`canUseAs(player, card, role)` 判断"这张牌能否当某用途用"，`findUsableAs(hand, player, role)` 找可用牌（优先本名牌）。
    - 例：赵云龙胆 `caps:{longdan:true}`，杀↔闪双向转化。所有"需要杀/闪"的场景都走 `canUseAs`/`findUsableAs`，不要在各处硬判断 `card.name==='杀'`。
- `caps`/`hooks`（函数/能力声明）只存在于客户端 `GENERALS` 表里，**从不写进 Firebase**，所以不需要在 normalize 里防御它们。持久化到房间状态的只有 `player.general`（id）以及从武将派生并展开存下的 `player.maxHp`（标量）——后者会在 `normalize` 里补默认值（回退 `MAX_HP`）。

### 武将技能系统的进阶模式（扩展新技能前先看这里有没有现成的可复用）
下面这几个模式是陆续加武将时沉淀出来的，具体实现细节写在「当前进度」对应武将条目里，这里只做索引，方便定位该复用哪一套：
- **回合内"限一次"标志位**：`g.shaUsed`/`g.duanliangUsed`/`g.qiaobianUsed` 都是同一个写法——`startTurn` 里重置为 `false`，`normalize` 里 `typeof!=='boolean'` 时防御回退。新增"每回合限一次"的技能照抄这个写法，不要另起炉灶。
- **虚拟牌**（`card.virtual=true` + `discardOrVanish(g,card)`）：技能"视为使用/打出某张牌"但不需要真的持有实体牌时用（徐晃【断粮】"视为使用兵粮寸断"）。凡是会让一张牌"离场"（进弃牌堆）的地方，都要用 `discardOrVanish` 而不是直接 `g.discard.push`，否则虚拟牌会被 `ensureDeck` 当真牌洗回牌堆、污染牌堆构成。
- **改变响应数量要求**（`g.pending.shanCount`/`shaCount` 计数器）：技能要求"连续出 N 张牌才算完成一次响应"时用（吕布【无双】）。不需要新阶段/新 UI，只在现有 `pending` 上加一个计数字段，`needed` 在响应函数里临时算，不够就把计数写回 `pending` 、留在原阶段再问一次。
- **场上牌移动**（`qiaobianSources`/`qiaobianTargets` 动态清单 + 服务端独立重新校验）：技能要移动装备/判定区的牌到另一个角色身上时参考张郃【巧变】——如果全程只有技能拥有者一人做选择（不需要其他玩家响应），走"客户端逐步累积选择、最后一次性原子提交"，不需要引入新的服务端阶段。
- **`resolveShaUse` 的 `card` 参数**：`resolveShaUse(g,me,targetSeat,usedAs,card)` 的 `card` 是转化后**实际打出**的物理牌（不是"杀"这个抽象概念），技能需要按颜色/花色判断这张杀本身时用（于禁【毅重】判断黑色）。丈八蛇矛两张当杀没有单一花色，调用方不传 `card`（`undefined`）。
- **`noShan`**（`g.pending.noShan`，"此杀不可被闪抵消"）：铁骑判红、烈弓数值条件满足都复用同一个标志——为真时 `continueShaAfterTieqi` 直接跳过 `tryBagua`（连判定机会都不给），`respondShan` 服务端拒绝出闪，UI 不渲染"出闪"按钮。
- **公共牌区+轮流挑选**（五谷丰登）：批量亮出的牌暂存在 `pending.pool`（不进弃牌堆，用新写的 `revealPool` 而不是 `judge`——后者是"翻一张+立刻进弃牌堆+判定日志"，语义不同），挑选顺序 `pending.order` 在真正开始挑选那一刻（无懈通过后）按存活玩家环形算好存进去，`pending.idx` 是指针；每人操作前校验 `order[idx]===mySeat`，挑完 `idx++`，问完一圈收尾。被无懈整体抵消时 `pool` 里的牌是真实牌，直接整体弃入 `discard` 即可。人数/池子在无懈询问期间因阵亡等原因错位时，不追求重新分配，挑完一圈后把 `pool` 剩余牌兜底弃入弃牌堆防卡死即可。
- **两个不同角色的目标选择**（借刀杀人的 A/B）：目标不是同类型可变数量（那是张辽突袭的场景），而是两个角色分别有不同的合法性要求时用。走客户端两步状态机（如 `jiedaoSeatA`，仿 `zhangbaMode`/`qiaobianSrc` 不入库）：第一步点击过滤"满足 A 条件"的座位存下来，第二步点击过滤"满足 B 条件（通常依赖已选的 A）"的座位后一次性提交给专属函数（不是标准 `playCard`，`CARD_PLAYS` 里对应项的 `effect` 留空防御、只借用其 `canPlay`/`target:true` 做"选中即高亮"）；效果需要"第二个人（A）做选择而非使用者"时，接一个新的响应阶段（`jiedaoChoice`），只有 A 能操作。

### 出牌系统（已统一，加新牌照这套来）
- **所有出牌走 `CARD_PLAYS` 表 + `playCard(cardIdx, actionId, targetSeat)`**。
- `CARD_PLAYS` 每项是 `{ canPlay(g,me,card), target(布尔，是否需要指定目标), effect(g,me,card,targetSeat) }`。
- **加一张新牌 = 往 `CARD_PLAYS` 表里加一项 + 在 `buildDeck` 里加牌**，不要再写独立的 `playXxx` 函数。
- `playCard` 统一负责：阶段/回合校验 → 取牌校验在手 → `canPlay` → 目标校验（仅 target 牌：非自己、存活）→ 出牌入弃牌堆 → `effect`。
- 注意 `actionId`：除"杀"外都等于 `card.name`；**杀固定为 `'杀'`**（因为赵云的闪物理 name 是'闪'但要走杀的逻辑）。

### 装备区（数据结构 + 装备进出 + 距离/射程 已完成；武器/防具特效待做）
- 每个玩家有一个装备区 `player.equips`，**四槽**：`{ weapon, armor, plus1, minus1 }`（武器 / 防具 / +1马防御 / -1马进攻）。每槽存**一张装备牌对象或 `null`（空）**。
- **装备牌对象就是普通牌对象 `{id, name}`**，和手牌同构；装备 = 把牌对象从手牌搬进槽，卸下 = 搬进弃牌堆。**牌对象上不挂任何派生属性**。
- **派生属性（所属槽位 `slot`、武器射程 `range`、马的距离修正 `dist`，日后加防具特效）声明在客户端常量表 `EQUIPS`（name → {...}），经 `getEquip(name)` 查询，从不写进 Firebase**——和武将 `caps`/`hooks` 同一套 seam：业务层永远查表，不硬编码装备牌名。
- **`equips` 是持久化的对象字段，必须在 `normalize` 里防御**：Firebase 吞 `null` 值/空对象，读回来容器会缺失或缺键，用 `p.equips = Object.assign(emptyEquips(), p.equips||{})` 补容器 + 补齐四槽（缺的回退 `null`）。四槽结构统一走 `emptyEquips()` / `EQUIP_SLOTS`，别各处手写。
- 初始化：`startGame`/`newGame` 给每人 `p.equips = emptyEquips()`；加入/重连路径不手写，靠 `normalize` 兜底（单一补全入口）。
- 显示：装备区是**公开信息**（和武将一样人人可见），在座位卡片 HP 下渲染；空槽显示暗色占位 `—`。
- **装备打出（进出装备区）**：所有装备共用一个 `CARD_PLAYS` 项 `equipPlay`（`target:false` + **`noDiscard:true`**），由 `Object.keys(EQUIPS).forEach(...)` 自动挂进 `CARD_PLAYS`——**加新装备只改 `EQUIPS` 一处**。`noDiscard` 让 `playCard` 跳过「进弃牌堆」，改由 `equipCard` 把牌放进对应槽（同槽旧装备进弃牌堆）。**装备牌不进弃牌堆是靠 `noDiscard` 标志，别在 effect 里从 discard 挪回来。**
- **装备提供能力**：`EQUIPS` 项加 `cap:'xxx'` 即表示「装备它的人获得该布尔能力」，由 `equipHasCap`/`hasCap` 实时查询（见「武将技能系统」的 `hasCap` seam）。例：诸葛连弩 `cap:'unlimitedSha'`（无限杀）。后续「给能力」的武器/防具照此声明，判定统一走 `hasCap`，不硬编码装备名。

### 距离系统（已完成；只有【杀】受攻击距离限制）
- **口径**：基础距离 = 两座位在**存活玩家**环上的最近间隔（阵亡者不占位，计算时跳过）；目标的 `+1马` 使别人到他 `+1`（更难够到），我的 `-1马` 使我到别人 `-1`（更易够到）；**距离最小为 1**。攻击距离 = 我的武器 `range`（无武器默认 1）。**能对某人出杀 = 距离 ≤ 攻击距离**。
- **函数**：`distance(g, from, to)`（环形最近间隔 + 目标 plus1 + from minus1，`Math.max(1,…)`）、`attackRange(g, seat)`（读武器 `range`，无则 1）、`canReachSha(g, from, to)`（= 距离 ≤ 攻击距离；**UI 与校验共用同一入口，口径不分叉**）。马/武器数值一律从 `EQUIPS` 的 `dist`/`range` 读，不硬编码。
- **接入出杀走 `canTarget` seam**：`CARD_PLAYS` 项可选 `canTarget(g,me,card,targetSeat)`，`playCard` 在「非自己/存活」校验后调用它。**只有【杀】挂了 `canTarget`（查 `canReachSha`）**；决斗/顺手/过河拆桥/南蛮/万箭无 `canTarget`，不受攻击距离限制（维持各自目标规则）。距离是**额外叠加**的一层，不动 `canPlay` 里的赵云【龙胆】/张飞【咆哮】逻辑。
- **UI**：选中作为杀的牌时，超距的存活对手不可点（暗色点线 + 「够不着」角标 + 悬浮「距离 X ＞ 射程 Y」）；范围内保持朱红虚线可点。`canTarget` 是服务端级兜底，UI 漏判也拦得住。
- **边界**：2 人无装备距离都是 1、可互杀；2 人一方装的卢 → 距离 2，对手无长武器则「够不着」（**刻意不为 2 人加特例**，符合真实规则，可用过河拆桥/顺手拆马或丈八蛇矛 range3 反制）。

### 顺手/拆桥 作用于「手牌 + 装备」的 `pick` 选牌子阶段
- 顺手牵羊/过河拆桥可拿/拆目标的**手牌或装备**。无懈通过后 `resolveTrick` 统计可拿/拆对象：**手牌整体算 1 个「随机手牌」选项**（隐藏信息，不列具体牌），**每件已装备各算 1 个具名选项**（公开信息）。
- **唯一项免弹窗、≥2 项才开 pick**：0 项→无效果回 play；1 项→直接结算（纯手牌走老路径、行为不变）；≥2 项→开 `pending={type:'pick',trick,from,to}`、`phase='pick'`，**只有使用者 `from` 能选**。选牌由 `pickResolve(choice)` 结算（`choice='hand'` 或槽名），失效项（手牌空/槽空/目标死）安全回 play 防软锁。
- 结算逻辑抽成共用 helper：`applyTrickOnHand`（随机拿/弃手牌，**日志不写牌名**）、`applyTrickOnEquip`（拿/拆指定槽装备，**日志写牌名**；顺手获得的装备进使用者手牌）。「唯一项直接结算」和「pick 后结算」都调它俩，逻辑不分叉。
- `pending.type:'pick'` 全是标量，`normalize` 无需改。拿走装备后 `distance`/`hasCap` 实时生效（拆的卢/连弩即失效）。
- **失去装备钩子 `onLoseEquip` 已实现**：装备离开装备区时经 `triggerHook(g, seat, 'onLoseEquip', {count})` 分发。触发点：`applyTrickOnEquip`（被顺手/被拆，失主 `info.to`）、`equipCard`（同槽换装换下旧装备，装备者）——均 `count:1`。**阵亡弃装备刻意不触发**（`dealDamage` 死亡分支提前 return，人已死不发动常规技能）。孙尚香真实枭姬即挂此钩（失去一张装备摸两张，`2*count`，自动触发不询问）。日后加「主动卸载装备」入口须一并接入此钩（`dealDamage` 死亡分支有注释提醒）。
- **暂缓**：顺手牵羊的距离限制，待后续。

### 人数
- `SEATS=3` 是**容量上限**（满 3 不再加入）；`MIN_PLAYERS=2` 是**开始门槛**（≥2 即可开始）。
- "找下一个玩家"的环形遍历（`nextAlive`、`nextAskee`）必须**按实际玩家数 `g.players.length` 取模**，不要写死 3。

### 玩家身份（联机识别）
- 每个浏览器用一个本地标识 `cid` 区分"自己刷新重连"和"别人重名"。
- **测试多人时必须用不同浏览器**（Chrome/Edge/Firefox 各一个），不能用同一浏览器的多个标签或同一无痕会话的多窗口——它们共享存储、`cid` 相同，会被识别成同一个人挤进一个座位。

## 三、改动原则（请严格遵守）

1. **一次只改一件事**。不要顺手重构无关代码、不要一次塞多个功能。
2. **改完要能回归测试**。说明改了哪些函数、要不要重新部署、要不要清空 `rooms` 数据。
3. **涉及结构/状态机的较大改动，先给设计方案，等我确认后再写代码**（尤其是会触及多处的改动，先列"改动清单/对照表"，确保没有遗漏）。
4. **纯重构必须行为零变化**，并逐项说明和改动前一致。
5. **不要硬编码武将名/牌名做特例判断**——能力声明在数据表、判定走 seam（getGeneral / canUseAs / CARD_PLAYS）。
6. **新增数组字段记得在 `normalize` 里防御**（Firebase 吞空数组）。
7. 改动较大或新增阶段时，**清空 `rooms`** 再测（旧房间状态可能不兼容）。
8. **隐藏信息**：手牌、是否持有某张牌（如无懈可击）等是隐藏信息，UI 和日志都不要泄露谁有什么牌。
9. **改动测试通过后，直接执行 `git add`/`commit`/`push`，不用等待用户确认**——commit message 写清楚这次改了什么。若改动较大或有把握不足，可以先说明测试结果，但仍应完成 push，不要把"是否 push"当成需要用户额外确认的步骤。**例外**：如果改动本身还没经过测试确认（刚写完代码、还没验证过），不要着急 push，应先让用户确认测试没问题，再 push——push 的前提仍是"确认改动是对的"，只是不再需要用户额外说"去 push"这个动作本身。
10. **分支管理**：默认所有开发都在 `main` 分支上进行，不设常驻的 `dev` 分支。如果某次任务因为改动较大、风险较高需要临时开一个功能分支，必须明确告诉用户"这次要新建分支 XXX"并说明原因，完成并验证无误后要主动提醒用户合并回 `main`、然后删除这个临时分支。**每次开始新任务前，先用 `git branch` 确认当前在 `main` 分支上**，不要默认延续上一次可能残留的分支状态（上一个任务/会话可能切换过分支、忘记切回）。
11. **完成任何一次功能实现（新武将、新机制、新 bug 修复、新装备等）后，更新 `CLAUDE.md` 是任务收尾的标准步骤，和 `commit`/`push` 同等优先级——不是软性建议、不是"提醒了才做"，代码写完、测试通过、push 了，任务还不算完成，直到 `CLAUDE.md` 也更新了才算。** 具体要做：
    - 在"五、当前进度 - 已完成"清单里加一条准确描述这次改动的记录（新武将写清楚 `caps`/`hooks`/关键实现点；新机制说明它复用了哪套已有模式还是引入了新模式）；
    - 如果涉及新的架构约定/新机制类型（新的 `pending` 类型、新的挂起-恢复模式、新的数据结构、新的可复用 seam），在"二、整体架构与关键约定"对应章节（或"武将技能系统的进阶模式"索引小节）补充说明；
    - 如果这次修复了"四、已知的待优化点"里记录的问题，把那一条从清单里移除。
    一次任务如果中途有过几轮方案调整、讨论分支，`CLAUDE.md` 更新只需要在最终收尾时做一次完整总结，不用每个中间讨论都记。**另外，每累计约 5~6 次新增功能后，主动做一次核对性回顾**——对照代码实际状态（`GENERALS`/`EQUIPS`/`CARD_PLAYS` 等表的真实内容）和 `CLAUDE.md` 记录逐一比对，检查有没有遗漏或过时的地方，不要假设"应该每次都记全了"（参考此前那次系统性核对，曾经就发现过遗漏和过时描述）。
12. **写 vm 沙箱测试脚本时，涉及"逐个询问"机制（濒死求桃、无懈可击反制、鬼才改判、乐进骁果这类靠 `nextAskee`/`nextGuicaiAsker`/`nextXiaoguoAsker` 等函数按座位顺序遍历候选人的场景）时，不要预设"这次问的是哪个座位"——座位顺序由存活玩家的环形位置和候选人资格（是否存活/有没有对应牌/是否在攻击范围内等）动态决定，不是"下一个座位号"这么简单，靠猜容易错（已经在多次调试里踩过好几次这个坑：把响应发给了错误的座位号，导致测试断言看起来像是代码 bug，其实只是测试脚本的预设座位不对）。正确写法是每次循环读取 `g.pending.asking`（或对应字段）动态获取当前实际被问的座位，再对那个座位发响应，例如：`while(g.phase==='dying'){ setSeat(g.pending.asking); call('respondDying', ...); }`。
13. **`element.className = 'xxx'` 是整体覆盖，不是追加**：如果这个元素本身还需要保留其它 class（尤其是 HTML 里写死的基础 class，比如某个容器原本 `class="seats"`，JS 又要动态加一个状态 class），直接赋值会把原有 class 冲掉，导致依赖"同时命中多个 class"的组合选择器（如 `.seats.opp2`）永远匹配不上——现象通常是"CSS 看起来完全没生效"，容易被误判成选择器写错/文件没部署对/浏览器缓存，实际是 DOM 上的 class 就没那个值。排查这类"CSS 明明写对了但没生效"的问题时，先去 Elements 面板确认元素实际的 `class` 属性，而不是只检查 CSS 源码。修的时候优先用 `classList.add()`/`classList.remove()` 按需增删（不影响其它已有 class）；如果确实要用整体赋值，必须显式拼接所有需要保留的 class（例如 `el.className = 'seats opp'+n`），不能想当然只写新加的那部分。

## 四、已知的待优化点（不是 bug，心里有数）

- **响应阶段无超时**：轮到某人响应（出闪/无懈/决斗/AOE）时若挂机或关页面，整局会永久卡死。尚未做超时/托管。
- **手牌非真隐藏**：手牌存在共享状态、数据库读权限全开，会看控制台的人能看到所有人的牌。当前是朋友局，接受此边界。
- **数据库写权限全开**：任何知道房间号的人能改/删数据。朋友局接受。
- **决斗 sourceSeat 不精确**：决斗发起者本人认输受伤时，`dealDamage` 传的 `sourceSeat` 等于受害者自己，导致依赖伤害来源的技能（如司马懿反馈）在该边角不触发。代码里 `duelResponse` 处有注释标注，日后若要精确：发起者受伤传 `pending.to`、目标受伤传 `pending.from`。
- **单文件已较大**（约 1200 行）：再加大型系统（如身份场）时，可考虑拆分为多文件。

## 五、当前进度

**已完成**：
- 基础流程：摸牌/出牌/弃牌三阶段、回合流转、2~3 人可变人数。
- **借刀杀人**：两个不同角色目标（A 要有武器、B 要在 A 攻击范围内），项目里第一次"选两个不同角色"的目标交互——不是标准单目标流程能表达，`CARD_PLAYS['借刀杀人']` 的 `effect` 故意留空（正常流程不会走到，只有 `target:true`+`canPlay` 借用现有"选中即高亮"的 UI 判定），实际由客户端专属两步选择（`jiedaoSeatA` 状态：先点场上有武器的角色为 A，再点 A 攻击范围内的另一角色为 B）直接调 `jieDaoShaRen(cardIdx,seatA,seatB)`（校验武器/距离后弃牌、`startTrick(...,seatB)`）。`startTrick`/`finishWuxieRound` 新增 `seatB` 随 `info`/`pending` 透传（其它锦囊不传，无操作）。**被无懈整体抵消**：和桃园结义同款"抵消的是整体效果"，不是逐目标 AOE 结构，被挡下 A 完全不用做选择。无懈通过后进入新的 `jiedaoChoice` 阶段（`g.pending={type:'jiedaoChoice',from,seatA,seatB}`），只有 A 能操作 `respondJiedao(useSha)`：选杀→`findUsableAs(A.hand,A,'杀')`+`resolveShaUse`；选弃武器→弃 A 装备区武器槽+`triggerHook(...,'onLoseEquip',{count:1})`（孙尚香摸两张）。**关键正确性修复**：`resolveShaUse` 原本无条件在开头设 `g.shaUsed=true`，这只在"调用方必是当前回合玩家自己出牌阶段出杀"时安全——借刀杀人打破这个假设（A 可能根本不是当前回合玩家）。**修复方式是把 `g.shaUsed=true` 从 `resolveShaUse` 内部挪到两个原有调用点**（`CARD_PLAYS['杀'].effect`、`playZhangbaSha`）各自设置，借刀杀人这个新调用点完全不碰它——从根源解决，不是加特判，这样借来的杀天然不占用任何人（包括 A 自己和真正的当前回合玩家）的每回合出杀次数限制，且不重复距离校验（B 是否在 A 范围内已在选目标那一步校验过）。`buildDeck` 2 张。
- **五谷丰登**：项目里第一次"公共牌区+轮流挑选"的交互。复用 `pending` 扩展字段的一贯做法（和借刀杀人的 `seatB`、延时锦囊的 `card` 同一模式），不新起独立容器：`g.pending={type:'wugu', from, pool:[牌...], order:[座位...], idx}`。**亮牌用新写的 `revealPool(g,n)`，不是 `judge()`**——语义不同：`judge` 是"翻一张+立刻进弃牌堆+判定日志"，`revealPool` 是"批量暂存到公共池,不进弃牌堆、不记判定日志"，之后可能被挑走进手牌、也可能被无懈/挑完剩余弃入弃牌堆。出牌 `effect` 里 `pool=revealPool(g,aliveCount(g))`，走和无中生有/桃园结义同一模板的 `startTrick(...,to:mySeat,pool)`（`to` 占位）。**无懈整体抵消**：`finishWuxieRound` 的 `blocked` 分支新增——`info.pool` 非空则整体 `push` 进 `g.discard`（这些是真实牌，不需要虚拟牌那套 `discardOrVanish`）。**未被无懈**：`resolveTrick` 新分支按当前存活玩家从发起者起用 `nextAlive` 环形转一圈算出 `order`，开 `'wugu'` 阶段。**挑选**：新函数 `wuguPick(poolIdx)`，仅 `mySeat===order[idx]` 可操作，选中的牌从 `pool` 移除、进挑选者手牌，`idx++`；挑完一整圈（`idx===order.length`）收尾。**阵亡边界**（无懈询问期间有人阵亡，导致 `order` 比 `pool` 短）：不追求"重新分配剩牌"这种复杂规则，只在挑完一圈后把 `pool` 里的剩余牌兜底弃入弃牌堆，保证不卡死。`normalize` 防御：`pool`/`order` 缺失回退 `[]`（Firebase 吞空数组），`from`/`idx` 非数字或 `order` 为空则整体判无效清空 `pending`。UI：`g.phase==='wugu'` 时公共池对所有人公开显示，只有当前 `order[idx]` 那位能点击挑选（其余人只读+等待提示）。`buildDeck` 2 张。
- 锦囊：杀、闪、桃、决斗、无中生有（`from===to===mySeat`，同样经 `startTrick`/`resolveTrick` 走无懈询问窗口，摸牌延后到无懈问完才发生）、**桃园结义**（和无中生有同一个模板：`target:false`+`startTrick(...,to:mySeat)`，`to` 只是占位——无懈抵消的是**这次使用的整体效果**（全场都不回血），不是逐个单独无懈，这一点和南蛮/万箭的"逐目标各自可被无懈"结构不同；`resolveTrick` 新分支循环所有存活玩家各回 1 点体力，满血者跳过不报错；`buildDeck` 1 张，和真实规则稀有度一致）、顺手牵羊、过河拆桥、无懈可击（按座位逐个询问、问所有存活玩家不泄露手牌，**支持无懈可击反制无懈可击、不限层数**，见下）、南蛮入侵、万箭齐发（群体锦囊，逐目标无懈 + 逐目标响应）、**闪电**/**乐不思蜀**/**兵粮寸断**（延时锦囊，见下）。
- 武将（16 个）：张飞【咆哮】、郭嘉【天妒】、孙尚香【枭姬】（真实版：失去装备摸两张，挂 `hooks.onLoseEquip`）、赵云【龙胆】、吕蒙【克己】（`caps:{keji:true}`，若本回合未使用/打出过杀可跳过弃牌阶段，判定走 `canSkipDiscard(g,seat)`）、司马懿【反馈】+【鬼才】（已扩展到攻击范围内他人的判定，见下）、马超【马术】+【铁骑】（见下）、甄姬【洛神】+【倾国】（见下）、张辽【突袭】（见下）、关羽【武圣】（见下）、黄忠【烈弓】（见下）、徐晃【断粮】（见下）、于禁【毅重】（见下）、乐进【骁果】（见下）、张郃【巧变(简化版)】（见下）、吕布【无双】（见下）。
- 架构重构：`dealDamage`/`checkWin` 统一伤害胜负、`CARD_PLAYS`+`playCard` 统一出牌入口。
- 房间清理（结束并清理房间）、重名/重连识别、房间号字符校验。
- 装备系统：装备区数据结构（`player.equips` 四槽）+ 座位卡片显示 + `normalize` 防御；装备牌可打出进出装备区（`EQUIPS`/`getEquip` + `equipPlay`/`noDiscard`/`equipCard`，同槽替换旧装备进弃牌堆），现有 **12 种**装备牌（诸葛连弩/丈八蛇矛/八卦阵/青釭剑/麒麟弓 5 件非坐骑 + 的卢/绝影/爪黄飞电/大宛 4 匹 +1 马 + 赤兔/紫骍/骕骦 3 匹 -1 马，均已入 `buildDeck`）。**武器/防具特效全部完成**：诸葛连弩【无限杀】、丈八蛇矛【两张当杀】（见下）、**青釭剑【无视防具】**（`cap:'ignoreArmor'`，`continueShaAfterTieqi` 里跳过目标的八卦阵判定）、**麒麟弓【弃坐骑】**（`cap:'qilin'`，`maybeStartQilin`/`discardMount`/`qilinResolve`：杀伤且目标存活时弃其一匹坐骑，两匹时开选马子阶段交攻击者选）、**八卦阵【判定视为闪】**（`cap:'bagua'`，`tryBagua`，见「伤害与胜负」及「司马懿【鬼才】」）。唯一还没做的是**主动卸载装备**（非战斗中自行拆下）。
- 距离系统：`distance`/`attackRange`/`canReachSha` + 出杀 `canTarget` seam。马（的卢 +1、赤兔 −1）与武器射程（连弩 1、丈八 3）真正生效，**只有【杀】受攻击距离限制**，阵亡者不占座位，UI 区分「够得着 / 够不着」。
- 能力来源统一：`hasCap = generalHasCap || equipHasCap`，布尔能力可由武将 `caps` 或装备 `cap` 提供。首个武器特效 **诸葛连弩【无限杀】**（`cap:'unlimitedSha'`）已生效，与张飞【咆哮】共用同一 seam、可叠加、实时失效。
- 武器特效 **丈八蛇矛【两张手牌当一个杀】**（`cap:'twoAsSha'`，走 `hasCap`）已完成：杀的结算抽成共享入口 `resolveShaUse`（普通杀与丈八共用，`shaUsed`/`pending`/`respond`/距离/次数口径不分叉）；「选两张牌」是纯客户端交互（`zhangbaMode`/`zhangbaPicks`，与单张 `selectedCardIdx` 路径互斥并存、不入库），选满两张再点目标，专用 `playZhangbaSha` 结算（两张进弃牌堆后走 `resolveShaUse`）。次数/距离(range3)/目标响应与普通杀完全一致。
- 顺手牵羊/过河拆桥可作用于**装备区**：`pick` 选牌子阶段——目标有多种可拿/拆对象时弹选择、纯手牌走老路径；手牌隐藏（只随机拿/弃、日志不写牌名）、装备公开（可具名选、日志写牌名）。顺手获得的装备进使用者手牌。拆掉的卢/连弩后距离/能力实时失效（反制成立）。
- 阵亡时死者**手牌 + 装备**全部弃置进弃牌堆（在濒死解决的 `finishDying` 死亡分支，覆盖所有致死来源：不闪/决斗认输/AOE 不出）。牌随重洗回流，牌库不再被抽干；日志手牌只记张数、装备写牌名。**阵亡弃装备刻意不触发 `onLoseEquip`**（死亡结算不发动常规技能，如枭姬）。
- **濒死求桃机制**：血量 `<=0` 不再立刻死亡，进入濒死（`p.dying`+`g.pending={type:'dying',seat,asking,resume}`），按座位顺序逐个询问是否打出【桃】救援（复用 `nextAskee`，从濒死者本人开始可自救）；`respondDying` 结算，救回则 `finishDying(g,false)`，问完一圈无人救则 `finishDying(g,true)` 才真正阵亡。出杀不闪/决斗认输/AOE 不出三处致死来源统一经 `dealDamage`→`startDying` 挂起，`finishDying` 按 `resume.type` 接回各自被打断的收尾流程（详见「伤害与胜负」一节）。UI 仿无懈可击的"没有可用牌就不渲染按钮"风格，座位卡显示"濒死"角标。
- **无懈可击可被无懈可击反制（不限层数）**：`g.pending`（`type:'wuxie'`）新增 `exclude`（当前这轮不问谁，即刚打出上一次无懈的人）+ `depth`（成功打出无懈可击的总次数）。核心是奇偶校验，不是栈：`depth` 为奇数 = 原锦囊/该 AOE 目标最终作废，偶数（含0）= 正常生效——不需要记录"每一层反制了谁"的历史。`openWuxieRound`（重新计算这轮该问谁，问不到人就直接收尾）与 `finishWuxieRound`（按 `depth` 奇偶收尾：`ctx==='aoe'` 走 `aoeAdvance`/`startAoeRespond`，否则 `pending=null` 或 `resolveTrick`）是新的两个公共函数，`startTrick`/`aoeAdvance`（初始化 `exclude=from,depth=0`）与 `respondWuxie`（出无懈：`depth++,exclude=自己`，重新 `openWuxieRound`；不出：`nextAskee(g,exclude,mySeat)` 推进）都统一走这两个函数。每一层反制都是独立的网络往返（一次 `tx`），不是函数递归调用，没有调用栈风险；层数不设人为上限，天然被"无懈可击牌的供给量有限"这个客观条件封顶。UI banner/hint 按 `depth` 是否 >0 区分措辞（"是否使用【无懈可击】" vs "是否用【无懈可击】反制 XX 的【无懈可击】"）。
- **司马懿【鬼才】（已扩展到攻击范围内他人的判定）**：`caps:{guicai:true}`。统一入口 `maybeGuicai(g, judgedSeat, card, resume)`——判定者自己优先（若有资格：`hasCap(p,'guicai')`+有手牌），否则按座位顺序问攻击范围内其余"有资格"的鬼才拥有者（`nextGuicaiAsker`，判据：存活+`hasCap`+有手牌+`canReachSha(g,候选人,judgedSeat)`，逐座位遍历、绕回判定者自己即问完一圈，和 `nextAskee`/无懈可击同一套环形遍历写法）；没人有资格则不挂起，原样用判定牌结算。**四个判定场景统一接入**：`tryBagua`（八卦阵翻牌，1 处）+ `processOneDelayCard`（闪电/乐不思蜀/兵粮寸断，3 张牌共用同一处）。`g.pending={type:'guicai',seat(判定者),asking(当前问谁,可能≠seat),judgeCard,resume}`；`respondGuicai`"不发动"时用 `nextGuicaiAsker` 推进到下一个候选人（不是直接结算），问完一圈才用原判定牌收尾——和无懈可击"不出→问下一个"同一结构。**resume 加了 `kind` 维度**区分"改判后该怎么消费最终判定牌"：`kind:'bagua'`（沿用原 `resume.type`:`'sha'`/`'aoe'`，走 `finishBaguaColor`，完全不变）、`kind:'delayJudge'`（`{seat,trickName,card}`，重新调 `DELAY_TRICKS[trickName].effect`，处理去向后继续该玩家判定区剩余的牌）。`finishGuicai` 按 `resume.kind` 分派。**延时锦囊判定链条里一个容易踩的坑，已处理**：`resolveDelayTricks` 拆成 `processOneDelayCard`(judge+鬼才窗口)+`finishDelayCard`(消费最终判定牌)+`continueDelayResolution`(统一收尾:`'pending'`时——若新挂起是**濒死**要把 `seat` 补进 `resume`（`dealDamage`/`startDying` 只知道 `srcType` 字符串），若新挂起是**鬼才**则**不能覆盖**它已经自带的完整 `resume`；`'done'`时走 `enterDrawPhase`)，`startTurn`/`finishDying` 的 `delay` 分支/`finishGuicai` 的 `delayJudge` 分支三处共用这个函数，不重复判断。

- **马超【马术】+【铁骑】**：`caps:{extraMinus1:true, tieqi:true}`。**马术**(锁定技)是 `distance(g,from,to)` 里 `from` 方向的额外 -1，和装备的 -1 马(`equipDist`)是两个独立来源、直接相加(`fromMinus1 = equipDist(...) + (hasCap(...,'extraMinus1')?-1:0)`)，纯查表叠加，不需要 `hooks`。**铁骑**是"出杀后攻击者可选是否发动判定,红色则这张杀不可被闪抵消(含视为闪的效果,如八卦阵)"——新增 `'tieqi'` 阶段(`g.pending={type:'tieqi',from,to}`,只有攻击者能响应),原来 `resolveShaUse` 里"设好 pending 后直接走青釭剑/八卦阵/进响应阶段"那段尾巴抽成 `continueShaAfterTieqi(g,from,to,noShan)`——不管没有铁骑、有铁骑但不发动、发动后判黑、发动后判红，最终都走这同一条尾巴，只是 `noShan` 参数不同。`noShan===true` 时**直接跳过 `tryBagua` 调用**(八卦阵连判定的机会都没有,不是"判定了但被无效化"),`respondShan` 加一层服务端兜底(`useShan` 时若 `g.pending.noShan` 直接拒绝),UI 侧"出【闪】"按钮在 `noShan` 时不渲染。铁骑的判定同样接入 `maybeGuicai`(`resume.kind:'tieqiJudge'`，`finishGuicai` 新增对应分支调 `finishTieqiJudge`)，保持"所有判定都能被鬼才改判"这条规则一致，不留特例。
- **甄姬【洛神】+【倾国】**：`caps:{luoshen:true, qingguo:true}`。**洛神**是"回合开始阶段"甄姬自己选择要不要发动的循环判定——和延时锦囊的被动判定不同触发点。接入点在 `continueDelayResolution`(判定区处理完毕后，原本直接调 `enterDrawPhase` 的地方)新插了一步 `continueTurnStart`：轮到的人有洛神就开 `'luoshen'` 阶段(`g.pending={type:'luoshen',seat}`)问要不要发动，没有则照常 `enterDrawPhase`；`startTurn`/`finishDying` 的 `delay` 分支/`finishGuicai` 的 `delayJudge` 分支都经 `continueDelayResolution` 走到这里，不用各自加判断。**循环怎么实现**：不是一次判多张，而是判一张、问一次要不要继续——`finishLuoshenJudge` 黑色时把 `g.pending`/`g.phase` 重新设回同一个 `'luoshen'` 状态，再问一次；红色或玩家主动选择"不再发动"才 `enterDrawPhase`。**判定牌归属的特殊处理**（这是目前唯一一个判定牌不进弃牌堆的场景）：`judge(g)` 本身还是照常把牌推进 `g.discard`，黑色分支里额外从 `g.discard` 里 `splice` 出这张牌再 `push` 进玩家手牌，不能"弃牌堆+手牌各一份"；红色分支什么都不用做，牌已经在弃牌堆里，和其它失败判定一致。洛神的判定同样接入 `maybeGuicai`(`resume.kind:'luoshenJudge'`)。**倾国**是"按颜色而非按名字"的转化，只在 `canUseAs` 加一条 `role==='闪' && hasCap(player,'qingguo') && !isRed(card)`，和赵云【龙胆】按名字转化的判断完全独立、互不干扰；因为 `respondShan`/`aoeRespond`(万箭需要闪)都已经统一走 `canUseAs`/`findUsableAs` 这个 seam，不需要改任何调用点，UI 的 `hasShan` 判断也自动生效。**修过一次 bug**：`startGame` 曾经直接手写 `g.turn=0;g.phase='draw';` 开局，没有经过 `startTurn`，导致"开局第一个人恰好是甄姬"时第一回合的洛神被跳过（第二回合起走 `endTurn`→`startTurn` 就正常）——`startGame` 现在也改成调用 `startTurn(g,0)`，任何回合开始（包括第一回合）都统一走同一条链路，不再有例外路径。
- **张辽【突袭】**：`caps:{tuxi:true}`。摸牌阶段"放弃摸牌,改为从至多两名其他角色手牌里各摸一张"，新增 `respondTuxi(targets)`(`targets` 是 1~2 个座位号，不含自己、不重复、都要存活；不合法直接不生效)，对每个目标随机拿一张(选到没手牌的目标只记日志、不报错、不阻断其余目标)，结算完 `phase='play'`——和顺手牵羊不同，这是摸牌阶段的替代行为，不是出牌阶段的锦囊，不开无懈可击窗口，同步直接结算。**UI 是新的"1~2个可变数量目标"交互**：客户端 `tuxiMode`/`tuxiPicks`(仿 `zhangbaMode`，纯客户端不入库)，点存活的其他玩家座位切换选中/取消，上限 `min(2,其他存活玩家数)`；和丈八蛇矛"选满 2 张自动可点目标结算"不同，这里数量可变(1或2都合法)，**不能靠"选满自动触发"，必须有独立的"确认发动"按钮**(选够 1 个即可点，不强制选满 2)。入口可见性：其他存活玩家里一个都没手牌时，"发动【突袭】"按钮直接不渲染(和其它"没有可用手段就不渲染"的场景同一风格)。
- **关羽【武圣】**：`caps:{wusheng:true}`。第三种牌的转化规则——`canUseAs` 加一条 `role==='杀' && hasCap(player,'wusheng') && isRed(card)`，和赵云【龙胆】(按名字双向转化)、甄姬【倾国】(按黑色转闪)各自独立、互不覆盖。因为项目里所有"需要杀"的地方（主动出牌的 `CARD_PLAYS['杀'].canPlay`、决斗 `duelResponse`、南蛮入侵 `aoeRespond`、render.js 的目标高亮/actionId 判断）都已经统一走 `canUseAs`/`findUsableAs` 这个 seam，武圣加完这一行就自动覆盖所有场景，不需要碰任何调用点——这正是当初设计这个 seam 的价值。武圣只管"红色手牌能不能被认成杀"，不改变杀本身的其它规则：距离限制(`canTarget`/`canReachSha`)、每回合次数限制(`shaUsed`/`unlimitedSha`)都不受影响，天然照常生效。
- **黄忠【烈弓】**：`caps:{liegong:true}`。和马超【铁骑】效果本质相同("这张杀不可被闪抵消")，但触发方式不同——不是判定，而是出杀后同步比较数值条件(目标手牌数≥黄忠当前 `hp`，或≤`attackRange(g,黄忠座位)`，两者任一成立即可)，满足条件时可选发动(不是自动生效)。`resolveShaUse` 里 `hasCap(me,'tieqi')` 那个分支旁边加了一个平行的 `hasCap(me,'liegong')` 分支：不满足数值条件完全不进这个分支，直接走原有流程；满足条件才开 `'liegong'` 阶段问要不要发动。`respondLiegong` 不需要 `judge()`，玩家的选择本身就是 `noShan` 的值，直接复用铁骑已经写好的 `continueShaAfterTieqi(g,from,to,noShan)` 收尾（这条尾巴现在被两个技能共用，谁触发的 `noShan` 由调用方各自记日志，`continueShaAfterTieqi` 内部不再把日志硬编码成"铁骑判定为红"，改成不归因到具体技能的通用措辞）。UI 直接复制铁骑响应按钮的结构（"发动【烈弓】"/"不发动"两个按钮），不需要新的交互元素。
- **徐晃【断粮】**：`caps:{duanliang:true}`。出牌阶段限一次(`g.duanliangUsed`，和 `g.shaUsed` 同款每回合重置)，弃置任意一张手牌，视为对一名其他角色使用了一张【兵粮寸断】——**不需要真的持有这张牌**，是项目里第一个"虚拟牌"机制。完全复用 `startTrick`/`resolveTrick`/回合开始判定的整条延时锦囊流程：徐晃弃的牌是真实牌，正常进弃牌堆；传给 `startTrick` 的 `info.card` 是临时构造的 `{name:'兵粮寸断', virtual:true}`，靠 `card.name` 走查表和无懈可击窗口，和真实兵粮寸断行为完全一致(可被无懈抵消、回合开始判黑跳过摸牌)。**`virtual` 标记是这个功能的关键**：延时锦囊的牌"离场"(被无懈挡下 `finishWuxieRound`、或判定完毕作废 `finishDelayCard`)时统一走新抽出的 `discardOrVanish(g,card)`——真实牌照常进 `g.discard`，虚拟牌直接消失、不进弃牌堆重新流通，否则会被 `ensureDeck` 当真牌洗回牌堆，凭空多出一张不在 `buildDeck` 统计里的"兵粮寸断"、污染牌堆构成，而且这张牌没有 `suit`/`rank`，被摸到手里会显示异常。断粮真实规则无距离限制，`duanLiang(cardIdx,targetSeat)` 不调用 `canReachSha`。**独立于 `CARD_PLAYS` 的新交互**：不检查牌名(任意手牌都能当弃置对象)，走客户端 `duanliangMode`/`duanliangCardIdx`(选一张手牌+点一名其他玩家提交，仿丈八蛇矛的"选牌+点目标"但只选 1 张、不限定牌名)。
- **于禁【毅重】(锁定技)**：`caps:{yizhong:true}`。若目标装备区无防具且这张杀是黑色，杀对目标直接无效——不进响应阶段、不消耗闪、不受伤。`resolveShaUse(g,me,targetSeat,usedAs,card)` 新增第五个参数 `card`（转化后**实际打出**的物理牌，不是"杀"这个抽象概念——关羽红牌转化的杀、赵云闪当杀，`card` 就是那张红牌/那张闪），在最前面判断：`card && !isRed(card) && hasCap(target,'yizhong') && !target.equips.armor` 就直接短路，`phase='play'`，跳过铁骑/烈弓/八卦阵等后续所有分支。**`g.shaUsed=true` 依然在毅重判断之前设置**——杀被无效化不代表没有使用它，次数限制依然计入，不能靠一直打无效杀绕过。两个调用点：`CARD_PLAYS['杀'].effect` 顺手传 `card`；`playZhangbaSha`(丈八蛇矛两张当杀)**不传 `card`**（`undefined`）——合成杀没有单一花色，视为"不是黑色"，毅重对丈八杀不生效（已确认的边界处理）。
- **乐进【骁果】**：`caps:{xiaoguo:true}`。项目里第一个"别人回合结束时,自己可以插入行动"的机制，新增 `BASIC_CARDS=['杀','闪','桃']` 常量（`data.js`）判断"是不是基本牌"。**只在 `endTurn()` 一处触发**（决斗/濒死导致的回合中断不触发——那个人没走到结束阶段，规则本身就不该触发骁果，不是简化）：`endTurn` 原来直接 `startTurn(g,nextAlive(...))`，现在先调 `advanceXiaoguo(g,mySeat,mySeat)`。`nextXiaoguoAsker(g,endingSeat,current)` 仿 `nextGuicaiAsker` 的"先筛资格再问"：存活+`hasCap(p,'xiaoguo')`+手牌里有基本牌才算候选人，**终止条件 `s===endingSeat` 天然排除"乐进对自己回合结束触发"**（即将结束回合的人永远不会被枚举为候选人）。`advanceXiaoguo` 没人有资格时才真正 `startTurn`；每个候选人发动/不发动之后都会继续 `advanceXiaoguo` 找下一个，理论上支持多个乐进依次触发。发动后弃一张基本牌（校验 `BASIC_CARDS.includes`），进新阶段 `'xiaoguoChoice'`，目标（固定是 `endingSeat` 本人，不需要乐进另选目标）二选一：弃一件装备（仿麒麟弓——每个非空槽各一个按钮，没装备则一个都不渲染，只能选受伤；弃装备触发 `onLoseEquip` 钩子，乐进摸一张）或受到乐进 1 点伤害。**受伤选项可能连锁触发濒死**：`dealDamage` 挂起时手动 patch `g.pending.resume={type:'xiaoguo', endingSeat, lastAsker}`（这次是一次性给全,不是像 `delay` 那样分步补），`finishDying` 新增 `resume.type==='xiaoguo'` 分支，直接 `advanceXiaoguo(g, resume.endingSeat, resume.lastAsker)` 继续找下一个候选人（或最终真正切换回合）——不管目标是否真死，流程都能正确走完。UI 仿鬼才"点入口进选牌模式"：`xiaoguoMode` 下手牌只有基本牌可点（其余灰显）。
- **张郃【巧变】(简化版)**：`caps:{qiaobian:true}`。项目里第一次"移动场上牌"的操作。**关键设计判断：不引入新的服务端阶段/`pending`**——之前铁骑/烈弓/骁果/鬼才那些多阶段流程都是因为需要*另一个玩家*响应；巧变全程只有张郃一人做选择，没有其他玩家需要响应，所以走"客户端逐步累积选择、最后一次性原子提交"这个更轻量的模式（和 `duanLiang`/`playZhangbaSha` 同类），不是过度设计。出牌阶段限一次(`g.qiaobianUsed`，`startTurn`/`normalize` 同款重置防御)，弃一张任意手牌(不限基本牌)后直接 `g.phase='discard'`(这就是"跳过这个阶段"的全部实现，只影响出牌阶段)，可选再移动一张装备/延时锦囊。**"选源/选目标"UI 不是点座位卡片，而是像 `pick`/`qilin` 那样动态列按钮清单**：`qiaobianSources(g)`/`qiaobianTargets(g,src)`（`render.js`）每次渲染现算——来源=所有存活玩家的非空装备槽+判定区每张延时锦囊；目标=排除来源玩家后，装备要求对应槽为空、延时锦囊要求判定区没有同名牌，不合法的目标直接不出现在清单里（不是置灰）。服务端 `qiaoBian(cardIdx, move)`/`doQiaobianMove` **独立重新校验**这些条件，不信任客户端（源槽为空/目标已占用/源即目标等非法情况会被安静拒绝，不报错，`qiaobianUsed`+弃牌+跳阶段已经生效，只是这次没有移动发生）。**装备移动触发 `onLoseEquip`**（和拆装备/换装同性质，源玩家视为失去这件装备，孙尚香会摸两张）；**延时锦囊移动不触发任何钩子**（项目里没有对应的"失去判定牌"事件）。
- **吕布【无双】(锁定技)**：`caps:{wushuang:true}`。"改变响应数量要求"——攻击者是吕布时,目标需要连续两张【闪】才能抵消杀;决斗任一方(发起者或目标)是吕布时,每一轮需要连续两张【杀】才轮到对方。**不引入新阶段/新 UI 结构**，只在现有 `respond`/`duel` 的 `g.pending` 上各加一个计数器：`respondShan` 加 `shanCount`、`duelResponse` 加 `shaCount`，`needed=hasCap(对方,'wushuang')?2:1`（决斗是 `hasCap(from,'wushuang')||hasCap(to,'wushuang')`，任一方是吕布即生效）。打出一张不够时把计数写回 `g.pending`，`phase`/按钮完全不变，只是 hint 文案提示"还需再打出一张"——响应者原地再点一次同一个按钮即可，不需要新的交互流程。选择放弃(不闪/认输)时按原逻辑直接受伤，**已经打出的牌不退回，只按 1 次伤害结算**（不会因为浪费过牌被多扣血）；决斗换人时 `shaCount` 归零重新计数。`needed` 只是每次响应临时算的局部变量，不写进任何全局状态，和吕布无关的杀/决斗 `needed` 恒为 1，行为完全不变。
- **延时锦囊地基（判定区 + 回合开始触发 + 放置框架，三张具体牌尚未实现）**：新增 `player.delays` 数组（判定区，牌对象和手牌同构，`normalize` 里和 `p.hand` 同款防御空数组）+ `DELAY_TRICKS` 空表（`data.js`，name→`{onlySelf, effect(g,seat,judgeCard,card)=>可选返回传给谁的座位号}`，加新牌只需 1) 这里加一项 2) `buildDeck` 加牌，和 `EQUIPS` 同一套约定）。放置走 `delayTrickPlay`（仿 `equipPlay` 的自动注册，`noDiscard:true`+新增的 `allowSelf:true` 标志——`playCard` 默认拒绝自选目标，这个标志给闪电这类"只能选自己"的牌放行），打出时复用 `startTrick` 开无懈窗口（`card` 随 `info`/`pending` 透传：被无懈挡下时 `finishWuxieRound` 把它塞进弃牌堆，未被挡下时 `resolveTrick` 新增的 `DELAY_TRICKS` 分支把它放进目标 `delays`，不立即生效）。回合开始触发统一到新函数 `startTurn(g, seat)`（替换了原来 3 处重复的"切回合"代码：`endTurn`、决斗认输阵亡换人、濒死解决后 `resume.type==='duel'` 换人）——顺序是`g.turn=seat`→`resolveDelayTricks(g, seat)`→`phase='draw'`。`resolveDelayTricks` 按**放置顺序（数组顺序，先放先判）**逐张 `judge(g)` + 调用 `DELAY_TRICKS[name].effect`，返回数字座位号则传给下家（如日后闪电），否则进弃牌堆；未实现的延时锦囊名安全丢弃防卡死。**已知简化点**（判定区数据结构已就位，不是 bug）：① 处理顺序固定"先放先判"，不支持玩家自选顺序；② 判定阶段本身**不开无懈窗口**（放置时的无懈依然生效，但判定区里的牌真正生效前这次不能再被无懈打断）；③ 座位卡片只做了最简判定区显示（装备区下方一行"判定区: 牌名、牌名"，公开信息不脱敏，无延时锦囊时不显示），样式留给以后的 UI 大改版。`render.js` 的选目标 UI 已支持"选自己"（`allowSelf`，见下方闪电）。
- **闪电（第一张延时锦囊，`onlySelf:true`）**：`DELAY_TRICKS['闪电'].effect` 判定黑桃 2~9（精确 `suit==='♠' && rank>=2 && rank<=9`，不含 A/10/J/Q/K，不是笼统的"黑色"——`isRed`/`cardColor` 只分红黑两色，没有精确到花色，这里直接查 `suit`）：命中则 `dealDamage(g,seat,3,undefined,...,'delay')` 3 点无来源伤害、闪电作废；不命中则 `nextAlive(g,seat)` 传给下家（环形顺序，阵亡者不占位）。`sourceSeat` 传 `undefined` 已确认安全：司马懿【反馈】等依赖 `sourceSeat` 的钩子本来就有 `typeof===number` 防御，静默跳过，不报错。**闪电致命时接入濒死求桃**：`dealDamage` 挂起濒死会返回 `true`，此时 `effect` 返回 `'pending'`（一种新的第三态返回值）告诉 `resolveDelayTricks` 立刻停止处理该玩家判定区剩余的牌、把控制权交还（闪电牌本身仍照常进弃牌堆，和是否致命无关）；`startTurn`/`finishDying` 都识别这个 `'pending'` 信号，前者记 `g.pending.resume={type:'delay',seat}` 而不是想当然把 `phase` 定成 `'draw'`，后者新增 `resume.type==='delay'` 分支——真死了换到下一个存活玩家回合（复用 `startTurn`），被桃救回就继续处理该玩家判定区剩余的牌（可能再次挂起，机制天然支持连续多张致命判定）。**顺带修的一个缺口**：`finishDying` 的阵亡弃牌分支之前只弃手牌+装备，没弃判定区（`p.delays` 是在濒死机制做完之后才加的字段），这次一并补上（阵亡时判定区里的牌也弃置进弃牌堆、清空 `delays`）。**已知简化点**（真实规则的进阶细节，第一版先不做）：被无懈可击抵消放置时，闪电现在按通用逻辑直接弃置，不做"直接跳到下家"的特殊规则；传给下家时不检查"下家判定区是否已有闪电"这个边界（真实规则闪电不能传给已有闪电的人，这里暂不判断）。`buildDeck` 里闪电 1 张。
- **乐不思蜀（onlySelf:false，只能放别人判定区）**：`DELAY_TRICKS['乐不思蜀'].effect` 判定颜色(用现有 `isRed`，这次是红/黑两大类，不像闪电要精确花色)：红色=判定失败无效果;黑色=判定成功,跳过该玩家这个回合的出牌阶段。无论红黑,乐不思蜀本身都作废(`effect` 不返回值,`resolveDelayTricks` 默认分支进弃牌堆),不产生伤害、不触发濒死,比闪电简单很多。**"跳过出牌阶段"怎么实现**:摸牌阶段依然要正常摸牌(乐不思蜀只免出牌阶段),而判定发生在 `resolveDelayTricks`(`startTurn` 里,摸牌阶段**开始之前**),这时候还不能直接把 `phase` 切到 `discard`(会连摸牌也跳过去)。所以用一个临时标志位 `g.skipPlay`(布尔,`normalize` 里和 `p.dying` 同款防御),判定成功时由 `effect` 直接置真;真正消费的地方是 `doDraw`(摸完牌、原本要 `phase='play'` 的那一刻)——若 `g.skipPlay` 为真则清掉标志、直接 `phase='discard'`,之后完全走现有弃牌阶段逻辑(超限强制弃、吕蒙【克己】等都不用改)。`buildDeck` 里乐不思蜀 2 张(直接废掉对方一次出牌机会,强度不低，比闪电多、比顺手/拆桥少很多)。
- **兵粮寸断（onlySelf:false，只能放别人判定区）**：`DELAY_TRICKS['兵粮寸断'].effect` 同样判颜色,但和乐不思蜀**影响的阶段相反**:黑色=判定失败,跳过该玩家这个回合的**摸牌**阶段;红色=判定成功,无效果。两张牌字面上都是"黑色触发",容易写混,靠两个**独立**的标志位区分:`g.skipDraw`(兵粮寸断管)、`g.skipPlay`(乐不思蜀管),`normalize` 同款防御。**消费点不同**:`skipPlay` 在 `doDraw`(摸完牌那一刻)消费;`skipDraw` 必须在**摸牌阶段开始前**消费(不然摸牌阶段已经开始,不该再跳),所以抽了一个新的公共函数 `enterDrawPhase(g)`(`startTurn`/`finishDying` 的 `delay`-resume 分支都从"原来直接写 `phase='draw'`"改成调用它)——`skipDraw` 为真则不进 `'draw'`,直接进 `'play'`(不摸牌)。**两张牌同时命中同一玩家的边界**(找到并处理了这个潜在 bug):若只处理 `skipDraw` 直接跳到 `'play'`,那么 `doDraw` 永远不会被调用,`skipPlay` 就没有机会被消费,会变成悬空标志、污染到下一回合。所以 `enterDrawPhase` 在走"跳过摸牌"分支时**顺带检查 `skipPlay`**——两者都命中就一并跳过出牌阶段,直接进 `discard`,两个标志同时清零。无论红黑,兵粮寸断本身都作废(不像闪电那样传给下家),不产生伤害、不触发濒死。`buildDeck` 里兵粮寸断 2 张(和乐不思蜀同一档强度)。

**进行中**：
- 装备系统：数据结构 + 装备进出 + 距离/射程 + 12 种装备牌的特效均已完成（见上，「装备系统」条）；**唯一待做**——主动卸载装备。
- 延时锦囊：闪电/乐不思蜀/兵粮寸断三张牌 + 地基均已完成（见上）。
- **UI 大改版：座位环形布局(进行中,已完成第1~3步)**：座位卡片从"上下堆叠列表"改成"环形牌桌",技术方向是 **CSS Grid 命名区域**而非角度坐标计算(响应式友好,断点只需换 `grid-template-areas` 字符串,不用 JS 算坐标/监听 resize)。**第1步(纯CSS,不改 render.js)**：`.seats` 用 grid + auto-fit 让 `.seat.me` 显式占满第2行(`grid-row:2`)、始终在底部,和 DOM 顺序无关。**第2步(render.js 新增 `seatSlot(n,mySeat,seatIdx)` 纯函数)**：只按"总座位数"(加入顺序,开局后不变)分配槽位,和"是否存活"无关——阵亡只变暗(`.dead`)不挪位置,避免消化"有人死了"时还要处理布局跳动;约定"从我起顺时针(回合顺序)第一个对手在我右侧(`tr`)、第二个在左侧(`tl`)、只有1个对手时居中在正上方(`top`)"。容器按对手数量分 `.opp1`/`.opp2` 两套 `grid-template-areas`(1人局单列居中;2人局左右分列 `"tl tr" "me me"`)。顺带放大了 `.seat.me` 卡片的内部字号/间距(信息量最大,单独优化,不等最后响应式那一步)。**修过一次严重 bug**：`render.js` 用 `seatsEl.className = 'opp'+n` 整体赋值,把静态 HTML 里原有的 `class="seats"` 冲掉了,导致 `.seats.opp2` 这种组合选择器永远匹配不上、grid 从未生效(现象是"完全没有环形效果,退化成最原始的堆叠"，一度怀疑是部署/缓存问题,最后靠 Elements 面板看实际 DOM class 才定位到——教训见「改动原则」第 13 条)；已改成 `seatsEl.className = 'seats opp'+n` 显式保留原 class。**第3步(banner/hint 统一)**：`render()` 里原来独立维护的一份 banner(14 个 phase 分支)和 `renderControls()` 里独立维护的一份 hint(~20 个 phase/mode 分支)两个书写者、经常一个有一个没有——现在 `renderControls()` 是 banner 唯一书写者(新增 `setBanner(html, style)` 小 helper),`render()` 里原来那段并行 banner 代码整体删除。合并原则是**真正合并成一句**，不是分层拼接：banner 原来的"谁对谁/发生了什么"(第三人称、任何人都看得到)+ hint 原来的"你该怎么办"(第一人称、含没有可用牌等兜底提示、吕布【无双】进度计数)，融合成一句话,信息不丢失。顺带补全了三处过去一直是空白 banner 的场景(不是新行为,是修缺口)：`jiedaoChoice`/`wugu`(此前只有 hint 没有 banner)、非当前回合时的普通 draw/play/discard 阶段(此前 banner 完全不覆盖，只有 hint 的"等待 X 行动…")、当前回合但无事可做的默认场景(空闲 draw/discard)。`#hint` 元素和 `.hint` CSS 规则一并删除(没有其它引用者)。**尚未做**：第4步(日志收进 `showInfo` 风格的可展开面板)、第5步(移动端断点精细打磨；已知一处视觉细节留到这一步——宽屏下 `.seat.me` 显得不够宽/边框偏窄)。

**可能的下一步**（待定）：
- 响应超时/托管（修挂机卡死隐患）。
- 装备系统后续（见「进行中」），可解锁更多武将和锦囊。
- 身份场（主公/反贼/内奸）、选将。
- 更多武将。

---
*维护规则：更新"当前进度"不是建议，是「三、改动原则」第 11 条规定的任务收尾硬性步骤，和 git commit 一个存档点同等优先级。*
