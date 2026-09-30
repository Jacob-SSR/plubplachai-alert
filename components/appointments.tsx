'use client';
import { useState } from 'react';
import { bangkokNow, addDays } from '@/src/domain/validation';
import { Table, STATUS_NAMES, KIND_NAMES, s, n, thaiDate, time, useLoad, type Api } from './ui';

type Row = { oapp_id: string; hn: string; patient_name: string; clinic_code: string; clinic_name: string | null; clinic_enabled: number;
  appointment_date: string; appointment_time: string | null; location: string; doctor_name: string; active: number; opted_out: number; last_notice: string | null };
type Result = { total: number; page: number; size: number; data: Row[] };
type Clinic = { code: string; name: string };
function lastNotice(v: string | null) {
  if (!v) return '—';
  const [kind, status] = v.split(':');
  return `${KIND_NAMES[kind] ?? kind} · ${STATUS_NAMES[status] ?? status}`;
}
export function Appointments({ api, canSend }: { api: Api; canSend: boolean }) {
  const today = bangkokNow().day;
  const [filter, setFilter] = useState({ from: today, to: addDays(today, 7), clinic: '', q: '', page: 1 });
  const query = new URLSearchParams(Object.entries(filter).map(([k, v]) => [k, String(v)])).toString();
  const { data, error, busy, reload } = useLoad<Result>(api, `appointments?${query}`);
  const clinics = useLoad<Clinic[]>(api, 'clinics').data ?? [];
  const [sending, setSending] = useState(''), [sent, setSent] = useState<Record<string, string>>({});
  async function notify(a: Row) {
    if (!window.confirm(`ส่งแจ้งเตือนนัดให้ ${a.patient_name || 'HN ' + a.hn} ตอนนี้?`)) return;
    setSending(a.oapp_id);
    try { const r = await api('notifications/manual', 'POST', { oappId: a.oapp_id }) as { status: string; safe_error: string | null };
      setSent(v => ({ ...v, [a.oapp_id]: `${STATUS_NAMES[r.status] ?? r.status}${r.safe_error ? ` · ${r.safe_error}` : ''}` })); }
    catch (e) { setSent(v => ({ ...v, [a.oapp_id]: e instanceof Error ? e.message : 'ส่งไม่สำเร็จ' })); }
    finally { setSending(''); }
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
  return <>
    <div className="section-head"><div><h2>นัดหมายจาก HOSxP</h2><p className="muted">ทุกคลินิก จากการอ่านรอบล่าสุดของ worker · แก้ไขหรือยกเลิกนัดใน HOSxP เท่านั้น</p></div><button onClick={reload}>โหลดใหม่</button></div>
    <div className="surface">
      <form className="filters" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget);
        setFilter({ from: s(f.get('from')), to: s(f.get('to')), clinic: s(f.get('clinic')), q: s(f.get('q')).trim(), page: 1 }); }}>
        <label>ค้นหา HN หรือชื่อ<input name="q" defaultValue={filter.q} placeholder="HN หรือชื่อผู้ป่วย"/></label>
        <label>ตั้งแต่<input type="date" name="from" defaultValue={filter.from} required/></label>
        <label>ถึง<input type="date" name="to" defaultValue={filter.to} required/></label>
        <label>คลินิก<select name="clinic" defaultValue={filter.clinic}><option value="">ทุกคลินิก</option>{clinics.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
        <button className="primary">ค้นหา</button>
      </form>
      {error && <div role="alert" className="error">{error}</div>}
      <div aria-busy={busy}><Table headers={['วันเวลานัด', 'ผู้ป่วย', 'คลินิก / จุดติดต่อ', 'แจ้งเตือนล่าสุด', '']} empty={!data?.data.length}>
        {data?.data.map(a => <tr key={a.oapp_id}>
          <td><strong>{thaiDate(a.appointment_date)}</strong><small>{time(a.appointment_time)}</small></td>
          <td><strong>{a.patient_name || '—'}</strong><small>HN {a.hn}{a.opted_out ? ' · งดส่ง' : ''}</small></td>
          <td>{s(a.clinic_name) || a.clinic_code}{!a.clinic_enabled && <span className="badge">ไม่ได้เปิดแจ้งเตือน</span>}<small>{a.location || '—'}{a.doctor_name ? ` · ${a.doctor_name}` : ''}</small></td>
          <td>{sent[a.oapp_id] ?? lastNotice(a.last_notice)}</td>
          <td>{canSend && !!a.active && !a.opted_out && <button disabled={sending === a.oapp_id} onClick={() => notify(a)}>{sending === a.oapp_id ? 'กำลังส่ง…' : 'ส่งแจ้งเตือน'}</button>}</td>
        </tr>)}
      </Table></div>
      <div className="pagination"><span className="muted">ทั้งหมด {n(data?.total).toLocaleString()} นัด · หน้า {filter.page} / {pages}</span>
        <span><button disabled={filter.page <= 1} onClick={() => setFilter(f => ({ ...f, page: f.page - 1 }))}>ก่อนหน้า</button> <button disabled={filter.page >= pages} onClick={() => setFilter(f => ({ ...f, page: f.page + 1 }))}>ถัดไป</button></span></div>
    </div>
    <p className="helper">ปุ่ม “ส่งแจ้งเตือน” อ่านนัดจาก HOSxP ใหม่แล้วส่งทันที แม้คลินิกยังไม่ได้เปิดแจ้งเตือนอัตโนมัติ แต่จะไม่ส่งให้ผู้ป่วยที่ขอ “งดส่ง”</p>
  </>;
}
