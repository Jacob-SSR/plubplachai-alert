import { randomUUID } from 'node:crypto';
import { rows, execute, transaction, type DB, type Row } from './db';
import { canonicalJson, sha256 } from './crypto';
import { addDays, bangkokNow } from '../domain/validation';
import { nextSendTime, type SendWindow } from '../domain/send-window';
import { NO_CLINIC, readAppointments, readAppointment, readClinics, oappSourceState, type SourceAppointment } from './hosxp';

export function fingerprint(a: SourceAppointment) {
  // Only what the patient sees; other edits in HOSxP do not send the notice again.
  return sha256(canonicalJson({ hn: a.hn, date: a.appointment_date, time: a.appointment_time,
    clinic: a.clinic_code, location: a.location, status: a.source_status_id }));
}
export function activeStatus(status: unknown) {
  // NULL and 1 are normal appointments in HOSxP. Other installations can add their active IDs.
  const accepted = ['NULL', '1', ...(process.env.HOSXP_ACTIVE_STATUS_IDS ?? '').split(',').map(s => s.trim())];
  return accepted.includes(status == null ? 'NULL' : String(status));
}
export function futureAppointment(day: string, time: string | null, now = new Date()) {
  const { day: today, clock } = bangkokNow(now);
  return time == null ? day >= today : `${day} ${time}` > `${today} ${clock}:00`;
}
export function syncDays() {
  const days = Number(process.env.HOSXP_SYNC_DAYS ?? 60);
  return Number.isInteger(days) && days >= 1 && days <= 366 ? days : 60;
}

type Settings = { enabled: boolean; notifyNew: boolean; notifyCancel: boolean; window: SendWindow };
async function loadSettings(db: DB): Promise<Settings> {
  const [s] = await rows<Row>('SELECT * FROM notification_settings WHERE id=1', [], db);
  return { enabled: !!s?.enabled, notifyNew: !!s?.notify_new, notifyCancel: !!s?.notify_cancel,
    window: { start: String(s?.window_start ?? '07:00'), end: String(s?.window_end ?? '20:00') } };
}
export async function queueJob(db: DB, job: { oappId: string; version: number; kind: 'NEW' | 'CANCELLED' | 'MANUAL' | 'REMINDER';
  availableAt: string | null; dedupe?: string; ruleId?: number; requestedBy?: number; id?: string }) {
  const r = await execute(`INSERT IGNORE INTO notification_jobs(id,oapp_id,schedule_version,kind,dedupe_key,rule_id,requested_by,scheduled_at,available_at)
    VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(6),COALESCE(?,UTC_TIMESTAMP(6)))`, [job.id ?? randomUUID(), job.oappId, job.version, job.kind, job.dedupe ?? '',
    job.ruleId ?? null, job.requestedBy ?? null, job.availableAt], db);
  return r.affectedRows;
}
const cancelPending = (db: DB, oappId: string, reason: string) =>
  execute("UPDATE notification_jobs SET status='CANCELLED',safe_error=? WHERE oapp_id=? AND status IN ('PENDING','BLOCKED')", [reason, oappId], db);

export async function syncClinics(read = readClinics) {
  const clinics = await read();
  await transaction(async db => {
    await execute("INSERT IGNORE INTO clinics(code,name) VALUES(?,'ไม่ระบุคลินิก')", [NO_CLINIC], db);
    await execute('UPDATE clinics SET in_source=0 WHERE code<>?', [NO_CLINIC], db);
    for (const c of clinics) await execute('INSERT INTO clinics(code,name,in_source) VALUES(?,?,1) ON DUPLICATE KEY UPDATE name=VALUES(name),in_source=1', [c.code, c.name || c.code], db);
  });
  return clinics.length;
}

async function upsert(db: DB, a: SourceAppointment, fp: string, version: number, active: boolean) {
  await execute(`INSERT INTO appointments(oapp_id,hn,patient_name,clinic_code,appointment_date,appointment_time,location,doctor_name,source_status_id,fingerprint,schedule_version,active)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE hn=VALUES(hn),patient_name=VALUES(patient_name),clinic_code=VALUES(clinic_code),
    appointment_date=VALUES(appointment_date),appointment_time=VALUES(appointment_time),location=VALUES(location),doctor_name=VALUES(doctor_name),
    source_status_id=VALUES(source_status_id),fingerprint=VALUES(fingerprint),schedule_version=VALUES(schedule_version),active=VALUES(active)`,
  [a.oapp_id, a.hn, a.patient_name.slice(0, 255), a.clinic_code, a.appointment_date, a.appointment_time, a.location.slice(0, 255),
    a.doctor_name.slice(0, 255), a.source_status_id, fp, version, active], db);
}
async function ensureClinics(db: DB, data: SourceAppointment[]) {
  const seen = new Map(data.map(a => [a.clinic_code, a.clinic_name || (a.clinic_code === NO_CLINIC ? 'ไม่ระบุคลินิก' : a.clinic_code)]));
  for (const [code, name] of seen) await execute('INSERT IGNORE INTO clinics(code,name) VALUES(?,?)', [code, name], db);
}

