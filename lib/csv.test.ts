import { describe, expect, it } from 'vitest'
import { parseCsv, parseCsvRecords, toCsv } from './csv'

describe('reading CSV', () => {
  it('reads plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('keeps commas and newlines inside quoted fields', () => {
    expect(parseCsv('name,note\n"Acme, Inc.","line one\nline two"')).toEqual([
      ['name', 'note'],
      ['Acme, Inc.', 'line one\nline two'],
    ])
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\n"He said ""hi"""')).toEqual([['a'], ['He said "hi"']])
  })

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('strips the byte order mark Excel writes', () => {
    expect(parseCsv('﻿client,project\nAcme,Site')).toEqual([
      ['client', 'project'],
      ['Acme', 'Site'],
    ])
  })

  it('maps rows onto the header and drops blank lines', () => {
    const records = parseCsvRecords('client, project \nAcme, Retainer \n\n')
    expect(records).toEqual([{ client: 'Acme', project: 'Retainer' }])
  })

  it('tolerates short rows', () => {
    expect(parseCsvRecords('a,b,c\n1,2')).toEqual([{ a: '1', b: '2', c: '' }])
  })
})

describe('writing CSV', () => {
  it('quotes only what needs quoting', () => {
    expect(toCsv(['client', 'hours'], [['Acme', 3.25]])).toBe('client,hours\r\nAcme,3.25\r\n')
  })

  it('escapes commas, quotes and newlines', () => {
    expect(toCsv(['note'], [['Said "hi", then left']])).toBe(
      'note\r\n"Said ""hi"", then left"\r\n',
    )
  })

  it('renders empty cells for null and undefined', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\r\n,\r\n')
  })

  it('round-trips through the reader', () => {
    const csv = toCsv(['client', 'note'], [['Acme, Inc.', 'line one\nline two']])
    expect(parseCsvRecords(csv)).toEqual([{ client: 'Acme, Inc.', note: 'line one\nline two' }])
  })
})
