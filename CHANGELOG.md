# Changelog

## v1.0.0 — 2026-05-12

First stable release.

### What's included

**Query engine**
- Visual query builder with 12 filter operators (=, !=, <, <=, >, >=, begins_with, contains, exists, not_exists, between, in)
- Automatic Query vs Scan detection — uses KeyConditionExpression when a partition key is present
- Sort key range queries (BETWEEN, begins_with, <, <=, >, >=) in KeyConditionExpression
- Sort direction toggle (ASC / DESC via ScanIndexForward)
- GSI and LSI index queries
- Pagination with Load more
- Time-range presets for timestamp sort keys (Last 1h, Last 24h, Last 7d)
- Query cost estimator with RCU display and Scan warning
- Composite key prefix support via begins_with (e.g. US::zone::sensorId)

**Cross-table joins**
- INNER, LEFT, LEFT ANTI, RIGHT, RIGHT ANTI join types
- Client-side merge after fetching both tables
- Pre-filters on each side to control RCU cost

**Connections**
- DynamoDB support with AWS Profile, Access Keys, or ENV var auth
- Custom endpoint for DynamoDB Local
- native-tls HTTP client — reads OS/Keychain trust store (Zscaler / corporate CA compatible)
- Persistent connection store

**App**
- Orbit dashboard — stats, connection cards, quick-access tables, support links
- Query history
- DynamoDB Streams viewer
- In-app updater
- Linux & Windows: custom titlebar with native window controls
- macOS: overlay titlebar with traffic lights
