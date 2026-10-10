import React from 'react';
import type { LineOption, UniversityOption } from '../../lib/lineOptions';
import { AUDIENCE_KINDS, rideDayLabel, studentsText, tripLabel, type AudienceDraft } from '../../lib/notifications';
import { addDays } from '../../lib/time';
import { FieldRow, RadioCards, SelectField } from '../../ui';

interface Props {
  value: AudienceDraft;
  onChange: (next: AudienceDraft) => void;
  lines: LineOption[];
  universities: UniversityOption[];
  /** Today in Cairo, `YYYY-MM-DD`. */
  today: string;
  loading?: boolean;
  disabled?: boolean;
  /** How many students the company has, under «كل طلاب الشركة». */
  companyCount?: number | null;
  /** Show «اختر …» errors under the selects. */
  showErrors?: boolean;
}

const SUB: Record<AudienceDraft['kind'], string> = {
  company: '', line: 'خط واحد تختاره', trip: 'من أكّدوا رحلة اليوم أو غداً', university: 'جامعة واحدة تختارها',
};

/**
 * Who the notification is for: the whole company, one line, one trip of a line
 * today or tomorrow, or one university. Only the choice leaves this page; the
 * server works out the people.
 */
export const AudiencePicker: React.FC<Props> = ({ value, onChange, lines, universities, today, loading, disabled, companyCount, showErrors }) => {
  const set = (patch: Partial<AudienceDraft>) => onChange({ ...value, ...patch });
  const line = lines.find((item) => item.id === value.lineId);
  const trips = (line?.line_trips ?? []).filter((trip) => trip.is_active)
    .sort((a, b) => a.direction.localeCompare(b.direction) || a.start_time.localeCompare(b.start_time));
  const days = [today, addDays(today, 1)];
  if (value.kind === 'trip' && value.rideDate && !days.includes(value.rideDate)) days.push(value.rideDate);
  const placeholder = loading ? 'جاري التحميل…' : 'اختر';
  // Something chosen earlier that is no longer in the list (a stopped line) stays visible instead of silently changing.
  const keep = (id: string, known: boolean) => (id && !known ? [{ value: id, label: 'غير متاح حالياً' }] : []);

  return (
    <div className="flex flex-col gap-4">
      <RadioCards<AudienceDraft['kind']> label="يصل إلى" cols={2} value={value.kind} onChange={(kind) => { if (!disabled) set({ kind }); }}
        options={AUDIENCE_KINDS.map((k) => ({ value: k.key, label: k.label, sub: k.key === 'company' ? (companyCount != null ? studentsText(companyCount) : 'كل من اشترك') : SUB[k.key], disabled }))} />
      {(value.kind === 'line' || value.kind === 'trip') && (
        <FieldRow cols={value.kind === 'trip' ? 'repeat(3, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))'}>
          <SelectField label="الخط" value={value.lineId} disabled={disabled} placeholder={placeholder}
            error={showErrors && !value.lineId ? 'اختر الخط.' : undefined}
            options={[...keep(value.lineId, !!line), ...lines.map((l) => ({ value: l.id, label: l.name }))]}
            onChange={(e) => set({ lineId: e.target.value, tripId: '' })} />
          {value.kind === 'trip' ? (
            <>
              <SelectField label="الرحلة" value={value.tripId} disabled={disabled || !value.lineId}
                placeholder={!value.lineId ? 'اختر الخط أولاً' : trips.length ? 'اختر' : 'لا توجد رحلات مفعّلة'}
                error={showErrors && value.lineId && !value.tripId ? 'اختر الرحلة.' : undefined}
                options={[...keep(value.tripId, trips.some((t) => t.id === value.tripId)), ...trips.map((t) => ({ value: t.id, label: tripLabel(t) }))]}
                onChange={(e) => set({ tripId: e.target.value })} />
              <SelectField label="يوم الرحلة" value={value.rideDate} disabled={disabled}
                options={days.map((d) => ({ value: d, label: rideDayLabel(d, today) }))} onChange={(e) => set({ rideDate: e.target.value })} />
            </>
          ) : <span />}
        </FieldRow>
      )}
      {value.kind === 'university' && (
        <FieldRow cols="repeat(2, minmax(0, 1fr))">
          <SelectField label="الجامعة" value={value.universityId} disabled={disabled} placeholder={placeholder}
            error={showErrors && !value.universityId ? 'اختر الجامعة.' : undefined}
            options={[...keep(value.universityId, universities.some((u) => u.id === value.universityId)), ...universities.map((u) => ({ value: u.id, label: u.name }))]}
            onChange={(e) => set({ universityId: e.target.value })} />
          <span />
        </FieldRow>
      )}
    </div>
  );
};
