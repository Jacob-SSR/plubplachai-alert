'use client';
import { useState } from 'react';
import { Download, Printer, RotateCw, Search } from 'lucide-react';
import { bangkokNow, addDays } from '@/src/domain/validation';
import { s, thaiDate, useLoad, type Api } from './ui';
import { baht, monthRange, pct, Pager, RankTable, ReportSkeleton, StatusBar, SummaryStrip } from './report-kit';

const STATUS: Record<string, string> = { ATTENDED: 'มาตามนัด', MISSED: 'ไม่มาตามนัด', PENDING: 'ยังไม่ถึงวันนัด' };
type Procedure = { name: string; qty: number; amount: number };
type Count = { appointments: number; attended: number; pending: number; missed: number; amount: number };
type Row = { oapp_id: string; hn: string; patient_name: string; clinic_code: string; clinic_name: string; appointment_date: string;
  status: string; amount: number | null; procedures: Procedure[]; icd10: { code: string; name: string }[] };
type Report = { from: string; to: string; summary: Count; clinics: (Count & { code: string; name: string })[];
  procedures: (Procedure & { visits: number })[]; icd10: { code: string; name: string; visits: number; amount: number }[]; rows: Row[] };
type Clinic = { code: string; name: string };

export function Reports({ api }: { api: Api }) {
  const today = bangkokNow().day;
  const presets: [string, { from: string; to: string }][] = [['วันนี้', { from: today, to: today }], ['7 วันล่าสุด', { from: addDays(today, -6), to: today }],
    ['เดือนนี้', monthRange(today, 0)], ['เดือนที่แล้ว', monthRange(today, -1)]];
  const [period, setPeriod] = useState(presets[1][1]), [custom, setCustom] = useState(false), [clinic, setClinic] = useState('');
  const [status, setStatus] = useState(''), [q, setQ] = useState(''), [page, setPage] = useState(1), [size, setSize] = useState(50);
  const query = new URLSearchParams(Object.entries({ ...period, clinic }).filter(([, v]) => v)).toString();
  const { data, error, busy, reload } = useLoad<Report>(api, `reports?${query}`);
  const clinics = useLoad<Clinic[]>(api, 'clinics').data ?? [];
  const active = presets.find(([, p]) => !custom && p.from === period.from && p.to === period.to)?.[0];
  const choose = (p: { from: string; to: string }) => { setPeriod(p); setCustom(false); setPage(1); };
  const needle = q.trim().replace(/\s+/g, '');
  const rows = (data?.rows ?? []).filter(a => (!status || a.status === status) && (!needle || a.hn.includes(needle) || a.patient_name.replace(/\s+/g, '').includes(needle)));
  const pages = Math.max(1, Math.ceil(rows.length / size)), current = Math.min(page, pages);
  const sum = data?.summary;
  return <div className="rk">
    <div className="section-head"><div><h2>รายงานการมารับบริการ</h2>
      <p className="muted">อ่านสดจาก HOSxP ช่วง {thaiDate(period.from)} – {thaiDate(period.to)}</p></div>
      <div className="actions"><button onClick={reload} aria-label="โหลดใหม่"><RotateCw size={17}/></button><button onClick={() => window.print()}><Printer size={17}/>พิมพ์</button>
        <a className="button primary" href={`/api/v1/exports/report?${query}`}><Download size={17}/>ดาวน์โหลด Excel</a></div></div>

    <div className="surface rk-filters">
      <div className="rk-seg" role="group" aria-label="ช่วงวันนัด">
        {presets.map(([label, p]) => <button key={label} aria-pressed={active === label} onClick={() => choose(p)}>{label}</button>)}
        <button aria-pressed={custom || !active} onClick={() => setCustom(true)}>กำหนดเอง</button></div>
      {(custom || !active) && <><label>ตั้งแต่<input type="date" value={period.from} onChange={e => { setPeriod({ ...period, from: e.target.value }); setPage(1); }}/></label>
        <label>ถึง (ไม่เกิน 31 วัน)<input type="date" value={period.to} onChange={e => { setPeriod({ ...period, to: e.target.value }); setPage(1); }}/></label></>}
      <label>คลินิก<select value={clinic} onChange={e => { setClinic(e.target.value); setPage(1); }}><option value="">ทุกคลินิก</option>{clinics.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
    </div>

    {error && <div role="alert" className="error">{error}</div>}
    {!data && !error && <ReportSkeleton/>}
    {data && sum && <div aria-busy={busy} className={busy ? 'rk-busy' : undefined}>
      <SummaryStrip stats={[
        { label: 'นัดหมาย', value: sum.appointments.toLocaleString(), note: `${thaiDate(data.from)} – ${thaiDate(data.to)}` },
        { label: 'มาตามนัด', value: sum.attended.toLocaleString(), note: `${pct(sum.attended, sum.appointments)}% ของนัด` },
        { label: 'ไม่มาตามนัด', value: sum.missed.toLocaleString(), note: `${pct(sum.missed, sum.appointments)}% ของนัด` },
        { label: 'ยังไม่ถึงวันนัด', value: sum.pending.toLocaleString() },
        { label: 'ค่าบริการ (บาท)', value: baht(sum.amount), note: 'หัตถการที่เรียกเก็บ ไม่รวมยา', tone: 'money' }]}/>

      <section className="surface rk-block"><h3>แยกตามคลินิก</h3>
        <div className="table-scroll"><table className="rk-table"><thead><tr><th>คลินิก</th><th>การมาตามนัด</th><th className="num">นัด</th><th className="num">บาท</th></tr></thead>
          <tbody>{!data.clinics.length ? <tr><td colSpan={4} className="empty">ไม่มีนัดในช่วงนี้</td></tr> : data.clinics.map(c => <tr key={c.code}><td>{c.name}</td>
            <td><StatusBar c={c}/></td><td className="num">{c.appointments.toLocaleString()}</td><td className="num">{baht(c.amount)}</td></tr>)}</tbody>
          {data.clinics.length > 1 && <tfoot><tr><td>รวม</td><td><StatusBar c={sum}/></td><td className="num">{sum.appointments.toLocaleString()}</td><td className="num">{baht(sum.amount)}</td></tr></tfoot>}</table></div>
      </section>

      <div className="rk-two">
        <section className="surface rk-block"><h3>หัตถการที่เรียกเก็บ</h3>
          <RankTable head="หัตถการ" items={data.procedures} empty="ยังไม่มีค่าบริการในช่วงนี้" label={p => <>{p.name} <span className="muted">×{p.qty.toLocaleString()}</span></>}/></section>
        <section className="surface rk-block"><h3>ICD-10 โรคหลัก</h3>
          <RankTable head="รหัส / ชื่อโรค" items={data.icd10} empty="ยังไม่มีรหัส ICD-10 ในช่วงนี้" label={c => <><b>{c.code}</b> {c.name}</>}/></section>
      </div>

      <section className="surface rk-block"><div className="rk-head"><h3>รายการนัด</h3>
        <div className="rk-seg small" role="group" aria-label="สถานะ">
          {[['', 'ทั้งหมด'], ...Object.entries(STATUS)].map(([k, v]) => <button key={k} aria-pressed={status === k} onClick={() => { setStatus(k); setPage(1); }}>{v}</button>)}</div></div>
        <div className="rk-filters rk-inline"><label className="rk-search">ค้นหา<span><Search size={17}/><input placeholder="HN หรือชื่อผู้ป่วย" value={q} onChange={e => { setQ(e.target.value); setPage(1); }}/></span></label></div>
        <div className="table-scroll"><table className="rk-table"><thead><tr><th>วันนัด</th><th>ผู้ป่วย</th><th>คลินิก</th><th>สถานะ</th><th>ICD-10 / หัตถการ</th><th className="num">บาท</th></tr></thead>
          <tbody>{!rows.length ? <tr><td colSpan={6} className="empty">ไม่มีนัดตามเงื่อนไขนี้</td></tr> : rows.slice((current - 1) * size, current * size).map(a => <tr key={a.oapp_id}>
            <td>{thaiDate(a.appointment_date)}</td>
            <td>{a.patient_name || '—'}<small>HN {a.hn}</small></td>
            <td>{s(a.clinic_name) || a.clinic_code}</td>
            <td><span className={`badge status-${a.status.toLowerCase()}`}>{STATUS[a.status]}</span></td>
            <td>{a.icd10.length || a.procedures.length ? <>{a.icd10.map(c => <small key={c.code}><b>{c.code}</b> {c.name}</small>)}
              {a.procedures.map(p => <small key={p.name}>{p.name} ×{p.qty} · {baht(p.amount)}</small>)}</> : <span className="muted">—</span>}</td>
            <td className="num">{a.amount == null ? <span className="muted">—</span> : baht(a.amount)}</td></tr>)}</tbody></table></div>
        {rows.length > 0 && <Pager page={current} size={size} total={rows.length} onPage={setPage} onSize={n => { setSize(n); setPage(1); }}/>}
      </section>
    </div>}
  </div>;
}
