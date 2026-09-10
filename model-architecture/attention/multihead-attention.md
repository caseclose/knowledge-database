# Multi-Head Attention：手写代码、dropout、`transpose(1,2)` 和缩放

> 创建时间：2026-09-10 ｜ 最新更新：2026-09-10 ｜ 标签：面试

面试常要求当场写出 Multi-Head Attention，并追问三件事：dropout 加在哪、为什么要转置、为什么除以根号 head dimension。公式本身很短：

$$
\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right)V
$$

多头只是把 $d_{\mathrm{model}}$ 拆成 $h$ 个头、每个头在 $d_k=d_{\mathrm{model}}/h$ 维上独立算上面这式，再拼回去做一次输出投影。

## 手写代码

约定：$B$=batch，$T$=seq_len，$C=d_{\mathrm{model}}$，$H$=num_heads，$d_k=C/H$。

```python
import math
import torch
import torch.nn as nn
import torch.nn.functional as F


class MultiHeadAttention(nn.Module):
    def __init__(self, d_model, num_heads, attn_dropout=0.1):
        super().__init__()
        assert d_model % num_heads == 0
        self.num_heads = num_heads
        self.head_dim = d_model // num_heads  # d_k

        self.q_proj = nn.Linear(d_model, d_model)
        self.k_proj = nn.Linear(d_model, d_model)
        self.v_proj = nn.Linear(d_model, d_model)
        self.out_proj = nn.Linear(d_model, d_model)
        self.attn_dropout = nn.Dropout(attn_dropout)

    def forward(self, x, mask=None):
        B, T, C = x.shape

        q = self.q_proj(x)  # (B, T, C)
        k = self.k_proj(x)
        v = self.v_proj(x)

        # (B, T, C) -> (B, T, H, d_k) -> (B, H, T, d_k)
        q = q.view(B, T, self.num_heads, self.head_dim).transpose(1, 2)
        k = k.view(B, T, self.num_heads, self.head_dim).transpose(1, 2)
        v = v.view(B, T, self.num_heads, self.head_dim).transpose(1, 2)

        # (B, H, T, d_k) @ (B, H, d_k, T) -> (B, H, T, T)
        scores = (q @ k.transpose(-2, -1)) / math.sqrt(self.head_dim)

        if mask is not None:
            scores = scores.masked_fill(mask == 0, float("-inf"))

        attn = F.softmax(scores, dim=-1)
        attn = self.attn_dropout(attn)          # dropout ①：注意力权重

        out = attn @ v                          # (B, H, T, d_k)
        out = out.transpose(1, 2).contiguous().view(B, T, C)
        return self.out_proj(out)
```

Transformer Block 里还有第二次 dropout（残差之前）：

```python
class TransformerBlock(nn.Module):
    def __init__(self, d_model, num_heads, dropout=0.1):
        super().__init__()
        self.ln1 = nn.LayerNorm(d_model)
        self.attn = MultiHeadAttention(d_model, num_heads, attn_dropout=dropout)
        self.resid_dropout = nn.Dropout(dropout)  # dropout ②：子层输出

    def forward(self, x, mask=None):
        # Pre-LN：x = x + Dropout(MHA(LN(x)))
        x = x + self.resid_dropout(self.attn(self.ln1(x), mask))
        return x
```

形状对照：

| 步骤 | 形状 | 在做什么 |
|------|------|----------|
| `x` / `q,k,v` | `(B, T, C)` | 每个 token 一份 $d_{\mathrm{model}}$ 向量 |
| `view(..., H, d_k)` | `(B, T, H, d_k)` | **按 token** 把最后一维切成 $H$ 个头 |
| `transpose(1, 2)` | `(B, H, T, d_k)` | 把头当成独立的 batch 维 |
| `q @ k.transpose(-2,-1)` | `(B, H, T, T)` | 每个头各自算 token-token 相似度 |
| `attn @ v` | `(B, H, T, d_k)` | 按注意力权重混合 Value |
| 再 `transpose(1,2)` + `view` | `(B, T, C)` | 把头拼回 $d_{\mathrm{model}}$，交给 `out_proj` |

## Dropout 加在哪

标准实现就两处，面试答这两处就够：

