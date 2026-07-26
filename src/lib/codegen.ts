// Code generation for DynamoDB operations.
// Given a QueryDef, generates AWS CLI, TypeScript SDK v3, Python boto3, and PartiQL.

import type { QueryDef } from '@/types'

// DynamoDB reserved words that need expression attribute name aliases.
const RESERVED = new Set([
  'name','status','type','value','key','data','size','date','time',
  'timestamp','count','sum','min','max','avg','first','last','next',
  'index','table','view','end','start','begin','in','is','not','and',
  'or','between','exists','contains','set','list','map','number',
  'string','boolean','null','true','false','uuid','id','hash','range',
  'order','limit','offset','desc','asc','group','by','where','from',
  'select','insert','update','delete','create','drop','alter','return',
  'location','language','comment','role','user','session','token',
  'action','resource','condition','policy','version','region','zone',
  'path','host','port','schema','database','column','row','item',
  'field','record','object','array','attributes','projection',
])

function needsAlias(field: string): boolean {
  return field.split('.').some(part => RESERVED.has(part.toLowerCase()))
}

function fieldAlias(field: string, nameMap: Map<string, string>): string {
  if (!needsAlias(field)) return field
  if (nameMap.has(field)) return nameMap.get(field)!
  const alias = `#${field.replace(/\./g, '_')}`
  nameMap.set(field, alias)
  return alias
}

function inferDynamoType(value: string): { type: 'S' | 'N' | 'BOOL' | 'NULL'; v: string } {
  if (value === 'true')  return { type: 'BOOL', v: 'true'  }
  if (value === 'false') return { type: 'BOOL', v: 'false' }
  if (value === 'null')  return { type: 'NULL', v: 'null'  }
  if (!isNaN(Number(value)) && value.trim() !== '') return { type: 'N', v: value }
  return { type: 'S', v: value }
}

function attrValueCli(value: string): string {
  const { type, v } = inferDynamoType(value)
  if (type === 'BOOL') return `{"BOOL": ${v}}`
  if (type === 'NULL') return `{"NULL": true}`
  if (type === 'N')    return `{"N": "${v}"}`
  return `{"S": "${v}"}`
}

function attrValueTs(value: string): string {
  const { type, v } = inferDynamoType(value)
  if (type === 'BOOL') return `{ BOOL: ${v} }`
  if (type === 'NULL') return `{ NULL: true }`
  if (type === 'N')    return `{ N: "${v}" }`
  return `{ S: "${v}" }`
}

function attrValuePy(value: string): string {
  const { type, v } = inferDynamoType(value)
  if (type === 'BOOL') return `{"BOOL": ${v === 'true' ? 'True' : 'False'}}`
  if (type === 'NULL') return `{"NULL": True}`
  if (type === 'N')    return `{"N": "${v}"}`
  return `{"S": "${v}"}`
}

interface ExpressionParts {
  keyCondition: string
  filterExpr:   string
  attrNames:    Record<string, string>
  attrValues:   Record<string, string>
}

function buildExpressionParts(def: QueryDef): ExpressionParts {
  const nameMap  = new Map<string, string>()
  const valueMap = new Map<string, string>()
  const keyParts: string[]    = []
  const filterParts: string[] = []

  let vIdx = 0
  const nextVal = () => `:v${vIdx++}`

  const pk = def.partitionKeyField ?? 'pk'
  const sk = def.sortKeyField

  const isKeyField = (field: string) =>
    field === pk || (sk != null && field === sk)

  for (const chip of def.filters) {
    const alias  = fieldAlias(chip.field, nameMap)
    const target = isKeyField(chip.field) ? keyParts : filterParts

    if (chip.op === 'exists')     { target.push(`attribute_exists(${alias})`);     continue }
    if (chip.op === 'not_exists') { target.push(`attribute_not_exists(${alias})`); continue }

    if (chip.op === 'between') {
      const v1 = nextVal(), v2 = nextVal()
      valueMap.set(v1, chip.value)
      valueMap.set(v2, chip.valueEnd ?? chip.value)
      target.push(`${alias} BETWEEN ${v1} AND ${v2}`)
      continue
    }

    if (chip.op === 'in') {
      const vals = chip.value.split(',').map(s => s.trim())
      const phs  = vals.map(v => { const p = nextVal(); valueMap.set(p, v); return p })
      target.push(`${alias} IN (${phs.join(', ')})`)
      continue
    }

    if (chip.op === 'begins_with') {
      const v = nextVal(); valueMap.set(v, chip.value)
      target.push(`begins_with(${alias}, ${v})`)
      continue
    }

    if (chip.op === 'contains') {
      const v = nextVal(); valueMap.set(v, chip.value)
      target.push(`contains(${alias}, ${v})`)
      continue
    }

    const v = nextVal(); valueMap.set(v, chip.value)
    target.push(`${alias} ${chip.op} ${v}`)
  }

  const attrNames: Record<string, string> = {}
  for (const [field, alias] of nameMap) attrNames[alias] = field

  const attrValues: Record<string, string> = {}
  for (const [ph, val] of valueMap) attrValues[ph] = val

  return {
    keyCondition: keyParts.join(' AND '),
    filterExpr:   filterParts.join(' AND '),
    attrNames,
    attrValues,
  }
}

