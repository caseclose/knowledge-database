# OPD：从 LLM 到 Flow Matching 的在策略蒸馏（On-Policy Distillation）

> 创建时间：2026-07-17 ｜ 最新更新：2026-08-21

> 本文梳理 On-Policy Distillation（OPD，在策略蒸馏）这一训练范式的核心思想、相比传统 KD 与 RL 的优势，以及它 2023 年在 LLM 上发源、2026 年迁移到 Flow Matching 图像生成模型的论文脉络（共 9 篇，截至 2026-07）。DiffusionOPD 论文中也称之为 Online Policy Distillation。

## 背景：什么是 OPD

知识蒸馏（KD）用 teacher 的输出监督 student，以压缩推理成本。传统的 sequence-level KD 是 **off-policy** 的：student 在固定数据（ground truth 或 teacher 预生成的序列）上训练，推理时却要处理**自己生成**的序列——训练分布与推理分布不匹配（exposure bias），自回归生成时误差逐步累积。

OPD 的做法是：**让 student 自己采样轨迹，teacher 在 student 的轨迹上给出逐位置密集监督**——"student 自己犯错，teacher 当场纠正"：

```text
x (prompt) → student 采样 y ~ π_student(·|x)
           → teacher 对 y 的每个位置 t 给出分布 p_teacher(·|y_<t, x)
```

$$
\mathcal{L}=\sum_t D\bigl(p_{\mathrm{teacher}}(\cdot\mid y_{<t},x) \,\Vert\, p_{\mathrm{student}}(\cdot\mid y_{<t},x)\bigr)
$$

其中 $D$ 可取 reverse KL / forward KL / JSD 等。

与 RL（如 RLVR）相比，OPD 每个 token 都有监督信号，而非只在序列结尾拿到一个稀疏 reward，信号密度高、方差低、token 效率高；与 off-policy KD 相比，它直接优化 student 真实生成分布下的行为。

## LLM 方向：从外部 teacher 到自蒸馏

