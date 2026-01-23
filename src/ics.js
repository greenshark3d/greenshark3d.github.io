function foldLine(s){
  const max = 70;
  if(s.length <= max) return s;
  let out = "";
  let i = 0;
  while(i < s.length){
    const chunk = s.slice(i, i+max);
    out += (i===0 ? chunk : "\r\n " + chunk);
    i += max;
  }
  return out;
}

export function toICSDate(dt){
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,"0");
  const d = String(dt.getDate()).padStart(2,"0");
  const hh = String(dt.getHours()).padStart(2,"0");
  const mm = String(dt.getMinutes()).padStart(2,"0");
  const ss = "00";
  return `${y}${m}${d}T${hh}${mm}${ss}`;
}

export function buildEventICS({uid, title, start, end, description, location, url, recurrence}){
  const lines = [];
  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${uid}`);
  lines.push(`DTSTAMP:${toICSDate(new Date())}`);
  lines.push(`SUMMARY:${title || ""}`);
  lines.push(`DTSTART:${toICSDate(start)}`);
  if(end) lines.push(`DTEND:${toICSDate(end)}`);
  if(location) lines.push(foldLine(`LOCATION:${location}`));
  if(description) lines.push(foldLine(`DESCRIPTION:${description}`));
  if(url) lines.push(foldLine(`URL:${url}`));
  if(recurrence && recurrence !== "none"){
    const freq = recurrence === "weekly" ? "WEEKLY" : recurrence === "monthly" ? "MONTHLY" : "YEARLY";
    lines.push(`RRULE:FREQ=${freq}`);
  }
  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

export function exportICSFile(filename, icsText){
  const blob = new Blob([icsText], {type:"text/calendar;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function parseICS(text){
  const lines = text.replace(/\r\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let cur = null;
  for(const line of lines){
    if(line === "BEGIN:VEVENT"){ cur = {}; continue; }
    if(line === "END:VEVENT"){ if(cur) events.push(cur); cur = null; continue; }
    if(!cur) continue;
    const [k, ...rest] = line.split(":");
    const v = rest.join(":");
    const key = k.split(";")[0].toUpperCase();
    if(key === "SUMMARY") cur.summary = v;
    if(key === "DTSTART") cur.dtstart = v;
    if(key === "DTEND") cur.dtend = v;
    if(key === "LOCATION") cur.location = v;
    if(key === "URL") cur.url = v;
    if(key === "DESCRIPTION") cur.description = v;
    if(key === "RRULE") cur.rrule = v;
  }
  return events;
}

export function icsToLocalDT(s){
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?/);
  if(!m) return null;
  const Y=+m[1], Mo=+m[2], D=+m[3], h=+m[4], mi=+m[5];
  return new Date(Y, Mo-1, D, h, mi, 0, 0);
}

export function mapRRule(rrule){
  if(!rrule) return "none";
  const up = rrule.toUpperCase();
  if(up.includes("FREQ=WEEKLY")) return "weekly";
  if(up.includes("FREQ=MONTHLY")) return "monthly";
  if(up.includes("FREQ=YEARLY")) return "yearly";
  return "none";
}
