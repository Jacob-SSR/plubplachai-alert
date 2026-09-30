import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rows, execute, closePool } from '../../src/server/db';
import { syncAppointments, syncClinics } from '../../src/server/sync';
import { dispatchOne, scheduleReminders, type DispatchDeps } from '../../src/server/notifications';
import { addOptOut, updateClinic, listAppointments } from '../../src/server/admin';
import { addDays, bangkokNow } from '../../src/domain/validation';
import type { SourceAppointment } from '../../src/server/hosxp';
import type { Actor } from '../../src/server/auth';
import type { OutboundMessage } from '../../src/domain/notice';

if (process.env.ALLOW_TEST_DATABASE !== 'true' || !process.env.DB_NAME?.endsWith('_test') || process.env.MOPH_LIVE_ENABLED === 'true')
  throw Error('Integration tests require ALLOW_TEST_DATABASE=true, DB_NAME ending _test, MOPH_LIVE_ENABLED=false');

// Fake HOSxP (in memory) and fake MOPH. Nothing leaves this process.
const today = bangkokNow().day, noon = new Date(`${today}T12:00:00+07:00`), night = new Date(`${today}T23:00:00+07:00`);
const CID = '1101700203450';
let source: SourceAppointment[] = [];
const appt = (id: string, over: Partial<SourceAppointment> = {}): SourceAppointment => ({ oapp_id: id, hn: `HN${id}`, patient_name: `ผู้ป่วย ${id}`,
  clinic_code: '012', clinic_name: 'คลินิกเบาหวาน', appointment_date: addDays(today, 5), appointment_time: '09:00:00', location: 'OPD',
  doctor_name: '', source_status_id: null, ...over });
const read = async () => source;
const inSource = async (ids: string[]) => new Map(source.filter(a => ids.includes(a.oapp_id)).map(a => [a.oapp_id, { status: a.source_status_id }]));
const sync = () => syncAppointments(noon, read, inSource);
const sent: { cid: string; message: OutboundMessage }[] = [];
let cidFor: (hn: string) => string = () => CID;
const deps: DispatchDeps = {
  now: () => noon,
  provider: { send: async (cid, message) => { sent.push({ cid, message: message as OutboundMessage }); return { outcome: 'ACCEPTED', httpStatus: 200, providerCode: '200' }; } },
  readNotice: async id => { const a = source.find(x => x.oapp_id === id); return a ? { appointment: a, cid: cidFor(a.hn), tests: ['FBS'], preparation: [] } : null; },
  readPerson: async hn => ({ name: 'ผู้ป่วย ยกเลิก', cid: cidFor(hn) }),
};
const drain = async () => { let n = 0; while (await dispatchOne(deps)) n++; return n; };
const jobs = (oappId: string) => rows<{ kind: string; status: string; schedule_version: number; safe_error: string | null }>(
  'SELECT kind,status,schedule_version,safe_error FROM notification_jobs WHERE oapp_id=? ORDER BY created_at,kind', [oappId]);
let actor: Actor;
const clinicVersion = async (code: string) => Number((await rows<{ version: number }>('SELECT version FROM clinics WHERE code=?', [code]))[0].version);

before(async () => {
  for (const t of ['notification_attempts', 'notification_jobs', 'appointments', 'patient_opt_outs', 'clinics']) await execute(`DELETE FROM ${t}`);
  await execute("DELETE FROM audit_logs WHERE action<>'LOGIN'");
  await execute('UPDATE sync_state SET initialized=0,last_success_at=NULL');
  await execute("UPDATE notification_settings SET enabled=0,mode='DRY_RUN',notify_new=1,notify_cancel=1,reminder_time='08:00:00',window_start='07:00:00',window_end='20:00:00'");
  await execute('UPDATE notification_rules SET active=0'); await execute('INSERT INTO notification_rules(days_before,active) VALUES(1,1) ON DUPLICATE KEY UPDATE active=1');
  const [u] = await rows<{ id: number }>("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.code='ADMIN' LIMIT 1");
  assert.ok(u, 'run db:bootstrap first');
  actor = { id: u.id, username: 'test', displayName: 'ทดสอบ', roles: ['ADMIN'], permissions: [], csrf: '' };
});
after(closePool);

test('first sync is a baseline: existing appointments are stored but never broadcast', async () => {
  await syncClinics(async () => [{ code: '012', name: 'คลินิกเบาหวาน' }, { code: '013', name: 'คลินิกความดัน' }]);
  await execute("UPDATE notification_settings SET enabled=1");
  await execute("UPDATE clinics SET enabled=1 WHERE code='012'");
  source = [appt('1'), appt('2', { clinic_code: '013', clinic_name: 'คลินิกความดัน' })];
  assert.deepEqual(await sync(), { read: 2, queued: 0 });
  assert.equal((await rows('SELECT * FROM notification_jobs')).length, 0);
  assert.equal((await listAppointments(new URLSearchParams({ from: today, to: addDays(today, 10) }))).total, 2);
});

