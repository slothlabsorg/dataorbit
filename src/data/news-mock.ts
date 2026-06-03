import type { NewsFeed } from '@/types/news'

// ── Mock / fallback feed ─────────────────────────────────────────────────────
// This data is shown when the remote feed is unreachable (no internet, dev
// mode, Playwright tests). It also acts as the reference for what a real
// feed payload looks like.
//
// Deploy the real feed at: https://slothlabs.org/news/feed.json
// Format must match the NewsFeed interface in src/types/news.ts

export const MOCK_FEED: NewsFeed = {
  version: 1,
  items: [
    {
      id: 'do-v110-release',
      type: 'changelog',
      priority: 10,
      publishedAt: '2026-05-15T00:00:00Z',
      badge: 'UPDATE',
      badgeTone: 'primary',
      title: 'DataOrbit v1.1.0',
      body: `## What's new\n\n- **SQLite support** — browse and query local SQLite databases with no server required\n- **Timescale time-bucket queries** — new query builder support for time_bucket() aggregations\n- **Table search** — quickly filter tables in the sidebar as your schema grows\n- **Export to CSV / JSON** — download query results directly from the Browse view\n- **Connection health indicator** — live status dot in the sidebar reflects real-time connectivity`,
      collapsed: false,
      action: { label: 'Full changelog', url: 'https://github.com/slothlabs/dataorbit/blob/main/CHANGELOG.md' },
      targetApps: ['dataorbit'],
    },
    {
      id: 'do-tip-query-optimization',
      type: 'tip',
      priority: 7,
      publishedAt: '2026-05-14T00:00:00Z',
      badge: 'TIP',
      badgeTone: 'success',
      title: 'Speed up DynamoDB queries with GSIs',
      body: `Scanning large DynamoDB tables is slow and expensive. Use **Global Secondary Indexes** to turn full-table scans into targeted key lookups.\n\nIn DataOrbit's query builder, open the **Index** dropdown to pick a GSI — the filter fields automatically update to match the index's partition and sort key.\n\nAlways prefer a GSI query over a Scan when you know the access pattern.`,
      targetApps: ['dataorbit'],
    },
    {
      id: 'do-mysql-postgres-support',
      type: 'announcement',
      priority: 6,
      publishedAt: '2026-05-13T00:00:00Z',
      badge: 'NEW',
      badgeTone: 'primary',
      title: 'MySQL and PostgreSQL support coming soon',
      body: `DataOrbit is expanding beyond NoSQL. MySQL and PostgreSQL connections are in active development and will ship in the next major release.\n\nThe same table browser, query builder, and stream viewer you use today will work seamlessly with relational databases — no context switching required.\n\nJoin the beta waitlist to get early access.`,
      action: { label: 'Join the beta', url: 'https://slothlabs.org/dataorbit/beta' },
      targetApps: ['dataorbit'],
    },
    {
      id: 'slothlabs-roadmap-2026',
      type: 'news',
      priority: 5,
      publishedAt: '2026-05-10T00:00:00Z',
      badge: 'NEW',
      badgeTone: 'neutral',
      title: 'SlothLabs 2026 roadmap',
      body: `We're building a suite of developer tools that make data access simpler and safer. DataOrbit is the database explorer — here's what's coming next:\n\n- **DataOrbit Pro** — team connections, shared query history, audit logs\n- **CloudOrbit integration** — launch DynamoDB sessions directly from your AWS profile\n- **Multi-cloud** — GCP Bigtable and Azure Cosmos DB support (preview)\n\nWe release fast and often. Star the repo to stay updated.`,
      collapsed: true,
      action: { label: 'Follow SlothLabs', url: 'https://github.com/slothlabs' },
      targetApps: ['all'],
    },
    {
      id: 'do-sponsor-placeholder',
      type: 'ad',
      priority: 3,
      publishedAt: '2026-05-01T00:00:00Z',
      badge: 'SPONSOR',
      badgeTone: 'neutral',
      title: 'Want to reach database engineers?',
      body: `DataOrbit is used by developers who work with DynamoDB, InfluxDB, Cassandra, and more every day. If your tool, service, or course targets data engineers, **your ad could appear here**.\n\nSponsored placements are clearly labeled and help fund development.`,
      sponsored: true,
      action: { label: 'Advertise with SlothLabs', url: 'https://slothlabs.org/advertise' },
      targetApps: ['all'],
    },
  ],
}
