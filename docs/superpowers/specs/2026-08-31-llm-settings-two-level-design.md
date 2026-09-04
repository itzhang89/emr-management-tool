# Providers 页 — 服务商 → 模型（两层） + 内置预设 + Gemini + 多密钥

替换 `2026-08-28-ai-assistant-page-design.md` 第 3 节的三级模型。那一版是
**服务商 → Endpoint → 模型**，协议挂在服务商上；压成两层后，协议与地址挂在
服务商上，模型直接挂它。

AI Assistant 页里这个 tab 现在叫 **Providers**（初稿叫 "LLM Setting"）。后续迭代把
内置预设扩到 7 个（含 4 家国产 OpenAI 兼容网关）、复制/删除移进列表行的悬停区、
列表加搜索/筛选与底部添加、并移除内联改名；这些在 §2 / §4 / §12 / §14 是当前形态。

## 1. 为什么去掉 Endpoint 层

设计上 Endpoint 是"同一服务商的第二个地址"。实践里它只带来成本：

- 单 Endpoint 是绝对多数，但每个用户都要先理解这一层才能填第一个密钥。
- Endpoint 与服务商的区别只有 `base_url` + `api_key` —— 而这正是"另一个服务商"
  的全部内容。
- 三级树让每个界面动作都要先回答"改的是哪一层"：启用开关在哪层、模型挂哪层、
  删除删到哪层。

之后：**一个服务商 = 一个可发请求的地方**（协议 + 地址 + 密钥 + 请求头），模型直接
挂它。要第二个地址就复制一个服务商 —— `复制` 动作把除密钥外的一切带过去，代价
比维护一层结构低得多。

## 2. 目标形态

