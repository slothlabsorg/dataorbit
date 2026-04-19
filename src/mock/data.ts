import type { DbConnection, StreamEvent, HistoryEntry, DataRow } from '@/types'

const now = new Date()
const ago  = (ms: number) => new Date(now.getTime() - ms)
const tAgo = (ms: number) => now.getTime() - ms   // returns Unix ms for timestamp fields

export const mockConnections: DbConnection[] = [
  {
    id: 'conn-1',
    name: 'nexus-prod',
    dbType: 'dynamodb',
    status: 'connected',
    awsRegion: 'us-east-1',
    awsProfile: 'Acme Production',
    lastConnected: ago(300_000).toISOString(),
    isFavorite: true,
    color: '#a855f7',
    tables: [
      {
        name: 'DeviceMessages',
        itemCount: 12_400_000,
        sizeBytes: 4_800_000_000,
        partitionKey: 'deviceId',
        sortKey: 'timestamp',
        billingMode: 'PAY_PER_REQUEST',
        streamEnabled: true,
        attributes: ['deviceId', 'timestamp', 'temp', 'battery', 'status', 'firmware'],
        indexes: [
          { name: 'DeviceId-Timestamp-index', type: 'GSI', partitionKey: 'deviceId', sortKey: 'timestamp', projection: 'ALL' },
          { name: 'Status-index',             type: 'GSI', partitionKey: 'status',   sortKey: 'timestamp', projection: 'INCLUDE' },
        ],
      },
      {
        name: 'DeviceRegistry',
        itemCount: 48_200,
        sizeBytes: 62_000_000,
        partitionKey: 'deviceId',
        billingMode: 'PAY_PER_REQUEST',
        streamEnabled: false,
        attributes: ['deviceId', 'model', 'location', 'zone', 'registeredAt', 'owner'],
        indexes: [],
      },
      {
        name: 'SensorAlerts',
        itemCount: 5_100,
        sizeBytes: 3_200_000,
        partitionKey: 'deviceId',
        sortKey: 'alertId',
        billingMode: 'PAY_PER_REQUEST',
        streamEnabled: false,
        attributes: ['deviceId', 'alertId', 'alertType', 'value', 'severity', 'createdAt', 'acknowledged'],
        indexes: [
          { name: 'Severity-index', type: 'GSI', partitionKey: 'severity', sortKey: 'createdAt', projection: 'ALL' },
        ],
      },
      {
        // Hierarchical / composite key table: locationKey = countryCode::zone::sensorId
        // begins_with 'US::' → all US sensors; begins_with 'US::northeast::' → northeast cluster
        name: 'DeviceLocations',
        itemCount: 14_800,
        sizeBytes: 8_900_000,
        partitionKey: 'locationKey',
        billingMode: 'PAY_PER_REQUEST',
        streamEnabled: false,
        attributes: ['locationKey', 'lat', 'lng', 'building', 'floor', 'installedAt'],
        indexes: [],
      },
    ],
  },
  {
    id: 'conn-2',
    name: 'iot-metrics',
    dbType: 'influxdb',
    status: 'disconnected',
    host: 'influx.internal.acme.io',
    port: 8086,
    database: 'telemetry',
    lastConnected: ago(3_600_000).toISOString(),
    color: '#60a5fa',
    tables: [],
  },
  {
    id: 'conn-3',
    name: 'nexus-staging',
    dbType: 'dynamodb',
    status: 'disconnected',
    awsRegion: 'us-west-2',
    awsProfile: 'Acme Staging',
    color: '#34d399',
    tables: [],
  },
]

