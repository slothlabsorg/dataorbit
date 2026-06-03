use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;
use serde::Serialize;

fn credentials_path() -> Option<PathBuf> {
    // AWS_SHARED_CREDENTIALS_FILE env override, then default
    std::env::var("AWS_SHARED_CREDENTIALS_FILE")
        .map(PathBuf::from)
        .ok()
        .or_else(|| dirs::home_dir().map(|h| h.join(".aws").join("credentials")))
}

fn config_path() -> Option<PathBuf> {
    std::env::var("AWS_CONFIG_FILE")
        .map(PathBuf::from)
        .ok()
        .or_else(|| dirs::home_dir().map(|h| h.join(".aws").join("config")))
}

fn parse_section_names<'a>(content: &'a str, strip_prefix: &'a str) -> impl Iterator<Item = String> + 'a {
    content.lines()
        .filter_map(move |line| {
            let line = line.trim();
            if line.starts_with('[') && line.ends_with(']') {
                let inner = &line[1..line.len() - 1];
                let name = if !strip_prefix.is_empty() && inner.starts_with(strip_prefix) {
                    inner[strip_prefix.len()..].trim()
                } else {
                    inner.trim()
                };
                if !name.is_empty() { Some(name.to_string()) } else { None }
            } else {
                None
            }
        })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsProfile {
    pub name: String,
    pub region: Option<String>,
    /// true when ~/.aws/credentials has live STS keys for this profile
    pub has_credentials: bool,
}

/// Returns all profiles from ~/.aws/config enriched with whether credentials exist.
#[tauri::command]
pub fn list_aws_profiles_rich() -> Vec<AwsProfile> {
    // Which profiles have entries in ~/.aws/credentials?
    let cred_names: BTreeSet<String> = credentials_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|c| parse_section_names(&c, "").collect())
        .unwrap_or_default();

    let mut results: Vec<AwsProfile> = Vec::new();

    if let Some(path) = config_path() {
        if let Ok(content) = fs::read_to_string(path) {
            let mut current_profile: Option<String> = None;
            let mut current_region: Option<String> = None;

            for line in content.lines() {
                let line = line.trim();
                if line.starts_with('[') && line.ends_with(']') {
                    // Flush previous
                    if let Some(name) = current_profile.take() {
                        results.push(AwsProfile {
                            has_credentials: cred_names.contains(&name),
                            name,
                            region: current_region.take(),
                        });
                    }
                    let inner = &line[1..line.len()-1];
                    current_profile = if inner.starts_with("profile ") {
                        let n = inner["profile ".len()..].trim().to_string();
                        if n.is_empty() { None } else { Some(n) }
                    } else if inner == "default" {
                        Some("default".to_string())
                    } else {
                        current_region = None;
                        None // sso-session, etc.
                    };
                } else if current_profile.is_some() {
                    if let Some(val) = line.strip_prefix("region") {
                        let val = val.trim_start_matches(['=',' ','\t']).trim();
                        if !val.is_empty() { current_region = Some(val.to_string()); }
                    }
                }
            }
            if let Some(name) = current_profile {
                results.push(AwsProfile {
                    has_credentials: cred_names.contains(&name),
                    name,
                    region: current_region,
                });
            }
        }
    }

    // Add anything from credentials that isn't in config
    for name in &cred_names {
        if !results.iter().any(|r| &r.name == name) {
            results.push(AwsProfile { name: name.clone(), region: None, has_credentials: true });
        }
    }

    results
}

#[tauri::command]
pub fn list_aws_profiles() -> Vec<String> {
    let mut profiles: BTreeSet<String> = BTreeSet::new();

    // ~/.aws/credentials — sections are bare profile names: [profile-name]
    if let Some(path) = credentials_path() {
        if let Ok(content) = fs::read_to_string(path) {
            for name in parse_section_names(&content, "") {
                profiles.insert(name);
            }
        }
    }

    // ~/.aws/config — sections use "profile " prefix: [profile profile-name]
    // The [default] section is the exception (no prefix).
    if let Some(path) = config_path() {
        if let Ok(content) = fs::read_to_string(path) {
            for name in parse_section_names(&content, "profile ") {
                profiles.insert(name);
            }
            // Also include bare [default] if present
            if content.lines().any(|l| l.trim() == "[default]") {
                profiles.insert("default".to_string());
            }
        }
    }

    profiles.into_iter().collect()
}
