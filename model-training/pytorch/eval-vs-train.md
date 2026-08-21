# `model.eval()` 和 `model.train()` 分别做什么？

> 创建时间：2026-08-21 ｜ 最新更新：2026-08-21 ｜ 标签：面试

它们**不冻结参数、也不关梯度**。只是递归地把每个子模块的 `training` 标志设成 `False` / `True`，让 **Dropout、BatchNorm** 这类「训练和推理行为不同」的层切换模式。

```python
model.train()   # 等价于 model.train(True)，默认就是这个
model.eval()    # 等价于 model.train(False)
```

实现上就是遍历 `self.modules()`，设 `module.training = mode`。线性层、Conv、LayerNorm、大多数 Attention **两种模式前向一样**，所以纯 Transformer 有时「忘了 eval 看起来也能跑」——有 BN / Dropout 时就会踩坑。

## 真正会变的层

| 层 | `train()` | `eval()` |
|----|-----------|----------|
| **Dropout** | 按 `p` 随机置零，其余放大 $1/(1-p)$ | 不丢，全量通过 |
| **BatchNorm** | 用**当前 batch** 的均值/方差，并更新 `running_mean` / `running_var` | 用训练期累计的 running 统计量，**不再更新** |
| Dropout2d / StochasticDepth 等 | 同样按训练随机 | 关闭随机 |

BatchNorm 训练态：

$$
\hat{x} = \frac{x - \mu_B}{\sqrt{\sigma_B^2 + \epsilon}}, \quad
\mu_{\mathrm{run}} \leftarrow (1-\momentum)\,\mu_{\mathrm{run}} + \momentum\,\mu_B
$$

推理态用 $\mu_{\mathrm{run}}, \sigma_{\mathrm{run}}$ 代替 $\mu_B, \sigma_B$。所以 **eval 里 BN 输出是确定的**；train 里同一张图、不同 batch 同伴，BN 结果会变。

## 和 `no_grad` / `requires_grad` 不是一回事

| 想做的事 | 该调什么 |
|----------|----------|
| Dropout / BN 走推理逻辑 | `model.eval()` |
| 不建计算图、省显存 | `torch.no_grad()` 或 `torch.inference_mode()` |
| 冻住某些参数不更新 | `p.requires_grad = False`（再配 optimizer） |

标准验证/推理：

```python
model.eval()
with torch.no_grad():
    logits = model(x)
```

只写 `no_grad` 却不 `eval()`：梯度没了，但 Dropout 仍在随机丢、BN 仍按当前 batch 更新 running stats——验证指标会抖，长期还会把 BN 统计量污染掉。

只写 `eval()` 却不 `no_grad()`：模式对了，但仍占 autograd 显存，推理更慢。

验证结束要继续训练时，**必须** `model.train()`，否则后面 epoch 的 Dropout/BN 还停在推理态。

## 面试里常追问的坑

- **不是** `eval()` = 不训练。`loss.backward()` + `optimizer.step()` 在 `eval()` 下仍能改权重，只是 BN/Dropout 行为不对。
- 验证循环忘了切回 `train()`，后面训练像「没 Dropout、BN 也不更新」。
- 训练态 BN 在 **batch size=1**（或跨卡后每卡 1 张图）时，batch 方差不稳定甚至为 0，数值炸掉；推理必须 `eval()` 用 running stats。
- `model.eval()` 不会关掉 `hook`，也不会让 `torch.compile` 失效。
- HuggingFace `AutoModel` 同样：生成/评测前 `model.eval()`，不要只靠 `torch.no_grad()`。

## 总结

| 调用 | 改变什么 | 不改变什么 |
|------|----------|------------|
| `train()` / `eval()` | `module.training` → Dropout、BN 等的前向逻辑 | 参数值、`requires_grad`、是否反传 |
| `no_grad()` | 是否记录梯度 | Dropout / BN 模式 |

> **一句话：** `train()` / `eval()` 只切换模块的 `training` 标志（Dropout 是否随机、BN 用 batch 统计还是 running 统计）；关梯度要另写 `torch.no_grad()`，验证完继续训练记得切回 `train()`。