```
┌─ AI Assistant › Providers ──────────────────────────────────────────────┐
│ ┌─ 服务商列表 (~20%) ──┬───────────────────────────────────────────────┐ │
│ │ 🔍 搜索服务商    [▽筛选]│                                             │ │
│ │                      │ ┌─ ProviderCard ──────────────────────────┐   │ │
│ │ ● OpenAI        [12]  │ │ DeepSeek   [Preset]           ● 启用   │   │ │
│ │ ○ DeepSeek      [ 4]  │ │                                         │   │ │
│ │ ○ Kimi          [ 3]  │ │ API 密钥 ┌──────────────┐ [🔑] [🔌]     │   │ │
│ │   (悬停 DeepSeek 行)    │ │ API 地址 ┌──────────────┐ [▾] [⚙]       │   │ │
│ │   …名    ⧉ 🗑    [ 4]   │ └─────────────────────────────────────────┘   │ │
│ │ ○ Anthropic     [ 1]  │ ┌ 模型  [↻ 获取模型列表] [＋] ─────────────┐   │ │
│ │ ○ Zhipu AI      [ 2]  │ │ ▼ DeepSeek                               │   │ │
│ │ ○ Qwen          [ 2]  │ │   ◇ deepseek-chat   💡 🔧  ★ ⚙ 🗑         │   │ │
│ │                      │ └────────────────────────────────────────────┘   │ │
│ │ [＋ 添加服务商]         │                                               │ │
│ └──────────────────────┴───────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

**行右侧 = 常驻数量 + 悬停操作**：模型数量徽章常驻并贴行最右；悬停时复制(⧉)、删除(🗑)
在**数量的左侧**淡入。两个按钮的宽度总是预留，所以浮现时数量不动、无布局抖动，名称的
截断点也不变。行左侧保持 **状态点 → 名称**（点 = 可聊天，即 `enabled && 有密钥`；
不引入头像/logo）。

**列表顶部是搜索 + 筛选**：搜索按名称模糊匹配；筛选下拉为「全部 / 仅已启用 /
仅已禁用」，按 `provider.enabled`（卡片上的启用开关）过滤，不涉及是否有密钥。过滤后
没有匹配行时显示空态。

**底部是「＋ 添加服务商」**：从初稿里列表顶部的 Add 挪到列表滚动区下方的页脚，始终可见。

**名称不再内联改名**：复制/删除与改名都从标题区拿走后，右栏顶部只剩卡片。服务商名称
显示在卡片标题（`Preset` 徽章旁），名字只在「新增 / 复制」对话框里输入。

**两行对齐**（卡片内）：密钥、地址两个输入框各占剩余宽度（`flex-1`），尾随控件都是
`size-9` 的固定尺寸图标按钮，所以两行右边缘和两组控件都竖向对齐。图标上的角标数字
表示密钥数与自定义头数，不占额外行。

## 3. 没有保存按钮

每个输入框在**失焦或按 Enter 时提交**，Escape 撤回。理由：同一张卡片上的开关、
下拉框、对话框本来就是即时生效的，再给两个文本框配一个 Save 按钮，就变成"一半控件
立即生效、一半要按钮"——这比两者中任何一种都糟。

`CommitInput` 封装这个行为。三条不显然的规则：

- **提交被后端拒绝就回退**。没有 Save 按钮意味着屏幕上的值必须始终等于已存储的值，
  否则用户会以为改成功了。
- **Escape 后的失焦不能再提交**。Escape 要先撤回再 blur，而 blur 会触发提交，
  所以用一个 ref 标记"这次 blur 是撤回造成的"。
- **未改动就不提交**。聚焦后直接 Tab 走不该产生一次写入。

## 4. 内置预设

首次启动种下 **7 行**：OpenAI / Anthropic / Gemini / DeepSeek / Kimi / Zhipu AI /
Qwen —— 正确协议与默认地址，**未启用、无密钥**。这样最常见的路径是"往已经知道
正确地址的那一行粘个密钥"，而不是"先知道 Gemini 要用 /v1beta、DeepSeek 在哪个 host"。

国内四家都是 **OpenAI 兼容协议**（`LlmProtocol::Openai`），但 host 各不相同，所以
种子表每一项带一个**地址覆盖**（`BUILT_IN_PROVIDERS` 的第 4 个元组字段：`Some(…)`
用该地址，`None` 用协议默认地址）：

| id | 名称 | 协议 | 默认地址 |
|---|---|---|---|
| `builtin-openai` | OpenAI | openai | `https://api.openai.com/v1` |
| `builtin-anthropic` | Anthropic | anthropic | `https://api.anthropic.com/v1` |
| `builtin-gemini` | Gemini | gemini | `https://generativelanguage.googleapis.com/v1beta` |
| `builtin-deepseek` | DeepSeek | openai | `https://api.deepseek.com` |
| `builtin-kimi` | Kimi | openai | `https://api.moonshot.cn/v1` |
| `builtin-zhipu` | Zhipu AI | openai | `https://open.bigmodel.cn/api/paas/v4` |
| `builtin-qwen` | Qwen | openai | `https://dashscope.aliyuncs.com/compatible-mode/v1` |

地址覆盖很关键：若一律填 `protocol.default_base_url()`，国内预设会指向 OpenAI 的地址。
上表的默认地址都满足 `{base}/models`（列模型）与 `{base}/chat/completions`（对话），
所以测试连接与拉模型列表对它们同样成立。

预设种下之后就是普通服务商 —— 可改地址、可复制、可删除；行内不提供改名（见 §14）。
`built_in` 只用于在 UI 上标一个「预设」徽章。

**只种一次，永不重种。** 与内置 chat 助手不同（那个每次启动刷新 system prompt，
让改进能到达已有安装），这些行是用户的：改过的保留改动，删掉的保持删除。
所以需要一张 `llm_seeded_providers` 标记表 —— 光靠 `on conflict do nothing` 不够，
已删除的预设没有行可冲突，下次启动就会复活。

## 5. 复制服务商

`duplicate_provider(sourceId, name)` 带过去：协议、地址、自定义头的**名字**、
整个模型清单。**不带**：API 密钥、自定义头的**值**、`enabled`、`is_default`。

- 密钥不复制：副本存在的意义就是指向另一个账号，静默克隆一份凭证会留下两处需要
  吊销的地方。
- 头的名字复制但值不复制：表单要显示副本还缺什么。
- 模型复制：手工重新导入一遍目录才是真正麻烦的部分。
- `is_default` 清零：全局只有一个默认模型，副本不该来争。

## 6. 三种协议

`LlmProtocol`：`openai` | `anthropic` | `gemini`，挂在服务商上。

