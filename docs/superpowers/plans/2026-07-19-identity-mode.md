# 身份模式（主公局）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有乱斗局上增加 4~8 人经典身份模式（B 档）：模式选择、发身份、主公+1 血、主公先手、三选一（主公 5 选 1 且选定后全场可见武将）、身份胜负、击杀奖惩、座位身份 UI。

**Architecture:** `g.gameMode = 'ffa'|'identity'` 模式开关；所有新逻辑 `if (g.gameMode !== 'identity')` 走旧路径。数据/配比在 `data.js`，开局选将在 `room-lifecycle.js`，胜负奖惩在 `game.js` 的 `checkWin`/`finishDying`，UI 在 `render-controls.js`/`render.js`/`index.html`。

**Tech Stack:** 纯静态多文件 JS（无构建）；Firebase Realtime Database + `tx()`；vm 沙箱回归测试（`run_*.js`）；`?v=` cache-bust。

**Spec:** `docs/superpowers/specs/2026-07-19-identity-mode-design.md`

## Global Constraints

- 主公局人数 **4~8**；2~3 可点但拦截提示「至少 4 人」
- 主公局 **仅三选一**，不做随机武将
- 主公 **maxHp+1**；主公先手 `startTurn(lordSeat)`
- 主公 5 选 1，选定后 **全场立刻可见主公武将**；他人 3 选 1
- 杀反摸 3；主杀忠弃 **手牌+装备**，**判定区保留**；弃装触发 `onLoseEquip`
- 主死有反→反胜；主死无反有内→内胜；主死无反无内→**无胜者**；反+内灭主活→主忠胜
- **不做主公技**；乱斗行为零回归
- 改 JS/CSS 后四个 `?v=` 同步 +1；完成后更新 CLAUDE.md
- 测试风格：vm 沙箱加载真实源码（参考 `run_lidian_test.js` / 既有 `run_*` 模式）

---

## File map

| File | Responsibility |
|---|---|
| `data.js` | `IDENTITY_TABLE`、`ROLE_LABEL`、`assignIdentities`、`getLordSeat`、`canSeeRole` |
| `game.js` | `normalize` 新字段；`checkWin` 身份分支；`finishDying` 翻身份+奖惩 |
| `room-lifecycle.js` | `startGame` 模式/发身份/主公选将；`respondPickLordGeneral`；`finishGeneralAssign` 主公+1/起手；清理 |
| `render-controls.js` | 大厅模式按钮；主公局仅三选一；`pickingLordGeneral` UI；结束胜方文案 |
| `render.js` | `canSeeRole` 填 `.seat-identity`；主公选将后立绘例外 |
| `index.html` | `.seat-identity.role-*` 配色；`?v=` |
| `run_identity_mode_test.js` | 身份局回归（新建） |

---

### Task 1: 数据层 — 配比表与 helper

**Files:**
- Modify: `data.js`（`MIN_PLAYERS` 附近常量区；`generalMaxHp` 附近导出区）
- Test: `run_identity_mode_test.js`（新建）

**Interfaces:**
- Produces:
  - `IDENTITY_TABLE` — `{4:['zhu','zhong','fan','nei'], 5:[...], ... 8:[...]}`
  - `ROLE_LABEL` — `{zhu:'主公', zhong:'忠臣', fan:'反贼', nei:'内奸'}`
  - `assignIdentities(players)` — 按 `players.length` 洗牌写入 `p.role`；主公 `roleRevealed=true`，其余 `false`；人数不在 4~8 时 no-op
  - `getLordSeat(g)` — `number` 主公座位，找不到 `-1`
  - `canSeeRole(g, viewerSeat, targetSeat)` — `boolean`

- [ ] **Step 1: 写失败测试**

创建 `run_identity_mode_test.js`：

```js
// 最小 vm 加载 data.js 后断言（具体 harness 对齐 run_lidian_test.js：
// fs.readFileSync + vm.Script + 注入 console）
// 1) IDENTITY_TABLE[4] 排序后等于 ['fan','nei','zhong','zhu']（各1）
// 2) n=5..8 主1、内1，忠/反数量符合规格表
// 3) assignIdentities 对 4 人：恰好 1 个 zhu 且 roleRevealed===true；其余 roleRevealed===false
// 4) getLordSeat 返回 zhu 的下标
// 5) canSeeRole：ffa/null mode → false；identity 下主公对任何人 true；自己看自己 true；
//    未翻开他人 false；roleRevealed true 后 true
```

