export function getPeriodDayCount(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return 30;
  return new Date(year, month, 0).getDate();
}

export function getMonthDays(period: string) {
  return Array.from({ length: getPeriodDayCount(period) }, (_, index) => index + 1);
}

export function currentMonthPeriod() {
  return new Date().toISOString().slice(0, 7);
}

export function monthDate(period: string, day: number) {
  return `${period}-${String(day).padStart(2, "0")}`;
}

export function formatPeriodLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return period;
  return new Date(year, month - 1, 1, 12).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
}

export function formatPeriodDay(period: string, day: number) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return `${String(day).padStart(2, "0")}/${period}`;
  return new Date(year, month - 1, day, 12).toLocaleDateString("es-AR");
}

const WEEKDAY_ABBR = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function getWeekdayAbbr(period: string, day: number) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return "";
  return WEEKDAY_ABBR[new Date(year, month - 1, day, 12).getDay()];
}
