// Builds an aws_config::SdkConfig using a native-tls HTTP client so TLS trust
// falls back to the operating-system trust store.
//
// Why this exists: the aws-sdk-rust default HTTP client uses rustls with
// `webpki-roots` — a static Mozilla CA bundle compiled into the binary. That
// bundle does NOT include enterprise root CAs installed by SSL-inspection
// proxies (Zscaler, Netskope, Cloudflare Zero Trust, etc.). On those
// networks every AWS API call fails with `invalid peer certificate: UnknownCA`.
// native-tls on macOS delegates to SecureTransport which reads the user+system
// Keychain, so corporate CAs are honored automatically.

use aws_config::{BehaviorVersion, Region, SdkConfig};
use aws_smithy_runtime::client::http::hyper_014::HyperClientBuilder;

pub async fn build_sdk_config(
    region: &str,
    profile: Option<&str>,
) -> SdkConfig {
    let https = hyper_tls::HttpsConnector::new();
    let http_client = HyperClientBuilder::new().build(https);

    let mut loader = aws_config::defaults(BehaviorVersion::latest())
        .http_client(http_client)
        .region(Region::new(region.to_string()));

    if let Some(p) = profile {
        loader = loader.profile_name(p);
    }

    loader.load().await
}
