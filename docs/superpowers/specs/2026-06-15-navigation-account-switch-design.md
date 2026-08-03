# Navigation And Account Switch Design

## Goal

Update the app shell so navigation takes less space, template-related views live under one Templates page, and the active AWS account can be switched from the top-left account summary.

## Design

- The sidebar gets a manual collapse toggle. Expanded mode keeps labels and descriptions; collapsed mode shows only icons with accessible labels/tooltips.
- Add a top-level `Templates` page. The page uses tabs to switch between `Application Config` and `Resource Templates`, with `Application Config` selected by default.
- The account summary card becomes clickable. It opens a dialog listing configured AWS accounts and lets the user switch the active account using the existing `useSetActiveAwsAccount` flow.
- Account switching keeps the existing behavior: account-scoped session state is reset and relevant React Query caches are invalidated.

## Components

- `AppShell` owns sidebar collapsed state, active page state, and the account switch dialog state.
- `TemplatesPage` owns the template tabs and renders `ApplicationConfigTemplatesPage` and the Resource Templates panel.
- Existing hooks in `useAwsSettings` are reused for account list and switching.

## Tests

- Update `AppShell` tests for collapsed icon-only navigation.
- Add coverage for opening the Templates page, switching tabs, and switching accounts from the account dialog.
