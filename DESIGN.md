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
- Log viewing should be accessible within 2 clicks — which is why the log
  viewer is a tab of Job History rather than a page of its own: opening the
  second job's logs costs one click, not a round trip through the sidebar.

# Navigation Priority

High Frequency:

- Submit Job
- Job History (its log tabs are where "View Logs" happens)

Medium Frequency:

- S3 Browser
- Data Catalog
- AI Assistant

Low Frequency:

- Templates
- Virtual Clusters
- Dashboard
- Settings