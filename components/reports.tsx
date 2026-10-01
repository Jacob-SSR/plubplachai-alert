'use client';
import { useState } from 'react';
import { Printer } from 'lucide-react';
import { bangkokNow, addDays } from '@/src/domain/validation';
import { Table, s, thaiDate, useLoad, type Api } from './ui';

const STATUS: Record<string, string> = { ATTENDED: 'มาตามนัด', PENDING: 'ยังไม่ถึงวันนัด', MISSED: 'ไม่มาตามนัด' };
type Procedure = { name: string; qty: number; amount: number };
type Count = { appointments: number; attended: number; pending: number; missed: number; amount: number };
type Row = { oapp_id: string; hn: string; patient_name: string; clinic_code: string; clinic_name: string; appointment_date: string;
  status: string; amount: number | null; procedures: Procedure[]; icd10: { code: string; name: string }[] };
type Report = { from: string; to: string; summary: Count; clinics: (Count & { code: string; name: string })[];
  procedures: (Procedure & { visits: number })[]; icd10: { code: string; name: string; visits: number; amount: number }[]; rows: Row[] };
type Clinic = { code: string; name: string };
const baht = (v: number) => v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PAGE = 100;

export function Reports({ api }: { api: Api }) {
  const today = bangkokNow().day;
  const [filter, setFilter] = useState({ from: addDays(today, -6), to: today, clinic: '' });
  const [onlyVisits, setOnlyVisits] = useState(true), [shown, setShown] = useState(PAGE);
  const query = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  const { data, error, busy, reload } = useLoad<Report>(api, `reports?${query}`);
  const clinics = useLoad<Clinic[]>(api, 'clinics').data ?? [];
  const rows = (data?.rows ?? []).filter(a => !onlyVisits || a.status === 'ATTENDED');
  const sum = data?.summary;
  return <>
    <div className="section-head"><div><h2>รายงานการมารับบริการ</h2>
      <p className="muted">อ่านสดจาก HOSxP · มาตามนัดดูจาก visit_vn · ค่าบริการ = หัตถการที่เรียกเก็บในแต่ละครั้งที่มา (ไม่รวมยา) · ICD-10 จาก icd101</p></div>
      <div className="actions"><button onClick={() => window.print()}><Printer size={16}/>พิมพ์ / PDF</button><button onClick={reload}>โหลดใหม่</button></div></div>
    <div className="surface">
      <form className="filters" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget);
        setFilter({ from: s(f.get('from')), to: s(f.get('to')), clinic: s(f.get('clinic')) }); setShown(PAGE); }}>
        <label>ตั้งแต่<input type="date" name="from" defaultValue={filter.from} required/></label>
        <label>ถึง<input type="date" name="to" defaultValue={filter.to} required/></label>
        <label>คลินิก<select name="clinic" defaultValue={filter.clinic}><option value="">ทุกคลินิก</option>{clinics.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
        <button className="primary">แสดงรายงาน</button>
      </form>
      <p className="helper" style={{ padding: '0 20px' }}>เลือกช่วงได้ไม่เกิน 31 วันต่อครั้ง</p>
    </div>
    {error && <div role="alert" className="error">{error}</div>}
    {!data && !error && <div className="loading" role="status">กำลังอ่านข้อมูลจาก HOSxP…</div>}
    {data && sum && <div aria-busy={busy}>
      <div className="metrics">
        <div><span>นัดทั้งหมด</span><strong>{sum.appointments.toLocaleString()}<small>นัด</small></strong><p>{thaiDate(data.from)} – {thaiDate(data.to)}</p></div>
        <div><span>มาตามนัด</span><strong>{sum.attended.toLocaleString()}<small>นัด</small></strong><p>{sum.appointments ? Math.round(sum.attended / sum.appointments * 100) : 0}% ของนัดทั้งหมด</p></div>
        <div><span>ไม่มาตามนัด</span><strong>{sum.missed.toLocaleString()}<small>นัด</small></strong><p>ยังไม่ถึงวันนัด {sum.pending.toLocaleString()} นัด</p></div>
        <div><span>ค่าบริการรวม</span><strong>{baht(sum.amount)}<small>บาท</small></strong><p>ค่าหัตถการทุกครั้งที่มารับบริการ</p></div>
      </div>
      <section className="surface padded"><div className="section-head"><h3>แยกตามคลินิก</h3></div>
        <Table headers={['คลินิก', 'นัดทั้งหมด', 'มาตามนัด', 'ไม่มาตามนัด', 'ยังไม่ถึงวันนัด', 'ค่าบริการ (บาท)']} empty={!data.clinics.length}>
          {data.clinics.map(c => <tr key={c.code}><td>{c.name}</td><td>{c.appointments}</td><td>{c.attended}</td><td>{c.missed}</td><td>{c.pending}</td><td className="num">{baht(c.amount)}</td></tr>)}
        </Table></section>
      <div className="report-grid">
        <section className="surface padded"><div className="section-head"><h3>แยกตามหัตถการ</h3></div>
          <Table headers={['หัตถการ', 'ครั้งที่มา', 'จำนวน', 'ค่าบริการ (บาท)']} empty={!data.procedures.length}>
            {data.procedures.map(p => <tr key={p.name}><td>{p.name}</td><td>{p.visits.toLocaleString()}</td><td>{p.qty.toLocaleString()}</td><td className="num">{baht(p.amount)}</td></tr>)}
          </Table></section>
        <section className="surface padded"><div className="section-head"><h3>แยกตาม ICD-10 (โรคหลัก)</h3></div>
          <Table headers={['ICD-10', 'ครั้งที่มา', 'ค่าบริการ (บาท)']} empty={!data.icd10.length}>
            {data.icd10.map(c => <tr key={c.code}><td><strong>{c.code}</strong><small>{c.name}</small></td><td>{c.visits.toLocaleString()}</td><td className="num">{baht(c.amount)}</td></tr>)}
          </Table></section>
      </div>
      <section className="surface padded"><div className="section-head"><h3>รายการแต่ละครั้งที่มารับบริการ</h3>
        <label className="checkbox"><input type="checkbox" checked={onlyVisits} onChange={e => { setOnlyVisits(e.target.checked); setShown(PAGE); }}/>เฉพาะที่มาตามนัด</label></div>
        <Table headers={['วันนัด', 'ผู้ป่วย', 'คลินิก', 'สถานะ', 'ICD-10', 'หัตถการ', 'ค่าบริการ (บาท)']} empty={!rows.length}>
          {rows.slice(0, shown).map(a => <tr key={a.oapp_id}>
            <td>{thaiDate(a.appointment_date)}</td>
            <td><strong>{a.patient_name || '—'}</strong><small>HN {a.hn}</small></td>
            <td>{a.clinic_name || a.clinic_code}</td>
            <td><span className={`badge status-${a.status.toLowerCase()}`}>{STATUS[a.status]}</span></td>
            <td>{a.icd10.length ? a.icd10.map(c => <small key={c.code}>{c.code}{c.name ? ` ${c.name}` : ''}</small>) : '—'}</td>
            <td>{a.procedures.length ? a.procedures.map(p => <small key={p.name}>{p.name} ×{p.qty} · {baht(p.amount)}</small>) : '—'}</td>
            <td className="num">{a.amount == null ? '—' : <strong>{baht(a.amount)}</strong>}</td>
          </tr>)}
        </Table>
        {rows.length > shown && <div className="pagination"><span className="muted">แสดง {shown.toLocaleString()} จาก {rows.length.toLocaleString()} รายการ</span>
          <button onClick={() => setShown(v => v + PAGE)}>แสดงเพิ่ม</button></div>}
      </section>
    </div>}
  </>;
}
