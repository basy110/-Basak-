import React, { useState } from 'react';
import { Badge, Button, Icon, IconButton, Note, SelectField, TextField } from '../../ui';
import { addMinutes, countOf, emptyTrip, fillStopTimes, tripProblems, tripsOf, uncoveredUniversities, W, type LineDraft, type TripDraft } from '../../lib/lines';
import { clockLabel } from '../../lib/time';
import { TimeField } from './fields';
import { LineMenu } from './LineActions';

type Patch = (fn: (d: LineDraft) => LineDraft) => void;

const problemsBadge = (n: number) => (n === 1 ? 'مشكلة واحدة' : n === 2 ? 'مشكلتان' : `${n} ${n <= 10 ? 'مشاكل' : 'مشكلة'}`);

/**
 * Step 3: departure trips (each one a start time, minutes between stations and
 * a time at each station) and the times the bus leaves the university.
 */
export const TripsStep: React.FC<{
  d: LineDraft; patch: Patch; uniName: (id: string) => string; onRemove: (t: TripDraft) => void; show: boolean;
  open: string | null; setOpen: (k: string | null) => void;
}> = ({ d, patch, uniName, onRemove, show, open, setOpen }) => {
  const [tab, setTab] = useState<'d' | 'r'>('d');
  const [gaps, setGaps] = useState<Record<string, string>>({});
  const [lastGap, setLastGap] = useState('5');
  const going = tripsOf(d, 'departure');
  const back = tripsOf(d, 'return');
  const uniOptions = [{ value: '', label: 'كل جامعات الخط' }, ...d.university_ids.map((id) => ({ value: id, label: uniName(id) }))];
  const setTrip = (key: string, p: Partial<TripDraft>) => patch((c) => ({ ...c, trips: c.trips.map((t) => (t.key === key ? { ...t, ...p } : t)) }));
  const add = (direction: 'departure' | 'return') => {
    const list = direction === 'departure' ? going : back;
    const last = list[list.length - 1]?.start_time;
    const t = emptyTrip(direction, last ? addMinutes(last, direction === 'departure' ? 30 : 60) : '');
    if (direction === 'departure' && t.start_time) t.times = fillStopTimes(t.start_time, Number(lastGap), d.stations);
    patch((c) => ({ ...c, trips: [...c.trips, t] }));
    if (direction === 'departure') setOpen(t.key);
  };
  const copy = (t: TripDraft) => {
    const shift = (x: string) => (x ? addMinutes(x, 30) : '');
    const c: TripDraft = { ...emptyTrip(t.direction), start_time: shift(t.start_time), arrival_time: shift(t.arrival_time), university_id: t.university_id,
      times: Object.fromEntries(Object.entries(t.times).map(([k, v]) => [k, shift(v)])) };
    patch((cur) => ({ ...cur, trips: [...cur.trips, c] }));
    if (t.direction === 'departure') setOpen(c.key);
  };
  const uncovered = going.length ? uncoveredUniversities(d) : [];

  const departures = (
    <section className={`flex flex-col gap-3 ${tab === 'r' ? 'max-sm:hidden' : ''}`}>
      <div>
        <h3 className="m-0 flex items-baseline gap-2 text-card">رحلات الذهاب <span className="text-label font-normal text-ink-2">{going.length ? countOf(going.length, W.trip) : ''}</span></h3>
        <p className="m-0 text-label text-ink-2">لكل رحلة موعد تحركها من أول محطة، ومنه نحسب موعد كل محطة. الطالب يختار رحلة ويرى موعد محطته.</p>
      </div>
      {going.map((t, i) => (
        <TripCard key={t.key} t={t} first={i === 0} d={d} open={open === t.key} onToggle={() => setOpen(open === t.key ? null : t.key)}
          gap={gaps[t.key] ?? lastGap} setGap={(g) => { setGaps((x) => ({ ...x, [t.key]: g })); if (g) setLastGap(g); }}
          set={(p) => setTrip(t.key, p)} uniOptions={uniOptions} uniName={uniName} onCopy={() => copy(t)} onRemove={() => onRemove(t)} show={show} />
      ))}
      {show && going.length === 0 && <Note tone="danger" title="أضف رحلة ذهاب واحدة على الأقل." />}
      <div className="flex"><Button kind="outline" icon="plus" onClick={() => add('departure')} className="max-sm:w-full">أضف رحلة ذهاب</Button></div>
      {uncovered.length > 0 && (
        <Note tone="warning" title={`لا رحلة ذهاب إلى ${uncovered.map(uniName).join('، ')}`}>طلابها لن يروا الخط. اجعل رحلة «لكل جامعات الخط» أو أضف رحلة لها.</Note>
      )}
    </section>
  );

  const returns = (
    <section className={`flex flex-col gap-3 ${tab === 'd' ? 'max-sm:hidden' : ''}`}>
      <div>
        <h3 className="m-0 flex items-baseline gap-2 text-card">العودة من الجامعة <span className="text-label font-normal text-ink-2">{back.length ? countOf(back.length, W.time) : ''}</span></h3>
        <p className="m-0 text-label text-ink-2">للعودة موعد واحد: متى يتحرك الباص من الجامعة. لا مواعيد للمحطات، فالباص يعيد كل طالب إلى محطته.</p>
      </div>
      {back.map((t) => <ReturnRow key={t.key} t={t} set={(p) => setTrip(t.key, p)} uniOptions={uniOptions} onCopy={() => copy(t)} onRemove={() => onRemove(t)} show={show} />)}
      <div className="flex"><Button kind="outline" icon="plus" onClick={() => add('return')} className="max-sm:w-full">أضف موعد عودة</Button></div>
    </section>
  );

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="اتجاه الرحلات" className="grid grid-cols-2 gap-1 rounded-inner bg-sunken p-1 sm:hidden">
        {([['d', 'الذهاب', going.length], ['r', 'العودة', back.length]] as const).map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`flex h-11 items-center justify-center gap-2 rounded-control text-small ${tab === k ? 'bg-surface font-semibold text-ink shadow-card' : 'text-ink-2'}`}>
            {label}<span className="text-cap text-ink-3 tabular">{n}</span>
          </button>
        ))}
      </div>
      {departures}
      <hr className="m-0 hidden border-0 border-t border-hair sm:block" />
      {returns}
    </div>
  );
};

