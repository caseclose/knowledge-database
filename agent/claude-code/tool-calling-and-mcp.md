# Claude Code 的工具调用模式（tool / MCP）

> 创建时间：2026-08-20 ｜ 最新更新：2026-08-20

Claude Code 的本质是一个 **`while(tool_use)` 的 agentic loop**：模型没有直接操作文件系统和网络的能力，所有「副作用」都通过调用工具完成。理解它就是理解「模型智能」与「真实世界」之间那座唯一的桥——工具系统。

## 核心：agentic loop（谁决定什么）

```
用户输入 ─► 模型推理 ─► 请求 tool_use(工具名, 参数)
                              │
                    harness 权限校验 ─► 执行工具 ─► 回填 tool_result
                              │
                        结果进入上下文 ─► 模型继续 ─► ... ─► 模型 end_turn
```

| 决策 | 由谁定 |
|------|--------|
| 调哪个工具、传什么参数、何时结束(end_turn) | **模型** |
| 能否执行（权限）、如何回填结果、上下文/缓存怎么管 | **harness（Claude Code 本体）** |

harness 是「agentic 外壳」：提供工具、上下文管理、执行环境，把一个语言模型变成能干活的编码 agent。

## 内置工具（built-in tools）

覆盖开发者日常 95% 操作，剩余靠 Bash 兜底：

| 工具 | 作用 |
|------|------|
| `Bash` | 执行 shell（万能适配器：git/gh/curl/docker/jq 都靠它，零额外 token） |
| `Read` / `Write` / `Edit` | 读 / 建 / 精准替换文件（Edit 有 staleness 校验，改前须先 Read） |
| `Glob` / `Grep` | 按模式找文件 / ripgrep 搜内容（取代了 RAG/embedding 检索） |
| `Task`（原 Agent） | 派生子 agent，隔离上下文 |
| `TodoWrite` | 任务清单 |
| `WebFetch` / `WebSearch` | 抓网页 / 搜网络 |

统一的 `Tool` 接口约定每个工具的：执行逻辑、输入 schema（Zod 校验）、安全语义标记（只读/破坏性/可并发）、权限检查、UI 渲染。破坏性工具（Bash/Edit/Write）默认要用户确认。

## MCP：把外部服务接进同一套管线

**MCP（Model Context Protocol）** 是 Anthropic 的开放协议，让 Claude Code 连接外部服务（数据库、GitHub、浏览器、语义检索等）。要点：

- MCP 工具在**运行时动态注册**，与内置工具走**完全相同**的执行管线（校验→权限→执行→回填），模型看来没有区别；
- **代价是 token 开销大**：每个 MCP server 都把工具定义塞进上下文，5 个 server 可能吃掉 ~55K token（约 28% 的 200K 窗口）。

### Tool Search：按需加载缓解开销

当 MCP 工具定义超过上下文的一定比例，Claude Code 只加载轻量 stub（仅工具名），模型真要用某工具时再通过搜索拉取完整 schema，开销可从 ~77K 降到 ~8.7K token。

## 进阶：并行与 Programmatic Tool Calling

- **并行工具调用**：一条 assistant 消息里可发多个 tool_use 块，harness 在无依赖、不冲突时并行执行，加速浏览阶段；
- **Programmatic Tool Calling (PTC)**：模型写代码在容器里编排多个工具调用，中间结果留在代码里，**只有最终输出回到上下文**，省 token。

## 总结

| 层 | 职责 |
|----|------|
| 模型 | 决定调用什么工具、何时收工 |
| Tool 接口 | schema + 权限 + 安全标记，内置/MCP 统一 |
| Executor | 流式、并发执行，回填结果 |
| MCP | 动态注册外部工具，同管线；Tool Search 控 token |

> **一句话：** Claude Code 就是「模型决策 + harness 执行」的 while 循环，所有能力（内置工具与 MCP 外部工具）都通过统一的 Tool 接口暴露、走同一条权限-执行-回填管线，MCP 让它可插拔扩展、并用 Tool Search 控制上下文开销。
