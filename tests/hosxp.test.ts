import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAppointments, readForNotice, readClinics, toAppointment, NO_CLINIC, type SourceReader } from '../src/server/hosxp';
import { activeStatus, fingerprint, futureAppointment } from '../src/server/sync';
import { appointmentReport, appointmentReportExcel } from '../src/server/report';

const row = { oapp_id: '9007199254740993', hn: '0001234', fname: 'สมชาย ', lname: 'ใจดี', nextdate: '2026-10-02', nexttime: '09:00:00',
  clinic: '012', clinic_name: 'คลินิกเบาหวาน', contact_point: '', department_name: 'OPD', oapp_status_id: null, doctor_name: 'แพทย์สมมติ',
  cid: '1101700203450', patient_cid: '1101700203450' };

test('all clinics are read a week at a time with bound dates, and the projection holds no CID', async () => {
  const calls: (string | number)[][] = [];
  const reader: SourceReader = async (sql, values) => {
    calls.push(values);
    assert.match(sql, /FROM oapp o LEFT JOIN patient p ON p.hn=o.hn/);
    assert.doesNotMatch(sql, /cid/i);
    assert.match(sql, /WHERE o.nextdate BETWEEN \? AND \?/);
    return values[0] === '2026-10-01' ? [row] : [];
  };
  const data = await readAppointments({ from: '2026-10-01', to: '2026-10-20' }, reader);
  assert.deepEqual(calls, [['2026-10-01', '2026-10-07'], ['2026-10-08', '2026-10-14'], ['2026-10-15', '2026-10-20']]);
  assert.equal(data.length, 1);
  assert.equal(data[0].oapp_id, '9007199254740993');
  assert.equal(data[0].patient_name, 'สมชาย ใจดี');
  assert.equal(data[0].location, 'OPD', 'falls back to the department when contact_point is empty');
  assert.equal(JSON.stringify(data).includes('1101700203450'), false);
});
test('too many rows in one week is refused instead of silently truncated', async () => {
  const reader: SourceReader = async () => Array.from({ length: 20001 }, (_, i) => ({ ...row, oapp_id: String(i) }));
  await assert.rejects(readAppointments({ from: '2026-10-01', to: '2026-10-02' }, reader), /มากเกิน/);
});
test('appointments without a clinic are grouped under "-"', () => {
  assert.equal(toAppointment({ ...row, clinic: null }).clinic_code, NO_CLINIC);
});
test('notice data is read live with the CID, ticked LAB lines and preparation; LAB table errors are ignored', async () => {
  const reader: SourceReader = async (sql, values) => {
    if (sql.includes('lab_app_order_service')) throw Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE' });
    if (sql.includes('lab_items')) return [{ name: 'HbA1c' }];
    assert.deepEqual(values, ['9007199254740993']);
    return [{ ...row, note2: 'FBS\r\nHbA1c', note1: 'งดน้ำงดอาหาร\nอื่นๆ' }];
  };
  const live = await readForNotice('9007199254740993', reader);
  assert.equal(live?.cid, '1101700203450');
  assert.deepEqual(live?.tests, ['FBS', 'HbA1c']);
  assert.deepEqual(live?.preparation, ['งดน้ำงดอาหาร']);
  await assert.rejects(readForNotice('1 OR 1=1', reader));
});
test('clinic list comes from the HOSxP clinic table', async () => {
  const clinics = await readClinics(async () => [{ clinic: '012', name: 'คลินิกเบาหวาน' }, { clinic: '', name: 'ว่าง' }]);
  assert.deepEqual(clinics, [{ code: '012', name: 'คลินิกเบาหวาน' }]);
});
test('status, time and fingerprint rules', () => {
  assert.equal(activeStatus(null), true); assert.equal(activeStatus(1), true); assert.equal(activeStatus(3), false);
  const noon = new Date('2026-10-02T12:00:00+07:00');
  assert.equal(futureAppointment('2026-10-02', '13:00:00', noon), true);
  assert.equal(futureAppointment('2026-10-02', '11:00:00', noon), false);
  assert.equal(futureAppointment('2026-10-02', null, noon), true);
  const a = toAppointment(row);
  assert.equal(fingerprint(a), fingerprint({ ...a, doctor_name: 'แพทย์อื่น', patient_name: 'ชื่อใหม่' }), 'doctor/name edits do not resend');
  assert.notEqual(fingerprint(a), fingerprint({ ...a, appointment_time: '10:00:00' }));
  assert.notEqual(fingerprint(a), fingerprint({ ...a, clinic_code: '013' }));
});

