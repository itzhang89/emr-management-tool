import type { TranslationDictionary } from "@/i18n/types";

const secrets: TranslationDictionary = {
  "Create Secret": "创建密钥",
  "Secret name is required.": "密钥名称必填。",
  "Secret value must be valid JSON.": "密钥值必须是合法 JSON。",
  'Secret "{name}" created.': "密钥「{name}」已创建。",
  "Search by name or ARN": "按名称或 ARN 搜索",
  "Mine only": "仅我的",
  "Loading secrets…": "正在加载密钥…",
  "Loading secret fields…": "正在加载密钥字段…",
  "No secrets in this account region yet.": "当前账号区域下还没有密钥。",
  "No active account. Configure Settings first.": "无活跃账户。请先在设置中配置。",
  untagged: "未标记",
  "Last changed": "最近变更",
  Actions: "操作",
  "Copy entire secret": "复制整个密钥",
  "Copied entire secret": "已复制整个密钥",
  'Copied "{key}"': "已复制「{key}」",
  'Copy "{key}"': "复制「{key}」",
  "Reveal value": "显示值",
  "Hide value": "隐藏值",
  "Empty JSON object.": "空的 JSON 对象。",
  "Showing first-level JSON keys only. Nested values are stringified.":
    "仅展示第一层 JSON 键；嵌套值以字符串形式显示。",
  "Copied to clipboard": "已复制到剪贴板",
  View: "查看",
  Copy: "复制",
  Reveal: "显示",
  Hide: "隐藏",
  "Secret value": "密钥值",
  "Value (JSON)": "值（JSON）",
  "Insert template": "插入模板",
  "Auto tags": "自动标签",
  "Creates a secret in the active account region. Tags submitUser and managedBy are added automatically.":
    "在当前活跃账号的区域创建密钥。将自动添加 submitUser 与 managedBy 标签。",
  "Auth mode": "认证方式",
  "Manual password": "手动密码",
  Secret: "密钥",
  "Select a secret…": "选择密钥…",
  "Optional fallback — secret may override": "可选回退 — 密钥可能覆盖",
  "Password and optional host/user/database come from the bound secret JSON at connect time.":
    "连接时从绑定的密钥 JSON 读取密码及可选的 host/user/database。",
  "Local password": "本地密码",
  "SM: {name}": "SM: {name}",
  Tags: "标签",
  "Edit Secret": "编辑密钥",
  "Edit secret": "编辑密钥",
  "Delete secret": "删除密钥",
  "Delete secret?": "删除密钥？",
  "Only the owner can edit this secret.": "仅所有者可编辑此密钥。",
  "Only the owner (matching submitUser) can edit or delete.":
    "仅所有者（submitUser 匹配）可编辑或删除。",
  'Secret "{name}" updated.': "密钥「{name}」已更新。",
  'Secret "{name}" scheduled for deletion (recovery window {days} days).':
    "密钥「{name}」已安排删除（恢复窗口 {days} 天）。",
  '"{name}" will be scheduled for deletion with a {days}-day recovery window. Only secrets tagged with your submitUser can be deleted from this app.':
    "「{name}」将安排删除，恢复窗口为 {days} 天。仅带有你的 submitUser 标签的密钥可在本应用中删除。",
  Delete: "删除",
  "Save as AWS Secret": "保存为 AWS 密钥",
  "Create and bind AWS Secret": "创建并绑定 AWS 密钥",
  "Secret created and bound.": "密钥已创建并绑定。",
  "Password is required to create a secret.": "创建密钥需要填写密码。",
  "Needed only to create a new secret": "仅在创建新密钥时需要"
};

export default secrets;
