'use client';
import { useState } from 'react';
import { ReminderRounds } from './reminder-rounds';
import { NoticePreview } from './notice-preview';
import { Field, FormPanel, Table, STATUS_NAMES, KIND_NAMES, n, s, reason, thaiDate, time, useLoad, type Api, type Item } from './ui';

type Settings = Item & { show_brand?: number; enabled: number; mode: string; notify_new: number; notify_cancel: number; reminder_time: string; window_start: string; window_end: string;
  version: number; rules: Item[]; credentialConfigured: boolean; serverLiveEnabled: boolean };
type Job = { id: string; kind: string; status: string; safe_error: string | null; attempt_count: number; created_at: string; available_at: string;
  days_before: number | null; hn: string; patient_name: string; appointment_date: string; appointment_time: string | null; clinic_name: string | null };
const hm = (v: unknown) => s(v).slice(0, 5);
export function Notifications({ api, canManage }: { api: Api; canManage: boolean }) {
  const settings = useLoad<Settings>(api, 'notification-settings');
  const [status, setStatus] = useState('');
  const jobs = useLoad<Job[]>(api, `notifications?${new URLSearchParams({ status })}`);
  const [editing, setEditing] = useState(false), [retry, setRetry] = useState<Job>();
  const st = settings.data, reload = () => { settings.reload(); jobs.reload(); };
  const days = st?.rules.filter(r => r.active).map(r => n(r.days_before)) ?? [];
  return <>
    <div className="section-head"><div><h2>แจ้งเตือนผ่าน MOPH Alert</h2><p className="muted">ส่งถึงผู้ป่วยทาง LINE หมอพร้อม ด้วยเลขบัตรประชาชนในทะเบียนผู้ป่วย HOSxP</p></div>
      {canManage && st && <button onClick={() => setEditing(true)}>ตั้งค่าการแจ้งเตือน</button>}</div>
    {settings.error && <div role="alert" className="error">{settings.error}</div>}
    {st && <>
      <div className="notice"><strong>{st.enabled ? (st.mode === 'LIVE' ? 'เปิดส่งจริง' : 'โหมดทดสอบ · ไม่ส่งข้อความ') : 'ปิดการแจ้งเตือนอัตโนมัติ'}</strong>
        <span>{st.notify_new ? 'แจ้งทันทีเมื่อลงนัดหรือเลื่อนนัด' : 'ไม่แจ้งเมื่อลงนัด'} · {st.notify_cancel ? 'แจ้งเมื่อยกเลิกนัด' : 'ไม่แจ้งเมื่อยกเลิก'} · เตือนก่อนวันนัด {days.length ? days.map(d => d === 0 ? 'เช้าวันนัด' : `${d} วัน`).join(', ') : '—'} (เวลา {hm(st.reminder_time)} น.) · ส่งเฉพาะช่วง {hm(st.window_start)}–{hm(st.window_end)} น.</span></div>
      <p className="helper">“MOPH รับคำขอแล้ว” ไม่ได้ยืนยันว่าผู้ป่วยอ่านข้อความ ผู้ป่วยต้องเพิ่มเพื่อน LINE หมอพร้อมและยืนยันตัวตนแล้วจึงจะได้รับ หากผลไม่ชัดเจน ระบบจะไม่ส่งซ้ำอัตโนมัติ</p>
    </>}
    {editing && st && <FormPanel title="ตั้งค่าการแจ้งเตือน" onClose={() => setEditing(false)} onSubmit={async f => {
      await api('notification-settings', 'PATCH', { enabled: f.get('enabled') === 'on', mode: f.get('mode'), version: st.version,
        notifyNew: f.get('notifyNew') === 'on', notifyCancel: f.get('notifyCancel') === 'on', reminderTime: f.get('reminderTime'), windowStart: f.get('windowStart'), windowEnd: f.get('windowEnd'),
        days: [...new Set(f.getAll('days').map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 30))], confirmLive: f.get('confirmLive') === 'on', showBrand: f.get('showBrand') === 'on' });
      reload(); }}>
      <label className="checkbox"><input name="enabled" type="checkbox" defaultChecked={!!st.enabled}/>เปิดการแจ้งเตือนอัตโนมัติ</label>
      <label>โหมด<select name="mode" defaultValue={st.mode}><option value="DRY_RUN">ทดสอบ (ไม่ส่งจริง)</option><option value="LIVE">ส่งจริง</option></select></label>
      <label className="checkbox"><input name="notifyNew" type="checkbox" defaultChecked={!!st.notify_new}/>แจ้งทันทีเมื่อลงนัดใหม่หรือเลื่อนนัดใน HOSxP</label>
      <label className="checkbox"><input name="notifyCancel" type="checkbox" defaultChecked={!!st.notify_cancel}/>แจ้งเมื่อนัดที่ยังไม่ถึงวันถูกยกเลิกใน HOSxP</label>
      <label className="checkbox span-all"><input name="showBrand" type="checkbox" defaultChecked={st.show_brand == null || !!st.show_brand}/>แสดงโลโก้และชื่อโรงพยาบาลบนหัวการ์ด LINE</label>
      <ReminderRounds rules={st.rules}/>
      <Field label="เวลาเริ่มส่งข้อความเตือนก่อนวันนัด" name="reminderTime" type="time" defaultValue={hm(st.reminder_time)} required/>
      <Field label="ส่งได้ตั้งแต่" name="windowStart" type="time" defaultValue={hm(st.window_start)} required/>
      <Field label="หยุดส่งเวลา" name="windowEnd" type="time" defaultValue={hm(st.window_end)} required/>
      <p className="helper span-all">นอกช่วงเวลาส่ง ข้อความจะรอจนถึงเวลาเริ่มส่งของวันถัดไป เพื่อไม่รบกวนผู้ป่วยตอนกลางคืน</p>
      <label className="checkbox span-all"><input type="checkbox" name="confirmLive"/>ยืนยันเปิดส่งจริงถึงผู้ป่วยของคลินิกที่เปิดไว้</label>
      <p className="helper span-all">สถานะ server: {st.credentialConfigured ? 'ตั้งค่า Client_ID และ Secret แล้ว' : 'ยังไม่ได้ตั้ง Client_ID และ Secret'} · {st.serverLiveEnabled ? 'อนุญาตส่งจริง' : 'ยังไม่อนุญาตส่งจริง (MOPH_LIVE_ENABLED)'}</p>
    </FormPanel>}
    <NoticePreview showBrand={!st || st.show_brand == null || !!st.show_brand}/>
    {canManage && <TestSend api={api}/>}
    {retry && <FormPanel title="ตรวจสอบก่อนส่งซ้ำ" onClose={() => setRetry(undefined)} onSubmit={async f => { await api(`notifications/${retry.id}/retry`, 'POST', { reason: f.get('reason'), acknowledgeUnknown: f.get('ack') === 'on' }); jobs.reload(); }}>
      <p className="span-all">{retry.patient_name} (HN {retry.hn}) · {thaiDate(retry.appointment_date)} · {STATUS_NAMES[retry.status]}</p>
      <Field label="เหตุผลที่ส่งซ้ำ / ผลตรวจสอบ" name="reason" required/>
      {retry.status === 'UNKNOWN' && <label className="checkbox"><input type="checkbox" name="ack" required/>ตรวจสอบแล้ว และยอมรับความเสี่ยงที่ผู้ป่วยอาจได้รับข้อความซ้ำ</label>}
    </FormPanel>}
    <div className="section-head"><div><h3>ข้อความล่าสุด</h3><p className="muted">300 รายการล่าสุด</p></div>
      <label>สถานะ<select value={status} onChange={e => setStatus(e.target.value)}><option value="">ทั้งหมด</option>{Object.entries(STATUS_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
    {jobs.error && <div role="alert" className="error">{jobs.error}</div>}
    <div className="surface" aria-busy={jobs.busy}><Table headers={['ผู้ป่วย / นัดหมาย', 'ประเภท', 'สถานะ', 'รายละเอียด', '']} empty={!jobs.data?.length}>
      {jobs.data?.map(j => <tr key={j.id}>
        <td><strong>{j.patient_name || '—'}</strong><small>HN {j.hn} · {s(j.clinic_name)} · {thaiDate(j.appointment_date)} {time(j.appointment_time)}</small></td>
        <td>{j.kind === 'REMINDER' ? (n(j.days_before) === 0 ? 'เตือนเช้าวันนัด' : `เตือนก่อนวันนัด ${n(j.days_before)} วัน`) : KIND_NAMES[j.kind] ?? j.kind}</td>
        <td><span className="badge">{STATUS_NAMES[j.status] ?? j.status}</span>{j.status === 'PENDING' && <small>ส่งได้ตั้งแต่ {s(j.available_at).slice(0, 16)} UTC</small>}</td>
        <td>{reason(j.safe_error)}<small>พยายามส่ง {n(j.attempt_count)} ครั้ง</small></td>
        <td>{canManage && ['FAILED', 'BLOCKED', 'UNKNOWN', 'DRY_RUN'].includes(j.status) && n(j.attempt_count) < 3 && <button onClick={() => setRetry(j)}>ตรวจสอบ / ส่งซ้ำ</button>}</td>
      </tr>)}
    </Table></div>
  </>;
}

// Test send to the admin's own CID. The number is used once, never stored or logged.
function TestSend({ api }: { api: Api }) {
  const [result, setResult] = useState(''), [busy, setBusy] = useState(false);
  return <section className="surface padded" aria-label="ส่งข้อความทดสอบ"><h3>ส่งข้อความทดสอบ</h3>
    <p className="helper">ใส่เลขบัตรประชาชนของเจ้าหน้าที่ที่ลงทะเบียน LINE หมอพร้อมแล้ว ระบบใช้ส่งครั้งเดียว ไม่บันทึกเลขบัตร</p>
    <form className="filters" onSubmit={async e => { e.preventDefault(); const form = e.currentTarget, f = new FormData(form); setBusy(true); setResult('');
      try { const r = await api('notifications/test', 'POST', { cid: s(f.get('cid')).replace(/\D/g, '') }) as { status: string; safe_error: string | null };
        setResult(`${STATUS_NAMES[r.status] ?? r.status}${r.safe_error ? ` · ${r.safe_error}` : ''}`); form.reset(); }
      catch (err) { setResult(err instanceof Error ? err.message : 'ส่งไม่สำเร็จ'); } finally { setBusy(false); } }}>
      <label>เลขบัตรประชาชน 13 หลัก<input name="cid" inputMode="numeric" autoComplete="off" maxLength={17} required/></label>
      <button className="primary" disabled={busy}>{busy ? 'กำลังส่ง…' : 'ส่งทดสอบ'}</button>
    </form>{result && <p role="status" className="helper padded">{result}</p>}</section>;
}
