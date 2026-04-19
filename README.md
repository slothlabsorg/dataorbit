# DataOrbit

**Database management client for teams.** Built for DynamoDB-first workflows, with support for more databases coming soon.

Part of the [SlothLabs](https://slothlabs.org) family — alongside [CloudOrbit](../aws-switch-tauri), your AWS credential manager, and [BastionOrbit](../bastionorbit), your SSH tunnel manager.

---

## Features (v0.2.0)

| Feature | Status |
|---|---|
| DynamoDB — browse tables & items | ✅ |
| DynamoDB — visual filter/query builder (12 operators) | ✅ |
| DynamoDB — client-side filtering (exact results, no scan waste) | ✅ |
| Scan confirmation — large table protection (confirms before >100K item scans) | ✅ |
| Field autocomplete from table schema (known attributes shown in filter builder) | ✅ |
| Hierarchical / composite key support (`begins_with` on `country::zone::id` patterns) | ✅ |
| DynamoDB — live Streams tail | ✅ |
| Cross-table joins (INNER / LEFT / LEFT ANTI ★ / RIGHT / RIGHT ANTI) | ✅ |
| **Time Trace — cross-table event timeline** ★ | ✅ |
| Index recommendations — GSI suggestions after inefficient scans | ✅ |
| Pagination — Load more with remaining count | ✅ |
| Sort direction toggle (ASC / DESC) | ✅ |
| Time-range presets (Last 1h / 6h / 24h / 7d) for timestamp keys | ✅ |
| Pre-run cost estimator (Query/Scan mode + estimated RCU) | ✅ |
| Query history | ✅ |
| Multiple connections | ✅ |
| AWS profile / access keys / ENV auth | ✅ |
| DynamoDB Local support (with large-scale seed for perf testing) | ✅ |
| InfluxDB, TimescaleDB, Cassandra, ScyllaDB | 🚧 Coming soon |

---

## ★ Time Trace — cross-table event timeline

> **The problem every DynamoDB team hits:** when a battery-critical alert fires on a sensor,
> it's supposed to write to four tables — `DeviceMessages`, `SensorAlerts`, `DeviceRegistry`,
> and `NotificationHistory`. Did all four writes succeed?
> With standard DynamoDB tools you open each table separately, copy-paste the entity ID, and pray.
> That takes 10–15 minutes and still leaves room for human error.

**Time Trace automates this.** Give it a field and value — `deviceId = sensor-0012` — and it
searches every table in your connection simultaneously. It collects every matching record,
resolves each one's timestamp, and renders a chronological timeline showing exactly where and
when the entity appeared in your system.

The critical insight is what's **missing**: tables where the entity was expected but not found
are called out in a warning panel — *"Entity not found in `SensorAlerts`, `DeviceRegistry`
— possible propagation failure"* — pointing directly to the dropped write.

### What no other tool does today

| Tool | Single table | Cross-table search | Chronological timeline | Missing-table detection |
|------|:-----------:|:------------------:|:---------------------:|:----------------------:|
| AWS Console | ✅ | ❌ | ❌ | ❌ |
| NoSQL Workbench | ✅ | ❌ | ❌ | ❌ |
| DynamoDB Streams viewer | ✅ (one table) | ❌ | ✅ (sort of) | ❌ |
| **DataOrbit Time Trace** | ✅ | **✅** | **✅** | **✅** |

### Real-world scenarios

**1. Sensor battery event — did AlertService write the alert?**
```
Field: deviceId = sensor-0012
```
→ Timeline shows the WARN reading in `DeviceMessages` (2h ago), location in `DeviceLocations`,
but **sensor-0012 is missing from `SensorAlerts` and `DeviceRegistry`** — the alert pipeline
silently dropped the message.

**2. Payment failure — trace a transaction across microservices**
```
Field: correlationId = corr-8f3a2b
```
→ Reveals the order was created in `Orders` (+0ms), validated in `Inventory` (+120ms),
but `Payments` shows no record — the payment service never received the event.

**3. User signup flow — which step failed?**
```
Field: userId = user-00042
```
→ Shows the `UserProfiles` record was created, but `WelcomeEmails` and `OnboardingTasks`
tables have no matching entry — the downstream fanout failed.

**4. Latency measurement — how long between order → shipment?**
```
Field: orderId = ORD-2024-98712
```
→ Timeline shows `Orders` (t=0), `PickingQueue` (+1.2s), `PackedItems` (+4m 32s),
`ShippingLabels` (+4m 35s), `Notifications` (+4m 38s) — end-to-end latency visible at a glance.

### Operators

| Operator | Use case |
|----------|---------|
| `= exact` | Efficient — routes to a Query if the field is the table's partition key |
| `begins_with` | Composite keys: `locationKey begins_with US::northeast::` |
| `contains (any)` | Full-row search: finds the value in **any** string field, across tables with different field names |

---

## Screenshots

> Coming soon.

---

## Installation

### macOS (Homebrew)

```bash
brew install slothlabs/tap/dataorbit
```

### Download

Grab the latest `.dmg` / `.exe` / `.AppImage` from the [Releases](https://github.com/slothlabs/dataorbit/releases) page.

---

## CloudOrbit integration

DataOrbit and CloudOrbit are designed to work together. If you use CloudOrbit to manage AWS sessions, reference the same `~/.aws` profile in DataOrbit — it will pick up the temporary credentials automatically, no copy-pasting needed.

---

## Development

See [DEV_SETUP.md](./DEV_SETUP.md) for full setup instructions.

Quick start:

```bash
npm install
npm run tauri dev
```

---

## Roadmap

### v0.3 — Query engine enhancements (DynamoDB)
> Deepen the DynamoDB advantage before adding new database types.

- Time Trace: OR conditions, pattern matching, exportable timeline
- Composite key joins (cross-table on multiple fields)
- Cross-account / cross-connection joins
- Filter groups with AND / OR logic
- Client-side aggregates: COUNT, DISTINCT, GROUP BY, MIN/MAX/AVG
- Clipboard paste for `in` operator (newline- or comma-separated IDs)
- Saved queries & per-table templates
- Export results to CSV / JSON (with auto-pagination)
- Regular expression post-filter (client-side)
- Session-resumable pagination cursor

### v0.3 — Multi-database
- InfluxDB support (connect, browse measurements, run Flux queries)
- TimescaleDB (PostgreSQL-based time series)
- Cassandra / ScyllaDB support

### v0.4 — Advanced
- Schema visualization (ERD-style view)
- DynamoDB item editor (insert / update / delete)
- Query editor with autocomplete
- Multi-region stream viewer

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

MIT © SlothLabs