// ── AWS CLI ───────────────────────────────────────────────────────────────────

export function generateCli(
  def: QueryDef,
  awsProfile?: string,
  awsRegion?: string,
  isScan = false,
): string {
  const parts = buildExpressionParts(def)
  const cmd   = isScan ? 'scan' : 'query'
  const lines: string[] = [`aws dynamodb ${cmd} \\`]

  lines.push(`  --table-name "${def.table}" \\`)
  if (def.indexName)          lines.push(`  --index-name "${def.indexName}" \\`)
  if (!isScan && parts.keyCondition)
    lines.push(`  --key-condition-expression "${parts.keyCondition}" \\`)
  if (parts.filterExpr)
    lines.push(`  --filter-expression "${parts.filterExpr}" \\`)

  if (Object.keys(parts.attrNames).length > 0)
    lines.push(`  --expression-attribute-names '${JSON.stringify(parts.attrNames)}' \\`)

  if (Object.keys(parts.attrValues).length > 0) {
    const valsObj: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(parts.attrValues))
      valsObj[k] = JSON.parse(attrValueCli(v))
    lines.push(`  --expression-attribute-values '${JSON.stringify(valsObj)}' \\`)
  }

  if (!isScan && def.scanIndexForward === false)
    lines.push(`  --no-scan-index-forward \\`)
  if (def.limit)      lines.push(`  --limit ${def.limit} \\`)
  if (awsProfile)     lines.push(`  --profile "${awsProfile}" \\`)
  if (awsRegion)      lines.push(`  --region "${awsRegion}"`)

  // Clean up last trailing backslash
  const last = lines[lines.length - 1]
  if (last.endsWith(' \\')) lines[lines.length - 1] = last.slice(0, -2)

  return lines.join('\n')
}

// ── TypeScript SDK v3 ─────────────────────────────────────────────────────────

export function generateTypeScript(
  def: QueryDef,
  awsRegion?: string,
  isScan = false,
): string {
  const parts = buildExpressionParts(def)
  const Cmd   = isScan ? 'ScanCommand'      : 'QueryCommand'
  const Input = isScan ? 'ScanCommandInput' : 'QueryCommandInput'

  const namesTs = Object.entries(parts.attrNames)
    .map(([a, n]) => `    "${a}": "${n}"`).join(',\n')
  const valsTs = Object.entries(parts.attrValues)
    .map(([p, v]) => `    "${p}": ${attrValueTs(v)}`).join(',\n')

  const lines = [
    `import { DynamoDBClient, ${Cmd} } from "@aws-sdk/client-dynamodb";`,
    `import type { ${Input} } from "@aws-sdk/client-dynamodb";`,
    '',
    `const client = new DynamoDBClient({ region: "${awsRegion ?? 'us-east-1'}" });`,
    '',
    `const params: ${Input} = {`,
    `  TableName: "${def.table}",`,
  ]

  if (def.indexName) lines.push(`  IndexName: "${def.indexName}",`)
  if (!isScan && parts.keyCondition)
    lines.push(`  KeyConditionExpression: "${parts.keyCondition}",`)
  if (parts.filterExpr)
    lines.push(`  FilterExpression: "${parts.filterExpr}",`)
  if (namesTs) lines.push(`  ExpressionAttributeNames: {\n${namesTs}\n  },`)
  if (valsTs)  lines.push(`  ExpressionAttributeValues: {\n${valsTs}\n  },`)
  if (!isScan && def.scanIndexForward === false) lines.push(`  ScanIndexForward: false,`)
  if (def.limit) lines.push(`  Limit: ${def.limit},`)

  lines.push('};', '')
  lines.push(`const result = await client.send(new ${Cmd}(params));`)
  lines.push(`console.log(result.Items);`)

  return lines.join('\n')
}

