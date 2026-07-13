# 曹彰 武将设计文档

> **审核基准**：对照当前仓库 `data.js` / `game.js` / `skills.js` / `render.js` / `render-controls.js` 真实实现（2026-07-13）。
> 本文只写**可落地**方案，不发明项目里不存在的 API。

## 一、基本信息

| 项目 | 内容 |
|------|------|
| **武将ID** | `caozhang` |
| **武将名称** | 曹彰 |
| **势力** | 魏 |
| **性别** | male |
| **体力上限** | 4 |
| **技能** | 将驰 |

---

## 二、技能说明

### 将驰
**时机**：摸牌阶段开始时（可选）

**效果**（三选一）：
1. **多摸 1 张**，本回合不能**使用或打出**【杀】（含火杀/雷杀，以及当杀使用/打出）
2. **少摸 1 张**，本回合使用【杀】**无距离限制**，且出杀次数 **+1**
3. **不发动**，按正常摸牌数摸牌

**设计要点（对齐本项目）**：
- 摸牌阶段“可选改造”的成熟模式是 `continueEnterDrawPhase` 挂起询问（裸衣/双雄/恂恂），**不要**只改 `doDraw` 而漏掉“摸牌前询问”链路
- 基础摸牌数：`drawPhaseCount(g, seat)` → `2 + generalCapValue(...,'extraDrawPhase',0)`（英姿可叠）
- 状态挂**当前回合玩家私有字段**，不要用全局 `g.jiangchiNoSlash` 污染其他人
- 杀类型统一：`isShaName(name)` / `canUseAs(...,'杀')`
- 距离只改 `canReachSha` 或杀的 `canTarget`，**不要**动顺手/延时锦囊距离
- 出杀次数：本项目是布尔 `g.shaUsed` + `hasCap(...,'unlimitedSha')`，将驰 +1 需要**额外计数**，推荐 `g.jiangchiExtraShaLeft`（本回合剩余额外次数）

---

## 三、数据定义（data.js）

```javascript
caozhang: {
  id: 'caozhang',
  name: '曹彰',
  gender: 'male',
  maxHp: 4,
  skill: '将驰',
  desc: '将驰:摸牌阶段,你可以选择一项:1.多摸1张,本回合不能使用或打出杀;2.少摸1张,本回合使用杀无距离限制且可多使用1张杀;3.不发动。',
  caps: { jiangchi: true }
}
```

注意：字段名是 `skill`（字符串），不是 `skills: []`。

---

## 四、关键 API 约束

| 项目现状 | 错误写法 | 正确写法 |
|----------|----------|----------|
| 武将字段 `skill: '将驰'` | `skills: ['jiangchi']` | `skill: '将驰'` |
| `markSkillSound(g, '将驰')` | `markSkillSound(g, seat, 'jiangchi')` | 中文单参数 |
| 音效 | `SKILL_SOUNDS` | `SKILL_PINYIN['将驰']='jiangchi'` |
| `canReachSha(g, from, to)` 现仅三参 | 假设全项目已有第四参 `card` | 可扩展第四参**可选**，调用方逐步补；或只在 `CARD_PLAYS['杀'].canTarget` 内短路 |
| `g.shaUsed` 是布尔 | 当整数计数用 | 另设 `g.jiangchiExtraShaLeft` |
| 摸牌询问链 | 只改 `doDraw` | 优先挂 `continueEnterDrawPhase`（与裸衣同级） |
| `normalize` 服务端纯函数 | 用 `mySeat` 校验 pending | 只查 `d.seat` / 存活 / 字段形状 |
| 无 `p.marks` 主流体系 | `p.marks.jiangchi_*` | `p.jiangchiNoSlash` / `p.jiangchiNoDistance` 等顶层字段 |

---

## 五、状态字段

### 5.1 玩家字段（本回合效果）

```javascript
// normalize
g.players.forEach(p => {
  if (!p) return;
  if (typeof p.jiangchiNoSlash !== 'boolean') p.jiangchiNoSlash = false;
  if (typeof p.jiangchiNoDistance !== 'boolean') p.jiangchiNoDistance = false;
});
// 全局：本回合将驰赠送的额外出杀次数剩余
if (typeof g.jiangchiExtraShaLeft !== 'number') g.jiangchiExtraShaLeft = 0;

// pending
if (g.pending && g.pending.type === 'jiangchiAsk') {
  const d = g.pending;
  if (!Number.isInteger(d.seat) || !g.players[d.seat] || !g.players[d.seat].alive) {
    g.pending = null;
    if (g.phase === 'jiangchiAsk') g.phase = 'draw';
  }
}
```

### 5.2 回合重置（startTurn）

```javascript
// 与 g.shaUsed=false 同处
g.jiangchiExtraShaLeft = 0;
if (p) {
  p.jiangchiNoSlash = false;
  p.jiangchiNoDistance = false;
}
```

只在 `startTurn` 清，不要在 `endTurn` 清（避免回放/中断路径状态诡异）。

