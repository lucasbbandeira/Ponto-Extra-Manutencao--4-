export function overtimeMinutes(pointExit: string, finalExit: string, nextDay: boolean): number {
  const parse = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number)
    return hours * 60 + minutes
  }
  return parse(finalExit) + (nextDay ? 1440 : 0) - parse(pointExit)
}

export function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

export function validOvertime(pointExit: string, finalExit: string, nextDay: boolean): boolean {
  if (!/^\d{2}:\d{2}$/.test(pointExit) || !/^\d{2}:\d{2}$/.test(finalExit)) return false
  const minutes = overtimeMinutes(pointExit, finalExit, nextDay)
  return minutes >= 1 && minutes <= 960
}

export function localToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(value))
}

export function monthName(month: number): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(2024, month - 1, 1))
}