test('new appointments are announced only for enabled clinics and patients who did not opt out', async () => {
  await addOptOut({ hn: 'HN5' }, actor);
  source.push(appt('3'), appt('4', { clinic_code: '013' }), appt('5'), appt('6', { clinic_code: '099', clinic_name: 'คลินิกใหม่' }));
  assert.equal((await sync()).queued, 1);
  assert.deepEqual((await jobs('3')).map(j => j.kind), ['NEW']);
  assert.equal((await jobs('4')).length + (await jobs('5')).length + (await jobs('6')).length, 0);
  assert.equal((await rows("SELECT * FROM clinics WHERE code='099' AND enabled=0")).length, 1, 'unknown clinic is added, switched off');
  // DRY_RUN: no network call.
  await drain();
  assert.deepEqual((await jobs('3')).map(j => j.status), ['DRY_RUN']);
  assert.equal(sent.length, 0);
});

test('LIVE: a moved appointment sends a "changed" notice read live from HOSxP', async () => {
  await execute("UPDATE notification_settings SET mode='LIVE'");
  source = source.map(a => a.oapp_id === '3' ? { ...a, appointment_time: '10:30:00' } : a);
  assert.equal((await sync()).queued, 1);
  assert.equal(await drain(), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].cid, CID);
  assert.equal(sent[0].message.title, 'แจ้งเปลี่ยนแปลงวันนัด');
  assert.match(sent[0].message.text, /10:30 น\./);
  assert.match(sent[0].message.text, /การตรวจเลือด/);
  const last = (await jobs('3')).at(-1)!;
  assert.deepEqual([last.kind, last.status, last.schedule_version], ['NEW', 'ACCEPTED', 2]);
});

test('HOSxP changed after queueing: the stale notice is cancelled, not sent', async () => {
  source.push(appt('7'));
  await sync();
  source = source.map(a => a.oapp_id === '7' ? { ...a, appointment_date: addDays(today, 6) } : a); // not yet synced
  await drain();
  assert.deepEqual((await jobs('7')).map(j => [j.status, j.safe_error]), [['CANCELLED', 'HOSXP_APPOINTMENT_CHANGED']]);
  assert.equal(sent.length, 1);
  await sync(); await drain(); // the next round announces the new date
  assert.equal(sent.length, 2);
});

test('cancelled in HOSxP (deleted or status changed) sends a cancellation notice', async () => {
  source = source.filter(a => a.oapp_id !== '1');
  source = source.map(a => a.oapp_id === '7' ? { ...a, source_status_id: '3' } : a);
  assert.equal((await sync()).queued, 2);
  await drain();
  assert.deepEqual(sent.slice(-2).map(s => s.message.title), ['แจ้งยกเลิกวันนัด', 'แจ้งยกเลิกวันนัด']);
  assert.equal((await jobs('1')).at(-1)!.status, 'ACCEPTED');
});

test('no valid CID in HOSxP blocks the notice', async () => {
  cidFor = hn => hn === 'HN8' ? '' : CID;
  source.push(appt('8')); await sync(); await drain();
  assert.deepEqual((await jobs('8')).map(j => j.status), ['BLOCKED']);
  cidFor = () => CID;
});

test('nothing goes out at night; the notice waits for the morning', async () => {
  source.push(appt('9')); await syncAppointments(night, read, inSource);
  const [job] = await rows<{ available_at: string }>("SELECT available_at FROM notification_jobs WHERE oapp_id='9'");
  assert.equal(job.available_at.slice(0, 16), `${addDays(today, 1)} 00:00`, '07:00 Bangkok next day');
  assert.equal(await dispatchOne({ ...deps, now: () => night }), false);
});

test('reminders are queued once per rule for enabled clinics', async () => {
  source.push(appt('10', { appointment_date: addDays(today, 1) }), appt('11', { appointment_date: addDays(today, 1), clinic_code: '013' }));
  await sync(); await drain(); // the first notice went out...
  await execute("UPDATE notification_jobs SET created_at=DATE_SUB(created_at,INTERVAL 1 DAY) WHERE oapp_id='10'"); // announced yesterday
  assert.equal(await scheduleReminders(noon), 1);
  assert.equal(await scheduleReminders(noon), 0, 'not duplicated');
  assert.equal(await scheduleReminders(new Date(`${today}T07:00:00+07:00`)), 0, 'not before the reminder time');
  const before = sent.length; await drain();
  assert.equal(sent.length - before, 1);
  assert.equal(sent.at(-1)!.message.title, 'แจ้งเตือนก่อนถึงวันนัด');
  assert.match(sent.at(-1)!.message.text, /พรุ่งนี้เป็นวันนัดของท่าน/);
});

test('switching a clinic off or opting a patient out cancels what is still waiting', async () => {
  await execute("UPDATE notification_settings SET window_start='00:00:00',window_end='00:01:00'"); // hold everything
  source.push(appt('12'), appt('13')); await sync();
  await addOptOut({ hn: 'HN12' }, actor);
  assert.equal((await jobs('12'))[0].safe_error, 'PATIENT_OPTED_OUT');
  await updateClinic('012', { enabled: false, note: 'นำยาเดิมมาด้วย', version: await clinicVersion('012') }, actor);
  assert.equal((await jobs('13'))[0].safe_error, 'CLINIC_DISABLED');
  await assert.rejects(updateClinic('012', { enabled: true, version: 1 }, actor), /โหลดใหม่/);
  await execute("UPDATE notification_settings SET window_start='07:00:00',window_end='20:00:00'");
});