配比期望（写死在测试里）：

```js
const EXPECT = {
  4: {zhu:1, zhong:1, fan:1, nei:1},
  5: {zhu:1, zhong:1, fan:2, nei:1},
  6: {zhu:1, zhong:1, fan:3, nei:1},
  7: {zhu:1, zhong:2, fan:3, nei:1},
  8: {zhu:1, zhong:2, fan:4, nei:1},
};
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node run_identity_mode_test.js`  
Expected: FAIL（`IDENTITY_TABLE is not defined` 或类似）

- [ ] **Step 3: 实现 data.js**

在 `data.js` 的 `MIN_PLAYERS` 后加入：

```js
// 身份局配比（仅 4~8）。数组元素为 role id，开局洗牌后按座位发放。
const IDENTITY_TABLE = {
  4: ['zhu','zhong','fan','nei'],
  5: ['zhu','zhong','fan','fan','nei'],
  6: ['zhu','zhong','fan','fan','fan','nei'],
  7: ['zhu','zhong','zhong','fan','fan','fan','nei'],
  8: ['zhu','zhong','zhong','fan','fan','fan','fan','nei'],
};
const ROLE_LABEL = { zhu:'主公', zhong:'忠臣', fan:'反贼', nei:'内奸' };

function assignIdentities(players){
  const n = (players||[]).length;
  const base = IDENTITY_TABLE[n];
  if(!base) return;
  const roles = [...base].sort(()=>Math.random()-0.5);
  players.forEach((p,i)=>{
    if(!p) return;
    p.role = roles[i];
    p.roleRevealed = (p.role === 'zhu');
  });
}

function getLordSeat(g){
  if(!g || !Array.isArray(g.players)) return -1;
  return g.players.findIndex(p=>p && p.role==='zhu');
}

function canSeeRole(g, viewerSeat, targetSeat){
  if(!g || g.gameMode!=='identity') return false;
  const t = g.players && g.players[targetSeat];
  if(!t || !t.role) return false;
  if(t.role==='zhu') return true;
  if(t.roleRevealed) return true;
  if(viewerSeat===targetSeat) return true;
  return false;
}
```

若项目有 `module.exports` / 测试导出块（`data.js` 末尾），把上述符号一并导出。

- [ ] **Step 4: 跑测试确认通过**

Run: `node run_identity_mode_test.js`  
Expected: PASS（本 task 相关断言全绿）

- [ ] **Step 5: Commit**

```bash
git add data.js run_identity_mode_test.js
git commit -m "feat(identity): 配比表与 canSeeRole/assignIdentities"
```

---

### Task 2: normalize + 大厅模式选择 UI

**Files:**
- Modify: `game.js` — `normalize(g)` 顶部字段防御区（约 L46–80 附近，与 `roundNum` 同级）
- Modify: `render-controls.js` — `!g.started` 大厅按钮块（约 L1634–1657）
- Modify: `index.html` — 若需模式按钮样式可加 class；同步 `?v=`
- Modify: `run_identity_mode_test.js` — 追加 normalize / UI 结构断言

**Interfaces:**
- Consumes: `IDENTITY_TABLE`（本 task 不直接用）
- Produces: `g.gameMode`、`g.winSide`、`p.role`、`p.roleRevealed` 的 normalize 语义；客户端 `selectedGameMode`（`let selectedGameMode=null` 放 `render-controls.js` 顶层状态区）

- [ ] **Step 1: 写失败测试**

追加到 `run_identity_mode_test.js`：

```js
// normalize:
// - 缺 gameMode → 读后为 null（或保持 undefined 被写成 null）
// - gameMode:'identity' 保留
// - gameMode:'bogus' → null
// - player 缺 roleRevealed → false；role 非法 → null
// render-controls 源码结构（字符串检查即可）:
// - 存在 selectedGameMode 或等价模式选择
// - 主公局路径不会无条件暴露「随机武将」给 identity（实现后检查 onclick 条件）
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node run_identity_mode_test.js`  
Expected: FAIL on new assertions

- [ ] **Step 3: normalize**

在 `normalize` 里 `g.players` 初始化之后加入：

