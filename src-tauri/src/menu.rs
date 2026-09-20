//! Native menu construction, parameterised by interface language.
//!
//! The frontend owns the language preference (it lives in `localStorage`, which
//! Rust cannot read), so it pushes the resolved BCP-47 tag and the menu is
//! rebuilt through [`crate::commands::appearance::set_app_language`].

/// The languages the native menu is translated into.
///
/// Kept separate from the item tree on purpose: only these five labels change
/// with the language. Everything else about the menu is fixed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppLanguage {
    En,
    Zh,
}

impl AppLanguage {
    /// Accepts a BCP-47 tag (`"zh-CN"`, `"en-US"`) or a bare code (`"zh"`, `"en"`).
    /// Anything unrecognized falls back to English.
    pub fn from_code(code: &str) -> Self {
        let lower = code.trim().to_ascii_lowercase();
        if lower == "zh" || lower.starts_with("zh-") || lower.starts_with("zh_") {
            Self::Zh
        } else {
            Self::En
        }
    }

    pub fn labels(self) -> MenuLabels {
        match self {
            Self::En => MenuLabels {
                edit: "Edit",
                view_logs: "View Logs",
                keyboard_shortcuts: "Keyboard Shortcuts",
                about: "About EMR on EKS",
                help: "Help",
            },
            Self::Zh => MenuLabels {
                edit: "编辑",
                view_logs: "查看日志",
                keyboard_shortcuts: "键盘快捷键",
                about: "关于 EMR on EKS",
                help: "帮助",
            },
        }
    }
}

/// The five labels that vary by language. The undo/redo/cut/copy/paste/select-all
/// items are `PredefinedMenuItem`s, which the OS renders in its own language.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MenuLabels {
    pub edit: &'static str,
    pub view_logs: &'static str,
    pub keyboard_shortcuts: &'static str,
    pub about: &'static str,
    pub help: &'static str,
}

/// Builds the application menu.
///
/// The item set, their order, and the `view_logs` / `show_shortcuts` /
/// `show_about` ids are load-bearing: `on_menu_event` dispatches on those ids, so
/// changing them silently disables the Help menu handlers.
#[cfg(desktop)]
pub fn build_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    language: AppLanguage,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let labels = language.labels();

    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let edit = Submenu::with_items(
        app,
        labels.edit,
        true,
        &[&undo, &redo, &separator, &cut, &copy, &paste, &select_all],
    )?;

    let view_logs = MenuItem::with_id(app, "view_logs", labels.view_logs, true, None::<&str>)?;
    let show_shortcuts = MenuItem::with_id(
        app,
        "show_shortcuts",
        labels.keyboard_shortcuts,
        true,
        None::<&str>,
    )?;
    let help_separator = PredefinedMenuItem::separator(app)?;
    let show_about = MenuItem::with_id(app, "show_about", labels.about, true, None::<&str>)?;
    let help = Submenu::with_items(
        app,
        labels.help,
        true,
        &[&show_shortcuts, &view_logs, &help_separator, &show_about],
    )?;

    Menu::with_items(app, &[&edit, &help])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_code_recognizes_chinese_tags() {
        for code in ["zh", "zh-CN", "zh_CN", "zh-Hans", "ZH-cn", "  zh-TW  "] {
            assert_eq!(AppLanguage::from_code(code), AppLanguage::Zh, "code: {code}");
        }
    }

    #[test]
    fn from_code_falls_back_to_english() {
        for code in ["en", "en-US", "fr-FR", "ja-JP", "", "  "] {
            assert_eq!(AppLanguage::from_code(code), AppLanguage::En, "code: {code}");
        }
    }

    #[test]
    fn every_label_is_translated() {
        let en = AppLanguage::En.labels();
        let zh = AppLanguage::Zh.labels();
        assert_ne!(en.edit, zh.edit);
        assert_ne!(en.view_logs, zh.view_logs);
        assert_ne!(en.keyboard_shortcuts, zh.keyboard_shortcuts);
        assert_ne!(en.about, zh.about);
        assert_ne!(en.help, zh.help);
    }
}
