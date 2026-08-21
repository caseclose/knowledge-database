# DAPO 和 GRPO 的区别

> 创建时间：2026-08-20 ｜ 最新更新：2026-08-21 ｜ 标签：面试

DAPO（Decoupled Clip and Dynamic sAmpling Policy Optimization，字节 2025 开源）不是全新算法，而是在 **GRPO 基础上打的四个补丁**，用来解决大规模 long-CoT RL 里 GRPO 暴露的熵坍缩、奖励噪声、训练不稳等问题。在 Qwen2.5-32B 上把 AIME 2024 从朴素 GRPO 的约 30 分提到 **50 分**（且用更少步数超过 DeepSeek-R1-Zero-Qwen-32B 的 47 分）。

## 相同的底座

两者都：无 critic、对同一 prompt 采样一组回答、用**组内标准化奖励**做优势（见 GRPO 优势函数）。DAPO 改的是**裁剪、采样、损失聚合、奖励整形**这几处，并**去掉 KL 惩罚**。

## 四项核心改进

| 改进 | GRPO 的问题 | DAPO 的做法 |
|------|------------|------------|
| **Clip-Higher** | 对称裁剪 $[1-\varepsilon, 1+\varepsilon]$ 压制低概率 token 概率上升，导致**熵坍缩**、探索不足 | 解耦上下界，$\varepsilon_{\mathrm{low}} < \varepsilon_{\mathrm{high}}$，给正向更新更大上限，鼓励探索、保住熵 |
| **Dynamic Sampling** | 组内奖励全同（std=0）时优势为 0、**无梯度**，还浪费算力 | 只保留奖励有差异（std>0）的组，持续采样并跨批累积，直到凑满一个有效 batch |
| **Token-Level Policy Gradient Loss** | 先按样本内 token 平均、再对样本平均，长回答被稀释 → **长度偏置**，不利长 CoT | 改为对一组内**所有 token 一起平均**（token-mean），每个 token 权重不受回答长短影响 |
| **Overlong Reward Shaping** | 超长被截断的回答带来**奖励噪声**，干扰训练 | 超长过滤（把超长回答 loss mask 置 0）或软惩罚（超过阈值按超出长度递增扣分） |

## 另一处区别：去掉 KL

GRPO 保留对参考模型的 KL 惩罚。DAPO **移除 KL 项**，进一步释放探索空间（代价是失去 KL 正则，需靠 clip 等机制约束策略别跑飞）。

## 目标函数直观对比

```
GRPO:  组内标准化优势 + 对称 clip + KL 惩罚，样本级 loss 平均
DAPO:  组内标准化优势 + 非对称 clip(高) + 动态采样 + token 级 loss 平均 + 超长整形，无 KL
```

## 总结

| 维度 | GRPO | DAPO |
|------|------|------|
| 裁剪 | 对称 $\varepsilon$ | 非对称 $\varepsilon_{\mathrm{low}} < \varepsilon_{\mathrm{high}}$ |
| 采样 | 全用（含 std=0 组） | 过滤 std=0，动态补批 |
| loss 聚合 | 样本级平均（长度偏置） | token 级平均 |
| 超长回答 | 直接计入，含噪声 | 过滤 / 软惩罚 |
| KL | 有 | 无 |

> **一句话：** DAPO = GRPO + 四个补丁（Clip-Higher 防熵坍缩、Dynamic Sampling 去零梯度组、Token-Level Loss 破长度偏置、Overlong Reward Shaping 降噪）并去掉 KL，专门让大规模 long-CoT RL 训得稳、涨得动。
