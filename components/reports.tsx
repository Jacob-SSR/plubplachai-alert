'use client';
import { useState } from 'react';
import { CalendarCheck, CalendarClock, CalendarX, Download, Printer, Search, Users, Wallet } from 'lucide-react';
import { bangkokNow, addDays } from '@/src/domain/validation';
import { s, thaiDate, useLoad, type Api } from './ui';

const STATUS: Record<string, string> = { ATTENDED: 'มาตามนัด', MISSED: 'ไม่มาตามนัด', PENDING: 'ยังไม่ถึงวันนัด' };
type Procedure = { name: string; qty: number; amount: number };
type Count = { appointments: number; attended: number; pending: number; missed: number; amount: number };
type Row = { oapp_id: string; hn: string; patient_name: string; clinic_code: string; clinic_name: string; appointment_date: string;
  status: string; amount: number | null; procedures: Procedure[]; icd10: { code: string; name: string }[] };
type Report = { from: string; to: string; summary: Count; clinics: (Count & { code: string; name: string })[];
  procedures: (Procedure & { visits: number })[]; icd10: { code: string; name: string; visits: number; amount: number }[]; rows: Row[] };
type Clinic = { code: string; name: string };
const baht = (v: number) => v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (part: number, whole: number) => whole ? Math.round(part / whole * 100) : 0;
// First and last day of the month `offset` months from `day`.
function monthRange(day: string, offset: number) {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + offset);
  const from = d.toISOString().slice(0, 10); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
  return { from, to: d.toISOString().slice(0, 10) };
}
const PAGE = 100;

// Attended / missed / pending as one stacked bar, with the counts as text beside it.
function StatusBar({ c }: { c: Count }) {
  return <div className="rp-status"><div className="rp-stack" role="img" aria-label={`มาตามนัด ${c.attended} ไม่มาตามนัด ${c.missed} ยังไม่ถึงวันนัด ${c.pending}`}>
    <i className="ok" style={{ width: `${pct(c.attended, c.appointments)}%` }}/><i className="miss" style={{ width: `${pct(c.missed, c.appointments)}%` }}/>
    <i className="wait" style={{ width: `${pct(c.pending, c.appointments)}%` }}/></div>
    <small>มา {c.attended} · ไม่มา {c.missed} · รอ {c.pending}</small></div>;
}
// Top entries by money, each with a bar against the largest; "ดูทั้งหมด" shows the rest.
function TopList<T extends { amount: number; visits: number }>({ title, note, items, label, empty }:
  { title: string; note: string; items: T[]; label: (t: T) => React.ReactNode; empty: string }) {
  const [all, setAll] = useState(false), max = Math.max(1, ...items.map(i => i.amount)), shown = all ? items : items.slice(0, 8);
  return <section className="surface padded rp-top"><div className="rp-section-title"><h3>{title}</h3><p className="muted">{note}</p></div>
    {!items.length ? <p className="rp-empty">{empty}</p> : <ol>{shown.map((t, i) => <li key={i}>
      <div className="rp-top-row"><span className="rp-top-label">{label(t)}</span><strong>{baht(t.amount)}</strong></div>
      <div className="rp-meter"><i style={{ width: `${Math.max(2, t.amount / max * 100)}%` }}/></div><small>{t.visits.toLocaleString()} ครั้ง</small></li>)}</ol>}
    {items.length > 8 && <button className="link-button" onClick={() => setAll(v => !v)}>{all ? 'ย่อ' : `ดูทั้งหมด (${items.length})`}</button>}
  </section>;
}

