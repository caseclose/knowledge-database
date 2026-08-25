# GRPO 的优势函数是怎么算的？

> 创建时间：2026-08-20 ｜ 最新更新：2026-08-25 ｜ 标签：面试、训练

GRPO（Group Relative Policy Optimization，DeepSeekMath 提出，DeepSeek-R1 沿用）是当前 LLM RL 后训练的主流算法之一。相对 PPO 最大的改动： **扔掉 critic（value 网络）**，改用「同一 prompt 下一组回答互相比较」来估计优势（advantage）。

配套阅读：[DAPO 与 GRPO 的区别](dapo-vs-grpo.md)（DAPO 的优势函数与 GRPO 相同，改的是 clip / 采样 / loss 聚合 / 超长整形，并去掉 KL）。

## 为什么要换掉 PPO 的 critic

PPO 是 actor-critic：policy $\pi_\theta$ 出 token，value 网络 $V_\psi(s)$ 估「这个前缀还值多少」，再用 GAE 算逐步优势 $A_t$。LLM 里这套有两个硬伤：

1. **显存**：value 网络通常和 policy 同规模，等于再挂一个大模型。
2. **信号稀疏**：奖励往往只打在**整段回答的最后一个 token**（对错、偏好分），中间 token 没有逐步回报。要让 $V_\psi$ 在每个前缀上都准，很难训。

优势的本质是「这个动作比平均水平好多少」。PPO 用 $V_\psi$ 当平均水平；GRPO 换成：**同一道题再采样 $G$ 个回答，用这 $G$ 个分数的均值当平均水平**。

## 采样设定：先把每个符号钉死

对数据集里的一道题 $q$，用**采样时冻结的旧策略** $\pi_{\theta_{\mathrm{old}}}$ 采一组回答：

$$
\{o_1, o_2, \ldots, o_G\} \sim \pi_{\theta_{\mathrm{old}}}(\cdot \mid q)
$$

| 符号 | 含义 |
|------|------|
| $q$ | 题 / prompt |
| $o_i$ | 第 $i$ 个完整回答（token 序列） |
| $o_{i,t}$ | $o_i$ 的第 $t$ 个 token |
| $o_{i,<t}$ | 它前面的前缀 |
| $G$ | 组大小。DeepSeekMath 用 $64$；后来 R1 / DAPO 常见 $8$ 或 $16$ |
| $\pi_{\theta_{\mathrm{old}}}$ | **采样策略**，rollout 期间冻结 |
| $\pi_\theta$ | **正在更新的策略**。采完一组后可对同一批数据做 $\mu$ 次梯度步，$\theta$ 会离开 $\theta_{\mathrm{old}}$ |
| $\pi_{\mathrm{ref}}$ | **参考策略**，通常是 RL 开始时的 SFT / base，整段训练冻结，只用来算 KL |

奖励函数给每个回答一个标量（奖励模型打分，或规则：对了 $1$、错了 $0$ / $-1$）：

$$
\mathbf{r} = \{r_1, \ldots, r_G\}, \qquad r_i = R(q, o_i)
$$

$r_i$ 是**序列级**分数，不是逐步奖励。这是后面「一条回答里每个 token 共用同一个 $A$」的根源。

## 优势函数：组内 z-score

Outcome supervision（最常用、面试默认问这个）把 $r_i$ 做成组内标准化，再**复制到该回答的每一个 token** 上：

$$
\hat{A}_{i,t} = \tilde{r}_i = \frac{r_i - \operatorname{mean}(\mathbf{r})}{\operatorname{std}(\mathbf{r})}
$$

$\hat{A}_{i,t}$ 对固定的 $i$、任意 $t$ 都相同。写法带下标 $t$，只是为了后面能塞进逐 token 的 PPO clip。

