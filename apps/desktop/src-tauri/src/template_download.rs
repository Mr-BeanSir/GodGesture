use futures_util::StreamExt;
use reqwest::{header, redirect::Policy, Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::Manager;
use url::Url;

const CATALOG_MAX_BYTES: usize = 512 * 1024;
const PACKAGE_MAX_BYTES: usize = 256 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_REDIRECTS: usize = 5;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TemplateResourceKind {
    Catalog,
    Package,
    PluginCatalog,
}

impl TemplateResourceKind {
    fn maximum_bytes(self) -> usize {
        match self {
            Self::Catalog => CATALOG_MAX_BYTES,
            Self::Package => PACKAGE_MAX_BYTES,
            Self::PluginCatalog => CATALOG_MAX_BYTES,
        }
    }

    fn too_large_code(self) -> &'static str {
        match self {
            Self::Catalog => "catalog_too_large",
            Self::Package => "package_too_large",
            Self::PluginCatalog => "catalog_too_large",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CatalogCacheKind {
    Templates,
    Plugins,
}

impl CatalogCacheKind {
    fn file_name(self) -> &'static str {
        match self {
            Self::Templates => "templates-catalog.min.json",
            Self::Plugins => "plugins-catalog.min.json",
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct TemplateDownloadError {
    pub code: &'static str,
    pub message: String,
}

impl TemplateDownloadError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn too_large(kind: TemplateResourceKind) -> Self {
        Self::new(
            kind.too_large_code(),
            format!("template response exceeds {} bytes", kind.maximum_bytes()),
        )
    }
}

#[tauri::command]
pub async fn download_template_text(
    url: String,
    resource_kind: TemplateResourceKind,
) -> Result<String, TemplateDownloadError> {
    let future = download_with_client(default_client()?, &url, resource_kind);
    tokio::time::timeout(REQUEST_TIMEOUT, future)
        .await
        .map_err(|_| TemplateDownloadError::new("template_timeout", "template request timed out"))?
}

#[tauri::command]
pub fn catalog_cache_get(
    app: tauri::AppHandle,
    kind: CatalogCacheKind,
) -> Result<Option<String>, TemplateDownloadError> {
    let path = catalog_cache_path(&app, kind)?;
    match fs::metadata(&path) {
        Ok(metadata) if metadata.len() > CATALOG_MAX_BYTES as u64 => {
            return Err(TemplateDownloadError::too_large(
                TemplateResourceKind::Catalog,
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            log::warn!(
                "inspect online catalog cache failed for {:?}: {error}",
                path
            );
            return Err(TemplateDownloadError::new(
                "catalog_cache_unavailable",
                "online catalog cache could not be read",
            ));
        }
    }
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) => {
            log::warn!("read online catalog cache failed for {:?}: {error}", path);
            Err(TemplateDownloadError::new(
                "catalog_cache_unavailable",
                "online catalog cache could not be read",
            ))
        }
    }
}

#[tauri::command]
pub fn catalog_cache_set(
    app: tauri::AppHandle,
    kind: CatalogCacheKind,
    contents: String,
) -> Result<(), TemplateDownloadError> {
    if contents.len() > CATALOG_MAX_BYTES {
        return Err(TemplateDownloadError::too_large(
            TemplateResourceKind::Catalog,
        ));
    }
    let path = catalog_cache_path(&app, kind)?;
    let parent = path.parent().ok_or_else(|| {
        TemplateDownloadError::new(
            "catalog_cache_unavailable",
            "online catalog cache directory is unavailable",
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        log::warn!("create online catalog cache directory failed: {error}");
        TemplateDownloadError::new(
            "catalog_cache_unavailable",
            "online catalog cache directory could not be created",
        )
    })?;

    let temporary = path.with_extension("json.tmp");
    let write_result = (|| -> std::io::Result<()> {
        let mut file = File::create(&temporary)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        replace_file(&temporary, &path)
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        log::warn!("write online catalog cache failed for {:?}: {error}", path);
        return Err(TemplateDownloadError::new(
            "catalog_cache_unavailable",
            "online catalog cache could not be written",
        ));
    }
    Ok(())
}

fn catalog_cache_path(
    app: &tauri::AppHandle,
    kind: CatalogCacheKind,
) -> Result<PathBuf, TemplateDownloadError> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("catalogs").join(kind.file_name()))
        .map_err(|error| {
            log::warn!("resolve online catalog cache directory failed: {error}");
            TemplateDownloadError::new(
                "catalog_cache_unavailable",
                "online catalog cache directory is unavailable",
            )
        })
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(target.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|_| std::io::Error::last_os_error())
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(source, target)
}

fn default_client() -> Result<Client, TemplateDownloadError> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    Client::builder()
        .redirect(Policy::none())
        .user_agent(concat!("GodGesture/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| {
            log::error!("build template HTTP client failed: {error}");
            TemplateDownloadError::new("template_network", "template HTTP client is unavailable")
        })
}

async fn download_with_client(
    client: Client,
    input: &str,
    kind: TemplateResourceKind,
) -> Result<String, TemplateDownloadError> {
    let mut url = validated_url(input, "template_url_invalid")?;
    for redirect_count in 0..=MAX_REDIRECTS {
        let response = client
            .get(url.clone())
            .header(header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| {
                log::warn!("template request failed for {}: {error}", safe_url(&url));
                TemplateDownloadError::new("template_network", "template request failed")
            })?;

        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err(TemplateDownloadError::new(
                    "template_redirect_insecure",
                    "template request exceeded the redirect limit",
                ));
            }
            let location = response.headers().get(header::LOCATION).ok_or_else(|| {
                TemplateDownloadError::new(
                    "template_redirect_insecure",
                    "template redirect did not include a location",
                )
            })?;
            let location = location.to_str().map_err(|_| {
                TemplateDownloadError::new(
                    "template_redirect_insecure",
                    "template redirect location is invalid",
                )
            })?;
            let next = url.join(location).map_err(|_| {
                TemplateDownloadError::new(
                    "template_redirect_insecure",
                    "template redirect URL is invalid",
                )
            })?;
            url = validated_parsed_url(next, "template_redirect_insecure")?;
            continue;
        }

        if !response.status().is_success() {
            return Err(http_error(response.status()));
        }
        if response
            .content_length()
            .is_some_and(|length| length > kind.maximum_bytes() as u64)
        {
            return Err(TemplateDownloadError::too_large(kind));
        }

        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| {
                log::warn!(
                    "read template response failed for {}: {error}",
                    safe_url(&url)
                );
                TemplateDownloadError::new(
                    "template_network",
                    "template response could not be read",
                )
            })?;
            if bytes.len().saturating_add(chunk.len()) > kind.maximum_bytes() {
                return Err(TemplateDownloadError::too_large(kind));
            }
            bytes.extend_from_slice(&chunk);
        }
        return String::from_utf8(bytes).map_err(|_| {
            TemplateDownloadError::new("invalid_json", "template response is not valid UTF-8")
        });
    }
    unreachable!("redirect loop exits at the configured limit")
}

