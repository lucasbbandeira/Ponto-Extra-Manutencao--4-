import { jsPDF } from 'jspdf'
import { selectReport } from './report.ts'
import { formatDate, formatMinutes, monthName, overtimeStart } from './time.ts'
import type { Entry, Profile } from './types.ts'

let fontPromise: Promise<string> | undefined
async function fontData() {
  if (!fontPromise) fontPromise = (async () => {
    const response = await fetch(new URL('fonts/PontoExtra.ttf', document.baseURI))
    if (!response.ok) throw new Error('Não foi possível carregar a fonte do PDF. Atualize a página e tente novamente.')
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return btoa(binary)
  })().catch(error => { fontPromise = undefined; throw error })
  return fontPromise
}

// O PDF usa a mesma seleção e os minutos já registrados do Excel, sem recalcular o histórico.
export async function makePdfReport(entries: Entry[], profiles: Profile[], period: string, workerId = '', fontBase64?: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Escolha um mês válido.')
  const { selectedWorkers, approved } = selectReport(entries, profiles, period, workerId)
  if (!approved.length) throw new Error('Não há lançamentos aprovados para esta seleção.')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true })
  doc.addFileToVFS('PontoExtra.ttf', fontBase64 ?? await fontData())
  doc.addFont('PontoExtra.ttf', 'PontoExtra', 'normal')
  doc.setFont('PontoExtra')
  doc.setProperties({ title: 'Relatório de horas extras com justificativas', author: 'Ponto Extra · Manutenção' })
  const [year, month] = period.split('-')
  const periodLabel = `${monthName(Number(month))} de ${year}`
  const width = 178, left = 16, bottom = 276
  let y = 16, person = '', context = ''
  function header() {
    doc.setTextColor(26, 49, 63); doc.setFontSize(16)
    doc.text('PONTO EXTRA · MANUTENÇÃO', left, 18)
    doc.setFontSize(10); doc.text(`Horas aprovadas · ${periodLabel}`, left, 26)
    doc.setDrawColor(220, 225, 230); doc.line(left, 30, 194, 30)
    y = 39
    doc.setFontSize(12)
    for (const line of doc.splitTextToSize(person, width) as string[]) { doc.text(line, left, y); y += 6 }
    if (context) { doc.setFontSize(9); doc.text(context, left, y + 1); y += 8 }
    y += 3
  }
  function newPage() { doc.addPage(); header() }
  function ensure(height: number) { if (y + height > bottom) newPage() }
  function write(text: string, size = 10, lineHeight = 5) {
    doc.setFontSize(size)
    const lines = doc.splitTextToSize(text.replace(/\t/g, '    '), width) as string[]
    for (const line of lines) {
      ensure(lineHeight)
      doc.setFontSize(size); doc.setTextColor(38, 46, 55)
      doc.text(line, left, y); y += lineHeight
    }
  }
  const included = selectedWorkers.filter(p => approved.some(e => e.worker_id === p.id))
  included.forEach((worker, workerIndex) => {
    person = worker.full_name; context = ''
    if (workerIndex) doc.addPage()
    header()
    const own = approved.filter(e => e.worker_id === worker.id)
    own.forEach((entry, index) => {
      context = ''
      ensure(57)
      const label = `Lançamento ${String(index + 1).padStart(2, '0')} · ${formatDate(entry.work_date)}`
      write(`${label} · ${entry.is_holiday ? 'Feriado' : 'Dia normal'}`, 11, 6)
      write(`Entrada normal: ${entry.is_holiday ? 'Não se aplica' : entry.normal_entry?.slice(0, 5) || 'Não informada'}`)
      write(`Saída normal: ${entry.is_holiday ? 'Não se aplica' : entry.point_exit?.slice(0, 5) || 'Não informada'}`)
      write(`Hora extra: ${overtimeStart(entry)} até ${entry.final_exit.slice(0, 5)}${entry.final_exit_next_day ? ' (dia seguinte)' : ''} · Total: ${formatMinutes(entry.minutes)}`)
      write('Justificativa / descrição do serviço:', 10, 6)
      context = `${label} · justificativa (continuação)`
      write(entry.note?.trim() || 'Não informada no registro original.')
      context = ''
      y += 4; ensure(4); doc.setDrawColor(225, 229, 232); doc.line(left, y, 194, y); y += 8
    })
    ensure(16)
    write(`Total de ${worker.full_name}: ${formatMinutes(own.reduce((sum, entry) => sum + entry.minutes, 0))}`, 11, 6)
    write(`${own.length} lançamento(s) aprovado(s).`, 9)
  })
  context = ''; ensure(18); y += 5
  write(`TOTAL GERAL: ${formatMinutes(approved.reduce((sum, entry) => sum + entry.minutes, 0))}`, 12, 6)
  write(`${approved.length} lançamento(s) aprovado(s) no período.`, 9)
  const count = doc.getNumberOfPages()
  for (let page = 1; page <= count; page++) {
    doc.setPage(page); doc.setFontSize(8); doc.setTextColor(100, 110, 120)
    doc.text(`Ponto Extra · ${periodLabel} · Somente horas aprovadas`, left, 287)
    doc.text(`Página ${page} de ${count}`, 194, 287, { align: 'right' })
  }
  const suffix = workerId ? `_${included[0].full_name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 100)}` : ''
  return { filename: `Horas_extras${suffix}_${period}_justificativas.pdf`, blob: doc.output('blob') }
}
