# OpenCode 输出截断与思考超时怎么办？

## 现象

使用 OpenCode AI CLI 执行复杂任务时，常遇到：

- AI 代码输出到一半突然停掉（`finish_reason: "length"`）
- AI 一直 "Thinking" 不停，最终死锁或崩溃

## 原因

1. **单次输出 Token 触顶**：输入上下文可达 128k，但单次最大输出通常仅 4k-8k。长代码极易触发硬性截断。
2. **Agent 死循环**：OpenCode 具备自动读文件、跑命令、自调试能力。遇到复杂 Bug 时陷入 "思考-尝试-报错-再思考" 循环，历史上下文急速膨胀，撑爆 Token 上限。

## 解决方案

### 1. 在 `opencode.json` 中调大输出上限

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

### 2. Thinking 超长导致无输出

推理模型在复杂任务上会先 "想" 再 "做"。思考本身消耗输出 Token，极端情况下思考把预算全部吃光，`finish_reason: "length"` 但实际没有任何代码或文本产出，只有一段被截断的 thinking。

| 策略 | 做法 | 原理 |
|------|------|------|
| 调大输出上限 | 修改 `opencode.json` 中 `limit.output` | 给思考和输出都留更多空间 |
| 拆小任务 | 一次只给一个具体小步骤 | 减少需要思考的维度 |
| 给方向而非给问题 | "用方案 A 实现" 而非 "想办法实现" | 跳过探索性思考 |
| 先规划再执行 | 第一步让它只输出计划，确认后再执行 | 把思考和执行拆成两轮 |
| 换非推理模型 | `/models` 切到不带 thinking 的模型 | 直接输出，不消耗思考 Token |

### 3. 应急操作

| 操作 | 命令 | 场景 |
|------|------|------|
| 强制中断 | `Ctrl + C` | AI 陷入报错死循环 |
| 清空上下文 | `/clear` | 会话过长，上下文臃肿 |
| 回滚代码 | `/undo` | 中断后撤销错误改动 |
| 切换模型 | `/models` | 需要长上下文优化的模型 |

## 总结

| 问题 | 根因 | 解法 |
|------|------|------|
| 输出截断 / 无输出 | `limit.output` 太小（默认 4096） | 调大 `opencode.json` 的 `output` 上限 |
| Thinking 吃光 Token | 推理思考过长 | 拆小任务 / 给方向 / 换非推理模型 |
| Agent 死循环 | 上下文急速膨胀 | `Ctrl + C` 中断 + `/clear` 清空 |

> **一句话：** 先在 `opencode.json` 把 `output` 调到 16384+，Thinking 超长就拆小任务或换非推理模型，卡死就 `Ctrl + C` + `/clear` 轻装重来。