test('report reads visits, sums procedure money once per visit, and groups by procedure and ICD-10', async () => {
  const appointments = [
    { oapp_id: '1', hn: '01', fname: 'ก', lname: 'ข', nextdate: '2026-09-01', clinic: '012', clinic_name: 'แผนไทย', oapp_status_id: null, visit_vn: '690901080000' },
    { oapp_id: '2', hn: '01', fname: 'ก', lname: 'ข', nextdate: '2026-09-01', clinic: '012', clinic_name: 'แผนไทย', oapp_status_id: null, visit_vn: '690901080000' },
    { oapp_id: '3', hn: '02', fname: 'ค', lname: '', nextdate: '2026-09-02', clinic: '', clinic_name: null, oapp_status_id: null, visit_vn: '' },
    { oapp_id: '4', hn: '03', fname: 'ง', lname: '', nextdate: '2026-09-02', clinic: '012', clinic_name: 'แผนไทย', oapp_status_id: '3', visit_vn: null },
  ];
  const reader: SourceReader = async (sql, values) => {
    assert.doesNotMatch(sql, /cid/i);
    if (/FROM oapp o/.test(sql)) return values[0] === '2026-09-01' ? appointments : [];
    assert.deepEqual(values, ['690901080000']);
    if (/opitemrece/.test(sql)) return [{ vn: '690901080000', icode: 'x', name: 'นวดไทย', qty: 1, amount: '200' },
      { vn: '690901080000', icode: 'y', name: 'ประคบ', qty: 2, amount: '100.5' }];
    return [{ vn: '690901080000', code: 'm545', name: 'ปวดหลังส่วนล่าง' }, { vn: '690901080000', code: '9007712', name: 'ICD-9' }];
  };
  const r = await appointmentReport(new URLSearchParams({ from: '2026-09-01', to: '2026-09-03' }), reader);
  assert.equal(r.rows.length, 3, 'a cancelled appointment the patient never came to is left out');
  assert.deepEqual(r.summary, { appointments: 3, attended: 2, pending: 0, missed: 1, amount: 300.5 });
  assert.deepEqual(r.rows[0].icd10, [{ code: 'M545', name: 'ปวดหลังส่วนล่าง' }]);
  assert.equal(r.rows[0].amount, 300.5); assert.equal(r.rows[2].amount, null);
  assert.equal(JSON.stringify(r).includes('690901080000'), false, 'the VN stays on the server');
  assert.deepEqual(r.procedures.map(p => [p.name, p.visits, p.amount]), [['นวดไทย', 1, 200], ['ประคบ', 1, 100.5]]);
  assert.deepEqual(r.icd10, [{ code: 'M545', name: 'ปวดหลังส่วนล่าง', visits: 1, amount: 300.5 }]);
  assert.deepEqual(r.clinics.map(c => [c.name, c.amount]), [['แผนไทย', 300.5], ['ไม่ระบุคลินิก', 0]]);
  await assert.rejects(appointmentReport(new URLSearchParams({ from: '2026-09-01', to: '2026-10-15' }), reader), /31 วัน/);
  await assert.rejects(appointmentReport(new URLSearchParams({ from: '2026-09-01', to: '2026-09-02' }), async () => { throw Error('Unknown column'); }), /icd101/);
});

test('report Excel has one sheet per report table with the visit money', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const reader: SourceReader = async (sql, values) => {
    if (/FROM oapp o/.test(sql)) return values[0] === '2026-09-01' ? [{ oapp_id: '1', hn: '01', fname: 'ก', lname: 'ข', nextdate: '2026-09-01', clinic: '012', clinic_name: 'แผนไทย', oapp_status_id: null, visit_vn: '690901080000' }] : [];
    if (/opitemrece/.test(sql)) return [{ vn: '690901080000', icode: 'x', name: 'นวดไทย', qty: 1, amount: '250' }];
    return [{ vn: '690901080000', code: 'M545', name: 'ปวดหลังส่วนล่าง' }];
  };
  const file = await appointmentReportExcel(new URLSearchParams({ from: '2026-09-01', to: '2026-09-02' }), reader);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(file.buffer as unknown as ArrayBuffer);
  assert.deepEqual(book.worksheets.map(w => w.name), ['สรุปตามคลินิก', 'สรุปตามหัตถการ', 'สรุปตาม ICD-10', 'รายการ']);
  assert.deepEqual(book.getWorksheet('สรุปตามคลินิก')!.getRow(3).values, [, 'รวม', 1, 1, 0, 0, 250]);
  assert.equal(book.getWorksheet('รายการ')!.getRow(2).getCell(8).value, 250);
  assert.equal(book.getWorksheet('รายการ')!.getColumn(8).numFmt, '#,##0.00');
});
