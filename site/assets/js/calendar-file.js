// Arquivo .ics (Apple, Outlook, Google) e link do Google Agenda para um atendimento.
const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);

export function icsText(ev) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Studio Ludy Brito//Agendamento//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(ev.start)}`,
    `DTEND:${stamp(ev.end)}`,
    `SUMMARY:${esc(ev.title)}`,
    `LOCATION:${esc(ev.location)}`,
    `DESCRIPTION:${esc(ev.description)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(ev.title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

export function downloadIcs(ev, filename) {
  const blob = new Blob([icsText(ev)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function googleCalendarUrl(ev) {
  const p = new URLSearchParams({
    action: 'TEMPLATE', text: ev.title, dates: `${stamp(ev.start)}/${stamp(ev.end)}`,
    details: ev.description, location: ev.location, ctz: 'America/Sao_Paulo',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
