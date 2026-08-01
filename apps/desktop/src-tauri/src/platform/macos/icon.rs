use base64::{engine::general_purpose::STANDARD, Engine as _};
use objc2::runtime::AnyObject;
use objc2_app_kit::{
    NSBitmapImageFileType, NSBitmapImageRep, NSBitmapImageRepPropertyKey, NSImage, NSWorkspace,
};
use objc2_foundation::{NSDictionary, NSString};

pub fn app_icon_base64(bundle_id: &str) -> Option<String> {
    let bundle_id = normalized_bundle_id(bundle_id)?;
    let workspace = NSWorkspace::sharedWorkspace();
    let identifier = NSString::from_str(bundle_id);
    let application_url = workspace.URLForApplicationWithBundleIdentifier(&identifier)?;
    let application_path = application_url.path()?;
    let image = workspace.iconForFile(&application_path);
    png_base64(&image)
}

fn normalized_bundle_id(value: &str) -> Option<&str> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 255
        || value.contains(char::is_whitespace)
        || !value.contains('.')
    {
        return None;
    }
    Some(value)
}

fn png_base64(image: &NSImage) -> Option<String> {
    let tiff = image.TIFFRepresentation()?;
    let bitmap = NSBitmapImageRep::imageRepWithData(&tiff)?;
    let properties = NSDictionary::<NSBitmapImageRepPropertyKey, AnyObject>::new();
    let png = unsafe {
        bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
    }?;
    Some(STANDARD.encode(png.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_identifier_validation_is_bounded() {
        assert_eq!(
            normalized_bundle_id(" com.google.Chrome "),
            Some("com.google.Chrome")
        );
        for invalid in ["", "Chrome", "com.google. Chrome"] {
            assert!(normalized_bundle_id(invalid).is_none());
        }
        assert!(normalized_bundle_id(&format!("com.{}", "x".repeat(256))).is_none());
    }
}
