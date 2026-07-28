# macOS Signing And Notarization

The manual `macOS signed release` workflow builds a universal Apple Silicon/Intel application and DMG. It refuses to build an apparently final artifact unless every signing and notarization input is present. No credential belongs in the repository.
The macOS bundle identifier is `com.godgesture.desktop`; the Windows configuration keeps its existing identifier and data directory.

Configure these GitHub Actions secrets:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application certificate in PKCS#12 format.
- `APPLE_CERTIFICATE_PASSWORD`: password for that PKCS#12 file.
- `APPLE_SIGNING_IDENTITY`: exact Developer ID Application identity name.
- `APPLE_ID`: Apple ID used by notarytool.
- `APPLE_PASSWORD`: app-specific password for that Apple ID.
- `APPLE_TEAM_ID`: ten-character Apple Developer Team ID.

Trigger the workflow manually. Tauri imports the certificate, signs with hardened runtime, submits to Apple, waits for notarization, and staples the ticket. The workflow then independently verifies the application and DMG with `codesign`, `xcrun stapler`, and `spctl` before uploading artifacts.

The checked-in entitlement set is deliberately empty: global event capture and posting are controlled by macOS TCC Accessibility/Input Monitoring approval, not by an entitlement, and GodGesture is not sandboxed. The Info.plist usage string covers commands that deliberately communicate with Terminal or system services through Apple Events.
