import React, { useState } from 'react';
import { Card, Icon } from '../../ui';
import { clockLabel } from '../../lib/time';
import type { LineRow } from '../../lib/reference';
import type { LineStats } from '../../lib/linesData';

type Trip = LineRow['line_trips'][number];
type Station = LineRow['stations'][number];

/** «7:30 ص» with the ص/م a little quieter. */
export const Clock: React.FC<{ t: string | null | undefined; className?: string }> = ({ t, className = '' }) => {
  const text = clockLabel(t);
  if (!text) return <span className={`text-ink-3 ${className}`}>—</span>;
  const [hm, ap] = text.split(' ');
  return <span className={`whitespace-nowrap tabular ${className}`}>{hm} <span className="font-normal">{ap}</span></span>;
};

/** «22 من 50» and its meter; red-amber when the bus is over full; a bare number when the seats are not set. */
export const RidersMeter: React.FC<{ riders: number | null | undefined; seats: number | null; w?: string; align?: 'start' | 'end' }> = ({ riders, seats, w = 'w-full', align = 'start' }) => {
  if (riders == null) return <span className="text-label text-ink-3">—</span>;
  const over = seats ? riders > seats : false;
  return (
    <div className={`flex flex-col gap-1.5 ${w} ${align === 'end' ? 'items-end' : 'items-start'}`}>
      <span className="whitespace-nowrap text-label text-ink-2"><b className={`text-small font-semibold tabular ${over ? 'text-warn' : 'text-ink'}`}>{riders}</b>{seats ? ` من ${seats}` : ` ${riders === 1 ? 'راكب' : 'راكباً'}`}</span>
      {seats ? (
        <span aria-hidden="true" className="block h-1 w-full overflow-hidden rounded bg-sunken">
          <span className={`block h-1 rounded ${over ? 'bg-warn' : 'bg-teal'}`} style={{ width: `${Math.min(100, Math.round((riders / seats) * 100))}%` }} />
        </span>
      ) : null}
    </div>
  );
};

export const tripSub = (t: Trip, uniName: (id: string) => string, both = false) => {
  const uni = t.university_id ? `${uniName(t.university_id)} فقط` : 'كل جامعات الخط';
  if (both) return [t.label, t.university_id ? uniName(t.university_id) : 'كل جامعات الخط'].filter(Boolean).join(' · ');
  return t.label || uni;
};

const Num: React.FC<{ n: number }> = ({ n }) => (
  <span aria-hidden="true" className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-sunken text-cap font-medium text-ink-2 tabular">{n}</span>
);

/** Column widths of the departure table: the stations, and each trip between the least it needs and the most it gets. */
const STATION_W = 240;
const TRIP_MIN = 168;
const TRIP_MAX = 240;
/** The timetable's natural width: what it takes when nothing squeezes it. */
export const departureWidth = (trips: number) => STATION_W + trips * TRIP_MAX;

/**
 * Desktop and tablet: stations down, departure trips across, tomorrow's riders on top, the arrival at the bottom.
 * The card is only as wide as its trips need (a trip gets at most TRIP_MAX), so one trip makes a narrow card
 * instead of an empty band; many trips share the width and scroll sideways once each is down to TRIP_MIN.
 */
