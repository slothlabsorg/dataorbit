#!/usr/bin/env node
/**
 * Financial dataset seed — rich cross-country trade and pricing data.
 *
 * Designed for:
 *   - Cross-join revenue analysis: ExportTransactions × ProductPrices
 *   - Tariff impact analysis:      ExportTransactions × TradeTariffs
 *   - Time trace by product/country across 4 tables
 *   - Date range queries on non-SK columns (FilterExpression patterns)
 *   - GSI-based pre-filtering before cross-join
 *
 * Tables:
 *   ExportTransactions  ~5 000 rows  pk=exportId   sk=exportDate (ISO)
 *   ProductPrices       ~2 000 rows  pk=product    sk=priceDate  (ISO)
 *   CountryMetrics      ~  360 rows  pk=country    sk=reportDate (ISO)
 *   TradeTariffs        ~  500 rows  pk=tradeRoute sk=effectiveDate (ISO)
 *
 * Usage:
 *   npm run db:start
 *   npm run db:seed:financial
 */

import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  PutItemCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb'

const ENDPOINT = process.env.DYNAMO_ENDPOINT ?? 'http://localhost:8000'
const REGION   = 'us-east-1'

const client = new DynamoDBClient({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
})

// ── Ping ──────────────────────────────────────────────────────────────────────

try {
  await client.send(new DescribeTableCommand({ TableName: '__ping__' }))
} catch (err) {
  if (err.name !== 'ResourceNotFoundException' && !err.message?.includes('ResourceNotFoundException')) {
    console.error('Cannot reach DynamoDB. Run: npm run db:start'); process.exit(1)
  }
}

console.log('DataOrbit — Financial dataset seed')
console.log(`Endpoint: ${ENDPOINT}\n`)

// ── Reference data ────────────────────────────────────────────────────────────

const COUNTRIES = ['US', 'MX', 'BR', 'DE', 'FR', 'JP', 'CN', 'IN', 'GB', 'AU']

const PRODUCTS = [
  'steel', 'wheat', 'semiconductors', 'crude-oil', 'cotton',
  'aluminum', 'soybeans', 'copper', 'natural-gas', 'coal',
  'automobiles', 'pharmaceuticals', 'electronics', 'textiles', 'chemicals',
  'coffee', 'sugar', 'iron-ore', 'lng', 'plastics',
]

const TRADE_ROUTES = [
  'US-MX', 'US-CN', 'US-DE', 'US-JP', 'US-GB',
  'DE-CN', 'DE-FR', 'DE-US', 'DE-GB', 'DE-JP',
  'CN-US', 'CN-JP', 'CN-DE', 'CN-AU', 'CN-IN',
  'JP-US', 'JP-CN', 'JP-DE', 'JP-AU', 'JP-GB',
  'MX-US', 'MX-CN', 'MX-BR', 'BR-US', 'BR-CN',
  'IN-US', 'IN-DE', 'IN-AU', 'AU-CN', 'AU-JP',
  'GB-DE', 'GB-US', 'GB-FR', 'FR-DE', 'FR-US',
]

const STATUSES     = ['shipped', 'customs', 'delivered', 'rejected']
const VOLATILITIES = ['low', 'medium', 'high']
const UNITS        = { 'steel': 'tonnes', 'wheat': 'bushels', 'semiconductors': 'units',
                       'crude-oil': 'barrels', 'cotton': 'bales', 'aluminum': 'tonnes',
                       'soybeans': 'bushels', 'copper': 'tonnes', 'natural-gas': 'mmBtu',
                       'coal': 'tonnes', 'automobiles': 'units', 'pharmaceuticals': 'kg',
                       'electronics': 'units', 'textiles': 'kg', 'chemicals': 'tonnes',
                       'coffee': 'bags', 'sugar': 'tonnes', 'iron-ore': 'tonnes',
                       'lng': 'mmBtu', 'plastics': 'tonnes' }

// Base prices in USD
const BASE_PRICES = { 'steel': 800, 'wheat': 6.5, 'semiconductors': 450, 'crude-oil': 78,
                       'cotton': 0.85, 'aluminum': 2400, 'soybeans': 13.5, 'copper': 8500,
                       'natural-gas': 3.2, 'coal': 180, 'automobiles': 35000, 'pharmaceuticals': 120,
                       'electronics': 890, 'textiles': 4.5, 'chemicals': 1200, 'coffee': 220,
                       'sugar': 0.22, 'iron-ore': 115, 'lng': 12, 'plastics': 1350 }

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(msAgo) {
  return new Date(Date.now() - msAgo).toISOString().slice(0, 10)
}