```js
if(g.gameMode!=='ffa' && g.gameMode!=='identity') g.gameMode=null;
if(g.winSide!=null && !['fan','nei','lord','none'].includes(g.winSide)) g.winSide=null;
g.players.forEach(p=>{
  if(!p) return;
  if(p.role!=null && !['zhu','zhong','fan','nei'].includes(p.role)) p.role=null;
  if(typeof p.roleRevealed!=='boolean') p.roleRevealed=false;
  // 乱斗防脏数据
  if(g.gameMode!=='identity'){
    // 可选：p.role=null; p.roleRevealed=false;
    // 规格允许 null gameMode 当 ffa；为免旧局脏身份，建议 gameMode!=='identity' 时清空 role
    p.role=null;
    p.roleRevealed=false;
  }
});
```

注意：若 `gameMode` 在开局前为 `null`，清空 role 是对的（大厅无身份）。

- [ ] **Step 4: 大厅 UI**

`render-controls.js` 顶层：

```js
let selectedGameMode = null; // 'ffa' | 'identity' | null
```

替换 `!g.started` 大厅按钮块逻辑要点：

```js
// 1) 两个模式按钮：乱斗 / 主公局，选中高亮，onclick 设 selectedGameMode 并 render(g)
// 2) 若 selectedGameMode===null：随机/三选一 disabled 或 onclick 提示「请先选择对战模式」
// 3) selectedGameMode==='ffa'：随机 + 三选一，disabled = cnt<MIN_PLAYERS
//    onclick: 需让 startGame 知道模式——见 Step 5 接口
// 4) selectedGameMode==='identity'：只渲染「开始游戏(三选一/身份局)」
//    disabled 仅用 cnt 显示，但 onclick 内若 cnt<4 alert('主公局至少需要 4 名玩家') return
//    不渲染随机武将按钮
// 5) banner：主公局提示「主公局需 4~8 人」
```

- [ ] **Step 5: startGame 接收 gameMode**

最小改法（二选一，实现时固定一种并全文一致）：

**推荐 A：** 扩展 `startGame(generalMode, gameMode)`  
- 大厅：`startGame('pick', selectedGameMode)` / `startGame('random', 'ffa')`  
- `startGame` 开头：`if(gameMode!=='ffa' && gameMode!=='identity') return g;` 后 `g.gameMode=gameMode`  
- identity 且 `generalMode!=='pick'` → return  
- identity 且 `players.length<4` → return（双保险）  
- identity 且 `players.length>8` → return（容量已是 8，防御）

**B：** 先写 `g.gameMode` 再 `startGame(mode)` —— 需额外 tx 或客户端先改共享状态，不推荐。

本 plan 采用 **A**。

`startGame` 守卫扩展：

```js
if(g.started || g.phase==='pickingGeneral' || g.phase==='pickingLordGeneral') return g;
if(gameMode==='identity'){
  if(g.players.length<4 || g.players.length>8) return g;
  if(mode!=='pick') return g;
} else {
  if(g.players.length<MIN_PLAYERS) return g;
  if(mode!=='random' && mode!=='pick') return g;
}
g.gameMode = gameMode === 'identity' ? 'identity' : 'ffa';
g.generalMode = mode;
// identity: 先 assignIdentities(g.players)，日志主公名；再进入选将（Task 3）
// ffa: 清空每人 role；走现有 random/pick
```

本 Task 可先实现：**模式写入 + 人数/random 拦截 + ffa 仍走旧选将**；identity 的 `assignIdentities`+主公选将在 Task 3。  
但 identity 点开始若只写 gameMode 不发身份会半残——**Task 2 结束时 identity 点开始应至少 assignIdentities 并进入 Task 3 的 phase，或 Task 2/3 合并提交。**

**本 Task 交付标准：**  
- ffa 开局与现网一致  
- identity + n&lt;4 拦截  
- identity + random 拦截  
- identity + n≥4 + pick：调用 `assignIdentities`，phase 进入 `pickingLordGeneral`（选将 UI 可在 Task 3，但 phase/数据本 task 或 next 必须接上）

为实现可测，**Task 2 末尾必须完成 assignIdentities + 切 5 张主公候选 + phase=pickingLordGeneral**（UI 可在 Task 3 补全，服务端状态要可测）。

主公候选发放：

