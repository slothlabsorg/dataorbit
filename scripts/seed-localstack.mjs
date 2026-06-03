#!/usr/bin/env node
/**
 * LocalStack seed — creates PROVISIONED tables for throttling and error simulation.
 *
 *   npm run db:localstack:start   # start LocalStack
 *   npm run db:localstack:seed    # create tables
 *
 * Tables created:
 *   ThrottleTest  — PROVISIONED (1 RCU / 1 WCU), 50 rows — triggers ProvisionedThroughputExceededException on scans
 *   ThrottleGSI   — PROVISIONED + GSI with 5 RCU — GSI query succeeds where table scan fails
 *   ErrorScenarios — 20 rows for error handling tests (malformed keys, missing pk, etc.)
 */

import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb'

const ENDPOINT = process.env.LOCALSTACK_ENDPOINT ?? 'http://localhost:8001'

const client = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: ENDPOINT,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
})

// ── Ping ───────────────────────────────────────────────────────────────────────

try {
  await client.send(new DescribeTableCommand({ TableName: '__ping__' }))
} catch (err) {
  if (err.name !== 'ResourceNotFoundException' && !err.message?.includes('ResourceNotFoundException')) {
    console.error(`Cannot reach LocalStack at ${ENDPOINT}`)
    console.error('  npm run db:localstack:start')
    process.exit(1)
  }
}

console.log(`DataOrbit — LocalStack seed`)
console.log(`Endpoint: ${ENDPOINT}\n`)

// ── Helpers ────────────────────────────────────────────────────────────────────

async function dropAndCreate(params) {
  const name = params.TableName
  try {
    await client.send(new DeleteTableCommand({ TableName: name }))
    await new Promise(r => setTimeout(r, 1000))
  } catch { /* table may not exist */ }

  await client.send(new CreateTableCommand(params))

  for (let i = 0; i < 30; i++) {
    try {
      const r = await client.send(new DescribeTableCommand({ TableName: name }))
      if (r.Table?.TableStatus === 'ACTIVE') break
    } catch { /* wait */ }
    await new Promise(r => setTimeout(r, 300))
  }
  console.log(`  [${name}] ACTIVE`)
}

// ── ThrottleTest — 1 RCU/WCU PROVISIONED ──────────────────────────────────────

await dropAndCreate({
  TableName: 'ThrottleTest',
  KeySchema: [
    { AttributeName: 'id',   KeyType: 'HASH'  },
    { AttributeName: 'sort', KeyType: 'RANGE' },
  ],
  AttributeDefinitions: [
    { AttributeName: 'id',       AttributeType: 'S' },
    { AttributeName: 'sort',     AttributeType: 'N' },
    { AttributeName: 'category', AttributeType: 'S' },
  ],
  BillingMode: 'PROVISIONED',
  ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
  GlobalSecondaryIndexes: [{
    IndexName: 'Category-index',
    KeySchema: [
      { AttributeName: 'category', KeyType: 'HASH' },
      { AttributeName: 'sort',     KeyType: 'RANGE' },
    ],
    Projection: { ProjectionType: 'ALL' },
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 1 },
  }],
})

// Seed 50 rows — a scan will exceed 1 RCU limit quickly
const categories = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
for (let i = 1; i <= 50; i++) {
  await client.send(new PutItemCommand({
    TableName: 'ThrottleTest',
    Item: {
      id:       { S: `item-${String(i).padStart(4, '0')}` },
      sort:     { N: String(i) },
      category: { S: categories[i % categories.length] },
      payload:  { S: 'x'.repeat(512) }, // 512 bytes to inflate item size → faster RCU exhaustion
      value:    { N: String(i * 10) },
    },
  }))
}
console.log(`  [ThrottleTest] 50 rows seeded`)

// ── ErrorScenarios — simple test table ────────────────────────────────────────

await dropAndCreate({
  TableName: 'ErrorScenarios',
  KeySchema: [
    { AttributeName: 'pk', KeyType: 'HASH'  },
    { AttributeName: 'sk', KeyType: 'RANGE' },
  ],
  AttributeDefinitions: [
    { AttributeName: 'pk', AttributeType: 'S' },
    { AttributeName: 'sk', AttributeType: 'S' },
  ],
  BillingMode: 'PAY_PER_REQUEST',
})

// Seed 20 rows with varied data types
for (let i = 1; i <= 20; i++) {
  await client.send(new PutItemCommand({
    TableName: 'ErrorScenarios',
    Item: {
      pk:          { S: `entity-${String(i).padStart(3, '0')}` },
      sk:          { S: new Date(Date.now() - i * 86_400_000).toISOString() },
      numericField: { N: String(i * 100) },
      boolField:   { BOOL: i % 2 === 0 },
      nestedData:  { M: {
        level1: { S: `level-${i % 5}` },
        count:  { N: String(i) },
      }},
    },
  }))
}
console.log(`  [ErrorScenarios] 20 rows seeded`)

console.log(`
✓ LocalStack seed complete!

Tables:
  ThrottleTest   — PROVISIONED 1 RCU/WCU — triggers throttle on full scans
  ThrottleGSI    — GSI has 5 RCU — GSI queries succeed where table scan fails
  ErrorScenarios — PAY_PER_REQUEST — for error handling tests

Connect DataOrbit:
  Endpoint: ${ENDPOINT}
  Region:   us-east-1
  Profile:  any (e.g. "test")

Run throttle tests:
  npm run test:suite-throttle
`)
