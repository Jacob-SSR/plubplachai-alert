import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { rows, execute, transaction, type Row } from './db';
import { audit } from './audit';
import { type Actor } from './auth';
import { addDays, bangkokNow, date, ensure, hn, text } from '../domain/validation';

// Appointments from the last sync, with the latest notice of each. HN and name only; no CID is stored.
export async function listAppointments(params: URLSearchParams) {
  const today = bangkokNow().day;
  const from = date.parse(params.get('from') || today), to = date.parse(params.get('to') || addDays(from, 7));
  ensure(from <= to && to <= addDays(from, 92), 'เลือกช่วงวันที่ได้ไม่เกิน 92 วัน');
  const clinic = params.get('clinic') || '', search = (params.get('q') ?? '').trim().slice(0, 60);
  const page = Math.max(1, Math.min(1000, Number(params.get('page')) || 1)), size = 100;
  const where = ['a.appointment_date BETWEEN ? AND ?'], values: (string | number)[] = [from, to];
  if (clinic) { where.push('a.clinic_code=?'); values.push(clinic); }
  if (search) { where.push('(a.hn=? OR a.patient_name LIKE ?)'); values.push(search, `%${search.replace(/[\\%_]/g, c => '\\' + c)}%`); }
  if (params.get('active') !== 'all') where.push('a.active=1');
  const [{ total }] = await rows<{ total: number }>(`SELECT COUNT(*) total FROM appointments a WHERE ${where.join(' AND ')}`, values);
  const data = await rows(`SELECT a.oapp_id,a.hn,a.patient_name,a.clinic_code,c.name clinic_name,c.enabled clinic_enabled,a.appointment_date,a.appointment_time,
      a.location,a.doctor_name,a.active,a.schedule_version,(o.hn IS NOT NULL) opted_out,
      (SELECT CONCAT(j.kind,':',j.status) FROM notification_jobs j WHERE j.oapp_id=a.oapp_id ORDER BY j.created_at DESC LIMIT 1) last_notice
    FROM appointments a LEFT JOIN clinics c ON c.code=a.clinic_code LEFT JOIN patient_opt_outs o ON o.hn=a.hn
    WHERE ${where.join(' AND ')} ORDER BY a.appointment_date,a.appointment_time,a.oapp_id LIMIT ${size} OFFSET ${(page - 1) * size}`, values);
  return { from, to, page, size, total: Number(total), data };
}

export async function overview() {
  const today = bangkokNow().day;
  const [counts] = await rows<Row>(`SELECT
      SUM(appointment_date=?) today, SUM(appointment_date=?) tomorrow, COUNT(*) upcoming
    FROM appointments WHERE active=1`, [today, addDays(today, 1)]);
  const sent = await rows(`SELECT status,COUNT(*) n FROM notification_jobs WHERE created_at>=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 DAY) GROUP BY status`);
  const [clinics] = await rows<Row>('SELECT SUM(enabled) enabled,COUNT(*) total FROM clinics');
  const [sync] = await rows('SELECT initialized,last_success_at,last_error,last_error_at,last_count FROM sync_state WHERE id=1');
  return { today: Number(counts?.today ?? 0), tomorrow: Number(counts?.tomorrow ?? 0), upcoming: Number(counts?.upcoming ?? 0),
    last24h: sent, clinicsEnabled: Number(clinics?.enabled ?? 0), clinicsTotal: Number(clinics?.total ?? 0), sync };
}

