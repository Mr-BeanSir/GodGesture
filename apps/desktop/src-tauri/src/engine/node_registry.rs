//! Restricted npm registry metadata access for the Node plugin workbench.

use futures_util::StreamExt;
use reqwest::{header, redirect::Policy, Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use url::Url;

const REGISTRY_ORIGIN: &str = "https://registry.npmjs.org";
const RESPONSE_MAX_BYTES: usize = 256 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_SEARCH_RESULTS: usize = 10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePackageSearchResult {
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub weekly_downloads: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    objects: Vec<SearchObject>,
}

#[derive(Debug, Deserialize)]
struct SearchObject {
    package: SearchPackage,
    downloads: Option<SearchDownloads>,
}

#[derive(Debug, Deserialize)]
struct SearchPackage {
    name: String,
    version: String,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SearchDownloads {
    weekly: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct DistTags {
    latest: Option<String>,
}

fn client() -> Result<Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    Client::builder()
        .redirect(Policy::none())
        .user_agent(concat!("GodGesture/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("build npm registry client: {error}"))
}

fn package_name_is_valid(name: &str) -> bool {
    if name.is_empty() || name.len() > 214 || name.contains(['\\', ' ']) {
        return false;
    }
    let valid_part = |part: &str| {
        !part.is_empty()
            && !part.starts_with('.')
            && !part.starts_with('_')
            && part.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
            })
    };
    if let Some(scoped) = name.strip_prefix('@') {
        let mut parts = scoped.split('/');
        matches!((parts.next(), parts.next(), parts.next()), (Some(scope), Some(package), None) if valid_part(scope) && valid_part(package))
    } else {
        !name.contains('/') && valid_part(name)
    }
}

fn encoded_name(name: &str) -> String {
    url::form_urlencoded::byte_serialize(name.as_bytes()).collect()
}

async fn response_bytes(response: reqwest::Response) -> Result<Vec<u8>, String> {
    if response.status() == StatusCode::TOO_MANY_REQUESTS {
        return Err("npm registry rate limit reached; try again later".into());
    }
    if !response.status().is_success() {
        return Err(format!("npm registry returned HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > RESPONSE_MAX_BYTES as u64)
    {
        return Err("npm registry response is too large".into());
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("read npm registry response: {error}"))?;
        if bytes.len().saturating_add(chunk.len()) > RESPONSE_MAX_BYTES {
            return Err("npm registry response is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn search_with_client(
    client: Client,
    query: &str,
) -> Result<Vec<NodePackageSearchResult>, String> {
    let mut url = Url::parse(&format!("{REGISTRY_ORIGIN}/-/v1/search"))
        .map_err(|error| format!("build npm search URL: {error}"))?;
    url.query_pairs_mut()
        .append_pair("text", query)
        .append_pair("size", &MAX_SEARCH_RESULTS.to_string());
    let response = client
        .get(url)
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("npm registry search failed: {error}"))?;
    let payload: SearchResponse = serde_json::from_slice(&response_bytes(response).await?)
        .map_err(|error| format!("invalid npm search response: {error}"))?;
    Ok(payload
        .objects
        .into_iter()
        .take(MAX_SEARCH_RESULTS)
        .filter_map(|item| {
            if !package_name_is_valid(&item.package.name) || item.package.version.len() > 100 {
                return None;
            }
            Some(NodePackageSearchResult {
                name: item.package.name,
                version: item.package.version,
                description: item
                    .package
                    .description
                    .map(|description| description.chars().take(300).collect()),
                weekly_downloads: item.downloads.and_then(|downloads| downloads.weekly),
            })
        })
        .collect())
}

async fn latest_with_client(client: Client, name: &str) -> Result<String, String> {
    let url = format!(
        "{REGISTRY_ORIGIN}/-/package/{}/dist-tags",
        encoded_name(name)
    );
    let response = client
        .get(url)
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("npm registry lookup failed: {error}"))?;
    let tags: DistTags = serde_json::from_slice(&response_bytes(response).await?)
        .map_err(|error| format!("invalid npm dist-tags response: {error}"))?;
    tags.latest
        .ok_or_else(|| "npm package has no latest dist-tag".into())
}

#[tauri::command]
pub async fn search_node_packages(query: String) -> Result<Vec<NodePackageSearchResult>, String> {
    let query = query.trim().to_string();
    if query.len() < 2 || query.len() > 100 {
        return Err("npm search text must contain 2 to 100 characters".into());
    }
    tokio::time::timeout(REQUEST_TIMEOUT, search_with_client(client()?, &query))
        .await
        .map_err(|_| "npm registry search timed out".to_string())?
}

#[tauri::command]
pub async fn latest_node_package_version(name: String) -> Result<String, String> {
    let name = name.trim().to_string();
    if !package_name_is_valid(&name) {
        return Err("npm package name is invalid".into());
    }
    tokio::time::timeout(REQUEST_TIMEOUT, latest_with_client(client()?, &name))
        .await
        .map_err(|_| "npm registry lookup timed out".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_names_are_bounded_and_portable() {
        assert!(package_name_is_valid("zod"));
        assert!(package_name_is_valid("@scope/package-name"));
        assert!(!package_name_is_valid("foo@bar"));
        assert!(!package_name_is_valid("scope/package"));
        assert!(!package_name_is_valid("@scope/package/extra"));
        assert!(!package_name_is_valid("../escape"));
        assert!(!package_name_is_valid("package name"));
        assert!(!package_name_is_valid(""));
    }

    #[test]
    fn scoped_names_are_encoded_for_registry_paths() {
        assert_eq!(encoded_name("@types/node"), "%40types%2Fnode");
    }
}
