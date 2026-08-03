# Account Switch Dialog Keyboard And Mouse Design

## Goal

Improve the Current Account switch dialog so users can activate another AWS account with double-click or a keyboard flow (`Cmd/Ctrl+E` to open and cycle selection, `Enter` to confirm), while `Esc` continues to dismiss without switching.

## Decisions

- Highlight starts on the currently active account when the dialog opens (or the first account if none is active).
- A subsequent `Cmd/Ctrl+E` while the dialog is open moves the highlight down one row and wraps to the first row after the last.
- Single-click only updates the highlight; activation still requires double-click, `Enter`, or the existing Use button.
- Implementation stays inside `AppShell` with local selection state (no new dialog component).

## Behavior

| Action | Result |
|--------|--------|
| Open dialog (click Current Account or `Cmd/Ctrl+E`) | Select active account (else first); dialog opens |
| `Cmd/Ctrl+E` while dialog is open | Move selection to the next account; wrap at end |
| Single-click a row | Update selection only |
| Double-click a row | Activate that account and close (no-op mutate if already active; may still close) |
| `Enter` while dialog is open | Activate the selected account and close |
| `Esc` | Close dialog; do not switch accounts |
| Use button | Unchanged: activate and close |

Visual selection uses existing dialog/list tokens (for example accent background or ring) so the highlighted row is distinct from the Active badge.

## Implementation

### State

- Add `selectedAccountId: string | null` in `AppShell`.
- When the dialog opens, initialize selection to the active account id, otherwise the first account in the list.
- Clear or re-initialize selection when the dialog closes/reopens so the next open always starts from active.

### Keyboard handling

Extend the existing document-level `keydown` listener in `AppShell`:

- `isAccountSwitchKey`: if dialog closed → open; if open → advance selection (do not reopen).
- When dialog is open and the key is `Enter` (without conflicting modifiers that would mean something else): activate `selectedAccountId` via existing `useSetActiveAwsAccount` mutate path (same success toast / close / error toast as Use).
- Do not special-case `Esc`; rely on Dialog `onOpenChange` to close.

While the account dialog is open, page-navigation shortcuts remain suppressed (existing behavior).

### List UI

- Account rows become clickable containers:
  - `onClick` → set `selectedAccountId`
  - `onDoubleClick` → activate that account (reuse the same mutate helper as Use)
- Selected row gets a clear visual style.
- Use button behavior and disabled state for the active account stay as today.

### Optional copy

- Update the `ACCOUNT_SWITCH` shortcut description to mention: open, then `Cmd/Ctrl+E` cycles selection, `Enter` confirms.

## Tests

Extend `AppShell.test.tsx`:

1. Opening the dialog selects the active account.
2. `Meta+E` / `Ctrl+E` while open moves selection to the next account; wrapping from last to first.
3. `Enter` activates the selected non-active account and closes.
4. Single-click changes selection without calling `setActiveAccount`.
5. Double-click on a non-active account calls mutate and closes.
6. `Esc` closes without mutate.

## Out of scope

- Extracting a dedicated `AccountSwitchDialog` component.
- Arrow-key list navigation / full ARIA listbox roving tabindex.
- Changing account switching side effects (cache invalidation / session reset) beyond the existing mutate flow.