export async function listClinics() {
  return rows(`SELECT c.*,(SELECT COUNT(*) FROM appointments a WHERE a.clinic_code=c.code AND a.active=1) upcoming
    FROM clinics c ORDER BY c.enabled DESC,upcoming DESC,c.code`);
}
export async function updateClinic(code: string, body: unknown, actor: Actor) {
  const input = z.object({ enabled: z.boolean(), note: z.string().trim().max(1000).default(''), version: z.number().int().positive() }).parse(body);
  return transaction(async db => {
    const r = await execute('UPDATE clinics SET enabled=?,note=?,version=version+1 WHERE code=? AND version=?', [input.enabled, input.note, code, input.version], db);
    ensure(r.affectedRows, 'ข้อมูลคลินิกเปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
    // Switching a clinic off stops its queued notices; switching on only affects new changes and reminders.
    if (!input.enabled) await execute(`UPDATE notification_jobs j JOIN appointments a ON a.oapp_id=j.oapp_id SET j.status='CANCELLED',j.safe_error='CLINIC_DISABLED'
      WHERE a.clinic_code=? AND j.status='PENDING' AND j.kind<>'MANUAL'`, [code], db);
    await audit(db, actor.id, 'CLINIC_SETTINGS', 'clinics', code, { enabled: input.enabled, noteLength: input.note.length });
    return { ok: true };
  });
}

export const listOptOuts = () => rows(`SELECT o.hn,o.note,o.created_at,u.display_name created_by,
  (SELECT a.patient_name FROM appointments a WHERE a.hn=o.hn ORDER BY a.appointment_date DESC LIMIT 1) patient_name
  FROM patient_opt_outs o LEFT JOIN users u ON u.id=o.created_by ORDER BY o.created_at DESC`);
export async function addOptOut(body: unknown, actor: Actor) {
  const input = z.object({ hn, note: z.string().trim().max(255).default('') }).parse(body);
  return transaction(async db => {
    await execute('INSERT INTO patient_opt_outs(hn,note,created_by) VALUES(?,?,?) ON DUPLICATE KEY UPDATE note=VALUES(note)', [input.hn, input.note, actor.id], db);
    await execute(`UPDATE notification_jobs j JOIN appointments a ON a.oapp_id=j.oapp_id SET j.status='CANCELLED',j.safe_error='PATIENT_OPTED_OUT'
      WHERE a.hn=? AND j.status IN ('PENDING','BLOCKED')`, [input.hn], db);
    await audit(db, actor.id, 'OPT_OUT_ADD', 'patient_opt_outs', input.hn, {});
    return { ok: true };
  });
}
export async function removeOptOut(value: string, actor: Actor) {
  const key = hn.parse(value);
  return transaction(async db => {
    const r = await execute('DELETE FROM patient_opt_outs WHERE hn=?', [key], db); ensure(r.affectedRows, 'ไม่พบ HN นี้ในรายการงดส่ง', 404);
    await audit(db, actor.id, 'OPT_OUT_REMOVE', 'patient_opt_outs', key, {});
    return { ok: true };
  });
}

export const listUsers = () => rows(`SELECT u.id,u.username,u.display_name,u.active,GROUP_CONCAT(r.code) roles FROM users u
  LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id GROUP BY u.id,u.username,u.display_name,u.active ORDER BY u.username`);
export async function createUser(body: unknown, actor: Actor) {
  const input = z.object({ username: z.string().trim().regex(/^[A-Za-z0-9_.-]{3,100}$/, 'ชื่อผู้ใช้ใช้อักษรอังกฤษ ตัวเลข . _ - 3-100 ตัว'),
    displayName: text(200), password: z.string().min(6, 'รหัสผ่านอย่างน้อย 6 อักขระ').refine(p => Buffer.byteLength(p) <= 72, 'รหัสผ่านยาวเกิน 72 bytes'),
    role: z.enum(['ADMIN', 'STAFF']) }).parse(body);
  const hash = await bcrypt.hash(input.password, 12);
  return transaction(async db => {
    const r = await execute('INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?)', [input.username, input.displayName, hash], db);
    await execute('INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE code=?', [r.insertId, input.role], db);
    await audit(db, actor.id, 'USER_CREATE', 'users', r.insertId, { username: input.username, role: input.role });
    return { id: r.insertId };
  });
}
export async function setUserActive(userId: number, body: unknown, actor: Actor) {
  const input = z.object({ active: z.boolean() }).parse(body); ensure(userId !== actor.id, 'ปิดบัญชีที่กำลังใช้งานอยู่ไม่ได้');
  return transaction(async db => {
    const r = await execute('UPDATE users SET active=?,auth_version=auth_version+1 WHERE id=?', [input.active, userId], db); ensure(r.affectedRows, 'ไม่พบบัญชี', 404);
    await audit(db, actor.id, 'ACCOUNT_STATUS', 'users', userId, { active: input.active }); return { ok: true };
  });
}

export const listNotifications = (params: URLSearchParams) => {
  const status = params.get('status') || '';
  ensure(!status || /^[A-Z_]{1,20}$/.test(status), 'สถานะไม่ถูกต้อง');
  return rows(`SELECT j.id,j.kind,j.status,j.safe_error,j.attempt_count,j.created_at,j.available_at,j.accepted_at,r.days_before,
      a.hn,a.patient_name,a.appointment_date,a.appointment_time,c.name clinic_name
    FROM notification_jobs j JOIN appointments a ON a.oapp_id=j.oapp_id LEFT JOIN clinics c ON c.code=a.clinic_code
    LEFT JOIN notification_rules r ON r.id=j.rule_id ${status ? 'WHERE j.status=?' : ''} ORDER BY j.created_at DESC LIMIT 300`, status ? [status] : []);
};
