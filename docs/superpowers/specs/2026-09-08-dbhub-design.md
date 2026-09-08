# DBHub — 数据信息 Hub 重构与多数据源连接设计

把现在平铺的 **Data Catalog（`GlueCatalogPage`，整页就是 Glue 工作区）** 升级成一个
既有的 AWS/Glue 查询体验与未来的 MySQL / PostgreSQL / Yellowbrick 等 JDBC 数据源
统一入口 **DBHub**。

- 顶层导航项从「Data Catalog」改名「DBHub」，**复用原顶级页**。二级 sub-tab 只有两个
  **固定项** `[ Overview ] [ Glue Catalog ]`；Connections 与 Network Profiles 都在
  **Overview 里**添加和编辑。每个连接在 Overview 有一个「显示为二级 tab」开关 ——
  启用后（如新加的 MySQL1），tab 栏直接在 Glue Catalog 旁多出一个 `MySQL1` 项，
  点进去即是该库的查询页（复用 Glue 工作区布局），无需先经过任何列表页。
- **数据库 = 一个「连接」对象**（MySQL / Postgres / Yellowbrick 以连接对象管理；AWS
  账号是内置数据源、天然只读），选中一个有查询能力的连接后，落进**现成的 Glue 工作区**（左数据源目录树 ｜ 右
  SQL 编辑器 + 结果 Tabs）去查询 —— 最大化复刻 `2026-06-26-glue-catalog-design.md`
  的布局与雅典娜交互。
- 每个已启用的连接可「注册/激活」成**只读 SQL 工具**供 AI Chat（以及外部 MCP agent）
  自动查询分析，**默认只读**，禁止任何改库操作。
- 后端纯 Rust：JDBC 层用 `sqlx`，隧道用 `russh`，SOCKS5 代理用原生 client —— 与
  `2026-08-27-rust-rmcp-chat-design.md`、`2026-08-28-ai-assistant-page-design.md` 里
  「MCP in-process + 凭证不出 Rust 进程 + 工具层只暴露 LLM-safe 投影 + 全程审计/只读」
  的安全规则一致。

本文给出：命名与导航（两个固定 tab + 动态连接 tab）、数据模型与 DB schema、
Overview / Network Profiles / 连接向导的 UI 骨架、Rust 侧连接/查询/隧道能力、
只读 SQL → AI 工具的注册机制（含对 rmcp 静态工具的裁决）、分阶段实现批次与改动
文件、以及风险与未决项。

---

## 0. 决策记录（一次性拍板）加注的结论

| 需求 | 拍板结论 |
|---|---|
| 1 顶层导航 | 本实现把顶级 `PageId "glue"` **就地改造成 DBHub 宿主**（label/icon/内部 sub-tab），不加新的顶级 Sidebar 项；二级 tab 固定 `[Overview][Glue Catalog]`，连接按开关动态增补为二级 tab |
| 2 查询体验 | 数据库一律抽象成「连接」，复用现 Glue 工作区；第一版即具备可查询连接的完整工作区（不是纯配置门户） |
| 3 后端技术 | Rust 原生：`sqlx`(postgres)+扩展 mysql feature；隧道 `russh`；SOCKS5 自研/`tokio-socks` |
| 4 交付物 | 一份设计 + 任务拆分文档（本文）；批次落地，每批独立可测 |
| 5 账号绑定 | DBHub 全部数据（连接、Network Profiles、tab、查询缓存）按**激活 AWS 账号**隔离，切账号即换一套视图，不共享 |
| 6 状态缓存 | 页内 tab 用「懒挂载 + 保留」防卸载丢态；另用 localStorage 按 `(accountId, connectionId)` 分键持久化 SQL 草稿/历史/结果元数据，大结果只存元数据 + 一键重跑（§7） |

设计边界：**Yellowbrick 首版走 Postgres-wire**（`postgres://` 端点 + `sqlx-postgres`），
其专有超级 SQL 语法与安全视图规则留待后续；本文只保证「连接 + 只读查询 + 目录树可
浏览」在 Yellowbrick 上可用。MySQL 在 sqlx 的 mysql feature 下原生支持。

---

## 1. 命名与导航

当前 `pageMeta.ts` 的顶级 `PageId` 是平铺的（`submit/history/logs/s3/glue/templates/…`），
`AppShell.tsx:switch` 按 `PageId` lazy import 一个整页，整页自带 <Tabs>（参考
AI 页 `AiAssistantPage`，5 个 sub-tab 都在这一个页组件里）。

**改动：`"glue"` 顶级页 = DBHub 宿主**，进页即一条 sub-tab 栏，由「2 个固定项 +
N 个动态连接项」组成：

```
[Overview] [Glue Catalog] | [MySQL1] [PG 报表库] …   ← 竖线后是动态连接 tab
```

