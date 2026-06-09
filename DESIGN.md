# Design Philosophy

The application is designed for Data Engineers.

Most users perform only 3 operations:

1. Submit Job
2. View Job Status
3. View Logs

Therefore:

- Job submission should be the primary workflow.
- Cluster management is secondary.
- Template reuse is critical.
- Log viewing should be accessible within 2 clicks.

# Navigation Priority

High Frequency:

- Submit Job
- Job History
- Logs

Medium Frequency:

- Templates

Low Frequency:

- Virtual Clusters
- Settings