| 论文 | 时间 | 一句话 |
|------|------|--------|
| [MiniLLM](https://arxiv.org/abs/2306.08543) | 2023-06 | 把 KD 目标换成 reverse KL，用 policy gradient 推导出 on-policy 优化 |
| [GKD](https://arxiv.org/abs/2306.13649) | 2023-06 | on-policy 数据 + 任意散度 + 可与 RLHF 结合的广义蒸馏框架 |
| [Self-Distilled Reasoner (OPSD)](https://arxiv.org/abs/2601.18734) | 2026-01 | 不要外部 teacher：同一模型带 privileged 信息当 teacher，教"裸眼"的自己 |
| [Self-Distilled RLVR (RLSD)](https://arxiv.org/abs/2604.03128) | 2026-04 | 纯 OPSD 会信息泄漏、训练不稳；RLVR 定方向、自蒸馏定幅度 |
| [DOPD](https://arxiv.org/abs/2606.30626) | 2026-06 | 识别 privilege illusion，按 advantage 在双 privileged 策略间路由 token 级监督 |

### 奠基：MiniLLM 与 GKD（2023）

两篇 2023 年 6 月的工作（后均发表于 ICLR 2024）奠定了 LLM 上的 OPD：

- **MiniLLM**：标准 KD 用 forward KL，会让 student 高估 teacher 分布的低概率区域，对生成式模型尤其有害；换成 **reverse KL** 后，其优化可推导为一个 policy gradient 问题——student 从自身分布采样，即 on-policy。训练上用 single-step regularization 与 teacher-mixed sampling 降低方差。值得一提，该文 2026 年初的修订版（v6）已把标题改为 *MiniLLM: On-Policy Distillation of Large Language Models*，OPD 这一术语由此溯源。
- **GKD**（*On-Policy Distillation of Language Models: Learning from Self-Generated Mistakes*，Google DeepMind）：把 KD 的三个维度解耦——数据来源（on/off-policy 可按比例混合）、散度形式（forward KL / reverse KL / JSD，student 容量不足时选 mode-seeking 的散度更稳）、以及与 RL fine-tuning 的无缝组合。在 summarization、translation、arithmetic reasoning、instruction tuning 上验证。

### 演进：自蒸馏及其"病"（2026）

- **OPSD（Self-Distilled Reasoner）**：不再需要更大的 teacher。同一个 LLM 分饰两角——teacher policy 条件于 privileged information（如已验证的 reasoning trace / 参考答案），student 只看 question；在 student 自己的 rollout 上逐 token 对齐两个分布。比 RL 方法更 token-efficient，比 off-policy 蒸馏效果更好。
- **RLSD（Self-Distilled RLVR）**：指出纯 OPSD 的信号全部来自 privileged teacher，会导致严重的**信息泄漏**与长期训练不稳定。方案是把信号拆开：用 self-distillation 得到的 token 级 policy 差决定**更新幅度**，用 RLVR 的环境反馈（答案对错）决定**更新方向**，兼得更高收敛上限与训练稳定性。
- **DOPD**：进一步指出 privileged 信息会引入 **privilege illusion**——把"可迁移的能力差"（student 本该补齐的）与"信息不对称差"（只能模仿、永远无法复制的）混为一谈；且 token 级监督天然不均匀，只有少数 token 携带关键能力信号。方案是 advantage-aware 双重蒸馏：按 advantage gap 与相对概率，在 privileged teacher 与 privileged student 之间动态路由每个 token 的监督强度、目标与策略。LLM 与 VLM 设置下均稳定超过 Vanilla OPD。

## Flow Matching 方向：把"逐 token 对齐"换成"逐状态速度场匹配"

2026 年起，OPD 被系统迁移到 diffusion / flow-matching 图像生成模型。迁移要回答两个问题：连续状态空间上 "on-policy" 是什么——沿 student 自己采样的 rollout 轨迹状态；"token 分布对齐"对应什么——velocity field 的 mean matching / MSE。

| 论文 | 时间 | 一句话 |
|------|------|--------|
| [D-OPSD](https://arxiv.org/abs/2605.05204) | 2026-05 | few-step 模型的持续微调：teacher 看图文、student 只看文的 on-policy 自蒸馏 |
| [DiffusionOPD](https://arxiv.org/abs/2605.15055) | 2026-05 | 把 OPD 提升到连续状态马尔可夫过程，推出闭式 per-step KL，统一 SDE/ODE |
| [Qwen-Image-2.0-RL](https://arxiv.org/abs/2606.27608) | 2026-06 | 工业管线：GRPO 先训专项 RL 策略，最后用 OPD 合并成单一模型 |
| [DanceOPD](https://arxiv.org/abs/2606.27377) | 2026-06 | 生成场蒸馏：每种能力是一个 velocity field，按样本路由 + velocity MSE |

### DiffusionOPD：理论框架

多任务 T2I 的 RL 后训练有两难：联合优化存在跨任务干扰与 reward 失衡，级联 RL 繁琐且易灾难性遗忘。DiffusionOPD 先独立训练 task-specific teacher，再沿 student 自己的 rollout 轨迹把多教师能力蒸进统一 student——把单任务探索与多任务整合解耦。理论上将 OPD 从离散 token 提升到连续状态马尔可夫过程，推出 **closed-form per-step KL** 目标，用 mean-matching 同时统一随机 SDE 与确定 ODE 的 refinement；并证明该解析梯度比 PPO-style policy gradient **方差更低、泛化更好**。实验上在训练效率与最终性能均超过 multi-reward RL 与 cascade RL 基线。

### Qwen-Image-2.0-RL：工程落地

Qwen-Image-2.0 的 RL 后训练技术报告，OPD 是管线最后一步"能力合并器"：

1. 用 VLM 微调出 pointwise 打分 + CoT 推理的 composite reward models（T2I 覆盖 alignment / aesthetics / portrait fidelity；editing 覆盖指令遵循与人脸 ID 保持）；
2. GRPO 框架训练专项 RL 策略，配 hybrid CFG 保留预训练知识、intra-group reward range filtering 做 prompt curation、按类目校准 reward 权重；
3. 最后用 **on-policy distillation（trajectory-level velocity matching）** 把 T2I 与 editing 两个专项 RL 策略合并成单一 student。

结果：Qwen-Image-Bench 57.84（+2.61），T2I arena Elo 1193（+78），image edit arena Elo 1349（+93），美学、指令遵循与编辑准确率均有稳定收益。

### DanceOPD：能力即场，按样本路由

把每种能力源定义为共享 flow 状态空间上的一个 velocity field（capability field）。训练时每个样本路由到一个场，在 **student 自己 rollout 出的低噪声状态**上查询该场，用简单的 velocity MSE 训练。统一 T2I / 局部编辑 / 全局编辑三类能力且互不拖累，还能吸收"算子定义的场"——例如把 CFG 直接蒸进模型权重。

### D-OPSD：few-step 模型的持续学习

few-step 蒸馏模型（Z-Image-Turbo、FLUX.2-klein 等）直接做连续 SFT 会破坏其 few-step 推理能力。D-OPSD 发现以 LLM/VLM 为 encoder 的现代 diffusion 模型可继承 encoder 的 in-context 能力，于是构造 on-policy 自蒸馏：teacher 条件于 text + target image 的多模态特征，student 只条件于 text，在 student 自己的 rollout 上对齐两者的预测分布。模型由此学习新概念、新风格而不牺牲 few-step 能力——这正是 OPSD 在图像领域的对应物（privileged info 从"参考答案"换成了"目标图"）。

## 规律与选型

**LLM 线的演进脉络**：外部大 teacher（MiniLLM / GKD）→ 去掉外部 teacher 的 privileged 自蒸馏（OPSD）→ 治 privileged 信息带来的病：信息泄漏与不稳定（RLSD）、privilege illusion（DOPD）。

**图像线的共同模式**：OPD 充当"多能力整合器"——先各任务单独 RL 出专家，再 OPD 合并（DiffusionOPD、Qwen-Image-2.0-RL）；监督对象从 token 分布换成 velocity field（DanceOPD）；privileged 自蒸馏保住 few-step 能力（D-OPSD）。

实践中的选择：

| 场景 | 建议 |
|------|------|
| 只有固定数据集，对分布失配不敏感 | off-policy KD / SFT 即可 |
| 要对齐 student 真实生成分布，且有更强 teacher | OPD |
| 没有 teacher，只有可验证 reward | RLVR / RLHF |
| 既有 reward 又可构造 privileged 信号 | RLSD 式混合（方向用 RL，幅度用蒸馏） |
| 多任务 / 多能力合并到单一模型 | 先分任务训练，最后用 OPD 合并 |
| few-step 生成模型继续注入新知识 | D-OPSD 式自蒸馏，避免破坏 few-step 特性 |

> **一句话：** OPD = "student 自己采样 + teacher 在 student 轨迹上密集监督"：在 LLM 上它解决了 KD 的分布失配、比 RL 信号更密，2026 年又被翻译成 velocity field 匹配，成为图像生成模型多能力整合与持续微调的标准工具。

## 参考文献

LLM 相关：

- [2306.13649] [On-Policy Distillation of Language Models: Learning from Self-Generated Mistakes](https://arxiv.org/abs/2306.13649)（GKD）
- [2306.08543] [MiniLLM: On-Policy Distillation of Large Language Models](https://arxiv.org/abs/2306.08543)
- [2601.18734] [Self-Distilled Reasoner: On-Policy Self-Distillation for Large Language Models](https://arxiv.org/abs/2601.18734)（OPSD）
- [2604.03128] [Self-Distilled RLVR](https://arxiv.org/abs/2604.03128)（RLSD）
- [2606.30626] [DOPD: Dual On-policy Distillation](https://arxiv.org/abs/2606.30626)

Flow Matching 相关：

- [2606.27608] [Qwen-Image-2.0-RL Technical Report](https://arxiv.org/abs/2606.27608)
- [2605.15055] [DiffusionOPD: A Unified Perspective of On-Policy Distillation in Diffusion Models](https://arxiv.org/abs/2605.15055)
- [2606.27377] [DanceOPD: On-Policy Generative Field Distillation](https://arxiv.org/abs/2606.27377)
- [2605.05204] [D-OPSD: On-Policy Self-Distillation for Continuously Tuning Step-Distilled Diffusion Models](https://arxiv.org/abs/2605.05204)