- **Overview** —— DBHub 的管理中枢：上半是连接卡片列表（每张卡 = 连接名 + kind 图标 +
  测试状态 + 占用的 Network Profile + 三个开关：`Enabled for AI`、`Show as tab`、
  只读策略），并提供 `[+ Add Connection]`（DBeaver 式向导）与 `[Network Profiles…]`
  入口（打开 Network Profiles 的 Master–Detail 面板）。**Connections 与 Network
  Profiles 都在 Overview 里添加和编辑**，不再各自占一个固定 tab。
- **Glue Catalog** —— 现 `GlueCatalogPage` 的全部内容原样搬进此 tab（首版不重画）。
- **动态连接 tab** —— 连接的 `show_as_tab` 开关打开后，tab 栏在 Glue Catalog 旁直接
  多出一个以连接名命名（如 `MySQL1`）的项，点进去即是该库的查询页（复用 Glue 工作区
  布局：左目录树 ｜ 右 SQL 编辑器 + 结果 Tabs）。开关关闭则 tab 消失，但连接本身
  仍在 Overview 列表中（AI 注册状态不变）。tab 数量多时由 Tabs 栏横向滚动。

顶级导航里：

| | 现在 | 之后 |
|---|---|---|
| `PageId` | `"glue"` | 不变（仍是顶级页，只是内容改名聚合） |
| Sidebar label | Data Catalog | DBHub |
| description | Glue tables and Athena SQL | Databases, connections & queries |
| 图标 | `Table2` | 复用（或 `DatabaseZap`，配合 description 改） |
| 页面组件 | `pages/GlueCatalogPage.tsx` | `pages/DbHubPage.tsx`（壳 + sub-tabs） |

波及：`pageMeta.ts`（label/description/icon）、`AppShell.tsx`（lazy import 与
switch case 指向 `DbHubPage`）、键盘/PageId 相关的 `pageNavigation` 系列**不受影响**
（`glue` id 保留）、`pageMeta.test`、`AppShell.test`。`2026-06-26-glue-catalog-design.md`
中的 Glue 工作区实现整体包进一个 `<GlueCatalogTab/>`，不再顶层直出。

---

## 2. Overview 的含义与「连接」首版统一

首版引入一套最小统一的**连接视图模型**，驱动 Overview 管理 / 动态 tab / 只读注册：

```ts
type DataKind = "aws-athena" | "mysql" | "postgres" | "yellowbrick";

type ConnectionOptions = {
  showAsTab: boolean;               // 是否在二级 tab 栏出现该连接的查询页
  supportsAi: boolean;              // 是否可注册成只读 SQL 工具
  enabledForAi: boolean;            // 用户开关（#6）
  readOnlyPolicy: "select-only" | "read-only-ops";  // 默认 select-only
};
```

—— **AWS 账号不是普通连接**（无需用户填 JDBC 字段、SQL 走 Athena、靠现存 account
preferences/credential）。所以 AWS 账号永远内嵌在 Glue Catalog tab 顶部，天然只读、
天然 `enabledForAi`（等同现有 MCP `analyze_job_failure` 系列 + Athena 只读的定位），
也不出现在 Overview 的连接卡片里。而 MySQL/Postgres/Yellowbrick 是**新连接二维
CRUD**（见 §4），在 Overview 中添加、编辑、开关。

> 结论：本版**不把 AWS 账号搬进连接的 CRUD**（避免跟现 account 切换 UI 抢语义）。
> 连接管理只管「非 AWS 的 JDBC 连接」。Glue Catalog 里的账号切换维持现状。

---

## 3. 导航/页面宿主改动文件

**前端**

```
src/pages/pageMeta.ts                    label"Data Catalog"→"DBHub"；description；icon
src/pages/DbHubPage.tsx                  （新）顶级页壳：固定 tab [Overview][Glue Catalog] +
                                         动态连接 tab 栏（读 show_as_tab 连接列表）
src/pages/GlueCatalogPage.tsx            内容收编为 tab 组件（见 workspace/GlueCatalogTab）
src/components/dbhub/
  overview/
    OverviewPanel.tsx                    管理中枢：连接卡片区 + 两个入口（向导 / Profiles）
    ConnectionCard.tsx                   连接卡：kind 图标/测试状态/profile + 开关组
    (ConnectionFormDialog.tsx            DBeaver 式「Connect to a database」表单（弹窗或抽屉）
    NetworkProfilesSection.tsx           Network Profiles Master–Detail（Overview 内展开/弹窗）
    ProfileDetail.tsx                    右栏：SSH Tunnel / Proxy 两个视图 + Use 开关
    SshTabFields.tsx / ProxyTabFields.tsx
    DriverPropsEditor.tsx                name-value 编辑（复刻 jobConfig 的 name/value 行样式）
  workspace/
    GlueCatalogTab.tsx                   ← 由现 GlueCatalogPage 的 content 收编为 tab
    ConnectionQueryTab.tsx               动态连接 tab 的查询页（复用 Glue 工作区布局 +
                                         mysql/pg 元数据读取，首版与 GlueCatalogTab 同构）
src/hooks/useDbConnections.ts            connections CRUD + test + 开关（showAsTab/ai）
src/hooks/useNetworkProfiles.ts          profiles CRUD
src/hooks/useDbQuery.ts                  对 JDBC 连接执行 SQL/目录树（Rust 命令）
src/services/dbConnectionService.ts
src/services/networkProfileService.ts
src/services/dbRegistry.ts               「哪个连接已注册进 AI / 显示为 tab」query 层
src/services/sqlDialect.ts               per-dialect SQL 模板/只读校验客户端参考（可选）
src/types/domain.ts                      加 DbConnection / NetworkProfile / DbQueryResult 等类型
```

