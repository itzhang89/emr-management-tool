pub fn app_distribution() -> &'static str {
    option_env!("EMR_APP_DISTRIBUTION").unwrap_or("installer")
}

pub fn is_portable() -> bool {
    matches!(option_env!("EMR_APP_DISTRIBUTION"), Some("portable"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_distribution_defaults_to_installer_when_unset() {
        assert_eq!(app_distribution(), "installer");
    }

    #[test]
    fn is_portable_matches_distribution() {
        assert_eq!(is_portable(), app_distribution() == "portable");
    }
}
