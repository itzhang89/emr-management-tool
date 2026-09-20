import type { TranslationDictionary } from "@/i18n/types";

/**
 * Help, About, and keyboard-shortcut copy.
 *
 * `src/data/keyboardShortcuts.ts` deliberately stays a plain English data module
 * (its own test asserts on the source strings), so its category and shortcut
 * labels are translated here and resolved at the render site. The ten
 * `Go to X` entries are generated in that module, so they are enumerated
 * literally. `coverage.test.ts` guards against this list drifting from it.
 */
const help: TranslationDictionary = {
  // Categories
  Global: "全局",
  "Available from any page": "在任意页面均可用",
  Navigation: "导航",
  "Jump between primary pages": "在主导航页面之间跳转",
  Account: "账户",
  "AWS account switching": "AWS 账户切换",
  "Databases, connections and queries": "数据库、连接与查询",
  "Search and refresh job runs": "搜索与刷新作业运行",
  "Job Logs": "作业日志",
  "Job log tree and viewer": "作业日志树与查看器",
  "When the object list or editor has focus": "当对象列表或编辑器获得焦点时",
  "Template-driven job submission": "基于模板提交作业",
  "Chat and model settings": "对话与模型设置",

  // Shortcuts — global
  "Open shortcuts": "打开快捷键",
  "Show keyboard shortcuts for the app (Help menu)": "显示应用的键盘快捷键（帮助菜单）",
  "Toggle navigation": "折叠 / 展开导航",
  "Collapse or expand the primary navigation sidebar": "折叠或展开主导航侧边栏",

  // Shortcuts — account
  "Open the account switcher, then press again to cycle and Enter to confirm":
    "打开账户切换器，再次按下可循环选择，按 Enter 确认",

  // Shortcuts — navigation, including the ten generated "Go to X" entries
  "Go to Submit Job": "前往「提交作业」",
  "Go to Job History": "前往「作业历史」",
  "Go to Logs": "前往「日志」",
  "Go to S3 Browser": "前往「S3 浏览器」",
  "Go to DBHub": "前往「DBHub」",
  "Go to Templates": "前往「模板」",
  "Go to AI Assistant": "前往「AI 助手」",
  "Go to Dashboard": "前往「概览」",
  "Go to Virtual Clusters": "前往「虚拟集群」",
  "Go to Settings": "前往「设置」",
  "Previous page": "上一页",
  "Go to the previous page in the sidebar order": "按侧边栏顺序切换到上一页",
  "Next page": "下一页",
  "Go to the next page in the sidebar order": "按侧边栏顺序切换到下一页",

  // Shortcuts — DBHub
  "Toggle catalog panel": "折叠 / 展开目录面板",
  "Show or hide the catalog sidebar of the workspace you are in": "显示或隐藏当前工作区的目录侧边栏",
  "Run query": "运行查询",
  "Execute the current SQL in the active result tab": "在当前结果标签页中执行 SQL",
  "Run in new tab": "在新标签页中运行",
  "Execute the current SQL in a new result tab": "在新的结果标签页中执行 SQL",
  "Previous result tab": "上一个结果标签页",
  "Switch to the previous query result tab": "切换到上一个查询结果标签页",
  "Next result tab": "下一个结果标签页",
  "Switch to the next query result tab": "切换到下一个查询结果标签页",

  // Shortcuts — Job History
  "Focus job search": "聚焦作业搜索",
  "Focus the Job History search box": "将焦点移至作业历史搜索框",

  // Shortcuts — Job Logs
  "Toggle log files panel": "折叠 / 展开日志文件面板",
  "Collapse or expand the log files sidebar": "折叠或展开日志文件侧边栏",
  "Focus job id": "聚焦作业 ID",
  "Focus the job id search box when no log viewer is open": "未打开日志查看器时，聚焦作业 ID 搜索框",
  "Find in log": "在日志中查找",
  "Open or close the find bar when a log is open (same key focuses job id when closed)":
    "打开日志后切换查找栏（未打开时该键用于聚焦作业 ID）",

  // Shortcuts — S3 Browser
  "Move selection": "移动选择",
  "Move up or down in the object list": "在对象列表中上下移动",
  "Open folder": "打开文件夹",
  "Enter the selected folder or keep the file selected": "进入所选文件夹，或保持文件选中",
  "Focus editor": "聚焦编辑器",
  "Move focus from the object list to the file editor": "将焦点从对象列表移至文件编辑器",
  "Focus object list": "聚焦对象列表",
  "Move focus from the editor back to the object list": "将焦点从编辑器移回对象列表",
  "Go up": "返回上级",
  "Navigate to the parent prefix in the current bucket": "跳转到当前存储桶的上级前缀",
  "Find in editor": "在编辑器中查找",
  "Open or close the find panel when the file editor has focus (Esc also closes)":
    "文件编辑器获得焦点时切换查找面板（Esc 也可关闭）",
  "Replace in editor": "在编辑器中替换",
  "Open find with the replace row when the file is editable (Exclude skips the current match for Replace all)":
    "文件可编辑时打开带替换行的查找（「排除」会在全部替换时跳过当前匹配）",
  "Find next": "查找下一个",
  "Jump to the next match in the open S3 object editor": "在打开的 S3 对象编辑器中跳到下一个匹配项",
  "Find previous": "查找上一个",
  "Jump to the previous match in the open S3 object editor": "在打开的 S3 对象编辑器中跳到上一个匹配项",

  // Shortcuts — Submit Job
  "Submit job": "提交作业",
  "Submit the current job configuration to EMR": "将当前作业配置提交到 EMR",
  "Preview JSON": "预览 JSON",
  "Open the resolved submit payload preview": "打开解析后的提交载荷预览",
  "Toggle Template / Source": "切换「模板 / 源码」",
  "Switch between Template and Source submit modes": "在模板与源码提交模式之间切换",

  // Shortcuts — AI Assistant
  "Clear chat context": "清空对话上下文",
  "Keep the history visible but stop sending it to the model": "保留历史记录，但不再发送给模型",

  // Shortcuts dialog
  "Keyboard shortcuts": "键盘快捷键",
  "Open from Help → Keyboard Shortcuts, or press {shortcut} anytime.":
    "可从「帮助 → 键盘快捷键」打开，或随时按 {shortcut}。",
  or: "或",

  // About dialog
  Development: "开发版",
  Stable: "稳定版",
  "Desktop GUI for submitting and managing EMR on EKS jobs.": "用于提交和管理 EMR on EKS 作业的桌面客户端。",
  "Version:": "版本：",
  "Channel:": "渠道：",
  "Upgrade available:": "可升级至：",
  "Installing...": "正在安装…",
  "Install {version}": "安装 {version}",
  "Checking...": "正在检查…",
  "Check for updates": "检查更新",
  "You are already using the latest version.": "已是最新版本。",
  "Version {version} is available.": "{version} 版本可用。"
};

export default help;