**既有组件复用：** 连接「详情表单 + 测试连接」复用 `DatabaseMetadataPanel` /
`ApiKeysDialog` 的表单 grid 样式与 `AwsRegionInput`；测试连接 toast 语义沿用
`useLlmConfig.test_llm_endpoint`；Master–Detail 布局参考 Settings 的 Account 列表。

---

## 4. Rust 数据层与「连接」 schema

沿用 `repository.rs::migrate()` 里 `create table if not exists` 一次性列表风格。与
`db/redact.rs` 一致的「模块化 migrate 子函数」。常量与 json payload 存法沿用
`aws_accounts`/`llm_*`（具体标量列 + JSON payload 列）。

核心三表（独立 kv：连接、网络 profile、已启用注册）：

```sql
create table if not exists db_connections (
  id text primary key,
  account_id text not null,          -- 所属 AWS 账号（aws_accounts.id）；不同账号互不可见
  kind text not null,                -- 'mysql'|'postgres'|'yellowbrick'
  name text not null,                -- 列表/工具/tab 展示名
  host text not null,                -- hostname/IP
  port integer not null default 3306,
  database text,                     -- 目标库名（可选）
  username text not null,
  auth_method text not null default 'password',   -- 'password' | 预留
  network_profile_id text,           -- 关联 Network Profile（同账号内）；null=直连
  show_as_tab integer not null default 0,         -- 开→二级 tab 栏出现该连接查询页
  enabled_for_ai integer not null default 1,      -- #6 注册到 Chat 的开关
  ai_read_only_policy text not null default 'select-only',
  sort_order integer not null default 0,
  created_at text not null, updated_at text not null
);
create table if not exists network_profiles (
  id text primary key,
  account_id text not null,          -- 同样按 AWS 账号隔离
  name text not null,
  kind text not null,                -- 'ssh-tunnel' | 'socks5'
  transport_json text not null,      -- ssh host/port/user/auth / socks host/port + 可选 user/pass
  enabled integer not null default 0,
  created_at text not null, updated_at text not null
);
create index if not exists idx_db_connections_account on db_connections(account_id, sort_order);
create index if not exists idx_network_profiles_account on network_profiles(account_id);
```

**账号绑定（约束 #7）**：DBHub 的一切（连接、Network Profiles、二级 tab、查询缓存）
都挂在**当前激活的 AWS 账号**下 —— 侧边栏切换账号后，Overview / 动态 tab / 向导里
看到与编辑的是新账号自己的那套数据，互不共享。实现规则：

- 所有 list/create/update/delete 命令都以**激活账号**为默认 scope（命令内部取激活
  账号 id，前端也可显式传 `accountId`），写入时强制填 `account_id`。
- `network_profile_id` 引用只能指向**同账号**的 profile（Rust 侧写入校验）。
- 删除 AWS 账号 → 级联删除其 `db_connections` 与 `network_profiles` 及对应 secrets
  条目（Rust 侧按顺序删，不用 SQLite cascade，与 `llm_*` 同规则）。
- 密钥 secrets key 用连接自身 uuid（`db/{id}/password`），天然随连接隔离，无需再按
  账号分键。

密钥**不进 DB**：密码/SSH passphrase/私钥 passphrase 走 `secrets.rs`（keyring /
debug 本地 json），key 例如 `db/{id}/password`、`profile/{id}/ssh_passphrase`。前端只
见掩码，可替换不可读回 —— 与 AWS key 相同的规则。普通连接元数据（host/user/库名）
进 DB（非机密），使 profile 列表无需解密即可流畅展示。

命令（`commands/db.rs`、`commands/network.rs`，全部在 `lib.rs::generate_handler!` 注册）：

```
// connections（元数据入 db，凭据入 secrets）
list_connections() -> Vec<DbConnection>            // 不含密码
create_connection(ConnectionInput) -> DbConnection
update_connection(id, fields, password?)           // password absent = 不改
delete_connection(id)                              // 连带清 secrets
test_connection(id) -> { ok, message, latencyMs }
set_connection_flags(id, { showAsTab?, enabledForAi?, readOnlyPolicy? })

// network profiles
list_profiles() -> Vec<NetworkProfile>
save_profile(NetworkProfileDraft) -> NetworkProfile // create/upsert 合并
delete_profile(id)                                 // 被连接引用则拒绝(先解绑)，详见 §13 偏离
test_ssh_tunnel_profile(id) -> { ok, message }      // 仅握手连通
```

