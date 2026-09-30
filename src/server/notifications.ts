import { randomUUID } from 'node:crypto';
import { rows, execute, transaction, type Row } from './db';
import { ensure, bangkokNow, addDays, validCid } from '../domain/validation';
import { hhmm, inSendWindow, nextSendTime } from '../domain/send-window';
import { noticeMessage, plainMessage, TEST_NOTIFICATION_TEXT, type Notice, type NoticeKind } from '../domain/notice';
import { type Actor } from './auth';
import { audit } from './audit';
import { MophAlertProvider, type Delivery, type NotificationProvider } from '../providers/moph-alert';
import { readForNotice, readPatient } from './hosxp';
import { activeStatus, fingerprint, futureAppointment, queueJob, refreshAppointment } from './sync';

export async function notificationSettings() {
  const [settings] = await rows('SELECT * FROM notification_settings WHERE id=1');
  const [sync] = await rows('SELECT initialized,last_success_at,last_error,last_error_at,last_count FROM sync_state WHERE id=1');
  return { ...settings, sync, rules: await rows('SELECT * FROM notification_rules ORDER BY days_before DESC'),
    credentialConfigured: !!(process.env.MOPH_CLIENT_KEY && process.env.MOPH_SECRET_KEY), serverLiveEnabled: process.env.MOPH_LIVE_ENABLED === 'true' };
}
const windowOf = (s: Row) => ({ start: hhmm(s.window_start), end: hhmm(s.window_end) });

// Reminder N days before the appointment, once per rule and schedule version, for enabled clinics only.
// Skipped when the first notice for the same version went out in the last 12 hours.
export async function scheduleReminders(now = new Date()) {
  const [settings] = await rows<Row>('SELECT * FROM notification_settings WHERE id=1'); if (!settings?.enabled) return 0;
  const { day, clock } = bangkokNow(now); if (clock < hhmm(settings.reminder_time)) return 0;
  const availableAt = nextSendTime(windowOf(settings), now);
  let count = 0;
  for (const rule of await rows<Row>('SELECT * FROM notification_rules WHERE active=1')) {
    const r = await execute(`INSERT IGNORE INTO notification_jobs(id,oapp_id,schedule_version,kind,dedupe_key,rule_id,scheduled_at,available_at)
      SELECT UUID(),a.oapp_id,a.schedule_version,'REMINDER',?,?,UTC_TIMESTAMP(6),COALESCE(?,UTC_TIMESTAMP(6)) FROM appointments a JOIN clinics c ON c.code=a.clinic_code AND c.enabled=1
      WHERE a.active=1 AND a.appointment_date=? AND NOT EXISTS(SELECT 1 FROM patient_opt_outs o WHERE o.hn=a.hn)
      AND NOT EXISTS(SELECT 1 FROM notification_jobs n WHERE n.oapp_id=a.oapp_id AND n.schedule_version=a.schedule_version
        AND n.kind='NEW' AND n.created_at>DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 12 HOUR) AND n.status NOT IN ('CANCELLED','FAILED','BLOCKED'))`,
    [`d${Number(rule.days_before)}`, rule.id, availableAt, addDays(day, Number(rule.days_before))]);
    count += r.affectedRows;
  }
  return count;
}

export type DispatchDeps = { provider?: NotificationProvider; readNotice?: typeof readForNotice; readPerson?: typeof readPatient; now?: () => Date };
const statusOf = (d: Delivery) => d.outcome === 'ACCEPTED' ? 'ACCEPTED' : d.outcome === 'UNKNOWN' ? 'UNKNOWN' : d.outcome === 'NOT_SENT' ? 'BLOCKED' : 'FAILED';
const close = (jobId: string, status: string, error: string) =>
  execute("UPDATE notification_jobs SET status=?,safe_error=?,lease_until=NULL WHERE id=? AND status='SENDING'", [status, error, jobId]);

