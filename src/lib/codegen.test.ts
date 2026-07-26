import { describe, it, expect } from 'vitest'
import { generateCli, generateTypeScript, generatePython, generatePartiQL } from './codegen'
import type { QueryDef } from '@/types'

const BASE_DEF: QueryDef = {
  connectionId: 'test',
  table: 'MyTable',
  partitionKeyField: 'pk',
  filters: [
    { id: '1', field: 'pk', op: '=', value: 'USER#123' },
  ],
  limit: 50,
}

describe('generateCli', () => {
  it('generates a basic query command', () => {
    const code = generateCli(BASE_DEF, 'my-profile', 'us-east-1')
    expect(code).toContain('aws dynamodb query')
    expect(code).toContain('--table-name "MyTable"')
    expect(code).toContain('pk = :v0')
    expect(code).toContain(':v0')
    expect(code).toContain('--profile "my-profile"')
    expect(code).toContain('--region "us-east-1"')
  })

  it('generates scan when isScan=true', () => {
    const code = generateCli(BASE_DEF, undefined, undefined, true)
    expect(code).toContain('aws dynamodb scan')
    expect(code).not.toContain('--key-condition-expression')
  })

  it('handles reserved word aliasing', () => {
    const def: QueryDef = {
      ...BASE_DEF,
      filters: [
        { id: '1', field: 'pk', op: '=', value: 'x' },
        { id: '2', field: 'status', op: '=', value: 'ACTIVE' },
      ],
    }
    const code = generateCli(def)
    expect(code).toContain('#status')
    expect(code).toContain('--expression-attribute-names')
  })

  it('handles between operator', () => {
    const def: QueryDef = {
      ...BASE_DEF,
      filters: [
        { id: '1', field: 'pk', op: '=', value: 'USER#123' },
        { id: '2', field: 'createdAt', op: 'between', value: '2026-01-01', valueEnd: '2026-12-31' },
      ],
    }
    const code = generateCli(def)
    expect(code).toContain('BETWEEN')
  })

  it('handles IN operator', () => {
    const def: QueryDef = {
      ...BASE_DEF,
      filters: [
        { id: '1', field: 'pk', op: '=', value: 'x' },
        { id: '2', field: 'type', op: 'in', value: 'A, B, C' },
      ],
    }
    const code = generateCli(def)
    expect(code).toContain('IN (')
  })

  it('handles exists/not_exists without value', () => {
    const def: QueryDef = {
      ...BASE_DEF,
      filters: [
        { id: '1', field: 'pk', op: '=', value: 'x' },
        { id: '2', field: 'genres', op: 'exists', value: '' },
      ],
    }
    const code = generateCli(def)
    expect(code).toContain('attribute_exists')
    expect(code).not.toContain('attribute_values')
  })

  it('includes index when indexName is set', () => {
    const def: QueryDef = { ...BASE_DEF, indexName: 'myIndex' }
    const code = generateCli(def)
    expect(code).toContain('--index-name "myIndex"')
  })

  it('handles numeric values as N type', () => {
    const def: QueryDef = {
      ...BASE_DEF,
      filters: [
        { id: '1', field: 'pk', op: '=', value: 'x' },
        { id: '2', field: 'score', op: '>', value: '90' },
      ],
    }
    const code = generateCli(def)
    expect(code).toContain('"N"')
  })

  it('handles boolean values', () => {
    const def: QueryDef = {
      ...BASE_DEF,
      filters: [
        { id: '1', field: 'pk', op: '=', value: 'x' },
        { id: '2', field: 'isActive', op: '=', value: 'true' },
      ],
    }
    const code = generateCli(def)
    expect(code).toContain('"BOOL"')
  })
})

describe('generateTypeScript', () => {
  it('generates valid TypeScript with imports', () => {
    const code = generateTypeScript(BASE_DEF, 'us-east-2')
    expect(code).toContain('import { DynamoDBClient, QueryCommand }')
    expect(code).toContain('DynamoDBClient')
    expect(code).toContain('new DynamoDBClient')
    expect(code).toContain('us-east-2')
    expect(code).toContain('TableName: "MyTable"')
  })

  it('generates ScanCommand for scan', () => {
    const code = generateTypeScript(BASE_DEF, undefined, true)
    expect(code).toContain('ScanCommand')
    expect(code).not.toContain('QueryCommand')
  })
})

describe('generatePython', () => {
  it('generates valid Python boto3 code', () => {
    const code = generatePython(BASE_DEF, 'eu-west-1')
    expect(code).toContain('import boto3')
    expect(code).toContain('boto3.client("dynamodb"')
    expect(code).toContain('eu-west-1')
    expect(code).toContain('TableName="MyTable"')
    expect(code).toContain('.query(')
  })

  it('generates scan for isScan=true', () => {
    const code = generatePython(BASE_DEF, undefined, true)
    expect(code).toContain('.scan(')
  })
})

describe('generatePartiQL', () => {
  it('generates basic SELECT', () => {
    const code = generatePartiQL(BASE_DEF)
    expect(code).toContain('SELECT * FROM "MyTable"')
    expect(code).toContain('WHERE')
    expect(code).toContain('LIMIT 50')
  })

  it('uses index in table reference', () => {
    const def: QueryDef = { ...BASE_DEF, indexName: 'myIndex' }
    const code = generatePartiQL(def)
    expect(code).toContain('"MyTable"."myIndex"')
  })

  it('handles begins_with as function', () => {
    const def: QueryDef = {
      ...BASE_DEF,
      filters: [
        { id: '1', field: 'pk', op: 'begins_with', value: 'USER#' },
      ],
    }
    const code = generatePartiQL(def)
    expect(code).toContain('begins_with')
  })
})
