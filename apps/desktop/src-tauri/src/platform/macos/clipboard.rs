// NSPasteboard text access and selection capture with full-format restoration.

use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardTypeString, NSPasteboardWriting};
use objc2_foundation::{NSArray, NSData, NSInteger, NSString};
use std::time::Duration;

const COPY_POLL_ATTEMPTS: usize = 50;
const COPY_POLL_DELAY: Duration = Duration::from_millis(10);
const MAX_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug)]
struct SnapshotItem {
    values: Vec<(String, Vec<u8>)>,
}

#[derive(Debug)]
struct PasteboardSnapshot {
    items: Vec<SnapshotItem>,
}

pub fn read_text() -> Option<String> {
    autoreleasepool(|_| {
        NSPasteboard::generalPasteboard()
            .stringForType(unsafe { NSPasteboardTypeString })
            .map(|value| value.to_string())
    })
}

pub fn write_text(text: &str) -> Result<(), String> {
    autoreleasepool(|_| {
        let pasteboard = NSPasteboard::generalPasteboard();
        pasteboard.clearContents();
        let text = NSString::from_str(text);
        if pasteboard.setString_forType(&text, unsafe { NSPasteboardTypeString }) {
            Ok(())
        } else {
            Err("NSPasteboard rejected string data".into())
        }
    })
}

fn snapshot(pasteboard: &NSPasteboard) -> Result<PasteboardSnapshot, String> {
    let items = pasteboard.pasteboardItems().unwrap_or_default();
    let mut total_bytes = 0_usize;
    let mut snapshot_items = Vec::with_capacity(items.len());
    for item in &*items {
        let types = item.types();
        let mut values = Vec::with_capacity(types.len());
        for pasteboard_type in &*types {
            let data = item.dataForType(&pasteboard_type).ok_or_else(|| {
                format!("pasteboard item did not materialize type {pasteboard_type}")
            })?;
            total_bytes = total_bytes.saturating_add(data.len());
            if total_bytes > MAX_SNAPSHOT_BYTES {
                return Err("pasteboard snapshot exceeds 64 MiB".into());
            }
            values.push((pasteboard_type.to_string(), data.to_vec()));
        }
        snapshot_items.push(SnapshotItem { values });
    }
    Ok(PasteboardSnapshot {
        items: snapshot_items,
    })
}

fn restore(pasteboard: &NSPasteboard, snapshot: PasteboardSnapshot) -> Result<(), String> {
    let mut objects: Vec<Retained<ProtocolObject<dyn NSPasteboardWriting>>> =
        Vec::with_capacity(snapshot.items.len());
    for snapshot_item in snapshot.items {
        let item = NSPasteboardItem::new();
        for (pasteboard_type, bytes) in snapshot_item.values {
            let pasteboard_type = NSString::from_str(&pasteboard_type);
            let data = NSData::with_bytes(&bytes);
            if !item.setData_forType(&data, &pasteboard_type) {
                return Err(format!("restore pasteboard type {pasteboard_type} failed"));
            }
        }
        objects.push(ProtocolObject::from_retained(item));
    }

    pasteboard.clearContents();
    if objects.is_empty() {
        return Ok(());
    }
    let objects = NSArray::from_retained_slice(&objects);
    pasteboard
        .writeObjects(&objects)
        .then_some(())
        .ok_or_else(|| "NSPasteboard rejected restored items".into())
}

fn wait_for_change(
    initial: NSInteger,
    attempts: usize,
    mut current: impl FnMut() -> NSInteger,
    mut wait: impl FnMut(),
) -> Option<NSInteger> {
    for _ in 0..attempts {
        wait();
        let change = current();
        if change != initial {
            return Some(change);
        }
    }
    None
}

pub fn get_selected_text() -> Option<String> {
    autoreleasepool(|_| {
        let pasteboard = NSPasteboard::generalPasteboard();
        let initial = pasteboard.changeCount();
        let saved = match snapshot(&pasteboard) {
            Ok(saved) => saved,
            Err(error) => {
                log::warn!("cannot protect pasteboard; selected-text capture skipped: {error}");
                return None;
            }
        };

        if let Err(error) =
            super::input::synthesize_key_combo(&["meta".to_string()], &["c".to_string()])
        {
            log::warn!("send Command-C for selected text failed: {error}");
            return None;
        }

        let copied = wait_for_change(
            initial,
            COPY_POLL_ATTEMPTS,
            || pasteboard.changeCount(),
            || std::thread::sleep(COPY_POLL_DELAY),
        )?;
        let selected = pasteboard
            .stringForType(unsafe { NSPasteboardTypeString })
            .map(|value| value.to_string())
            .filter(|value| !value.is_empty());

        if pasteboard.changeCount() == copied {
            if let Err(error) = restore(&pasteboard, saved) {
                log::error!("restore pasteboard after selected-text capture failed: {error}");
            }
        } else {
            log::warn!("pasteboard changed again during selected-text capture; restore skipped");
        }
        selected
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn change_poll_returns_first_new_count() {
        let values = [4, 4, 5, 6];
        let index = Cell::new(0_usize);
        let waits = Cell::new(0_usize);
        let changed = wait_for_change(
            4,
            values.len(),
            || {
                let current = index.get();
                index.set(current + 1);
                values[current]
            },
            || waits.set(waits.get() + 1),
        );
        assert_eq!(changed, Some(5));
        assert_eq!(waits.get(), 3);
    }
}
