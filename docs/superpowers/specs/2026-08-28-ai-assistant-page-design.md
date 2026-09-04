# AI Assistant 页面重构 — 设计

把现在的 MCP Server 页面（`src/pages/McpPage.tsx`，603 行，两个 tab）重构成本应用
所有 AI 能力的集成入口：Chat、LLM 配置、MCP 服务、审计四个 tab。

本文承接 `2026-08-27-rust-rmcp-chat-design.md`。那份文档定下了 rmcp 3.1.4 的
in-process 传输和 Rust 侧 chat loop（步骤 1–4 已落地：`src-tauri/src/mcp/` 全套
工具 + `in_process.rs` 已可用，步骤 5–6 尚未实现）。本文替换其中的
「Chat page」一节，给出三级 LLM 配置模型、助手/会话两级结构和 SQLite 持久化，
其余（工具集、安全规则、in-process 传输）沿用不变。

## 1. 命名与导航

| | 现在 | 之后 |
|---|---|---|
| `PageId` | `"mcp"` | `"ai"` |
| 侧边栏 label | MCP Server | AI Assistant |
| description | AI assistant integration | Chat, models, and MCP tools |
| 图标 | `Bot` | `Sparkles` |
| 页面组件 | `pages/McpPage.tsx` | `pages/AiAssistantPage.tsx` |

`PageId` 改名会波及 4 处（`pageMeta.ts` 的联合类型与 `navigationItems`、
`AppShell.tsx` 的 lazy import 与 switch case、`PageHeader pageId=`）。侧边栏顺序
不变，仍在 Templates 之后。

Tab 顺序与默认值：`[Chat] [LLM Setting] [MCP Server] [Audit]`，`defaultValue="chat"`。
Chat 是日常入口，Server/Audit 降为运维视图。Chat tab 需要撑满高度且自己滚动，
所以页面容器从现在的 `overflow-auto` 改成 `min-h-0` + 每个 tab 自己管滚动。

## 2. 文件拆分

现在 603 行的单文件按 tab 拆开，页面壳只留 tab 骨架：

```
src/pages/AiAssistantPage.tsx        tab 骨架 + PageHeader
src/components/ai/
  server/McpServerPanel.tsx          ← 现 McpPage 的 server tab（3 张 Card）
  server/McpAuditPanel.tsx           ← 现 AuditPanel + AuditLogRow + CopyJsonButton
  settings/LlmSettingsPanel.tsx      服务商 / Endpoint / 模型 三栏
  settings/ProviderList.tsx
  settings/EndpointForm.tsx
  settings/ModelTree.tsx
  settings/SyncModelsDialog.tsx
  chat/ChatPanel.tsx                 双栏容器
  chat/AssistantSidebar.tsx          助手 → 会话 两级
  chat/AssistantFormDialog.tsx
  chat/MessageList.tsx
  chat/MessageBubble.tsx
  chat/ToolCallStep.tsx              可展开的工具步骤
  chat/Composer.tsx                  输入框 + 清空上下文 + 发送
src/hooks/useLlmConfig.ts            provider/endpoint/model 的 react-query
src/hooks/useChat.ts                 assistant/session/message + 流式事件订阅
src/services/llmModelSeries.ts       model id → 系列名（纯函数，可单测）
```

已有依赖足够：`@radix-ui/react-alert-dialog`（删除确认）、`@radix-ui/react-scroll-area`
（消息流）、`@radix-ui/react-select`（模型选择器）、`sonner`（toast）都已在
`package.json` 里，无需新增前端依赖。Rust 侧 `reqwest` / `sqlx` / `rmcp` /
`tokio-util` 也都已就位；`reqwest` 当前只启了 `rustls-tls` + `json`，流式响应需要
补 `stream` feature，SSE 分帧自己写（`data: ` 行拼装 + `[DONE]` 终止），不引入
额外的 SSE 库。

## 3. LLM Setting — 三级信息结构

