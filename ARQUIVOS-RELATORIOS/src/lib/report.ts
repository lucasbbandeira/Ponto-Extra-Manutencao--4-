import { formatDate, formatMinutes, monthName } from './time.ts'
import type { Entry, Profile } from './types.ts'

type Cell = string | number | null
const encoder = new TextEncoder()

const xml = (value: unknown) => String(value ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const colLetter = (number: number) => {
  let col = number; let letter = ''
  while (col) { letter = String.fromCharCode(65 + (col - 1) % 26) + letter; col = Math.floor((col - 1) / 26) }
  return letter
}

function cellXml(value: Cell, row: number, column: number, style?: number) {
  if (value === null && style === undefined) return ''
  const address = `${colLetter(column)}${row}`; const styleAttr = style === undefined ? '' : ` s="${style}"`
  if (value === null || value === '') return `<c r="${address}"${styleAttr}/>`
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${address}"${styleAttr}><v>${value}</v></c>`
  return `<c r="${address}"${styleAttr} t="inlineStr"><is><t>${xml(value)}</t></is></c>`
}

function sheetXml(rows: Cell[][], styles: Array<Array<number | undefined>>, options: {
  cols: string; merges?: string[]; autoFilter?: string; freezeRows?: number
}) {
  const rowXml = rows.map((row, ri) => `<row r="${ri + 1}">${row.map((value, ci) => cellXml(value, ri + 1, ci + 1, styles[ri]?.[ci])).join('')}</row>`).join('')
  const merges = options.merges?.length
    ? `<mergeCells count="${options.merges.length}">${options.merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : ''
  const freeze = options.freezeRows
    ? `<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="${options.freezeRows}" topLeftCell="A${options.freezeRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>'
  const filter = options.autoFilter ? `<autoFilter ref="${options.autoFilter}"/>` : ''
  // SpreadsheetML requires autoFilter before mergeCells (CT_Worksheet sequence).
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}<sheetFormatPr defaultRowHeight="18"/><cols>${options.cols}</cols><sheetData>${rowXml}</sheetData>${filter}${merges}</worksheet>`
}

function emptyGrid(rows: number, cols: number) {
  return {
    values: Array.from({ length: rows }, () => Array<Cell>(cols).fill(null)),
    styles: Array.from({ length: rows }, () => Array<number | undefined>(cols).fill(undefined)),
  }
}

function setRowStyle(styles: Array<Array<number | undefined>>, row: number, style: number, from = 0, to = styles[row].length) {
  for (let col = from; col < to; col++) styles[row][col] = style
}

// A prévia e o Excel usam a mesma seleção, sempre pelo ID do usuário.
export function selectReport(entries: Entry[], profiles: Profile[], period: string, workerId = '') {
  const approvedWorkerIds = new Set(entries.filter(e => e.status === 'approved').map(e => e.worker_id))
  // Inclui contas desativadas ou com cargo alterado que ainda tenham horas aprovadas.
  const workers = profiles.filter(p => p.role === 'maintainer' || approvedWorkerIds.has(p.id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR') || a.id.localeCompare(b.id))
  const selectedWorkers = workerId ? workers.filter(p => p.id === workerId) : workers
  const selectedIds = new Set(selectedWorkers.map(p => p.id))
  const approved = entries.filter(e => e.status === 'approved' && e.work_date.startsWith(`${period}-`) && selectedIds.has(e.worker_id))
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.point_exit.localeCompare(b.point_exit) || a.worker_id.localeCompare(b.worker_id))
  return { workers, selectedWorkers, approved }
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Aptos Narrow"/><color theme="1"/></font><font><b/><sz val="11"/><name val="Aptos Narrow"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="18"/><name val="Aptos Narrow"/><color rgb="FFFFFFFF"/></font><font><sz val="11"/><name val="Aptos Narrow"/><color rgb="FF667085"/></font><font><b/><sz val="11"/><name val="Aptos Narrow"/><color rgb="FF203040"/></font></fonts>
<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF111820"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F1F9"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellStyleXfs>
<cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="4" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/><xf numFmtId="164" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

function safeSheetName(name: string, used: Set<string>) {
  const base = name.toUpperCase().replace(/[\\/*?:\[\]\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31).replace(/^'+|'+$/g, '').trim() || 'MANUTENTOR'; let candidate = base; let number = 2
  while (used.has(candidate)) { const suffix = ` ${number++}`; candidate = `${base.slice(0, 31 - suffix.length)}${suffix}` }
  used.add(candidate); return candidate
}

function buildPersonSheet(person: Profile, own: Entry[], period: string) {
  const bodyCount = Math.max(17, own.length); const totalRow = 8 + bodyCount; const { values, styles } = emptyGrid(totalRow, 6)
  values[3][1] = 'CONTROLE DE HORAS EXTRAS'; values[4][1] = `Período: ${monthName(Number(period.slice(5)))} de ${period.slice(0, 4)}. Preenchimento gerado após aprovação.`; values[5][1] = person.full_name.toUpperCase(); values[6][1] = 'DATA'; values[6][2] = 'ENTRADA'; values[6][3] = 'SAÍDA'
  setRowStyle(styles, 3, 1, 1, 6); setRowStyle(styles, 4, 2, 1, 6); setRowStyle(styles, 5, 8, 1, 6); setRowStyle(styles, 6, 3, 1, 4)
  for (let i = 0; i < bodyCount; i++) { const e = own[i]; if (e) values[7 + i] = [null, formatDate(e.work_date), e.point_exit.slice(0, 5), `${e.final_exit.slice(0, 5)}${e.final_exit_next_day ? ' (+1 dia)' : ''}`, null, null]; styles[7 + i][1] = 4; styles[7 + i][2] = 4; styles[7 + i][3] = 4 }
  values[totalRow - 1][1] = 'TOTAL'; values[totalRow - 1][3] = formatMinutes(own.reduce((sum, e) => sum + e.minutes, 0)); setRowStyle(styles, totalRow - 1, 7, 1, 4)
  return sheetXml(values, styles, { cols: '<col min="1" max="1" width="3"/><col min="2" max="2" width="19"/><col min="3" max="4" width="16"/><col min="5" max="6" width="22"/>', merges: ['B4:F4', 'B5:F5', 'B6:F6'], autoFilter: `B7:D${totalRow - 1}` })
}

// ZIP sem compressão: o arquivo é pequeno e não depende de bibliotecas externas no navegador.
function zip(files: [string, string][]): Uint8Array {
  const chunks: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0
  const u16 = (v: number, out: number[], at: number) => { out[at] = v & 255; out[at + 1] = (v >>> 8) & 255 }; const u32 = (v: number, out: number[], at: number) => { u16(v, out, at); u16(v >>> 16, out, at + 2) }
  const crc32 = (bytes: Uint8Array) => { let c = -1; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0) } return (c ^ -1) >>> 0 }
  for (const [name, text] of files) { const filename = encoder.encode(name); const data = encoder.encode(text); const crc = crc32(data); const local = Array(30 + filename.length).fill(0); u32(0x04034b50, local, 0); u16(20, local, 4); u16(0, local, 6); u16(0, local, 8); u32(crc, local, 14); u32(data.length, local, 18); u32(data.length, local, 22); u16(filename.length, local, 26); local.splice(30, filename.length, ...filename); const directory = Array(46 + filename.length).fill(0); u32(0x02014b50, directory, 0); u16(20, directory, 4); u16(20, directory, 6); u16(0, directory, 8); u16(0, directory, 10); u32(crc, directory, 16); u32(data.length, directory, 20); u32(data.length, directory, 24); u16(filename.length, directory, 28); u32(offset, directory, 42); directory.splice(46, filename.length, ...filename); chunks.push(Uint8Array.from(local), data); central.push(Uint8Array.from(directory)); offset += local.length + data.length }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0); const end = Array(22).fill(0); u32(0x06054b50, end, 0); u16(files.length, end, 8); u16(files.length, end, 10); u32(centralSize, end, 12); u32(offset, end, 16); const all = [...chunks, ...central, Uint8Array.from(end)]; const result = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0)); let position = 0; for (const part of all) { result.set(part, position); position += part.length }; return result
}

export function makeReport(entries: Entry[], profiles: Profile[], period: string, workerId = ''): { filename: string; blob: Blob } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Escolha um mês válido para gerar a planilha.')
  const { selectedWorkers, approved } = selectReport(entries, profiles, period, workerId)
  if (!selectedWorkers.length) throw new Error('O manutentor selecionado não está disponível para gerar o relatório.')
  if (!approved.length) throw new Error('Não há lançamentos aprovados para o mês e manutentor selecionados.')
  const usedNames = new Set<string>()
  const sheets = selectedWorkers.map(person => ({ name: safeSheetName(person.full_name, usedNames), xml: buildPersonSheet(person, approved.filter(e => e.worker_id === person.id), period) }))
  const sheetEntries = sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join(''); const relationships = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join(''); const overrides = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
  const files: [string, string][] = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets><calcPr calcMode="auto"/></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', stylesXml], ...sheets.map((sheet, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheet.xml] as [string, string]),
  ]
  const bytes = zip(files); const [year, month] = period.split('-').map(Number)
  const personName = selectedWorkers[0].full_name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 120) || 'Manutentor'
  const personSuffix = workerId ? `_${personName}` : ''
  return { filename: `Horas_extras${personSuffix}_${monthName(month).replace(/\s/g, '_')}_${year}.xlsx`, blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) }
}
