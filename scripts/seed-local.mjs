#!/usr/bin/env node
/**
 * Seed DynamoDB Local with realistic test data.
 *
 * Usage:
 *   npm run db:seed
 *
 * Requires DynamoDB Local running on port 8000:
 *   npm run db:start
 *
 * Tables created:
 *   DeviceMessages   — 5 000 rows, 20 sensors, last 30 days
 *   DeviceRegistry   — 20 sensor records
 *   SensorAlerts     — ~500 alerts (sensor-0012 intentionally missing to demo LEFT ANTI)
 *   DeviceLocations  — 20 composite-key rows (countryCode::zone::sensorId)
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
function ago(ms)       { return Date.now() - ms }

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
    console.log(`  Dropping existing table: ${name}`)
    await client.send(new DeleteTableCommand({ TableName: name }))
    // Wait for deletion
    for (let i = 0; i < 30; i++) {
      if (!(await tableExists(name))) break
      await new Promise(r => setTimeout(r, 500))
    }
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

/** Write items in batches of 25 (DynamoDB BatchWriteItem limit). */
async function batchWrite(tableName, items) {
  const BATCH = 25
  let written = 0
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH)
    const requests = slice.map(item => ({
      PutRequest: { Item: marshall(item, { removeUndefinedValues: true }) },
    }))
    await client.send(new BatchWriteItemCommand({
      RequestItems: { [tableName]: requests },
    }))
    written += slice.length
    process.stdout.write(`\r  ${written}/${items.length} items written`)
  }
  console.log()
}

// ── Table schemas ─────────────────────────────────────────────────────────────