```
┌─ 服务商 (20%) ──┬─ 服务商配置 ─────────────────────────────────┐
│ [+ 添加服务商]   │  agentrouter            [启用 ●] [重命名][删除] │
│                 │  ┌───────────────────────────────────────────┐│
│ ● agentrouter   │  │ Endpoint: [默认 ▾] [+ 添加 Endpoint]       ││
│ ○ b.ai          │  │ API 密钥   ••••••••abcd          [替换]    ││
│ ● freerouter    │  │ API 地址   https://…/v1                   ││
│ ○ justwoker     │  │ 协议形状   ( ) OpenAI  (•) Anthropic       ││
│                 │  │                        [测试连接] [保存]   ││
│                 │  └───────────────────────────────────────────┘│
│                 │  模型            [同步] [+ 添加模型]           │
│                 │  ▾ claude-opus                                │
│                 │      claude-opus-5        [默认] [配置][删除]  │
│                 │      claude-opus-4-8             [配置][删除]  │
│                 │  ▾ gpt-5.6                                    │
│                 │      gpt-5.6-sol                 [配置][删除]  │
└─────────────────┴───────────────────────────────────────────────┘
```

服务商全部由用户自建 —— 代码里不硬编码 agentrouter / b.ai 这类第三方网关。
新建服务商时只选协议形状（`openai` / `anthropic`），`baseUrl` 给对应官方默认值
作为占位提示，用户可改成任意兼容网关。

模型挂在 **Endpoint** 下（`models.endpoint_id`）。同一服务商的两个 endpoint 可以
有不同的模型清单，右栏顶部的 endpoint 切换器决定下方模型列表的内容，`同步`
拉取的也是当前选中 endpoint 的 `/models`。

### 3.1 SQLite 表

```sql
create table if not exists llm_providers (
  id text primary key,
  name text not null,
  kind text not null,              -- 'openai' | 'anthropic'
  enabled integer not null default 1,
  sort_order integer not null default 0,
  created_at text not null,
  updated_at text not null
);

create table if not exists llm_endpoints (
  id text primary key,
  provider_id text not null references llm_providers(id) on delete cascade,
  name text not null,              -- '默认' / 'backup'
  base_url text not null,
  is_default integer not null default 0,
  created_at text not null,
  updated_at text not null
);

create table if not exists llm_models (
  id text primary key,             -- 内部 uuid
  endpoint_id text not null references llm_endpoints(id) on delete cascade,
  model_id text not null,          -- 'claude-opus-4-8'，发给 API 的值
  series text not null,            -- 'claude-opus'，分组用
  display_name text,
  is_default integer not null default 0,
  context_window integer,
  max_output_tokens integer,
  created_at text not null,
  unique (endpoint_id, model_id)
);
```

沿用 `repository.rs::migrate()` 里的 `create table if not exists` 列表风格，不引入
版本号迁移机制。`on delete cascade` 需要 `pragma foreign_keys = on`，现有连接没开，
所以删除由 Rust 侧按顺序删子表实现，不依赖 cascade。

### 3.2 API 密钥

密钥 **不入 SQLite**，走 `aws/credentials.rs` 已有的 keyring/store 抽象，key 为
`llm/{endpointId}/api_key`（挂 endpoint，与 baseUrl 同级）。前端只拿到掩码值
`sk-…abcd`，可替换不可读回 —— 和 AWS secret key 完全一致的规则。

需要把 `credentials.rs` 里现为私有的 `write_secret` / `read_optional_secret` /
`delete_secret` 提升为 `pub(crate)`，或抽一个 `secrets.rs` 模块共用。倾向后者：
这三个函数与 AWS 无关，放在 `aws/` 下已经名不副实。

### 3.3 模型同步

`sync_llm_models(endpointId)` 在 Rust 侧发请求，因为密钥不能进 WebView：

- `openai` 形状：`GET {baseUrl}/models`，`Authorization: Bearer {key}`，读 `data[].id`
- `anthropic` 形状：`GET {baseUrl}/models`，`x-api-key` + `anthropic-version: 2023-06-01`，读 `data[].id`

返回候选列表给前端，弹多选框让用户勾选后再入库 —— 网关常返回上百个模型，
无条件入库会把列表冲爆。已存在的 `model_id` 预勾选并标注「已添加」。
拉取失败时提示手动添加，不阻塞。

系列名由 `llmModelSeries.ts` 从 model id 推断：按 `-` 切分，去掉尾部的版本段
（纯数字、`x.y`、日期形如 `20250219`、`latest`）后剩下的前缀即系列。
`claude-opus-4-8` → `claude-opus`，`gpt-5.6-sol` → `gpt-5.6`（`sol` 非版本段，保留）。
这是启发式，所以「添加模型」对话框允许手填系列覆盖。纯函数，单测覆盖。

### 3.4 命令

