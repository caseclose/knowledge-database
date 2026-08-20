# GUI Agent 研究进展：从坐标定位到长程计算机使用

> 创建时间：2026-07-16 ｜ 最新更新：2026-07-16

> 本文整理截至 2026 年 7 月公开论文、项目主页与厂商资料中的 GUI Agent（Computer-Use Agent）进展，重点关注 GUI Grounding 与真实任务执行。产品宣传中的未独立复现数字不作为统一排行榜结论。

## 背景

GUI Agent 通过截图、DOM 或 Accessibility Tree 观察界面，再输出鼠标键盘动作，例如 `click`、`type`、`scroll` 和 `drag`。其中 GUI Grounding 是把自然语言指令映射到具体界面元素、动作和坐标的能力。

早期任务往往是“截图 + 短指令 → 目标坐标”。真实软件中的指令却可能是高层意图，目标控件也可能很小、相似、没有文字，且隐藏在多窗口、滚动区域或专业工具栏中。因此 Grounding 已经不只是坐标回归，而是一个组合问题：

```text
用户意图 → 指令细化 → 候选区域 → 局部精定位 → 动作参数化 → 状态验证
```

## 与 H2L-G1 的对应关系

H2L-G1 针对 GUI Agent 中两类互补失败设计了工具增强方案：

- **High2Low Instruction**：将模糊的 high-level 指令改写为描述目标控件、文本和空间关系的细粒度指令，解决意图理解和指代歧义。
- **High2Low Resolution**：先用 patch 网格进行粗定位，再局部放大并回归相对坐标，解决高分辨率、密集 UI 下的小目标偏移。

因此，这项工作的更准确定位不是“点击坐标模型”，而是：

> 将用户高层意图转换为可定位的视觉目标，再通过多尺度局部视觉处理生成可靠动作与全局坐标。

该思路可以表示为：

```text
高层用户意图
      ↓
High2Low Instruction
      ↓
细粒度语义目标与操作关系
      ↓
High2Low Resolution
      ↓
Patch 粗定位 + 局部放大
      ↓
动作与全局坐标
      ↓
GUI Agent 执行与验证
```

页面中的 H2L-G1 结果为 ScreenSpot 平均准确率从 83.3 提升到 90.6，ScreenSpot-Pro 从 17.8 提升到 37.3。后者更能体现高分辨率专业软件场景的价值。

## 近期关键进展

### 1. Grounding 基准从短指代扩展到复杂操作

2025 年 NeurIPS 论文 **Scaling Computer-Use Grounding via User Interface Decomposition and Synthesis** 发布了 OSWorld-G 和 JEDI：

- OSWorld-G 包含 564 个精细标注样本，覆盖 Text Matching、Element Recognition、Layout Understanding 和 Fine-grained Manipulation。
- JEDI 是约 400 万条的计算机使用 Grounding 数据集，通过 UI 分解和多视角任务合成构造训练样本。
- 论文报告称，JEDI 训练的模型在 ScreenSpot-v2、ScreenSpot-Pro 和 OSWorld-G 上提升，并将通用基础模型在 OSWorld 上的结果从约 23% 提升到约 51%。具体数字应以论文对应实验设置为准，不能与不同版本、不同 agent scaffold 的结果直接横比。

核心趋势是：Grounding 开始显式建模软件常识、布局关系、元素类型和细粒度操作，而非只学习“文字到坐标”的映射。

### 2. 多尺度定位成为高分辨率界面的常用路线

在 CAD、IDE、图像编辑、视频编辑和电子表格等专业应用中，目标元素通常很小，整图直接回归坐标容易受到分辨率、缩放比例、窗口布局和相似控件的影响。典型流程是：

1. 在完整屏幕上识别窗口、面板或候选 patch；
2. 对候选区域裁剪、放大或重新编码；
3. 在局部区域确认元素语义和空间关系；
4. 输出局部坐标并映射回全局坐标；
5. 执行动作后观察状态变化并验证结果。

