# OpenCode 输出截断与 Thinking 超长怎么办？

> 创建时间：2026-07-13 ｜ 最新更新：2026-07-14

## 现象

使用 OpenCode 执行复杂任务时：

- 代码输出到一半突然停掉（`finish_reason: "length"`）
- 推理模型 Thinking 过长，把输出 Token 全部吃光，没有任何实际产出
- Agent 陷入 "思考-报错-再思考" 死循环，上下文急速膨胀

## 原因

OpenCode 的输出上限默认仅 **4096 tokens**。输入上下文可达 128k 甚至 1M，但单次输出被限制在 4k。长代码、多步推理、Agent 自动调试都极易触顶截断。

推理模型（带 thinking）更严重：思考本身消耗输出 Token，极端情况下思考把 4096 预算全部吃光，`finish_reason: "length"` 但没有任何代码产出。

## 解决方案

### 1. 调大 `opencode.json` 的 `output` 上限（最根本）

命令行没有 `--max-tokens` 参数，输出上限在配置文件中控制：

```bash
~/.config/opencode/opencode.json
```

找到对应 provider 和 model，把 `limit.output` 从 4096 调大：

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

> 调到 `16384` 或 `32000`（取决于 API 实际支持的上限）。修改后重启 OpenCode 生效。

### 2. 控制 Thinking 消耗

调大上限后仍可能不够。以下策略减少思考占用的 Token：

| 策略 | 做法 | 原理 |
|------|------|------|
| 拆小任务 | 一次只给一个具体小步骤 | 减少需要思考的维度 |
| 给方向而非给问题 | "用方案 A 实现" 而非 "想办法实现" | 跳过探索性思考 |
| 先规划再执行 | 第一步只输出计划，确认后再执行 | 把思考和执行拆成两轮 |
| 换非推理模型 | `/models` 切到不带 thinking 的模型 | 直接输出，不消耗思考 Token |

### 3. 应急操作

| 操作 | 命令 | 场景 |
|------|------|------|
| 强制中断 | `Ctrl + C` | AI 陷入死循环 |
| 清空上下文 | `/clear` | 会话过长，上下文臃肿 |
| 回滚代码 | `/undo` | 中断后撤销错误改动 |
| 切换模型 | `/models` | 换长上下文或非推理模型 |

## 总结

| 问题 | 根因 | 解法 |
|------|------|------|
| 输出截断 | `output` 默认仅 4096 | 调大 `opencode.json` 的 `limit.output` |
| Thinking 吃光 Token | 推理思考过长 | 拆小任务 / 给方向 / 换非推理模型 |
| Agent 死循环 | 上下文急速膨胀 | `Ctrl + C` + `/clear` |

> **一句话：** 先在 `opencode.json` 把 `output` 调到 16384+，Thinking 超长就拆小任务或换非推理模型，卡死就 `Ctrl + C` + `/clear` 轻装重来。
