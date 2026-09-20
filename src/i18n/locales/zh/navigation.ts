import type { TranslationDictionary } from "@/i18n/types";

/**
 * Sidebar and page-header copy. These keys mirror the `label` / `description`
 * fields of `src/pages/pageMeta.ts`, which is intentionally left as plain
 * English data so its own test keeps asserting on the source strings.
 */
const navigation: TranslationDictionary = {
  "Submit Job": "提交作业",
  "Template-driven submission": "基于模板提交作业",
  "Job History": "作业历史",
  "Track and clone jobs": "跟踪与克隆作业",
  Logs: "日志",
  "Job log browsing": "作业日志浏览",
  "S3 Browser": "S3 浏览器",
  "Text file editing": "文本文件编辑",
  Templates: "模板",
  "Application and resource templates": "应用与资源配置模板",
  "AI Assistant": "AI 助手",
  "Chat, models, and MCP tools": "对话、模型与 MCP 工具",
  Dashboard: "概览",
  "Cluster job statistics": "集群作业统计",
  "Virtual Clusters": "虚拟集群",
  "EMR on EKS clusters": "EMR on EKS 集群",
  Secrets: "密钥管理",
  "Account secrets and DB credentials": "账号密钥与数据库凭据",
  Settings: "设置",
  "AWS credentials": "AWS 凭据",

  // DBHub keeps its product name but its description is prose.
  "Databases, connections & queries": "数据库、连接与查询",

  // App shell chrome: sidebar, account switcher, and status toasts.
  "Expand navigation": "展开导航",
  "Collapse navigation": "折叠导航",
  "Switch AWS account": "切换 AWS 账户",
  "Switch AWS Account": "切换 AWS 账户",
  "Current Account": "当前账户",
  "No active account": "无活跃账户",
  "Configure Settings first": "请先在设置中配置",
  Primary: "主导航",
  "Choose the active AWS account used by EMR, CloudWatch, and S3.":
    "选择 EMR、CloudWatch 与 S3 使用的活跃 AWS 账户。",
  "AWS accounts": "AWS 账户",
  "Loading accounts...": "正在加载账户…",
  "No AWS accounts are configured yet. Open Settings to add one.":
    "尚未配置任何 AWS 账户。打开「设置」添加一个。",
  Active: "活跃",
  Use: "使用",
  "{name} is now active.": "{name} 已设为活跃账户。",
  "Update installed. Restart the app to use the new version.": "更新已安装，重启应用即可使用新版本。"
};

export default navigation;