| 位置 | 作用对象 | 为什么 |
|------|----------|--------|
| **① Attention Dropout** | `softmax` **之后**、乘 $V$ **之前** 的注意力矩阵 | 随机掐断若干 token↔token 连接，防止过度依赖某几个位置 |
| **② Residual Dropout** | `out_proj` 之后、**加残差之前** 的子层输出 | 论文里的 Residual Dropout；FFN 子层同样加。通常写在 Block 里，不写在 MHA 内部 |

不要搞反的几件事：

- **不要**在 softmax 之前对 `scores` 做 dropout。置零会破坏即将归一化的分布，和 `-inf` mask 叠在一起更乱。
- **不要**把 dropout 加在 $Q/K/V$ 投影上当成「标准 MHA」。那是 DropKey / DropQuery 一类变体，不是 Vaswani / BERT / GPT-2 的默认做法。
- `nn.MultiheadAttention(dropout=p)` 的 `p` 就是 ①；② 要自己在 Block 里加。
- 推理必须 `model.eval()`，否则 ①② 仍会随机丢（详见 `eval()` vs `train()` 那篇）。

## 为什么要 `transpose(1, 2)`

线性层吐出来的是 `(B, T, C)`，内存布局是：每个 token 的 $C$ 维里，前 $d_k$ 是 head 0，接着 $d_k$ 是 head 1……所以必须先：

```python
q.view(B, T, H, d_k)   # 正确：沿最后一维按 head 切开
```

此时形状是 `(B, T, H, d_k)`。接下来的 `q @ k^T` 默认乘的是**最后两维**。我们要的是「每个头内部，token 和 token 做点积」，也就是最后两维必须是 `(T, d_k)` 和 `(d_k, T)`。因此把头和序列对调：

```python
q.transpose(1, 2)      # (B, T, H, d_k) -> (B, H, T, d_k)
```

$H$ 被挪到 batch 维旁边，后面的 batched matmul 就对 $H$ 个头**并行、互不干扰**。

两个常见错法：

1. 漏掉 `transpose(1, 2)`，直接 `view(B, T, H, d_k)` 去乘。  
   `q @ k.transpose(-2, -1)` 变成 `(B, T, H, d_k) @ (B, T, d_k, H)` → `(B, T, H, H)`。这是在每个 token 上算 head 与 head 的相似度，完全不是注意力。

2. 直接 `view(B, H, T, d_k)`，省掉 transpose。  
   `view` 按内存顺序切块，会把不同 token 的特征拼进同一个 head，head 切分是错的。必须先 `view(B, T, H, d_k)` 再 `transpose(1, 2)`（或等价的 `einops.rearrange(..., 'b t (h d) -> b h t d', h=H)`）。

注意代码里还有另一个转置 `k.transpose(-2, -1)`：那是把 `(B, H, T, d_k)` 变成 `(B, H, d_k, T)`，专为 $QK^\top$ 服务，和 `transpose(1, 2)` 不是一回事。乘完 $V$ 之后还要再 `transpose(1, 2)` 把头拼回去。

## 为什么要除以 √dₖ

假设 $q,k$ 各维近似独立、均值 0、方差 1，则点积 $q\cdot k=\sum_{i=1}^{d_k} q_i k_i$ 的方差约为 $d_k$，标准差约为 $\sqrt{d_k}$。$d_k$ 越大，点积绝对值越大。

softmax 对大输入会**饱和**：一个位置接近 1，其余接近 0，梯度几乎为 0，训练不稳。除以 $\sqrt{d_k}$ 把分数的方差拉回 $O(1)$，softmax 才落在梯度还在的区间：

$$
\mathrm{Var}\!\left(\frac{q\cdot k}{\sqrt{d_k}}\right)\approx 1
$$

所以缩放因子是 **head 维度** $d_k$，不是 $d_{\mathrm{model}}$。多头之后每个头更窄，$d_k$ 变小，缩放也跟着变。面试若追问「能不能除 $d_k$」：除 $d_k$ 会把分数压得过小，softmax 接近均匀，注意力变钝。

因果 mask / padding mask 在缩放**之后**、softmax **之前**把非法位置填成 `-inf`（不要填成很大的负数凑合：和缩放、混合精度叠在一起可能 mask 不住）。

## 总结

> **一句话：** 先 `view(B,T,H,d_k)` 再 `transpose(1,2)` 把头变成独立 batch 维，才能做 token-token 的 $QK^\top$；除以 $\sqrt{d_k}$ 是为了让点积方差不随维度爆炸、softmax 不饱和；dropout 加两处——softmax 后的注意力权重，以及 `out_proj` 后、残差前的子层输出。
