# 现在的 Agent 设计，主要瓶颈和缺点是什么？

> 创建时间：2026-08-25 ｜ 最新更新：2026-08-25 ｜ 标签：面试

2026 年面试里这题很少再答成「模型不够聪明」。单步推理已经很强，但把模型塞进 [ReAct](../react/react-reasoning-and-acting.md) / `while(tool_use)` 循环、让任务跑几十上百步，失败模式会换一套。可以把这个落差叫 **horizon gap**：单次前向能做的，和长时间可靠做完不是一回事。

先分清三个常被混为一谈的词：

| 词 | 它是谁的属性 | 不是什么 |
|----|--------------|----------|
| **long-horizon** | **任务**：需要多少步、多少决策 | 不是窗口大小 |
| **long-context** | **模型**：一次能 attend 多少 token | 不是跨会话记忆 |
| **long-term memory** | **系统**：信息能否跨步、跨 session 还在 | 不是把历史全塞进窗口 |

窗口加大解决不了长程任务；记忆模块也替代不了「这一步的计划是不是错的」。

## 1. 上下文在烂，不是只在满

硬限制是窗口上限；更早出现的是 **context rot**：token 还没顶满，有效回忆已经掉——早期约束忘掉、重复已做步骤、被工具返回的元数据淹没。企业系统一次 tool 结果就能带大量无关字段；coding agent 则是读文件、测试日志、网页把窗口灌满。

常见对策都有代价：截断丢因果，摘要引入幻觉，compaction 还可能打穿 prompt cache。所以瓶颈在 **context engineering**（决定什么进窗口），不在再买一个更大窗口。相关讨论见 [Claude Code 的 Tool Search](../claude-code/tool-calling-and-mcp.md)（MCP 工具定义本身就能吃掉数万 token）和 [Pi 把 harness 砍到 ~1K](../pi/pi-vs-other-agents.md)。

## 2. 误差会复合，计划错得更早

长程失败里，**子规划错误**往往出现在轨迹前段：第一步拆错，后面每步都在执行一张错地图，局部还能「看起来在干活」。记忆限制和灾难性遗忘会叠加上去：既要记住最初约束，又要消化新观察，注意力预算不够就丢一边。

含义：只 scale 基座模型不够。需要层次化拆解、执行期校验/回滚、以及能把长程约束再捞回来的记忆，而不是更深的 CoT。

## 3. 没有可靠的「做完了吗」

Agent 循环默认相信模型的 `end_turn` / `Finish`。模型会：

- 半成品就宣布成功；
- 用「看起来像做了」的 tool 序列交差；
- 在不可逆环境里把局部错误做成既成事实。

单步任务有标准答案；agent 任务的奖励常常是轨迹末尾一个 pass/fail，**过程没有密集监督**。这和训练侧的 credit assignment 是同一个洞：horizon 越长，outcome-only 信号越没有信息量。

工程上要在 harness 里加验证器（测试、lint、回放、postcondition），不要把「模型说好了」当成终止条件。

## 4. 工具和环境比模型更脏

协议已经从纯文本 ReAct 走到 JSON `tool_use`，parse 失败少了，但环境仍是：超时、部分提交、非幂等写入、schema 漂移、MCP 进程挂掉。模型假设「调了就原子成功」，真实系统不是。

另外，**读私有数据 + 执行代码 + 出网** 同时具备时，prompt injection / Confused Deputy 没有干净解法（Simon Willison 的 dual-LLM 自己也承认很重很丑）。权限 UI 多半挡不住「能写能跑」之后的数据外泄。这是设计约束，不是某个产品没做好。

## 5. 训练与评测都还对不齐「长时间干活」

- **训练**：SFT 模仿短轨迹；RL 需要可验证奖励。真实 agent 轨迹长、奖励稀、且 heavily off-policy（日志里的工具结果不是当前策略打的）。见 [SFT vs RL loss](../../model-training/rl-post-training/sft-vs-rl-loss.md)。
- **评测**：单步 benchmark 涨分，不代表 80 步工作流不漂。任务有路径依赖，失败难复现，leaderboard 和日用相关弱。

所以「换更强模型」和「agent 产品变可靠」只是部分重叠。

## 6. Harness 自己也是瓶颈

外壳太厚：系统提示、工具 schema、子 agent 摘要、自动 compaction，**抢窗口、改模型行为、还不可见**。外壳太薄：权限、LSP、会话持久化、恢复都要你自己补。这是 [Pi vs Claude Code / OpenCode](../pi/pi-vs-other-agents.md) 的分歧，不是谁绝对正确。

[LangChain](../langchain/langchain-intro.md) 的说法仍适用：**Agent = Model + Harness**。2026 年很多事故出在 harness（上下文、终止、权限、可观测），不是出在权重。

## 面试怎么排优先级

按「先死在哪」说，不要背十个并列缺点：

1. **上下文管理**（rot、工具输出、MCP 税）——每一步都在付；
2. **长程复合误差 + 假完成**——任务一长就爆；
3. **环境/工具不可靠 + 安全三元组**——实验室 demo 过不了生产；
4. **稀疏奖励与评测**——训不准、测不准，迭代慢。

> **一句话：** 当前 agent 的主瓶颈不是单步智商，而是有限窗口里的 context rot、长程规划误差复合、缺少可执行的完成判定，外加脏环境/安全和稀疏的训练评测信号；加窗口或换模型只能缓解，harness 怎么管上下文、校验和权限才是设计题本身。