export function Reports({ api }: { api: Api }) {
  const today = bangkokNow().day;
  const presets: [string, { from: string; to: string }][] = [['วันนี้', { from: today, to: today }], ['7 วันล่าสุด', { from: addDays(today, -6), to: today }],
    ['เดือนนี้', monthRange(today, 0)], ['เดือนที่แล้ว', monthRange(today, -1)]];
  const [period, setPeriod] = useState(presets[1][1]), [custom, setCustom] = useState(false), [clinic, setClinic] = useState('');
  const [status, setStatus] = useState(''), [q, setQ] = useState(''), [shown, setShown] = useState(PAGE);
  const query = new URLSearchParams(Object.entries({ ...period, clinic }).filter(([, v]) => v)).toString();
  const { data, error, busy, reload } = useLoad<Report>(api, `reports?${query}`);
  const clinics = useLoad<Clinic[]>(api, 'clinics').data ?? [];
  const active = presets.find(([, p]) => !custom && p.from === period.from && p.to === period.to)?.[0];
  const choose = (p: { from: string; to: string }) => { setPeriod(p); setCustom(false); setShown(PAGE); };
  const needle = q.trim().replace(/\s+/g, '');
  const rows = (data?.rows ?? []).filter(a => (!status || a.status === status) && (!needle || a.hn.includes(needle) || a.patient_name.replace(/\s+/g, '').includes(needle)));
  const sum = data?.summary;
  return <div className="rp">
    <div className="section-head"><div><h2>รายงานการมารับบริการ</h2>
      <p className="muted">อ่านสดจาก HOSxP · {thaiDate(period.from)} – {thaiDate(period.to)} · ค่าบริการ = หัตถการที่เรียกเก็บในแต่ละครั้งที่มา (ไม่รวมยา)</p></div>
      <div className="actions"><button onClick={() => window.print()}><Printer size={18}/>พิมพ์</button><button onClick={reload}>โหลดใหม่</button>
        <a className="button primary rp-excel" href={`/api/v1/exports/report?${query}`}><Download size={18}/>ดาวน์โหลด Excel</a></div></div>

    <div className="surface filters rp-filters">
      <div className="rp-chips" role="group" aria-label="ช่วงวันนัด">
        {presets.map(([label, p]) => <button key={label} aria-pressed={active === label} onClick={() => choose(p)}>{label}</button>)}
        <button aria-pressed={custom || !active} onClick={() => setCustom(true)}>กำหนดเอง</button></div>
      {(custom || !active) && <div className="rp-dates">
        <label>ตั้งแต่<input type="date" value={period.from} onChange={e => setPeriod({ ...period, from: e.target.value })}/></label>
        <label>ถึง<input type="date" value={period.to} onChange={e => setPeriod({ ...period, to: e.target.value })}/></label>
        <p className="helper">เลือกได้ไม่เกิน 31 วันต่อครั้ง</p></div>}
      <div className="rp-fields">
        <label>คลินิก<select aria-label="คลินิก" value={clinic} onChange={e => { setClinic(e.target.value); setShown(PAGE); }}><option value="">ทุกคลินิก</option>{clinics.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
      </div>
    </div>

    {error && <div role="alert" className="error">{error}</div>}
    {!data && !error && <p className="rp-loading" role="status">กำลังอ่านข้อมูลจาก HOSxP…</p>}
    {data && sum && <div aria-busy={busy} className={busy ? 'rp-dim' : ''}>
      <div className="rp-kpis">
        <div className="rp-kpi"><Users size={22}/><span>นัดทั้งหมด</span><strong>{sum.appointments.toLocaleString()}</strong><small>{thaiDate(data.from)} – {thaiDate(data.to)}</small></div>
        <div className="rp-kpi ok"><CalendarCheck size={22}/><span>มาตามนัด</span><strong>{sum.attended.toLocaleString()}</strong>
          <small>{pct(sum.attended, sum.appointments)}% ของนัดทั้งหมด</small><div className="rp-meter"><i style={{ width: `${pct(sum.attended, sum.appointments)}%` }}/></div></div>
        <div className="rp-kpi miss"><CalendarX size={22}/><span>ไม่มาตามนัด</span><strong>{sum.missed.toLocaleString()}</strong><small>{pct(sum.missed, sum.appointments)}% · เลยวันนัดแล้ว</small></div>
        <div className="rp-kpi wait"><CalendarClock size={22}/><span>ยังไม่ถึงวันนัด</span><strong>{sum.pending.toLocaleString()}</strong><small>นัดในช่วงที่เลือก</small></div>
        <div className="rp-kpi money"><Wallet size={22}/><span>ค่าบริการรวม</span><strong>{baht(sum.amount)}</strong><small>บาท · เฉลี่ย {baht(sum.attended ? sum.amount / sum.attended : 0)} ต่อครั้ง</small></div>
      </div>

      <section className="surface padded"><div className="rp-section-title"><h3>แยกตามคลินิก</h3><p className="muted">เรียงตามค่าบริการ</p></div>
        <div className="table-scroll"><table className="rp-table"><thead><tr><th>คลินิก</th><th>การมาตามนัด</th><th className="num">นัด</th><th className="num">ค่าบริการ (บาท)</th></tr></thead>
          <tbody>{!data.clinics.length ? <tr><td colSpan={4} className="empty">ไม่มีนัดในช่วงนี้</td></tr> : data.clinics.map(c => <tr key={c.code}><td><strong>{c.name}</strong></td>
            <td><StatusBar c={c}/></td><td className="num">{c.appointments.toLocaleString()}</td><td className="num"><strong>{baht(c.amount)}</strong></td></tr>)}
            {data.clinics.length > 1 && <tr className="rp-total"><td>รวม</td><td><StatusBar c={sum}/></td><td className="num">{sum.appointments.toLocaleString()}</td><td className="num">{baht(sum.amount)}</td></tr>}</tbody></table></div>
      </section>

      <div className="rp-two">
        <TopList title="แยกตามหัตถการ" note="รายการที่เรียกเก็บใน HOSxP (ไม่รวมยา)" items={data.procedures} empty="ยังไม่มีค่าบริการในช่วงนี้"
          label={p => <>{p.name}<small> ×{p.qty.toLocaleString()}</small></>}/>
        <TopList title="แยกตาม ICD-10 (โรคหลัก)" note="ค่าบริการของแต่ละครั้งนับเข้าโรคหลัก" items={data.icd10} empty="ยังไม่มีรหัส ICD-10 ในช่วงนี้"
          label={c => <><b>{c.code}</b> {c.name}</>}/>
      </div>

      <section className="surface padded"><div className="rp-section-title"><h3>รายการแต่ละนัด</h3><p className="muted">{rows.length.toLocaleString()} รายการ</p></div>
        <div className="rp-fields" style={{ marginBottom: 12 }}>
          <label className="rp-search"><Search size={18}/><input aria-label="ค้นหา HN หรือชื่อ" placeholder="ค้นหา HN หรือชื่อผู้ป่วย" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE); }}/></label></div>
        <div className="rp-chips small" role="group" aria-label="สถานะ">
          {[['', 'ทั้งหมด'], ...Object.entries(STATUS)].map(([k, v]) => <button key={k} aria-pressed={status === k} onClick={() => { setStatus(k); setShown(PAGE); }}>{v}</button>)}</div>
        <div className="table-scroll"><table className="rp-table"><thead><tr><th>วันนัด</th><th>ผู้ป่วย</th><th>คลินิก</th><th>สถานะ</th><th>ICD-10 / หัตถการ</th><th className="num">ค่าบริการ (บาท)</th></tr></thead>
          <tbody>{!rows.length ? <tr><td colSpan={6} className="empty">ไม่มีนัดตามเงื่อนไขนี้</td></tr> : rows.slice(0, shown).map(a => <tr key={a.oapp_id}>
            <td>{thaiDate(a.appointment_date)}</td>
            <td><strong>{a.patient_name || '—'}</strong><small>HN {a.hn}</small></td>
            <td>{s(a.clinic_name) || a.clinic_code}</td>
            <td><span className={`badge status-${a.status.toLowerCase()}`}>{STATUS[a.status]}</span></td>
            <td>{a.icd10.length || a.procedures.length ? <>{a.icd10.map(c => <small key={c.code}><b>{c.code}</b> {c.name}</small>)}
              {a.procedures.map(p => <small key={p.name}>{p.name} ×{p.qty} · {baht(p.amount)}</small>)}</> : '—'}</td>
            <td className="num">{a.amount == null ? '—' : <strong>{baht(a.amount)}</strong>}</td></tr>)}</tbody></table></div>
        {rows.length > shown && <div className="rp-more"><span className="muted">แสดง {shown.toLocaleString()} จาก {rows.length.toLocaleString()}</span>
          <button onClick={() => setShown(v => v + PAGE)}>แสดงเพิ่ม</button></div>}
      </section>
    </div>}
  </div>;
}
