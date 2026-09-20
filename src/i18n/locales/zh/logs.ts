import type { TranslationDictionary } from "@/i18n/types";

/**
 * Logs page and `src/components/logs`: the job-id search, the log file tree, the
 * viewer chrome, and the find bar. Runtime log lines themselves are never
 * translated — only the interface around them.
 */
const logs: TranslationDictionary = {
  // Logs page chrome.
  "Enter job id": "输入作业 ID",
  "Recent job ids": "最近的作业 ID",
  "Loading job log configuration...": "正在加载作业日志配置...",
  "No CloudWatch or S3 monitoring configuration was found for this job.":
    "未找到此作业的 CloudWatch 或 S3 监控配置。",
  "Loading S3 archive logs...": "正在加载 S3 归档日志...",
  "Loading CloudWatch logs...": "正在加载 CloudWatch 日志...",
  "Saved to {path}": "已保存至 {path}",

  // Logs empty state.
  "Select a job from Job History or enter a job id to view logs.":
    "从「作业历史」中选择作业，或输入作业 ID 以查看日志。",
  "Recently viewed": "最近查看",
  "Recently viewed job ids": "最近查看的作业 ID",

  // Log file tree.
  "Log files": "日志文件",
  "No log streams found for this job.": "未找到此作业的日志流。",
  "Expand log files panel": "展开日志文件面板",
  "Collapse log files panel": "折叠日志文件面板",
  "Show log files": "显示日志文件",
  "Hide log files": "隐藏日志文件",
  live: "实时",

  // Log viewer.
  "Select a log file from the tree to view its content.": "请从日志文件树中选择文件以查看内容。",
  "Previewing the first {previewCount} characters of this log ({totalCount} total). Load the full log to search and browse everything in the viewer, or download it to a file.":
    "正在预览此日志的前 {previewCount} 个字符（共 {totalCount} 个）。加载完整日志即可在查看器中搜索和浏览全部内容，或将其下载为文件。",
  "Load full log": "加载完整日志",
  Download: "下载",
  "Showing the full log ({count} characters) in the viewer.":
    "查看器中正在显示完整日志（{count} 个字符）。",
  "Hidden {count} lines": "已隐藏 {count} 行",

  // Command bar.
  "Log viewer controls": "日志查看器控件",
  "Download selected log": "下载所选日志",
  "Copy log path": "复制日志路径",
  "Log path copied.": "已复制日志路径。",
  "Hide noisy Spark log lines": "隐藏嘈杂的 Spark 日志行",
  Focus: "聚焦",
  "Log destination details": "日志目标详情",
  "Current log file": "当前日志文件",
  "Select a log file": "选择日志文件",

  // Find bar.
  "Find in log": "在日志中查找",
  Find: "查找",
  "Find in current log": "在当前日志中查找",
  Regex: "正则",
  "Previous match": "上一个匹配",
  "Next match": "下一个匹配"
};

export default logs;