| | 默认地址 | 列模型 | 对话 | 认证 |
|---|---|---|---|---|
| `openai` | `https://api.openai.com/v1` | `GET {base}/models` | `POST {base}/chat/completions` | `Authorization: Bearer` |
| `anthropic` | `https://api.anthropic.com/v1` | `GET {base}/models` | `POST {base}/messages` | `x-api-key` + `anthropic-version` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta` | `GET {base}/models` | `POST {base}/models/{model}:streamGenerateContent?alt=sse` | `x-goog-api-key` |

Gemini 默认地址带 `/v1beta`，于是 `{base}/models` 对三种协议都成立，
`models_sync` 只需按协议换解析器，不需要为它拼特殊路径。

### Gemini 与另两种的差异

`chat/gemini.rs` 是第三个模块，不是往 `openai.rs` 加分支 —— 差异比
openai/anthropic 之间还大：

- **角色名** `user` / `model`（不是 `assistant`）。
- **system prompt** 是顶层 `systemInstruction: {parts: [{text}]}`。
- **消息体** `contents[].parts[]`：文本 `{text}`，工具调用
  `{functionCall: {name, args}}`，工具结果 `{functionResponse: {name, response}}`。
- **没有 call id**，工具结果靠**工具名**对应调用。本地仍生成 uuid 供 UI 关联，
  发回时只写 `name`。
- **thought signature 必须原样回传，且是 `Part` 的字段。** Gemini 3 在每一步的
  **第一个** functionCall part 上附一个加密的 `thoughtSignature`。它是 `Part` 的字段，
  与 `functionCall` **平级**，不在它内部：
  ```json
  { "functionCall": { "name": "…", "args": {} }, "thoughtSignature": "Ct4BAV" }
  ```
  两种写错各有一个 400 —— 漏掉是 `Function call is missing a thought_signature in
  functionCall parts`；塞进 `functionCall` 里是 `Unknown name "thoughtSignature" at
  '…function_call': Cannot find field`。
  并行调用里只有第一个有，其余没有 —— 给没有的那些补一个同样是错的。所以它存在
  `ChatToolCall.signature` 上、跟着 assistant 行落盘，重建历史时按调用逐个附回。
  文本 part 上的签名 API 不强制校验（只说可能降低效果），当前不保存 —— 那需要给
  `chat_messages` 加一列，换来的只是「recommended」。
- **一步之内的调用与结果各自成组**：`[FC1, FC2] [FR1, FR2]`，不是
  `[FC1] [FR1] [FC2] [FR2]`。所以 `append_turn` 把连续的 functionResponse 合并进
  同一个 user content。
- **工具声明** `tools: [{functionDeclarations: [...]}]`，参数字段叫 `parameters`。
  它的 `Schema` 是一个 **protobuf message**，不是 JSON Schema 的子集 —— 所以
  `to_gemini_schema` 是**翻译**而非过滤，见下节。
- **SSE 无事件名**，每帧是完整的 `GenerateContentResponse`，所以 functionCall
  到达即完整，不像另两种要跨帧累积。
- **usage** 在 `usageMetadata.promptTokenCount` / `candidatesTokenCount`。
- **模型列表** `{"models": [{"name": "models/…", "displayName", "inputTokenLimit",
  "outputTokenLimit"}]}`。id 剥掉 `models/` 前缀；这是三种协议里唯一如实报告
  token 上限的，导入时直接落库。

### 工具 schema 必须翻译成 proto 的子集

MCP 工具的参数 schema 由 `schemars` 生成。Gemini 对不认识的字段返 400 而不是忽略，
且 `Schema` 是 protobuf message，所以 JSON Schema 允许的若干写法在这里不只是多余，
而是**类型不合法**：

- **`"type": ["integer", "null"]`** —— `schemars` 就是这样表达 `Option<T>` 的 ——
  在 proto 里 `type` 是单个 enum 而非 repeated 字段，于是报
  *"Proto field is not repeating, cannot start list"*。翻译成
  `{"type": "integer", "nullable": true}`。
- **`$schema` / `default` / `minimum` / `additionalProperties` / `$defs`** 等在
  proto 里没有对应字段。
- **`format` 在 JSON Schema 里是开放字符串，在这里是按类型划分的 enum**。
  `schemars` 为 `usize` 生成的 `"format": "uint"` 不在其中，必须丢掉。

所以用**白名单**：不确定能往返的一律丢弃。丢一条约束只损失一点校验，而多一个未知
字段会让整个请求失败。`required` 里指向已被丢弃属性的名字也要摘掉 —— 那本身也是
一个 400。

单测直接对**真实的四个 MCP 工具 schema**（`schema_for!` 现场生成，不是手写
fixture）断言转换结果里没有类型列表、没有白名单外的字段。手写 fixture 不会捕获
这个 bug —— 它当初就是 `GetJobLogTextArgs` 的 `Option<usize>` 触发的。

`protocol.rs` 的 `Turn` / `StreamEvent` / `ToolCallAccumulator` / `Usage` 不变，
`session.rs` 与 `title.rs` 各多一个 match 分支。

## 7. 多 API 密钥

一个服务商可挂多把密钥。语义：**探测后固定用健康的一把**，不是每次请求轮转 ——
轮转会让同一会话的连续请求落在不同密钥上，provider 侧的 prompt 缓存和配额归因
都被打散。

- `检测`（🔌 旁的 🔑 对话框里）逐把探测，把结果写回每把密钥的状态。
- 发请求按 `sort_order` 取**第一把非 unhealthy** 的。
- 真实请求收到 401/403 时标记该把并**自动换下一把重试一次**。这才是"自动清除哪把
  可用"实际发生的时机；探测只是提前做一遍。
- 全部 unhealthy 时报错说明"N 把都被拒绝"，不静默失败。
- **429 明确不弃用密钥** —— 被限流恰恰证明密钥是好的。

判断留在看见状态码的地方：协议模块构造错误时给 401/403 的 `AppError.code` 打上
`LlmAuthRejected`，上层只读 `error_retires_key(&error)`。

### 值在 keyring，状态在 SQLite

密钥值走 `secrets`，键 `llm/key/{keyId}`。**状态不进 keyring**：它不是机密，
而且每次探测都重写 keyring 是错误用法。所以 `llm_api_keys` 存元数据
（掩码、健康状态、探测时间），值单独存。掩码存 SQLite 是安全的 —— 它本来就是要
发给 WebView 的那个值。

### 👁 可视化密钥

只切换**正在输入**的框是 `password` 还是 `text`，方便核对刚粘贴的内容。已保存的
密钥仍只能看到 `AIz••••abcd`，Rust 侧不提供读回接口 —— 沿用「LLM API 密钥不进
WebView」这条既有规则，与 AWS secret key 一致。

## 8. 自定义请求头（⚙）

值算机密，和 API 密钥同级：网关常要求 `Authorization` / `X-Api-Token` 之类的头，
明文写进 SQLite 就等于绕过了现有的密钥保护。

- 整个头部映射作为一条 JSON 存 keyring，键 `llm/{providerId}/headers`。
- SQLite 只存 `llm_providers.header_names`（JSON 数组）供展示。
- `set_llm_provider_headers(providerId, headers: [{name, value?}])` 一次提交整个
  列表：`value` 缺省表示保留原值，列表里没有的名字被删除。这样编辑其中一个头
  不需要重新输入其余的值。
- **不允许覆盖协议自己的认证头**（`authorization` / `x-api-key` /
  `x-goog-api-key` / `anthropic-version`）—— 静默覆盖会让"密钥不对"无法排查。

## 9. 模型的自定义信息

`ModelFormDialog` 同时承担新增与编辑：

```
基础信息   模型 ID* / 模型名称 / 分组
模型能力   模型类型 [chat|image|embed] · 能力 ☑推理 ☑工具调用 · 输入模态 ☑文本 ☑视觉 ☐音频 ☐视频
Token 限制 上下文窗口 / 最大输入 Token / 最大输出 Token
```

**「分组」就是现有的 `series` 列**，不新增列。它由 `llmModelSeries.ts` /
`model_series.rs` 的启发式推断，本来就允许用户覆盖，语义与"分组"一致。对话框标
「分组」，库里仍叫 `series`，避免为一个标签改动两处已有单测覆盖的推断模块。

**能力字段只存储与展示，不参与请求构建。** 模型行按能力显示图标、编辑框可勾选，
但 `session.rs` 不会因为"未勾选工具调用"就不带 `tools`。能力值来自用户手填或网关
推断，用它裁剪请求会把一次配置失误变成"模型突然不会用工具了"这种难查的问题。
等到有真实的能力来源（Gemini 的 `supportedGenerationMethods`）再接。

能力以一个 JSON 列存，不是七个布尔列 —— 更新时是一次 `update_column!`。

模型类型这轮只有 `chat` 有行为，`image` / `embed` 存得下但不出现在 Chat 的模型
选择器里。

## 10. SQLite

三张表。旧结构（`llm_providers.kind` 或存在 `llm_endpoints` 表）**不迁移**：
从原始结构，endpoint 的协议不可知；从中间结构，一个有两个 endpoint 的服务商没有
单一协议或地址可以塌缩成，随便挑一个会静默丢弃另一个。两者都是本项目未发布过的
schema，没有需要保护的安装基数。

**替换在 `db::llm::migrate` 内部的第一步做，不在它旁边。** 这是实现中发现的必要
条件：旧结构与新结构**表名相同**，只有列不同。`create table if not exists
llm_api_keys` 遇到一张 `endpoint_id` 版本的旧表会安静地跳过，之后每次插入都报
`no such column: provider_id`。所以 `reset_legacy_schema` 必须先于所有建表语句
运行，而不是作为 setup 里的一个独立步骤 —— 后者的顺序保证不了。

清 keyring 需要 `AppHandle`，存储层没有。所以 `reset_legacy_schema` 把作废的
keyring 键记进 `llm_orphaned_secrets` 表，启动时由
`chat::providers::purge_orphaned_secrets` 排空。用表而不是内存传递，是因为中间
崩溃不该让密钥永久留在机器上：删除全部成功才清记录，否则下次启动重试。

```sql
create table if not exists llm_providers (
  id text primary key,
  name text not null,
  protocol text not null,            -- 'openai' | 'anthropic' | 'gemini'
  base_url text not null default '', -- 空 = 还没填，不能启用
  enabled integer not null default 0,
  built_in integer not null default 0,
  header_names text,                 -- JSON 数组，值在 keyring
  sort_order integer not null default 0,
  created_at text not null,
  updated_at text not null
);