// ── DeviceLocations rows ──────────────────────────────────────────────────────
// locationKey uses composite pattern: countryCode::zone::sensorId
// begins_with 'US::' → all US sensors
// begins_with 'US::northeast::' → northeast cluster only
// This is the "hierarchical key" / "overloaded PK" DynamoDB pattern
export const mockLocationRows: DataRow[] = [
  { locationKey: 'US::northeast::sensor-4421', lat: 40.71, lng: -74.01, building: 'HQ-A',    floor: 3, installedAt: '2024-01-10' },
  { locationKey: 'US::northeast::sensor-8821', lat: 40.72, lng: -74.02, building: 'HQ-B',    floor: 1, installedAt: '2024-01-12' },
  { locationKey: 'US::southeast::sensor-1122', lat: 25.76, lng: -80.19, building: 'Miami-C', floor: 2, installedAt: '2024-01-15' },
  { locationKey: 'EU::west::sensor-3300',      lat: 48.86, lng:   2.35, building: 'Paris-D', floor: 4, installedAt: '2024-02-01' },
  { locationKey: 'EU::east::sensor-9900',      lat: 52.52, lng:  13.40, building: 'Berlin-E',floor: 1, installedAt: '2024-02-03' },
  { locationKey: 'US::northwest::sensor-0012', lat: 47.61, lng:-122.33, building: 'Seattle-F',floor: 5, installedAt: '2024-02-10' },
]

// ── DeviceMessages rows ───────────────────────────────────────────────────────
// Timestamps are relative to NOW so time-range presets produce real results.
// sensor-0012 and sensor-9900 are WARN/CRIT — used in alert debugging scenario.
export const mockRows: DataRow[] = [
  { deviceId: 'sensor-4421', timestamp: tAgo(20 * 60_000),  temp: 23.4, battery: 87, status: 'OK',   firmware: 'v2.1.0' },
  { deviceId: 'sensor-4421', timestamp: tAgo(35 * 60_000),  temp: 23.5, battery: 87, status: 'OK',   firmware: 'v2.1.0' },
  { deviceId: 'sensor-8821', timestamp: tAgo(50 * 60_000),  temp: 19.1, battery: 62, status: 'OK',   firmware: 'v2.0.8' },
  { deviceId: 'sensor-0012', timestamp: tAgo(120 * 60_000), temp: 31.2, battery: 15, status: 'WARN', firmware: 'v2.1.0' },
  { deviceId: 'sensor-1122', timestamp: tAgo(10 * 60_000),  temp: 25.8, battery: 91, status: 'OK',   firmware: 'v2.1.0' },
  { deviceId: 'sensor-3300', timestamp: tAgo(180 * 60_000), temp: 18.0, battery: 44, status: 'OK',   firmware: 'v2.0.8' },
  { deviceId: 'sensor-9900', timestamp: tAgo(300 * 60_000), temp: 40.1, battery:  8, status: 'CRIT', firmware: 'v1.9.5' },
]

// ── DeviceRegistry rows ───────────────────────────────────────────────────────
// sensor-0012, sensor-3300, sensor-9900 intentionally NOT registered.
// → LEFT ANTI DeviceMessages vs DeviceRegistry reveals unregistered hardware.
export const mockRegistryRows: DataRow[] = [
  { deviceId: 'sensor-4421', model: 'TempSensor-Pro', location: 'Building A', zone: 'north', registeredAt: '2024-01-10', owner: 'ops-team'   },
  { deviceId: 'sensor-8821', model: 'TempSensor-Std', location: 'Building B', zone: 'east',  registeredAt: '2024-01-12', owner: 'facilities' },
  { deviceId: 'sensor-1122', model: 'TempSensor-Pro', location: 'Building C', zone: 'south', registeredAt: '2024-01-15', owner: 'ops-team'   },
  { deviceId: 'sensor-7700', model: 'PressureSensor', location: 'Lab D',      zone: 'west',  registeredAt: '2024-02-01', owner: 'r-and-d'    },
  { deviceId: 'sensor-2200', model: 'HumiditySensor', location: 'Building A', zone: 'north', registeredAt: '2024-02-05', owner: 'facilities' },
]

