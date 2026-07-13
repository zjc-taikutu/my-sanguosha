# 任务进度追踪

## Phase 1 — Jul 12 回归（pending/伤害/连营/乱武杀）
- [x] dealDamage 后误清 pending 等
- [x] 连营队列 + 乱武 resolveShaUse

## Phase 2 — CLAUDE 对齐（妄尊除外）
- [x] 乱武：删全局 `luanwuTargetMap`，只读 `g.pending.targetMap`
- [x] 不屈：`removeBuquCard` 改 `hasCap(...,'buqu')`
- [x] 神速1：`continueShensu1Check` 放在判定区结算**之前**；`skipShensu1`→`continueDelayResolution`
- [x] 巧变后链路接神速1；`qiaobianSkipJudge` 跳过判定但仍问神速1
- [x] `?v=` → 130；回归全绿

## Phase 3 — 收尾
- [ ] 真机：乱武非发动者看到正确「对 XX 用杀」目标
- [ ] 真机：神速1 在有闪电时先于判定询问
- [ ] commit + push（用户确认后）

### 未做（按你要求）
- 袁术【妄尊】忽略