export const DepartureTable: React.FC<{ stations: Station[]; trips: Trip[]; stats: LineStats; uniName: (id: string) => string }> = ({ stations, trips, stats, uniName }) => {
  const seats = stats.bus_capacity;
  const stop = (t: Trip, s: Station) => t.line_trip_stops.find((x) => x.station_id === s.id)?.stop_time;
  return (
    <div className="max-w-full" style={{ width: `min(100%, ${STATION_W + trips.length * TRIP_MAX}px)` }}>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-fixed border-collapse text-small" style={{ width: `max(100%, ${STATION_W + trips.length * TRIP_MIN}px)` }}>
            <caption className="sr-only">مواعيد رحلات الذهاب على كل محطة</caption>
            <colgroup><col style={{ width: STATION_W }} />{trips.map((t) => <col key={t.id} />)}</colgroup>
            <thead>
              <tr className="border-b border-hair">
                <th scope="col" className="px-5 pb-3 pt-4 text-start align-bottom text-label font-medium text-ink-2">المحطة بترتيب المسار</th>
                {trips.map((t) => (
                  <th key={t.id} scope="col" className="border-s border-hair px-4 pb-3 pt-4 text-start align-bottom font-normal">
                    <Clock t={t.start_time} className="block text-section font-semibold" />
                    <span className="block truncate text-cap text-ink-2">{tripSub(t, uniName)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-hair">
                <th scope="row" className="px-5 py-3 text-start font-normal">
                  <span className="block font-semibold">ركاب الغد</span>
                  <span className="block text-cap text-ink-2">{seats ? `من مقاعد الباص (${seats})` : 'لم تُحدد مقاعد الباص'}</span>
                </th>
                {trips.map((t) => <td key={t.id} className="border-s border-hair px-3 py-3"><RidersMeter riders={stats.riders_departure == null ? null : stats.trip_riders[t.id] ?? 0} seats={seats} w="w-[140px]" /></td>)}
              </tr>
              {stations.map((s, i) => (
                <tr key={s.id} className="h-11 border-b border-hair">
                  <th scope="row" className="px-5 text-start font-normal"><span className="flex items-center gap-3"><Num n={i + 1} /><span className="min-w-0 truncate" title={s.name}>{s.name}</span></span></th>
                  {trips.map((t) => {
                    const time = stop(t, s);
                    return <td key={t.id} className="border-s border-hair px-4">{time ? <Clock t={time} /> : <span className="text-label text-ink-3">لا تقف</span>}</td>;
                  })}
                </tr>
              ))}
              <tr className="h-11 bg-ground">
                <th scope="row" className="px-5 text-start"><span className="flex items-center gap-3 font-semibold"><Icon name="school" size={18} className="text-teal" />الوصول إلى الجامعة</span></th>
                {trips.map((t) => <td key={t.id} className="border-s border-hair px-4 font-semibold"><Clock t={t.arrival_time} /></td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

/** The way back: one row per time the bus leaves the university, with tomorrow's riders. */
export const ReturnList: React.FC<{ trips: Trip[]; stats: LineStats; uniName: (id: string) => string; phone?: boolean }> = ({ trips, stats, uniName, phone }) => (
  <Card className="overflow-hidden">
    {trips.length === 0 && <p className="m-0 px-5 py-6 text-small text-ink-2">لا مواعيد عودة بعد.</p>}
    {trips.map((t, i) => (
      <div key={t.id} className={`flex items-center gap-4 px-4 py-3.5 sm:px-5 ${i ? 'border-t border-hair' : ''}`}>
        <div className={`flex min-w-0 flex-1 ${phone ? 'flex-col' : 'items-center gap-6'}`}>
          <Clock t={t.start_time} className="w-[88px] flex-none text-card font-semibold" />
          <span className="min-w-0 truncate text-small text-ink-2">{t.university_id ? `من ${uniName(t.university_id)}` : 'من كل جامعات الخط'}{t.label ? ` · ${t.label}` : ''}</span>
        </div>
        <RidersMeter riders={stats.riders_return == null ? null : stats.trip_riders[t.id] ?? 0} seats={stats.bus_capacity} w="w-[120px]" />
      </div>
    ))}
  </Card>
);

/** Phone: «الذهاب / العودة», one card per trip; a departure opens to its stations. */
export const PhoneTrips: React.FC<{ stations: Station[]; going: Trip[]; back: Trip[]; stats: LineStats; uniName: (id: string) => string }> = ({ stations, going, back, stats, uniName }) => {
  const [tab, setTab] = useState<'d' | 'r'>('d');
  // Opened on the busiest trip of tomorrow (the first one when nothing is known).
  const [open, setOpen] = useState<string | null>(() =>
    [...going].sort((a, b) => (stats.trip_riders[b.id] ?? 0) - (stats.trip_riders[a.id] ?? 0))[0]?.id ?? null);
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="اتجاه الرحلات" className="grid grid-cols-2 gap-1 rounded-inner bg-sunken p-1">
        {([['d', 'الذهاب', going.length], ['r', 'العودة', back.length]] as const).map(([k, label, count]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`flex h-11 items-center justify-center gap-2 rounded-control text-small ${tab === k ? 'bg-surface font-semibold text-ink shadow-card' : 'text-ink-2'}`}>
            {label}<span className="text-cap text-ink-3 tabular">{count}</span>
          </button>
        ))}
      </div>
      {tab === 'r' ? <ReturnList trips={back} stats={stats} uniName={uniName} phone /> : going.map((t) => {
        const on = open === t.id;
        return (
          <Card key={t.id} className="overflow-hidden">
            <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : t.id)} className="flex w-full items-center gap-3 px-4 py-3 text-start">
              <span className="flex min-w-0 flex-1 flex-col"><Clock t={t.start_time} className="text-section font-semibold" /><span className="truncate text-cap text-ink-2">{tripSub(t, uniName, true)}</span></span>
              <RidersMeter riders={stats.riders_departure == null ? null : stats.trip_riders[t.id] ?? 0} seats={stats.bus_capacity} w="w-[84px]" />
              <Icon name={on ? 'up' : 'down'} size={18} className="text-ink-2" />
            </button>
            {on && (
              <div className="border-t border-hair px-4 pb-2">
                {stations.map((s, i) => {
                  const time = t.line_trip_stops.find((x) => x.station_id === s.id)?.stop_time;
                  return (
                    <div key={s.id} className="flex h-10 items-center gap-3 border-b border-hair text-small">
                      <Num n={i + 1} /><span className="min-w-0 flex-1 truncate">{s.name}</span>
                      {time ? <Clock t={time} className="font-semibold" /> : <span className="text-label text-ink-3">لا تقف</span>}
                    </div>
                  );
                })}
                <div className="flex h-10 items-center gap-3 text-small font-semibold"><Icon name="school" size={18} className="text-teal" /><span className="flex-1">الوصول إلى الجامعة</span><Clock t={t.arrival_time} /></div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
};