遵循 IPC 约定：单一 `tauriClient.ts`（snake_case 命令 + 驼峰方法），`DbConnectionInput`
上 `#[serde(rename_all="camelCase")]`。`DbHubPage` 的动态 tab 栏直接消费
`list_connections()` 里 `showAsTab=true` 的子集（按 `sort_order`），无需额外命令。

MySQL/Postgres驱动：给 `sqlx` 打开 `postgres` + （条件）`mysql` feature，默认最小
编译；库表不依赖任何后端实现细节。

---

## 5. 连接向导 UI（需求5 + 需求4 合并落地）

从 Overview 的 `[+ Add Connection]` / 卡片「编辑」打开（Dialog 或 Sheet，沿用
`AccountFormDialog` 的壳），复刻 DBeaver「Connect to a database」的分组与按钮语义。
字段随 `kind` 切换：

```
[Connect to a database · MySQL]
  Connect by   ◍ Host  ◯ URL                    // 驱动下面 host/url 互斥启用，同 DBeaver
  Server: host [10.2.3.4]  port[3306]  database [sales]
  Authentication: user[bi_reader]  pwd[ ●●●● ]  ☑ Save password   // 存 secrets
  Network Profile ▾:  (None) / 10.xx.xx.50 (SSH) / socks5@1080   ⬅ 需求4
  只读 AI: ☑ Enable read‑only SQL tool for AI   policy ▾ (Read‑only SELECT …)
  二级 tab: ☑ Show as tab (「MySQL1」会出现在 Glue Catalog 旁，点击直达查询页)
底部: [Test Connection]   [Save and Close]  [Cancel]
```

- **test_connection(id)** 需要临时拉起隧道/直连，无副作用。
- kind 与协议联动到 driver name，「Connect by：Host/URL」两种驱动形态里 URL 预填
  jdbc…（Yellowbrick: `jdbc:yellowbrick://…`，但实际 wire 连接用它映射 postgres URL）。
- `Show as tab` 与 `Enable read-only SQL tool` 相互独立：可以「隐藏 tab 但仍给 AI 用」，
  也可以「只给自己查、不给 AI」。

---

## 6. Network Profiles 面板（需求3，Overview 内打开）

不再占用固定 tab —— 作为 Overview 里的一个区块/面板（点击 `[Network Profiles…]`
展开 Master–Detail 或弹出 Dialog）：左列表（Create/Delete/Copy），右 ProfileDetail
内「SSH Tunnel｜Proxy」Tab。字段完全按用户提供的 mock 实现（Host/IP、Port、User、
AuthMethod Password/…、Password 掩码 + Save credentials、Jump servers / Advanced
折叠、底部 Test configuration；Proxy：SOCKS Host/Port/User/Pass/Save switch）。会用
`@/components/ui/*`(Tabs, Select, Checkbox, Switch, ScrollArea, Separator, Input)
与 radix 已有依赖，**无新前端依赖**。

用一条 `network_profile` joined 到连接,SQL 查询 resolve 时依 profile kind 建隧道或走
SOCKS:

- **ssh-tunnel**：`russh` 建本地↔远程 TCP bridge（同 Yellowbrick 直连但走 tunnel）
- **socks5**：连接 `127.0.0.1:1080`(用户配置远端) ，原生 client `CONNECT host:port`，
  握手后把 字节流 接给 sqlx

两者都要求「native Rust client、凭证 stays in a `secrets`、绝不落 WebView」。测试按钮
仅握手丢包计时，不入库。

---

## 7. 工作区状态与查询缓存（约束：切账号/切页不丢）

用户约束：**不同的数据库查询信息和查询结果，在每次切换账号或数据库页面时不丢失，
期望缓存在本地。** 丢状态的根因有两个，分别对应两层方案：

1. **组件卸载** —— 现 `GlueCatalogPage` 的 `sql`/`resultTabs`/`selectedDatabase` 都在
   React state 里，AppShell 顶级页切换与 Radix Tabs 默认行为都会卸载组件 → 全丢。
   **方案：DBHub 页内 tab 用「懒挂载 + 保留」容器** —— 某个 tab 第一次激活时挂载，
   之后切走只隐藏（`hidden` / `forceMount`），不卸载。Glue tab、每个连接 tab 各自
   保留自己的编辑器内容、结果 tabs、目录树选中态；连接 tab 在其连接被删除或
   `show_as_tab` 关闭时才真正卸载并清缓存。DBHub 整页切走（去 Submit Job 等）时
   页组件仍会卸载 —— 这一层兜不住的交给第 2 层。
