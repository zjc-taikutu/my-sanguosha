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

## 四、已知的待优化点（不是 bug，心里有数）

- **响应阶段无超时**：轮到某人响应（出闪/无懈/决斗/AOE）时若挂机或关页面，整局会永久卡死。尚未做超时/托管。
- **手牌非真隐藏**：手牌存在共享状态、数据库读权限全开，会看控制台的人能看到所有人的牌。当前是朋友局，接受此边界。
- **数据库写权限全开**：任何知道房间号的人能改/删数据。朋友局接受。
- **决斗 sourceSeat 不精确**：决斗发起者本人认输受伤时，`dealDamage` 传的 `sourceSeat` 等于受害者自己，导致依赖伤害来源的技能（如司马懿反馈）在该边角不触发。代码里 `duelResponse` 处有注释标注，日后若要精确：发起者受伤传 `pending.to`、目标受伤传 `pending.from`。
- **单文件已较大**（约 1200 行）：再加大型系统（如身份场）时，可考虑拆分为多文件。

## 五、当前进度

**已完成**：
- 基础流程：摸牌/出牌/弃牌三阶段、回合流转、2~3 人可变人数。
- 锦囊：杀、闪、桃、决斗、无中生有（`from===to===mySeat`，同样经 `startTrick`/`resolveTrick` 走无懈询问窗口，摸牌延后到无懈问完才发生）、顺手牵羊、过河拆桥、无懈可击（按座位逐个询问、问所有存活玩家不泄露手牌，**支持无懈可击反制无懈可击、不限层数**，见下）、南蛮入侵、万箭齐发（群体锦囊，逐目标无懈 + 逐目标响应）、**闪电**/**乐不思蜀**/**兵粮寸断**（延时锦囊，见下）。
- 武将（9 个）：张飞【咆哮】、郭嘉【天妒】、孙尚香【枭姬】（真实版：失去装备摸两张，挂 `hooks.onLoseEquip`）、司马懿【反馈】+【鬼才】（已扩展到攻击范围内他人的判定，见下）、赵云【龙胆】、马超【马术】+【铁骑】（见下）、甄姬【洛神】+【倾国】（见下）、张辽【突袭】（见下）、关羽【武圣】（见下）。
- 架构重构：`dealDamage`/`checkWin` 统一伤害胜负、`CARD_PLAYS`+`playCard` 统一出牌入口。
- 房间清理（结束并清理房间）、重名/重连识别、房间号字符校验。
- 装备系统（部分）：装备区数据结构（`player.equips` 四槽）+ 座位卡片显示 + `normalize` 防御；装备牌可打出进出装备区（`EQUIPS`/`getEquip` + `equipPlay`/`noDiscard`/`equipCard`，同槽替换旧装备进弃牌堆），现有 5 种装备牌（诸葛连弩/丈八蛇矛/八卦阵/的卢/赤兔，均已入 `buildDeck`）。
- 距离系统：`distance`/`attackRange`/`canReachSha` + 出杀 `canTarget` seam。马（的卢 +1、赤兔 −1）与武器射程（连弩 1、丈八 3）真正生效，**只有【杀】受攻击距离限制**，阵亡者不占座位，UI 区分「够得着 / 够不着」。
- 能力来源统一：`hasCap = generalHasCap || equipHasCap`，布尔能力可由武将 `caps` 或装备 `cap` 提供。首个武器特效 **诸葛连弩【无限杀】**（`cap:'unlimitedSha'`）已生效，与张飞【咆哮】共用同一 seam、可叠加、实时失效。
- 武器特效 **丈八蛇矛【两张手牌当一个杀】**（`cap:'twoAsSha'`，走 `hasCap`）已完成：杀的结算抽成共享入口 `resolveShaUse`（普通杀与丈八共用，`shaUsed`/`pending`/`respond`/距离/次数口径不分叉）；「选两张牌」是纯客户端交互（`zhangbaMode`/`zhangbaPicks`，与单张 `selectedCardIdx` 路径互斥并存、不入库），选满两张再点目标，专用 `playZhangbaSha` 结算（两张进弃牌堆后走 `resolveShaUse`）。次数/距离(range3)/目标响应与普通杀完全一致。
- 顺手牵羊/过河拆桥可作用于**装备区**：`pick` 选牌子阶段——目标有多种可拿/拆对象时弹选择、纯手牌走老路径；手牌隐藏（只随机拿/弃、日志不写牌名）、装备公开（可具名选、日志写牌名）。顺手获得的装备进使用者手牌。拆掉的卢/连弩后距离/能力实时失效（反制成立）。
- 阵亡时死者**手牌 + 装备**全部弃置进弃牌堆（在濒死解决的 `finishDying` 死亡分支，覆盖所有致死来源：不闪/决斗认输/AOE 不出）。牌随重洗回流，牌库不再被抽干；日志手牌只记张数、装备写牌名。**阵亡弃装备刻意不触发 `onLoseEquip`**（死亡结算不发动常规技能，如枭姬）。
- **濒死求桃机制**：血量 `<=0` 不再立刻死亡，进入濒死（`p.dying`+`g.pending={type:'dying',seat,asking,resume}`），按座位顺序逐个询问是否打出【桃】救援（复用 `nextAskee`，从濒死者本人开始可自救）；`respondDying` 结算，救回则 `finishDying(g,false)`，问完一圈无人救则 `finishDying(g,true)` 才真正阵亡。出杀不闪/决斗认输/AOE 不出三处致死来源统一经 `dealDamage`→`startDying` 挂起，`finishDying` 按 `resume.type` 接回各自被打断的收尾流程（详见「伤害与胜负」一节）。UI 仿无懈可击的"没有可用牌就不渲染按钮"风格，座位卡显示"濒死"角标。
- **无懈可击可被无懈可击反制（不限层数）**：`g.pending`（`type:'wuxie'`）新增 `exclude`（当前这轮不问谁，即刚打出上一次无懈的人）+ `depth`（成功打出无懈可击的总次数）。核心是奇偶校验，不是栈：`depth` 为奇数 = 原锦囊/该 AOE 目标最终作废，偶数（含0）= 正常生效——不需要记录"每一层反制了谁"的历史。`openWuxieRound`（重新计算这轮该问谁，问不到人就直接收尾）与 `finishWuxieRound`（按 `depth` 奇偶收尾：`ctx==='aoe'` 走 `aoeAdvance`/`startAoeRespond`，否则 `pending=null` 或 `resolveTrick`）是新的两个公共函数，`startTrick`/`aoeAdvance`（初始化 `exclude=from,depth=0`）与 `respondWuxie`（出无懈：`depth++,exclude=自己`，重新 `openWuxieRound`；不出：`nextAskee(g,exclude,mySeat)` 推进）都统一走这两个函数。每一层反制都是独立的网络往返（一次 `tx`），不是函数递归调用，没有调用栈风险；层数不设人为上限，天然被"无懈可击牌的供给量有限"这个客观条件封顶。UI banner/hint 按 `depth` 是否 >0 区分措辞（"是否使用【无懈可击】" vs "是否用【无懈可击】反制 XX 的【无懈可击】"）。
- **司马懿【鬼才】（已扩展到攻击范围内他人的判定）**：`caps:{guicai:true}`。统一入口 `maybeGuicai(g, judgedSeat, card, resume)`——判定者自己优先（若有资格：`hasCap(p,'guicai')`+有手牌），否则按座位顺序问攻击范围内其余"有资格"的鬼才拥有者（`nextGuicaiAsker`，判据：存活+`hasCap`+有手牌+`canReachSha(g,候选人,judgedSeat)`，逐座位遍历、绕回判定者自己即问完一圈，和 `nextAskee`/无懈可击同一套环形遍历写法）；没人有资格则不挂起，原样用判定牌结算。**四个判定场景统一接入**：`tryBagua`（八卦阵翻牌，1 处）+ `processOneDelayCard`（闪电/乐不思蜀/兵粮寸断，3 张牌共用同一处）。`g.pending={type:'guicai',seat(判定者),asking(当前问谁,可能≠seat),judgeCard,resume}`；`respondGuicai`"不发动"时用 `nextGuicaiAsker` 推进到下一个候选人（不是直接结算），问完一圈才用原判定牌收尾——和无懈可击"不出→问下一个"同一结构。**resume 加了 `kind` 维度**区分"改判后该怎么消费最终判定牌"：`kind:'bagua'`（沿用原 `resume.type`:`'sha'`/`'aoe'`，走 `finishBaguaColor`，完全不变）、`kind:'delayJudge'`（`{seat,trickName,card}`，重新调 `DELAY_TRICKS[trickName].effect`，处理去向后继续该玩家判定区剩余的牌）。`finishGuicai` 按 `resume.kind` 分派。**延时锦囊判定链条里一个容易踩的坑，已处理**：`resolveDelayTricks` 拆成 `processOneDelayCard`(judge+鬼才窗口)+`finishDelayCard`(消费最终判定牌)+`continueDelayResolution`(统一收尾:`'pending'`时——若新挂起是**濒死**要把 `seat` 补进 `resume`（`dealDamage`/`startDying` 只知道 `srcType` 字符串），若新挂起是**鬼才**则**不能覆盖**它已经自带的完整 `resume`；`'done'`时走 `enterDrawPhase`)，`startTurn`/`finishDying` 的 `delay` 分支/`finishGuicai` 的 `delayJudge` 分支三处共用这个函数，不重复判断。

