# DAPO 和 GRPO 的区别

> 创建时间：2026-08-20 ｜ 最新更新：2026-08-25 ｜ 标签：面试、训练

DAPO（Decoupled Clip and Dynamic sAmpling Policy Optimization，字节 Seed 2025）不是新的优势估计器，而是在 **GRPO 底座上打的四个补丁**，专门治大规模 long-CoT RL 里朴素 GRPO 的熵坍缩、零梯度组、长度偏置、截断奖励噪声。Qwen2.5-32B 上 AIME 2024：朴素 GRPO 约 **30** 分，DAPO **50** 分，且用大约一半步数超过 DeepSeek-R1-Zero-Qwen-32B 的 47 分。

配套阅读：[GRPO 的优势函数](/model-training/rl-post-training/grpo-advantage-function.md)（组内 z-score、对称 clip、样本级 loss、KL 的逐符号说明）。本文把 **DAPO 的优势、loss 每个量**，以及相对 GRPO **每一处改动带来什么** 写全。

## 相同的底座

两者都：无 critic；对同一 prompt 采一组回答；用**组内标准化奖励**当优势。DAPO 改的是 **clip 上下沿、哪些组进 batch、loss 按句平均还是按 token 平均、超长怎么给分**，并 **去掉 KL**。

优势公式两边一样（outcome supervision）：

$$
\hat{A}_{i,t} = \frac{R_i - \operatorname{mean}(\{R_j\}_{j=1}^{G})}{\operatorname{std}(\{R_j\}_{j=1}^{G})}
$$

$\hat{A}_{i,t}$ 对回答 $o_i$ 内每个 token 相同。面试里容易混：「DAPO 的 token-level」指的是 **loss 怎么平均**，不是优势改成逐步 GAE。

DAPO 论文里的规则奖励（可验证数学）：

$$
R(\hat{y}, y) =
\begin{cases}
+1, & \mathrm{is\_equivalent}(\hat{y}, y) \\
-1, & \text{otherwise}
\end{cases}
$$

相对 GRPO 常用的 $\{0,1\}$，只是把错的从 $0$ 改成 $-1$。组内 z-score 会吃掉这个仿射变换，**优势形状不变**；真正不一样的是目标函数。

## 两边目标函数对照

**GRPO**（最大化；实现里取负当 loss）：

$$
\begin{aligned}
\mathcal{J}_{\mathrm{GRPO}}(\theta)
&= \mathbb{E}_{q,\{o_i\}\sim\pi_{\theta_{\mathrm{old}}}} \Bigg[
\frac{1}{G} \sum_{i=1}^{G} \frac{1}{|o_i|} \sum_{t=1}^{|o_i|} \Big(
\min\big(\rho_{i,t}\hat{A}_{i,t},\;
\operatorname{clip}(\rho_{i,t}, 1-\varepsilon, 1+\varepsilon)\,\hat{A}_{i,t}\big)
- \beta\, D_{\mathrm{KL}}[\pi_\theta \parallel \pi_{\mathrm{ref}}]
\Big)
\Bigg]
\end{aligned}
$$

**DAPO**：

$$
\begin{aligned}
\mathcal{J}_{\mathrm{DAPO}}(\theta)
&= \mathbb{E}_{(q,a)\sim\mathcal{D},\; \{o_i\}_{i=1}^{G}\sim\pi_{\theta_{\mathrm{old}}}(\cdot\mid q)}
\Bigg[
\frac{1}{\sum_{i=1}^{G}|o_i|}
\sum_{i=1}^{G} \sum_{t=1}^{|o_i|}
\min\big(
\rho_{i,t}(\theta)\,\hat{A}_{i,t},\;
\operatorname{clip}(\rho_{i,t}(\theta), 1-\varepsilon_{\mathrm{low}}, 1+\varepsilon_{\mathrm{high}})\,\hat{A}_{i,t}
\big)
\Bigg] \\
&\quad \mathrm{s.t.}\quad
0 < \bigl|\{o_i \mid \mathrm{is\_equivalent}(a, o_i)\}\bigr| < G
\end{aligned}
$$

重要性采样比两边相同：

$$
\rho_{i,t}(\theta) = \frac{\pi_\theta(o_{i,t} \mid q, o_{i,<t})}{\pi_{\theta_{\mathrm{old}}}(o_{i,t} \mid q, o_{i,<t})}
$$

### 每个量代表什么（DAPO 式子）