```
list_llm_providers() -> Vec<LlmProvider>        // 含 endpoints + models，一次拉全
create_llm_provider(name, kind) -> LlmProvider
update_llm_provider(id, name?, enabled?)
delete_llm_provider(id)                         // 连带删 endpoints/models/keyring 条目
create_llm_endpoint(providerId, name, baseUrl, apiKey)
update_llm_endpoint(id, name?, baseUrl?, apiKey?, isDefault?)  // apiKey 省略即不动
delete_llm_endpoint(id)
test_llm_endpoint(id) -> { ok, message, latencyMs }
sync_llm_models(endpointId) -> Vec<ModelCandidate>
add_llm_models(endpointId, models: Vec<{modelId, series, displayName?}>)
update_llm_model(id, series?, displayName?, isDefault?, contextWindow?, maxOutputTokens?)
delete_llm_model(id)
```

`list_llm_providers` 一次返回整棵树。数据量是几十行级别，分三次查询再在前端
拼装只是多两次 IPC。

## 4. Chat — 双栏结构

```
┌─ 助手/会话 (20%) ─┬─ 会话主区 ────────────────────────────────────┐
│ [+ 添加助手] [⌕]  │ [◧] job-abc 失败分析     [claude-opus-4-8 ▾]  │
│                   ├───────────────────────────────────────────────┤
│ ● EMR 失败分析     │  ┌ 我 ─────────────────────────────────────┐  │
│    · job-abc 分析  │  │ 00000003abcdefgh 这个任务为什么失败？    │  │
│    · job-def 分析  │  └─────────────────────────────────────────┘  │
│ ● Spark 调优       │  ┌ EMR 失败分析 · claude-opus-4-8 ────────┐  │
│    · shuffle 慢    │  │ ▸ analyze_job_failure  1.8s  ✓          │  │
│ ● 通用助手         │  │ ▸ get_job_log_text     0.4s  ✓          │  │
│    · 随手问        │  │ 驱动器在读取 s3://… 时抛 OOM，建议…      │  │
│                   │  └─────────────────────────────────────────┘  │
│                   ├───────────────────────────────────────────────┤
│                   │ [输入…                        ] [清空上下文][↑]│
└───────────────────┴───────────────────────────────────────────────┘
```

左栏两级：**助手**是预设（名称、图标色、system prompt、默认模型、可用工具子集），
其下缩进列出该助手的历史会话。`+ 添加助手` 建预设；会话由主区的「新建对话」
或直接在助手上点「+」产生。筛选图标按助手名与会话标题过滤，命中的会话会连带
展开其父助手。

主区顶部：折叠左栏按钮、会话标题（双击重命名）、模型选择器。模型选择器列出所有
已启用服务商 → endpoint → 模型，按 `series` 分组，选中值覆盖该会话的模型；
未选则用助手的默认模型。

消息流：用户消息是头像 + 名称 + 原文；助手消息是头像 + 助手名/模型名 + 状态行
（耗时、token 数）+ 正文。工具调用作为可展开步骤内嵌在助手消息上方，折叠时一行
显示「工具名 + 耗时 + 状态」，展开显示参数与结果 JSON —— 复用 Audit tab 的
`CopyJsonButton` 与 `<pre>` 呈现，两处对「工具做了什么」的透明度保持一致。

底部输入区：`Enter` 发送，`Shift+Enter` 换行，流式响应期间发送按钮变停止按钮。
「清空上下文」在当前会话插入一条分隔标记，其之前的消息不再进入后续请求 —— 保留
可读历史但重置上下文，比删除消息更符合「清空上下文」的字面语义。

### 4.1 SQLite 表

```sql
create table if not exists chat_assistants (
  id text primary key,
  name text not null,
  system_prompt text,
  default_model_id text,           -- llm_models.id，null 则用会话选择
  enabled_tools text,              -- JSON 数组；null = 全部工具
  accent text,                     -- 头像色
  sort_order integer not null default 0,
  created_at text not null,
  updated_at text not null
);

create table if not exists chat_sessions (
  id text primary key,
  assistant_id text not null,
  title text not null,
  model_id text,                   -- 覆盖助手默认
  created_at text not null,
  updated_at text not null
);

create table if not exists chat_messages (
  id text primary key,
  session_id text not null,
  seq integer not null,            -- 会话内单调递增，排序用
  role text not null,              -- 'user' | 'assistant' | 'tool' | 'context_reset'
  content text,
  tool_calls text,                 -- assistant 轮的 JSON 数组
  tool_call_id text,               -- tool 轮对应哪次调用
  model_id text,                   -- 生成这条消息的模型，事后可追溯
  duration_ms integer,
  error text,
  created_at text not null
);
create index if not exists idx_chat_messages_session on chat_messages(session_id, seq);
```