// Sends at most one due notice. manual=true: a person pressed send, so the on/off switch, DRY_RUN,
// the clinic switch and the night window do not apply. Opt-outs always apply.
export async function dispatchOne(deps: DispatchDeps = {}, jobId?: string, manual = false) {
  const provider = deps.provider ?? new MophAlertProvider(), now = deps.now?.() ?? new Date();
  // A lost worker lease is uncertain, never an automatic retry.
  await execute("UPDATE notification_jobs SET status='UNKNOWN',safe_error='WORKER_LEASE_EXPIRED' WHERE status='SENDING' AND lease_until<UTC_TIMESTAMP(6)");
  const claimed = await transaction(async db => {
    const [settings] = await rows<Row>('SELECT * FROM notification_settings WHERE id=1', [], db);
    if (!manual && (!settings?.enabled || !inSendWindow(windowOf(settings), now))) return null;
    const [job] = await rows<Row>(`SELECT j.*,r.days_before FROM notification_jobs j LEFT JOIN notification_rules r ON r.id=j.rule_id
      WHERE j.status='PENDING' AND j.available_at<=UTC_TIMESTAMP(6) ${jobId ? 'AND j.id=?' : ''} ORDER BY j.available_at LIMIT 1 FOR UPDATE SKIP LOCKED`, jobId ? [jobId] : [], db);
    if (!job) return null;
    const [a] = await rows<Row>(`SELECT a.*,c.name clinic_name,c.enabled clinic_enabled,c.note clinic_note,o.hn opted_out
      FROM appointments a LEFT JOIN clinics c ON c.code=a.clinic_code LEFT JOIN patient_opt_outs o ON o.hn=a.hn WHERE a.oapp_id=?`, [job.oapp_id], db);
    const cancelNotice = job.kind === 'CANCELLED';
    const skip = async (status: string, reason: string) => {
      await execute('UPDATE notification_jobs SET status=?,safe_error=? WHERE id=?', [status, reason, job.id], db); return { skipped: true as const };
    };
    // A cancellation notice needs the appointment to still be cancelled (not re-activated) and not yet past.
    if (!a || (cancelNotice ? !!a.active : !a.active) || Number(a.schedule_version) !== Number(job.schedule_version)
      || !futureAppointment(String(a.appointment_date).slice(0, 10), (a.appointment_time as string | null) ?? null, now)) return skip('CANCELLED', 'APPOINTMENT_NO_LONGER_ELIGIBLE');
    if (a.opted_out) return skip('CANCELLED', 'PATIENT_OPTED_OUT');
    if (!manual && !a.clinic_enabled) return skip('CANCELLED', 'CLINIC_DISABLED');
    if (!manual && settings.mode === 'DRY_RUN') return skip('DRY_RUN', 'No network request was made');
    await execute("UPDATE notification_jobs SET status='SENDING',lease_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 2 MINUTE) WHERE id=?", [job.id], db);
    return { skipped: false as const, job, a };
  });
  if (!claimed) return false; if (claimed.skipped) return true;
  const { job, a } = claimed, id = String(job.id), cancelNotice = job.kind === 'CANCELLED';

  // Read HOSxP live, outside the transaction: the notice must match what HOSxP says right now.
  let notice: Notice, cid: string;
  try {
    if (cancelNotice) {
      const person = await (deps.readPerson ?? readPatient)(String(a.hn));
      if (!person) return !!await close(id, 'BLOCKED', 'ไม่พบข้อมูลคนไข้ใน HOSxP');
      cid = person.cid;
      notice = buildNotice('CANCELLED', a, person.name || String(a.patient_name));
    } else {
      const live = await (deps.readNotice ?? readForNotice)(String(a.oapp_id));
      if (!live || !activeStatus(live.appointment.source_status_id) || fingerprint(live.appointment) !== a.fingerprint)
        return !!await close(id, 'CANCELLED', 'HOSXP_APPOINTMENT_CHANGED');
      cid = live.cid;
      const kind: NoticeKind = job.kind === 'REMINDER' ? 'REMINDER' : job.kind === 'MANUAL' ? 'MANUAL' : Number(a.schedule_version) > 1 ? 'CHANGED' : 'NEW';
      notice = { ...buildNotice(kind, a, live.appointment.patient_name || String(a.patient_name)), location: live.appointment.location,
        daysBefore: job.days_before == null ? undefined : Number(job.days_before), tests: live.tests, preparation: live.preparation };
    }
  } catch {
    // HOSxP unreachable: nothing was sent, try again in 5 minutes.
    await execute("UPDATE notification_jobs SET status='PENDING',safe_error='อ่าน HOSxP ไม่ได้ จะลองใหม่',lease_until=NULL,available_at=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 5 MINUTE) WHERE id=? AND status='SENDING'", [id]);
    return true;
  }
  if (!validCid(cid)) return !!await close(id, 'BLOCKED', 'ไม่มีเลขบัตรประชาชน 13 หลักที่ถูกต้องใน HOSxP');

  const attemptNo = Number(job.attempt_count) + 1;
  await transaction(async db => {
    await execute('UPDATE notification_jobs SET attempt_count=? WHERE id=?', [attemptNo, id], db);
    await execute("INSERT INTO notification_attempts(job_id,attempt_no,outcome) VALUES(?,?,'STARTED')", [id, attemptNo], db);
  });
  let delivery: Delivery;
  try { delivery = await provider.send(cid, noticeMessage(notice)); } catch { delivery = { outcome: 'UNKNOWN', safeError: 'การเชื่อมต่อขัดข้อง อาจส่งแล้ว ต้องตรวจสอบก่อนส่งซ้ำ' }; }
  await transaction(async db => {
    const status = statusOf(delivery);
    await execute("UPDATE notification_jobs SET status=?,safe_error=?,accepted_at=IF(?='ACCEPTED',UTC_TIMESTAMP(6),NULL),lease_until=NULL WHERE id=? AND status='SENDING'",
      [status, delivery.safeError ?? null, status, id], db);
    await execute('UPDATE notification_attempts SET outcome=?,http_status=?,provider_code=?,safe_error=? WHERE job_id=? AND attempt_no=?',
      [delivery.outcome, delivery.httpStatus ?? null, delivery.providerCode ?? null, delivery.safeError ?? null, id, attemptNo], db);
    await audit(db, null, 'NOTIFICATION_ATTEMPT', 'notification_jobs', id, { outcome: delivery.outcome });
  });
  return true;
}
function buildNotice(kind: NoticeKind, a: Row, name: string): Notice {
  return { kind, name, date: String(a.appointment_date).slice(0, 10), time: a.appointment_time ? String(a.appointment_time) : null,
    clinic: String(a.clinic_name ?? ''), location: String(a.location ?? ''), clinicNote: String(a.clinic_note ?? ''),
    contact: process.env.HOSPITAL_CONTACT?.trim() || undefined };
}

