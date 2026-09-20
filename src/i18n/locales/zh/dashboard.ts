import type { TranslationDictionary } from "@/i18n/types";

/**
 * Dashboard, its job-run charts, and the virtual cluster page (including the
 * empty-state hint they share). Keys are the exact English source text.
 */
const dashboard: TranslationDictionary = {
  // Dashboard KPIs and range control.
  "Select a virtual cluster to view job statistics.": "请选择虚拟集群以查看作业统计。",
  "Running": "运行中",
  "Currently running jobs": "当前正在运行的作业",
  "Success Rate ({days}d)": "成功率（{days} 天）",
  "Completed / (completed + failed)": "已完成 /（已完成 + 失败）",
  "Failed (24h)": "失败（24 小时）",
  "Rolling last 24 hours": "最近 24 小时滚动统计",
  "{days}d": "{days} 天",

  // Daily chart.
  "Job Runs ({days} days)": "作业运行（{days} 天）",
  // Shared with the `jobHistory` shard, which also renders these charts and the
  // cluster picker — the wording must stay identical or `shards.test.ts` fails.
  "Daily completed vs failed job counts for the selected cluster.": "所选集群每日已完成与失败的作业数。",
  "Syncing…": "正在同步…",
  "Success": "成功",
  "Failed": "失败",

  // Hourly chart.
  "{date} · Hourly": "{date} · 每小时",
  "Completed vs failed job counts by local hour.": "按本地小时统计的已完成与失败作业数。",
  "Previous day": "前一天",
  "Today": "今天",
  "Next day": "后一天",
  "No completed/failed jobs this day.": "当天没有已完成或失败的作业。",

  // Virtual clusters page.
  "Clusters": "集群",
  "Cluster operations are read-only by design.": "集群操作按设计为只读。",
  "Loading virtual clusters...": "正在加载虚拟集群...",
  "State": "状态",
  "Namespace": "命名空间",
  "EKS Cluster": "EKS 集群",
  "Created Time": "创建时间",
  "Actions": "操作",
  "View Details": "查看详情",
  "Virtual Cluster Details": "虚拟集群详情",
  "Read-only metadata for the selected EMR Virtual Cluster.": "所选 EMR 虚拟集群的只读元数据。",

  // Empty-state hint. The compact variant is split around the bolded region
  // name, so its leading fragment and its continuation are separate keys.
  "No virtual clusters in {region}": "在 {region} 中未找到虚拟集群",
  "No virtual clusters in": "在",
  ". A wrong account region is the most common cause—open Settings and confirm it matches the region shown in the AWS Console for your EMR virtual cluster.":
    " 中未找到虚拟集群。账户区域配置错误是最常见的原因——请打开设置，确认其与 AWS 控制台中该 EMR 虚拟集群显示的区域一致。",
  "The AWS API call succeeded but returned an empty list. This usually means the region configured for this account does not match where your EMR virtual cluster was created—not missing IAM permissions.":
    "AWS API 调用成功，但返回了空列表。这通常意味着该账户配置的区域与 EMR 虚拟集群的创建区域不一致，而不是缺少 IAM 权限。",
  "Account": "账户",
  "Region": "区域",
  "AWS account": "AWS 账户",
  "the selected region": "所选区域",
  "Open AWS Console → EMR → Virtual clusters and note the region shown there.":
    "打开 AWS 控制台 → EMR → Virtual clusters，记下其中显示的区域。",
  "In Settings, make sure this account uses that same region. Re-import the AWS CLI profile to refresh the region, or delete the account and add it again with the correct region.":
    "在设置中确认该账户使用相同的区域。可重新导入 AWS CLI 配置文件以刷新区域，或删除该账户后使用正确的区域重新添加。",
  "Verify in a terminal:": "在终端中验证：",
  "If the CLI command returns clusters but this app does not, open Help → View Logs. If the API is denied instead of empty, grant":
    "如果 CLI 命令能返回集群而本应用不能，请打开 帮助 → 查看日志。如果 API 是被拒绝而非返回空列表，请授予以下权限："
};

export default dashboard;