function isoDateTime(msAgo) {
  return new Date(Date.now() - msAgo).toISOString()
}

function daysAgo(d) { return d * 86_400_000 }

// Random helpers
function rnd(min, max) { return min + Math.random() * (max - min) }
function rndInt(min, max) { return Math.floor(rnd(min, max + 1)) }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function jitter(base, pct = 0.15) { return base * (1 + (Math.random() - 0.5) * pct * 2) }

// ── Create / recreate table ───────────────────────────────────────────────────

async function dropAndCreate(params) {
  const name = params.TableName
  try {
    await client.send(new DeleteTableCommand({ TableName: name }))
    await new Promise(r => setTimeout(r, 800))
  } catch { /* may not exist */ }

  await client.send(new CreateTableCommand(params))
  for (let i = 0; i < 40; i++) {
    try {
      const r = await client.send(new DescribeTableCommand({ TableName: name }))
      if (r.Table?.TableStatus === 'ACTIVE') break
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 300))
  }
  console.log(`  [${name}] ACTIVE`)
}

// ── Batch write helper ────────────────────────────────────────────────────────

async function batchWrite(tableName, items) {
  const BATCH = 25
  let written = 0
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH)
    await client.send(new BatchWriteItemCommand({
      RequestItems: {
        [tableName]: chunk.map(item => ({ PutRequest: { Item: item } })),
      },
    }))
    written += chunk.length
    if (written % 500 === 0) process.stdout.write(`    ${written}/${items.length}\n`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE 1: ExportTransactions
// pk=exportId (S), sk=exportDate (ISO string)
// GSI: Country-Date-index (country PK, exportDate SK)
// GSI: Product-Date-index (product PK, exportDate SK)
// ~5 000 rows — 10 countries × 20 products × 25 dates
// ─────────────────────────────────────────────────────────────────────────────

await dropAndCreate({
  TableName: 'ExportTransactions',
  KeySchema: [
    { AttributeName: 'exportId',   KeyType: 'HASH'  },
    { AttributeName: 'exportDate', KeyType: 'RANGE' },
  ],
  AttributeDefinitions: [
    { AttributeName: 'exportId',   AttributeType: 'S' },
    { AttributeName: 'exportDate', AttributeType: 'S' },
    { AttributeName: 'country',    AttributeType: 'S' },
    { AttributeName: 'product',    AttributeType: 'S' },
  ],
  BillingMode: 'PAY_PER_REQUEST',
  StreamSpecification: { StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES' },
  GlobalSecondaryIndexes: [
    {
      IndexName: 'Country-Date-index',
      KeySchema: [
        { AttributeName: 'country',    KeyType: 'HASH'  },
        { AttributeName: 'exportDate', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    {
      IndexName: 'Product-Date-index',
      KeySchema: [
        { AttributeName: 'product',    KeyType: 'HASH'  },
        { AttributeName: 'exportDate', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
  ],
})

const exportItems = []
let exportSeq = 1
for (const country of COUNTRIES) {
  for (const product of PRODUCTS) {
    // 25 export events spread over 3 years
    for (let d = 0; d < 25; d++) {
      const daysBack = rndInt(0, 1095)  // up to 3 years
      const date     = isoDate(daysAgo(daysBack))
      const basePrice = BASE_PRICES[product]
      const qty       = rndInt(100, 10_000)
      const pricePerUnit = jitter(basePrice, 0.25)
      const buyerCountry = pick(COUNTRIES.filter(c => c !== country))
      const statusRoll   = Math.random()
      const status = statusRoll > 0.85 ? 'rejected'
                   : statusRoll > 0.6  ? 'customs'
                   : statusRoll > 0.2  ? 'delivered'
                   : 'shipped'

      exportItems.push({
        exportId:    { S: `EXP-${country}-${product}-${String(exportSeq++).padStart(6,'0')}` },
        exportDate:  { S: date },
        country:     { S: country },
        product:     { S: product },
        buyerCountry:{ S: buyerCountry },
        quantity:    { N: String(qty) },
        unitOfMeasure: { S: UNITS[product] ?? 'units' },
        valueUSD:    { N: String(Math.round(qty * pricePerUnit)) },
        pricePerUnit:{ N: String(Math.round(pricePerUnit * 100) / 100) },
        status:      { S: status },
        currency:    { S: 'USD' },
        portOfOrigin:{ S: `${country}-main-port` },
        inspected:   { BOOL: Math.random() > 0.3 },
      })
    }
  }
}

console.log(`\n[ExportTransactions] Creating ${exportItems.length} rows...`)
await batchWrite('ExportTransactions', exportItems)
console.log(`  ✓ ${exportItems.length} rows`)

// ─────────────────────────────────────────────────────────────────────────────
// TABLE 2: ProductPrices
// pk=product (S), sk=priceDate (ISO string)
// ~2 000 rows — 20 products × 100 daily price points over 3 years
// ─────────────────────────────────────────────────────────────────────────────

await dropAndCreate({
  TableName: 'ProductPrices',
  KeySchema: [
    { AttributeName: 'product',   KeyType: 'HASH'  },
    { AttributeName: 'priceDate', KeyType: 'RANGE' },
  ],
  AttributeDefinitions: [
    { AttributeName: 'product',    AttributeType: 'S' },
    { AttributeName: 'priceDate',  AttributeType: 'S' },
    { AttributeName: 'volatility', AttributeType: 'S' },
  ],
  BillingMode: 'PAY_PER_REQUEST',
  GlobalSecondaryIndexes: [
    {
      IndexName: 'Volatility-Date-index',
      KeySchema: [
        { AttributeName: 'volatility', KeyType: 'HASH'  },
        { AttributeName: 'priceDate',  KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
  ],
})

const priceItems = []
for (const product of PRODUCTS) {
  let currentPrice = BASE_PRICES[product]
  // 100 price snapshots, roughly weekly over ~2 years
  for (let i = 0; i < 100; i++) {
    const daysBack = i * 7 + rndInt(0, 3)
    const date     = isoDate(daysAgo(daysBack))
    const change   = (Math.random() - 0.5) * 0.08  // ±4% weekly change
    currentPrice   = currentPrice * (1 + change)
    const changeAbs = Math.round(currentPrice * change * 100) / 100
    const vol       = Math.abs(change) < 0.02 ? 'low' : Math.abs(change) < 0.04 ? 'medium' : 'high'

    priceItems.push({
      product:      { S: product },
      priceDate:    { S: date },
      priceUSD:     { N: String(Math.round(currentPrice * 100) / 100) },
      priceEUR:     { N: String(Math.round(currentPrice * 0.92 * 100) / 100) },
      changePercent:{ N: String(Math.round(change * 10000) / 100) },
      changeAbsUSD: { N: String(changeAbs) },
      volatility:   { S: vol },
      volume:       { N: String(rndInt(10_000, 500_000)) },
      source:       { S: pick(['bloomberg', 'reuters', 'spot', 'exchange']) },
      currency:     { S: 'USD' },
    })
  }
}

console.log(`\n[ProductPrices] Creating ${priceItems.length} rows...`)
await batchWrite('ProductPrices', priceItems)
console.log(`  ✓ ${priceItems.length} rows`)

// ─────────────────────────────────────────────────────────────────────────────
// TABLE 3: CountryMetrics
// pk=country (S), sk=reportDate (ISO string, monthly)
// ~360 rows — 10 countries × 36 months
// ─────────────────────────────────────────────────────────────────────────────

await dropAndCreate({
  TableName: 'CountryMetrics',
  KeySchema: [
    { AttributeName: 'country',    KeyType: 'HASH'  },
    { AttributeName: 'reportDate', KeyType: 'RANGE' },
  ],
  AttributeDefinitions: [
    { AttributeName: 'country',    AttributeType: 'S' },
    { AttributeName: 'reportDate', AttributeType: 'S' },
  ],
  BillingMode: 'PAY_PER_REQUEST',
})

const CURRENCIES_MAP = { US:'USD', MX:'MXN', BR:'BRL', DE:'EUR', FR:'EUR',
                          JP:'JPY', CN:'CNY', IN:'INR', GB:'GBP', AU:'AUD' }
const EXCHANGE_RATES = { USD:1, MXN:17.2, BRL:5.0, EUR:0.92, JPY:149,
                          CNY:7.25, INR:83, GBP:0.79, AUD:1.55 }

const metricItems = []
for (const country of COUNTRIES) {
  let gdp = rnd(2, 8)  // % growth
  let tradeBalance = rnd(-200, 200) * 1e9
  const currency = CURRENCIES_MAP[country]
  for (let m = 35; m >= 0; m--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - m)
    const date = d.toISOString().slice(0, 10)  // YYYY-MM-DD first of month
    gdp         = gdp + (Math.random() - 0.5) * 0.5
    tradeBalance = tradeBalance * 1.02 + rnd(-10, 10) * 1e9

    metricItems.push({
      country:         { S: country },
      reportDate:      { S: date },
      gdpGrowthPct:    { N: String(Math.round(gdp * 100) / 100) },
      exportVolumeUSD: { N: String(Math.round(Math.abs(tradeBalance) * 0.5)) },
      importVolumeUSD: { N: String(Math.round(Math.abs(tradeBalance) * 0.45)) },
      tradeBalanceUSD: { N: String(Math.round(tradeBalance)) },
      inflationPct:    { N: String(Math.round(rnd(1, 9) * 100) / 100) },
      currency:        { S: currency },
      exchangeRateUSD: { N: String(EXCHANGE_RATES[currency] ?? 1) },
      unemploymentPct: { N: String(Math.round(rnd(3, 12) * 100) / 100) },
    })
  }
}

console.log(`\n[CountryMetrics] Creating ${metricItems.length} rows...`)
await batchWrite('CountryMetrics', metricItems)
console.log(`  ✓ ${metricItems.length} rows`)

// ─────────────────────────────────────────────────────────────────────────────
// TABLE 4: TradeTariffs
// pk=tradeRoute (S "US-MX"), sk=effectiveDate (ISO string)
// ~500 rows — 35 routes × ~14 versions each
// ─────────────────────────────────────────────────────────────────────────────

await dropAndCreate({
  TableName: 'TradeTariffs',
  KeySchema: [
    { AttributeName: 'tradeRoute',    KeyType: 'HASH'  },
    { AttributeName: 'effectiveDate', KeyType: 'RANGE' },
  ],
  AttributeDefinitions: [
    { AttributeName: 'tradeRoute',    AttributeType: 'S' },
    { AttributeName: 'effectiveDate', AttributeType: 'S' },
    { AttributeName: 'product',       AttributeType: 'S' },
  ],
  BillingMode: 'PAY_PER_REQUEST',
  GlobalSecondaryIndexes: [
    {
      IndexName: 'Product-Route-index',
      KeySchema: [
        { AttributeName: 'product',    KeyType: 'HASH'  },
        { AttributeName: 'tradeRoute', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
  ],
})

const tariffItems = []
for (const route of TRADE_ROUTES) {
  const [fromCountry] = route.split('-')
  let tariffRate = rnd(0, 25)  // base tariff %
  // ~14 historical versions
  for (let v = 13; v >= 0; v--) {
    const daysBack = v * 90 + rndInt(0, 30)  // quarterly revisions
    const date     = isoDate(daysAgo(daysBack))
    const product  = v % 3 === 0 ? 'ALL' : pick(PRODUCTS)  // some tariffs are product-specific
    const change   = (Math.random() - 0.5) * 5
    tariffRate     = Math.max(0, Math.min(50, tariffRate + change))
    const status   = tariffRate > 40 ? 'suspended'
                   : v === 0 ? 'active'
                   : Math.random() > 0.7 ? 'expired' : 'active'

    tariffItems.push({
      tradeRoute:    { S: route },
      effectiveDate: { S: date },
      product:       { S: product },
      tariffRatePct: { N: String(Math.round(tariffRate * 100) / 100) },
      status:        { S: status },
      fromCountry:   { S: fromCountry },
      toCountry:     { S: route.split('-')[1] },
      agreementRef:  { S: `AGREE-${route.replace('-','')}` },
      retroactive:   { BOOL: Math.random() > 0.8 },
      notes:         { S: status === 'suspended' ? 'Under WTO review' : 'Normal trade terms' },
    })
  }
}

console.log(`\n[TradeTariffs] Creating ${tariffItems.length} rows...`)
await batchWrite('TradeTariffs', tariffItems)
console.log(`  ✓ ${tariffItems.length} rows`)

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`
✓ Financial seed complete!

Tables:
  ExportTransactions  ${exportItems.length} rows  pk=exportId  sk=exportDate (ISO)
                      GSI: Country-Date-index, Product-Date-index
  ProductPrices       ${priceItems.length} rows  pk=product   sk=priceDate  (ISO)
                      GSI: Volatility-Date-index
  CountryMetrics      ${metricItems.length} rows  pk=country   sk=reportDate (ISO)
  TradeTariffs        ${tariffItems.length} rows  pk=tradeRoute sk=effectiveDate (ISO)
                      GSI: Product-Route-index

Key query patterns:
  # US exports of steel in 2024 (GSI Country-Date-index)
  country = "US", exportDate begins_with "2024-", product = "steel"

  # Price volatility spike days (GSI Volatility-Date-index)
  volatility = "high", priceDate BETWEEN "2024-01-01" AND "2024-12-31"

  # Active tariffs on US-MX route
  tradeRoute = "US-MX", effectiveDate begins_with current-year

  # Cross-join: US steel exports × steel prices on same date
  ExportTransactions (country=US, product=steel) × ProductPrices (product=steel)
  Join key: exportDate = priceDate → revenue = quantity × priceUSD

Run financial tests:
  npm run test:suite-financial
`)
