#!/usr/bin/env node
/**
 * Stress seed — 200 tables simulating a real AWS account with many microservices.
 * Used for sidebar pagination, list_tables 2-page handling, and scroll/search tests.
 *
 *   npm run db:start
 *   npm run db:seed:stress
 */

import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  PutItemCommand,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb'

const ENDPOINT = process.env.DYNAMO_ENDPOINT ?? 'http://localhost:8000'

const client = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: ENDPOINT,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
})

// ── Ping ──────────────────────────────────────────────────────────────────────

try {
  await client.send(new DescribeTableCommand({ TableName: '__ping__' }))
} catch (err) {
  if (err.name !== 'ResourceNotFoundException' && !err.message?.includes('ResourceNotFoundException')) {
    console.error('Cannot reach DynamoDB. Is it running?  npm run db:start')
    process.exit(1)
  }
}

// ── Table name generator ───────────────────────────────────────────────────────

const SERVICES = [
  'orders', 'payments', 'users', 'sessions', 'events', 'notifications',
  'inventory', 'catalog', 'search', 'analytics', 'auth', 'billing',
  'shipping', 'returns', 'reviews', 'recommendations', 'cart', 'checkout',
  'fulfillment', 'reporting',
]

const ENVIRONMENTS = ['prod', 'staging', 'dev', 'qa']
const SUFFIXES     = ['v1', 'v2', 'v3', 'events', 'log', 'state', 'cache', 'config', 'audit', 'archive']

function generateTableNames(count) {
  const names = new Set()
  // First pass: service-env combos
  for (const svc of SERVICES) {
    for (const env of ENVIRONMENTS) {
      names.add(`${svc}-${env}`)
    }
  }
  // Second pass: service-suffix combos
  for (const svc of SERVICES) {
    for (const sfx of SUFFIXES) {
      names.add(`${svc}-${sfx}`)
    }
  }
  // Third pass: service-env-suffix
  for (const svc of SERVICES.slice(0, 5)) {
    for (const env of ENVIRONMENTS.slice(0, 2)) {
      for (const sfx of SUFFIXES.slice(0, 5)) {
        names.add(`${svc}-${env}-${sfx}`)
      }
    }
  }
  return [...names].slice(0, count)
}

const TABLE_NAMES = generateTableNames(200)

// ── Helpers ────────────────────────────────────────────────────────────────────

async function tableExists(name) {
  try {
    await client.send(new DescribeTableCommand({ TableName: name }))
    return true
  } catch { return false }
}

async function waitActive(name) {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await client.send(new DescribeTableCommand({ TableName: name }))
      if (r.Table?.TableStatus === 'ACTIVE') return
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 200))
  }
}

async function dropIfExists(name) {
  if (!(await tableExists(name))) return
  await client.send(new DeleteTableCommand({ TableName: name }))
  for (let i = 0; i < 20; i++) {
    if (!(await tableExists(name))) return
    await new Promise(r => setTimeout(r, 300))
  }
}

// ── Create tables ──────────────────────────────────────────────────────────────

console.log(`DataOrbit — Stress seed (${TABLE_NAMES.length} tables)`)
console.log(`Endpoint: ${ENDPOINT}\n`)

// List existing tables to decide what to drop
const existing = new Set()
let lek = undefined
do {
  const resp = await client.send(new ListTablesCommand({ ExclusiveStartTableName: lek, Limit: 100 }))
  for (const n of resp.TableNames ?? []) existing.add(n)
  lek = resp.LastEvaluatedTableName
} while (lek)

let created = 0
let skipped = 0

for (const name of TABLE_NAMES) {
  if (existing.has(name)) {
    skipped++
    continue
  }
  try {
    await client.send(new CreateTableCommand({
      TableName: name,
      KeySchema: [
        { AttributeName: 'id',        KeyType: 'HASH'  },
        { AttributeName: 'createdAt', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'id',        AttributeType: 'S' },
        { AttributeName: 'createdAt', AttributeType: 'S' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }))
    await waitActive(name)
    created++
    if (created % 20 === 0) process.stdout.write(`  ${created} created...\n`)
  } catch (e) {
    if (!e.message?.includes('already exists')) {
      console.warn(`  Skipped ${name}: ${e.message}`)
    }
    skipped++
  }
}

console.log(`  Created: ${created}  Skipped (already exist): ${skipped}`)

// ── Seed 10 rows per table ─────────────────────────────────────────────────────

console.log('\nSeeding 10 rows per table...')

const now = Date.now()
for (let t = 0; t < TABLE_NAMES.length; t++) {
  const name = TABLE_NAMES[t]
  for (let i = 0; i < 10; i++) {
    const ts = new Date(now - i * 3_600_000).toISOString()
    try {
      await client.send(new PutItemCommand({
        TableName: name,
        Item: {
          id:        { S: `item-${String(i + 1).padStart(4, '0')}` },
          createdAt: { S: ts },
          status:    { S: ['active', 'inactive', 'pending'][i % 3] },
          value:     { N: String(Math.floor(Math.random() * 1000)) },
        },
      }))
    } catch { /* ignore write errors on tables that couldn't create cleanly */ }
  }
  if ((t + 1) % 50 === 0) process.stdout.write(`  Seeded ${t + 1}/${TABLE_NAMES.length} tables\n`)
}

console.log(`\n✓ Done! ${TABLE_NAMES.length} tables available.`)
console.log(`  Connect with endpoint: ${ENDPOINT}, region: us-east-1`)
console.log(`  Tables follow pattern: <service>-<env|suffix>`)
console.log(`  Run: npm run test:suite-200`)
