# 🦞 OpenClaw Recall🦞

**Other Language: [English](https://github.com/Felix201209/openclaw-recall/blob/main/README.md)**

**OpenClaw 的持久记忆、上下文压缩与运行状态可视化插件。🦞**

<p align="center">
  <img
    width="744"
    height="193"
    alt="OpenClaw Recall Banner"
    src="https://github.com/user-attachments/assets/deb61efe-93a8-47b3-9ae9-b5cc2c741625"
  />
</p>

当前稳定版本：**`1.3.0`** · npm 包名：**`@felixypz/openclaw-recall`**

---

## 这是什么

OpenClaw Recall 是一个专为 OpenClaw 设计的记忆基础设施插件。它解决的是 AI 编码助手**长期使用后才会暴露的问题**：

| 问题 | 解决方案 |
|---|---|
| 用户偏好在新 session 后全部丢失 | 四种记忆类型的自动写入 |
| 历史对话记录占满 prompt 预算 | 分层上下文压缩 + 预算强制限制 |
| 工具输出反复重放给模型 | 工具输出压缩，附带 Token 节省统计 |
| 记忆和 prompt 行为难以排查 | `doctor`、`status`、`memory explain`、`profile inspect` |
| 旧的噪声记忆污染召回结果 | 写入时和召回时的双重过滤 |

**支持的记忆类型：** `preference`（偏好）· `semantic`（语义）· `episodic`（情节）· `session_state`（会话状态）

---

## 1.3.0 更新了什么

本次版本聚焦于**召回质量**和**导入还原度**的提升。

**召回改进**
- 混合召回引入 RRF 融合策略，稳定偏好、项目上下文、当前任务上下文三者同时存活的概率更高
- 候选池扩展 + MMR 多样化策略，减少重复偏好占主导的召回结果
- 指令型 prompt 不再触发无意义的记忆检索
- 关系感知拼接，改善 import 或 restore 后项目/任务记忆的召回效果
- `RELEVANT MEMORY` 块内容去重更彻底，每 token 的相关性更高

**压缩改进**
- 工具输出压缩保留命令、错误堆栈、代码块、半结构化段落
- 压缩前自动解包 Provider 风格的 wrapper 层，避免压缩到 JSON 壳子而非实际内容

**导入改进**
- 超长记忆和对话段落按块导入，保留更多有效信号
- 重复行合并或覆盖，不再重复写入
- `rejectedNoise`、`rejectedSensitive`、`uncertainCandidates` 分别跟踪统计
- 普通导入不再把语义记忆静默晋升为 `shared` 类型

---

## 安装

### 通过 npm 安装

```bash
npm install @felixypz/openclaw-recall
openclaw plugins install --link ./node_modules/@felixypz/openclaw-recall
openclaw-recall config init --mode local --write-openclaw
openclaw plugins info openclaw-recall
openclaw-recall config validate
openclaw-recall doctor
openclaw-recall status
```

### 从源码安装

```bash
git clone https://github.com/Felix201209/openclaw-recall.git
cd openclaw-recall
npm install && npm run build
openclaw plugins install --link .
openclaw-recall config init --mode local --write-openclaw
openclaw plugins info openclaw-recall
openclaw-recall config validate
openclaw-recall doctor
openclaw-recall status
```

---

## 身份模式

| 模式 | 适用场景 |
|---|---|
| `local` | 仅在当前机器上保留持久记忆 |
| `reconnect` | 在换机器或全新 OpenClaw 环境中接回同一块记忆空间 |

```bash
# 本地模式
openclaw-recall config init --mode local

# 重连模式
openclaw-recall config init --mode reconnect --identity-key recall_xxx --memory-space space_xxx

openclaw-recall config validate
```

> **安全提示：** identity key 是密钥，请存入密码管理器，不要明文保存在项目里。

---

## 5 分钟上手验证

**第一步：写入一条偏好**
```
记住我喜欢你叫我 Felix。
```

**第二步：开新 session 验证记忆是否保留**
```
你还记得我的偏好吗？
```

**第三步：触发一次工具输出**
```
read "README.md"
```

**第四步：检查结果**
```bash
openclaw-recall memory list
openclaw-recall memory explain "你还记得我的偏好吗？"
openclaw-recall profile list
openclaw-recall session inspect <sessionId>
```

**成功标志：**
- 记忆列表里出现 `Felix`、`中文`、`简洁` 等相关行
- 新 session 无需重放历史对话即可正确召回
- 工具结果显示 `savedTokens > 0`
- profile 行包含压缩证据

完整可复制的操作流程见 [EXAMPLES.md](EXAMPLES.md)。

---

## 推荐首次使用流程

1. 安装插件
2. 初始化配置（`local` 或 `reconnect`）
3. 执行 `openclaw-recall import dry-run`（预演，不实际写入）
4. 执行 `openclaw-recall import run`
5. 用 `doctor` · `status` · `memory explain` · `profile inspect` 验证

如果你已经有历史对话记录或记忆文件，直接导入比从头演示更快看到效果。

---

## 命令行参考

```bash
# 健康检查
openclaw-recall doctor
openclaw-recall status

# 配置
openclaw-recall config show
openclaw-recall config validate
openclaw-recall config init

# 导入 / 导出
openclaw-recall import dry-run
openclaw-recall import run
openclaw-recall import status
openclaw-recall export memory
openclaw-recall export profile
openclaw-recall export session --session <sessionId>

# 记忆管理
openclaw-recall memory list
openclaw-recall memory inspect <id>
openclaw-recall memory search "<查询词>"
openclaw-recall memory explain "<查询词>"
openclaw-recall memory prune-noise [--dry-run]
openclaw-recall memory reindex [--dry-run]
openclaw-recall memory compact [--dry-run]

# Profile 与 Session
openclaw-recall profile list
openclaw-recall profile inspect <runId>
openclaw-recall session list
openclaw-recall session inspect <sessionId>

# 后端
openclaw-recall backend serve
```

---

## 插件内检查路由

在 OpenClaw 中可访问：

```
/plugins/openclaw-recall/dashboard
/plugins/openclaw-recall/status
/plugins/openclaw-recall/memories
/plugins/openclaw-recall/profiles
/plugins/openclaw-recall/sessions
/plugins/openclaw-recall/sessions/:sessionId
```

---

## 配置说明

### 默认值

| 配置项 | 默认值 |
|---|---|
| 向量嵌入方式 | 本地哈希嵌入 |
| 上下文预算 | `2400` tokens |
| 近期轮次窗口 | `6` 轮 |
| 偏好类记忆 TTL | 较长 |
| 情节类记忆 TTL | 较短 |
| 自动记忆写入 | 开启 |
| 详细 profile | 开启 |

### 优先级顺序

1. `OPENCLAW_RECALL_*` 环境变量
2. `plugins.entries.openclaw-recall.config`
3. 内置默认值

旧版 `OPENCLAW_MEMORY_PLUGIN_*` 变量在改名过渡期间仍作为兼容别名接受。

### 身份相关环境变量

```
OPENCLAW_RECALL_IDENTITY_MODE
OPENCLAW_RECALL_IDENTITY_KEY
OPENCLAW_RECALL_MEMORY_SPACE_ID
OPENCLAW_RECALL_IDENTITY_API_KEY
OPENCLAW_RECALL_IDENTITY_ENDPOINT
OPENCLAW_RECALL_EXPORT_DIRECTORY
```

---

## 记忆质量过滤机制

### 写入时过滤（以下内容不会进入持久记忆）
- 发送者元数据、定时任务/心跳记录、控制平面标签
- Wrapper 文本、调试注释、脚手架片段
- 纯情绪类低价值内容

### 召回时抑制（以下内容不会主导召回结果）
- 旧的噪声行覆盖当前有效记忆
- 过期或已被覆盖的行挤占有效记忆位置
- 内部 wrapper / 调试文本泄漏进正常回复

### 稳定偏好提取倾向
`偏直接` · `偏执行导向` · `偏中文` · `偏简洁` · 结构化报告偏好

### 记忆卫生命令
```bash
openclaw-recall memory prune-noise --dry-run   # 预演，看哪些会被清理
openclaw-recall memory prune-noise             # 实际执行清理
openclaw-recall memory reindex                 # 重建索引
openclaw-recall memory compact                 # 压缩旧记忆
```

### `status` 报告字段
`noisyActiveMemoryCount` · `lastPrune` · `lastReindex` · `lastCompact` · `hygiene` · `recentImportStats` · `lastExportPath`

### `memory explain` 暴露字段
`retrievalMode` · 选中行及 `finalScore` · `keywordContribution` · `semanticContribution` · 被抑制的噪声行及抑制原因

调试数据仅出现在检查路径中，正常对话回复保持干净。

---

## 兼容性

`1.3.0` 已验证：

- Node.js `24.10.0` 和 `24.12.0`
- OpenClaw `2026.3.13`
- OpenAI Responses 运行时（精确 prompt token 计数）
- source-link 安装和 tarball 安装

完整兼容矩阵见 [COMPATIBILITY.md](COMPATIBILITY.md)。

---

## 数据精度说明

| 指标 | 来源 |
|---|---|
| `promptTokensSource` | Provider 提供用量元数据时为 `exact`，否则为 `estimated` |
| `compressionSavingsSource` | `estimated`（启发式对比） |
| `toolTokensSavedSource` | `estimated`（启发式对比） |

---

## 已知限制

- 压缩节省量和工具 token 节省量仍部分为估算值
- Provider 烟雾测试覆盖以 OpenAI Responses 路径为主
- `openclaw <subcommand>` CLI 暴露受上游限制，请直接使用 `openclaw-recall`
- 部分安装流程中 OpenClaw 可能输出 `plugins.allow is empty` 警告，属已知噪声
- 记忆冲突解决仍为规则式（支持稳定偏好的覆盖更新）
- `reconnect` 模式使用内置 `recall-http` 后端，通用外部远程后端未经版本验证

以上均为已知发布限制，不影响正常使用。

---

## 构建与验证

```bash
npm run check
npm run build
npm run test:unit
npm run test:integration
npm run test:remote-roundtrip
npm run test:install
npm run smoke
npm run verify
npm run release:build
```

---

## 文档索引

| 文件 | 内容 |
|---|---|
| [QUICKSTART.md](QUICKSTART.md) | 从安装到第一次成功召回的最短路径 |
| [OPENCLAW-INTEGRATION.md](OPENCLAW-INTEGRATION.md) | 插件集成细节 |
| [COMPATIBILITY.md](COMPATIBILITY.md) | 已验证、已支持、部分覆盖的兼容矩阵 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 内部设计与组件概览 |
| [OPERATIONS.md](OPERATIONS.md) | 生产环境运维指南 |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | 常见问题与解决方法 |
| [EXAMPLES.md](EXAMPLES.md) | 可直接复制的完整操作示例 |
| [RELEASE_NOTES.md](RELEASE_NOTES.md) | 版本级更新说明 |
| [CHANGELOG.md](CHANGELOG.md) | 完整变更历史 |
