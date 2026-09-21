import type { TranslationDictionary } from "@/i18n/types";

/** Settings page copy. Keys are the exact English source text. */
const settings: TranslationDictionary = {
  Language: "语言",
  "Choose the language used by the app interface. Error messages and log output stay in English.":
    "选择应用界面所使用的语言。错误信息与日志输出仍保持英文。",
  "Follow system language": "跟随系统语言",
  "AWS account saved.": "AWS 账户已保存。",
  "AWS account updated.": "AWS 账户已更新。",
  "Access Key ID": "访问密钥 ID",
  "Access Key ID (read-only)": "访问密钥 ID（只读）",
  "Account Name": "账户名称",
  "Already imported as “{name}”.": "已导入为“{name}”。",
  "Connected to AWS account {account}": "已连接到 AWS 账户 {account}",
  "Delete AWS account?": "删除 AWS 账户？",
  "Deleting...": "删除中...",
  "Edit AWS Account": "编辑 AWS 账户",
  "Enter new secret to update": "输入新的私有密钥以更新",
  "Hide secret access key": "隐藏私有访问密钥",
  "Import AWS CLI Profiles": "导入 AWS CLI 配置文件",
  "Import local AWS CLI static credential profiles. If the profile is missing a region or the name is already used, you will complete the details in the add-account form.":
    "导入本地 AWS CLI 静态凭证配置文件。如果配置文件缺少区域或名称已被占用，你可以在添加账户表单中补全信息。",
  "No AWS CLI profiles were found in the local credentials or config files.":
    "在本地凭证或配置文件中未找到 AWS CLI 配置文件。",
  "No region": "无区域",
  "No static access key": "无静态访问密钥",
  "Save Account": "保存账户",
  "Save Changes": "保存更改",
  "Scanning AWS CLI profiles...": "正在扫描 AWS CLI 配置文件...",
  "Secret Access Key": "私有访问密钥",
  "Secret Access Key (masked)": "私有访问密钥（已隐藏）",
  "Show secret access key": "显示私有访问密钥",
  "Test Connection": "测试连接",
  "Testing...": "测试中...",
  "This access key is already configured as “{name}”.": "此访问密钥已配置为“{name}”。",
  "This permanently removes the account and its stored credentials from this app. This cannot be undone.":
    "这将从此应用中永久移除该账户及其保存的凭证。此操作无法撤销。",
  "Update the display name and region. Access Key cannot be changed here; unlock Secret only when rotating the secret for the same key. To replace the full key pair, delete the account and add a new one.":
    "更新显示名称和区域。访问密钥无法在此更改；仅在为同一密钥轮换私有密钥时才解锁「私有访问密钥」。若要更换整个密钥对，请删除该账户并添加新账户。",
  "Automatic updates": "自动更新",
  "Automatically check for and install updates.": "自动检查并安装更新。",
  "Automatic updates are unavailable for this build.": "此构建不支持自动更新。",
  "Beta updates": "Beta 版本更新",
  "On: prereleases of the next version are offered as soon as they are published.":
    "已开启：下一个版本的预发布版一经发布即会提示更新。",
  "Off: only stable releases are offered. Turn on to preview the next version early.":
    "已关闭：仅提供正式版本。开启后可提前体验下一个版本。",
  "and its stored credentials from this app. This cannot be undone.":
    "以及它保存在此应用中的凭证。此操作无法撤销。"
};

export default settings;
