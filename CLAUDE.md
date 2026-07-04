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
- **所有掉血走 `dealDamage(g, seat, amount, sourceSeat, reason)`**：只负责扣血 + 死亡判定 + 日志，返回是否阵亡。不推进阶段、不判胜负。
- **胜负走 `checkWin(g)`**：存活 ≤1 则置 `over`/`winner`、清 `pending`/`aoe`、记日志，返回 true。
- 标准用法：`dealDamage(...)` → `if(checkWin(g)) return g;` → 否则继续各自的阶段推进。

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

## 四、已知的待优化点（不是 bug，心里有数）

- **响应阶段无超时**：轮到某人响应（出闪/无懈/决斗/AOE）时若挂机或关页面，整局会永久卡死。尚未做超时/托管。
- **手牌非真隐藏**：手牌存在共享状态、数据库读权限全开，会看控制台的人能看到所有人的牌。当前是朋友局，接受此边界。
- **数据库写权限全开**：任何知道房间号的人能改/删数据。朋友局接受。
- **决斗 sourceSeat 不精确**：决斗发起者本人认输受伤时，`dealDamage` 传的 `sourceSeat` 等于受害者自己，导致依赖伤害来源的技能（如司马懿反馈）在该边角不触发。代码里 `duelResponse` 处有注释标注，日后若要精确：发起者受伤传 `pending.to`、目标受伤传 `pending.from`。
- **单文件已较大**（约 1200 行）：再加大型系统（如身份场）时，可考虑拆分为多文件。

## 五、当前进度

**已完成**：
- 基础流程：摸牌/出牌/弃牌三阶段、回合流转、2~3 人可变人数。
- 锦囊：杀、闪、桃、决斗、无中生有、顺手牵羊、过河拆桥、无懈可击（按座位逐个询问、问所有存活玩家不泄露手牌）、南蛮入侵、万箭齐发（群体锦囊，逐目标无懈 + 逐目标响应）。
- 武将（5 个）：张飞【咆哮】、郭嘉【天妒】、孙尚香【枭姬】（真实版：失去装备摸两张，挂 `hooks.onLoseEquip`）、司马懿【反馈】、赵云【龙胆】。
- 架构重构：`dealDamage`/`checkWin` 统一伤害胜负、`CARD_PLAYS`+`playCard` 统一出牌入口。
- 房间清理（结束并清理房间）、重名/重连识别、房间号字符校验。
- 装备系统（部分）：装备区数据结构（`player.equips` 四槽）+ 座位卡片显示 + `normalize` 防御；装备牌可打出进出装备区（`EQUIPS`/`getEquip` + `equipPlay`/`noDiscard`/`equipCard`，同槽替换旧装备进弃牌堆），现有 5 种装备牌（诸葛连弩/丈八蛇矛/八卦阵/的卢/赤兔，均已入 `buildDeck`）。
- 距离系统：`distance`/`attackRange`/`canReachSha` + 出杀 `canTarget` seam。马（的卢 +1、赤兔 −1）与武器射程（连弩 1、丈八 3）真正生效，**只有【杀】受攻击距离限制**，阵亡者不占座位，UI 区分「够得着 / 够不着」。
- 能力来源统一：`hasCap = generalHasCap || equipHasCap`，布尔能力可由武将 `caps` 或装备 `cap` 提供。首个武器特效 **诸葛连弩【无限杀】**（`cap:'unlimitedSha'`）已生效，与张飞【咆哮】共用同一 seam、可叠加、实时失效。
- 武器特效 **丈八蛇矛【两张手牌当一个杀】**（`cap:'twoAsSha'`，走 `hasCap`）已完成：杀的结算抽成共享入口 `resolveShaUse`（普通杀与丈八共用，`shaUsed`/`pending`/`respond`/距离/次数口径不分叉）；「选两张牌」是纯客户端交互（`zhangbaMode`/`zhangbaPicks`，与单张 `selectedCardIdx` 路径互斥并存、不入库），选满两张再点目标，专用 `playZhangbaSha` 结算（两张进弃牌堆后走 `resolveShaUse`）。次数/距离(range3)/目标响应与普通杀完全一致。
- 顺手牵羊/过河拆桥可作用于**装备区**：`pick` 选牌子阶段——目标有多种可拿/拆对象时弹选择、纯手牌走老路径；手牌隐藏（只随机拿/弃、日志不写牌名）、装备公开（可具名选、日志写牌名）。顺手获得的装备进使用者手牌。拆掉的卢/连弩后距离/能力实时失效（反制成立）。
- 阵亡时死者**手牌 + 装备**全部弃置进弃牌堆（在 `dealDamage` 死亡分支，覆盖所有致死来源：不闪/决斗认输/AOE 不出）。牌随重洗回流，牌库不再被抽干；日志手牌只记张数、装备写牌名。**阵亡弃装备刻意不触发 `onLoseEquip`**（死亡结算不发动常规技能，如枭姬）。

**进行中**：
- 装备系统：数据结构 + 装备进出 + 距离/射程 + 诸葛连弩无限杀 + 丈八蛇矛两张当杀 + 顺手/拆桥作用于装备已完成；**待做其余武器/防具特效**——八卦阵（受杀时闪的判定）等，以及主动卸载装备。

**可能的下一步**（待定）：
- 响应超时/托管（修挂机卡死隐患）。
- 装备系统后续（见「进行中」），可解锁更多武将和锦囊（借刀杀人等）。
- 身份场（主公/反贼/内奸）、选将。
- 更多武将。

---
*维护建议：每完成一个功能或重构，更新"当前进度"一节，并 git commit 一个存档点。*
