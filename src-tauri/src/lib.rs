pub mod aws;
pub mod commands;
pub mod db;
pub mod diagnostics;
pub mod error;
pub mod models;
pub mod state;

use state::AppState;

#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

pub fn run() {
    diagnostics::install_panic_hook();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::credentials::test_aws_credentials,
            commands::credentials::save_aws_credentials,
            commands::credentials::get_aws_settings,
            commands::credentials::clear_aws_credentials,
            commands::credentials::list_aws_accounts,
            commands::credentials::create_aws_account,
            commands::credentials::set_active_aws_account,
            commands::credentials::delete_aws_account,
            commands::credentials::clear_aws_account_credentials,
            commands::credentials::list_aws_cli_profiles,
            commands::credentials::import_aws_cli_profile,
            commands::emr::list_virtual_clusters,
            commands::emr::list_job_runs,
            commands::emr::describe_job_run,
            commands::emr::start_job_run,
            commands::emr::cancel_job_run,
            commands::templates::list_templates,
            commands::templates::create_template,
            commands::templates::update_template,
            commands::templates::delete_template,
            commands::templates::duplicate_template,
            commands::job_config_templates::list_job_config_templates,
            commands::job_config_templates::create_job_config_template,
            commands::job_config_templates::update_job_config_template,
            commands::job_config_templates::delete_job_config_template,
            commands::job_config_templates::duplicate_job_config_template,
            commands::system::get_submit_user,
            commands::logs::list_job_log_streams,
            commands::logs::get_job_logs,
            commands::s3::list_s3_buckets,
            commands::s3::list_s3_objects,
            commands::s3::list_s3_job_log_objects,
            commands::s3::get_s3_job_log_object,
            commands::s3::get_s3_text_object,
            commands::s3::put_s3_text_object,
            commands::s3::upload_s3_object,
            commands::s3::upload_s3_object_from_disk,
            commands::s3::download_s3_object,
            commands::s3::download_s3_object_to_disk,
            commands::s3::rename_s3_object,
            commands::s3::delete_s3_object,
            commands::glue::list_glue_databases,
            commands::glue::list_glue_tables,
            commands::glue::get_glue_table,
            commands::glue::update_glue_table,
            commands::athena::list_athena_workgroups,
            commands::athena::start_athena_query,
            commands::athena::get_athena_query_execution,
            commands::athena::get_athena_query_results,
            commands::athena::stop_athena_query,
            commands::athena::export_athena_query_csv,
            commands::files::save_text_file,
            commands::files::open_text_file,
            commands::diagnostics::get_app_log_path,
            commands::diagnostics::open_app_log,
        ]);

    #[cfg(desktop)]
    {
        builder = builder
            .setup(|app| {
                diagnostics::init_file_logger()?;
                let undo = PredefinedMenuItem::undo(app, None)?;
                let redo = PredefinedMenuItem::redo(app, None)?;
                let separator = PredefinedMenuItem::separator(app)?;
                let cut = PredefinedMenuItem::cut(app, None)?;
                let copy = PredefinedMenuItem::copy(app, None)?;
                let paste = PredefinedMenuItem::paste(app, None)?;
                let select_all = PredefinedMenuItem::select_all(app, None)?;
                let edit = Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[&undo, &redo, &separator, &cut, &copy, &paste, &select_all],
                )?;
                let view_logs =
                    MenuItem::with_id(app, "view_logs", "查看日志", true, None::<&str>)?;
                let help = Submenu::with_items(app, "帮助", true, &[&view_logs])?;
                let menu = Menu::with_items(app, &[&edit, &help])?;
                app.set_menu(menu)?;
                Ok(())
            })
            .on_menu_event(|_app, event| {
                if event.id() == "view_logs" {
                    if let Err(error) = diagnostics::open_app_log() {
                        diagnostics::append_log_line(
                            "ERROR",
                            &format!("Failed to open app log from menu: {error}"),
                        );
                    }
                }
            });
    }

    #[cfg(not(desktop))]
    {
        builder = builder.setup(|_app| {
            diagnostics::init_file_logger()?;
            Ok(())
        });
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running EMR Management Tool");
}
