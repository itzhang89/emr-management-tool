//! Serializes the native file dialogs.
//!
//! `rfd`'s macOS backend asks AppKit for a fresh `NSOpenPanel`/`NSSavePanel`.
//! AppKit returns `nil` when it cannot create the panel — most commonly because
//! another modal panel is already on screen — and `rfd`/`objc2` model that `nil`
//! as impossible, so it panics. The panic crosses an FFI boundary, which turns
//! it into `abort()` and takes the whole app down (see the 2026-11-18 crash:
//! `NSOpenPanel::openPanel` → `none_fail` → `SIGABRT`).
//!
//! One dialog on screen at a time is enough for every flow in the app, so
//! concurrent requests are dropped rather than allowed to reach AppKit.

use std::sync::atomic::{AtomicBool, Ordering};

static DIALOG_OPEN: AtomicBool = AtomicBool::new(false);

/// Holds the single dialog slot for as long as a native dialog is on screen.
/// Dropping it releases the slot for the next request.
pub(crate) struct DialogSlot(());

impl DialogSlot {
    /// Returns `None` when another native dialog is already open. Callers treat
    /// that exactly like the user cancelling, so a double-click on "Browse" or
    /// "Save" cannot race two panels into AppKit.
    pub(crate) fn try_acquire() -> Option<Self> {
        DIALOG_OPEN
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(()))
    }
}

impl Drop for DialogSlot {
    fn drop(&mut self) {
        DIALOG_OPEN.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::DialogSlot;

    #[test]
    fn allows_only_one_dialog_at_a_time() {
        let first = DialogSlot::try_acquire();
        assert!(first.is_some());
        assert!(DialogSlot::try_acquire().is_none());

        drop(first);
        assert!(DialogSlot::try_acquire().is_some());
    }
}
