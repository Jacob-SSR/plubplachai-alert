import mysql, { type RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { addDays, date, ensure } from '../domain/validation';

const globalHosxp = globalThis as unknown as { alertHosxpPool?: mysql.Pool };
function hosxpPool() {
  ensure(process.env.HOSXP_DB_HOST && process.env.HOSXP_DB_NAME && process.env.HOSXP_DB_USER,
    'ยังไม่ได้ตั้งค่าการอ่านฐานข้อมูล HOSxP', 503, 'HOSXP_NOT_CONFIGURED');
  if (globalHosxp.alertHosxpPool) return globalHosxp.alertHosxpPool;
  globalHosxp.alertHosxpPool = mysql.createPool({
    host: process.env.HOSXP_DB_HOST,
    port: z.coerce.number().int().min(1).max(65535).parse(process.env.HOSXP_DB_PORT ?? '3306'),
    database: process.env.HOSXP_DB_NAME, user: process.env.HOSXP_DB_USER,
    password: process.env.HOSXP_DB_PASSWORD,
    charset: process.env.HOSXP_DB_CHARSET || 'tis620',
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
    connectionLimit: 2, queueLimit: 20, connectTimeout: 10000, multipleStatements: false,
  });
  return globalHosxp.alertHosxpPool;
}
export async function closeHosxpPool() {
  const active = globalHosxp.alertHosxpPool;
  globalHosxp.alertHosxpPool = undefined;
  if (active) await active.end();
}

type Values = (string | number)[];
export type SourceReader = (sql: string, values: Values) => Promise<Record<string, unknown>[]>;
export const sourceReader: SourceReader = async (sql, values) => {
  const [result] = await hosxpPool().execute<RowDataPacket[]>({ sql, values, timeout: 20000 });
  return result as Record<string, unknown>[];
};

export const NO_CLINIC = '-';
export type SourceAppointment = {
  oapp_id: string; hn: string; patient_name: string; clinic_code: string; clinic_name: string;
  appointment_date: string; appointment_time: string | null; location: string; doctor_name: string;
  source_status_id: string | null;
};
const str = (v: unknown) => v == null ? '' : String(v).trim();
// Explicit projection: no CID, diagnosis or notes leave this function.
export function toAppointment(row: Record<string, unknown>): SourceAppointment {
  return {
    oapp_id: String(row.oapp_id), hn: str(row.hn),
    patient_name: [str(row.fname), str(row.lname)].filter(Boolean).join(' '),
    clinic_code: str(row.clinic) || NO_CLINIC, clinic_name: str(row.clinic_name),
    appointment_date: String(row.nextdate).slice(0, 10), appointment_time: row.nexttime ? String(row.nexttime).slice(0, 8) : null,
    location: str(row.contact_point) || str(row.department_name), doctor_name: str(row.doctor_name),
    source_status_id: row.oapp_status_id == null ? null : String(row.oapp_status_id),
  };
}
const APPOINTMENT_SQL = `SELECT o.oapp_id,o.hn,o.nextdate,o.nexttime,o.clinic,c.name clinic_name,o.contact_point,o.oapp_status_id,
  k.department department_name,d.name doctor_name,p.fname,p.lname
  FROM oapp o LEFT JOIN patient p ON p.hn=o.hn LEFT JOIN clinic c ON c.clinic=o.clinic
  LEFT JOIN doctor d ON d.code=o.doctor LEFT JOIN kskdepartment k ON k.depcode=o.depcode`;
export const CHUNK_DAYS = 7, CHUNK_LIMIT = 20000;

// Read only. Every patient appointment in [from, to], all clinics, read one week at a time
// so a large hospital never pulls everything in one query.
export async function readAppointments(range: { from: string; to: string }, read: SourceReader = sourceReader) {
  const from = date.parse(range.from), to = date.parse(range.to);
  ensure(from <= to && to <= addDays(from, 400), 'ช่วงวันที่นัดไม่ถูกต้อง');
  const result: SourceAppointment[] = [];
  for (let start = from; start <= to; start = addDays(start, CHUNK_DAYS)) {
    const end = addDays(start, CHUNK_DAYS - 1) < to ? addDays(start, CHUNK_DAYS - 1) : to;
    const rows = await read(`${APPOINTMENT_SQL} WHERE o.nextdate BETWEEN ? AND ? ORDER BY o.nextdate,o.oapp_id LIMIT ${CHUNK_LIMIT + 1}`, [start, end]);
    ensure(rows.length <= CHUNK_LIMIT, `นัดช่วง ${start} ถึง ${end} มีมากเกิน ${CHUNK_LIMIT} รายการ`, 422, 'HOSXP_TOO_MANY');
    result.push(...rows.map(toAppointment));
  }
  return result;
}
export async function readAppointment(oappId: string, read: SourceReader = sourceReader) {
  ensure(/^\d{1,20}$/.test(oappId), 'รหัสนัดไม่ถูกต้อง');
  const [row] = await read(`${APPOINTMENT_SQL} WHERE o.oapp_id=?`, [oappId]);
  return row ? toAppointment(row) : null;
}

// HOSxP keeps the ticked boxes of the appointment screen as lines of text in the oapp row:
// note2 / lab_list_text = LAB items, note1 / perform_text = preparation instructions.
const lines = (...values: unknown[]) => [...new Set(values.flatMap(v => typeof v === 'string' ? v.split(/\r?\n/) : [])
  .map(s => s.trim()).filter(Boolean))];
export const tickedLabs = (row: Record<string, unknown>) => lines(row.note2, row.lab_list_text);
export const preparationNotes = (row: Record<string, unknown>) => lines(row.note1, row.perform_text).filter(s => !/^อื่น\s*ๆ?$/.test(s));

// Everything the notice needs at send time, read live: the current appointment, the patient's CID
// and the ticked LAB/preparation lines. o.* is used because note columns differ between HOSxP versions.
export async function readForNotice(oappId: string, read: SourceReader = sourceReader) {
  ensure(/^\d{1,20}$/.test(oappId), 'รหัสนัดไม่ถูกต้อง');
  const [row] = await read(`SELECT o.*,c.name clinic_name,k.department department_name,d.name doctor_name,p.fname,p.lname,p.cid patient_cid
    FROM oapp o LEFT JOIN patient p ON p.hn=o.hn LEFT JOIN clinic c ON c.clinic=o.clinic
    LEFT JOIN doctor d ON d.code=o.doctor LEFT JOIN kskdepartment k ON k.depcode=o.depcode WHERE o.oapp_id=?`, [oappId]);
  if (!row) return null;
  const tests = [...new Set([...tickedLabs(row), ...(await labOrderItems(oappId, read))])];
  return { appointment: toAppointment(row), cid: str(row.patient_cid), tests, preparation: preparationNotes(row) };
}
// A cancelled appointment may already be gone from oapp, so its notice looks the patient up by HN.
export async function readPatient(hn: string, read: SourceReader = sourceReader) {
  const [row] = await read('SELECT fname,lname,cid FROM patient WHERE hn=?', [hn]);
  return row ? { name: [str(row.fname), str(row.lname)].filter(Boolean).join(' '), cid: str(row.cid) } : null;
}

// LAB items ordered with the appointment (LAB order form). A missing table or read error never blocks
// the notice; the items are just left out.
const LAB_ITEM_QUERIES = [
  `SELECT DISTINCT s.lab_name name FROM lab_app_head h JOIN lab_app_order_service s ON s.lab_app_order_number=h.lab_app_order_number WHERE h.oapp_id=?`,
  `SELECT DISTINCT i.lab_items_name name FROM lab_app_head h JOIN lab_app_order o ON o.lab_app_order_number=h.lab_app_order_number
    JOIN lab_items i ON i.lab_items_code=o.lab_items_code WHERE h.oapp_id=?`,
];
async function labOrderItems(oappId: string, read: SourceReader) {
  const names: string[] = [];
  for (const sql of LAB_ITEM_QUERIES) {
    try { for (const row of await read(sql, [oappId])) { const name = str(row.name); if (name && !names.includes(name)) names.push(name); } }
    catch (error) { console.error({ code: 'HOSXP_LAB_ITEMS', message: error instanceof Error ? error.message.slice(0, 200) : '' }); }
  }
  return names;
}

// Whether appointments still exist in HOSxP and their status, to tell a real cancellation (row deleted
// or status changed) from one that only left the monitored range. A read error throws, so no
// cancellation notice is ever sent on uncertain data.
export async function oappSourceState(oappIds: string[], read: SourceReader = sourceReader) {
  const map = new Map<string, { status: unknown; date: string }>();
  const ids = [...new Set(oappIds.map(String))].filter(id => /^\d{1,20}$/.test(id));
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const found = await read(`SELECT oapp_id,oapp_status_id,nextdate FROM oapp WHERE oapp_id IN (${batch.map(() => '?').join(',')})`, batch);
    for (const row of found) map.set(String(row.oapp_id), { status: row.oapp_status_id, date: String(row.nextdate).slice(0, 10) });
  }
  return map;
}

