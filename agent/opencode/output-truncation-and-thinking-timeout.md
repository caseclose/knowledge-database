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
Continue from where you were cut off (including your thinking process), do not repeat the previous code.
```

跨文件时用 `@` 锚定：

```
Continue from where you were cut off (including your thinking process) in @filename, do not repeat the previous code.
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

### 5. Thinking 超长导致无输出

推理模型在复杂任务上会先 "想" 再 "做"。思考本身消耗输出 Token，极端情况下思考把预算全部吃光，`finish_reason: "length"` 但实际没有任何代码或文本产出，只有一段被截断的 thinking。

**应对策略：**

| 策略 | 做法 | 原理 |
|------|------|------|
| 调大输出上限 | 修改 `opencode.json` 中 `limit.output` | 给思考和输出都留更多空间 |
| 拆小任务 | 一次只给一个具体小步骤 | 减少需要思考的维度 |
| 给方向而非给问题 | "用方案 A 实现" 而非 "想办法实现" | 跳过探索性思考 |
| 先规划再执行 | 第一步让它只输出计划，确认后再执行 | 把思考和执行拆成两轮 |
| 换非推理模型 | `/models` 切到不带 thinking 的模型 | 直接输出，不消耗思考 Token |

**实操：在 `opencode.json` 中调大输出上限**

OpenCode 命令行没有 `--max-tokens` 参数，输出上限在配置文件中控制：

```bash
# 配置文件路径
~/.config/opencode/opencode.json
```

找到对应 provider 和 model，修改 `limit.output`：

```json
{
  "provider": {
    "coding-plan": {
      "models": {
        "glm-5.2": {
          "limit": {
            "context": 1048576,
            "output": 16384
          }
        }
      }
    }
  }
}
```

> 默认 `output: 4096` 极易触发截断。调到 `16384` 或 `32000`（取决于 API 实际支持的上限）可大幅减少截断。修改后重启 OpenCode 生效。

## 总结

| 问题 | 根因 | 解法 |
|------|------|------|
| 代码输出到一半停掉 | 单次输出 Token 触顶 | 精准续写指令 |
| CLI 崩溃后丢失进度 | 会话中断 | `opencode -c` 断点续传 |
| 一直 Thinking 不停 | Agent 死循环 | `Ctrl + C` 中断 + `/clear` 清空 |
| 大任务必然截断 | 输出上限太小 | 初始 Prompt 分批交卷 |
| Thinking 吃光 Token 无输出 | 推理思考过长 | 调大 `opencode.json` 的 `limit.output` |

> **一句话：** 截断用精准续写指令，崩溃用 `--continue` 续传，大任务提前分批，Thinking 超长就调大 `opencode.json` 的 `output` 上限，卡死就 `Ctrl + C` + `/clear` 轻装重来。