const TABLES = {
  DeviceMessages: {
    TableName: 'DeviceMessages',
    KeySchema: [
      { AttributeName: 'deviceId',   KeyType: 'HASH'  },
      { AttributeName: 'timestamp',  KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'deviceId',  AttributeType: 'S' },
      { AttributeName: 'timestamp', AttributeType: 'N' },
      { AttributeName: 'status',    AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
    GlobalSecondaryIndexes: [
      {
        IndexName: 'Status-index',
        KeySchema: [
          { AttributeName: 'status',    KeyType: 'HASH'  },
          { AttributeName: 'timestamp', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    StreamSpecification: {
      StreamEnabled: true,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
  },

  DeviceRegistry: {
    TableName: 'DeviceRegistry',
    KeySchema: [{ AttributeName: 'deviceId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'deviceId', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },

  SensorAlerts: {
    TableName: 'SensorAlerts',
    KeySchema: [
      { AttributeName: 'deviceId', KeyType: 'HASH'  },
      { AttributeName: 'alertId',  KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'deviceId', AttributeType: 'S' },
      { AttributeName: 'alertId',  AttributeType: 'S' },
      { AttributeName: 'severity', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
    GlobalSecondaryIndexes: [
      {
        IndexName: 'Severity-index',
        KeySchema: [
          { AttributeName: 'severity',  KeyType: 'HASH'  },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },

  DeviceLocations: {
    TableName: 'DeviceLocations',
    KeySchema: [{ AttributeName: 'locationKey', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'locationKey', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
}

// ── Data generators ───────────────────────────────────────────────────────────

const SENSORS = Array.from({ length: 20 }, (_, i) =>
  `sensor-${String(i + 1).padStart(4, '0')}`
)

// sensor-0012 is intentionally NOT registered (for LEFT ANTI demo)
const REGISTERED_SENSORS = SENSORS.filter(s => s !== 'sensor-0012')

const FIRMWARE_VERSIONS = ['v1.9.5', 'v2.0.8', 'v2.0.9', 'v2.1.0', 'v2.1.1', 'v2.2.0-beta']
const OWNERS = ['ops-team', 'facilities', 'r-and-d', 'iot-platform', 'security']
const ZONES = ['north', 'south', 'east', 'west', 'central']
const LOCATIONS = ['Building A', 'Building B', 'Building C', 'Lab D', 'Server Room E', 'Roof F', 'Parking G']
const MODELS = ['TempSensor-Pro', 'TempSensor-Std', 'PressureSensor', 'HumiditySensor', 'CO2Monitor', 'MotionDetector']
const ALERT_TYPES = ['HIGH_TEMP', 'LOW_BATTERY', 'HIGH_PRESSURE', 'HIGH_HUMIDITY', 'CONNECTION_LOST', 'ROUTINE']
const SEVERITIES = ['INFO', 'WARN', 'CRIT']

// GEO clusters for DeviceLocations composite key pattern
const GEO_CLUSTERS = [
  { country: 'US', zone: 'northeast', lat: [40.5, 41.0], lng: [-74.5, -73.8], building: 'HQ' },
  { country: 'US', zone: 'southeast', lat: [25.5, 26.0], lng: [-80.5, -80.0], building: 'Miami' },
  { country: 'US', zone: 'northwest', lat: [47.4, 47.8], lng: [-122.5, -122.1], building: 'Seattle' },
  { country: 'US', zone: 'southwest', lat: [33.9, 34.2], lng: [-118.5, -118.0], building: 'LA' },
  { country: 'EU', zone: 'west',      lat: [48.7, 49.0], lng: [2.2, 2.5],    building: 'Paris' },
  { country: 'EU', zone: 'east',      lat: [52.3, 52.6], lng: [13.2, 13.6],  building: 'Berlin' },
  { country: 'EU', zone: 'north',     lat: [59.3, 59.5], lng: [17.9, 18.2],  building: 'Stockholm' },
  { country: 'APAC', zone: 'east',    lat: [35.5, 35.8], lng: [139.5, 139.9], building: 'Tokyo' },
  { country: 'APAC', zone: 'south',   lat: [1.2, 1.4],   lng: [103.7, 103.9], building: 'Singapore' },
]

function randFloat(min, max, decimals = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals))
}

function isoDate(ms) {
  return new Date(ms).toISOString()
}

// ── DeviceMessages (5 000 rows) ───────────────────────────────────────────────

function generateMessages(count = 5000) {
  const rows = []
  const now = Date.now()
  const thirty_days = 30 * 24 * 60 * 60 * 1000

  // Guarantee at least some WARN/CRIT for demo queries
  const warningDevices = new Set(['sensor-0012', 'sensor-0009', 'sensor-0017'])
  const critDevices    = new Set(['sensor-0019'])

  for (let i = 0; i < count; i++) {
    const sensorId = pick(SENSORS)
    const ts = ago(rnd(0, thirty_days))

    let status = 'OK'
    let temp   = randFloat(15, 28)
    let battery = rnd(40, 100)

    if (critDevices.has(sensorId) && Math.random() < 0.3) {
      status  = 'CRIT'
      temp    = randFloat(38, 50)
      battery = rnd(1, 10)
    } else if (warningDevices.has(sensorId) && Math.random() < 0.4) {
      status  = 'WARN'
      temp    = randFloat(30, 38)
      battery = rnd(8, 20)
    }

    rows.push({
      deviceId:  sensorId,
      timestamp: ts,
      temp,
      battery,
      status,
      firmware: pick(FIRMWARE_VERSIONS),
      pressure: randFloat(990, 1030),
      humidity: rnd(30, 90),
    })
  }

  return rows
}

// ── DeviceRegistry (20 rows) ──────────────────────────────────────────────────

function generateRegistry() {
  return REGISTERED_SENSORS.map((sensorId, i) => ({
    deviceId:     sensorId,
    model:        pick(MODELS),
    location:     pick(LOCATIONS),
    zone:         pick(ZONES),
    registeredAt: isoDate(ago(rnd(60, 365) * 24 * 60 * 60 * 1000)),
    owner:        pick(OWNERS),
    serialNumber: `SN-${String(100000 + i).padStart(6, '0')}`,
    active:       Math.random() > 0.1,
  }))
}

// ── SensorAlerts (~500 rows, sensor-0012 intentionally absent) ────────────────

function generateAlerts(count = 500) {
  const rows = []
  const eligibleSensors = SENSORS.filter(s => s !== 'sensor-0012')
  let alertIndex = 1

  // Each sensor gets some alerts
  for (const sensorId of eligibleSensors) {
    const alertCount = rnd(10, 40)
    for (let j = 0; j < alertCount && rows.length < count; j++) {
      const ts = ago(rnd(0, 30 * 24 * 60 * 60 * 1000))
      const alertType = pick(ALERT_TYPES)
      const severity  = alertType === 'HIGH_TEMP' || alertType === 'CONNECTION_LOST'
        ? pick(['WARN', 'CRIT'])
        : pick(['INFO', 'INFO', 'INFO', 'WARN'])  // bias toward INFO

      rows.push({
        deviceId:     sensorId,
        alertId:      `alrt-${String(alertIndex++).padStart(5, '0')}`,
        alertType,
        value:        alertType === 'LOW_BATTERY' ? rnd(1, 20) : randFloat(15, 50),
        severity,
        createdAt:    isoDate(ts),
        acknowledged: Math.random() > 0.4,
        resolvedAt:   Math.random() > 0.6 ? isoDate(ts + rnd(60_000, 3_600_000)) : undefined,
      })
    }
  }

  return rows
}

// ── DeviceLocations (20 rows, composite key) ──────────────────────────────────

function generateLocations() {
  const rows = []
  let sensorIdx = 0

  for (const cluster of GEO_CLUSTERS) {
    const sensorsInCluster = rnd(1, 3)
    for (let j = 0; j < sensorsInCluster && sensorIdx < SENSORS.length; j++, sensorIdx++) {
      const sensorId = SENSORS[sensorIdx]
      rows.push({
        locationKey: `${cluster.country}::${cluster.zone}::${sensorId}`,
        lat:         randFloat(cluster.lat[0], cluster.lat[1], 4),
        lng:         randFloat(cluster.lng[0], cluster.lng[1], 4),
        building:    `${cluster.building}-${String.fromCharCode(65 + j)}`,
        floor:       rnd(1, 8),
        installedAt: isoDate(ago(rnd(30, 400) * 24 * 60 * 60 * 1000)),
        country:     cluster.country,
        zone:        cluster.zone,
      })
    }
  }

  // Fill remaining sensors in US::misc
  while (sensorIdx < SENSORS.length) {
    const sensorId = SENSORS[sensorIdx++]
    rows.push({
      locationKey: `US::misc::${sensorId}`,
      lat:         randFloat(25, 48, 4),
      lng:         randFloat(-122, -70, 4),
      building:    'Misc-A',
      floor:       1,
      installedAt: isoDate(ago(rnd(30, 400) * 24 * 60 * 60 * 1000)),
      country:     'US',
      zone:        'misc',
    })
  }

  return rows
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('DataOrbit — DynamoDB Local seeder')
  console.log('===================================')
  console.log(`Endpoint: http://localhost:8000`)
  console.log()

  // Verify connection
  try {
    await client.send(new DescribeTableCommand({ TableName: '__ping__' }))
  } catch (err) {
    if (!err.message?.includes('ResourceNotFoundException')) {
      console.error('Cannot reach DynamoDB Local. Is it running?')
      console.error('  npm run db:start')
      process.exit(1)
    }
  }

  for (const [tableName, schema] of Object.entries(TABLES)) {
    console.log(`\n[${tableName}]`)
    await dropTable(tableName)

    console.log('  Creating table...')
    await client.send(new CreateTableCommand(schema))
    await waitReady(tableName)
    console.log('  Table ACTIVE')

    let items
    switch (tableName) {
      case 'DeviceMessages':  items = generateMessages(5000); break
      case 'DeviceRegistry':  items = generateRegistry();      break
      case 'SensorAlerts':    items = generateAlerts(500);     break
      case 'DeviceLocations': items = generateLocations();     break
    }

    console.log(`  Seeding ${items.length} items...`)
    await batchWrite(tableName, items)
  }

  console.log('\n✓ Done! Connect with:')
  console.log('  Name:     dataorbit-local')
  console.log('  Region:   us-east-1')
  console.log('  Auth:     any (e.g. profile: default)')
  console.log('  Endpoint: http://localhost:8000')
}

main().catch(err => {
  console.error('\nSeed failed:', err.message)
  process.exit(1)
})