create table if not exists llm_api_keys (
  id text primary key,               -- keyring 键为 llm/key/{id}
  provider_id text not null references llm_providers(id),
  label text,
  masked text not null,
  status text not null default 'unknown',  -- 'unknown' | 'healthy' | 'unhealthy'
  status_message text,
  checked_at text,
  sort_order integer not null default 0,
  created_at text not null
);

create table if not exists llm_models (
  id text primary key,
  provider_id text not null references llm_providers(id),
  model_id text not null,
  series text not null,              -- UI 上叫「分组」
  display_name text,
  model_type text not null default 'chat',
  capabilities text,                 -- JSON，见 LlmModelCapabilities
  is_default integer not null default 0,
  context_window integer,
  max_input_tokens integer,
  max_output_tokens integer,
  created_at text not null,
  unique (provider_id, model_id)
);

-- 记录哪些预设种过。只靠 on conflict do nothing 不够：已删除的预设没有行可冲突。
create table if not exists llm_seeded_providers (
  id text primary key,
  seeded_at text not null
);

-- 旧结构被删除时作废的 keyring 键，等 setup 阶段排空。
create table if not exists llm_orphaned_secrets (
  key text primary key,
  recorded_at text not null
);
```

沿用现有风格：`create table if not exists`、外键仅作文档、删除在 Rust 侧按顺序做。
`unique (provider_id, model_id)` 是**按服务商**唯一 —— 同一网关的两个账号合理地
提供同名模型。

## 11. 命令

```
list_llm_providers()                              -> Vec<LlmProvider>   // 含 keys + models
create_llm_provider(name, protocol?)              -> String
update_llm_provider(id, name?, protocol?, baseUrl?, enabled?, sortOrder?)
duplicate_llm_provider(id, name)                  -> String
delete_llm_provider(id)                           // 连带删 keys/models/keyring 条目
set_llm_provider_headers(providerId, headers: [{name, value?}]) -> Vec<String>
add_llm_api_key(providerId, value, label?)        -> String
update_llm_api_key(id, label?, sortOrder?)
delete_llm_api_key(id)
probe_llm_api_keys(providerId)                    -> Vec<LlmApiKey>     // 逐把探测并写回
test_llm_provider(providerId)                     -> LlmProviderTestResult
sync_llm_models(providerId)                       -> Vec<LlmModelCandidate>
add_llm_models(providerId, models)                -> usize
update_llm_model(id, modelId?, series?, displayName?, modelType?, capabilities?,
                 isDefault?, contextWindow?, maxInputTokens?, maxOutputTokens?)
