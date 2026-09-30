import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAppointments, readForNotice, readClinics, toAppointment, NO_CLINIC, type SourceReader } from '../src/server/hosxp';
import { activeStatus, fingerprint, futureAppointment } from '../src/server/sync';

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
