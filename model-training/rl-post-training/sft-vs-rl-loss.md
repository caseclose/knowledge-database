# SFT 和 RL 的 loss 在数学上差在哪？

> 创建时间：2026-08-25 ｜ 最新更新：2026-08-25 ｜ 标签：面试、后训练

两者都在改同一个自回归策略 $\pi_\theta(y_t \mid x, y_{<t})$，梯度都长得像「$\nabla\log\pi$ 乘一个标量」。差别不在网络结构，而在**这个标量从哪来、期望对谁求**。

## 两条目标函数

SFT 是对标注回答 $y^*$ 做极大似然（token 级交叉熵 / NLL）：

$$
\mathcal{L}_{\mathrm{SFT}}(\theta)=-\mathbb{E}_{(x,y^*)\sim\mathcal{D}}
\sum_{t=1}^{|y^*|}\log\pi_\theta(y^*_t\mid x,y^*_{<t})
$$

梯度里每个金标 token 的权重恒为 $1$（teacher forcing，前缀永远是金标）：

$$
\nabla_\theta\mathcal{L}_{\mathrm{SFT}}=
-\mathbb{E}_{(x,y^*)\sim\mathcal{D}}
\sum_t\nabla_\theta\log\pi_\theta(y^*_t\mid x,y^*_{<t})
$$

RL（以 REINFORCE / 策略梯度为例）最大化**当前策略自己采样**出来的回答的期望奖励：

$$
J(\theta)=\mathbb{E}_{x\sim\mathcal{D},\,y\sim\pi_\theta(\cdot\mid x)}\bigl[r(x,y)\bigr]
$$

$$
\nabla_\theta J(\theta)=
\mathbb{E}_{x,\,y\sim\pi_\theta}
\left[
A(x,y)\sum_t\nabla_\theta\log\pi_\theta(y_t\mid x,y_{<t})
\right]
$$

$A$ 是优势（奖励减基线）。PPO / [GRPO](/model-training/rl-post-training/grpo-advantage-function.md) 再乘重要性比 $\rho=\pi_\theta/\pi_{\mathrm{old}}$ 并 clip。序列级奖励时，回答里每个 token 往往共享同一个 $A$（token 级细分是 [DAPO](/model-training/rl-post-training/dapo-vs-grpo.md) 那类后续工作）。

## 对照：同一条 $\nabla\log\pi$，四个不一样

| 维度 | SFT | RL |
|------|-----|-----|
| 期望对谁 | 数据集里的金标 $y^*$（**off-policy**） | 当前策略采样的 $y\sim\pi_\theta$（**on-policy**） |
| 乘在 $\nabla\log\pi$ 上的标量 | 恒为 $1$，只推高金标 token | 奖励 / 优势 $A$，可正可负 |
| 前缀从哪来 | teacher forcing：金标前缀 | 自己 rollout 出来的前缀 |
| 监督密度 | 每个 token 都有对错 | 常见是整段一个 $r$，credit assignment 稀疏 |
| 优化倾向 | mode-covering：把数据里的模式都盖住 | mode-seeking：把质量集中到高奖励模式 |

所以面试里可以先说一句：**SFT 是「模仿这一条轨迹」，RL 是「按回报重加权自己会走的轨迹」。** 公式形态接近，数据流和权重完全不是一回事。

## 把 SFT 改写成策略梯度：隐含奖励有病

对离散 $y$，用重要性采样把「对 $y^*$ 求期望」改成「对 $\pi_\theta$ 求期望」：

$$
\nabla_\theta\mathcal{L}_{\mathrm{SFT}}
=-\mathbb{E}_{y\sim\pi_\theta}
\left[
\frac{\mathbf{1}[y=y^*]}{\pi_\theta(y\mid x)}\,
\nabla_\theta\log\pi_\theta(y\mid x)
\right]
$$

对照 $\nabla J=\mathbb{E}[A\,\nabla\log\pi]$，SFT 的隐含奖励是：

$$
r_{\mathrm{SFT}}(x,y)=\frac{\mathbf{1}[y=y^*]}{\pi_\theta(y\mid x)}
$$

两处不健康：

1. **极稀疏**：只有整段（或该 token）刚好等于专家才非零，学不到「差不多也对」。
2. **$1/\pi_\theta$ 爆炸**：模型越不信这个专家 token，梯度越大，容易把低概率精确匹配过拟合进去——这就是「SFT 爱背、RL 更能泛化」的一条数学解释（见 DFT / Dynamic Fine-Tuning：[On the Generalization of SFT](https://arxiv.org/abs/2508.05629)）。

DFT 的修法是给 SFT 再乘回 $\pi_\theta$（stop-gradient），把 $- \log p$ 变成 $-p\log p$，抵掉 $1/\pi$。面试提到这层即可，不必展开实现。

## 训练时还会再差几处

- **曝光偏差**：SFT 从未在「自己刚才生成错了」的前缀上受训；RL 的状态就是自己的前缀，训练分布和推理分布对齐。
- **负样本**：SFT 通常只有正例；RL 的 $A<0$ 会压低差回答（GRPO 组内相对差的那一半）。
- **KL**：SFT 没有显式 KL；PPO/GRPO 常加 $\beta\,\mathrm{KL}(\pi_\theta\parallel\pi_{\mathrm{ref}})$ 防止跑飞，[DAPO](/model-training/rl-post-training/dapo-vs-grpo.md) 选择去掉它。
- **可学什么**：没有奖励模型、没有可验证对错时，只能 SFT；有 verifier / RM 时 RL 才能把「更好」写进梯度。

实践上几乎总是 **SFT 打底（格式、工具调用、基本能力）→ RL 拉齐可验证目标（数学、代码、偏好）**，不是二选一。

## 总结

| 一句话 | 含义 |
|--------|------|
| 同一条 score function | 都是 $\sum_t\nabla\log\pi_\theta(y_t\mid\cdot)$ |
| 差在期望和权重 | SFT：$y^*$ 上权重 $1$；RL：$y\sim\pi$ 上权重 $A$ |
| SFT 当 RL 看 | 隐含 $r=\mathbf{1}[y=y^*]/\pi_\theta$，稀疏且会炸 |

> **一句话：** SFT 是对金标做 $-\log\pi$（off-policy、权重恒 1），RL 是对 $\pi$ 自己采样的轨迹做 $A\nabla\log\pi$（on-policy、用奖励重加权）；把 SFT 改写成策略梯度会多出一个 $1/\pi_\theta$，这正是它更容易背答案、不如 RL 泛化的数学来源。