- **马超【马术】+【铁骑】**：`caps:{extraMinus1:true, tieqi:true}`。**马术**(锁定技)是 `distance(g,from,to)` 里 `from` 方向的额外 -1，和装备的 -1 马(`equipDist`)是两个独立来源、直接相加(`fromMinus1 = equipDist(...) + (hasCap(...,'extraMinus1')?-1:0)`)，纯查表叠加，不需要 `hooks`。**铁骑**是"出杀后攻击者可选是否发动判定,红色则这张杀不可被闪抵消(含视为闪的效果,如八卦阵)"——新增 `'tieqi'` 阶段(`g.pending={type:'tieqi',from,to}`,只有攻击者能响应),原来 `resolveShaUse` 里"设好 pending 后直接走青釭剑/八卦阵/进响应阶段"那段尾巴抽成 `continueShaAfterTieqi(g,from,to,noShan)`——不管没有铁骑、有铁骑但不发动、发动后判黑、发动后判红，最终都走这同一条尾巴，只是 `noShan` 参数不同。`noShan===true` 时**直接跳过 `tryBagua` 调用**(八卦阵连判定的机会都没有,不是"判定了但被无效化"),`respondShan` 加一层服务端兜底(`useShan` 时若 `g.pending.noShan` 直接拒绝),UI 侧"出【闪】"按钮在 `noShan` 时不渲染。铁骑的判定同样接入 `maybeGuicai`(`resume.kind:'tieqiJudge'`，`finishGuicai` 新增对应分支调 `finishTieqiJudge`)，保持"所有判定都能被鬼才改判"这条规则一致，不留特例。
- **甄姬【洛神】+【倾国】**：`caps:{luoshen:true, qingguo:true}`。**洛神**是"回合开始阶段"甄姬自己选择要不要发动的循环判定——和延时锦囊的被动判定不同触发点。接入点在 `continueDelayResolution`(判定区处理完毕后，原本直接调 `enterDrawPhase` 的地方)新插了一步 `continueTurnStart`：轮到的人有洛神就开 `'luoshen'` 阶段(`g.pending={type:'luoshen',seat}`)问要不要发动，没有则照常 `enterDrawPhase`；`startTurn`/`finishDying` 的 `delay` 分支/`finishGuicai` 的 `delayJudge` 分支都经 `continueDelayResolution` 走到这里，不用各自加判断。**循环怎么实现**：不是一次判多张，而是判一张、问一次要不要继续——`finishLuoshenJudge` 黑色时把 `g.pending`/`g.phase` 重新设回同一个 `'luoshen'` 状态，再问一次；红色或玩家主动选择"不再发动"才 `enterDrawPhase`。**判定牌归属的特殊处理**（这是目前唯一一个判定牌不进弃牌堆的场景）：`judge(g)` 本身还是照常把牌推进 `g.discard`，黑色分支里额外从 `g.discard` 里 `splice` 出这张牌再 `push` 进玩家手牌，不能"弃牌堆+手牌各一份"；红色分支什么都不用做，牌已经在弃牌堆里，和其它失败判定一致。洛神的判定同样接入 `maybeGuicai`(`resume.kind:'luoshenJudge'`)。**倾国**是"按颜色而非按名字"的转化，只在 `canUseAs` 加一条 `role==='闪' && hasCap(player,'qingguo') && !isRed(card)`，和赵云【龙胆】按名字转化的判断完全独立、互不干扰；因为 `respondShan`/`aoeRespond`(万箭需要闪)都已经统一走 `canUseAs`/`findUsableAs` 这个 seam，不需要改任何调用点，UI 的 `hasShan` 判断也自动生效。
- **张辽【突袭】**：`caps:{tuxi:true}`。摸牌阶段"放弃摸牌,改为从至多两名其他角色手牌里各摸一张"，新增 `respondTuxi(targets)`(`targets` 是 1~2 个座位号，不含自己、不重复、都要存活；不合法直接不生效)，对每个目标随机拿一张(选到没手牌的目标只记日志、不报错、不阻断其余目标)，结算完 `phase='play'`——和顺手牵羊不同，这是摸牌阶段的替代行为，不是出牌阶段的锦囊，不开无懈可击窗口，同步直接结算。**UI 是新的"1~2个可变数量目标"交互**：客户端 `tuxiMode`/`tuxiPicks`(仿 `zhangbaMode`，纯客户端不入库)，点存活的其他玩家座位切换选中/取消，上限 `min(2,其他存活玩家数)`；和丈八蛇矛"选满 2 张自动可点目标结算"不同，这里数量可变(1或2都合法)，**不能靠"选满自动触发"，必须有独立的"确认发动"按钮**(选够 1 个即可点，不强制选满 2)。入口可见性：其他存活玩家里一个都没手牌时，"发动【突袭】"按钮直接不渲染(和其它"没有可用手段就不渲染"的场景同一风格)。
- **关羽【武圣】**：`caps:{wusheng:true}`。第三种牌的转化规则——`canUseAs` 加一条 `role==='杀' && hasCap(player,'wusheng') && isRed(card)`，和赵云【龙胆】(按名字双向转化)、甄姬【倾国】(按黑色转闪)各自独立、互不覆盖。因为项目里所有"需要杀"的地方（主动出牌的 `CARD_PLAYS['杀'].canPlay`、决斗 `duelResponse`、南蛮入侵 `aoeRespond`、render.js 的目标高亮/actionId 判断）都已经统一走 `canUseAs`/`findUsableAs` 这个 seam，武圣加完这一行就自动覆盖所有场景，不需要碰任何调用点——这正是当初设计这个 seam 的价值。武圣只管"红色手牌能不能被认成杀"，不改变杀本身的其它规则：距离限制(`canTarget`/`canReachSha`)、每回合次数限制(`shaUsed`/`unlimitedSha`)都不受影响，天然照常生效。
- **延时锦囊地基（判定区 + 回合开始触发 + 放置框架，三张具体牌尚未实现）**：新增 `player.delays` 数组（判定区，牌对象和手牌同构，`normalize` 里和 `p.hand` 同款防御空数组）+ `DELAY_TRICKS` 空表（`data.js`，name→`{onlySelf, effect(g,seat,judgeCard,card)=>可选返回传给谁的座位号}`，加新牌只需 1) 这里加一项 2) `buildDeck` 加牌，和 `EQUIPS` 同一套约定）。放置走 `delayTrickPlay`（仿 `equipPlay` 的自动注册，`noDiscard:true`+新增的 `allowSelf:true` 标志——`playCard` 默认拒绝自选目标，这个标志给闪电这类"只能选自己"的牌放行），打出时复用 `startTrick` 开无懈窗口（`card` 随 `info`/`pending` 透传：被无懈挡下时 `finishWuxieRound` 把它塞进弃牌堆，未被挡下时 `resolveTrick` 新增的 `DELAY_TRICKS` 分支把它放进目标 `delays`，不立即生效）。回合开始触发统一到新函数 `startTurn(g, seat)`（替换了原来 3 处重复的"切回合"代码：`endTurn`、决斗认输阵亡换人、濒死解决后 `resume.type==='duel'` 换人）——顺序是`g.turn=seat`→`resolveDelayTricks(g, seat)`→`phase='draw'`。`resolveDelayTricks` 按**放置顺序（数组顺序，先放先判）**逐张 `judge(g)` + 调用 `DELAY_TRICKS[name].effect`，返回数字座位号则传给下家（如日后闪电），否则进弃牌堆；未实现的延时锦囊名安全丢弃防卡死。**已知简化点**（判定区数据结构已就位，不是 bug）：① 处理顺序固定"先放先判"，不支持玩家自选顺序；② 判定阶段本身**不开无懈窗口**（放置时的无懈依然生效，但判定区里的牌真正生效前这次不能再被无懈打断）；③ 座位卡片只做了最简判定区显示（装备区下方一行"判定区: 牌名、牌名"，公开信息不脱敏，无延时锦囊时不显示），样式留给以后的 UI 大改版。`render.js` 的选目标 UI 已支持"选自己"（`allowSelf`，见下方闪电）。
- **闪电（第一张延时锦囊，`onlySelf:true`）**：`DELAY_TRICKS['闪电'].effect` 判定黑桃 2~9（精确 `suit==='♠' && rank>=2 && rank<=9`，不含 A/10/J/Q/K，不是笼统的"黑色"——`isRed`/`cardColor` 只分红黑两色，没有精确到花色，这里直接查 `suit`）：命中则 `dealDamage(g,seat,3,undefined,...,'delay')` 3 点无来源伤害、闪电作废；不命中则 `nextAlive(g,seat)` 传给下家（环形顺序，阵亡者不占位）。`sourceSeat` 传 `undefined` 已确认安全：司马懿【反馈】等依赖 `sourceSeat` 的钩子本来就有 `typeof===number` 防御，静默跳过，不报错。**闪电致命时接入濒死求桃**：`dealDamage` 挂起濒死会返回 `true`，此时 `effect` 返回 `'pending'`（一种新的第三态返回值）告诉 `resolveDelayTricks` 立刻停止处理该玩家判定区剩余的牌、把控制权交还（闪电牌本身仍照常进弃牌堆，和是否致命无关）；`startTurn`/`finishDying` 都识别这个 `'pending'` 信号，前者记 `g.pending.resume={type:'delay',seat}` 而不是想当然把 `phase` 定成 `'draw'`，后者新增 `resume.type==='delay'` 分支——真死了换到下一个存活玩家回合（复用 `startTurn`），被桃救回就继续处理该玩家判定区剩余的牌（可能再次挂起，机制天然支持连续多张致命判定）。**顺带修的一个缺口**：`finishDying` 的阵亡弃牌分支之前只弃手牌+装备，没弃判定区（`p.delays` 是在濒死机制做完之后才加的字段），这次一并补上（阵亡时判定区里的牌也弃置进弃牌堆、清空 `delays`）。**已知简化点**（真实规则的进阶细节，第一版先不做）：被无懈可击抵消放置时，闪电现在按通用逻辑直接弃置，不做"直接跳到下家"的特殊规则；传给下家时不检查"下家判定区是否已有闪电"这个边界（真实规则闪电不能传给已有闪电的人，这里暂不判断）。`buildDeck` 里闪电 1 张。
- **乐不思蜀（onlySelf:false，只能放别人判定区）**：`DELAY_TRICKS['乐不思蜀'].effect` 判定颜色(用现有 `isRed`，这次是红/黑两大类，不像闪电要精确花色)：红色=判定失败无效果;黑色=判定成功,跳过该玩家这个回合的出牌阶段。无论红黑,乐不思蜀本身都作废(`effect` 不返回值,`resolveDelayTricks` 默认分支进弃牌堆),不产生伤害、不触发濒死,比闪电简单很多。**"跳过出牌阶段"怎么实现**:摸牌阶段依然要正常摸牌(乐不思蜀只免出牌阶段),而判定发生在 `resolveDelayTricks`(`startTurn` 里,摸牌阶段**开始之前**),这时候还不能直接把 `phase` 切到 `discard`(会连摸牌也跳过去)。所以用一个临时标志位 `g.skipPlay`(布尔,`normalize` 里和 `p.dying` 同款防御),判定成功时由 `effect` 直接置真;真正消费的地方是 `doDraw`(摸完牌、原本要 `phase='play'` 的那一刻)——若 `g.skipPlay` 为真则清掉标志、直接 `phase='discard'`,之后完全走现有弃牌阶段逻辑(超限强制弃、吕蒙【克己】等都不用改)。`buildDeck` 里乐不思蜀 2 张(直接废掉对方一次出牌机会,强度不低，比闪电多、比顺手/拆桥少很多)。
- **兵粮寸断（onlySelf:false，只能放别人判定区）**：`DELAY_TRICKS['兵粮寸断'].effect` 同样判颜色,但和乐不思蜀**影响的阶段相反**:黑色=判定失败,跳过该玩家这个回合的**摸牌**阶段;红色=判定成功,无效果。两张牌字面上都是"黑色触发",容易写混,靠两个**独立**的标志位区分:`g.skipDraw`(兵粮寸断管)、`g.skipPlay`(乐不思蜀管),`normalize` 同款防御。**消费点不同**:`skipPlay` 在 `doDraw`(摸完牌那一刻)消费;`skipDraw` 必须在**摸牌阶段开始前**消费(不然摸牌阶段已经开始,不该再跳),所以抽了一个新的公共函数 `enterDrawPhase(g)`(`startTurn`/`finishDying` 的 `delay`-resume 分支都从"原来直接写 `phase='draw'`"改成调用它)——`skipDraw` 为真则不进 `'draw'`,直接进 `'play'`(不摸牌)。**两张牌同时命中同一玩家的边界**(找到并处理了这个潜在 bug):若只处理 `skipDraw` 直接跳到 `'play'`,那么 `doDraw` 永远不会被调用,`skipPlay` 就没有机会被消费,会变成悬空标志、污染到下一回合。所以 `enterDrawPhase` 在走"跳过摸牌"分支时**顺带检查 `skipPlay`**——两者都命中就一并跳过出牌阶段,直接进 `discard`,两个标志同时清零。无论红黑,兵粮寸断本身都作废(不像闪电那样传给下家),不产生伤害、不触发濒死。`buildDeck` 里兵粮寸断 2 张(和乐不思蜀同一档强度)。

**进行中**：
- 装备系统：数据结构 + 装备进出 + 距离/射程 + 诸葛连弩无限杀 + 丈八蛇矛两张当杀 + 顺手/拆桥作用于装备已完成；**待做其余武器/防具特效**——八卦阵（受杀时闪的判定）等，以及主动卸载装备。
- 延时锦囊：闪电/乐不思蜀/兵粮寸断三张牌 + 地基均已完成（见上）。

**可能的下一步**（待定）：
- 响应超时/托管（修挂机卡死隐患）。
- 装备系统后续（见「进行中」），可解锁更多武将和锦囊（借刀杀人等）。
- 身份场（主公/反贼/内奸）、选将。
- 更多武将。

---
*维护建议：每完成一个功能或重构，更新"当前进度"一节，并 git commit 一个存档点。*
