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

function approvedRows(entries: Entry[], _profiles: Profile[], period: string) {
  return entries.filter(e => e.status === 'approved' && e.work_date.startsWith(period))
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.worker_id.localeCompare(b.worker_id))
}

export function reportRows(entries: Entry[], profiles: Profile[], period: string): { summary: Cell[][]; details: Cell[][] } {
  const approved = approvedRows(entries, profiles, period)
  const workers = profiles.filter(p => p.role === 'maintainer' || approved.some(e => e.worker_id === p.id)).sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))
  const summary: Cell[][] = [['Manutentor', 'Lançamentos aprovados', 'Total (minutos)', 'Total (horas)']]
  for (const person of workers) {
    const own = approved.filter(e => e.worker_id === person.id); const minutes = own.reduce((sum, e) => sum + e.minutes, 0)
    summary.push([person.full_name, own.length, minutes, Number((minutes / 60).toFixed(2))])
  }
  const total = approved.reduce((sum, e) => sum + e.minutes, 0)
  summary.push(['TOTAL GERAL', approved.length, total, Number((total / 60).toFixed(2))])
  const details: Cell[][] = [['Manutentor', 'Data', 'Entrada normal', 'Batida do ponto', 'Saída final', 'Dia seguinte?', 'Minutos extras', 'Horas decimais', 'Observação', 'Enviado em', 'Aprovado em', 'Aprovado por']]
  for (const e of approved) details.push([
    profiles.find(p => p.id === e.worker_id)?.full_name ?? 'Usuário', formatDate(e.work_date), e.normal_entry?.slice(0, 5) ?? '', e.point_exit.slice(0, 5), e.final_exit.slice(0, 5), e.final_exit_next_day ? 'Sim' : 'Não', e.minutes, Number((e.minutes / 60).toFixed(2)), e.note,
    new Date(e.submitted_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), e.reviewed_at ? new Date(e.reviewed_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '', profiles.find(p => p.id === e.reviewed_by)?.full_name ?? '',
  ])
  return { summary, details }
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Aptos Narrow"/><color theme="1"/></font><font><b/><sz val="11"/><name val="Aptos Narrow"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="18"/><name val="Aptos Narrow"/><color rgb="FFFFFFFF"/></font><font><sz val="11"/><name val="Aptos Narrow"/><color rgb="FF667085"/></font><font><b/><sz val="11"/><name val="Aptos Narrow"/><color rgb="FF203040"/></font></fonts>
<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF111820"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F1F9"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellStyleXfs>
<cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="4" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/><xf numFmtId="164" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

function buildMainSheet(entries: Entry[], profiles: Profile[], period: string) {
  const approved = approvedRows(entries, profiles, period); const rowCount = Math.max(34, approved.length + 4); const { values, styles } = emptyGrid(rowCount, 16)
  values[0][0] = 'CONTROLE DE HORAS EXTRAS'; values[1][0] = `Período: ${monthName(Number(period.slice(5)))} de ${period.slice(0, 4)}. Entrada = batida de saída do ponto normal. Apenas horas aprovadas.`
  values[3] = ['Data', 'Matrícula', 'Funcionário', 'Setor', 'Entrada', 'Saída', 'Intervalo (h)', 'Jornada padrão (h)', 'Horas trabalhadas', 'Horas extras', 'Tipo', 'HE 50%', 'HE 100%', 'Motivo', 'Aprovado por', 'Status']
  setRowStyle(styles, 0, 1); setRowStyle(styles, 1, 2); setRowStyle(styles, 3, 3)
  const bodyStyles = [4, 4, 5, 5, 4, 4, 4, 5, 9, 9, 4, 9, 9, 4, 4, 6]; const workers = new Map(profiles.map(p => [p.id, p]))
  for (let i = 0; i < rowCount - 4; i++) {
    const e = approved[i]; const row = 4 + i; const person = e ? workers.get(e.worker_id) : undefined
    if (e) { const hours = Number((e.minutes / 60).toFixed(2)); values[row] = [formatDate(e.work_date), '', person?.full_name ?? 'Usuário', '', e.point_exit.slice(0, 5), `${e.final_exit.slice(0, 5)}${e.final_exit_next_day ? ' (+1 dia)' : ''}`, 0, 0, hours, hours, '50%', hours, 0, e.note, workers.get(e.reviewed_by ?? '')?.full_name ?? '', 'Aprovada'] }
    styles[row] = [...bodyStyles]
  }
  return sheetXml(values, styles, { cols: '<col min="1" max="1" width="12"/><col min="2" max="2" width="13"/><col min="3" max="4" width="24"/><col min="5" max="6" width="12"/><col min="7" max="8" width="18"/><col min="9" max="10" width="16"/><col min="11" max="11" width="9"/><col min="12" max="13" width="11"/><col min="14" max="14" width="34"/><col min="15" max="15" width="22"/><col min="16" max="16" width="13"/>', merges: ['A1:P1', 'A2:P2'], autoFilter: `A4:P${rowCount}`, freezeRows: 4 })
}

function buildCadastro(profiles: Profile[], entries: Entry[], period: string) {
  const approved = approvedRows(entries, profiles, period); const people = profiles.filter(p => p.role === 'maintainer' || approved.some(e => e.worker_id === p.id)).sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))
  const rowCount = Math.max(24, people.length + 4); const { values, styles } = emptyGrid(rowCount, 6)
  values[0][0] = 'CADASTRO DE FUNCIONÁRIOS'; values[1][0] = 'Os horários normais variam por pessoa; a hora extra começa na batida de saída do ponto.'; values[3] = ['Matrícula', 'Funcionário', 'Setor', 'Cargo', 'Jornada diária (h)', 'Ativo?']
  setRowStyle(styles, 0, 1); setRowStyle(styles, 1, 2); setRowStyle(styles, 3, 3)
  for (let i = 0; i < rowCount - 4; i++) { const person = people[i]; if (person) values[4 + i] = ['', person.full_name, '', 'Manutentor', '', person.active ? 'Sim' : 'Não']; styles[4 + i] = Array(6).fill(4) }
  return sheetXml(values, styles, { cols: '<col min="1" max="1" width="15"/><col min="2" max="2" width="29"/><col min="3" max="4" width="18"/><col min="5" max="5" width="22"/><col min="6" max="6" width="12"/>', merges: ['A1:F1', 'A2:F2'], autoFilter: `A4:F${rowCount}`, freezeRows: 4 })
}