```js
// identity + pick:
assignIdentities(g.players);
const lord = getLordSeat(g);
const allIds = Object.keys(GENERALS);
const shuffled = [...allIds].sort(()=>Math.random()-0.5);
const LORD_PICK = 5;
const OTHER_PICK = 3;
const n = g.players.length;
const needed = LORD_PICK + OTHER_PICK * (n - 1);
if(shuffled.length < needed){
  // 退化：不放回尽量每人 1 张 general，直接 checkHuashenBeforeAssign
  g.players.forEach((p,i)=>{ p.general = shuffled[i % shuffled.length]; p.generalChoices=null; });
  g.log = pushLog(g.log, '身份模式开启，主公是 '+g.players[lord].name+'（武将不足，已随机分配）');
  checkHuashenBeforeAssign(g);
  return g;
}
// 主公 5 张
g.players[lord].generalChoices = shuffled.slice(0, LORD_PICK);
g.players[lord].general = null;
// 他人暂不发 3 张，等主公选完
g.players.forEach((p,i)=>{
  if(i===lord) return;
  p.generalChoices = null;
  p.general = null;
});
g.phase = 'pickingLordGeneral';
g.log = pushLog(g.log, '身份模式开启，主公是 '+g.players[lord].name+'。请主公选将…');
return g;
```

- [ ] **Step 6: 跑测试**

Run: `node run_identity_mode_test.js`  
覆盖：normalize；startGame identity n=3 no-op；identity random no-op；identity n=4 pick → 有 zhu、phase pickingLordGeneral、主公 choices.length===5

- [ ] **Step 7: Commit**

```bash
git add game.js room-lifecycle.js render-controls.js index.html run_identity_mode_test.js
git commit -m "feat(identity): normalize 与大厅模式选择、发身份开局"
```

---

### Task 3: 主公选将 → 他人三选一 → finishGeneralAssign

**Files:**
- Modify: `room-lifecycle.js` — `respondPickLordGeneral`；`respondPickGeneral`/`debugPickGeneral` 兼容；`finishGeneralAssign`
- Modify: `render-controls.js` — `pickingLordGeneral` / 等待主公 banner；`renderPickGeneral` 跳过已有 general 的主公
- Modify: `render.js` — 主公已选 general 时立绘/武将名在 `!started` 也可显示
- Test: `run_identity_mode_test.js`

**Interfaces:**
- Consumes: `getLordSeat`、`assignIdentities` 结果、`g.phase==='pickingLordGeneral'`
- Produces: `respondPickLordGeneral(generalId)`；`finishGeneralAssign` 内主公 +1 与 `startTurn(lordSeat)`

- [ ] **Step 1: 写失败测试**

