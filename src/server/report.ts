import { z } from 'zod';
import { readReportAppointments, visitCharges, NO_CLINIC, sourceReader, type SourceReader } from './hosxp';
import { activeStatus } from './sync';
import { addDays, AppError, bangkokNow, date, ensure } from '../domain/validation';

// Wraps HOSxP read errors in a message that names the tables the report needs.
const reportReader = (read: SourceReader): SourceReader => async (sql, values) => {
  try { return await read(sql, values); }
  catch (error) {
    if (error instanceof AppError) throw error;
    console.error({ code: 'HOSXP_REPORT', message: error instanceof Error ? error.message.slice(0, 200) : '' });
    throw new AppError(503, 'HOSXP_REPORT', 'อ่านรายงานจาก HOSxP ไม่ได้ (oapp, opitemrece, nondrugitems, ovstdiag, icd101)');
  }
};
const round = (v: number) => Math.round(v * 100) / 100;
export const REPORT_MAX_DAYS = 31;

// Read live from HOSxP: appointments in the period, whether the patient came (oapp.visit_vn),
// and for every visit the money billed per procedure and its ICD-10 codes.
export async function appointmentReport(params: URLSearchParams, read: SourceReader = sourceReader) {
  const today = bangkokNow().day;
  const from = date.parse(params.get('from') || addDays(today, -6)), to = date.parse(params.get('to') || today);
  ensure(from <= to && to <= addDays(from, REPORT_MAX_DAYS - 1), `เลือกช่วงวันที่ได้ไม่เกิน ${REPORT_MAX_DAYS} วัน`);
  const clinic = z.string().trim().max(20).parse(params.get('clinic') ?? '');
  const reader = reportReader(read);
  const data = (await readReportAppointments({ from, to }, reader))
    .filter(a => (!clinic || a.clinic_code === clinic) && (a.visit_vn || activeStatus(a.source_status_id)));
  const charges = await visitCharges(data.map(a => a.visit_vn), reader);
  const rows = data.map(a => {
    const charge = a.visit_vn ? charges.get(a.visit_vn) : undefined;
    return { oapp_id: a.oapp_id, hn: a.hn, patient_name: a.patient_name, clinic_code: a.clinic_code, clinic_name: a.clinic_name,
      appointment_date: a.appointment_date, status: a.visit_vn ? 'ATTENDED' : a.appointment_date >= today ? 'PENDING' : 'MISSED',
      visit_vn: a.visit_vn, amount: a.visit_vn ? charge?.amount ?? 0 : null, procedures: charge?.procedures ?? [], icd10: charge?.icd10 ?? [] };
  });
  type Row = typeof rows[number];
  // One visit can serve several appointments on the same day: its money is counted once.
  const amount = (list: Row[]) => round([...new Map(list.filter(a => a.visit_vn).map(a => [a.visit_vn, a.amount ?? 0])).values()].reduce((t, v) => t + v, 0));
  const count = (list: Row[]) => ({ appointments: list.length, attended: list.filter(a => a.status === 'ATTENDED').length,
    pending: list.filter(a => a.status === 'PENDING').length, missed: list.filter(a => a.status === 'MISSED').length, amount: amount(list) });
  const clinics = [...new Set(rows.map(a => a.clinic_code))].map(code => {
    const list = rows.filter(a => a.clinic_code === code);
    return { code, name: list[0].clinic_name || (code === NO_CLINIC ? 'ไม่ระบุคลินิก' : code), ...count(list) };
  }).sort((a, b) => b.amount - a.amount || b.appointments - a.appointments);
  const byProcedure = new Map<string, { name: string; visits: number; qty: number; amount: number }>();
  for (const charge of new Map(rows.filter(a => a.visit_vn).map(a => [a.visit_vn, charges.get(a.visit_vn!)])).values())
    for (const p of charge?.procedures ?? []) {
      const total = byProcedure.get(p.name) ?? byProcedure.set(p.name, { name: p.name, visits: 0, qty: 0, amount: 0 }).get(p.name)!;
      total.visits++; total.qty += p.qty; total.amount = round(total.amount + p.amount);
    }
  const byIcd10 = new Map<string, { code: string; name: string; visits: number; amount: number }>();
  for (const a of new Map(rows.filter(a => a.visit_vn).map(a => [a.visit_vn, a])).values()) {
    // Money is attributed to the principal diagnosis (first ICD-10 of the visit).
    const main = a.icd10[0]; if (!main) continue;
    const total = byIcd10.get(main.code) ?? byIcd10.set(main.code, { ...main, visits: 0, amount: 0 }).get(main.code)!;
    total.visits++; total.amount = round(total.amount + (a.amount ?? 0));
  }
  return { from, to, summary: count(rows), clinics, procedures: [...byProcedure.values()].sort((a, b) => b.amount - a.amount),
    icd10: [...byIcd10.values()].sort((a, b) => b.amount - a.amount), rows: rows.map(a => ({ ...a, visit_vn: undefined })) };
}
