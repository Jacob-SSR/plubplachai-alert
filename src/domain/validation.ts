import { z } from 'zod';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function ensure(condition: unknown, message: string, status = 422, code = 'VALIDATION') : asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
export const id = z.coerce.number().int().positive();
export const text = (max = 255) => z.string().trim().min(1, 'กรุณากรอกข้อมูล').max(max);
export function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export const date = z.string().refine(isDate, 'วันที่ต้องเป็น ค.ศ. YYYY-MM-DD และมีอยู่จริง');
export const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'เวลา HH:mm');
// HN as stored in HOSxP: digits, optionally with letters or dashes. Never a CID.
export const hn = z.string().trim().regex(/^[A-Za-z0-9-]{1,20}$/, 'HN ใช้ตัวเลข อักษรอังกฤษ หรือ - ไม่เกิน 20 ตัว');
export function bangkokNow(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const clock = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
  return {day,clock};
}
export function addDays(day:string,n:number) { return new Date(new Date(day+'T00:00:00Z').getTime()+n*86400000).toISOString().slice(0,10); }
export function validCid(cid:string) {
  return /^\d{13}$/.test(cid) && (11-[...cid.slice(0,12)].reduce((sum,d,i)=>sum+Number(d)*(13-i),0)%11)%10===Number(cid[12]);
}