| 符号 | 含义 | 相对 GRPO 变了吗 | 影响 |
|------|------|------------------|------|
| $(q,a)\sim\mathcal{D}$ | 题 $q$ 与标准答案 $a$ | GRPO 写 $q\sim P(Q)$，不一定要 $a$ | DAPO 用规则奖励，必须有可验证的 $a$ |
| $G$ | 每题采样条数，论文用 $16$ | DeepSeekMath 用 $64$，量级不同 | $G$ 太小，std 估得噪；$G$ 太大，rollout 贵 |
| $\pi_{\theta_{\mathrm{old}}}$ | 采样用的旧策略 | 同 | 数据从这里来，$\rho$ 的分母也是它 |
| $\pi_\theta$ | 正在更新的策略 | 同 | $\rho$ 的分子 |
| $o_i$, $\lvert o_i \rvert$ | 第 $i$ 条回答及其 token 数 | 同 | DAPO 的分母是 $\sum_i\lvert o_i\rvert$，不再是 $G$ 和 $\lvert o_i\rvert$ 两层 |
| $\rho_{i,t}$ | 新/旧策略在该 token 上的概率比 | 同 | 第一次更新为 $1$；同批多步更新后偏离 $1$ |
| $\hat{A}_{i,t}$ | 组内 z-score 优势，句内恒定 | **公式相同** | 正优势抬概率，负优势压概率 |
| $\varepsilon_{\mathrm{low}}$ | 下沿半宽，论文 $0.2$ | GRPO 只有对称的 $\varepsilon$ | 卡住负优势方向：坏 token 别一次性压死 |
| $\varepsilon_{\mathrm{high}}$ | 上沿半宽，论文 $0.28$ | **解耦且抬高** | 给正优势、低概率 token 更大上升空间，缓解熵坍缩 |
| $\frac{1}{\sum_i\lvert o_i\rvert}\sum_i\sum_t$ | 组内所有 token 一视同仁平均 | GRPO 是 $\frac{1}{G}\sum_i\frac{1}{\lvert o_i\rvert}\sum_t$ | 取消长度稀释，长 CoT 与垃圾长文的梯度都按 token 计 |
| $\mathrm{s.t.}\ 0<\lvert\{\text{答对}\}\rvert<G$ | 组内必须有对有错 | GRPO 没有 | 丢掉 std=0 组（Dynamic Sampling） |
| $\beta D_{\mathrm{KL}}$ | 对参考模型的 KL 惩罚 | **整项删除** | 推理分布允许远离 base；约束改由 clip 承担 |

对应 token loss（最小化）：

$$
\ell_{i,t}^{\mathrm{DAPO}}
= -\min\big(\rho_{i,t}\hat{A}_{i,t},\;
\operatorname{clip}(\rho_{i,t}, 1-\varepsilon_{\mathrm{low}}, 1+\varepsilon_{\mathrm{high}})\,\hat{A}_{i,t}\big)
$$

没有 $+\beta\hat{D}_{\mathrm{KL}}$。超长惩罚若启用，是加在 $R_i$ 上，经 z-score 进 $\hat{A}$，不另开一项 loss。

## 四项改动：GRPO 的病 → DAPO 的药 → 带来什么

论文消融（Qwen2.5-32B，AIME24 avg@32）是累加的：Naive GRPO 30 → +Overlong Filtering 36 → +Clip-Higher 38 → +Soft Overlong Punishment 41 → +Token-level Loss 42 → +Dynamic Sampling **50**。

### 1. Clip-Higher：对称 $\varepsilon$ → 解耦 $\varepsilon_{\mathrm{low}} < \varepsilon_{\mathrm{high}}$

**GRPO 的问题。** 对称 clip 把 $\rho$ 卡在 $[1-\varepsilon,1+\varepsilon]$，$\varepsilon=0.2$ 即 $[0.8,1.2]$。$\hat{A}>0$ 时真正生效的是**上沿** $1+\varepsilon$：

- 已经很常见的 token，$\pi_{\mathrm{old}}=0.9$，上沿允许到 $0.9\times 1.2=1.08$（概率饱和，等于几乎不限制）；
- 低概率探索 token，$\pi_{\mathrm{old}}=0.01$，上沿只允许到 $0.012$。想靠正优势把一个新推理词抬起来，一步几乎动不了。

于是策略很快变尖、熵崩、一组 $G$ 个回答几乎一个样，探索没了。论文观察到被上沿卡住的 token，其 $\pi_\theta$ 均值常低于 $0.2$。

**DAPO 的做法。** 上沿、下沿分开：$\varepsilon_{\mathrm{high}}=0.28$（上沿到 $1.28$），$\varepsilon_{\mathrm{low}}$ 仍是 $0.2$（下沿仍 $0.8$）。只放松「好 token 往上抬」，不放松「坏 token 往下砸」。

