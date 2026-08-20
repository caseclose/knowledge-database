# vLLM 部署 GLM-5.2 的 5 个关键坑

> 创建时间：2026-07-14 ｜ 最新更新：2026-07-14

## 1. 必须用 cu129 构建，不能用默认 cu13

`pip install vllm==0.24.0` 默认装 **cu130 构建**（torch 2.11+cu130 + `vllm._C` 依赖 `libcudart.so.13`），但机器驱动是 CUDA 12.9，会报：

```
RuntimeError: The NVIDIA driver on your system is too old (found version 12090)
```

或：

```
ImportError: libcudart.so.13: cannot open shared object file
```

**解法**——装 cu129 构建：

```bash
BIN=/path/to/glm52/env/bin

# torch 2.11.0 cu129
$BIN/pip install --index-url https://download.pytorch.org/whl/cu129 \
    torch==2.11.0+cu129 torchaudio==2.11.0+cu129 torchvision==0.26.0+cu129

# vllm 0.24.0 cu129（wheels.vllm.ai 索引页 href 指向 commit-hash 路径，需先解析）
$BIN/pip install --no-deps --force-reinstall \
    "https://wheels.vllm.ai/<commit-hash>/vllm-0.24.0%2Bcu129-cp38-abi3-manylinux_2_28_x86_64.whl"
```

cu129 wheel 索引：https://wheels.vllm.ai/0.24.0/cu129/vllm/

## 2. flashinfer JIT 编译需要 CUDA 头文件 + 无版本号 `.so` 软链

vLLM 启动时 flashinfer 须运行时编译 `fp8_blockscale_gemm_sm90` 内核。需要两样东西：

**头文件** — `cublasLt.h` 等不在系统 `/usr/local/cuda/include` 下，而在 pip nvidia 分库的 `include/` 里。用 `CPATH` 添加：

```bash
NV_PKG="$CONDA_ENV_BIN/../lib/python3.12/site-packages/nvidia"
for d in cublas cuda_runtime cusparse cusolver curand cufft cuda_nvrtc; do
    [ -d "$NV_PKG/$d/include" ] && export CPATH="$NV_PKG/$d/include:$CPATH"
done
export CPATH="/usr/local/cuda/include:$CPATH"
```

**无版本号 `.so` 软链** — ld 找 `libnvrtc.so` 但系统只有 `libnvrtc.so.12`。建专用目录：

```bash
mkdir -p cuda_link
ln -sf /usr/local/cuda/lib64/libnvrtc.so.12  cuda_link/libnvrtc.so
ln -sf $NV_PKG/cuda_runtime/lib/libcudart.so.12 cuda_link/libcudart.so
ln -sf $NV_PKG/cublas/lib/libcublas.so.12     cuda_link/libcublas.so
ln -sf $NV_PKG/cublas/lib/libcublasLt.so.12  cuda_link/libcublasLt.so
ln -sf /usr/local/cuda/lib64/stubs/libcuda.so cuda_link/libcuda.so
export LIBRARY_PATH="cuda_link:$LIBRARY_PATH"
export LD_LIBRARY_PATH="cuda_link:/usr/local/cuda/lib64:$LD_LIBRARY_PATH"
```

诊断错误的快速对照：
- `fatal error: cublasLt.h: No such file or directory` → 缺 CPATH
- `/usr/bin/ld: cannot find -lnvrtc` → 缺无版本号软链

编译产物缓存在 `/root/.cache/flashinfer/*/cached_ops/`，第二节点首次无缓存会编译几分钟，之后复用。

## 3. KV cache 是硬数学：单机 VS 双机

| 部署 | 每卡权重 | 可用 KV cache | 128K | 1M |
|------|---------|--------------|------|----|
| 单机 8×H20 | 88.88 GiB (93%) | ~0.03 GiB ❌ | 无法启动 | 不可能 |
| 双机 16×H20 | 45.41 GiB (47%) | 34 万 tokens ✅ | 并发 2.6× | 需要更多卡 |

MoE 即便 FP8 仍占满几乎整卡。util 99% 都没用——这是纯显存数学，不是参数调优问题。报错：

```
ValueError: KV cache needed (2.83 GiB) > available (0.03 GiB)
```

唯一解法：加 GPU。

## 4. 代理隔离

下载挂代理，推理必须清代理，否则 curl/API client 连 127.0.0.1:8080 时请求走代理：

```bash
# 下载 — 挂
export http_proxy=http://<PROXY>:<PORT>
# 推理 — 清
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
export no_proxy="127.0.0.1,localhost,<MASTER_IP>,<WORKER_IP>"
```

`.bashrc` 顶部 `[ -z "$PS1" ] && return` 会让 non-interactive shell 早退，exports 对 codex 子进程不生效。用 **alias** 强置：

```bash
alias codex='VLLM_API_KEY=not-needed no_proxy="127.0.0.1,localhost,..." codex'
```

多节点 ray 设 `NCCL_SOCKET_IFNAME=bond1`。

## 5. Codex CLI 参数两套体系

```
交互:  codex -s danger-full-access -a never
exec:  codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check "prompt"
```

`-a never` 在 `codex exec` 模式会报参数错误，不能混用。

## 总结

| 坑 | 根因 | 修法 |
|----|------|------|
| CUDA 版本报错 | pip 默认 cu13，驱动 12.9 | cu129 wheel |
| flashinfer 编译失败 | 缺头文件和无版本号 so | CPATH + cuda_link |
| 单机 KV cache=0 | 权重占 93% 显存 | 必须双机 |
| codex 连不上 API | 代理残留 / bashrc 早退 | alias + no_proxy |
| codex exec 参数报错 | exec 模式不支持 -a never | --dangerously-bypass-approvals-and-sandbox |

> **一句话：** cu129 构建 + cuda_link 软链 + 多节点 TP + 彻底清代理，四条对了 vLLM 才能顺畅部署 GLM-5.2。