2. **本地持久化** —— 沿用 `sqlQueryStorage` / `athenaPreferencesStorage` 的
   localStorage 按 id 分键模式，键按 `(accountId, connectionId)` 隔离：

   ```
   emr-eks:dbhub-ws:{accountId}:{connectionId}   连接查询工作区
   emr-eks:dbhub-ws:{accountId}:glue             Glue tab（账号维度）
   emr-eks:dbhub-ws:{accountId}:overview         Overview 折叠/选中态
   ```

   持久化内容：SQL 草稿、查询历史 / favorites（Glue tab 已有，直接沿用现有
   account 级键）、目录树最后展开/选中、结果 tab 的**元数据**（标题、SQL 快照、
   行数、列名、完成时间、状态）。**大结果集不进 localStorage**：超过阈值（约
   200 行 / 1 MB，先拍这组默认值）只存元数据并标注「结果未缓存 · 可重新运行」，
   tab 上保留一键重跑；这个取舍写进结果的空状态文案，避免用户以为结果丢了是 bug。
   恢复时机：DbHubPage / ConnectionQueryTab 挂载时按当前激活账号读键 rehydrate；
   切换 AWS 账号 = 换一组键重新水合，两个账号的草稿互不覆盖。

**与账号绑定（约束 #7）的配合**：缓存键第一段就是 accountId，所以「切账号不丢」
与「账号间不共享」是同一条规则的两面 —— 同一连接 id 只存在于其账号的键空间里。
连接被删除时，Rust 侧删行 + secrets，前端负责清掉对应 localStorage 键。

**不做的事**：不在缓存里存明文密码/密钥（secrets 只在 Rust 侧）；不缓存跨设备的
同步语义（localStorage 即本机本地）；不为「结果集」建 SQLite 表 —— 首版元数据 +
重跑足够，真要离线翻旧结果再评估 SQLite 结果表（记为 follow-up）。

## 8. 只读 SQL → AI 工具（需求6）

**问题核心：工具动态注册 vs 现存静态 `#[tool_router]`。**

现存 `McpTools`（`server.rs`）在编译期声明工具（`#[tool_router]` 扫描 impl 静态方法），
`in_process.list_tools()` 返回这些静态工具，把调用发给 `analyze_job_failure`、只读
AWS 工具。对应多数据源的 per-connection SQL 工具**不能**在编译期逐个展开 —— DBHub
连接是运行时数据、可能增删启停，而且已入库。

**设计裁决（三层）：**

- **层1 — 静态注册「数据库可查询」能力面**:给 `McpTools` 增加静态工具（非 per-连接）
  `list_databases`（只回**当前激活 AWS 账号**下 `enabled_for_ai=true` 的连接名/kind，
  不含密码/主机信息 —— LLM-safe 投影，同 `list_accounts` 不暴露 ACL/账号 id），
  以及一个**参数带 `connectionId`** 的静态
  SQL tools：
  `sql_query_text(connectionId, sql, limit)` → 只读执行。它在运行时从 DB 读出该连接 +
  校验 `enabled_for_ai` 与**连接属于激活账号**（跨账号的 connectionId 直接结构化拒绝）+
  套 `read_only_policy`（引擎层只允许 SELECT/只读序列、拒绝
  一切 DDL/DML —— 引擎层阻塞 DDL/DML/GRANT）。这样**diff 面最小**
  —— add 两个编译期静态方法，动态数据只有「参数」由工具名标识。**与现 `#[tool_router]`
  架构完全兼容**，无需修改 rmcp 的动态 advertisement。
- **层2 — per-connection 动态观测 `Vec<Tool>` 只给 LLM 列表**:Chat 的请求构建本就读
  `in_process.list_tools()`; DBHub 把一个「启用AI 连接 → 自然语言 name+只读 SELECT
  能力 + 库表概要」的 *描述性* tool 集 merge 进 `enabled_tools` 过滤后的 LLM 定义，
  使模型能「针对 sales 库问 COUNT/AVG」→ 它看到的名称让人容易定位,但**执行仍汇聚到
  静态 `sql_query_text` int 参数校验**。`enabled_tools` 已是 null-or-array 语义,DBHub
  仅在其 set 里加「DBHub:mysql_sales_readonly」这种名称。
- **层3 — 默认全库只读**（需求6硬性）:
  Rust 查询引擎 `block` 掉所有不改写命令。只放行 `SELECT` + 显式 readonly 白名单
  （`show`/`describe`/`explain` 由 dialect trim / 前缀）。若某库要求「read-only-ops」
  也嵌显式（yellowbrick 专属函数）再分开。执行快照双保险：引擎层 + sqlx 事务只读
  `transaction().with(IsolationLevel)` -- 对PG/mysql 用 set-transaction-read-only。

> 每个来自 chat/inprocess/external 的调用都写入 `mcp_audit`，与现在 `run_tool` 调度
> 一样由 chat loop 标注 provider/model 或 HTTP server audit —— 因此 DBHub 只读 SQL
> 也必然是「审计一次」路径的一部分。**外部 MCP agent 与内置 Chat 共享同一组静态
> 工具 → 同一组安全边界。**（reference 到 memory-configurable-redaction 不可逆出的
> 潜池外：若未来 External agent 也能跑 DBHub readonly SQL，需要延续
> redact_config 对返回结果的脱敏管线。）

**实施细节(命令/Rust 侧)**

