import type { TranslationDictionary } from "@/i18n/types";

/**
 * DBHub: the connection hub (Overview, connection wizard, network profiles)
 * and both query workspaces (Glue/Athena and per-connection JDBC).
 *
 * Keys are the exact English source text. Error and failure copy is
 * deliberately absent — `toast.error`, inline errors and every service-layer
 * message stay in English by product decision, so a missing key here is the
 * correct outcome for them.
 */
const dbhub: TranslationDictionary = {
  // --- DbHubPage: the fixed second-level tabs ------------------------------
  Overview: "概览",
  "Glue Catalog": "Glue 数据目录",

  // --- OverviewPanel -------------------------------------------------------
  "Database connections": "数据库连接",
  "No connections for this AWS account yet.": "此 AWS 账户暂无连接。",
  "{count} connection(s), pinned to tabs: {pinned}": "共 {count} 个连接，已固定到标签页：{pinned}",
  "Manage Network Profiles": "管理网络配置",
  "Network Profiles ({count}) — SSH tunnels & SOCKS5 proxies":
    "网络配置（{count}）——SSH 隧道与 SOCKS5 代理",
  "Add Connection": "添加连接",
  "Loading connections…": "正在加载连接…",
  "Delete connection?": "删除连接？",
  'Delete "{name}"?': "删除“{name}”？",
  "This removes the saved connection and its passwords, hides its query tab, and drops its cached workspace. Read-only AI queries to it are disabled too. This cannot be undone.":
    "这将移除已保存的连接及其密码、隐藏其查询标签页，并清除其缓存的工作区。发往该连接的只读 AI 查询也将被禁用。此操作无法撤销。",

  // --- ConnectionCard ------------------------------------------------------
  "pinned to tabs": "已固定到标签页",
  "removed from tabs": "已从标签页移除",
  "enabled for AI": "已为 AI 启用",
  "disabled for AI": "已为 AI 禁用",
  "{name}: {items}.": "{name}：{items}。",
  "AI read-only": "AI 只读",
  Manual: "手动",
  "Delete {name}": "删除 {name}",
  "Delete connection": "删除连接",
  "Edit {name}": "编辑 {name}",
  "Edit connection": "编辑连接",
  "Network:": "网络：",
  "Direct connection": "直连",
  "Auth:": "认证：",
  "Show as tab": "显示为标签页",
  "Allow writes": "允许写入",
  "Your own queries may modify this database — the AI still cannot":
    "你自己的查询可以修改此数据库——AI 仍然不能",
  "Enabled for AI": "为 AI 启用",
  "Read-only SQL tool": "只读 SQL 工具",

  // --- ConnectionFormDialog ------------------------------------------------
  "Connect to a database": "连接到数据库",
  "Settings apply to the active AWS account. Passwords are stored in the system credential store, never in the app database.":
    "设置应用于当前 AWS 账户。密码存储在系统凭据库中，绝不写入应用数据库。",
  Driver: "驱动",
  "My MySQL Prod": "我的 MySQL 生产库",
  Server: "服务器",
  "Connect by": "连接方式",
  Host: "主机",
  "Server Host": "服务器主机",
  Port: "端口",
  Database: "数据库",
  Authentication: "认证",
  Username: "用户名",
  Password: "密码",
  "Auth mode": "认证方式",
  "Manual password": "手动密码",
  Secret: "密钥",
  // Product name: it stays as AWS spells it.
  "AWS Secrets Manager": "AWS Secrets Manager",
  "Select a secret…": "选择密钥…",
  "Optional fallback — secret may override": "可选回退 — 密钥可能覆盖",
  "Password and optional host/user/database come from the bound secret JSON at connect time.":
    "连接时从绑定的密钥 JSON 读取密码及可选的 host/user/database。",
  "Local password": "本地密码",
  "SM: {name}": "SM: {name}",
  "Save as AWS Secret": "保存为 AWS 密钥",
  "Create and bind AWS Secret": "创建并绑定 AWS 密钥",
  "Secret created and bound.": "密钥已创建并绑定。",
  "Password is required to create a secret.": "创建密钥需要填写密码。",
  "Needed only to create a new secret": "仅在创建新密钥时需要",
  "Connection name is required.": "连接名称必填。",
  "•••••••• (saved — leave blank to keep)": "••••••••（已保存——留空则保持不变）",
  "Routing & AI": "路由与 AI",
  "Network Profile": "网络配置",
  "(None — direct connection)": "（无——直连）",
  "Show as tab (next to Glue Catalog)": "显示为标签页（位于 Glue 数据目录旁）",
  "Enable read-only SQL tool for AI": "为 AI 启用只读 SQL 工具",
  "Test Connection": "测试连接",
  Save: "保存",
  "Save and Close": "保存并关闭",
  Cancel: "取消",

  // --- NetworkProfilesSection ----------------------------------------------
  "Network profiles": "网络配置",
  "Network Profiles": "网络配置",
  "SSH tunnels and SOCKS5 proxies for the active AWS account. Double-click a name to rename it.":
    "当前 AWS 账户的 SSH 隧道与 SOCKS5 代理。双击名称即可重命名。",
  "SSH tunnels and SOCKS5 proxies this account's connections can dial through.":
    "该账户的连接可以经由这些 SSH 隧道与 SOCKS5 代理拨出。",
  "Create a profile to route database connections through SSH tunnels or SOCKS5 proxies.":
    "创建配置，让数据库连接经由 SSH 隧道或 SOCKS5 代理。",
  "Profile is in use": "配置正在使用中",
  '"{name}" is still bound to {count} {connections}.': "“{name}” 仍绑定到 {count} 个{connections}。",
  connection: "连接",
  connections: "连接",
  "Remove the Network Profile from those connections before deleting it, or they will keep pointing at a tunnel that no longer exists.":
    "请先解除这些连接的网络配置，否则它们会继续指向已不存在的隧道。",
  Close: "关闭",
  "Delete profile?": "删除配置？",
  "Connections already route directly; this only removes the profile so it can no longer be chosen.":
    "这些连接已经直连；此操作只是删除该配置，使其不再可选。",
  "Delete profile": "删除配置",
  "Loading…": "加载中…",
  "Profile name": "配置名称",
  "No profiles yet.": "暂无配置。",
  "Create profile": "创建配置",
  Create: "创建",
  Delete: "删除",
  "Copy profile": "复制配置",
  Copy: "复制",
  'Profile "{name}" created.': "已创建配置“{name}”。",
  'Profile copied as "{name}".': "已复制为配置“{name}”。",
  "Profile renamed.": "配置已重命名。",
  "Profile applied.": "配置已应用。",
  'Connection "{name}" deleted.': "已删除连接“{name}”。",
  'Profile "{name}" deleted.': "已删除配置“{name}”。",
  "New profile": "新配置",
  "{name} copy": "{name} 副本",

  // --- ProfileDetail -------------------------------------------------------
  // The SSH auth picker swaps labels: what the secret field means (a password
  // or a key passphrase) and what `host` means (an address or a config alias).
  "Double-click the name in the list to rename.": "双击列表中的名称可重命名。",
  "SSH Tunnel": "SSH 隧道",
  Proxy: "代理",
  Enabled: "启用",
  "Forwards database traffic through an SSH server. The database host/port you enter here is the *target* the tunnel opens on the far side.":
    "通过 SSH 服务器转发数据库流量。此处填写的数据库主机/端口是隧道在远端打开的*目标*。",
  "Alias mode reads": "别名模式读取",
  ": HostName, User, Port, IdentityFile and your existing jump chains come from there — the fields below are ignored except the alias itself. The passphrase field is only used when the config's key file is encrypted.":
    "：HostName、User、Port、IdentityFile 以及现有的跳板链都来自该文件——除别名本身外，下面的字段都会被忽略。仅当配置中的密钥文件已加密时才会用到密码短语字段。",
  "Host/IP": "主机/IP",
  "Key passphrase": "密钥密码短语",
  "Key passphrase (if encrypted)": "密钥密码短语（若已加密）",
  "SSH config alias": "SSH 配置别名",
  "User Name": "用户名",
  "Key file": "密钥文件",
  "Save credentials": "保存凭据",
  "(saved)": "（已保存）",
  "Dials database hosts through a SOCKS5 proxy.": "通过 SOCKS5 代理连接数据库主机。",
  "User name": "用户名",
  "Save password": "保存密码",
  "Save password/passphrase": "保存密码/密码短语",
  "Test tunnel configuration": "测试隧道配置",
  "Test proxy configuration": "测试代理配置",
  "Handshake-only; no SQL runs.": "仅握手；不执行 SQL。",
  Apply: "应用",
  active: "使用中",

  // --- DbAnalyzeDialog -----------------------------------------------------
  "Analyze with AI": "用 AI 分析",
  "Opens a new Chat session for": "为以下对象打开新的对话会话：",
  ". Describe what you want the assistant to do.": "。描述你希望助手做什么。",
  Instruction: "指令",
  "e.g. Count rows by status in the last 7 days and flag anomalies":
    "例如：按状态统计最近 7 天的行数并标记异常",
  "⌘/Ctrl+Enter to send": "⌘/Ctrl+Enter 发送",
  "Open Chat": "打开对话",

  // --- ConnectionQueryTab --------------------------------------------------
  "Analyze with AI · opens Chat with this connection's context":
    "用 AI 分析 · 打开带有此连接上下文的对话",
  "Expand catalog panel": "展开目录面板",
  "Show catalog": "显示目录",
  Write: "写入",
  "Read-only": "只读",
  "writes allowed here": "此处允许写入",
  "the AI reads this one": "由 AI 读取",
  manual: "手动",
  "Stop query": "停止查询",
  "stops reading; the server notices when the connection closes":
    "停止读取；连接关闭后服务端会察觉",
  "Run in new tab": "在新标签页中运行",
  "the result opens as its own tab beside this one": "结果会在本标签页旁以独立标签页打开",
  "Run query": "运行查询",
  "the read-only gate blocks every non-SELECT statement": "只读闸门会拦截所有非 SELECT 语句",
  "Write {kind} SQL here…": "在此编写 {kind} SQL…",
  "Back one level": "返回上一级",
  "Filter tables": "筛选表",
  "Filter databases": "筛选数据库",
  "No databases.": "无数据库。",
  "No schemas.": "无模式。",
  "No tables.": "无表。",
  "Choose what to show": "选择要显示的内容",
  "Showing {selected} of {total} object kinds": "显示 {total} 种对象类型中的 {selected} 种",
  "Run a query to see results here.": "运行查询后在此查看结果。",
  Cancelled: "已取消",
  "{count} row": "{count} 行",
  "{count} rows": "{count} 行",
  truncated: "已截断",
  "from row {row}": "从第 {row} 行开始",
  "Export CSV": "导出 CSV",
  "the rows loaded here, not the whole result": "此处已加载的行，而非整个结果集",
  "Query returned no rows.": "查询未返回任何行。",
  "Load more rows": "加载更多行",
  "Each page re-runs the query. Add an ORDER BY so pages stay stable.":
    "每页都会重新执行查询。请添加 ORDER BY 以保持分页稳定。",
  "The result set exceeded the local cache budget, so only this tab's metadata was kept.":
    "结果集超出本地缓存配额，因此仅保留了此标签页的元数据。",
  "Rerun to load fresh results": "重新运行以加载最新结果",

  // --- ResultPane / ResultViewRail -----------------------------------------
  // The rail's three labels reach `t()` through a variable, so they are absent
  // from the literal-key scanner and are listed here for the runtime lookup.
  // ("Text" already lives in the AI shard; this sidebar and that one agree on it.)
  Grid: "网格",
  Record: "单条记录",
  "Stopped before it returned any rows.": "在返回任何行之前已停止。",
  "The run failed, so there are no rows to show.": "运行失败，因此没有可显示的行。",

  // --- ResultGrid ----------------------------------------------------------
  "Drag a column header here to group rows": "将列标题拖到此处即可按该列分组",
  "Drop to group by this column": "松开即可按此列分组",
  "Remove {column} from grouping": "将 {column} 移出分组",
  "Drag to group · click the arrow to sort": "拖动可分组 · 点击箭头可排序",
  "Sort by {column}": "按 {column} 排序",
  "Column actions for {column}": "{column} 的列操作",
  "Sort ascending": "升序排列",
  "Sort descending": "降序排列",
  "Clear sort": "清除排序",
  "Group by this column": "按此列分组",
  "Remove from grouping": "移出分组",
  "Expand all groups": "展开所有分组",
  "Collapse all groups": "折叠所有分组",

  // --- ResultTextView ------------------------------------------------------
  "Tab-separated · {count} rows on this page": "制表符分隔 · 本页 {count} 行",
  "Copy as text": "复制为文本",

  // --- ResultRecordView ----------------------------------------------------
  "Select a row in the grid to read it here.": "在网格中选择一行即可在此查看。",
  "Previous record": "上一条记录",
  "Next record": "下一条记录",
  "Record {position} of {total}": "第 {position} 条记录，共 {total} 条",

  // --- ResultBottomBar -----------------------------------------------------
  "First page": "第一页",
  "Next page · re-runs the query": "下一页 · 会重新执行查询",
  "Last page · needs a row count first": "最后一页 · 需先统计总行数",
  Export: "导出",
  // Format names, not prose — they are spelled the same in every locale.
  CSV: "CSV",
  JSON: "JSON",
  "one object per row, as the driver sent it": "每行一个对象，与驱动返回的一致",
  "Rows per page": "每页行数",
  "Rows per page · takes effect on the next run, up to {max}":
    "每页行数 · 下次运行时生效，最大 {max}",
  Count: "统计",
  "Total rows · runs COUNT(*) over the whole statement": "总行数 · 对整个语句执行 COUNT(*)",
  "Count all rows · re-runs the query inside COUNT(*), which can be slow":
    "统计总行数 · 在 COUNT(*) 中重新执行查询，可能较慢",
  "rows {from}–{to}": "第 {from}–{to} 行",
  "updated {at}": "更新于 {at}",

  // --- QueryTabsPanel ------------------------------------------------------
  "New query tab": "新建查询标签页",

  // --- SqlEditor / AthenaSqlEditor -----------------------------------------
  "Write SQL here…": "在此编写 SQL…",
  "SQL editor": "SQL 编辑器",
  "Write Athena SQL here…": "在此编写 Athena SQL…",
  "No result tabs.": "无结果标签页。",
  "Close {title}": "关闭 {title}",

  // --- GlueCatalogTab ------------------------------------------------------
  "Athena query started.": "Athena 查询已启动。",
  "Athena query cancelled.": "Athena 查询已取消。",
  "Exported CSV to {path}": "已导出 CSV 至 {path}",
  "Table metadata updated.": "表元数据已更新。",
  "Database metadata updated.": "数据库元数据已更新。",
  "Drop table query started.": "删除表查询已启动。",
  "SQL saved to favorites.": "SQL 已保存到收藏。",
  Query: "查询",
  "Database Metadata": "数据库元数据",
  "Table Metadata": "表元数据",
  "Query settings": "查询设置",
  "S3 path required": "需要 S3 路径",
  "Drop table?": "删除表？",
  "This runs `DROP TABLE IF EXISTS {database}.{table}` in Athena and cannot be undone.":
    "这会在 Athena 中执行 `DROP TABLE IF EXISTS {database}.{table}`，且无法撤销。",
  "Drop table": "删除表",
  "Missing LOCATION clause": "缺少 LOCATION 子句",
  "This CREATE DATABASE statement does not include LOCATION. Athena allows it, but databases without an S3 location can be harder to manage later.":
    "此 CREATE DATABASE 语句未包含 LOCATION。Athena 允许这样做，但之后管理没有 S3 位置的数据库会更麻烦。",
  "This CREATE TABLE statement does not include LOCATION. Athena allows it for some cases, but external tables usually need an S3 path.":
    "此 CREATE TABLE 语句未包含 LOCATION。Athena 在某些情况下允许这样做，但外部表通常需要一个 S3 路径。",
  "Continue anyway?": "仍要继续吗？",
  "Don't remind me again for this account": "此账户不再提醒",
  Continue: "继续",

  // --- CatalogTree ---------------------------------------------------------
  "Back to databases": "返回数据库列表",
  "Loading databases...": "正在加载数据库...",
  "No databases found.": "未找到数据库。",
  "Show details for {name}": "显示 {name} 的详情",
  "Database details": "数据库详情",
  "Loading tables...": "正在加载表...",
  "No tables in this database.": "此数据库中没有表。",
  "Table details": "表详情",

  // --- DatabaseMetadataPanel -----------------------------------------------
  "Loading database metadata...": "正在加载数据库元数据...",
  "Read-only by default. Enable edit mode to update Glue database metadata.":
    "默认只读。启用编辑模式以更新 Glue 数据库元数据。",
  "Hover a database in the catalog and click the info icon to view metadata.":
    "在目录中悬停数据库并点击信息图标即可查看元数据。",
  "CREATE DATABASE DDL copied.": "已复制 CREATE DATABASE DDL。",
  "Copy DDL": "复制 DDL",
  "Edit metadata": "编辑元数据",
  " (read-only)": "（只读）",
  Created: "创建时间",
  Key: "键",
  Value: "值",
  "No properties.": "无属性。",
  "Remove property {key}": "移除属性 {key}",
  "New key": "新键",
  "New value": "新值",
  Add: "添加",

  // --- TableMetadataPanel --------------------------------------------------
  "Loading table metadata...": "正在加载表元数据...",
  "Select a table to view metadata.": "选择一张表以查看元数据。",
  "Read-only by default. Enable edit mode to update Glue metadata.":
    "默认只读。启用编辑模式以更新 Glue 元数据。",
  "CREATE TABLE DDL copied.": "已复制 CREATE TABLE DDL。",
  Description: "描述",
  "Double-click to edit": "双击编辑",
  "Double-click to edit description": "双击编辑描述",
  Owner: "所有者",
  "Table type": "表类型",
  Location: "位置",
  Columns: "列",
  "Add column": "添加列",
  "Partition keys": "分区键",
  "Add partition key": "添加分区键",
  "Storage formats": "存储格式",
  Parameters: "参数",
  Type: "类型",
  Name: "名称",
  Comment: "注释",
  "No columns.": "无列。",
  "Remove {kind} {name}": "移除 {kind} {name}",
  "No parameters.": "无参数。",
  "Remove parameter {key}": "移除参数 {key}",
  "Add parameter": "添加参数",
  "(system)": "（系统）",
  column: "列",
  "partition key": "分区键",

  // --- QueryResultsPanel ---------------------------------------------------
  "Run a query to see results.": "运行查询以查看结果。",
  "Status:": "状态：",
  "Scanned:": "已扫描：",
  "Engine time:": "引擎耗时：",
  "Rows:": "行数：",
  "Loading results...": "正在加载结果...",

  // --- SqlQueryMenus -------------------------------------------------------
  // Only the JDBC templates' labels are prose and translate; the Glue list
  // names SQL statements (`CREATE DATABASE`, `MSCK REPAIR TABLE`), which stay.
  "Saved query": "已保存的查询",
  "Save to favorites": "保存到收藏",
  "Choose a name for this saved SQL query.": "为此已保存的 SQL 查询选择一个名称。",
  "Favorite name": "收藏名称",
  "SQL templates": "SQL 模板",
  "Query history": "查询历史",
  "No recent queries yet.": "暂无最近的查询。",
  "Already in favorites": "已在收藏中",
  "Add to favorites": "添加到收藏",
  "Saved favorites": "已保存的收藏",
  "No favorite queries yet.": "暂无收藏的查询。",
  "Remove {name}": "移除 {name}",
  "Remove favorite": "移除收藏",
  "Sample rows": "示例行",
  "Count rows": "统计行数",
  "Group and count": "分组统计",
  "Join two tables": "连接两张表",
  "Recent rows": "最近的行",
  "Explain a plan": "查看执行计划",
  // Glue's template names are prose too; the ones that name a statement
  // (`CREATE DATABASE`, `MSCK REPAIR TABLE`) stay English and are simply
  // absent from this dictionary.
  "SELECT sample": "SELECT 示例",
  "CREATE ORC table": "创建 ORC 表",
  "CREATE Parquet table": "创建 Parquet 表",

  // --- AthenaQuerySettingsDialog -------------------------------------------
  "Set up Athena query output": "设置 Athena 查询输出",
  "Fix query output settings": "修复查询输出设置",
  "Choose a workgroup and an S3 folder for Athena query results before running SQL.":
    "在运行 SQL 之前，为 Athena 查询结果选择一个工作组和 S3 文件夹。",
  "Athena could not write query results with the current settings. Update the S3 output path or workgroup.":
    "Athena 无法使用当前设置写入查询结果。请更新 S3 输出路径或工作组。",
  "Configure the Athena workgroup and S3 path used when running queries.":
    "配置运行查询时使用的 Athena 工作组与 S3 路径。",
  "Query results are written to S3. Pick a bucket prefix your AWS account can write to, for example":
    "查询结果会写入 S3。请选择一个你的 AWS 账户可写入的桶前缀，例如",
  ".": "。",
  Workgroup: "工作组",
  "Managed results": "托管结果",
  "S3 results": "S3 结果",
  Managed: "托管",
  "This workgroup uses Athena managed query results. An S3 path is optional.":
    "此工作组使用 Athena 托管查询结果。S3 路径为可选项。",
  "S3 query results path": "S3 查询结果路径",
  "Not configured": "未配置",
  "Loading saved settings...": "正在加载已保存的设置...",
  "Browse S3 results path": "浏览 S3 结果路径",
  "Append submit user folder ({user})": "追加提交用户文件夹（{user}）",
  Done: "完成",

  // --- schemaObjects (service) ---------------------------------------------
  // UI labels for the object-kind filter, not SQL identifiers.
  Tables: "表",
  Views: "视图",
  Procedures: "存储过程",
  Functions: "函数",
  Events: "事件",
  "Foreign Tables": "外部表",
  "Materialized Views": "物化视图"
};

export default dbhub;