| 符号 | 含义 | 设计作用 |
|------|------|----------|
| $r_i$ | 回答 $o_i$ 的原始奖励 | 绝对好坏；尺度随 RM / 规则而变 |
| $\operatorname{mean}(\mathbf{r})$ | 组内均值 $\frac{1}{G}\sum_j r_j$ | **基线**。替代 PPO 的 $V(s)$：这道题「一般能得几分」 |
| $r_i - \operatorname{mean}(\mathbf{r})$ | 相对组内平均好多少 | 比平均好 → 正优势（强化）；差 → 负优势（抑制） |
| $\operatorname{std}(\mathbf{r})$ | 组内标准差 | 把不同题、不同奖励尺度拉到同一量级，梯度不跟着 $r$ 的绝对值飘 |
| $\hat{A}_{i,t}$ | token $t$ 的优势估计 | 策略梯度里「这个 token 该被加强还是压低、力度多大」 |

数值例子：$G=4$，规则奖励对 $1$、错 $0$，$\mathbf{r}=\{1,1,0,0\}$。

$$
\operatorname{mean}=0.5,\quad \operatorname{std}=0.5,\quad \hat{A} = \{+1,+1,-1,-1\}
$$

两个对的回答里每个 token 都吃 $+1$，两个错的都吃 $-1$。基线是「这道题大约对一半」，不是「全世界所有题的平均分」。

### 分子：为什么用组内均值当基线

策略梯度 $\nabla_\theta \log \pi_\theta \cdot r$ 方差很大。减一个**不依赖当前动作**的基线 $b$，期望不变、方差下降。合法基线很多（常数、$V(s)$、同题其他样本的平均）。GRPO 选最后一种，因为：

- 同一 $q$ 下采样，难度、题型都对齐，均值是这道题的公平参照；
- 奖励模型本身常在「同一题的回答两两比较」上训练，组内相对更贴它的语义；
- 不另训一个网络。

只关心组内相对好坏：**一道很难的题，4 个回答里唯一接近正确的那个也会拿到大正优势**；一道送分题，4 个全对则相对优势全是 $0$（见下文 std=0）。

### 分母：为什么还要除以 std

不同题的奖励尺度差一截：规则奖励可能是 $\{0,1\}$，RM 可能是 $[-5,5]$。不除 std，梯度幅度跟奖励量纲走，Adam 也救不了题与题之间的相对步长。除完之后，一组里大约是「均值 $0$、方差 $1$ 的相对成绩」，各题梯度量级可比。

实现里分母常写成 $\operatorname{std}(\mathbf{r}) + \epsilon$（如 $10^{-8}$），防除零；**数值上稳住不等于有学习信号**——std 真为 $0$ 时，分子也是 $0$，$\hat{A}$ 仍全是 $0$。

### 为什么一条回答里每个 token 的 $A$ 都一样

Outcome 奖励只在序列末尾出现一次，中间 token 没有逐步回报，也没有 critic 把这个终端奖励往回传。GRPO 的处理是：**整条轨迹共用同一个相对成绩**。对了，这条 CoT 上每个 token 都被加强；错了，整条都被压。

这是 credit assignment 很粗的版本：一个关键推理错误会连累前面写对的步骤，一段正确推导若最后抄答案抄错，前面 token 也会吃负优势。DeepSeekMath 还写过 **process supervision**：逐步打分，token $t$ 的优势是「它之后所有步骤标准化奖励之和」

$$
\hat{A}_{i,t} = \sum_{\mathrm{index}(j) \ge t} \tilde{r}_i^{\mathrm{index}(j)}
$$

工业界 long-CoT（R1-Zero / DAPO）多数仍用 outcome + 规则奖励。面试先把 outcome 这条讲清楚。

## 目标函数 / Loss：clip 完再减 KL

训练时**最大化**下面的替代目标（实现里对 $J$ 取负当 loss 再反传）：