`context_reset` 作为一条真实消息落盘，重建请求时从最后一条 `context_reset` 之后
开始取历史。

首次启动时种一个「EMR 失败分析」内置助手，system prompt 指明可用工具与
「先定位 job 再取日志」的分析顺序 —— 否则用户打开 Chat 面对空列表，不知道
这个 Chat 与通用聊天窗口的区别在哪。

### 4.2 Rust chat loop

沿用 `2026-08-27` 文档第「The loop」节，落到 `src-tauri/src/chat/`：

```
chat/
  mod.rs
  providers.rs     llm_providers/endpoints/models 的 CRUD + 密钥读写
  models_sync.rs   /models 拉取
  session.rs       会话/消息持久化 + 多轮工具调用循环
  openai.rs        /chat/completions，SSE 增量，tool_calls
  anthropic.rs     /messages，SSE 增量，tool_use
commands/chat.rs   chat_* 与 llm_* 命令
```

`chat_send(sessionId, text)` 立即返回，随后通过 Tauri 事件推送：

| 事件 | 载荷 |
|---|---|
| `chat:delta` | `{ sessionId, messageId, text }` |
| `chat:tool` | `{ sessionId, messageId, callId, tool, args, phase: "start" \| "end", durationMs?, result?, error? }` |
| `chat:done` | `{ sessionId, messageId, durationMs, usage? }` |
| `chat:error` | `{ sessionId, messageId, message }` |

工具直接执行不弹确认 —— MCP 侧全部工具都是只读 AWS 查询，不改变任何状态，
每次调用都过审计表。执行过程在 UI 里完整展示，用户看得到模型读了什么。

轮数上限 12，超出即停并在会话里留一条错误消息，防止模型自旋。
`chat_cancel(sessionId)` 用 `CancellationToken` 中断流式请求。

助手的 `enabled_tools` 在构建请求时过滤 `in_process.list_tools()` 的结果，null 表示
全部放开。

### 4.3 前端事件订阅

`useChat.ts` 在 Chat tab 挂载时 `listen()` 四个事件，按 `sessionId` 过滤后写入
react-query 缓存；`chat:done` 后 invalidate 该会话的消息查询，让落盘结果成为
真相来源。流式期间的增量只存在 React state，不写缓存，避免每个 token 触发一次
全列表重渲染。

## 5. 安全

沿用 `2026-08-27` 文档的规则，一条需要在 UI 上说清：

- **AWS 凭证不进 LLM。** 工具层只暴露 LLM-safe 投影，`list_accounts` 不返回
  账号 ID 与密钥。
- **LLM API 密钥不进 WebView。** keyring 存储，前端只见掩码。
- **日志出工具前已脱敏**，模型看到的与外部 agent 看到的是同一份文本。
- **只读工具**，MCP 路径上不存在任何 AWS 变更操作。
- **新增的对外流量**：Chat 会把会话内容和工具结果发往用户配置的服务商。在此之前
  这个 app 除 AWS 外不向任何地方发送数据。Chat tab 在未配置服务商时的空状态、
  以及 LLM Setting tab 顶部，都要明写这一点。默认不配置任何服务商。
- 会话历史（含日志片段）落盘到本地 SQLite。LLM Setting 里提供「删除会话」与
  「清空全部会话」入口。

## 6. 分批实现

每批独立可测、可交付，前一批不完成不进入下一批。

> **状态：批次 1–8 全部实现完成**（2026-08-29）。实现过程中与本设计的偏离记录在
> 第 7 节。

**批次 1 — 重命名与拆分（纯重构，无新功能）** ✅
`PageId` `mcp` → `ai`，页面改名 `AiAssistantPage`，把现有两个 tab 的实现拆到
`components/ai/server/` 下，tab 列表先加两个占位（Chat / LLM Setting 显示
「尚未实现」）。验收：现有 Server/Audit 行为不变，`npm test` + `cargo test` 通过。

