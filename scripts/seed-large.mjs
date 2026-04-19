#!/usr/bin/env node
/**
 * Seed DynamoDB Local with large-scale realistic data for performance testing.
 *
 * Usage:
 *   npm run db:seed:large
 *
 * Requires DynamoDB Local running on port 8000:
 *   npm run db:start
 *
 * Tables created:
 *   EventLog       — 200 000 rows  (PK: serviceId, SK: eventId)
 *                    GSI: Level-index (level, createdAt)
 *                    ⚠ No GSI on userId, correlationId, region → scan scenarios
 *
 *   Transactions   — 100 000 rows  (PK: accountId, SK: txId)
 *                    GSI: Status-CreatedAt-index (status, createdAt)
 *                    ⚠ No GSI on merchantCategory, country → scan scenarios
 *
 *   UserProfiles   —  25 000 rows  (PK: userId, no SK)
 *                    GSI: Plan-index (plan, signupAt)
 *                    ⚠ No GSI on country, referralSource → scan scenarios
 *
 * Total: ~325 000 items
 * Seed time: ~60-90 s (parallel batch writes, 20 concurrent)
 */

import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

// ── Client ────────────────────────────────────────────────────────────────────

const client = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:8000',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function pick(arr)     { return arr[Math.floor(Math.random() * arr.length)] }
function pad(n, len)   { return String(n).padStart(len, '0') }

async function tableExists(name) {
  try {
    await client.send(new DescribeTableCommand({ TableName: name }))
    return true
  } catch {
    return false
  }
}

async function dropTable(name) {
  if (await tableExists(name)) {
    process.stdout.write(`  Dropping ${name}...`)
    await client.send(new DeleteTableCommand({ TableName: name }))
    for (let i = 0; i < 30; i++) {
      if (!(await tableExists(name))) break
      await new Promise(r => setTimeout(r, 500))
    }
    console.log(' done')
  }
}

async function waitReady(name) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await client.send(new DescribeTableCommand({ TableName: name }))
      if (r.Table?.TableStatus === 'ACTIVE') return
    } catch {}
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`Table ${name} never became ACTIVE`)
}

/**
 * Write items in parallel batches of 25 (DynamoDB limit), 20 concurrent.
 * Shows a live progress counter.
 */
async function batchWriteParallel(tableName, items, concurrency = 20) {
  const BATCH = 25
  const batches = []
  for (let i = 0; i < items.length; i += BATCH) {
    batches.push(items.slice(i, i + BATCH))
  }

  let written = 0
  const total = items.length

  for (let i = 0; i < batches.length; i += concurrency) {
    const chunk = batches.slice(i, i + concurrency)
    await Promise.all(
      chunk.map(batch =>
        client.send(new BatchWriteItemCommand({
          RequestItems: {
            [tableName]: batch.map(item => ({
              PutRequest: { Item: marshall(item, { removeUndefinedValues: true }) },
            })),
          },
        }))
      )
    )
    written += chunk.reduce((s, b) => s + b.length, 0)
    process.stdout.write(
      `\r  ${tableName}: ${written.toLocaleString().padStart(7)} / ${total.toLocaleString()} items`
    )
  }
  console.log()
}

// ── Table schemas ─────────────────────────────────────────────────────────────