$$
\begin{aligned}
\mathcal{J}_{\mathrm{GRPO}}(\theta)
&= \mathbb{E}_{q \sim P(Q),\; \{o_i\}_{i=1}^{G} \sim \pi_{\theta_{\mathrm{old}}}(\cdot \mid q)} \Bigg[
\frac{1}{G} \sum_{i=1}^{G} \frac{1}{|o_i|} \sum_{t=1}^{|o_i|} \Big(
\min\big(\rho_{i,t}(\theta)\,\hat{A}_{i,t},\;
\operatorname{clip}(\rho_{i,t}(\theta), 1-\varepsilon, 1+\varepsilon)\,\hat{A}_{i,t}\big)
\\
&\qquad\qquad\qquad\qquad\qquad\qquad
- \beta\, \mathbb{D}_{\mathrm{KL}}[\pi_\theta \parallel \pi_{\mathrm{ref}}]
\Big)
\Bigg]
\end{aligned}
$$

重要性采样比：

$$
\rho_{i,t}(\theta) = \frac{\pi_\theta(o_{i,t} \mid q, o_{i,<t})}{\pi_{\theta_{\mathrm{old}}}(o_{i,t} \mid q, o_{i,<t})}
$$

KL 用 Schulman 的无偏、恒非负估计（不把 KL 塞进奖励，以免污染 $\hat{A}$）：

$$
\mathbb{D}_{\mathrm{KL}}[\pi_\theta \parallel \pi_{\mathrm{ref}}]
= \frac{\pi_{\mathrm{ref}}(o_{i,t}\mid q,o_{i,<t})}{\pi_\theta(o_{i,t}\mid q,o_{i,<t})}
- \log\frac{\pi_{\mathrm{ref}}(o_{i,t}\mid q,o_{i,<t})}{\pi_\theta(o_{i,t}\mid q,o_{i,<t})}
- 1
$$

### 每个量代表什么

| 符号 | 含义 | 设计作用 |
|------|------|----------|
| $\mathbb{E}_{q,\{o_i\}}$ | 对题、对一组 rollout 求期望 | 数据从 $\pi_{\theta_{\mathrm{old}}}$ 采样，是 on-policy（可带多次更新的「近 on-policy」） |
| $\frac{1}{G}\sum_i$ | 组内 $G$ 条回答先平等平均 | **样本级**聚合的外层：一条长回答和一条短回答权重相同 |
| $\frac{1}{\lvert o_i \rvert}\sum_t$ | 回答内部再按 token 平均 | 长回答里每个 token 的权重被长度稀释（DAPO 改掉的正是这一层） |
| $\rho_{i,t}(\theta)$ | 新策略 vs 采样策略，对该 token 的概率比 | 采的是 $\pi_{\theta_{\mathrm{old}}}$，梯度却对 $\pi_\theta$。刚采完、第一次更新时 $\rho=1$；同一批数据更新多次后 $\rho$ 偏离 $1$，重要性采样用来纠偏 |
| $\hat{A}_{i,t}$ | 上文的组内 z-score | 正：抬高该 token 概率；负：压低 |
| $\varepsilon$ | clip 半宽，常用 $0.2$ | 把 $\rho$ 限制在 $[1-\varepsilon,1+\varepsilon]$，单步策略别跑太远 |
| $\min(\rho A,\;\operatorname{clip}(\rho) A)$ | PPO clipped surrogate | 取悲观的一边，限制「顺优势方向」的过大更新，反向错误不保护 |
| $\beta$ | KL 强度。DeepSeekMath 用 $0.04$ | 越大越贴 $\pi_{\mathrm{ref}}$，越不敢学新推理模式 |
| $\mathbb{D}_{\mathrm{KL}}$ | 逐 token 的 KL 估计 | 防止 reward hacking / 语言崩坏；long-CoT 里 DAPO 认为这项过强，直接去掉 |

对应到实现，一条回答上的 **token loss**（注意前面有个负号，因为框架最小化 loss）：

$$
\ell_{i,t} = -\min\big(\rho_{i,t}\hat{A}_{i,t},\; \operatorname{clip}(\rho_{i,t},1-\varepsilon,1+\varepsilon)\hat{A}_{i,t}\big) + \beta\, \hat{D}_{\mathrm{KL},i,t}
$$

