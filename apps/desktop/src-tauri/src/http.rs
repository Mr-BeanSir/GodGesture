use reqwest::{header::HeaderName, Client, RequestBuilder, Response, StatusCode};
use std::time::Instant;
use url::Url;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HttpResponseLevel {
    Info,
    Warn,
}

pub(crate) struct LoggedHttpClient {
    client: Client,
    target: &'static str,
}

pub(crate) struct LoggedRequestBuilder {
    request: RequestBuilder,
    target: &'static str,
    method: &'static str,
    url: String,
}

impl LoggedHttpClient {
    pub(crate) fn new(client: Client, target: &'static str) -> Self {
        Self { client, target }
    }

    pub(crate) fn get(&self, url: Url) -> LoggedRequestBuilder {
        let safe_url = safe_url(&url);
        LoggedRequestBuilder {
            request: self.client.get(url),
            target: self.target,
            method: "GET",
            url: safe_url,
        }
    }
}

impl LoggedRequestBuilder {
    pub(crate) fn header(self, name: HeaderName, value: &'static str) -> Self {
        Self {
            request: self.request.header(name, value),
            ..self
        }
    }

    pub(crate) async fn send(self) -> Result<Response, reqwest::Error> {
        let started_at = Instant::now();
        log::debug!(
            target: self.target,
            "event=request_started method={} url={}",
            self.method,
            self.url
        );
        match self.request.send().await {
            Ok(response) => {
                let status = response.status();
                let content_length = response
                    .content_length()
                    .map_or_else(|| "-".to_owned(), |length| length.to_string());
                match response_level(status) {
                    HttpResponseLevel::Info => log::info!(
                        target: self.target,
                        "event=response method={} url={} status={} durationMs={} contentLength={}",
                        self.method,
                        self.url,
                        status.as_u16(),
                        started_at.elapsed().as_millis(),
                        content_length
                    ),
                    HttpResponseLevel::Warn => log::warn!(
                        target: self.target,
                        "event=response method={} url={} status={} durationMs={} contentLength={}",
                        self.method,
                        self.url,
                        status.as_u16(),
                        started_at.elapsed().as_millis(),
                        content_length
                    ),
                }
                Ok(response)
            }
            Err(error) => {
                log::error!(
                    target: self.target,
                    "event=request_failed method={} url={} durationMs={} category={}",
                    self.method,
                    self.url,
                    started_at.elapsed().as_millis(),
                    request_error_category(error.is_timeout())
                );
                Err(error)
            }
        }
    }
}

fn safe_url(url: &Url) -> String {
    let mut safe = url.clone();
    let _ = safe.set_username("");
    let _ = safe.set_password(None);
    safe.set_query(None);
    safe.set_fragment(None);
    safe.to_string()
}

fn response_level(status: StatusCode) -> HttpResponseLevel {
    if status.as_u16() >= 400 {
        HttpResponseLevel::Warn
    } else {
        HttpResponseLevel::Info
    }
}

fn request_error_category(is_timeout: bool) -> &'static str {
    if is_timeout {
        "timeout"
    } else {
        "network"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::StatusCode;

    #[test]
    fn safe_url_removes_credentials_query_and_fragment() {
        let url = Url::parse("https://user:password@example.test:8443/api?token=secret#fragment")
            .unwrap();

        let result = safe_url(&url);

        assert_eq!(result, "https://example.test:8443/api");
        assert!(!result.contains("password"));
        assert!(!result.contains("secret"));
    }

    #[test]
    fn response_level_warns_for_http_failures() {
        assert_eq!(response_level(StatusCode::OK), HttpResponseLevel::Info);
        assert_eq!(
            response_level(StatusCode::TEMPORARY_REDIRECT),
            HttpResponseLevel::Info
        );
        assert_eq!(
            response_level(StatusCode::BAD_REQUEST),
            HttpResponseLevel::Warn
        );
        assert_eq!(
            response_level(StatusCode::INTERNAL_SERVER_ERROR),
            HttpResponseLevel::Warn
        );
    }

    #[test]
    fn request_error_category_is_bounded_and_does_not_include_error_text() {
        assert_eq!(request_error_category(true), "timeout");
        assert_eq!(request_error_category(false), "network");
    }
}