```js
// 构造 4 人 identity，手动走到 pickingLordGeneral（或调 startGame）
// setSeat(lord); respondPickLordGeneral(合法 id)
// 断言：
// - 主公 p.general === id，generalChoices null
// - 每个非主公 generalChoices.length === 3
// - 候选与主公武将、彼此不重叠
// - phase === 'pickingGeneral'
// - 渲染条件：主公 general 已定时，canShowLordGeneral 类逻辑为真（可用源码/函数 canSeeLordGeneralArt(g,seat)）
// 非主公全部 respondPickGeneral 后：
// - finishGeneralAssign 路径：started===true
// - 主公 maxHp === generalMaxHp(id)+1，hp 满
// - g.turn === lordSeat
// ffa finishGeneralAssign / startTurn(0) 回归：2 人 random 后 turn===0，无人 +1
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: respondPickLordGeneral**

```js
function respondPickLordGeneral(generalId){
  tx(g=>{
    if(g.phase!=='pickingLordGeneral' || g.gameMode!=='identity') return g;
    const lord = getLordSeat(g);
    if(lord!==mySeat) return g;
    const me = g.players[mySeat];
    if(!me || me.general || !Array.isArray(me.generalChoices) || !me.generalChoices.includes(generalId)) return g;
    me.general = generalId;
    me.generalChoices = null;
    // 主公武将可写日志名：规格允许全场立刻可见
    g.log = pushLog(g.log, me.name+' 选择了武将【'+(GENERALS[generalId]&&GENERALS[generalId].name||generalId)+'】');
    // 剩余池发他人 3 张
    const used = new Set([generalId]);
    // 主公未选中的 4 张回池：应用「已发出的 5 张里去掉选中，其余回可分配池」
    // 最简：从全部 GENERALS 洗牌，排除已选 generalId，再 slice 3*(n-1)
    const rest = Object.keys(GENERALS).filter(id=>id!==generalId).sort(()=>Math.random()-0.5);
    let k = 0;
    g.players.forEach((p,i)=>{
      if(i===lord || !p) return;
      p.generalChoices = rest.slice(k, k+3);
      k += 3;
      p.general = null;
    });
    g.phase = 'pickingGeneral';
    g.log = pushLog(g.log, '请其他玩家选将…');
    return g;
  });
}
```

**池一致性：** 开局已切 5 张给主公时，应用「主公未选的 4 张 + 未发出的牌」组成剩余池，避免主公看过的牌进他人手。实现时保存 `g.lordGeneralPool`（主公那 5 张 id 数组）在 startGame，respond 时：

```js
const leftover = (g.lordGeneralPool||[]).filter(id=>id!==generalId);
const unused = Object.keys(GENERALS).filter(id=>!(g.lordGeneralPool||[]).includes(id));
const rest = [...leftover, ...unused].sort(()=>Math.random()-0.5); // 或保持 leftover 优先
```

`normalize`：`g.lordGeneralPool` 非数组则 `null`；开局结束清空。

- [ ] **Step 4: respondPickGeneral / debugPickGeneral**

- `pickingGeneral` 时主公已有 `general`，`every(p=>p.general)` 仍正确  
- debug：允许 `pickingLordGeneral` 时仅主公 debug 选任意将（可选）；至少 `pickingGeneral` 保持现有  
- startGame 守卫已含 `pickingLordGeneral`

- [ ] **Step 5: finishGeneralAssign**

```js
g.players.forEach((p,i)=>{
  p.maxHp = generalMaxHp(p.general);
  if(g.gameMode==='identity' && p.role==='zhu') p.maxHp += 1;
  p.hp = p.maxHp;
  // ... 其余不变
});
// ...
const startSeat = (g.gameMode==='identity') ? getLordSeat(g) : 0;
if(startSeat<0) startTurn(g, 0); else startTurn(g, startSeat);
g.lordGeneralPool = null;
```

- [ ] **Step 6: UI**

`render-controls.js`：在 `pickingGeneral` 检测**之前**：

```js
if(g.phase==='pickingLordGeneral'){
  if(getLordSeat(g)===mySeat){
    // 复用 renderPickGeneral 结构，但 choices 来自 me.generalChoices（5 张），
    // onclick → respondPickLordGeneral
  } else {
    setBanner('等待主公选将…');
  }
  return;
}
```

`render.js` 座位卡 `avatarReady`：

```js
// 原：g.started && gen
// 新：
const avatarReady = gen && (
  g.started ||
  (g.gameMode==='identity' && p.role==='zhu' && p.general)
);
```

武将名/技能行同样对主公在选将阶段放开（与 avatar 同一条件），避免只出图没有名字。

- [ ] **Step 7: 测试 + Commit**

```bash
node run_identity_mode_test.js
git add room-lifecycle.js render-controls.js render.js game.js run_identity_mode_test.js index.html
git commit -m "feat(identity): 主公5选1与主公+1血起手"
```

---

### Task 4: checkWin 身份胜负 + 死亡翻身份

**Files:**
- Modify: `game.js` — `checkWin`；`finishDying` 死亡分支前段
- Test: `run_identity_mode_test.js`

**Interfaces:**
- Consumes: `p.role`、`g.gameMode`
- Produces: `g.winSide`、`g.winner` 文案；`p.roleRevealed=true` on death

- [ ] **Step 1: 写失败测试**

用最小 g 桩 + 直接调 `checkWin` / 或完整 finishDying：

```js
// helper: mkIdGame(roles, aliveFlags)
// 1) 主活，反内全死 → winSide lord，winner「主公与忠臣」
// 2) 主死，有反活 → fan
// 3) 主死，无反有内 → nei
// 4) 主死，无反无内 → none，winner「无」
// 5) ffa 两人一人死 → 仍按人名（aliveCount<=1）
// 6) finishDying 死后 victim.roleRevealed===true，日志含 ROLE_LABEL
```

- [ ] **Step 2: 跑红**

- [ ] **Step 3: checkWin**

```js
function checkWin(g){
  if(g.gameMode==='identity'){
    const alive = (pred)=> (g.players||[]).some(p=>p && p.alive && pred(p));
    const lordAlive = alive(p=>p.role==='zhu');
    const fanAlive  = alive(p=>p.role==='fan');
    const neiAlive  = alive(p=>p.role==='nei');
    let winSide = null;
    if(!lordAlive){
      if(fanAlive) winSide = 'fan';
      else if(neiAlive) winSide = 'nei';
      else winSide = 'none';
    } else if(!fanAlive && !neiAlive){
      winSide = 'lord';
    }
    if(!winSide) return false;
    g.phase = 'over';
    g.winSide = winSide;
    g.winner = ({fan:'反贼', nei:'内奸', lord:'主公与忠臣', none:'无'})[winSide];
    g.pending=null; g.aoe=null;
    g.log = pushLog(g.log, '游戏结束，胜方：'+g.winner);
    return true;
  }
  // 原 ffa 逻辑不变
  if(aliveCount(g)<=1){
    const w=g.players.find(p=>p&&p.alive);
    g.phase='over'; g.winner = w?w.name:'无';
    g.winSide = null;
    g.pending=null; g.aoe=null;
    g.log=pushLog(g.log, '游戏结束,胜者：'+g.winner);
    return true;
  }
  return false;
}
```

- [ ] **Step 4: finishDying 翻身份**

在 `actuallyDied` 分支 `p.alive=false` 之后、弃牌日志附近：

```js
if(g.gameMode==='identity' && p.role){
  p.roleRevealed = true;
  g.log = pushLog(g.log, p.name+' 的身份是【'+(ROLE_LABEL[p.role]||p.role)+'】');
}
```

奖惩在 Task 5；本 task 先翻身份，再在弃牌/断肠等之后、`resumeAfterInterrupt`/`checkWin` 调用链上保持现有 `checkWin` 调用点即可。

确认 `finishDying` 内现有 `checkWin` 调用仍会执行（搜 `finishDying` 内 `checkWin`）。

- [ ] **Step 5: 结束 UI**

`render-controls.js` `phase==='over'`：

```js
const winText = g.gameMode==='identity'
  ? ('胜方：'+(g.winner||'无'))
  : ('胜者：'+(g.winner||''));