// ── Python boto3 ──────────────────────────────────────────────────────────────

export function generatePython(
  def: QueryDef,
  awsRegion?: string,
  isScan = false,
): string {
  const parts = buildExpressionParts(def)
  const fn    = isScan ? 'scan' : 'query'

  const namesPy = Object.entries(parts.attrNames)
    .map(([a, n]) => `    "${a}": "${n}"`).join(',\n')
  const valsPy = Object.entries(parts.attrValues)
    .map(([p, v]) => `    "${p}": ${attrValuePy(v)}`).join(',\n')

  const lines = [
    'import boto3',
    '',
    `dynamodb = boto3.client("dynamodb", region_name="${awsRegion ?? 'us-east-1'}")`,
    '',
    `response = dynamodb.${fn}(`,
    `    TableName="${def.table}",`,
  ]

  if (def.indexName) lines.push(`    IndexName="${def.indexName}",`)
  if (!isScan && parts.keyCondition)
    lines.push(`    KeyConditionExpression="${parts.keyCondition}",`)
  if (parts.filterExpr)
    lines.push(`    FilterExpression="${parts.filterExpr}",`)
  if (namesPy) lines.push(`    ExpressionAttributeNames={\n${namesPy}\n    },`)
  if (valsPy)  lines.push(`    ExpressionAttributeValues={\n${valsPy}\n    },`)
  if (!isScan && def.scanIndexForward === false) lines.push(`    ScanIndexForward=False,`)
  if (def.limit) lines.push(`    Limit=${def.limit},`)

  lines.push(')')
  lines.push('print(response["Items"])')

  return lines.join('\n')
}

// ── PartiQL ───────────────────────────────────────────────────────────────────

export function generatePartiQL(def: QueryDef, _isScan = false): string {
  function valueToPartiQL(v: string): string {
    const { type } = inferDynamoType(v)
    if (type === 'BOOL' || type === 'NULL' || type === 'N') return v
    return `'${v.replace(/'/g, "''")}'`
  }

  const conditions: string[] = []

  for (const chip of def.filters) {
    const f = chip.field
    if (chip.op === 'exists')     { conditions.push(`${f} IS NOT MISSING`); continue }
    if (chip.op === 'not_exists') { conditions.push(`${f} IS MISSING`);     continue }
    if (chip.op === 'between') {
      conditions.push(`${f} BETWEEN ${valueToPartiQL(chip.value)} AND ${valueToPartiQL(chip.valueEnd ?? chip.value)}`)
      continue
    }
    if (chip.op === 'in') {
      const vals = chip.value.split(',').map(s => valueToPartiQL(s.trim())).join(', ')
      conditions.push(`${f} IN [${vals}]`)
      continue
    }
    if (chip.op === 'begins_with') {
      conditions.push(`begins_with(${f}, ${valueToPartiQL(chip.value)})`); continue
    }
    if (chip.op === 'contains') {
      conditions.push(`contains(${f}, ${valueToPartiQL(chip.value)})`); continue
    }
    conditions.push(`${f} ${chip.op} ${valueToPartiQL(chip.value)}`)
  }

  const tablePart = def.indexName
    ? `"${def.table}"."${def.indexName}"`
    : `"${def.table}"`

  let sql = `SELECT * FROM ${tablePart}`
  if (conditions.length > 0) sql += `\nWHERE ${conditions.join('\n  AND ')}`
  if (def.limit) sql += `\nLIMIT ${def.limit}`

  return sql
}