// ── SensorAlerts rows ─────────────────────────────────────────────────────────
// Created by AlertService when a sensor reading exceeds a threshold.
// sensor-0012 (battery 15%, status WARN) is intentionally MISSING ← bug scenario:
//   DeviceMessages has a WARN event for sensor-0012 but AlertService never wrote
//   the corresponding entry. LEFT ANTI on deviceId catches this immediately.
export const mockAlertRows: DataRow[] = [
  { deviceId: 'sensor-9900', alertId: 'alrt-001', alertType: 'HIGH_TEMP',   value: 40.1, severity: 'CRIT', createdAt: ago(300 * 60_000 - 5_000).toISOString(), acknowledged: false },
  { deviceId: 'sensor-4421', alertId: 'alrt-002', alertType: 'ROUTINE',     value: 23.4, severity: 'INFO', createdAt: ago(20  * 60_000 - 3_000).toISOString(), acknowledged: true  },
  { deviceId: 'sensor-8821', alertId: 'alrt-003', alertType: 'ROUTINE',     value: 19.1, severity: 'INFO', createdAt: ago(50  * 60_000 - 3_000).toISOString(), acknowledged: true  },
  { deviceId: 'sensor-1122', alertId: 'alrt-004', alertType: 'ROUTINE',     value: 25.8, severity: 'INFO', createdAt: ago(10  * 60_000 - 3_000).toISOString(), acknowledged: false },
  { deviceId: 'sensor-3300', alertId: 'alrt-005', alertType: 'ROUTINE',     value: 18.0, severity: 'INFO', createdAt: ago(180 * 60_000 - 3_000).toISOString(), acknowledged: true  },
  // sensor-0012 has NO entry here — AlertService dropped the message
]

export const mockStreamEvents: StreamEvent[] = [
  {
    id: 'ev-1',
    time: ago(2_000),
    type: 'INSERT',
    table: 'DeviceMessages',
    newItem: { deviceId: 'sensor-4421', timestamp: tAgo(0), temp: 23.7, battery: 86, status: 'OK' },
  },
  {
    id: 'ev-2',
    time: ago(7_000),
    type: 'MODIFY',
    table: 'DeviceMessages',
    oldItem: { deviceId: 'sensor-0012', status: 'OK',   temp: 29.1, battery: 18 },
    newItem: { deviceId: 'sensor-0012', status: 'WARN', temp: 31.2, battery: 15 },
    diff: { temp: { old: 29.1, new: 31.2 }, battery: { old: 18, new: 15 }, status: { old: 'OK', new: 'WARN' } },
  },
  {
    id: 'ev-3',
    time: ago(15_000),
    type: 'REMOVE',
    table: 'DeviceMessages',
    oldItem: { deviceId: 'sensor-legacy-01', timestamp: tAgo(3_600_000) },
  },
  {
    id: 'ev-4',
    time: ago(22_000),
    type: 'INSERT',
    table: 'DeviceMessages',
    newItem: { deviceId: 'sensor-8821', timestamp: tAgo(500), temp: 19.3, battery: 61, status: 'OK' },
  },
]

export const mockHistory: HistoryEntry[] = [
  {
    id: 'h-1',
    time: ago(120_000),
    connectionId: 'conn-1',
    connectionName: 'nexus-prod',
    table: 'DeviceMessages',
    filters: [
      { id: 'f1', field: 'deviceId',  op: '=',       value: 'sensor-4421' },
      { id: 'f2', field: 'timestamp', op: 'between', value: String(tAgo(3_600_000)), valueEnd: String(tAgo(0)) },
    ],
    result: { count: 2, scannedCount: 2, rcuConsumed: 0.5, executionMs: 34 },
    isSaved: true,
    savedName: 'Sensor 4421 last hour',
  },
  {
    id: 'h-2',
    time: ago(600_000),
    connectionId: 'conn-1',
    connectionName: 'nexus-prod',
    table: 'DeviceMessages',
    filters: [{ id: 'f1', field: 'status', op: '=', value: 'WARN' }],
    result: { count: 847, scannedCount: 2100, rcuConsumed: 105, executionMs: 210 },
  },
  {
    id: 'h-3',
    time: ago(3_600_000),
    connectionId: 'conn-1',
    connectionName: 'nexus-prod',
    table: 'DeviceRegistry',
    filters: [],
    result: { count: 50, scannedCount: 50, rcuConsumed: 2, executionMs: 18 },
  },
]