function safeSheetName(name: string, used: Set<string>) {
  const base = (name.toUpperCase().replace(/[\\/*?:\[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'MANUTENTOR').slice(0, 31); let candidate = base; let number = 2
  while (used.has(candidate)) { const suffix = ` ${number++}`; candidate = `${base.slice(0, 31 - suffix.length)}${suffix}` }
  used.add(candidate); return candidate
}

function buildPersonSheet(person: Profile, entries: Entry[], profiles: Profile[], period: string) {
  const own = approvedRows(entries, profiles, period).filter(e => e.worker_id === person.id); const bodyCount = Math.max(17, own.length); const totalRow = 8 + bodyCount; const { values, styles } = emptyGrid(totalRow, 6)
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

export function makeReport(entries: Entry[], profiles: Profile[], period: string): { filename: string; blob: Blob } {
  const approved = approvedRows(entries, profiles, period); const workers = profiles.filter(p => p.role === 'maintainer' || approved.some(e => e.worker_id === p.id)).sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR')); const usedNames = new Set(['Lançamentos', 'Cadastro'])
  const sheets = [{ name: 'Lançamentos', xml: buildMainSheet(entries, profiles, period) }, { name: 'Cadastro', xml: buildCadastro(profiles, entries, period) }, ...workers.map(person => ({ name: safeSheetName(person.full_name, usedNames), xml: buildPersonSheet(person, entries, profiles, period) }))]
  const sheetEntries = sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join(''); const relationships = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join(''); const overrides = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
  const files: [string, string][] = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets><calcPr calcMode="auto"/></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', stylesXml], ...sheets.map((sheet, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheet.xml] as [string, string]),
  ]
  const bytes = zip(files); const [year, month] = period.split('-').map(Number)
  return { filename: `Horas_extras_${monthName(month).replace(/\s/g, '_')}_${year}.xlsx`, blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) }
}
