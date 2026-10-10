import { describe, expect, it } from 'vitest';
import { canAct, codeText, isOpenReset, issueRefusal, requestedText, resetState, type ResetRequest } from './passwordRequests';

// 10 October 2026, 09:12 in Cairo (UTC+3 in October).
const now = new Date('2026-10-10T06:12:00Z');
const req = (patch: Partial<ResetRequest>): ResetRequest => ({
  id: 'r', student_id: 's', student_name: 'عبد الرحمن محمد', student_phone: '01134567891', status: 'pending',
  requested_at: '2026-10-10T06:02:00Z', code_issued_at: null, code_expires_at: null, failed_attempts: 0, ...patch,
});

describe('a password request as the boards write it', () => {
  it('names each state for the company admin and for the platform admin', () => {
    expect(resetState(req({}), 'company', now)).toEqual({ tone: 'warning', text: 'ينتظر رمزاً منك' });
    expect(resetState(req({}), 'platform', now)).toEqual({ tone: 'warning', text: 'ينتظر التحقق' });
    const issued = req({ status: 'code_issued', code_expires_at: '2026-10-10T06:21:00Z' });
    expect(resetState(issued, 'company', now)).toEqual({ tone: 'teal', text: 'معه رمز · صالح حتى 9:21 ص' });
    expect(resetState(issued, 'platform', now)).toEqual({ tone: 'teal', text: 'رمز صالح حتى 9:21 ص' });
    expect(resetState(req({ status: 'completed' }), 'company', now).text).toBe('غيّر كلمة المرور');
    expect(resetState(req({ status: 'cancelled' }), 'company', now).text).toBe('أُلغي');
    expect(resetState(req({ status: 'expired' }), 'company', now).text).toBe('انتهى الرمز ولم يُستعمل');
    expect(resetState(req({ status: 'expired' }), 'platform', now).text).toBe('انتهت صلاحية الرمز');
  });
  it('treats a code whose time ran out as expired, and not open to act on', () => {
    const late = req({ status: 'code_issued', code_expires_at: '2026-10-10T06:00:00Z' });
    expect(resetState(late, 'company', now).text).toBe('انتهى الرمز ولم يُستعمل');
    expect(canAct(late, now)).toBe(false);
    expect(canAct(req({}), now)).toBe(true);
    expect(isOpenReset({ status: 'code_issued' })).toBe(true);
    expect(isOpenReset({ status: 'completed' })).toBe(false);
  });
  it('writes when help was asked for in Cairo time', () => {
    expect(requestedText('2026-10-10T06:02:00Z', now)).toBe('اليوم 9:02 ص');
    expect(requestedText('2026-10-09T15:15:00Z', now)).toBe('أمس · 6:15 م');
    expect(requestedText('2026-10-08T07:05:00Z', now)).toBe('8 أكتوبر · 10:05 ص');
    expect(requestedText('2026-10-06T04:05:00Z', now, ' ')).toBe('6 أكتوبر 7:05 ص');
  });
  it('groups the code in threes', () => {
    expect(codeText('482916')).toBe('482 916');
  });
  it('says why no code was issued', () => {
    expect(issueRefusal(req({ status: 'completed' }), 'عبد الرحمن')).toBe('لم يُصدر رمز: غيّر عبد الرحمن كلمة المرور قبل لحظات برمز سابق.');
    expect(issueRefusal(undefined, 'x')).toBe('تعذّر إصدار الرمز. لم يتغيّر شيء في حساب الطالب.');
  });
});