**为什么下沿不能一起加大。** 加大 $\varepsilon_{\mathrm{low}}$ 会让 $1-\varepsilon_{\mathrm{low}}$ 更小，负优势 token 能被压得更狠，容易压到 $0$，采样空间塌掉。所以叫 Clip-**Higher**：只抬天花板。

**影响。** 熵不再断崖，回答多样性保住，后续长度和反射（reflection）才有空间长出来。消融上这一步 36→38，幅度不大，但是后面所有探索相关改进的前提；没有它，动态采样也只是在同一套近乎重复的回答里挑。

### 2. Dynamic Sampling：全用 → 丢掉「全对 / 全错」组

**GRPO 的问题。** 组内奖励全相同 $\Rightarrow$ $\mathrm{std}=0$ $\Rightarrow$ $\hat{A}=0$ $\Rightarrow$ 该组政策梯度为 $0$。训练越往后，简单题全对比例升高（论文 Figure 3b），一个 batch 里有效 prompt 越来越少，梯度更噪、有效信号更弱，算力浪费在零梯度组上。

**DAPO 的做法。** 约束

$$
0 < \bigl|\{o_i \mid \mathrm{is\_equivalent}(a, o_i)\}\bigr| < G
$$

即组内正确条数严格在 $(0, G)$ 之间。不满就继续采、过滤、往 buffer 里填，直到有效 prompt 数够一个训练 batch。

**影响。**

- 每个梯度步的优势都非零，batch 有效样本量稳定，梯度方差下来。
- 采样次数变多，但同步 RL 的生成时间往往被最长样本绑死，多丢几道全对题不一定成比例变慢；论文里同一性能反而更早达到（更少更新步）。
- 消融最大头：42→50。面试可说：**GRPO 后期大量零梯度组是样本效率的主因，DAPO 用过滤把有效梯度密度拉满。**
- 代价：特别难、目前 $G$ 次全错的题也被丢掉，模型暂时学不到「这题完全不会」的信号；特别简单的全对题也不再练，存在课程学习被截断的味道。实践上靠模型变强后难词自然进入「有对有错」区间。

### 3. Token-Level Policy Gradient Loss：句平均 → 全体 token 平均

**GRPO 的问题。** 聚合是

$$
\frac{1}{G}\sum_i \frac{1}{|o_i|}\sum_t \ell_{i,t}
$$

每条回答权重相等。长度为 $L$ 的句子里，单个 token 权重 $\propto 1/L$。long-CoT 下 $L$ 差一个数量级很常见：

- 高质量长推理（反射、回退、多步验证）里，真正有用的 token 被摊薄，模型难学会这些模式；
- 又臭又长的重复 / 胡话，每个垃圾 token 的负优势也弱，惩罚不够。论文观察到**不开 token-level 时熵和长度会病态往上飙**。

**DAPO 的做法。**

$$
\frac{1}{\sum_{i=1}^{G}|o_i|}\sum_{i=1}^{G}\sum_{t=1}^{|o_i|} \ell_{i,t}
$$

组里每个有效 token 权重相同。长句对梯度的贡献正比于长度；同一种生成模式，无论出现在短句还是长句，被加强或被压的力度一样。

**影响。** 消融 41→42，分数涨得少，但论文强调 **训练更稳、长度增长更健康**。面试别说成「DAPO 把优势改成 token 级」——优势仍是序列级 z-score；变的是 **loss 的归一项**。verl / TRL 里对应 `loss_agg_mode=token-mean` vs GRPO 默认的 `seq-mean-token-mean`。

### 4. Overlong Reward Shaping：截断噪声 → 掩码或软惩罚

**GRPO 的问题。** 生成有 `max_length`，超长被截断。若直接给截断样本一个惩罚分，一段**推理是对的、只是还没写完**的回答会被当成错的。模型分不清「逻辑错了」还是「写太长了」，奖励噪声大，训练抖。

**DAPO 的两种药。**

1. **Overlong Filtering**：截断样本的 loss mask 置 $0$，不进梯度。消融里朴素 GRPO 30→36，单步收益很大。
2. **Soft Overlong Punishment**：在硬截断前留一段缓冲 $L_{\mathrm{cache}}$，按超出长度线性扣分，加到规则奖励上：

$$
R_{\mathrm{length}}(y)=
\begin{cases}
0, & \lvert y\rvert \le L_{\max}-L_{\mathrm{cache}} \\[4pt]
\dfrac{(L_{\max}-L_{\mathrm{cache}}) - \lvert y\rvert}{L_{\mathrm{cache}}}, & L_{\max}-L_{\mathrm{cache}} < \lvert y\rvert \le L_{\max} \\[8pt]
-1, & \lvert y\rvert > L_{\max}
\end{cases}
$$