---

## 六、摸牌阶段集成（推荐）

### 6.1 挂起：continueEnterDrawPhase

在 `continueEnterDrawPhase` 里，与裸衣/双雄并列增加将驰分支（**仅当前回合角色有 cap 时**）：

```javascript
function continueEnterDrawPhase(g){
  const seat = g.turn;
  const me = g.players[seat];
  // ... 既有 shuangxiong / luoyi / xunxun ...
  // 建议顺序：先判定“替代摸牌”的技能（双雄/恂恂），再“改摸牌数”的技能（裸衣/将驰）
  // 若同一武将不可能同时拥有，顺序影响不大；曹彰只有将驰。

  if (me && me.alive && generalHasCap(me, 'jiangchi')) {
    g.pending = { type: 'jiangchiAsk', seat, baseDraw: drawPhaseCount(g, seat) };
    g.phase = 'jiangchiAsk';
    g.log = pushLog(g.log, me.name + ' 是否发动【将驰】…');
    return;
  }
  g.phase = 'draw';
}
```

> **不要**在 `doDraw` 里用 `me.marks.jiangchi_noSlash || me.marks.jiangchi_plus` 当“已发动”守卫——那会在效果生效后错误挡住正常摸牌路径；将驰应在询问阶段一次性摸完并进 `play`。

### 6.2 选择：respondJiangchi

```javascript
function respondJiangchi(optionId) {
  // optionId: 'more' | 'less' | 'skip'
  tx(g => {
    if (g.phase !== 'jiangchiAsk' || !g.pending || g.pending.type !== 'jiangchiAsk') return g;
    if (g.pending.seat !== mySeat) return g;
    const me = g.players[mySeat];
    if (!me || !me.alive || !generalHasCap(me, 'jiangchi')) return g;
    const base = Number.isInteger(g.pending.baseDraw) ? g.pending.baseDraw : drawPhaseCount(g, mySeat);

    g.pending = null;
    if (optionId === 'more') {
      me.jiangchiNoSlash = true;
      me.jiangchiNoDistance = false;
      g.jiangchiExtraShaLeft = 0;
      finishDrawPhase(g, mySeat, base + 1);
      g.log = pushLog(g.log, me.name + ' 发动【将驰】:多摸1张,本回合不能使用或打出杀');
      markSkillSound(g, '将驰');
    } else if (optionId === 'less') {
      me.jiangchiNoSlash = false;
      me.jiangchiNoDistance = true;
      g.jiangchiExtraShaLeft = 1; // +1 次出杀额度
      finishDrawPhase(g, mySeat, Math.max(0, base - 1));
      g.log = pushLog(g.log, me.name + ' 发动【将驰】:少摸1张,本回合杀无距离限制且可多出1张杀');
      markSkillSound(g, '将驰');
    } else {
      // 不发动
      me.jiangchiNoSlash = false;
      me.jiangchiNoDistance = false;
      g.jiangchiExtraShaLeft = 0;
      finishDrawPhase(g, mySeat, base);
      g.log = pushLog(g.log, me.name + '：不发动【将驰】');
    }
    return g;
  });
}
```

> 用 `finishDrawPhase` 而不是裸 `drawN` + 手写 `phase='play'`，以复用乐不思蜀跳过、好施、神速等后续链路。

---

## 七、选项 1：禁止使用/打出杀

覆盖面必须是“当杀用/打出”，不只是 `card.name==='杀'`：

1. **`CARD_PLAYS['杀'].canPlay`**
```javascript
if (me.jiangchiNoSlash && g.turn === mySeat) return false;
// 再接原有 canUseAs + shaUsed / unlimitedSha / 天义 等
```

2. **`playZhangbaSha` / `playShaFangtian`**：入口处同样拒绝（它们不走 canPlay）

3. **`duelResponse(useSha=true)`**：若 `g.players[mySeat].jiangchiNoSlash` 且本回合是将驰发动者回合……  
   **注意**：将驰效果只应约束**曹彰自己本回合**。决斗应战者往往不是 `g.turn`。正确条件：
```javascript
const me = g.players[mySeat];
if (useSha && me && me.jiangchiNoSlash) return g; // 有禁杀标记的人不能打出杀
```
   （标记只在曹彰本回合 startTurn 清掉，其他人身上为 false）

4. **`aoeRespond`（南蛮 need==='杀'）**：同上，`me.jiangchiNoSlash` 则不能出杀抵消

5. **`respondJiedao` 出杀**、**`respondQinglong` 追加杀**：同样检查 `jiangchiNoSlash`

6. **UI**：手牌当杀高亮/`hasSha` 类判断同步禁用，避免点了被服务端拒

---

## 八、选项 2：无距离 + 多出一张杀

### 8.1 无距离（只影响杀）

**推荐 A（改动面小）**：仅在 `CARD_PLAYS['杀'].canTarget` 短路：

