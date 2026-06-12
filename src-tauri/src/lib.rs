pub mod aws;
pub mod commands;
pub mod db;
pub mod error;
pub mod models;
pub mod state;

use state::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
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
            commands::logs::get_job_logs,
            commands::s3::list_s3_buckets,
            commands::s3::list_s3_objects,
            commands::s3::get_s3_text_object,
            commands::s3::put_s3_text_object,
            commands::s3::upload_s3_object,
            commands::s3::download_s3_object,
            commands::s3::delete_s3_object
        ])
        .run(tauri::generate_context!())
        .expect("error while running EMR Management Tool");
}