这与 H2L-G1 的 High2Low Resolution 直接对应。局部放大不是简单增加输入像素，而是将有限的视觉计算集中到更可能包含目标的区域。

### 3. 系统架构从端到端模型转向模块化 Agent

当前较可靠的系统通常由多个模块组成：

| 模块 | 主要职责 |
|------|----------|
| Planner | 将用户任务拆成子目标，决定下一步策略 |
| Instruction Rewriter | 把高层意图转为可执行、可定位的指令 |
| Grounder | 识别元素、坐标、动作类型及参数 |
| Executor | 执行鼠标、键盘、滚动和拖拽动作 |
| Verifier | 检查动作是否带来预期状态变化 |
| Memory | 记录页面状态、历史动作和失败原因 |
| Safety Layer | 对登录、支付、删除、发送等高风险动作进行拦截或人工接管 |

模块化的价值在于可以分别训练和诊断：定位错了是 Grounder 问题，动作后状态判断错了是 Verifier 或 Memory 问题，任务路径不合理则是 Planner 问题。

### 4. 评测从单应用短任务转向跨平台、长程协作

**MMBench-GUI** 将能力分成四级：

- L1：GUI Content Understanding；
- L2：GUI Element Grounding；
- L3：GUI Task Automation；
- L4：GUI Task Collaboration。

它覆盖 Windows、macOS、Linux、Android、iOS 和 Web，并提出 Efficiency–Quality-Aware（EQA）指标，同时考虑任务质量和动作冗余。研究结论指出，精确 Grounding 是任务成功的重要决定因素，但即使最终成功，Agent 仍经常执行大量多余动作；复杂跨应用任务还暴露出规划、记忆和自适应推理问题。

**WindowsWorld** 更强调专业工作流和跨应用过程。其公开摘要报告了 181 个任务，平均约 5 个子目标，约 78% 的任务天然涉及多个应用。领先 Agent 在多应用任务上的成功率低于 21%，涉及三个及以上应用的条件判断尤其困难。这说明真实瓶颈已经从“点中一个按钮”扩展为：

- 追踪长期任务状态；
- 判断前一步是否真正成功；
- 在应用之间传递中间结果；
- 根据弹窗、加载和异常进行重规划；
- 控制动作数量并及时停止。

### 5. 截图路线与结构化 UI 路线逐渐融合

GUI Agent 主要有两种观察方式：

- **视觉路线**：只依赖截图，通用性好，适合远程桌面、Canvas 和结构不可访问的应用，但小目标和隐藏状态更难处理。
- **结构化路线**：使用 DOM、Accessibility Tree 或 UI hierarchy，元素文本、类型、层级和边界更明确，但依赖应用是否暴露结构化信息。

工程上更现实的是混合路线：浏览器和标准桌面控件优先使用 DOM 或 Accessibility Tree，结构化信息不完整时用视觉模型补充，最后统一映射为可执行动作。

输入也从单张截图逐渐扩展为：

- 当前截图；
- OCR 结果；
- UI tree；
- 历史截图和动作；
- 当前任务状态；
- 可执行动作集合；
- 应用领域知识。

### 6. 训练从单步监督扩展到轨迹优化

训练数据通常经历三个阶段：

1. **单步监督**：预测元素、坐标、动作类型和指令改写结果；
2. **轨迹级训练**：在模拟 GUI 环境中执行完整任务，利用子目标和最终成功信号优化；
3. **验证与反思**：根据动作后的界面变化判断是否成功，必要时重新定位或规划。

奖励设计也从单一的最终成功率扩展到坐标命中、子目标完成、动作数量、错误操作、危险状态和人工接管等信号。真正部署时，Verifier 往往和 Grounder 同样重要，因为“坐标命中”不等于“任务状态已经正确改变”。

## 厂商路线概览