整组再按「先回答内平均、再对 $G$ 条平均」合成标量。

### Clip 在正负优势下分别卡什么

$\operatorname{clip}(\rho, 1-\varepsilon, 1+\varepsilon)$ 把概率比卡在 $[0.8, 1.2]$（$\varepsilon=0.2$ 时）。$\min$ 使得：

- $\hat{A}>0$（好回答，想抬概率）：只有 **上沿** $1+\varepsilon$ 生效。$\rho$ 再大，目标最多按 $(1+\varepsilon)\hat{A}$ 计，梯度不再鼓励把已经很高的 $\rho$ 继续抬。低概率的「探索 token」想从 $0.01$ 抬到有意义的值，上沿很紧（$0.01\times 1.2=0.012$），这是 DAPO Clip-Higher 要松的地方。
- $\hat{A}<0$（差回答，想压概率）：只有 **下沿** $1-\varepsilon$ 生效。$\rho$ 掉破 $0.8$ 之后不再额外得分，避免坏 token 被一次性压到 $0$、词表坍缩。
- 走错方向（好 token 的 $\rho$ 下降、坏 token 的 $\rho$ 上升）**不 clip**，完整梯度把它拉回来。

### 聚合方式：样本级平均意味着什么

GRPO 是

$$
\frac{1}{G}\sum_{i=1}^{G}\frac{1}{|o_i|}\sum_{t=1}^{|o_i|} \ell_{i,t}
$$

每条回答权重 $1/G$，与长度无关。长度为 $L$ 的回答里，单个 token 的权重是 $1/(G L)$。长 CoT 里真正带来奖励的推理模式，被长度摊薄；又臭又长的重复、胡话，每个垃圾 token 的惩罚也偏弱。这是 DAPO 改成「所有 token 一视同仁平均」的原因，细节见 [DAPO 文](dapo-vs-grpo.md)。

## 关键坑：std = 0 时整组没有梯度

若 $G$ 个奖励全相同（全对或全错），则 $\operatorname{mean}=r_i$、$\operatorname{std}=0$，于是 $\hat{A}_{i,t}=0$。clip 项是 $0$，KL 若 $\pi_\theta\approx\pi_{\mathrm{ref}}$ 也接近 $0$，**这组对 policy 的有效梯度为零**，采样算力白花。

训练越往后，简单题「组内全对」越多，一个 batch 里有效 prompt 比例下降，梯度更噪、更弱。DAPO 的 Dynamic Sampling 专门丢掉这些组，直到凑满「有对有错」的 batch。

## 和 PPO 对照（面试一张表）

| | PPO | GRPO |
|--|-----|------|
| 基线 | 学出来的 $V_\psi(s)$ | 同 prompt 组内 $\operatorname{mean}(\mathbf{r})$ |
| 优势 | GAE，逐步、token 不同 | 组内 z-score，outcome 下整句相同 |
| 额外网络 | policy + critic（+ 常还有 RM） | 只有 policy（RM 可换成规则） |
| KL | 常加在逐步奖励里 | 加在 loss 里，不进 $\hat{A}$ |
| 聚合 | 通常 token 平均 | 样本内 token 平均，再对样本平均 |
| 代价 | critic 显存、价值估计不准 | 每题要采 $G$ 次；std=0 无信号 |

## 总结

> **一句话：** GRPO 的优势是组内 z-score $\hat{A}_{i,t}=(r_i-\mathrm{mean})/\mathrm{std}$，用同题 $G$ 个回答的相对成绩代替 PPO 的 value 网络；loss 仍是 PPO 的 $\rho A$ + 对称 clip，外加 $\beta\,\mathrm{KL}$，并按「先句内平均、再句间平均」聚合——省一个 critic，但 std=0 时整组没有梯度，长回答里的 token 还会被长度稀释。