const TripCard: React.FC<{
  t: TripDraft; first: boolean; d: LineDraft; open: boolean; onToggle: () => void; gap: string; setGap: (g: string) => void;
  set: (p: Partial<TripDraft>) => void; uniOptions: { value: string; label: string }[]; uniName: (id: string) => string;
  onCopy: () => void; onRemove: () => void; show: boolean;
}> = ({ t, first, d, open, onToggle, gap, setGap, set, uniOptions, uniName, onCopy, onRemove, show }) => {
  const problems = tripProblems(t, d.stations);
  const stops = d.stations.filter((s) => t.times[s.key]).length;
  const uni = t.university_id ? uniName(t.university_id) : 'كل جامعات الخط';
  const visible = problems.filter((p) => show || p.field !== 'start');
  const calc = () => {
    if (!t.start_time) return;
    const skipped = new Set(d.stations.filter((s) => !t.times[s.key] && Object.keys(t.times).length > 0).map((s) => s.key));
    const times = fillStopTimes(t.start_time, Number(gap), d.stations, skipped);
    const last = d.stations.map((s) => times[s.key]).filter(Boolean).pop();
    set({ times, arrival_time: t.arrival_time && last && t.arrival_time >= last ? t.arrival_time : last ? addMinutes(last, Math.max(5, Number(gap) || 0)) : t.arrival_time });
  };
  if (!open) {
    return (
      <button type="button" onClick={onToggle} aria-expanded={false}
        className="flex min-h-14 w-full items-center gap-3 rounded-inner bg-surface px-4 py-2.5 text-start shadow-ring hover:bg-ground">
        <span className="whitespace-nowrap text-card font-semibold tabular">{t.start_time ? clockLabel(t.start_time) : 'بلا موعد'}</span>
        <span className="min-w-0 flex-1 truncate text-label text-ink-2">
          <span className="max-sm:hidden">{t.arrival_time ? `تصل ${clockLabel(t.arrival_time)} · ` : ''}</span>
          {countOf(stops, W.station, 'محطة واحدة')} · {uni}<span className="max-sm:hidden">{t.label.trim() ? ` · ${t.label.trim()}` : ''}</span>
        </span>
        {problems.length > 0 && <Badge tone="danger">{problemsBadge(problems.length)}</Badge>}
        <Icon name="down" size={18} className="text-ink-2" />
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-4 rounded-inner bg-surface p-4 shadow-[inset_0_0_0_2px_#00658D]">
      <button type="button" onClick={onToggle} aria-expanded className="flex items-center gap-3 text-start">
        <span className="text-card font-semibold">رحلة {t.start_time ? clockLabel(t.start_time) : 'جديدة'}</span>
        {problems.length > 0 && <Badge tone="danger">{problemsBadge(problems.length)}</Badge>}
        <span className="flex-1" />
        <Icon name="up" size={18} className="text-ink-2" />
      </button>
      <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2">
        <TimeField label="تتحرك من أول محطة" value={t.start_time} assume="am" error={show && problems.find((p) => p.field === 'start')?.message}
          onChange={(v) => set(Object.keys(t.times).length === 0 && v ? { start_time: v, times: fillStopTimes(v, Number(gap), d.stations) } : { start_time: v })} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`gap-${t.key}`} className="text-label font-medium">الدقائق بين كل محطة والتالية</label>
          <div className="flex gap-2">
            <div className="flex h-12 w-[72px] flex-none items-center rounded-control bg-surface px-3 shadow-field focus-within:!shadow-field-focus sm:h-11">
              <input id={`gap-${t.key}`} inputMode="numeric" dir="ltr" value={gap} onChange={(e) => setGap(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
                className="h-full w-full bg-transparent text-small tabular outline-none [unicode-bidi:plaintext]" style={{ textAlign: 'right' }} />
            </div>
            <Button kind="tonal" icon="wand" onClick={calc} disabled={!t.start_time} className="flex-1">احسب المواعيد</Button>
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        <div className="text-label font-semibold">موعد المرور على كل محطة</div>
        <p className="m-0 text-label text-ink-2">محسوبة من موعد التحرك، وتستطيع تعديل أي موعد. اضغط × إن كانت الرحلة لا تقف في محطة.</p>
        <ol className="m-0 mt-2 flex list-none flex-col p-0">
          {d.stations.map((s, i) => {
            const time = t.times[s.key];
            const err = visible.find((p) => p.stationKey === s.key);
            return (
              <li key={s.key} className="flex flex-col gap-1 border-b border-hair py-2 last:border-b-0">
                <div className="flex min-h-11 items-center gap-3">
                  <span aria-hidden="true" className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-sunken text-cap font-medium text-ink-2 tabular">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-small">{s.name.trim() || `المحطة ${i + 1}`}</span>
                  {time ? (
                    <>
                      <TimeField sm value={time} ariaLabel={`موعد «${s.name || `المحطة ${i + 1}`}»`} assume={Number(t.start_time.slice(0, 2)) >= 12 ? 'pm' : 'am'} error={!!err} placeholder="" className="w-[118px] flex-none"
                        onChange={(v) => set({ times: { ...t.times, [s.key]: v } })} />
                      <IconButton icon="x" sm label={`الرحلة لا تقف في «${s.name || `المحطة ${i + 1}`}»`} onClick={() => { const x = { ...t.times }; delete x[s.key]; set({ times: x }); }} />
                    </>
                  ) : (
                    <>
                      <span className="text-label text-ink-3">لا تقف هنا</span>
                      <Button kind="link" sm onClick={() => {
                        const prev = d.stations.slice(0, i).map((x) => t.times[x.key]).filter(Boolean).pop();
                        set({ times: { ...t.times, [s.key]: prev ? addMinutes(prev, Number(gap) || 0) : t.start_time || '' } });
                      }}>تقف هنا</Button>
                    </>
                  )}
                </div>
                {err && <div role="alert" className="flex items-start gap-1.5 ps-[34px] text-label text-bad"><Icon name="alert" size={14} stroke={2} className="mt-[3px]" /><span>{err.message}</span></div>}
              </li>
            );
          })}
        </ol>
        {visible.filter((p) => p.field === 'stops').map((p) => <div key="stops" role="alert" className="mt-1 text-label text-bad">{p.message}</div>)}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TimeField label="تصل الجامعة" optional value={t.arrival_time} assume="am" onChange={(v) => set({ arrival_time: v })}
          error={problems.find((p) => p.field === 'arrival')?.message} />
        <SelectField label="لطلاب" value={t.university_id} options={uniOptions} onChange={(e) => set({ university_id: e.target.value })} />
      </div>
      <TextField label="اسم الرحلة" optional value={t.label} maxLength={40} placeholder="مثال: أول رحلة" onChange={(e) => set({ label: e.target.value })} />
      <div className="flex items-center gap-3 border-t border-hair pt-3">
        <Button kind="outline" sm icon="copy" onClick={onCopy}>انسخ الرحلة</Button>
        <span className="flex-1" />
        <Button kind="link" sm icon="trash" className="!text-bad" onClick={onRemove}>احذف الرحلة</Button>
      </div>
    </div>
  );
};

const ReturnRow: React.FC<{
  t: TripDraft; set: (p: Partial<TripDraft>) => void; uniOptions: { value: string; label: string }[]; onCopy: () => void; onRemove: () => void; show: boolean;
}> = ({ t, set, uniOptions, onCopy, onRemove, show }) => {
  const [named, setNamed] = useState(!!t.label);
  const phone = typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 639px)').matches;
  const err = show && !t.start_time ? 'اكتب موعد تحرك الباص من الجامعة.' : undefined;
  return (
    <div className="flex flex-col gap-2 rounded-inner p-2 shadow-ring sm:p-0 sm:shadow-none">
      <div className="flex items-start gap-2">
        <TimeField value={t.start_time} assume="pm" ariaLabel="موعد تحرك الباص من الجامعة" placeholder="مثال: 2:00 م" error={err} className="w-[118px] flex-none" onChange={(v) => set({ start_time: v })} />
        <div className="min-w-0 flex-1 sm:w-[184px] sm:flex-none">
          <SelectField aria-label="من أي جامعة" value={t.university_id} onChange={(e) => set({ university_id: e.target.value })}
            options={uniOptions.map((o) => ({ ...o, label: phone ? o.label : o.value ? `من ${o.label}` : 'من كل جامعات الخط' }))} />
        </div>
        <div className="hidden min-w-0 flex-1 sm:block">
          <TextField aria-label="اسم الموعد" value={t.label} maxLength={40} placeholder="اسم (اختياري)" onChange={(e) => set({ label: e.target.value })} />
        </div>
        <LineMenu label="إجراءات الموعد" sm={false} items={[
          ...(phone ? [{ label: 'سمِّ الموعد', icon: 'pencil' as const, onClick: () => setNamed(true) }] : []),
          { label: 'انسخ الموعد', icon: 'copy', onClick: onCopy },
          { label: 'احذف الموعد', icon: 'trash', danger: true, sep: true, onClick: onRemove },
        ]} />
      </div>
      {named && <div className="sm:hidden"><TextField aria-label="اسم الموعد" value={t.label} maxLength={40} placeholder="اسم (اختياري)" onChange={(e) => set({ label: e.target.value })} /></div>}
    </div>
  );
};