// Report: every appointment in [from, to] with the visit HOSxP linked to it when the patient came (visit_vn).
export type ReportAppointment = { oapp_id: string; hn: string; patient_name: string; clinic_code: string; clinic_name: string;
  appointment_date: string; source_status_id: string | null; visit_vn: string | null };
export async function readReportAppointments(range: { from: string; to: string }, read: SourceReader = sourceReader) {
  const result: ReportAppointment[] = [];
  for (let start = range.from; start <= range.to; start = addDays(start, CHUNK_DAYS)) {
    const end = addDays(start, CHUNK_DAYS - 1) < range.to ? addDays(start, CHUNK_DAYS - 1) : range.to;
    const rows = await read(`SELECT o.oapp_id,o.hn,o.nextdate,o.clinic,c.name clinic_name,o.oapp_status_id,o.visit_vn,p.fname,p.lname
      FROM oapp o LEFT JOIN patient p ON p.hn=o.hn LEFT JOIN clinic c ON c.clinic=o.clinic
      WHERE o.nextdate BETWEEN ? AND ? ORDER BY o.nextdate,o.oapp_id LIMIT ${CHUNK_LIMIT + 1}`, [start, end]);
    ensure(rows.length <= CHUNK_LIMIT, `นัดช่วง ${start} ถึง ${end} มีมากเกิน ${CHUNK_LIMIT} รายการ`, 422, 'HOSXP_TOO_MANY');
    result.push(...rows.map(row => ({ oapp_id: String(row.oapp_id), hn: str(row.hn),
      patient_name: [str(row.fname), str(row.lname)].filter(Boolean).join(' '),
      clinic_code: str(row.clinic) || NO_CLINIC, clinic_name: str(row.clinic_name),
      appointment_date: String(row.nextdate).slice(0, 10),
      source_status_id: row.oapp_status_id == null ? null : String(row.oapp_status_id), visit_vn: str(row.visit_vn) || null })));
  }
  return result;
}

