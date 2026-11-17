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
  "Access Key ID (masked)": "访问密钥 ID（已隐藏）",
  "Access Key ID (read-only)": "访问密钥 ID（只读）",
  "Account Name": "账户名称",
  "Account Name (locked)": "账户名称（已锁定）",
  "Account name cannot be changed after creation.": "账户名称创建后不可更改。",
  "Account name is locked. You can change authentication method, credentials, and region.":
    "账户名称已锁定。你可以更改认证方式、凭证和区域。",
  "AKIAxxxxxxxx (IAM user access key ID)": "AKIAxxxxxxxx（IAM 用户访问密钥 ID）",
  "arn:aws:iam::123456789012:mfa/username": "arn:aws:iam::123456789012:mfa/用户名",
  "arn:aws:iam::123456789012:role/MyRole": "arn:aws:iam::123456789012:role/角色名",
  "Current {masked} — enter a new Access Key ID to replace":
    "当前 {masked} — 输入新的访问密钥 ID 以替换",
  "e.g. ap-southeast-1 (Identity Center region)": "例如 ap-southeast-1（Identity Center 区域）",
  "e.g. prod-analytics (unique, cannot rename later)": "例如 prod-analytics（唯一，创建后不可改名）",
  "Enter new secret (leave blank with Access Key ID empty to keep)":
    "输入新的私有密钥（与访问密钥 ID 都留空则保持原凭证）",
  "{duration} left": "剩余 {duration}",
  "External ID required by the role trust policy": "角色信任策略要求的 External ID",
  "https://my-org.awsapps.com/start": "https://my-org.awsapps.com/start",
  "Permission set / role name, e.g. AdministratorAccess":
    "权限集 / 角色名，例如 AdministratorAccess",
  "Secret key paired with the access key": "与访问密钥配对的私有密钥",
  "Session expired": "会话已过期",
  "Session for {name} expired. Enter an MFA code to continue.":
    "{name} 的会话已过期，请输入 MFA 验证码以继续。",
  "Session for {name} expires soon. Enter an MFA code to refresh.":
    "{name} 的会话即将过期，请输入 MFA 验证码以刷新。",
  "Session name shown in CloudTrail, e.g. emr-management-tool":
    "CloudTrail 中显示的会话名，例如 emr-management-tool",
  "Session refresh failed for {name}.": "{name} 的会话刷新失败。",
  "Session refresh failed for {name}. Sign in with SSO again.":
    "{name} 的会话刷新失败，请重新进行 SSO 登录。",
  "Session refreshed for {name}.": "已刷新 {name} 的会话。",
  "Session refreshed for {name} · {duration} left": "已刷新 {name} 的会话 · 剩余 {duration}",
  "Session: {duration} left": "会话剩余 {duration}",
  "12-digit AWS account ID, e.g. 123456789012": "12 位 AWS 账户 ID，例如 123456789012",
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
  "An account named “{name}” already exists.": "已存在名为“{name}”的账户。",
  "IAM User + MFA uses sts:GetSessionToken. API calls still run as that IAM user (ASIA temporary keys). If EMR permissions are on a role, choose Assume Role and set MFA there instead.":
    "「IAM 用户 + MFA」使用 sts:GetSessionToken。API 调用仍以该 IAM 用户身份执行（ASIA 临时密钥）。若 EMR 权限挂在角色上，请改用「Assume Role」并在其中配置 MFA。",
  "This access key is already configured as “{name}”.": "此访问密钥已配置为“{name}”。",
  "This permanently removes the account and its stored credentials from this app. This cannot be undone.":
    "这将从此应用中永久移除该账户及其保存的凭证。此操作无法撤销。",
  "Update the display name and region. Access Key cannot be changed here; unlock Secret only when rotating the secret for the same key. To replace the full key pair, delete the account and add a new one.":
    "更新显示名称和区域。访问密钥无法在此更改；仅在为同一密钥轮换私有密钥时才解锁「私有访问密钥」。若要更换整个密钥对，请删除该账户并添加新账户。",
  "Update the display name, region, and SSO settings. Sign in again after changing SSO fields.":
    "更新显示名称、区域和 SSO 设置。更改 SSO 字段后请重新登录。",
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