export async function retryNotification(jobId: string, reason: string, acknowledgeUnknown: boolean, actor: Actor) {
  return transaction(async db => {
    const [job] = await rows<Row>('SELECT * FROM notification_jobs WHERE id=? FOR UPDATE', [jobId], db); ensure(job, 'ไม่พบข้อความ', 404);
    ensure(['FAILED', 'BLOCKED', 'UNKNOWN', 'DRY_RUN'].includes(String(job.status)), 'สถานะนี้สั่งส่งซ้ำไม่ได้', 409);
    ensure(job.status !== 'UNKNOWN' || acknowledgeUnknown, 'ต้องยืนยันว่าตรวจสอบแล้วและยอมรับโอกาสส่งซ้ำ');
    ensure(Number(job.attempt_count) < 3, 'ครบ 3 ครั้งแล้ว ต้องตรวจแก้สาเหตุก่อน');
    await execute("UPDATE notification_jobs SET status='PENDING',safe_error=NULL,available_at=UTC_TIMESTAMP(6) WHERE id=?", [jobId], db);
    await audit(db, actor.id, 'MANUAL_RETRY', 'notification_jobs', jobId, { reason, previousStatus: job.status, acknowledgeUnknown }); return { ok: true };
  });
}

// "Send now" from the web. Reads the appointment from HOSxP first, so it works without waiting for the worker.
export async function sendManualNotification(oappId: string, actor: Actor, deps: DispatchDeps = {}) {
  const jobId = randomUUID();
  ensure(await refreshAppointment(oappId), 'ไม่พบนัดนี้ใน HOSxP', 404);
  await transaction(async db => {
    const [a] = await rows<Row>('SELECT oapp_id,schedule_version,active FROM appointments WHERE oapp_id=? FOR UPDATE', [oappId], db);
    ensure(a?.active, 'นัดนี้ไม่อยู่ในสถานะที่ส่งได้แล้ว (เลยวันนัด หรือยกเลิกใน HOSxP)', 409);
    const recent = await rows("SELECT id FROM notification_jobs WHERE oapp_id=? AND kind='MANUAL' AND created_at>DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE)", [oappId], db);
    ensure(!recent.length, 'เพิ่งส่งนัดนี้ไป กรุณารอ 1 นาที', 429);
    await queueJob(db, { id: jobId, oappId, version: Number(a.schedule_version), kind: 'MANUAL', dedupe: jobId, requestedBy: actor.id, availableAt: null });
    await audit(db, actor.id, 'MANUAL_NOTIFICATION', 'notification_jobs', jobId, { oappId });
  });
  await dispatchOne(deps, jobId, true);
  const [job] = await rows<Row>('SELECT id,status,safe_error FROM notification_jobs WHERE id=?', [jobId]);
  return { id: jobId, status: String(job.status), safe_error: job.safe_error ?? null };
}

