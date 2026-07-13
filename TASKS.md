# 任务进度追踪

## Phase 1/2 — code review 修复（相对 origin/main）
- [x] 制蛮：多选项暂停伤害；不发动重放伤害
- [x] dealDamage 时序：致命先濒死/不屈；耀武认 isShaName；恩怨延后到存活后
- [x] 仁心 equips/faceup 字段 + cancel 重放 + skip 防循环
- [x] 断肠 skillsLost 真正失效 generalHasCap/hasCap/hooks
- [x] 翻面跳回合 startTurn(nextAlive) 不调 endTurn()
- [x] 志继/不屈 hasCap；神速2 用 g.turn；zhimeng pending 不污染
- [x] 忘隙去掉 hooks 双路径；结束阶段骁果→旋风→举荐→据守链路
- [x] `?v=` 126→127
- [x] 回归脚本 16 项核心断言通过

## Phase 2/2 — 收尾
- [ ] 真机联机抽测：制蛮/耀武火杀/仁心/断肠/翻面/结束阶段举荐
- [ ] commit + push（用户确认后）

### 关键成果
- 审查 9🔴7🟡 中硬 bug 已落地修复
- 结束阶段技能链不再被骁果/旋风截断

### 下一步
- 联机验证后 commit
