# 雌雄双股剑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans.

**Goal:** 实现标准版武器雌雄双股剑（射程2，异性目标可选令弃手牌或己摸1）。

**Architecture:** `cap:'cixiong'`；杀链顺序：流离→铁骑/烈弓→雌雄→仁王/毅重→八卦/闪。两段 pending：`cixiongAsk`（攻）/`cixiongChoice`（目标）。逻辑在 `weapons.js`，挂点改 `game.js`。

**Tech Stack:** 纯静态 JS；vm 回归 `run_cixiong_test.js`。

**Spec:** `docs/superpowers/specs/2026-07-19-cixiong-sword-design.md`

## Global Constraints

- 单目标特效；与方天武器互斥
- 性别用 `generalGender`；弃牌仅手牌
- 仁王须在雌雄之后判定
- `?v=` +1；更新 CLAUDE.md

---

### Task 1: 数据 + 性别 helper + 牌堆

**Files:** `data.js`, `render.js` (CARD_PINYIN)

- EQUIPS 项 + buildDeck `['雌雄双股剑',S,2]` + `isOppositeGender`
- CARD_PINYIN 映射

### Task 2: 杀链重排 + weapons 逻辑

**Files:** `game.js`, `weapons.js`

- 仁王/毅重从 NoLiuli 前段挪到 `proceedAfterCixiong`
- `maybeStartCixiong` / `respondCixiongAsk` / `respondCixiongChoice`
- 铁骑/烈弓收尾接雌雄

### Task 3: UI + normalize + 测试 + 文档

**Files:** `render-controls.js`, `render.js`, `game.js` normalize, `index.html` ?v=, `run_cixiong_test.js`, `CLAUDE.md`
