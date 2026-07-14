# 如何双节点 16×H20 部署 GLM-5.2-FP8 并接 Codex CLI？

## 背景

GLM-5.2 是智谱最新旗舰模型，704 GB block-fp8 权重（`GlmMoeDsaForCausalLM`，MoE + DSA 架构），官方 vLLM 推理 recipe 推荐 v0.23+ 搭配 `transformers >= 5.12`。单机 8×H20（每卡 95 GiB）权重就占 93% 显存，KV cache 几乎为 0，必须双节点。

## 部署成果

| 项目 | 值 |
|------|----|
| 模型 | `zai-org/GLM-5.2-FP8`（704 GB，141 分片） |
| 推理引擎 | vLLM `0.24.0+cu129` + transformers `5.13.0` + torch `2.11.0` |
| 并行 | TP=16（ray 编排，双节点各 8× H20 @ bond1） |
| 每卡显存 | 权重 ~45 GiB，KV cache 34 万 tokens，128K 上下文并发 2.6× |
| API | `http://<MASTER_IP>:8080/v1`（主节点，OpenAI 兼容） |
| 环境 | 独立 conda 环境 `glm52`（Python 3.12），共享 cephfs，第二节点无需重装 |

## 节点信息

| 节点 | IP | 卡 | 登录 |
|------|----|----|----|
| 主节点 (head) | `<MASTER_IP>` | 8× H20 96 GiB | 本地 shell |
| 第二节点 (worker) | `<WORKER_IP>` | 8× H20 96 GiB | SSH |

共享盘 `<SHARED_MOUNT>` 两节点均挂载，conda 环境 `<SHARED_MOUNT>/<USER>/miniconda3/envs/glm52`、权重 `<SHARED_MOUNT>/models/huggingface/zai-org/GLM-5.2-FP8` 直接可用。

硬件：H20 96 GiB × 2 节点，NCCL 走高速网络。

## 启动流程（三步）

### Step 1 — 主节点起 ray head

```bash
BIN=<SHARED_MOUNT>/<USER>/miniconda3/envs/glm52/bin
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
export no_proxy="localhost,127.0.0.1,<MASTER_IP>,<WORKER_IP>"

$BIN/ray stop 2>/dev/null; sleep 2
$BIN/ray start --head --node-ip-address=<MASTER_IP> --port=6379 \
    --dashboard-host=0.0.0.0 --num-gpus=8
```

### Step 2 — 第二节点连入

方式 A：主节点通过 SSH 远程执行

```bash
ssh <WORKER_IP> "unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY; \
   export no_proxy=localhost,127.0.0.1,<MASTER_IP>,<WORKER_IP>; \
   <SHARED_MOUNT>/<USER>/miniconda3/envs/glm52/bin/ray stop 2>/dev/null; sleep 2; \
   <SHARED_MOUNT>/<USER>/miniconda3/envs/glm52/bin/ray start --address=<MASTER_IP>:6379 --node-ip-address=<WORKER_IP> --num-gpus=8"
```

方式 B：手动 SSH 登录第二节点后执行同样的 `ray start` 命令。

### Step 3 — 主节点验证并启动 vLLM

```bash
$BIN/ray status                                # 应显示 16.0 GPU
cd <SHARED_MOUNT>/<USER>/code/glm_deploy
nohup ./deploy_vllm.sh > vllm_multinode.log 2>&1 &
tail -f vllm_multinode.log                     # 等 "Application startup complete"
```

首次启动约 25-30 分钟（权重加载 + flashinfer JIT 编译 + CUDA graph 捕获）。

### 关闭服务

```bash
ps aux | grep -E '[v]llm serve|[m]ultiproc_executor' | awk '{print $2}' | xargs -r kill -9
$BIN/ray stop                                   # 主节点
# 第二节点：
python3 node2_exec.py "$BIN/ray stop"
```

## 请求验证

```bash
curl --noproxy '*' -s -m 5 http://<MASTER_IP>:8080/v1/models
# 应返回 JSON 含 "id": "glm-5.2"
```

## 总结

| 关键点 | 做法 |
|--------|------|
| env 隔离 | conda glm52，vLLM 0.24+cu129，不要用系统自带 vLLM 0.17 |
| 显存不足 | 单机 88.88 GiB/卡几乎没 KV cache → 必须双机 TP=16 |
| ray 编排 | ray head 在主节点，worker 在第二节点，走 bond1 |
| 代理 | 下载走 `<PROXY>`，推理必 unset 全部代理 |
| 共享 cephfs | env/权重/脚本 两节点自动可见，第二节点零安装 |

> **一句话：** 双节点 16×H20 跑 TP=16，用 ray 编排。启动三步：主 ray head → 次 ray worker → vllm serve。conda glm52 + cu129 构建，共享 cephfs.
