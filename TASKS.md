# 任务进度追踪

## 李典【恂恂/忘隙】实装任务

### Task 1: 数据注册 + 忘隙受伤侧 + 测试骨架 ✅
- [x] GENERALS.lidian 数据注册（含 caps.xunxun/wangxi + hooks.onDamaged）
- [x] getGeneral lidian
- [x] generalHasCap 检测 xunxun 和 wangxi
- [x] 李典非致命受伤应挂起 wangxiAsk pending
- [x] 非李典不触发 wangxi
- [x] 闪电无来源不触发 wangxi
- [x] 自伤不触发 wangxi
- [x] 致命伤害挂 dying 不挂 wangxiAsk
- [x] amount=2 触发 wangxiAsk 且 amount=2

### Task 2: 忘隙造成侧（非致命）+ dealDamage 接入 ✅
- [x] 李典杀别人（非致命）挂起 wangxiAsk
- [x] amount=2 触发 wangxiAsk 且 amount=2
- [x] 致命伤害挂 dying 不挂 wangxiAsk
- [x] 非李典造成伤害不触发 wangxi
- [x] maybeWangxiSource 实现
- [x] dealDamage 内插入点
- [x] normalize 对 wangxiAsk 防御

### Task 3: 忘隙致死造成侧 + startDying/finishDying ✅
- [x] 李典 killing other 应挂起 wangxiAsk after death resolution
- [x] 李典被杀时不触发 wangxi
- [x] 非李典 killing 不触发 wangxi
- [x] startDying 签名 + resume 携带 sourceSeat/amount
- [x] finishDying 死亡分支插入 wangxiAsk

### Task 4: respondWangxi 统一结算 ✅
- [x] activate=true 时双方各摸 amount 张牌
- [x] death=true 时仅李典摸牌
- [x] activate=false 时 resume 回接
- [x] amount=2 activate=true 时双方各摸 2 张

### Task 5: 恂恂服务端 + normalize ✅
- [x] draw phase Lidian xunxun 应显示最多 4 张牌
- [x] 牌堆少于 4 张时显示所有
- [x] 空牌堆不能触发 xunxun
- [x] respondXunxun 结算正确（获得2张牌，余牌置底）
- [x] normalize 防御 xunxunPick

### Task 6: render.js UI（恂恂按钮 + xunxunPick + wangxiAsk） ✅
- [x] draw 阶段渲染「发动【恂恂】」(deck.length>0)
- [x] renderXunxun 公开亮牌 + keep/bottom 选区 + 确认按钮(仅本人可操作)
- [x] wangxiAsk：本人见发动/不发动；旁观 waitAskBanner
- [x] 客户端状态 resetXunxun 接入单点兜底
- [x] ?v+1（已更新到 122）
- [x] phaseName 添加 xunxunPick 和 wangxiAsk

### Task 7: 语音 + 头像 + 文档收尾 ✅
- [x] SKILL_PINYIN 加 '恂恂':'xunxun'、'忘隙':'wangxi'
- [x] CLAUDE.md 当前进度加李典条目
- [x] TASKS.md 阶段勾选
- [ ] assets/generals/lidian.jpg（用户自备）
- [x] index.html ?v+1（已更新到 122）
- [x] 全量回归 test_lidian.js（已通过）
- [x] 无其他既有测试文件需要回归（当前只有 test_lidian.js）

---

## 已知问题

### 已解决
- [x] Task 5-4 测试失败：respondXunxun 调用方式错误（多传了 g 参数）

### 未解决
- [ ] Task 6: UI 部分未实现（render.js 中的恂恂和忘隙交互界面）

---

## 更新记录

- 2026-07-12: 完成 Task 1-5 所有服务端逻辑及测试
- 2026-07-12: 修复 Task 5-4 测试调用方式问题
- 2026-07-12: 更新 CLAUDE.md 李典条目，?v 从 121 更新到 122
- 2026-07-12: 创建 TASKS.md 任务追踪