// One sync round: HOSxP is the source of truth, this table is the last snapshot. The difference is
// what gets announced. The very first round only records a baseline, so existing appointments are not broadcast.
export async function syncAppointments(now = new Date(), readSource: typeof readAppointments = readAppointments,
  checkSource: (ids: string[]) => Promise<Map<string, { status: unknown }>> = oappSourceState) {
  const from = bangkokNow(now).day, to = addDays(from, syncDays());
  return transaction(async db => {
    // Serializes rounds across worker processes. Nothing is written to HOSxP.
    const [state] = await rows<Row>('SELECT * FROM sync_state WHERE id=1 FOR UPDATE', [], db);
    const data = await readSource({ from, to });
    const settings = await loadSettings(db);
    await ensureClinics(db, data);
    const enabled = new Set((await rows<{ code: string }>('SELECT code FROM clinics WHERE enabled=1', [], db)).map(c => c.code));
    const optedOut = new Set((await rows<{ hn: string }>('SELECT hn FROM patient_opt_outs', [], db)).map(o => o.hn));
    const previous = await rows<Row>('SELECT * FROM appointments WHERE active=1 OR appointment_date>=?', [from], db);
    const byId = new Map(previous.map(row => [String(row.oapp_id), row]));
    const announce = (a: { clinic_code: string; hn: string }) => !!state.initialized && settings.enabled && enabled.has(a.clinic_code) && !optedOut.has(a.hn);
    const availableAt = nextSendTime(settings.window, now);
    const seen = new Set<string>();
    let queued = 0;
    for (const a of data) {
      if (seen.has(a.oapp_id)) continue;
      seen.add(a.oapp_id);
      const old = byId.get(a.oapp_id), fp = fingerprint(a);
      const future = futureAppointment(a.appointment_date, a.appointment_time, now);
      const active = activeStatus(a.source_status_id) && future;
      // Cancelled in HOSxP: a future appointment whose status moved out of the active statuses.
      const cancelled = !!old?.active && !activeStatus(a.source_status_id) && future;
      if (old && old.fingerprint === fp && !!old.active === active) {
        if (old.patient_name !== a.patient_name || old.doctor_name !== a.doctor_name)
          await execute('UPDATE appointments SET patient_name=?,doctor_name=? WHERE oapp_id=?', [a.patient_name.slice(0, 255), a.doctor_name.slice(0, 255), a.oapp_id], db);
        continue;
      }
      const version = Number(old?.schedule_version ?? 0) + 1;
      await upsert(db, a, fp, version, active);
      if (old) await cancelPending(db, a.oapp_id, 'HOSXP_APPOINTMENT_CHANGED');
      if (active && settings.notifyNew && announce(a)) queued += await queueJob(db, { oappId: a.oapp_id, version, kind: 'NEW', availableAt });
      if (cancelled && settings.notifyCancel && announce(a)) queued += await queueJob(db, { oappId: a.oapp_id, version, kind: 'CANCELLED', dedupe: 'cancel', availableAt });
    }
    // Deleted in HOSxP, moved out of the monitored range, or simply past.
    const gone = previous.filter(old => old.active && !seen.has(String(old.oapp_id)));
    const future = gone.filter(old => futureAppointment(String(old.appointment_date).slice(0, 10), (old.appointment_time as string | null) ?? null, now));
    const wantCancel = future.filter(old => settings.notifyCancel && announce({ clinic_code: String(old.clinic_code), hn: String(old.hn) }));
    const source = wantCancel.length ? await checkSource(wantCancel.map(old => String(old.oapp_id))) : new Map();
    for (const old of gone) {
      const id = String(old.oapp_id), version = Number(old.schedule_version) + 1;
      await execute('UPDATE appointments SET active=0,schedule_version=? WHERE oapp_id=?', [version, id], db);
      await cancelPending(db, id, 'HOSXP_APPOINTMENT_REMOVED');
      // Only an appointment really gone from HOSxP (or no longer active there) is a cancellation.
      const inSource = source.get(id);
      if (wantCancel.includes(old) && (!inSource || !activeStatus(inSource.status)))
        queued += await queueJob(db, { oappId: id, version, kind: 'CANCELLED', dedupe: 'cancel', availableAt });
    }
    await execute('UPDATE sync_state SET initialized=1,last_success_at=UTC_TIMESTAMP(6),last_count=?,last_error=NULL WHERE id=1', [data.length], db);
    return { read: data.length, queued };
  });
}
export async function recordSyncError(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'SYNC_ERROR';
  await execute('UPDATE sync_state SET last_error=?,last_error_at=UTC_TIMESTAMP(6) WHERE id=1', [code.slice(0, 200)]);
}

// One appointment read live from HOSxP (for the manual send button). Stored like a sync round would,
// but no automatic notice is queued: the person pressing the button is sending one now.
export async function refreshAppointment(oappId: string, now = new Date(), read: typeof readAppointment = readAppointment) {
  const a = await read(oappId);
  if (!a) return null;
  const fp = fingerprint(a), active = activeStatus(a.source_status_id) && futureAppointment(a.appointment_date, a.appointment_time, now);
  await transaction(async db => {
    await ensureClinics(db, [a]);
    const [old] = await rows<Row>('SELECT fingerprint,schedule_version,active FROM appointments WHERE oapp_id=? FOR UPDATE', [a.oapp_id], db);
    if (old && old.fingerprint === fp && !!old.active === active) return;
    await upsert(db, a, fp, Number(old?.schedule_version ?? 0) + 1, active);
    if (old) await cancelPending(db, a.oapp_id, 'HOSXP_APPOINTMENT_CHANGED');
  });
  return a;
}