// Test message to a CID typed by the admin (their own). The CID is used once and never stored or logged.
export async function sendTestNotification(cid: string, actor: Actor, provider: NotificationProvider = new MophAlertProvider()) {
  ensure(validCid(cid), 'เลขบัตรประชาชนไม่ถูกต้อง');
  ensure(process.env.MOPH_LIVE_ENABLED === 'true', 'ตั้ง MOPH_LIVE_ENABLED=true แล้ว restart เว็บก่อนส่งทดสอบ');
  ensure(process.env.MOPH_CLIENT_KEY && process.env.MOPH_SECRET_KEY, 'กรอก Client_ID และ Secret ใน .env แล้ว restart เว็บ');
  const requestId = randomUUID();
  await transaction(async db => {
    const recent = await rows("SELECT id FROM audit_logs WHERE actor_user_id=? AND action='TEST_SEND' AND created_at>DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE) FOR UPDATE", [actor.id], db);
    ensure(!recent.length, 'เพิ่งส่งทดสอบไป กรุณารอ 1 นาทีและตรวจ LINE ก่อนทดสอบใหม่', 429);
    await audit(db, actor.id, 'TEST_SEND', 'notification_test', requestId, {});
  });
  let delivery: Delivery;
  try { delivery = await provider.send(cid, plainMessage(TEST_NOTIFICATION_TEXT, 'ทดสอบระบบแจ้งเตือนนัดหมาย')); }
  catch { delivery = { outcome: 'UNKNOWN', safeError: 'การเชื่อมต่อขัดข้อง กรุณาตรวจ LINE ก่อนทดสอบใหม่' }; }
  const status = statusOf(delivery);
  await transaction(db => audit(db, actor.id, 'TEST_SEND_RESULT', 'notification_test', requestId, { status, httpStatus: delivery.httpStatus, providerCode: delivery.providerCode }));
  return { id: requestId, status, safe_error: delivery.safeError ?? null, http_status: delivery.httpStatus ?? null, provider_code: delivery.providerCode ?? null };
}