setBanner('🏆 '+escapeHtml(winText)+' · ...', ...);
```

- [ ] **Step 6: 测试 + Commit**

```bash
node run_identity_mode_test.js
git add game.js render-controls.js run_identity_mode_test.js
git commit -m "feat(identity): 身份胜负与死亡翻身份"
```

---

### Task 5: 击杀奖惩

**Files:**
- Modify: `game.js` — `finishDying` 死亡分支，在翻身份之后、`checkWin` 之前
- Test: `run_identity_mode_test.js`

**Interfaces:**
- Consumes: `resume.sourceSeat`（或 finishDying 内等价杀手座位）、`p.role`
- Produces: 摸 3 / 主弃牌副作用

- [ ] **Step 1: 写失败测试**

```js
// 杀反：killer 手牌 +3（控制 deck），日志含摸三
// 主杀忠：主手牌变 []、equips 全 null；delays 仍保留原判定牌
// 主杀忠有装备：onLoseEquip 若主公是孙尚香（调试强行）会摸牌——可选；至少 equips 清空
// 闪电杀主：sourceSeat 非数字，主死走胜负，无人摸 3
// ffa 杀人不摸 3
```

构造方式：尽量走 `dealDamage`→濒死无人救→`finishDying`，或直接调内部若测试困难则抽 `applyIdentityKillReward(g, victimSeat, killerSeat)` 纯函数便于测（推荐抽出，finishDying 调用它）。

```js
function applyIdentityKillReward(g, victimSeat, killerSeat){
  if(g.gameMode!=='identity') return;
  const victim = g.players[victimSeat];
  if(!victim || !victim.role) return;
  const killer = (typeof killerSeat==='number') ? g.players[killerSeat] : null;
  if(!killer || !killer.alive) return;
  if(victim.role==='fan'){
    drawN(g, killerSeat, 3);
    g.log = pushLog(g.log, killer.name+' 杀死反贼，摸三张牌');
    return;
  }
  if(victim.role==='zhong' && killer.role==='zhu'){
    // 弃手牌
    if((killer.hand||[]).length){
      g.discard.push(...killer.hand);
      killer.hand = [];
    }
    // 弃装备并 onLoseEquip
    let lost = 0;
    EQUIP_SLOTS.forEach(s=>{
      const card = killer.equips && killer.equips[s];
      if(card){
        g.discard.push(card);
        killer.equips[s] = null;
        lost++;
      }
    });
    if(lost) triggerHook(g, killerSeat, 'onLoseEquip', {count:lost});
    // 判定区保留 — 不要动 killer.delays
    g.log = pushLog(g.log, killer.name+' 误杀忠臣，弃置所有手牌和装备');
  }
}
```

杀手座位：从 `resume.sourceSeat` 读取（与断肠一致）。若 `dealDamage` 未把 sourceSeat 放进 dying resume，先核对 `startDying`/`continueDelayResolution` 补全逻辑，**identity 奖惩与断肠同一 sourceSeat 来源**。

- [ ] **Step 2: 跑红 → 实现 → 跑绿**

- [ ] **Step 3: 处理 onLoseEquip 打断**

若 `triggerHook` 挂起旋风等 pending：与规格一致，主公仍存活应允许挂起。此时 `finishDying` 后续 `checkWin` 仍应执行（胜负优先）还是等旋风？  

**规格未写打断顺序。实现约定：**  
1. 先翻身份  
2. `applyIdentityKillReward`（可能挂起 pending）  
3. 若 `checkWin(g)` 为 true → 游戏结束，可清 pending（终局优先）  
4. 若未终局且 reward 挂起了 pending → `finishDying` 应 `return` 不 `resumeAfterInterrupt`，等旋风结束再 resume  

实现时读现有 `finishDying` 尾部：若 reward 导致 `g.pending` 变化，采用：

```js
const pendingBefore = g.pending;
applyIdentityKillReward(...);
if(checkWin(g)) return;
if(g.pending !== pendingBefore && g.pending) return; // 钩子接管
// 否则原 resumeAfterInterrupt
```

把此约定写进代码注释。

- [ ] **Step 4: Commit**

```bash
git add game.js run_identity_mode_test.js
git commit -m "feat(identity): 杀反摸三与主杀忠弃牌"
```

---

### Task 6: 座位身份 UI + 清理路径

**Files:**
- Modify: `render.js` — `.seat-identity` 填充
- Modify: `index.html` — `.seat-identity.role-zhu` 等样式；`?v=` +1
- Modify: `room-lifecycle.js` — `newGame` / 回大厅相关清空 `gameMode`/`winSide`/`role`
- Test: `run_identity_mode_test.js`（结构/字符串 + 可选 jsdom 无）

**Interfaces:**
- Consumes: `canSeeRole`、`ROLE_LABEL`

- [ ] **Step 1: 样式**

```css
.seat-identity.role-zhu{ background:#b08d4f; color:#fff; /* 金 */ }
.seat-identity.role-zhong{ background:#c45c26; color:#fff; }
.seat-identity.role-fan{ background:#3d7a4a; color:#fff; }
.seat-identity.role-nei{ background:#4a5a6a; color:#fff; }
/* 有内容时取消 :empty 隐藏——用文本「主/忠/反/内」单字 */
```

显示单字：主/忠/反/内（与势力块类似，满文可 title）。

- [ ] **Step 2: renderSeatCard**

```js
let identityHtml = '<div class="seat-identity"></div>';
if(g.gameMode==='identity' && p.role && canSeeRole(g, mySeat, seatIndex)){
  const ch = {zhu:'主',zhong:'忠',fan:'反',nei:'内'}[p.role];
  identityHtml = '<div class="seat-identity role-'+p.role+'" title="'+escapeHtml(ROLE_LABEL[p.role]||'')+'">'+ch+'</div>';
}
```

- [ ] **Step 3: newGame / 开局清理**

`newGame`：

```js
g.gameMode=null; g.winSide=null; g.lordGeneralPool=null;
g.players.forEach(p=>{ p.role=null; p.roleRevealed=false; ...});
```

注意：现有 `newGame` 会随机 general 并直接可再开——保持；模式回大厅重选。

- [ ] **Step 4: 帮助文案（可选一句）**

`showHelp` 或帮助面板增加一句：身份模式界面按标准隐藏（主公公开、自己可见、死后翻开）；数据库仍全开，与手牌策略相同。

- [ ] **Step 5: `?v=` +1**

`index.html` 里 `config.js` / `data.js` / `game.js` / `render.js`（及已拆分的 render-* / room-lifecycle / skills / weapons 若带 `?v=`）全部同步 +1。

- [ ] **Step 6: 测试 + Commit**

```bash
node run_identity_mode_test.js
# 另跑既有冒烟（若有）: node run_lidian_test.js
git add render.js index.html room-lifecycle.js run_identity_mode_test.js
git commit -m "feat(identity): 座位身份显示与局后清理"
```

---

### Task 7: 全量回归 + CLAUDE.md 收尾

**Files:**
- Modify: `CLAUDE.md` — 身份场从待做移到已完成；主公技仍待做；帮助/模式说明
- Modify: `run_identity_mode_test.js` — 补齐规格 §10 场景清单缺口
- Test: 全套可跑的 `run_*.js` / `test_*.js`

- [ ] **Step 1: 对照规格测试表补洞**

确认 `run_identity_mode_test.js` 覆盖规格 §10：

| # | 场景 | 对应断言 |
|---|---|---|
| 1 | ffa 2 人 | 有 |
| 2–3 | 4~8 配比 | Task1 |
| 4 | n=3 拦截 | Task2 |
| 5–6 | 主公+1 / turn | Task3 |
| 7–10 | 胜负四分支 | Task4 |
| 11–13 | 奖惩/闪电 | Task5 |
| 14–15 | 翻身份/canSeeRole | Task1+4 |
| 16 | 主公5选1+立刻可见 | Task3 |
| 17 | newGame 清理 | Task6 |
| 18 | identity 禁 random | Task2 |

缺哪个补哪个。

- [ ] **Step 2: 跑全量**

```bash
node run_identity_mode_test.js
node run_lidian_test.js
# 仓库内其它 run_*/test_* 能跑的都跑一遍，记录与 identity 无关的既有 flaky
```

Expected: identity 套件全绿；ffa 相关不回归。

- [ ] **Step 3: 更新 CLAUDE.md**

- 「可能的下一步 / 身份场」→ 已完成 B 档，链到规格文档路径  
- 写清：乱斗/主公局、4~8、主公+1、奖惩（判定区保留）、主公5选1可见武将、无主公技  
- 主公技仍列待做  
- `checkWin` / `finishDying` / `startGame` 行为变更各一句  

- [ ] **Step 4: 最终 commit + push（按项目惯例，测试通过后）**

```bash
git add CLAUDE.md run_identity_mode_test.js
git commit -m "docs: CLAUDE 记录身份模式 B 档完成"
git status
# push 需用户环境网络；测试确认后再 push
```

---

## Spec coverage checklist（自检）

| 规格条目 | Task |
|---|---|
| gameMode ffa/identity | 2 |
| IDENTITY_TABLE 4~8 | 1 |
| assignIdentities / roleRevealed | 1–2 |
| 主公 maxHp+1 | 3 |
| 主公起手 | 3 |
| 主公局仅 pick、禁 random | 2 |
| 主公 5 选 1 → 他人 3 | 3 |
| 主公选定立刻可见武将 | 3 |
| checkWin 四分支含无胜者 | 4 |
| 死亡翻身份 | 4 |
| 杀反摸 3 | 5 |
| 主杀忠弃手牌+装备、判定区保留 | 5 |
| canSeeRole + 座位 UI | 1,6 |
| newGame 清理 | 6 |
| 乱斗零回归 | 2–5 各含 ffa 对照 |
| 不做主公技 | 全 plan 无主公技任务 |
| CLAUDE / ?v= | 6–7 |

## 风险备忘（实现时）

1. `startGame(generalMode, gameMode)` 双参数勿与旧单参数调用点遗漏（全项目 grep `startGame(`）  
2. `finishDying` 内 `resume.sourceSeat` 与断肠同源  
3. 主杀忠 `onLoseEquip` 可能挂起旋风：终局 `checkWin` 优先  
4. `avatarReady` 主公例外勿让非主公选将期泄图  
5. `normalize` 在 `gameMode!=='identity'` 清空 role，避免 ffa 脏身份  

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-07-19-identity-mode.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans, batch + checkpoints  

Which approach?