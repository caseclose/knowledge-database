# OpenCode 输出截断与思考超时怎么办？

## 现象

使用 OpenCode AI CLI 执行复杂任务时，常遇到：

- AI 代码输出到一半突然停掉（`finish_reason: "length"`）
- AI 一直 "Thinking" 不停，最终死锁或崩溃

## 原因

1. **单次输出 Token 触顶**：输入上下文可达 128k，但单次最大输出通常仅 4k-8k。长代码极易触发硬性截断。
2. **Agent 死循环**：OpenCode 具备自动读文件、跑命令、自调试能力。遇到复杂 Bug 时陷入 "思考-尝试-报错-再思考" 循环，历史上下文急速膨胀，撑爆 Token 上限。

## 解决方案

### 1. 代码截断续写（TUI 模式）

代码吐到一半停下时，**不要只回 "继续"**，用精准英文指令续写：

```
Continue from where you were cut off, do not repeat the previous code.
```

跨文件时用 `@` 锚定：

```
Continue from where you were cut off in @filename, do not repeat the previous code.
```

### 2. 崩溃后断点续传（CLI 模式）

CLI 死锁或崩溃退出后，无需重开对话，直接接续上一次会话：

```bash
opencode --continue   # 简写 opencode -c
```

续接指定历史会话（先 `opencode session list` 查看 ID）：

```bash
opencode --session <Session_ID>
```

### 3. 大任务分批交卷

复杂宏观任务（如重构整个模块）不要等它一口气写完，在初始 Prompt 中规定分段：

```
帮我重构整个接口。因为代码非常长，请你先写前 50 行。写完后停下来，等我回复"继续"后，再输出接下来的部分。
```

### 4. 自救三板斧

| 操作 | 命令 | 场景 |
|------|------|------|
| 清空历史上下文 | `/clear` | 会话过长，上下文臃肿 |
| 强制中断 | `Ctrl + C` | AI 陷入报错死循环 |
| 回滚代码 | `/undo` | 中断后撤销错误改动 |
| 切换模型 | `/models` | 需要长上下文优化的模型 |

也可在 `config.toml` 中显式调整单次输出上限（`limit`），选用支持长输出的编程模型。

## 总结

| 问题 | 根因 | 解法 |
|------|------|------|
| 代码输出到一半停掉 | 单次输出 Token 触顶 | 精准续写指令 |
| CLI 崩溃后丢失进度 | 会话中断 | `opencode -c` 断点续传 |
| 一直 Thinking 不停 | Agent 死循环 | `Ctrl + C` 中断 + `/clear` 清空 |
| 大任务必然截断 | 输出上限太小 | 初始 Prompt 分批交卷 |

> **一句话：** 截断用精准续写指令，崩溃用 `--continue` 续传，大任务提前分批，卡死就 `Ctrl + C` + `/clear` 轻装重来。