```
src-tauri/src/dbhub/
  mod.rs            迁移子函数(db_connections/network_profiles) + CRUD 函数
  tunnel.rs         russh 隧道 bridge
  proxy.rs          SOCKS5 handshake client
  engine.rs         sql 方言门禁(阻塞改写) + per-dialect metadata sniff
  driver.rs         单一函数：给定 connection+profile+sql 返回 rows（curl 到 sqlx）
commands/db.rs      list/create/update/delete/test_connection/set_connection_flags
commands/network.rs list/save/delete/test_*
mcp/tools/ read_only_tools.rs 增加 sql_query_text
mcp/server.rs       增加两个静态 #[tool] 方法走 run_tool、复用只读门禁
mcp/source.rs       AppSqlSource（数据源带 app handle）
secrets.rs          expose db/profile secrets key 命名
models/mod.rs       DbConnection/NetworkProfile/… DTO
lib.rs              generate_handler 扩展
Cargo.toml/Cargo.lock    sqlx features: postgres/mysql + russh + (tokio-socks 或手写)SOCKS
```

---

## 9. 布局与风格特征（需求 mock 对照落地原则）

面板类引导严格复刻用户给的两套 mock 特征：

- **Network Profiles / Master-Detail** —— 浅灰底白卡蓝强调；标题行(粗体+右侧
  ◀ ▶▾  ⋮)；两栏各自带底操作行同一水平线；列表滚动；标签右对齐/控件左对齐；
  「Use SSH Tunnel」总开关对整组启停；折叠(▶ Jump servers / Advanced)收低频项；
  全局右对齐 `Cancel / Apply and Close` 页脚。
- **Connection wizard** —— 分组 Server / Authentication; connect by host/url 互斥；
  Test Connection 即时探活;save password 持久化框靠近密码字段;底部向导按钮栏按
  step 显隐/灰。

实现时可以复用 `2026-06-26-glue-catalog-design.md` 与 `job-logs-layout-design.md`
既有 form grid/工具型排版习惯，也允许少量新增 css。（项目组件规则：不用 Ant/MUI/
Bootstrap，统一走 `@/components/ui/*`。）

---

## 10. 分阶段实现（每批独立可测、先绿再前进）

批次按「先不动 Glue 行为 → 数据层 → 管理面 → 查询面 → AI 面」排序；每批结束
`npm test` + `cargo test` 必须全绿。

> **状态：批次 0–6 全部实现完成**（2026-09-08，同日）。实现与设计的偏离记录在第
> 13 节。批次 7（README/deviations/既有测试修复）亦已完成。

### Batch 0 — 重命名与双固定 tab 容器（无新后端）✅
- `pageMeta` label「Data Catalog」→「DBHub」、description/icon
- 新建 `DbHubPage.tsx`：固定 tab `[Overview][Glue Catalog]`，默认落 Overview（占位
  空状态 + 「Add Connection / Network Profiles」按钮置灰）
- 现 `GlueCatalogPage` 内容原样收编为 `workspace/GlueCatalogTab.tsx`
- 验收：Glue 工区行为不变；`pageMeta`/`AppShell` 相关 test 对齐新 label

### Batch 1 — 数据层（连接 + 网络 profile，按账号隔离）
- `db_connections`（含 `account_id`、`show_as_tab`）/`network_profiles`（含
  `account_id`）两张表 + migrate + CRUD 函数 + secrets key 命名
  （`db/{id}/password`、`profile/{id}/…`）
- 所有命令默认以激活账号为 scope（内部取激活账号，写强制填 `account_id`）；
  `network_profile_id` 只能引用同账号 profile（Rust 校验）；删 AWS 账号级联删
  连接/profile + secrets
- `commands/db.rs`/`commands/network.rs`（含 `set_connection_flags`）+ `lib.rs` 注册
- 前端 `useDbConnections`/`useNetworkProfiles`/`dbConnectionService` 拉通（暂无 UI）
- 验收：`cargo test` 覆盖 CRUD、secrets 读写、账号 scope 隔离（A 账号建的连接 B 账号
  list 不可见）、删 profile 置空引用、删账号级联

### Batch 2 — Overview 管理面 + Network Profiles UI
- `OverviewPanel` + `ConnectionCard`（开关组：showAsTab / enabledForAi / 只读策略）
- Network Profiles Master–Detail（按 §6 mock）：SSH Tunnel / Proxy 双视图、
  Test-tunnel 仅握手、全局 Cancel/Apply-and-Close 页脚
- 验收：完整建/复制/删 profile 与连接卡片开关流转；对真实 ssh 握手成功

### Batch 3 — 连接向导 + 测试
- DBeaver 式 `ConnectionFormDialog`（§5）：kind 切换、Host/URL 互斥、Network Profile
  下拉、`Show as tab` / `Enable read-only SQL` 双开关
- `test_connection` 真正走 sqlx（直连或经 profile 隧道）并计时；sqlx 打开
  postgres/mysql feature
- 验收：对本地 mysql/postgres 测试通过，错误可读

### Batch 4 — 动态连接 tab + JDBC 查询工作区（含状态缓存）
- `DbHubPage` 动态 tab：`showAsTab=true` 的连接按 `sort_order` 出现在 Glue Catalog
  旁，命名 = 连接名；`ConnectionQueryTab` 复用 Glue 工作区布局（左目录树 ｜ 右编辑器
  + 结果 Tabs），元数据读取抽 per-dialect（`show tables` / `information_schema` /
  `describe`）
