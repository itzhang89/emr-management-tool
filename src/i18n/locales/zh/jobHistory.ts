import type { TranslationDictionary } from "@/i18n/types";

/**
 * Job History page and the `src/components/emr` job panels: run tables, the job
 * detail popover, the refresh toggle, the virtual-cluster picker, and the two
 * job-run charts. Keys are the exact English source text.
 */
const jobHistory: TranslationDictionary = {
  // Job History page chrome.
  "Search jobs by name, id, or state": "按名称、ID 或状态搜索作业",
  "Recent job searches": "最近的作业搜索",
  "{count} jobs": "{count} 个作业",

  // Job runs table.
  "Job Name": "作业名称",
  State: "状态",
  "Created Time": "创建时间",
  Duration: "耗时",
  Actions: "操作",
  "Latest {count} jobs submitted from this app for the selected virtual cluster.":
    "本应用为所选虚拟集群最近提交的 {count} 个作业。",

  // Row actions.
  Detail: "详情",
  Analyze: "分析",
  Kill: "终止",
  Rerun: "重新运行",
  "Kill requested.": "已请求终止。",
  "Found {name}": "找到 {name}",
  "Rerun · {name}": "重新运行 · {name}",

  // Find in AWS empty state.
  "Find in AWS": "在 AWS 中查找",
  "Finding...": "查找中...",

  // Loading and empty states.
  "Loading job history...": "正在加载作业历史...",
  "Loading recent submissions...": "正在加载最近提交...",
  "No jobs match the current filters.": "没有作业符合当前筛选条件。",
  "Syncing job runs from AWS. Auto refresh is enabled.": "正在从 AWS 同步作业运行。自动刷新已启用。",
  "Loading job runs from AWS...": "正在从 AWS 加载作业运行...",
  "Select a virtual cluster to see jobs submitted from this app.": "请选择虚拟集群以查看本应用提交的作业。",
  "Select a virtual cluster to sync job runs from AWS.": "请选择虚拟集群以从 AWS 同步作业运行。",
  "No jobs submitted from this app yet. Auto refresh is enabled.": "本应用尚未提交任何作业。自动刷新已启用。",
  "No jobs submitted from this app for the selected virtual cluster.":
    "本应用尚未为所选虚拟集群提交任何作业。",
  "No job runs found yet. Auto refresh will keep checking AWS.": "尚未找到作业运行。自动刷新会持续检查 AWS。",
  "No job runs found for the selected virtual cluster.": "未找到所选虚拟集群的作业运行。",

  // Pagination.
  "Page {page} of {pageCount}": "第 {page} 页，共 {pageCount} 页",
  Previous: "上一页",
  Next: "下一页",

  // Job detail popover.
  "Job details": "作业详情",
  "Job run details": "作业运行详情",
  "Resize job details panel": "调整作业详情面板大小",
  "Download JSON": "下载 JSON",
  "Copy Job ID": "复制作业 ID",
  "Loading job details...": "正在加载作业详情...",
  "Job ID copied.": "已复制作业 ID。",
  "Saved to {path}": "已保存至 {path}",
  Started: "开始时间",
  Finished: "结束时间",
  "Release Label": "发行版本",
  "Retry Attempts": "重试次数",
  "State Details": "状态详情",
  "Failure Reason": "失败原因",
  "Execution Role": "执行角色",
  "Created By": "创建者",
  "Client Token": "客户端令牌",
  "Job Driver": "作业驱动",
  Tags: "标签",
  "Configuration Overrides": "配置覆盖",

  // Auto refresh toggle.
  "Auto refresh job history": "自动刷新作业历史",
  "Auto refresh": "自动刷新",

  // The workspace's tab strip: Job History is the fixed first tab, every job
  // whose logs are open gets one of its own, and `+` starts an empty one.
  "New log tab": "新建日志标签页",
  "Open a log tab": "新建日志标签页",
  "Close a log tab first — {used} of {max} are open.":
    "请先关闭一个日志标签页——当前已打开 {used}/{max} 个。",

  // Virtual cluster picker.
  "Loading virtual clusters...": "正在加载虚拟集群...",
  "Select virtual cluster": "选择虚拟集群",

  // Job run charts.
  "{date} · Hourly": "{date} · 每小时",
  "Completed vs failed job counts by local hour.": "按本地小时统计的已完成与失败作业数。",
  "Previous day": "前一天",
  "Next day": "后一天",
  Today: "今天",
  "No completed/failed jobs this day.": "当天没有已完成或失败的作业。",
  "Job Runs ({days} days)": "作业运行（{days} 天）",
  "Daily completed vs failed job counts for the selected cluster.":
    "所选集群每日已完成与失败的作业数。",
  "Syncing…": "正在同步…",
  Success: "成功",
  Failed: "失败"
};

export default jobHistory;
