# GRPO 的优势函数是怎么算的？

> 创建时间：2026-08-20 ｜ 最新更新：2026-08-21 ｜ 标签：面试

GRPO（Group Relative Policy Optimization，DeepSeek 提出）是当前 LLM RL 后训练的主流算法之一。它相对 PPO 最大的改动，就是**扔掉了 critic（value 网络）**，改用「一组样本内部互相比较」来估计优势（advantage）。

## 原理：用组内相对奖励代替 critic

PPO 需要一个和 policy 同规模的 value 网络来估计基线 $V(s)$，再算 GAE 优势——显存和工程成本都高。GRPO 换了个思路：

1. 对同一个 prompt $q$，用当前策略采样**一组 $G$ 个回答** $\{o_1, \ldots, o_G\}$；
2. 用奖励模型/规则给每个回答打分 $\{r_1, \ldots, r_G\}$；
3. 用**组内均值和标准差**把奖励标准化，作为该回答（其所有 token 共享）的优势：

$$
A_i = \frac{r_i - \operatorname{mean}(\{r_1,\ldots,r_G\})}{\operatorname{std}(\{r_1,\ldots,r_G\})}
$$

也就是说，基线不再由 value 网络给出，而是**同一 prompt 下其他回答的平均表现**。比同组平均好 → 正优势、被强化；比平均差 → 负优势、被抑制。

## 目标函数（含 clip 与 KL）

GRPO 沿用 PPO 的重要性采样比 $\rho = \pi_\theta / \pi_{\mathrm{old}}$ 与裁剪，对组内所有回答的所有 token 求平均，并加一项对参考模型的 KL 惩罚：

$$
J(\theta)=\mathbb{E}_{q,\{o_i\}\sim\pi_{\mathrm{old}}}\left[
\frac{1}{G}\sum_i \frac{1}{|o_i|}\sum_t
\min\bigl(\rho_{i,t}\,A_i,\;\operatorname{clip}(\rho_{i,t},1-\varepsilon,1+\varepsilon)\,A_i\bigr)
\right]
-\beta\cdot\mathrm{KL}(\pi_\theta\parallel\pi_{\mathrm{ref}})
$$

- $A_i$ 对回答 $o_i$ 内每个 token 相同（token 级细分交给后续算法如 DAPO）。
- KL 项把策略拉住、防止跑偏。

## 关键特点与坑

| 特点 | 说明 |
|------|------|
| 无 critic | 省一个大网络的显存与训练，工程简单 |
| 相对优势 | 基线 = 组内均值，只关心「组内相对好坏」 |
| 对奖励尺度鲁棒 | 除以 std 做了归一化 |
| **std=0 退化** | 若一组回答奖励全相同（全对/全错），std→0、优势为 0，该组**没有梯度信号**，是效率痛点（DAPO 的 Dynamic Sampling 专治此问题） |

## 总结

> **一句话：** GRPO 的优势函数是「组内奖励标准化」——$A_i=(r_i-\mathrm{mean})/\mathrm{std}$，用同一 prompt 下一组采样的相对表现取代 PPO 的 value 网络基线，省显存但当组内奖励无差异（std=0）时会失去梯度。