- tab 容器「懒挂载 + 保留」（§7 第 1 层）：切 tab 不丢编辑器/结果/选中态；DbHubPage
  挂载时按 `(accountId, connectionId)` rehydrate localStorage 缓存（§7 第 2 层）；
  大结果只存元数据 + 一键重跑
- 只读门禁随工作区一起生效：`insert/drop/alter` 报「blocked: read-only connection」
- 验收：能对一张真实表 SELECT 并翻页/导出；切走再切回 tab 内容不丢；切 AWS 账号再
  切回来，两边的草稿各自还在；开关关闭后 tab 消失、连接仍在 Overview

### Batch 5 — 只读 SQL → AI 工具（§8）
- `list_databases` + `sql_query_text(connectionId, sql, limit)` 两个静态 `#[tool]`、
  LLM-safe 投影、行数 cap + `[truncated]` 标注
- Chat 与外部 MCP agent 同组工具；`mcp_audit` 全程留痕；描述性 per-connection
  工具名 merge 进 `enabled_tools` 过滤
- 验收：Chat 内「查一下 MySQL1 里 sales 库今天有多少订单」全链路跑通；对被禁用
  连接的调用返回结构化拒绝；audit 表可见 provider/model

### Batch 6 — 隧道/方言深耕
- russh 私钥格式覆盖（OpenSSH/PEM/passphrase）、jump servers 链、SOCKS5 认证分支、
  Yellowbrick 真实端点验证；偏差记入 §11 风险或新增 deviations 节

### Batch 7 — 收尾 / 文档
- README 功能介绍、`2026-06-26-glue-catalog-design.md` 标注被本 doc 的 DBHub 语境
  接管、键盘快捷键（若有新增 tab 切换键）补进 ShortcutsDialog

---

## 11. 风险与未决项

1. **动态工具 vs 静态 router**（§8）。本裁决以静态两个工具承载 per-connection 参数
   化 SQL —— 不挑战 rmcp 静态 advertisement，但长期若想要「每个连接是独立 tool 名+
   tool description 差异」需升级到 rmcp 动态 tools；标记一个 follow-up。
2. **Yellowbrick** Postgres-wire 不保证 100% 兼容；首版只承诺 SELECT 与元数据探测
   在常规拓扑可用,专有语法/系统目录用独立适配,不阻塞主流程交付。
3. **凭据/密钥生命周期**——创建连接默认一定 `Save password`才可 AI:工具执行需要
   实时解密;test/save 全走 secrets;行为透传入 ws 前 mask。写入设计需要遵守 memory
   `configurable-redaction`(可配置脱敏不可逆出)和 MCP 安全底线。
4. **只读门禁的方言差异**——MySQL/PG 删表语句容易只读阻塞;视图/临时表可能要求
   `read-only-ops` 策略;复杂 prepare/prepare 前门禁对函数 默认保守放行 SELECT。
5. **网络 Profile 删除先解绑（语义修正，见 §13）**：原设计是「删 profile 置空连接引用」；
   用户要求改为被绑定即拒绝删除、提示先解绑（原行为会让连接悄然变直连）。
6. **数据体量/权限**——SQL tool 返回行数 cap + 明确截断标注（对齐
   `2026-08-28` chat 工具 60k [truncated] 规则）避免灌爆模型；外部 agent 路径同规则。

---

## 12. 与既有文档关系

- 替换/扩充：`2026-06-26-glue-catalog-design.md` 的导航层级语境已被本 doc 取代
  （该设计单独描述 Glue workspace 的布局细节仍适用）。
- 承接安全边界：`2026-08-27-rust-rmcp-chat-design.md`、`2026-08-28-ai-assistant-page-design.md`
  (3.1 schema 惯例、4.2 enabled_tools 过滤、5 安全、7 deviations)。
- 参考：`memory/dbhub-feature`（本会话新建）、`memory/mcp-builtin-feature`、
  `memory/configurable-redaction`。

---

## 13. 实现与设计的偏离（批次 0–7 落地时记录）

按落地顺序记录实现中做出的、值得写下来的判断：

**SSH host-key 首版不校验（accept-any）。** `dbhub_tunnel.rs` 的
`check_server_key` 恒返回 true —— 与设计「test-first 隧道体验」一致，但与
SSH 最佳实践相悖。known_hosts 指纹固定是明确的后续加固项，在使用文档（README
DBHub 节）中已明示。SOCKS5 路径无此问题（CONNECT 协议本身不含服务端身份）。

**隧道采用本地端口转发，而非驱动级 IO 路由。** 设计只说「把字节流接给
sqlx」。实现选择：profiled 连接先在 `127.0.0.1` 绑一个 OS 分配端口做本地
转发（russh direct-tcpip channel / SOCKS5 CONNECT），驱动拨本地端口、URL
仅改写 host/port。这让 `dbhub_driver`/`dbhub_query` 对直连与 profiled 连接
完全一致，避免触碰 sqlx 的自定义传输 API。代价：每次执行新开转发 + SSH 会话
（无会话复用），高并发场景是后续优化点。

