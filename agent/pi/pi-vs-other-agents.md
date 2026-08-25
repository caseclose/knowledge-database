# Pi 这个 harness 相对其他 coding agent 差在哪？

> 创建时间：2026-08-25 ｜ 最新更新：2026-08-25 ｜ 标签：面试

Pi（现维护于 [earendil-works/pi](https://github.com/earendil-works/pi)，原 [badlogic/pi-mono](https://github.com/badlogic/pi-mono)）是 Mario Zechner 做的 **MIT 许可、刻意极简的 coding agent harness**。面试里不要把它说成「又一个 Claude Code 开源平替」，它的产品假设相反：**frontier 模型已经被 RL 训成 coding agent 了，harness 每多塞一条工具 schema / 系统提示，都是在烧上下文。**

对照见作者原文：[What I learned building an opinionated and minimal coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)。仓库里已有的 [Claude Code](../claude-code/tool-calling-and-mcp.md)、[OpenCode](../opencode/output-truncation-and-thinking-timeout.md)、[ReAct](../react/react-reasoning-and-acting.md) 是同一类 `while(tool_use)` 循环，差在外壳厚薄。

## 默认就这么瘦

系统提示加工具定义合计 **不到约 1000 token**。默认只有四个工具：

| 工具 | 做什么 |
|------|--------|
| `read` | 读文件（可 offset/limit） |
| `write` | 新建或整文件覆盖 |
| `edit` | 精确 `oldText → newText` |
| `bash` | 同步执行命令（`ls` / `grep` / `find` 也走它） |

可再开只读工具 `grep` / `find` / `ls`（例如 `--tools read,grep,find,ls` 当只读规划）。项目习惯写在 `AGENTS.md`（全局 + 仓库），不靠一大段内置 prompt。

作者明确 **不会做成内置功能** 的东西：MCP、Plan Mode、Todo、子 agent 工具、后台 bash、权限确认。缺的用 **TypeScript extension**（和 agent 同进程、热加载）或「bash 调 CLI + README」补——用到再读文档，而不是一开会话就把 20 个 MCP 工具定义灌进窗口。

## 和常见 harness 比

| 维度 | Pi | Claude Code | OpenCode |
|------|----|-------------|----------|
| 哲学 | 核心接近零，你自己加回来 | 开箱即用的产品 | 开源的「完整产品」 |
| 系统提示 + 工具定义 | ~1K token | 往往上万 token + 一堆内置工具 | 数千 token 量级，功能向 CC 看齐 |
| 模型 | 多 provider，会话中途可切 | 基本锁 Claude 家族 | 多 provider（models.dev / AI SDK） |
| MCP / Plan / 子 agent / LSP | 默认无，extension 或 bash 自建 | 原生 | 原生 |
| 权限 | **YOLO**：文件系统 + 任意命令，无确认 | 默认要确认、有 sandbox / 模式 | allow/ask/deny |
| 会话 | JSONL **树**（fork / rewind / `/tree`） | 线性会话 + compaction 等产品能力 | 线性日志 + undo/redo，client/server |
| 扩展方式 | 进程内 TS，改的是运行时 | hooks / MCP / skills，改的是配置 | plugin / 配置 |
| 界面 | TUI / print / RPC / SDK | CLI + IDE + 桌面 | TUI + 桌面 + Web + IDE + CI |
| 许可 | MIT | 专有 | MIT |

Codex 的工具集同样偏瘦，更接近 Pi 这条线；Claude Code / OpenCode 是「厚外壳」。Pi 还被拿去当别的产品的引擎（例如 OpenClaw 嵌的是 Pi 的 agent loop）。

## 优势（为什么有人故意用更少功能）

1. **上下文税低。** 少注入的那几千 token 每轮都付；小模型 / 本地模型上差距更明显，按 token 计费时也更便宜。
2. **真·可做 context engineering。** 别的 harness 会在背后塞 prompt、compaction、子 agent 摘要，UI 里看不全；Pi 默认几乎不藏。
3. **模型中立 + 中途切换。** `pi-ai` 自己对接四类 API（OpenAI Completions / Responses、Anthropic Messages、Google），不绑一家订阅。
4. **会话是树不是一条线。** 试错可以 fork 一条分支，不必线性 undo 完再重来。
5. **能读完、能改。** 单进程 TypeScript，缺功能就让 Pi 对着自己的源码写 extension，而不是等上游发版。
6. **可观测。** 规划写成 `PLAN.md`、任务写成 `TODO.md`、长任务丢 tmux，过程留在磁盘和终端滚动缓冲里，而不是子 agent 黑盒。

作者的论点是：MCP 的 Playwright 一类能吃掉窗口的 7–9%；子 agent 省上下文的同时丢掉可见性；权限系统在「能读数据 + 能执行 + 能出网」同时成立时大多是安检剧场。所以默认把这些都拿掉。

## 劣势（为什么大多数人日常仍开 Claude Code / OpenCode）

1. **不是开箱日用产品。** 没有 Plan / 权限 / MCP / LSP 诊断 / 子 agent，要自己用 extension 或 CLI 拼；OpenCode 更像「配置一个产品」，Pi 更像「编程一个平台」。
2. **默认不安全。** 从第一条 prompt 起就是全盘访问。要隔离得自己进容器；社区权限系统也是第三方 extension，不是核心。
3. **计费不可控。** 走 API 按量，账单会尖峰；Claude 订阅是可预期的月费。
4. **功能缺口是真缺口。** 后台进程、IDE 诊断闭环、多端同一 session、CI 里开箱的 client/server，Pi 要么没有要么要自建。bash 默认同步，dev server 得靠 tmux。
5. **MCP 生态用不上（官方态度）。** 必须 MCP 时得包成 CLI（如 mcporter）或自己写 extension，迁移成本在你这边。
6. **速度和「完整产品体验」不占优。** 有评测里同模型 Pi 更省 token、通过率略高，但中位耗时更慢；日常「打开就能改 bug」Claude Code 仍更顺。

## 面试怎么收

问「和 ReAct / LangChain 什么关系」：循环一样，都是模型选工具、harness 执行、观察写回。Pi 争的是 **harness 该有多厚**——厚的把产品做全，薄的把上下文和可改性留给你。选哪边取决于你要日用效率还是要拥有运行时。

> **一句话：** Pi 是「四个工具 + 极短系统提示」的 MIT harness，靠少注入上下文、多 provider、会话树和 TS 扩展取胜；代价是没有权限/MCP/Plan/子 agent 等开箱能力，默认 YOLO，更适合愿意自己拼外壳的人，而不是替代 Claude Code 当全员日用。