| 路线 | 代表系统 | 特点 |
|------|----------|------|
| 浏览器/视觉 Computer Use | OpenAI Operator / ChatGPT agent | 通过截图和鼠标键盘完成浏览器任务，强调通用任务执行 |
| Tool-based Computer Use | Anthropic Computer Use | 将计算机、文本编辑和 Bash 等能力作为工具接入，通常需要隔离 VM 或容器 |
| 多环境 Computer Use | Google Gemini Computer Use / Project Mariner | 面向浏览器、移动端和桌面控制，支持客户端执行模型生成的 UI action |
| 开源 Grounding | OSWorld-G、JEDI、ScreenSpot 系列 | 聚焦可复现的元素定位、操作理解和数据规模化 |

不同产品的 benchmark 结果受模型版本、提示词、浏览器环境、工具实现和任务集合影响，不能直接把厂商宣传数据当成统一排行榜。研究比较应优先查看原论文、官方仓库和固定评测协议。

## 仍未解决的问题

### 长程状态管理

Agent 能完成前几步，不代表能完成几十分钟后的最终目标。需要更好的状态摘要、任务记忆和失败恢复机制。

### 跨应用规划

从浏览器复制信息到表格，再写入文档，要求 Agent 同时维护多个应用的状态、权限和数据格式，当前仍明显不可靠。

### 坐标泛化

窗口大小、屏幕分辨率、DPI、主题和字体变化都会影响坐标。屏幕坐标、窗口相对坐标和元素相对坐标的联合表示值得继续研究。

### 动态界面与不确定反馈

页面加载、滚动、弹窗、刷新和网络异常都会改变可操作状态，Agent 必须建模 action 后的状态转移，而不是把 GUI 当作静态图像。

### 安全与 Prompt Injection

网页中的文字可能诱导 Agent 执行偏离用户目标的危险动作。Computer-Use Agent 需要区分用户指令和屏幕中不可信的内容，并对支付、删除、登录和外发操作设置人工确认或策略拦截。

### 统一效率指标

多次截图、裁剪、放大和验证可能提升准确率，但会增加延迟、token 和动作成本。未来系统需要同时优化 success rate、latency、action count、token cost 和 safety。

## 研究跟进清单

- **OSWorld-G / JEDI**：Grounding 数据、任务分解和规模化合成；
- **MMBench-GUI**：从内容理解到任务协作的分层评测；
- **WindowsWorld**：跨应用专业工作流和过程级评测；
- **ScreenSpot-v2 / ScreenSpot-Pro**：元素定位和高分辨率专业软件评测；
- **OSWorld**：完整桌面任务执行；
- **OpenAI Operator / CUA**、**Anthropic Computer Use**、**Google Computer Use / Project Mariner**：产业界 Computer Use 路线。

## 参考资料

1. [MMBench-GUI: A Unified Hierarchical Evaluation Framework for Multi-Platform GUI Agents](https://arxiv.org/abs/2507.19478)（CVPR 2026）
2. [Scaling Computer-Use Grounding via User Interface Decomposition and Synthesis](https://arxiv.org/abs/2505.13227)（NeurIPS 2025）
3. [OSWorld-G / JEDI 官方项目页](https://osworld-grounding.github.io/)
4. [MMBench-GUI 官方仓库](https://github.com/open-compass/MMBench-GUI)
5. [WindowsWorld: A Process-Centric Benchmark of Autonomous GUI Agents](https://aclanthology.org/2026.findings-acl.750/)（Findings of ACL 2026）
6. [OpenAI Operator](https://openai.com/index/introducing-operator/)
7. [Google Computer Use 文档](https://ai.google.dev/gemini-api/docs/computer-use)

> **一句话：** GUI Agent 的核心已经从“看图找坐标”演进为“理解意图、分层定位、执行验证、持续规划”；H2L-G1 所解决的高层指令细化和高分辨率局部 grounding，正是这条演进路线中的关键环节。
