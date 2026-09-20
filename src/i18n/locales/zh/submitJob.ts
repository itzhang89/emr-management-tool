import type { TranslationDictionary } from "@/i18n/types";

/** Submit Job page copy. Keys are the exact English source text. */
const submitJob: TranslationDictionary = {
  Submit: "提交",
  "Submitting...": "正在提交…",
  "Saving...": "正在保存…",
  "Toggle mode": "切换模式",
  Template: "模板",
  Source: "源码",
  "Select template": "选择模板",

  "Runtime Selection": "运行时配置",
  "Choose where the job runs and which resource preset to apply.":
    "选择作业的运行位置，以及要应用的资源配置模板。",
  "Virtual Cluster": "虚拟集群",
  "Resource Template": "资源配置模板",
  "Select resources": "选择资源配置",

  "Recent Submissions": "最近提交",
  "Resize editor and recent submissions": "调整编辑器与最近提交区域的大小",

  "Cloned Job Configuration": "克隆的作业配置",
  "Submitting a cloned request from Job History. Clear it by choosing a template again.":
    "正在提交来自作业历史的克隆请求。重新选择模板即可清除。",
  "Use Template Instead": "改用模板",

  "Switch to Template submit?": "切换到模板提交？",
  "Current source JSON was not loaded from a template. Switching discards the editor contents unless you save it as a template.":
    "当前的源码 JSON 并非来自模板。切换会丢弃编辑器内容，除非先将其保存为模板。",
  "Create template and switch": "创建模板并切换",
  "Discard and switch": "丢弃并切换",

  "Create template from source": "从源码创建模板",
  "Save the current source JSON as a job config template, then switch to Template submit.":
    "将当前源码 JSON 保存为作业配置模板，然后切换到模板提交。",
  "Template name": "模板名称",
  "Optional description": "可选描述",

  "Resolved Submit Payload": "解析后的提交载荷",

  "Cloned job configuration loaded.": "已载入克隆的作业配置。",
  "Loaded job configuration into Source submit.": "已将作业配置载入源码提交模式。",
  "Submitted {name}": "已提交 {name}",
  "Template created with {count} variables from entryPointArguments.":
    "已根据 entryPointArguments 创建模板，包含 {count} 个变量。",
  "Template created from source JSON.": "已根据源码 JSON 创建模板。"
};

export default submitJob;
