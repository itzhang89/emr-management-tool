# CLI Profile Import Completeness Design

Date: 2026-08-03

## Goal

Import AWS CLI profiles without inventing a default region, and require user confirmation when the account name conflicts or region is missing.

## Behavior

| Condition | Action |
|-----------|--------|
| Profile has region **and** name is not taken by Configured Accounts | Silent `import_aws_cli_profile` with explicit `region` |
| Missing region **or** duplicate name | Load profile credentials → open Add Account dialog (prefilled) → user edits → `create_aws_account` |

Dialog shows Access Key / Secret (prefilled from CLI), name, and region. Amber notice explains why confirmation is needed.

## Backend

- Stop defaulting missing CLI region to `us-east-1`
- `ImportAwsCliProfileRequest.region` optional; import fails if neither request nor profile provides region
- `load_aws_cli_profile` returns credentials for form prefilling

## Out of scope

- Changing how unsupported (non-static) profiles are listed
