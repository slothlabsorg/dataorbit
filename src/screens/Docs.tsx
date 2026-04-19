import { useState } from 'react'

// ── Code block helper ─────────────────────────────────────────────────────────

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-bg-surface border border-border-subtle rounded-lg p-3 text-[11px] font-mono text-text-secondary overflow-x-auto leading-relaxed whitespace-pre">
      {children}
    </pre>
  )
}

function InlineCode({ children }: { children: string }) {
  return <code className="font-mono text-primary bg-primary/8 px-1 py-0.5 rounded text-[11px]">{children}</code>
}

function Table({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-bg-elevated border-b border-border-subtle">
            <th className="text-left px-3 py-2 text-text-muted font-semibold w-28">Operator</th>
            <th className="text-left px-3 py-2 text-text-muted font-semibold">Where it goes</th>
            <th className="text-left px-3 py-2 text-text-muted font-semibold">Example</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([op, dest, ex], i) => (
            <tr key={i} className="border-b border-border-subtle last:border-b-0">
              <td className="px-3 py-1.5 font-mono text-primary">{op}</td>
              <td className="px-3 py-1.5 text-text-secondary">{dest}</td>
              <td className="px-3 py-1.5 font-mono text-text-muted text-[11px]">{ex}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function H4({ children }: { children: string }) {
  return <h4 className="text-text-primary font-semibold text-sm mb-2 mt-4 first:mt-0">{children}</h4>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-text-secondary text-xs leading-relaxed mb-2">{children}</p>
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 px-3 py-2 rounded-lg bg-primary/8 border border-primary/20 text-[11px] text-text-secondary">
      <span className="text-primary flex-shrink-0">💡</span>
      <span>{children}</span>
    </div>
  )
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 px-3 py-2 rounded-lg bg-warning/8 border border-warning/20 text-[11px] text-text-secondary">
      <span className="text-warning flex-shrink-0">⚠</span>
      <span>{children}</span>
    </div>
  )
}

// ── Section content ───────────────────────────────────────────────────────────

function SectionQuickStart() {
  return (
    <div className="space-y-3 text-text-secondary text-sm leading-relaxed">
      <P>DataOrbit is a DynamoDB-first desktop client. It gives you a visual query builder that is significantly more powerful than the AWS Console — range queries, content search, index queries, and cross-table joins out of the box.</P>
      <H4>First steps</H4>
      <ol className="list-decimal list-inside space-y-2 text-xs text-text-secondary">
        <li>Click <strong className="text-text-primary">+</strong> in the sidebar to add a connection.</li>
        <li>Choose DynamoDB, enter your AWS region and credentials (profile / access keys / ENV).</li>
        <li>Press <strong className="text-text-primary">Test connection</strong> — DataOrbit will list your tables.</li>
        <li>Click a table in the sidebar to start browsing data.</li>
        <li>Go to <strong className="text-text-primary">Explore → Query</strong> to build visual filter queries.</li>
        <li>Go to <strong className="text-text-primary">Explore → Cross-join</strong> to correlate data across tables.</li>
        <li>Enable <strong className="text-text-primary">Stream</strong> to tail live DynamoDB Streams changes.</li>
      </ol>
      <Tip>Use the <InlineCode>?mock=1</InlineCode> URL param in browser preview mode to load sample IoT sensor data and try all features without a real AWS connection.</Tip>
    </div>
  )
}

function SectionQueryEngine() {
  return (
    <div className="space-y-4">
      <P>The Explore → Query tab builds a <strong className="text-text-primary">KeyConditionExpression + FilterExpression</strong> pair automatically from your filter chips. Understanding when each is used helps you control cost.</P>

      <H4>All 12 operators</H4>
      <Table rows={[
        ['=',            'KeyCondition (pk or sk)  /  FilterExpression',  'deviceId = "sensor-4421"'],
        ['!=',           'FilterExpression only  (→ <> in DynamoDB)',      'status != "OK"'],
        ['<  <=  >  >=', 'KeyCondition if on sort key  /  Filter otherwise','timestamp >= 1710330000000'],
        ['begins_with',  'KeyCondition if on sort key  /  Filter otherwise','firmware begins_with "v2"'],
        ['contains',     'FilterExpression only',                           'tags contains "prod"'],
        ['exists',       'FilterExpression only',                           'errorCode exists'],
        ['not_exists',   'FilterExpression only',                           'deletedAt not_exists'],
        ['between',      'KeyCondition if on sort key  /  Filter otherwise','timestamp between 1710330000000 → 1710340000000'],
        ['in',           'FilterExpression only  (expands to list)',        'status in "OK,WARN,CRIT"'],
      ]} />

      <H4>Query vs Scan — how DataOrbit decides</H4>
      <P>DataOrbit automatically chooses the most efficient DynamoDB API call based on your filter chips:</P>
      <Code>{`Chips include  pk = "value"           →  Query  (KeyConditionExpression, low RCU)
Chips include  pk = "v" + sk range    →  Query  (pk + sort key condition, very low RCU)
No pk = filter, but index selected    →  IndexQuery  (uses GSI/LSI pk)
No pk = filter at all                 →  Scan  (⚠ reads entire table)`}</Code>

      <H4>Range queries on sort key (time-range example)</H4>
      <P>This is the most common IoT pattern — fetch all messages from a device within a time window. Because both <InlineCode>deviceId =</InlineCode> and <InlineCode>timestamp between</InlineCode> go to KeyConditionExpression, it's a single efficient Query:</P>
      <Code>{`Field: deviceId   Op: =        Value: sensor-4421
Field: timestamp  Op: between  Value: 1710330000000  End: 1710340000000

→ KeyConditionExpression: deviceId = :pk AND timestamp BETWEEN :v0 AND :v1
→ OpMode: Query  ·  ~0.5 RCU  ·  no table scan`}</Code>

      <H4>begins_with on sort key (key-prefix query)</H4>
      <P>Useful when your sort key is a path, ISO date prefix, or versioned string:</P>
      <Code>{`Field: deviceId   Op: =            Value: sensor-4421
Field: timestamp  Op: begins_with  Value: 17103

→ KeyConditionExpression: deviceId = :pk AND begins_with(timestamp, :v0)
→ OpMode: Query  ·  efficient  ·  no scan`}</Code>

      <H4>Content search with contains</H4>
      <P><InlineCode>contains</InlineCode> always goes to FilterExpression — it cannot be a key condition. DataOrbit warns you when this triggers a Scan and shows the real RCU consumed:</P>
      <Code>{`Field: firmware  Op: contains  Value: v2

→ FilterExpression: contains(firmware, :v0)
→ OpMode: Scan  ·  reads all items  ·  ⚠ high RCU
   Combine with pk = "..." to limit the scan to one partition.`}</Code>

      <H4>Index queries (GSI / LSI)</H4>
      <P>If your table has a <strong className="text-text-primary">Status-index</strong> (GSI with pk = <InlineCode>status</InlineCode>), you can query all WARN items efficiently without scanning:</P>
      <Code>{`Select index: Status-index  (pk: status, sk: timestamp)
Field: status     Op: =        Value: WARN
Field: timestamp  Op: >=       Value: 1710330000000

→ IndexQuery on Status-index
→ KeyConditionExpression: status = :pk AND timestamp >= :v0
→ Much cheaper than scanning DeviceMessages for all WARN entries`}</Code>

      <H4>Multiple chips — AND logic</H4>
      <P>All filter chips are joined with <InlineCode>AND</InlineCode>. Key conditions go to <InlineCode>KeyConditionExpression</InlineCode>, the rest to <InlineCode>FilterExpression</InlineCode>:</P>
      <Code>{`Field: deviceId   Op: =        Value: sensor-4421   → KeyCondition
Field: timestamp  Op: between  Value: 17103… → 17104…  → KeyCondition
Field: battery    Op: <=       Value: 20               → FilterExpression
Field: status     Op: !=       Value: OK               → FilterExpression

→ Query, then filter in memory: battery <= 20 AND status <> "OK"
→ Low RCU (only one partition read), then cheap in-memory filter`}</Code>

      <Tip>Putting the partition key filter first, then the sort key range, then attribute filters is the most cost-efficient pattern for DynamoDB.</Tip>
    </div>
  )
}

function SectionCrossJoin() {
  return (
    <div className="space-y-4">
      <P>The <strong className="text-text-primary">Explore → Cross-join</strong> tab lets you correlate data across two tables from the same connection — like SQL JOINs, but executed client-side after fetching from DynamoDB. This is one of DataOrbit's most powerful debugging features.</P>

      <Warn>Cross-table joins scan both tables (or apply your pre-filters first) and merge the results in memory. They are intended for debugging and exploration, not production-scale batch operations. Keep your pre-filters tight to control RCU cost.</Warn>

      <H4>INNER JOIN — rows present in both tables</H4>
      <P>Only returns rows where the join key exists in both tables. The most common use: enrich message data with registry metadata.</P>
      <Code>{`Left:  DeviceMessages  joinKey: deviceId
Right: DeviceRegistry  joinKey: deviceId
Type:  INNER

Result: only devices that appear in both tables
Columns: deviceId | timestamp | temp | status | ... | model | location | owner

Use case: enrich sensor readings with device metadata for reporting`}</Code>

      <H4>LEFT JOIN — all left rows + nullable right</H4>
      <P>All rows from the left table. Right-side columns are <InlineCode>—</InlineCode> when no match is found.</P>
      <Code>{`Left:  DeviceMessages  joinKey: deviceId
Right: DeviceRegistry  joinKey: deviceId
Type:  LEFT

Result: all messages; registry columns are — for unregistered devices
Rows tagged: MATCH (registered) or LEFT (unregistered)

Use case: full audit — see which messages came from unregistered hardware`}</Code>

      <H4>LEFT ANTI ★ — entries in left with NO match in right</H4>
      <P>This is the most powerful debug tool. It finds rows in the left table that have <strong className="text-text-primary">no corresponding entry in the right table</strong> — perfect for catching missing entries created by another service.</P>
      <Code>{`Left:  DeviceMessages  joinKey: deviceId
Right: DeviceRegistry  joinKey: deviceId
Type:  LEFT ANTI

Result: only sensor-0012, sensor-3300, sensor-9900
These sensors are sending messages but were NEVER registered.

Real-world scenario:
  Service A  creates entries in DeviceMessages on every IoT event
  Service B  should register devices in DeviceRegistry on first-seen
  Bug: Service B has a bug and failed to register some devices

LEFT ANTI on deviceId instantly reveals the missing registrations.`}</Code>

      <H4>RIGHT ANTI — entries in right with NO match in left</H4>
      <P>The mirror: rows in the right table that have no match in left. Find registered devices that have gone silent.</P>
      <Code>{`Left:  DeviceMessages  joinKey: deviceId
Right: DeviceRegistry  joinKey: deviceId
Type:  RIGHT ANTI

Result: sensor-7700, sensor-2200
These devices are registered but have sent ZERO messages.

Use case: detect decommissioned devices still in registry,
or sensors that stopped reporting (hardware failure, power loss)`}</Code>

      <H4>RIGHT JOIN — all right rows + nullable left</H4>
      <P>All rows from the right table. Left-side columns are <InlineCode>—</InlineCode> when no match is found.</P>
      <Code>{`Left:  DeviceMessages  joinKey: deviceId
Right: DeviceRegistry  joinKey: deviceId
Type:  RIGHT

Result: all registry entries; message columns are — for silent devices
Rows tagged: MATCH (active) or RIGHT (silent/new)

Use case: full registry audit with activity status`}</Code>

      <H4>Interpreting results</H4>
      <P>The <InlineCode>side</InlineCode> column in results uses three badges:</P>
      <Code>{`MATCH  — row has data from both tables (purple badge)
LEFT   — row only exists in the left table (yellow badge)
RIGHT  — row only exists in the right table (violet badge)`}</Code>

      <Tip>For debugging missing cross-service entries: always start with LEFT ANTI. If Service A creates in table X and Service B creates in table Y based on the same ID, LEFT ANTI on that ID shows you every entry Service B missed.</Tip>
    </div>
  )
}

function SectionDynamoConcepts() {
  return (
    <div className="space-y-4">
      <H4>Query vs Scan</H4>
      <P>A <InlineCode>Query</InlineCode> uses the partition key to fetch a single partition — fast and cheap. A <InlineCode>Scan</InlineCode> reads every item in the table before filtering — expensive at scale. DataOrbit shows a warning banner and the actual RCU consumed after every query.</P>

      <H4>KeyConditionExpression vs FilterExpression</H4>
      <Code>{`KeyConditionExpression  — evaluated by DynamoDB at read time
  Only pk (=) and sk (=, <, <=, >, >=, begins_with, between)
  Items that don't match are never read → very low RCU

FilterExpression  — evaluated AFTER items are read
  Any attribute, any operator (=, !=, contains, exists, in, …)
  Items ARE read first, THEN filtered → RCU is for ALL scanned items`}</Code>

      <H4>RCU — Read Capacity Units</H4>
      <P>Each 4 KB of data read costs 1 RCU (strongly consistent) or 0.5 RCU (eventually consistent). DataOrbit shows the consumed RCU after each query. The <span className="text-warning font-mono">⚡ RCU</span> badge turns yellow above 20 and red above 100.</P>

      <H4>GSI — Global Secondary Index</H4>
      <P>A GSI lets you query on any non-key attribute. It has its own partition key and optional sort key, independent of the table's keys. DataOrbit shows all GSIs in the table metadata bar and lets you select them in the query builder.</P>

      <H4>LSI — Local Secondary Index</H4>
      <P>An LSI shares the table's partition key but uses a different sort key. Only available at table creation time. LSIs let you sort the same partition by multiple attributes.</P>

      <H4>DynamoDB Streams</H4>
      <P>When Streams is enabled on a table, every INSERT, MODIFY, and REMOVE is written to a time-ordered change log. DataOrbit's Stream tab tails this log in real-time, shows event types with color-coded badges, and displays field-level diffs on MODIFY events.</P>

      <H4>DynamoDB Local</H4>
      <P>DataOrbit supports DynamoDB Local by setting a custom endpoint in the connection wizard (e.g. <InlineCode>http://localhost:8000</InlineCode>). Use access key <InlineCode>local</InlineCode> and secret <InlineCode>local</InlineCode> for local connections.</P>
    </div>
  )
}

function SectionRoadmap() {
  return (
    <div className="space-y-4">
      <P>These are planned additions to the query engine for <strong className="text-text-primary">v0.2.0</strong> — before multi-database support lands in v0.3+. The goal is to make DataOrbit the best DynamoDB developer tool available.</P>

      <H4>Pagination support</H4>
      <P>Automatically follow <InlineCode>lastEvaluatedKey</InlineCode> with a "Load more" button and a paginator showing current page position. Pin the pagination cursor to resume a query across sessions.</P>

      <H4>Sort direction toggle</H4>
      <P>A UI toggle for <InlineCode>ScanIndexForward: false</InlineCode> to reverse sort key order (newest-first) without editing chips. Critical for time-series tables where you almost always want the latest N items.</P>

      <H4>Composite key joins</H4>
      <P>Cross-join on multiple fields simultaneously (e.g. <InlineCode>deviceId + eventType</InlineCode>). The current join engine supports one key; v0.2 will support n-key maps for composite primary keys.</P>

      <H4>Cross-account / cross-connection joins</H4>
      <P>Join tables from two different AWS connections (e.g. prod vs staging, or two different accounts). Each side fetches independently and merges client-side.</P>

      <H4>Filter groups with AND / OR logic</H4>
      <P>Currently all chips use AND. v0.2 will add OR groups — a second chip row connected with OR. This maps to DynamoDB's <InlineCode>FilterExpression</InlineCode> OR operator, useful for multi-value status filters.</P>

      <H4>Time-range presets</H4>
      <P>Quick sort-key presets for timestamp columns: <InlineCode>Last 1h</InlineCode>, <InlineCode>Last 24h</InlineCode>, <InlineCode>Last 7d</InlineCode>, <InlineCode>Today</InlineCode>. Auto-converts to BETWEEN values using the current time.</P>

      <H4>Aggregate operations (client-side)</H4>
      <P>After fetching results: <InlineCode>COUNT</InlineCode>, <InlineCode>DISTINCT values</InlineCode>, <InlineCode>GROUP BY field</InlineCode> with counts, <InlineCode>MIN/MAX/AVG</InlineCode> on numeric fields. Executed in-memory on the fetched rows.</P>

      <H4>Clipboard IN values</H4>
      <P>Paste a newline- or comma-separated list of values directly into the <InlineCode>in</InlineCode> operator field. Useful for checking "which of these 50 device IDs exist in this table."</P>

      <H4>Query cost estimator</H4>
      <P>Before running, show an estimated RCU range based on the selected op mode (Query vs Scan) and the table's item count and average item size. Helps avoid expensive accidental scans on large tables.</P>

      <H4>Saved queries &amp; templates</H4>
      <P>Save named queries per table. DataOrbit auto-detects common patterns (single-pk lookup, time-range on sk, status filter) and offers them as one-click templates when you open a table.</P>

      <H4>Export to CSV / JSON</H4>
      <P>Export query results (including join results) to <InlineCode>.csv</InlineCode> or <InlineCode>.json</InlineCode>. Paginate automatically until all results are fetched before writing the file.</P>

      <H4>Regular expression filter (client-side)</H4>
      <P>An extra filter step applied in-memory after fetching: regex match on any string field. Useful for substring patterns that DynamoDB's <InlineCode>contains</InlineCode> can't express.</P>

      <Tip>These items are roughly prioritized. If you have a strong opinion on ordering, open an issue at github.com/slothlabs/dataorbit.</Tip>
    </div>
  )
}

function SectionCloudOrbit() {
  return (
    <div className="space-y-3 text-text-secondary text-sm leading-relaxed">
      <P>DataOrbit and <strong className="text-text-primary">CloudOrbit</strong> are sister apps. If you use CloudOrbit to manage AWS sessions, reference the same profile in DataOrbit — credentials are picked up automatically.</P>
      <ol className="list-decimal list-inside space-y-2 text-xs">
        <li>Open CloudOrbit and activate your session.</li>
        <li>In DataOrbit's Add Connection wizard, choose <strong className="text-text-primary">~/.aws profile</strong> auth.</li>
        <li>Enter the profile name CloudOrbit wrote (e.g. <InlineCode>default</InlineCode> or a named profile).</li>
        <li>DataOrbit reads the temporary credentials from <InlineCode>~/.aws/credentials</InlineCode> at query time.</li>
      </ol>
      <P>Credentials are never stored inside DataOrbit. When CloudOrbit refreshes a session, DataOrbit picks up the new credentials automatically on the next query.</P>
    </div>
  )
}

function SectionKeyboard() {
  const shortcuts: [string, string][] = [
    ['⌘ N',    'New connection wizard'],
    ['⌘ /',    'Focus filter builder (Explore)'],
    ['Enter',  'Run query / add filter chip'],
    ['⌘ R',    'Refresh current table'],
    ['⌘ E',    'Export results to JSON'],
    ['⌘ \\',   'Toggle sidebar'],
    ['Escape', 'Close panel / deselect row / clear chips'],
  ]
  return (
    <div className="space-y-2">
      {shortcuts.map(([key, desc]) => (
        <div key={key} className="flex items-center gap-3">
          <kbd className="px-2 py-0.5 rounded border border-border bg-bg-surface2 text-[11px] font-mono text-text-secondary flex-shrink-0 min-w-[60px] text-center">{key}</kbd>
          <span className="text-text-muted text-xs">{desc}</span>
        </div>
      ))}
    </div>
  )
}

// ── Section registry ──────────────────────────────────────────────────────────

interface DocSection {
  id: string
  title: string
  content: React.ReactNode
}

const SECTIONS: DocSection[] = [
  { id: 'quickstart',  title: 'Quick start',            content: <SectionQuickStart /> },
  { id: 'query',       title: 'Query engine',           content: <SectionQueryEngine /> },
  { id: 'joins',       title: 'Cross-table joins',      content: <SectionCrossJoin /> },
  { id: 'concepts',    title: 'DynamoDB concepts',      content: <SectionDynamoConcepts /> },
  { id: 'roadmap',     title: 'v0.2.0 — query roadmap', content: <SectionRoadmap /> },
  { id: 'cloudorbit',  title: 'CloudOrbit integration', content: <SectionCloudOrbit /> },
  { id: 'keyboard',    title: 'Keyboard shortcuts',     content: <SectionKeyboard /> },
]

// ── Layout ────────────────────────────────────────────────────────────────────

export function Docs() {
  const [active, setActive] = useState(SECTIONS[0].id)
  const section = SECTIONS.find(s => s.id === active)!

  return (
    <div className="flex h-full overflow-hidden">
      {/* TOC */}
      <div className="w-48 flex-shrink-0 border-r border-border bg-bg-elevated py-4 overflow-y-auto">
        <p className="px-4 text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Contents</p>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            className={`w-full text-left px-4 py-2 text-xs transition-colors ${
              active === s.id
                ? 'text-primary bg-primary/8 font-medium border-r-2 border-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface'
            }`}
          >
            {s.title}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
        <h2 className="text-text-primary font-display font-bold text-base mb-5">{section.title}</h2>
        {section.content}
      </div>
    </div>
  )
}

export default Docs