| 符号 | 论文取值 | 含义 |
|------|----------|------|
| $\lvert y\rvert$ | — | 回答长度 |
| $L_{\max}$ | $16384$ | 期望的「正常最大长度」 |
| $L_{\mathrm{cache}}$ | $4096$ | 软惩罚区间宽度 |
| 生成上限 | $20480$ | $L_{\max}+L_{\mathrm{cache}}$，超过则硬截断并 $R_{\mathrm{length}}=-1$ |

在 $[L_{\max}-L_{\mathrm{cache}}, L_{\max}]$ 里，$R_{\mathrm{length}}$ 从 $0$ 线性降到 $-1$。最终奖励是正确性项 $+R_{\mathrm{length}}$，再做组内 z-score。模型收到的是「写对但偏长，扣一点」，不是「直接当全错」。

**影响。** Filtering 去噪、稳定熵；Soft Punishment 再给一个可微的长度信号（38→41）。过长不再被误当成推理失败，长度可以长、但有软天花板。

## 另一处：去掉 KL

GRPO 在 loss 里加 $\beta D_{\mathrm{KL}}(\pi_\theta \parallel \pi_{\mathrm{ref}})$（DeepSeekMath $\beta=0.04$），$\pi_{\mathrm{ref}}$ 一般是 RL 起点的 SFT。RLHF 要对齐且别离人类语言太远，这项合理。

long-CoT 推理要的是**新行为**（自检、回退、更长思维链），分布本来就该远离 base。KL 会把这些新模式往回拽。DAPO 整项删掉，探索上限交给 Clip-Higher，别跑飞交给下沿 clip 和超长整形。

代价：没有显式「别离 base 太远」。奖励一噪（格式 hack、长度 hack），更依赖规则奖励干净、clip 还在。这是 DAPO 绑在可验证任务（数学、代码）上更顺、开放式对话要对齐时仍常留 KL 的原因。

## 设计影响一张图

```
朴素 GRPO
  组内 z-score + 对称 clip + 样本级平均 + KL + 截断当负例
        │
        ├─ Overlong Filtering     → 去掉「写对但截断」的假负例，稳、+6 分
        ├─ Clip-Higher            → 上沿松开，熵不崩，探索能持续
        ├─ Soft Overlong Penalty  → 长度有软信号，不是一刀切
        ├─ Token-level Loss       → 长 CoT 与垃圾长文按 token 公平计，长度健康
        ├─ Dynamic Sampling       → 零梯度组不进 batch，有效信号密度拉满（最大头）
        └─ 去掉 KL                → 允许推理分布远离 base
        ▼
DAPO
```

## 总结对照

| 维度 | GRPO | DAPO | 这一改的影响 |
|------|------|------|----------------|
| 优势 | 组内 $(R-\mathrm{mean})/\mathrm{std}$，句内恒定 | **相同** | 底座没换 |
| 奖励 | RM 或 $\{0,1\}$ 规则 | 可验证任务 $\{+1,-1\}$ + 可选长度项 | 错的从 $0$ 变 $-1$ 不改 z-score 形状；长度项进 $R$ 再标准化 |
| clip | 对称 $\varepsilon$（常 $0.2$） | $\varepsilon_{\mathrm{low}}=0.2<\varepsilon_{\mathrm{high}}=0.28$ | 防熵坍缩，保住探索 |
| 哪些组进训练 | 全用，含 std=0 | 只留有对有错 | 消灭零梯度，样本效率最高的一刀 |
| loss 聚合 | $\frac{1}{G}\sum_i\frac{1}{\lvert o_i\rvert}\sum_t$ | $\frac{1}{\sum_i\lvert o_i\rvert}\sum_i\sum_t$ | 去长度偏置，长推理学得进、烂长文罚得到 |
| 超长 | 常直接当负奖励 | mask 或软惩罚 | 降奖励噪声 |
| KL | 有，$\beta>0$ | **无** | 放开推理分布；约束改由 clip 承担 |

> **一句话：** DAPO 的优势函数就是 GRPO 的组内 z-score；差别全在目标函数——非对称更高上沿（熵不崩）、丢掉全对/全错组（有梯度）、token 平均（破长度偏置）、超长整形（降噪），再去掉 KL。四补丁叠在 Qwen2.5-32B 上把 AIME 从 30 拉到 50，其中动态采样是分数上的最大头，token-level 更多是稳长度。
