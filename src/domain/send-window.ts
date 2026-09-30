import { addDays, bangkokNow } from './validation';

// Patients are not messaged at night. Automatic notices only go out between start and end
// (Bangkok time, HH:mm); one raised outside the window waits for the next opening.
export type SendWindow = { start: string; end: string };
export const DEFAULT_WINDOW: SendWindow = { start: '07:00', end: '20:00' };
export const hhmm = (value: unknown) => String(value ?? '').slice(0, 5);

export function inSendWindow(window: SendWindow, now = new Date()) {
  const { clock } = bangkokNow(now);
  return clock >= hhmm(window.start) && clock < hhmm(window.end);
}
// UTC DATETIME string at which a notice raised at `now` may be sent; null means right away
// (the database clock decides, so a job is never held back by a few ms of clock skew).
export function nextSendTime(window: SendWindow, now = new Date()): string | null {
  if (inSendWindow(window, now)) return null;
  const { day, clock } = bangkokNow(now);
  const openDay = clock < hhmm(window.start) ? day : addDays(day, 1);
  return mysqlUtc(new Date(`${openDay}T${hhmm(window.start)}:00+07:00`));
}
export const mysqlUtc = (d: Date) => d.toISOString().slice(0, 23).replace('T', ' ');