**批次 2 — LLM Setting 的数据层** ✅
三张表 + `secrets.rs` 抽取 + provider/endpoint/model 全套命令 + `test_llm_endpoint`。
无 UI，用 `cargo test` 覆盖 CRUD 与密钥读写（密钥测试走 debug 下的本地 store）。

**批次 3 — LLM Setting 的 UI** ✅
三栏界面、endpoint 切换、模型树、`llmModelSeries.ts` + 单测。同步按钮先只做
手动添加，`sync_llm_models` 留到批次 4。验收：能建服务商、配 endpoint、手加模型。

**批次 4 — 模型同步** ✅
`sync_llm_models` 两种协议形状 + 多选导入对话框。验收：对一个真实网关拉取成功，
失败时提示可读错误。

**批次 5 — Chat 的数据层** ✅
`chat_assistants` / `chat_sessions` / `chat_messages` 三表 + CRUD 命令 + 内置助手
种子数据。无 LLM 调用。验收：`cargo test` 覆盖会话与消息的增删查、
`context_reset` 后的历史截断逻辑。

**批次 6 — chat loop** ✅
`openai.rs` / `anthropic.rs` 的 SSE 解析 + `session.rs` 的多轮工具循环 + 四个事件 +
`chat_cancel`。SSE 解析与「工具结果回填进历史」是单测重点，它们不需要真实网络。
验收：配一个真实 endpoint，命令行触发一次带工具调用的对话能跑完。

**批次 7 — Chat UI** ✅
双栏、助手/会话两级、消息流、工具步骤、输入区、流式订阅。验收：从 UI 完成一次
「问某个 job 为什么失败」的完整分析。

**批次 8 — 收尾** ✅
空状态与外发数据提示文案、清空会话入口、`README` 的页面说明更新、
`2026-08-27` 文档标注被本文的 Chat 部分取代。

## 7. 实现与设计的偏离

按落地顺序记录，都是实现中发现的、值得写下来的判断：

**`secrets.rs` 是新模块，不是提升可见性。** 设计里给了两个选项，实现选了抽模块：
`aws/credentials.rs` 从 470 行降到 128 行，只剩 AWS 语义，双后端（keychain /
本地 JSON store）的选择逻辑集中在一处。

**`update_column!` 宏而非泛型函数。** sqlx 0.9 的 `SqlSafeStr` trait 只接受
`&'static str`，专门挡 `format!` 拼出的 SQL。宏用 `concat!` 在编译期拼表名列名，
比 `AssertSqlSafe` 绕过检查更实在。

**模型同步提前到批次 2。** `/models` 的解析与 HTTP 错误归因全是纯逻辑，不需要
网络就能测，跟 CRUD 一起写完更连贯；批次 4 只剩多选导入对话框的 UI。

**两个 provider 形状是两个模块，没有合并加分支。** 差异比设计预想的大：system
prompt 位置（message vs 顶层字段）、tool 参数格式（JSON 字符串 vs 对象）、结束
信号（choice 里的 `finish_reason` vs 独立的 `message_stop`）、`max_tokens` 一个
可选一个必填。共用的部分抽到 `protocol.rs`（`Turn` / `StreamEvent` /
`ToolCallAccumulator`）和 `sse.rs`（分帧）。

**工具输出截到 60k 字符并显式标注 `[truncated]`。** 设计没提上限。一段完整日志
尾巴能有几 MB，塞爆上下文会让模型更差；静默截断会让它把残缺日志当完整的用。

**工具失败告诉模型，不藏起来。** 参数 JSON 畸形、工具报错都作为 tool result 内容
回传（Anthropic 侧带 `is_error: true`），模型可以据此换方式重试而不是编答案。

**同一 session 重复 send 会取消前一个流**，否则两个流会竞争着往同一份 transcript
里写。

**流式增量只存 React state，不进 query 缓存。** 每个 token 写一次缓存会让整个
消息列表重渲染。`chat:done` 后 invalidate，落盘结果成为真相来源。

**`vitest.setup.ts` 补了两个 jsdom 缺失的桩**：`ResizeObserver`（Radix radio
group / select 挂载时构造）和 `Element.prototype.scrollIntoView`（消息列表跟随
滚动）。都是既有 setup 的缺口，此前没有组件触发到。

**顺带修了一处既有测试失败**：`pageNavigation.test.ts` 里两条断言期望侧边栏 9 项，
实际早已是 10 项。改动前 stash 确认过是既有失败。
