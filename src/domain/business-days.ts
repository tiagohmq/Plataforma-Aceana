/** Soma n dias úteis a uma data (YYYY-MM-DD), pulando sábado, domingo e feriados. */
export function addBusinessDays(start: string, n: number, holidays: Set<string>): string {
  const d = new Date(`${start}T12:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) left--;
  }
  return d.toISOString().slice(0, 10);
}