delete_llm_model(id)
```

## 12. 前端文件

```
components/ai/settings/
  LlmSettingsPanel.tsx      编排：ProviderList + ProviderCard + ModelTree + 各对话框
  ProviderList.tsx          顶部搜索+筛选 · 行(状态点/名称/悬停复制删除/常驻模型数) · 底部添加
  ProviderCard.tsx          两行对齐的密钥/地址 + 协议下拉 + 开关
  ProviderFormDialog.tsx    新增（问名字+协议）与复制（只问名字）
  CommitInput.tsx           失焦/Enter 提交，Escape 撤回，拒绝则回退
  ApiKeysDialog.tsx         🔑 多密钥 + 检测
  CustomHeadersDialog.tsx   ⚙ 自定义头
  ModelTree.tsx             按分组折叠 + 能力图标 + ★⚙🗑
  ModelFormDialog.tsx       新增与编辑模型
  SyncModelsDialog.tsx      多选导入
services/llmProtocols.ts    三种协议的标签与默认地址
```

能力图标用 lucide，只在勾上时显示：推理 `Lightbulb`、工具调用 `Wrench`、
视觉 `Eye`、音频 `AudioLines`、视频 `Video`。

## 13. 实现与设计的偏离

**Gemini 的工具调用需要回传 thought signature，位置和分组都有讲究。** 第一版
`append_turn` 只写 `{name, args}`，第二轮就 400：`Function call is missing a
thought_signature in functionCall parts`。补上之后又踩了第二个 400 —— 签名被塞进
`functionCall` 内部，而它是 `Part` 的字段：`Unknown name "thoughtSignature" at
'…function_call': Cannot find field`。**第一次的单测把我读错的形状写进了断言，所以
它通过了却没能拦住**；改成断言 `functionCall` 的键集合恰好是 `["args", "name"]`，
把形状钉住而不只是检查值存在。

修法：`ChatToolCall` 新增可选 `signature` 字段（`skip_serializing_if`，旧行照样
反序列化），从流式响应捕获、落盘、重建历史时逐个调用附到 part 上；连续的
functionResponse 合并进同一个 user content，因为 API 要的是 `[FC1, FC2] [FR1, FR2]`。
校验只作用于**当前轮**（最后一条真实用户消息之后），所以既有会话不需要清空重来。

**「停止」必须能中断请求阶段，不只是字节循环。** 最初三个协议模块只在读字节的
`tokio::select!` 里检查 cancellation token —— 也就是**响应头到达之后**。但真实的
卡死发生在更早：provider 接受了连接然后不吭声，`request.send().await` 永远不返回，
token 被设置了却没有任何地方观察它。表现就是「Thinking 卡住，点 Stop 没反应」。

修法是把每个 await 都套进 `protocol::until_cancelled`：请求阶段、MCP 客户端连接、
工具调用。`select!` 用 `biased` —— 已经取消的 token 必须赢过一个恰好就绪的 future，
否则「停止」会读成一次用户没看见的成功。中断表示为带 `LlmCancelled` code 的错误，
`run_rounds` 认得它并把已流式输出的部分当正常结果保留，而不是报失败。

**HTTP 客户端补 connect + read timeout，不加总超时。** `connect_timeout` 15s；
`read_timeout` 120s 是**字节之间**的间隔上限，不是整个响应的上限 —— 带多轮工具调用
的长回答合理地会流几分钟，总超时会切断正常对话；而中途安静两分钟的连接就是死了。
三个协议共用 `protocol::streaming_client()`，免得「哪个 provider 会卡死」取决于用户
选了哪一个。

**前端 `cancel` 立刻清 streaming 状态，不等 `chat:done`。** 后端可能还在解开请求，
而按钮的全部意义就是让这一轮**立刻**看起来结束了。否则 "Thinking" 留在屏幕上、Stop
按钮消失，用户第二次也点不到。

**Gemini 的工具 schema 是翻译，不是过滤。** 最初写成 `sanitize_schema`，只剔除
`$schema` / `additionalProperties` 这类明显多余的键。真实调用时报
`Proto field is not repeating, cannot start list` —— 漏掉了 `Option<T>` 会被
`schemars` 写成 `"type": ["integer", "null"]`，而 proto 的 `type` 是单个 enum。
改成白名单式翻译（类型列表 → `type` + `nullable`，未知 `format` 丢弃，`required`
摘掉已消失的属性名）。单测改为对真实的四个工具 schema 断言，因为手写 fixture 当初
恰好绕过了这个形状。

**旧表的替换必须在 `migrate` 内部、建表之前。** 最初放在 setup 里作为独立步骤，
结果是「添加 provider 报 `no such column: provider_id`」：旧结构与新结构表名相同，
`create table if not exists` 对一张列不对的旧表是静默 no-op。修正后
`reset_legacy_schema` 是 `migrate` 的第一句。

**作废的 keyring 键走一张表传递，不走内存。** 存储层删表、setup 层删密钥，中间
崩溃不该让密钥永久留下。删除全部成功才清记录。

**`llm_seeded_providers` 标记表是实现中加的。** 最初只用 `on conflict do nothing`，
测试立刻发现删掉的预设下次启动会复活。

**`LlmProviderTestResult` 而非 `LlmEndpointTestResult`。** 类型跟着层级改名，
避免留下唯一一个还说 endpoint 的结构。

**`vitest.setup.ts` 补了两个 jsdom 桩**：`Element.prototype.hasPointerCapture`
与 `scrollIntoView`。Radix Select 打开下拉时会查询指针捕获并把选中项滚入视野，
jsdom 两个都没有，不打桩则 `user.click` 打不开下拉。协议从 radio 换成 Select
才第一次触发到。

**Gemini 的模型分组不会自动收成 `Gemini`。** `model_series` 只去掉尾部版本段，
`flash` 不是版本段，所以 `gemini-3.5-flash` 的推断分组是它自己。这正是编辑框允许
手改分组的原因；单测按实际行为写，没有为了图上的效果去改推断规则 —— 改了会波及
claude/gpt 的既有断言。

**Gemini 的 `inputTokenLimit` 同时填 `context_window` 与 `max_input_tokens`。**
它只报一个数，编不出第二个。

## 14. 后续迭代 — 从初稿到 Providers 页

以下是相对 §2 / §4 / §12 初稿的调整，作为变更记录（正文已按当前形态改写）：

- **tab 改名**：`LLM Setting` → `Providers`（AI Assistant 页）。左栏不再放重复的
  "Providers + Add" 大标题，顶部直接是搜索栏，避免和 tab 名重复。
- **复制/删除移进列表行**：初稿里两个动作在右栏标题、名字输入框旁；现在在每个
  Provider 行右侧悬停浮现，模型数量常驻最右、悬停出现在其左侧（§2）。行级操作只
  作用于**该行**的服务商——删除非当前选中行不会清空当前选择。
- **内联改名移除**：不再提供改名入口。§3 的 CommitInput 提交语义只保留给地址框
  （ProviderCard 里）。名称在「新增 / 复制」对话框输入，卡片标题只读展示；嫌名字
  不好就删掉重建或复制一个，成本比保留一个常错的改名入口低。
- **搜索 / 筛选 / 底部添加**：ProviderList 顶部是搜索 + 筛选（全部 / 仅已启用 /
  仅已禁用，按 `enabled`），「添加服务商」从顶部移到列表下方页脚。
- **内置预设 3 → 7**：新增 DeepSeek / Kimi / Zhipu AI / Qwen 四家国产 OpenAI 兼容
  网关；`BUILT_IN_PROVIDERS` 的每一项增加地址覆盖字段（§4）。
- **行左侧**：保持 状态点 + 名称，不引入头像/品牌 logo（自定义服务商没有图标资源）。