const SCHEMA_EVENT_LOG = {
  TableName: 'EventLog',
  KeySchema: [
    { AttributeName: 'serviceId', KeyType: 'HASH'  },
    { AttributeName: 'eventId',   KeyType: 'RANGE' },
  ],
  AttributeDefinitions: [
    { AttributeName: 'serviceId',  AttributeType: 'S' },
    { AttributeName: 'eventId',    AttributeType: 'S' },
    { AttributeName: 'level',      AttributeType: 'S' },
    { AttributeName: 'createdAt',  AttributeType: 'S' },
  ],
  BillingMode: 'PAY_PER_REQUEST',
  GlobalSecondaryIndexes: [
    {
      IndexName: 'Level-index',
      KeySchema: [
        { AttributeName: 'level',     KeyType: 'HASH'  },
        { AttributeName: 'createdAt', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
  ],
  // Note: userId is NOT indexed — this is intentional for the scan/recommendation demo
}

const SCHEMA_TRANSACTIONS = {
  TableName: 'Transactions',
  KeySchema: [
    { AttributeName: 'accountId', KeyType: 'HASH'  },
    { AttributeName: 'txId',      KeyType: 'RANGE' },
  ],
  AttributeDefinitions: [
    { AttributeName: 'accountId', AttributeType: 'S' },
    { AttributeName: 'txId',      AttributeType: 'S' },
    { AttributeName: 'status',    AttributeType: 'S' },
    { AttributeName: 'createdAt', AttributeType: 'S' },
  ],
  BillingMode: 'PAY_PER_REQUEST',
  GlobalSecondaryIndexes: [
    {
      IndexName: 'Status-CreatedAt-index',
      KeySchema: [
        { AttributeName: 'status',    KeyType: 'HASH'  },
        { AttributeName: 'createdAt', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
  ],
  // Note: merchantCategory and country are NOT indexed — intentional for scan demo
}

const SCHEMA_USER_PROFILES = {
  TableName: 'UserProfiles',
  KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
  AttributeDefinitions: [
    { AttributeName: 'userId',   AttributeType: 'S' },
    { AttributeName: 'plan',     AttributeType: 'S' },
    { AttributeName: 'signupAt', AttributeType: 'S' },
  ],
  BillingMode: 'PAY_PER_REQUEST',
  GlobalSecondaryIndexes: [
    {
      IndexName: 'Plan-index',
      KeySchema: [
        { AttributeName: 'plan',     KeyType: 'HASH'  },
        { AttributeName: 'signupAt', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
  ],
  // Note: country and referralSource are NOT indexed — intentional for scan demo
}

// ── EventLog generators ───────────────────────────────────────────────────────

const SERVICES = [
  'auth-service', 'payment-service', 'notification-service', 'inventory-service',
  'shipping-service', 'user-service', 'search-service', 'analytics-service',
]

// Weighted levels: DEBUG 40%, INFO 40%, WARN 15%, ERROR 4%, FATAL 1%
const LEVELS_WEIGHTED = [
  ...Array(40).fill('DEBUG'),
  ...Array(40).fill('INFO'),
  ...Array(15).fill('WARN'),
  ...Array(4).fill('ERROR'),
  ...Array(1).fill('FATAL'),
]

const REGIONS_WEIGHTED = [
  ...Array(5).fill('us-east-1'),
  ...Array(3).fill('eu-west-1'),
  ...Array(2).fill('ap-southeast-1'),
]

const ENVIRONMENTS = ['production', 'production', 'production', 'staging', 'staging', 'dev']

const HTTP_METHODS = ['GET', 'GET', 'GET', 'POST', 'POST', 'PUT', 'DELETE', 'PATCH']

const STATUS_CODES = [200, 200, 200, 200, 201, 201, 400, 401, 403, 404, 404, 500, 503]

// 1 000 users — user-0001 … user-1000
const USERS = Array.from({ length: 1000 }, (_, i) => `user-${pad(i + 1, 4)}`)

const LOG_MESSAGES = {
  DEBUG: [
    'Cache miss for key %s', 'DB query executed in %dms', 'Token validated for user %s',
    'Processing request %s', 'Queue depth: %d', 'Config reloaded',
  ],
  INFO: [
    'Request handled successfully', 'User authenticated', 'Order %s created',
    'Payment processed: $%d', 'Notification sent', 'Session started',
  ],
  WARN: [
    'Slow query detected (%dms)', 'Rate limit at 80%% for user %s',
    'Retry attempt %d/3', 'Cache eviction triggered', 'High memory usage: %d%%',
    'Deprecated API called',
  ],
  ERROR: [
    'Database connection failed: %s', 'Payment declined for order %s',
    'Auth token expired for user %s', 'Service unavailable: %s', 'Timeout after %dms',
  ],
  FATAL: [
    'Out of memory — OOM killer invoked', 'Critical DB failure: %s',
    'Service crash — core dumped', 'Disk full on %s',
  ],
}

function logMessage(level) {
  const tpl = pick(LOG_MESSAGES[level])
  return tpl
    .replace('%s', Math.random().toString(36).slice(2, 9))
    .replace('%d', rnd(1, 9999))
    .replace('%%', '%')
}

/**
 * Generate a chunk of EventLog items from globalIndex `from` to `to`.
 * Uses `from`/`to` to assign deterministic serviceId and unique SK suffix.
 */
function generateEventLogChunk(from, to) {
  const now = Date.now()
  const ninetyDays = 90 * 24 * 60 * 60 * 1000
  const items = []

  for (let i = from; i < to; i++) {
    const service = SERVICES[i % SERVICES.length]
    const ts      = now - rnd(0, ninetyDays)
    const level   = pick(LEVELS_WEIGHTED)
    items.push({
      serviceId:     service,
      eventId:       `${ts}_${pad(i, 9)}`,  // sortable: timestamp prefix + unique index
      level,
      message:       logMessage(level),
      userId:        pick(USERS),
      correlationId: `corr-${Math.random().toString(36).slice(2, 11)}`,
      region:        pick(REGIONS_WEIGHTED),
      durationMs:    rnd(1, 5000),
      statusCode:    pick(STATUS_CODES),
      httpMethod:    pick(HTTP_METHODS),
      createdAt:     new Date(ts).toISOString(),
      environment:   pick(ENVIRONMENTS),
    })
  }
  return items
}

// ── Transactions generators ───────────────────────────────────────────────────

// 1 000 accounts
const ACCOUNTS = Array.from({ length: 1000 }, (_, i) => `acc-${pad(i + 1, 4)}`)

// Status: COMPLETED 80%, PENDING 15%, FAILED 5%
const TX_STATUSES = [
  ...Array(80).fill('COMPLETED'),
  ...Array(15).fill('PENDING'),
  ...Array(5).fill('FAILED'),
]

// Type distribution
const TX_TYPES_WEIGHTED = [
  ...Array(40).fill('DEBIT'),
  ...Array(30).fill('CREDIT'),
  ...Array(20).fill('TRANSFER'),
  ...Array(7).fill('FEE'),
  ...Array(3).fill('REFUND'),
]

const MERCHANT_CATEGORIES = [
  ...Array(20).fill('FOOD'),
  ...Array(15).fill('TRAVEL'),
  ...Array(20).fill('SHOPPING'),
  ...Array(10).fill('ENTERTAINMENT'),
  ...Array(15).fill('UTILITIES'),
  ...Array(8).fill('HEALTHCARE'),
  ...Array(7).fill('EDUCATION'),
  ...Array(5).fill('GAMING'),
]

const COUNTRIES = [
  ...Array(40).fill('US'),
  ...Array(10).fill('DE'),
  ...Array(8).fill('MX'),
  ...Array(8).fill('BR'),
  ...Array(8).fill('JP'),
  ...Array(7).fill('IN'),
  ...Array(7).fill('UK'),
  ...Array(6).fill('CA'),
  ...Array(3).fill('AU'),
  ...Array(3).fill('FR'),
]

const CURRENCIES = { US: 'USD', DE: 'EUR', MX: 'MXN', BR: 'BRL', JP: 'JPY', IN: 'INR', UK: 'GBP', CA: 'CAD', AU: 'AUD', FR: 'EUR' }

function generateTransactionsChunk(from, to) {
  const now = Date.now()
  const oneYear = 365 * 24 * 60 * 60 * 1000
  const items = []

  for (let i = from; i < to; i++) {
    // Each account gets 100 transactions → accountId cycles every 100 items
    const accountId = ACCOUNTS[Math.floor(i / 100) % ACCOUNTS.length]
    const ts        = now - rnd(0, oneYear)
    const country   = pick(COUNTRIES)
    items.push({
      accountId,
      txId:             `${ts}_${pad(i, 9)}`,
      type:             pick(TX_TYPES_WEIGHTED),
      amount:           parseFloat((Math.random() * 999.99 + 0.01).toFixed(2)),
      currency:         CURRENCIES[country] ?? 'USD',
      merchantCategory: pick(MERCHANT_CATEGORIES),
      country,
      status:           pick(TX_STATUSES),
      description:      `Transaction ${pad(i, 8)}`,
      createdAt:        new Date(ts).toISOString(),
    })
  }
  return items
}

// ── UserProfiles generators ───────────────────────────────────────────────────

// 25 000 users: user-00001 … user-25000
const PLANS_WEIGHTED = [
  ...Array(60).fill('free'),
  ...Array(25).fill('starter'),
  ...Array(12).fill('pro'),
  ...Array(3).fill('enterprise'),
]

const REFERRAL_SOURCES = ['organic', 'organic', 'referral', 'paid-search', 'social', 'email', 'conference', 'partner']

function generateUserProfilesChunk(from, to) {
  const now = Date.now()
  const twoYears = 2 * 365 * 24 * 60 * 60 * 1000
  const thirtyDays = 30 * 24 * 60 * 60 * 1000
  const items = []

  for (let i = from; i < to; i++) {
    const userId   = `user-${pad(i + 1, 5)}`
    const country  = pick(COUNTRIES)
    const signupTs = now - rnd(0, twoYears)
    items.push({
      userId,
      email:          `${userId.replace('-', '')}@example.${country.toLowerCase()}`,
      name:           `User ${pad(i + 1, 5)}`,
      plan:           pick(PLANS_WEIGHTED),
      country,
      signupAt:       new Date(signupTs).toISOString(),
      lastLoginAt:    new Date(now - rnd(0, thirtyDays)).toISOString(),
      active:         Math.random() > 0.15,
      referralSource: pick(REFERRAL_SOURCES),
      mfaEnabled:     Math.random() > 0.6,
    })
  }
  return items
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function createTable(schema) {
  const name = schema.TableName
  await dropTable(name)
  process.stdout.write(`  Creating ${name}...`)
  await client.send(new CreateTableCommand(schema))
  await waitReady(name)
  console.log(' ACTIVE')
}

async function seedInChunks(tableName, totalItems, chunkSize, generatorFn, concurrency = 20) {
  let from = 0
  while (from < totalItems) {
    const to    = Math.min(from + chunkSize, totalItems)
    const items = generatorFn(from, to)
    await batchWriteParallel(tableName, items, concurrency)
    from = to
  }
}

async function main() {
  console.log('DataOrbit — Large-scale DynamoDB Local seeder')
  console.log('==============================================')
  console.log('Endpoint: http://localhost:8000')
  console.log('Target:   ~325 000 items across 3 tables')
  console.log()

  // Verify DynamoDB Local is reachable
  try {
    await client.send(new DescribeTableCommand({ TableName: '__ping__' }))
  } catch (err) {
    if (!err.message?.includes('ResourceNotFoundException')) {
      console.error('✗ Cannot reach DynamoDB Local. Run: npm run db:start')
      process.exit(1)
    }
  }

  const t0 = Date.now()

  // ── EventLog (200 000 rows) ────────────────────────────────────────────────
  console.log('\n[EventLog — 200 000 rows]')
  console.log('  PK: serviceId (8 services)  SK: eventId (timestamp_index)')
  console.log('  GSI: Level-index (level, createdAt)')
  console.log('  ⚠ No GSI on userId, correlationId, region')
  await createTable(SCHEMA_EVENT_LOG)
  await seedInChunks('EventLog', 200_000, 10_000, generateEventLogChunk)

  // ── Transactions (100 000 rows) ────────────────────────────────────────────
  console.log('\n[Transactions — 100 000 rows]')
  console.log('  PK: accountId (1 000 accounts, 100 txns each)  SK: txId')
  console.log('  GSI: Status-CreatedAt-index (status, createdAt)')
  console.log('  ⚠ No GSI on merchantCategory, country')
  await createTable(SCHEMA_TRANSACTIONS)
  await seedInChunks('Transactions', 100_000, 10_000, generateTransactionsChunk)

  // ── UserProfiles (25 000 rows) ─────────────────────────────────────────────
  console.log('\n[UserProfiles — 25 000 rows]')
  console.log('  PK: userId (user-00001 … user-25000)  no SK')
  console.log('  GSI: Plan-index (plan, signupAt)')
  console.log('  ⚠ No GSI on country, referralSource')
  await createTable(SCHEMA_USER_PROFILES)
  await seedInChunks('UserProfiles', 25_000, 5_000, generateUserProfilesChunk)

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n✓ Done in ${elapsed}s`)
  console.log()
  console.log('Connect with:')
  console.log('  Name:     dataorbit-local')
  console.log('  Region:   us-east-1')
  console.log('  Auth:     any (e.g. profile: default)')
  console.log('  Endpoint: http://localhost:8000')
  console.log()
  console.log('Try these scenarios in the Query tab:')
  console.log('  EventLog     + serviceId = auth-service               → Query  (fast, ~few RCU)')
  console.log('  EventLog     + userId = user-0042                     → Scan   (slow, ~25k RCU → index suggestion)')
  console.log('  EventLog     + Level-index + level = ERROR            → IndexQuery (fast)')
  console.log('  Transactions + accountId = acc-0042                  → Query  (fast)')
  console.log('  Transactions + merchantCategory = FOOD               → Scan   (slow → index suggestion)')
  console.log('  Transactions + Status-CreatedAt-index + status=FAILED → IndexQuery (fast)')
  console.log('  UserProfiles + userId = user-00042                   → Query  (fast, single item)')
  console.log('  UserProfiles + country = MX                          → Scan   (slow → index suggestion)')
  console.log('  UserProfiles + Plan-index + plan = enterprise        → IndexQuery (fast)')
}

main().catch(err => {
  console.error('\n✗ Seed failed:', err.message)
  process.exit(1)
})