**`AssertSqlSafe` 用于用户 SQL。** sqlx 0.9 拒绝动态 SQL 字符串；用户语句
本质是动态的，经 `sqlx::AssertSqlSafe(sql.to_string())` 放行。风险由三道已
有防线覆盖：只读门禁分类（任何非 SELECT 词形拒绝）、`SET TRANSACTION READ
ONLY`（wire 级兜底）、以及该 API 仅在「门禁已分类」之后调用。CRUD 路径
（表名列名拼接）仍走编译期 `update_column!` 宏的 `concat!`，未用 Assert。

**结果投影按对象数组而非列数组。** 设计 §8 写的是「列 + 行」，前端结果网格
按列名取值更直接，Rust 侧投影为 `Vec<serde_json::Value>`（JSON object per
row）。列清单单独携带用于表头。PG 侧首版全列按字符串解码（驱动的规范渲染），
数字原生解码留给结果网格打磨批次。

**工作区缓存额外持久化目录树选中态。** 设计 §7 列了「SQL 草稿/历史/favorites/
结果元数据」，未单列 catalog 选中项；实现把 `selectedDatabase` 并入同一键，
恢复时目录树回到上次位置，符合「不丢」的用户原意。

**Profile 测试按钮只验证本地绑定。** 设计说「测试按钮仅握手计时」。实现里
SSH/SOCKS 远端握手失败与配置错误在本地无法区分（目标库可能本来就不通），
`test_network_profile` 只证明本地 forward 绑定成功并回报端口，远端握手在真实
查询时由驱动错误如实呈现 —— 诚实边界写进了按钮的返回文案。

**查询工作区首版未接 CodeMirror。** Glue 工作区用的是 `AthenaSqlEditor`
（CodeMirror + 补全）。连接 tab 首版用普通 textarea + Cmd/Ctrl+Enter（补全
需 per-dialect 关键字表，属于独立工作量），布局与状态缓存与 Glue tab 一致。
接 CodeMirror 记为后续批次。

**顺手修复 3 个既有测试失败。** `AiAssistantPage` heading 断言（e647b97 删
PageHeader 未同步）、`AppShell` 的 "Data Catalog" heading 断言（同 commit）、
`releaseConfig` 两条（7ec7ba3 升级 setup-node@v5 未同步断言；signer argv
数组写法与 `signer sign` 字面量断言不匹配）。修复方式均为让断言贴合实现
现状，非放松语义。

**需求反馈轮（2026-09-09）补充记录：**

**SSH 认证扩展到 password / private-key / ssh-config 别名。** 用户反馈 password
不够 —— 企业跳板机普遍禁密码、用户早配好 `~/.ssh/config` 别名（含跳板链）。
实现：`SshTunnel` 增 `private_key_path`（路径非机密，随 transport JSON；passphrase
走 secrets）；`resolve_ssh_endpoint` 把 transport 解析成 `SshEndpoint`，别名模式
手写 `~/.ssh/config` 子集解析（Host 精确/通配、HostName/User/Port/IdentityFile、
`~` 展开），复用用户既有跳板配置。store secret 在 key/别名模式下充当 key
passphrase。5 个 resolver 测试。

**「Profile is disabled」卡死的两个坑。** (a) 新建 profile 默认 disabled 且 Enable
只改本地 state（Apply 才落库），而 Test 探测数据库旧值 → 改：Test 先静默保存工作
副本再探测（同连接向导语义）；新建/复制默认 enabled。(b) 语义修正：`enabled` 只
决定真实路由，不再阻止测试（测试是验证配置）。另在切换认证方式时清掉残留 host
（防 IP 变幽灵别名）。

**Profile 删除改为「先解绑」。** 原设计删除即置空连接引用；用户要求被绑定即拒绝。
实现：db 层 `list_referencing_connections`（账号内、按名排序）；`delete_network_profile`
命令有引用即返错（后端兜底）；前端删除入口收口到列表底部，被绑弹「Profile is in
use」列出绑定连接、未绑走确认对话框。

**Overview 连接卡补删除。** 用户要求能删除连接。实现：卡片加删除图标 → 确认
对话框 → `delete_db_connection`，成功后清该连接的 workspace 缓存（防复活幽灵草稿）。

**DBHub 命令统一单一 `request` 参数。** 前面 batch 全在本地 mock/单测下绿灯，真机
运行才暴露：前端 `tauriClient` 把所有 payload 包进 `{ request }`（仓库铁律），而
早期 DBHub 命令参数名是 `connection_id`/`profile_id`/`input` → Tauri 按名匹配不到。
已全部改为 `DbConnectionRef`/`NetworkProfileRef`/`DbConnectionFlagsRequest`/
`DbCatalogRequest` 单一 request，并加 serde 回归测试逐条演练前端 payload 形状。
