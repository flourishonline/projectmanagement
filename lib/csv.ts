/**
 * A small, exact CSV reader and writer (RFC 4180).
 *
 * Written rather than pulled in because both directions matter here — the seed
 * script reads client data typed by hand in a spreadsheet, and the billing
 * export has to paste cleanly into one. Quoting bugs in either direction are
 * the kind that go unnoticed until an invoice is wrong.
 */

export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  // Strip a UTF-8 byte order mark, which Excel writes and which would
  // otherwise become part of the first header name.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input

  while (i < text.length) {
    const char = text[i]!

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }

    if (char === '"') {
      inQuotes = true
      i += 1
      continue
    }

    if (char === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }

    if (char === '\r' || char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += char === '\r' && text[i + 1] === '\n' ? 2 : 1
      continue
    }

    field += char
    i += 1
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

/** Parses into objects keyed by the header row, trimming header names. */
export function parseCsvRecords(input: string): Array<Record<string, string>> {
  const rows = parseCsv(input).filter((row) => row.some((cell) => cell.trim() !== ''))
  const header = rows.shift()
  if (!header) return []

  const keys = header.map((name) => name.trim())
  return rows.map((row) => {
    const record: Record<string, string> = {}
    keys.forEach((key, index) => {
      record[key] = (row[index] ?? '').trim()
    })
    return record
  })
}

export function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  const lines = [header.map(csvEscape).join(',')]
  for (const row of rows) {
    lines.push(row.map((cell) => csvEscape(cell as string)).join(','))
  }
  // CRLF, because that is what spreadsheets expect on every platform.
  return `${lines.join('\r\n')}\r\n`
}
