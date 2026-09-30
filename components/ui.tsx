'use client';
import { useEffect,useState } from 'react';
import { X } from 'lucide-react';
export type Item={id:number;[key:string]:unknown};
export type Api=(path:string,method?:string,body?:unknown)=>Promise<unknown>;
export const s=(v:unknown)=>v==null?'':String(v);
export const n=(v:unknown)=>Number(v)||0;
export function thaiDate(v:unknown){return v?new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Bangkok'}).format(new Date(`${String(v).slice(0,10)}T00:00:00+07:00`)):'—';}
export function Field({label,...props}:React.InputHTMLAttributes<HTMLInputElement>&{label:string}){return <label>{label}<input {...props}/></label>;}
export function Select({label,options,display='name',...props}:React.SelectHTMLAttributes<HTMLSelectElement>&{label:string;options:Item[];display?:string}){return <label>{label}<select aria-label={label} {...props}><option value="">เลือก{label}</option>{options.map(o=><option key={o.id} value={o.id}>{s(o[display])}</option>)}</select></label>;}
export function Checks({label,options,name='serviceIds',selected=[]}:{label:string;options:Item[];name?:string;selected?:number[]}){return <fieldset className="checks"><legend>{label}</legend>{options.length?options.map(o=><label key={o.id}><input type="checkbox" name={name} value={o.id} defaultChecked={selected.includes(o.id)}/>{s(o.name)}</label>):<p className="muted">ยังไม่มีรายการให้เลือก</p>}</fieldset>;}
export function Table({headers,children,empty=false}:{headers:string[];children?:React.ReactNode;empty?:boolean}){return <div className="table-scroll"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{empty?<tr><td colSpan={headers.length} className="empty">ยังไม่มีข้อมูลในรายการนี้</td></tr>:children}</tbody></table></div>;}
export function FormPanel({title,onClose,onSubmit,children}:{title:string;onClose:()=>void;onSubmit:(f:FormData)=>Promise<void>;children:React.ReactNode}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <section className="form-panel" aria-label={title}><div className="section-head"><h3>{title}</h3><button className="icon-button" aria-label="ปิดแบบฟอร์ม" onClick={onClose}><X size={20}/></button></div><form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError('');try{await onSubmit(f);onClose();}catch(e){setError(e instanceof Error?e.message:'บันทึกไม่ได้');}finally{setBusy(false);}}}><div className="form-grid">{children}</div>{error&&<p role="alert" className="error">{error}</p>}<div className="form-actions"><button type="button" onClick={onClose}>ยกเลิก</button><button className="primary" disabled={busy}>{busy?'กำลังบันทึก…':'บันทึกข้อมูล'}</button></div></form></section>;
}
export const ids=(f:FormData,name='serviceIds')=>f.getAll(name).map(Number);
// Loads one API path, reloads on demand. Old responses never overwrite a newer request.
export function useLoad<T>(api:Api,path:string){
 const [tick,setTick]=useState(0),key=`${path}#${tick}`;
 const [state,setState]=useState<{key:string;data?:T;error:string}>({key:'',error:''});
 useEffect(()=>{let alive=true;api(path).then(data=>{if(alive)setState({key,data:data as T,error:''});}).catch(e=>{if(alive)setState(s=>({key,data:s.data,error:e instanceof Error?e.message:'โหลดข้อมูลไม่ได้'}));});return()=>{alive=false;};},[api,path,key]);
 // Busy until the response for the current path arrives; the previous data stays on screen meanwhile.
 return {data:state.data,error:state.key===key?state.error:'',busy:state.key!==key,reload:()=>setTick(t=>t+1)};
}
export const STATUS_NAMES:Record<string,string>={PENDING:'รอส่ง',SENDING:'กำลังส่ง',ACCEPTED:'MOPH รับคำขอแล้ว',FAILED:'ส่งไม่ผ่าน',UNKNOWN:'ยังยืนยันผลไม่ได้',CANCELLED:'ยกเลิก',BLOCKED:'ส่งไม่ได้',DRY_RUN:'ทดสอบ ไม่ได้ส่งจริง'};
export const KIND_NAMES:Record<string,string>={NEW:'ลงนัด / เลื่อนนัด',REMINDER:'เตือนก่อนวันนัด',MANUAL:'กดส่งเอง',CANCELLED:'ยกเลิกนัด'};
export const time=(v:unknown)=>v?String(v).slice(0,5)+' น.':'ไม่ระบุเวลา';
const REASONS:Record<string,string>={CLINIC_DISABLED:'คลินิกปิดแจ้งเตือน',PATIENT_OPTED_OUT:'ผู้ป่วยขอไม่รับข้อความ',HOSXP_APPOINTMENT_CHANGED:'นัดเปลี่ยนใน HOSxP ก่อนส่ง (ส่งฉบับใหม่แทน)',
 HOSXP_APPOINTMENT_REMOVED:'นัดหายจาก HOSxP หรือเลยวันนัด',APPOINTMENT_NO_LONGER_ELIGIBLE:'นัดเปลี่ยน ยกเลิก หรือเลยเวลานัดแล้ว',RULE_DISABLED:'ปิดรอบเตือนนี้แล้ว',
 WORKER_LEASE_EXPIRED:'worker หยุดระหว่างส่ง ยังไม่รู้ผล','No network request was made':'โหมดทดสอบ ไม่ได้ส่งออกจริง'};
export const reason=(v:unknown)=>v?REASONS[String(v)]??String(v):'—';