fn validated_url(input: &str, code: &'static str) -> Result<Url, TemplateDownloadError> {
    let url = Url::parse(input)
        .map_err(|_| TemplateDownloadError::new(code, "template URL is invalid"))?;
    validated_parsed_url(url, code)
}

fn validated_parsed_url(url: Url, code: &'static str) -> Result<Url, TemplateDownloadError> {
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(TemplateDownloadError::new(
            code,
            "template URL must use HTTPS without credentials or fragments",
        ));
    }
    Ok(url)
}

fn http_error(status: StatusCode) -> TemplateDownloadError {
    TemplateDownloadError::new(
        "template_http",
        format!("template request failed with status {}", status.as_u16()),
    )
}

fn safe_url(url: &Url) -> String {
    format!(
        "{}://{}{}",
        url.scheme(),
        url.host_str().unwrap_or("?"),
        url.path()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRODUCTION_CATALOG_URL: &str =
        "https://raw.githubusercontent.com/Mr-BeanSir/GodGesture-Templates/main/catalog.min.json";

    #[test]
    fn resource_kinds_have_fixed_protocol_limits() {
        assert_eq!(TemplateResourceKind::Catalog.maximum_bytes(), 512 * 1024);
        assert_eq!(TemplateResourceKind::Package.maximum_bytes(), 256 * 1024);
        assert_eq!(
            TemplateDownloadError::too_large(TemplateResourceKind::Catalog).code,
            "catalog_too_large"
        );
        assert_eq!(
            TemplateDownloadError::too_large(TemplateResourceKind::Package).code,
            "package_too_large"
        );
    }

    #[test]
    fn url_validation_rejects_non_https_credentials_and_fragments() {
        for input in [
            "http://example.com/catalog.json",
            "https://user@example.com/catalog.json",
            "https://example.com/catalog.json#section",
            "not a URL",
        ] {
            assert_eq!(
                validated_url(input, "template_url_invalid")
                    .unwrap_err()
                    .code,
                "template_url_invalid"
            );
        }
        assert!(validated_url("https://example.com/catalog.json", "bad").is_ok());
    }

    #[test]
    fn redirect_validation_uses_its_dedicated_error_code() {
        let base = Url::parse("https://example.com/releases/catalog.json").unwrap();
        let relative = base.join("../asset.json").unwrap();
        assert_eq!(relative.as_str(), "https://example.com/asset.json");
        assert!(validated_parsed_url(relative, "template_redirect_insecure").is_ok());

        let insecure = base
            .join("http://downloads.example.com/asset.json")
            .unwrap();
        assert_eq!(
            validated_parsed_url(insecure, "template_redirect_insecure")
                .unwrap_err()
                .code,
            "template_redirect_insecure"
        );
    }

    #[test]
    fn safe_url_does_not_include_query_values() {
        let url = Url::parse("https://example.com/catalog.json?token=secret").unwrap();
        assert_eq!(safe_url(&url), "https://example.com/catalog.json");
    }

    #[test]
    #[ignore = "requires live GitHub raw-file access"]
    fn production_catalog_and_packages_follow_validated_redirects() {
        tauri::async_runtime::block_on(async {
            let catalog_text = download_template_text(
                PRODUCTION_CATALOG_URL.to_string(),
                TemplateResourceKind::Catalog,
            )
            .await
            .expect("production catalog should download");
            let catalog: serde_json::Value =
                serde_json::from_str(&catalog_text).expect("catalog should be JSON");
            assert_eq!(catalog["formatVersion"], 2);
            let entries = catalog["entries"]
                .as_array()
                .expect("catalog should contain entries");
            assert!(!entries.is_empty());

            for entry in entries {
                let package_url = entry["packageUrl"]
                    .as_str()
                    .expect("catalog entry should include packageUrl");
                let package_text =
                    download_template_text(package_url.to_string(), TemplateResourceKind::Package)
                        .await
                        .expect("production package should download");
                let package: serde_json::Value =
                    serde_json::from_str(&package_text).expect("package should be JSON");
                assert_eq!(package["slug"], entry["slug"]);
                assert_eq!(package["version"], entry["version"]);
            }
        });
    }
}
