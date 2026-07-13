# 任务进度追踪

## Phase 1/3 — 设计文档审核修正
- [x] 确认 `xushu_design.md` / `caozhang_design.md` / `caozhi_design.md` 存在
- [x] 对照当前代码审核并重写三份设计（API/挂点/边界）

## Phase 2/3 — 三武将实装
- [x] 徐庶【无言/举荐】：data + dealDamage + endTurn + skills + UI + 音效
- [x] 曹彰【将驰】：continueEnterDrawPhase + 禁杀/多杀/无距 + UI
- [x] 曹植【落英/酒诗②】：弃牌/判定入口 + 酒诗② + UI（酒诗①暂缓）
- [x] 修 endTurn 骁果挂点（避免误 finishTurn 挡掉结束阶段技能）
- [x] `?v=` 125→126；CLAUDE.md 进度条更新
- [x] 静态回归检查（python，31 项）

## Phase 3/3 — 收尾
- [x] git commit / push（`a43f40c` → `origin/wenwen_dev`）
- [ ] 真机/浏览器联机抽测（无言南蛮、将驰三选一、落英弃梅花、酒诗②翻面）

### 关键成果
- 三个武将数据已入 `GENERALS`
- 无言/举荐/将驰/落英/酒诗②逻辑与 UI 已接入
- 设计文档已与代码对齐

### 下一步
- commit + push 到 `wenwen_dev`
- 联机验证上述关键路径