// What each visit was charged, per procedure, and its ICD-10 codes. Read only, by VN.
// Procedures = non-drug items billed in the visit (opitemrece -> nondrugitems); drugs are left out.
// ICD-10 = ovstdiag codes named from icd101 (Thai name first); ICD-9 operation codes (all digits) are left out.
export type VisitCharge = { amount: number; procedures: { name: string; qty: number; amount: number }[]; icd10: { code: string; name: string }[] };
const money = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
export async function visitCharges(vns: (string | null | undefined)[], read: SourceReader = sourceReader) {
  const map = new Map<string, VisitCharge>();
  const ids = [...new Set(vns.map(v => str(v)))].filter(v => /^[0-9A-Za-z]{1,20}$/.test(v));
  const get = (vn: string) => map.get(vn) ?? map.set(vn, { amount: 0, procedures: [], icd10: [] }).get(vn)!;
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200), marks = batch.map(() => '?').join(',');
    for (const row of await read(`SELECT o.vn,o.icode,n.name,SUM(o.qty) qty,SUM(o.sum_price) amount
      FROM opitemrece o JOIN nondrugitems n ON n.icode=o.icode WHERE o.vn IN (${marks})
      GROUP BY o.vn,o.icode,n.name ORDER BY o.vn,n.name`, batch)) {
      const v = get(String(row.vn)), amount = money(row.amount);
      v.procedures.push({ name: str(row.name) || str(row.icode), qty: Number(row.qty) || 0, amount });
      v.amount = money(v.amount + amount);
    }
    for (const row of await read(`SELECT d.vn,d.icd10 code,COALESCE(NULLIF(i.tname,''),i.name) name FROM ovstdiag d LEFT JOIN icd101 i ON i.code=d.icd10
      WHERE d.vn IN (${marks}) ORDER BY d.vn,d.diagtype,d.icd10`, batch)) {
      const code = str(row.code).toUpperCase(), v = get(String(row.vn));
      if (/^[A-Z]\d/.test(code) && !v.icd10.some(c => c.code === code)) v.icd10.push({ code, name: str(row.name) });
    }
  }
  return map;
}

export async function readClinics(read: SourceReader = sourceReader) {
  const found = await read('SELECT clinic,name FROM clinic ORDER BY clinic', []);
  return found.map(row => ({ code: str(row.clinic), name: str(row.name) })).filter(c => c.code && c.code.length <= 20);
}
