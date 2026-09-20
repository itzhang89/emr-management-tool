import type { TranslationDictionary } from "@/i18n/types";

/**
 * Templates page: application config templates, resource templates, the shared
 * JSON payload editor, the variable fields rendered by Submit Job, and the
 * catalogue toolbar/rows the DBHub and Glue workspaces share. Keys are the
 * exact English source text.
 */
const templates: TranslationDictionary = {
  // Templates page shell.
  "Application Config": "应用配置",
  "Resource Templates": "资源配置模板",
  "Manage reusable Spark driver and executor sizing presets.": "管理可复用的 Spark Driver 与 Executor 规格预设。",
  "Resource Template": "资源配置模板",
  "Built-in": "内置",
  "Driver: {cores} cores / {memory}": "Driver：{cores} 核 / {memory}",
  "Executors: {instances} x {cores} cores / {memory}": "Executor：{instances} × {cores} 核 / {memory}",
  "No resource templates": "暂无资源配置模板",
  "Create a custom resource preset for Submit Job.": "为提交作业创建自定义资源预设。",
  "Resource template saved.": "资源配置模板已保存。",
  "Resource template deleted.": "资源配置模板已删除。",
  "Edit resource template": "编辑资源配置模板",
  "Create resource template": "创建资源配置模板",
  "Driver Cores": "Driver 核数",
  "Driver Memory": "Driver 内存",
  "Executor Cores": "Executor 核数",
  "Executor Memory": "Executor 内存",
  "Executor Instances": "Executor 实例数",

  // Row actions, shared by both template lists.
  "Edit {name}": "编辑 {name}",
  "Duplicate {name}": "复制 {name}",
  "Delete {name}": "删除 {name}",
  "Export {name}": "导出 {name}",

  // Application config templates.
  "Manage full EMR submit JSON templates with variable substitution.": "管理支持变量替换的完整 EMR 提交 JSON 模板。",
  "Application config template imported.": "应用配置模板已导入。",
  "Application config template saved.": "应用配置模板已保存。",
  "Application config template deleted.": "应用配置模板已删除。",
  "Import": "导入",
  "Template": "模板",
  "No description": "无描述",
  "{count} variable": "{count} 个变量",
  "{count} variables": "{count} 个变量",
  "default resource {id}": "默认资源 {id}",
  "Template exported.": "模板已导出。",
  "Template JSON imported into editor.": "模板 JSON 已导入编辑器。",
  "Edit application config template": "编辑应用配置模板",
  "Create application config template": "创建应用配置模板",
  "Reset restores the editor to the state from when it was opened or first imported.":
    "重置会将编辑器恢复到打开时或首次导入时的状态。",
  "Default Resource Template": "默认资源配置模板",
  "Optional default resource": "可选的默认资源",
  "Reset will overwrite all current settings with the initial template state. Continue?":
    "重置将用初始模板状态覆盖当前所有设置。是否继续？",
  "Reset": "重置",
  "Import JSON": "导入 JSON",

  // Payload editor and variable editor.
  "Payload JSON": "JSON 载荷",
  "Custom Variables": "自定义变量",
  "Add Variable": "添加变量",
  "Variable name": "变量名称",
  "Required": "必填",
  "Format": "格式",
  "Options, comma-separated": "选项，以逗号分隔",
  "Format, e.g. YYYY-MM-DD": "格式，例如 YYYY-MM-DD",
  "Output format": "输出格式",
  "Default": "默认值",
  "Default values": "默认值",
  "Move {name} up": "上移 {name}",
  "Move {name} down": "下移 {name}",
  "Remove {name}": "移除 {name}",
  "Edit {name} description": "编辑 {name} 的描述",
  "Description for {name}": "{name} 的描述",
  "Add variable description": "添加变量描述",
  "Optional description shown on hover in Submit Job.": "可选描述，将在提交作业页面的悬停提示中显示。",
  "Confirm": "确认",
  "Cancel": "取消",

  // Variable fields rendered for a template.
  "This template has no custom variables.": "此模板没有自定义变量。",
  "Select {name}": "选择 {name}",
  "Search {name}...": "搜索 {name}……",
  "No option found.": "未找到选项。",
  "Pick {name}": "选择 {name}",

  // Catalogue toolbar shared by the DBHub and Glue workspaces.
  "Refresh catalog": "刷新目录",
  "Collapse catalog panel": "折叠目录面板",
  "Hide catalog": "隐藏目录"
};

export default templates;
