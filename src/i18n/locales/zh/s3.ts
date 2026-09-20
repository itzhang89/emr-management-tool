import type { TranslationDictionary } from "@/i18n/types";

/**
 * S3 Browser copy: the object browser page, the path picker, the CodeMirror
 * editor's search panel and change gutter.
 *
 * Error and failure text is deliberately absent — `toast.error(...)`, every
 * fallback string inside it, and the messages built by `formatAppError` /
 * `formatS3BrowserError` stay in English by product decision.
 */
const s3: TranslationDictionary = {
  // Object list and toolbar
  "S3 objects": "S3 对象",
  "Selected S3 object": "已选 S3 对象",
  "Select an object": "请选择一个对象",
  "Loading S3 objects...": "正在加载 S3 对象…",
  "No objects under this prefix.": "该前缀下没有对象。",
  "Resize browser pane": "调整浏览窗格宽度",
  "Create folder": "新建文件夹",
  Up: "上级",
  Upload: "上传",
  "Uploading {percent}%": "上传中 {percent}%",
  "Upload progress": "上传进度",
  "Waiting for file…": "等待文件…",
  "Browse S3 path": "浏览 S3 路径",
  "Opened from job monitoring configuration.": "从作业监控配置打开。",
  "Supported text files can be edited in place.": "支持的文本文件可直接编辑。",

  // Selected object header and preview
  "Object is read-only": "对象为只读",
  "Copy S3 path": "复制 S3 路径",
  "Download": "下载",
  "Object details": "对象详情",
  Size: "大小",
  "Last modified": "最后修改时间",
  "Loading object content...": "正在加载对象内容…",
  "Saving...": "正在保存…",

  // Toasts (success and informational only)
  "S3 path copied.": "已复制 S3 路径。",
  "Upload canceled.": "上传已取消。",
  "Saved {key}": "已保存 {key}",
  "Uploaded {key}": "已上传 {key}",
  "Saved to {path}": "已保存至 {path}",
  "Deleted {key}": "已删除 {key}",
  "Deleted folder {key}": "已删除文件夹 {key}",
  "Created {name}/": "已创建 {name}/",
  "Renamed to {name}": "已重命名为 {name}",

  // Create folder dialog
  "Create a new folder under {path}": "在 {path} 下新建文件夹",
  "Select a bucket first.": "请先选择存储桶。",
  "folder-name": "文件夹名称",
  "Creating...": "正在创建…",

  // Upload conflict dialog
  "Object already exists": "对象已存在",
  "An object already exists at this location:": "该位置已存在一个对象：",
  "Overwrite it, upload under a new name, or cancel.": "可以覆盖它、以新名称上传，或取消。",
  "Upload as": "上传为",
  Overwrite: "覆盖",
  "Checking…": "正在检查…",
  "Rename & upload": "重命名并上传",

  // Delete dialog
  "Delete S3 folder?": "删除 S3 文件夹？",
  "Delete S3 object?": "删除 S3 对象？",
  "This will permanently delete": "此操作将永久删除",
  "Inspecting folder contents...": "正在检查文件夹内容…",
  "Expected deletion summary": "预计删除摘要",
  "Files: {count}": "文件：{count}",
  "Subfolders: {count}": "子文件夹：{count}",
  "Total objects: {count}": "对象总数：{count}",
  "Total size: {size}": "总大小：{size}",
  "Preview is truncated. The folder may contain more objects than shown.":
    "预览已截断，文件夹中包含的对象可能多于此处显示。",
  "All files and subfolders under this prefix will be deleted.": "该前缀下的所有文件和子文件夹都将被删除。",
  "This folder appears empty and will be removed.": "该文件夹看起来是空的，将被移除。",

  // Shared dialog chrome
  Cancel: "取消",

  // S3 path picker
  "Browse S3": "浏览 S3",
  Browse: "浏览",
  "Select S3 path": "选择 S3 路径",
  "Browse buckets and folders, or type a path directly.": "浏览存储桶与文件夹，或直接输入路径。",
  "bucket/folder/": "存储桶/文件夹/",
  "s3://bucket/prefix/": "s3://存储桶/前缀/",
  Go: "前往",
  "Loading...": "正在加载…",
  "No matching buckets.": "没有匹配的存储桶。",
  "No matching folders under this prefix.": "该前缀下没有匹配的文件夹。",
  "Append submitUser subdirectory": "追加 submitUser 子目录",
  "Athena results path:": "Athena 结果路径：",
  "Use path": "使用该路径",

  // Object editor: search panel and change gutter
  Find: "查找",
  Replace: "替换",
  "Match case": "区分大小写",
  "By word": "全字匹配",
  Regexp: "正则表达式",
  "Previous match ({shortcut})": "上一个匹配项（{shortcut}）",
  "Next match ({shortcut})": "下一个匹配项（{shortcut}）",
  Exclude: "排除",
  "Replace all": "全部替换",
  Close: "关闭",
  "Invalid regex": "正则表达式无效",
  "Added lines": "新增行",
  "Modified lines": "修改行",
  "Deleted lines": "删除行",
  "S3 object content": "S3 对象内容"
};

export default s3;
