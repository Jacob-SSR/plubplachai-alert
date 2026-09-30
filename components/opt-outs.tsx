'use client';
import { useState } from 'react';
import { Table, s, thaiDate, useLoad, type Api } from './ui';

type OptOut = { hn: string; note: string; created_at: string; created_by: string | null; patient_name: string | null };
export function OptOuts({ api }: { api: Api }) {
  const { data, error, busy, reload } = useLoad<OptOut[]>(api, 'opt-outs');
  const [message, setMessage] = useState('');
  return <>
    <div className="section-head"><div><h2>งดส่งรายคน</h2><p className="muted">ผู้ป่วยที่ขอไม่รับข้อความแจ้งนัด ระบบจะไม่ส่งทั้งแบบอัตโนมัติและแบบกดส่งเอง</p></div></div>
    <section className="surface">
      <form className="filters" onSubmit={async e => { e.preventDefault(); const form = e.currentTarget, f = new FormData(form); setMessage('');
        try { await api('opt-outs', 'POST', { hn: s(f.get('hn')).trim(), note: s(f.get('note')) }); form.reset(); setMessage('บันทึกแล้ว ข้อความที่ยังรอส่งของ HN นี้ถูกยกเลิก'); reload(); }
        catch (err) { setMessage(err instanceof Error ? err.message : 'บันทึกไม่ได้'); } }}>
        <label>HN<input name="hn" required maxLength={20} autoComplete="off"/></label>
        <label>หมายเหตุ<input name="note" maxLength={255} placeholder="เช่น ผู้ป่วยแจ้งที่ห้องบัตร"/></label>
        <button className="primary">เพิ่มรายการงดส่ง</button>
      </form>
      {message && <p role="status" className="helper padded">{message}</p>}
      {error && <div role="alert" className="error">{error}</div>}
      <div aria-busy={busy}><Table headers={['HN', 'ผู้ป่วย', 'หมายเหตุ', 'บันทึกโดย', '']} empty={!data?.length}>
        {data?.map(o => <tr key={o.hn}><td>{o.hn}</td><td>{o.patient_name || '—'}</td><td>{o.note || '—'}</td><td>{o.created_by || '—'}<small>{thaiDate(o.created_at)}</small></td>
          <td><button onClick={async () => { if (!window.confirm(`ยกเลิกงดส่งของ HN ${o.hn}?`)) return; try { await api(`opt-outs/${encodeURIComponent(o.hn)}/remove`, 'POST', {}); reload(); } catch (err) { setMessage(err instanceof Error ? err.message : 'ลบไม่ได้'); } }}>กลับมารับข้อความ</button></td></tr>)}
      </Table></div>
    </section>
  </>;
}