```javascript
canTarget: (g, me, card, targetSeat) => {
  // ... 智迟/空城/同疾 等既有检查仍要做 ...
  if (me.jiangchiNoDistance && g.turn === mySeat) return true; // 无距离，但仍过空城等
  if (g.tianyiWin && hasCap(me, 'tianyi')) return true;
  return canReachSha(g, mySeat, targetSeat);
}
```

**推荐 B**：扩展 `canReachSha(g, from, to, card?)` 可选第四参；`canTarget`/丈八/方天/借刀 B 校验处传入 card。  
无 card 时行为与现在完全一致。

**禁止**：改 `distance()` 全局返回值——会穿透顺手/兵粮等。

### 8.2 多出 1 张杀（与 g.shaUsed 协作）

当前 `canPlay` 核心：
```javascript
canUseAs(me,card,'杀') && (!g.shaUsed || hasCap(me,'unlimitedSha'))
```

改为（保留天义/无限杀优先）：

```javascript
canPlay: (g, me, card) => {
  if (me.jiangchiNoSlash) return false;
  if (g.tianyiLose && hasCap(me, 'tianyi')) return false;
  if (!canUseAs(me, card, '杀')) return false;
  if (g.tianyiWin && hasCap(me, 'tianyi')) return true;
  if (hasCap(me, 'unlimitedSha')) return true;
  if (!g.shaUsed) return true;
  // 已用过基础 1 次，若将驰还剩额外次数
  if (g.jiangchiExtraShaLeft > 0 && g.turn === mySeat) return true;
  return false;
}
```

`effect` / `playZhangbaSha` / `playShaFangtian` 置位逻辑：

```javascript
if (!(g.tianyiWin && hasCap(me, 'tianyi'))) {
  if (!g.shaUsed) {
    g.shaUsed = true;
  } else if (g.jiangchiExtraShaLeft > 0) {
    g.jiangchiExtraShaLeft--;
  }
}
```

**不要**同时维护互相打架的 `jiangchiShaUsed` + `shaUsed` 双重布尔而不写清消费顺序。  
**无限杀 / 咆哮**：`unlimitedSha` 仍优先，将驰 +1 无意义但无害。

### 8.3 克己

`canSkipDiscard` 继续看 `g.shaUsed` / `g.shaPlayedInDuel`。  
用了将驰额外杀时 `shaUsed` 已为 true，克己正确被破坏。

---

## 九、UI（render-controls.js）

```javascript
if (g.phase === 'jiangchiAsk' && g.pending && g.pending.type === 'jiangchiAsk' && g.pending.seat === mySeat) {
  const base = g.pending.baseDraw || 2;
  // 三个按钮：more / less / skip
  // 文案带 base+1 / max(0,base-1) / base
  return;
}
// 旁观者 banner：等待 XX 发动将驰
```

---

## 十、音效

```javascript
// render.js SKILL_PINYIN
'将驰': 'jiangchi',
```
文件：`assets/audio/jiangchi.mp3`

---

## 十一、边界与测试

| 场景 | 预期 |
|------|------|
| more + 英姿（base=3） | 摸 4，本回合任何杀路径禁用 |
| less + 英姿 | 摸 2，杀无距，可出 2 次杀（非无限） |
| skip | 摸 base，无标记 |
| more 后决斗应战 | 不能出杀 |
| more 后南蛮 | 不能出杀 |
| less 后顺手距离 | **仍受距离 1 限制** |
| less 后火杀/雷杀 | 同样无距、计入次数 |
| 咆哮 + less | 仍无限杀 |
| 空城目标 | less 无距**不能**绕过空城 |
| A 发动将驰 | 不影响 B 出杀 |
| 回合切换 | 标记与 extra 清零 |

---

## 十二、文件改动清单

1. `data.js`：`GENERALS.caozhang`
2. `game.js`：
   - `normalize` / `startTurn`
   - `continueEnterDrawPhase` + `respondJiangchi`
   - `CARD_PLAYS['杀']` canPlay/canTarget/effect
   - 丈八/方天/决斗/AOE/借刀/青龙入口禁杀与次数
3. `render-controls.js`：将驰三选一 UI
4. `render.js`：`SKILL_PINYIN`
5. `test_caozhang.js`

---

## 十三、修正记录（相对旧稿）

1. `skills:[]` → `skill` 字符串  
2. 删除 `p.marks` / 混乱的多套计数方案，统一 `jiangchiExtraShaLeft`  
3. 摸牌挂点改为 `continueEnterDrawPhase` + `finishDrawPhase`，修正 `doDraw` 自锁逻辑  
4. `markSkillSound` / 音效表对齐项目  
5. 无距离只作用于杀目标，保留空城等 `canTarget` 校验  
6. 禁止使用杀覆盖决斗/AOE/转化杀/武器独立入口  
7. `normalize` 禁止依赖 `mySeat`  
8. 删除互相矛盾的“简化方案/精确方案”双轨叙述，只保留一套

*文档状态：已按当前代码审核修正，待实装*  
*审核时间：2026-07-13*
