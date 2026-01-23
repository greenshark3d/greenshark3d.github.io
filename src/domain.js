export function parseLocalDT(s){
  const [d,t] = s.split("T");
  const [Y,M,D] = d.split("-").map(Number);
  const [h,m] = t.split(":").map(Number);
  return new Date(Y, M-1, D, h, m, 0, 0);
}

export function fmtTime(dt){
  const h = String(dt.getHours()).padStart(2,"0");
  const m = String(dt.getMinutes()).padStart(2,"0");
  return `${h}:${m}`;
}

export function haversineKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const toRad = x => x*Math.PI/180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

export function minutesOfDay(hhmm){
  const [h,m]=hhmm.split(":").map(Number);
  return h*60+m;
}

export function placeStatusNow(openingHours, now=new Date()){
  if(!openingHours) return { open:false, label:"Hours not set" };
  const dow = ["sun","mon","tue","wed","thu","fri","sat"][now.getDay()];
  const todays = openingHours[dow] || [];
  const nowMin = now.getHours()*60 + now.getMinutes();

  for(const it of todays){
    const s = minutesOfDay(it.start);
    const e = minutesOfDay(it.end);
    if(e >= s){
      if(nowMin >= s && nowMin < e){
        const close = new Date(now);
        close.setHours(Math.floor(e/60), e%60, 0, 0);
        return { open:true, closesAt: close, label:`Open now · Closes ${it.end}` };
      }
    }else{
      if(nowMin >= s || nowMin < e){
        const close = new Date(now);
        if(nowMin < e){
          close.setHours(Math.floor(e/60), e%60, 0, 0);
        }else{
          close.setDate(close.getDate()+1);
          close.setHours(Math.floor(e/60), e%60, 0, 0);
        }
        return { open:true, closesAt: close, label:`Open now · Closes ${it.end}` };
      }
    }
  }
  return { open:false, label:"Closed" };
}

export function nextOpenWithin(openingHours, hoursWindow=8, now=new Date()){
  if(!openingHours) return null;
  const limit = new Date(now.getTime() + hoursWindow*3600*1000);
  const dows = ["sun","mon","tue","wed","thu","fri","sat"];

  for(let dayOffset=0; dayOffset<=1; dayOffset++){
    const d = new Date(now);
    d.setDate(d.getDate()+dayOffset);
    const dow = dows[d.getDay()];
    const list = openingHours[dow] || [];
    for(const it of list){
      const startMin = minutesOfDay(it.start);
      const candidate = new Date(d);
      candidate.setHours(Math.floor(startMin/60), startMin%60, 0, 0);
      if(dayOffset===0 && candidate <= now) continue;
      if(candidate <= limit) return candidate;
    }
  }
  return null;
}

export function generateOccurrences(event, windowStart, windowEnd){
  const baseStart = parseLocalDT(event.startLocal);
  const baseEnd = event.endLocal ? parseLocalDT(event.endLocal) : null;
  const durMs = baseEnd ? (baseEnd - baseStart) : 0;

  function pushOcc(dtStart, out){
    const dtEnd = baseEnd ? new Date(dtStart.getTime()+durMs) : null;
    if(dtStart < windowEnd && dtStart >= windowStart){
      out.push({ start: dtStart, end: dtEnd });
    }
  }

  const out = [];
  const rec = event.recurrence || "none";
  if(rec === "none"){
    pushOcc(baseStart, out);
    return out;
  }

  let cur = new Date(baseStart);
  let safety = 0;

  if(rec === "weekly"){
    const step = 7*24*3600*1000;
    if(cur < windowStart){
      const diff = windowStart - cur;
      const k = Math.floor(diff / step);
      cur = new Date(cur.getTime() + k*step);
      while(cur < windowStart) cur = new Date(cur.getTime()+step);
    }
    while(cur < windowEnd && safety++ < 1000){
      pushOcc(cur, out);
      cur = new Date(cur.getTime()+step);
    }
    return out;
  }

  if(rec === "monthly"){
    const day = baseStart.getDate();
    const hour = baseStart.getHours(), minute = baseStart.getMinutes();
    let y = windowStart.getFullYear();
    let m = windowStart.getMonth();
    const baseY=baseStart.getFullYear(), baseM=baseStart.getMonth();
    if(y < baseY || (y===baseY && m < baseM)){ y=baseY; m=baseM; }
    while(safety++ < 200){
      const lastDay = new Date(y, m+1, 0).getDate();
      const dd = Math.min(day, lastDay);
      const cand = new Date(y, m, dd, hour, minute, 0, 0);
      if(cand >= baseStart && cand >= windowStart && cand < windowEnd){
        pushOcc(cand, out);
      }
      m += 1;
      if(m>11){ m=0; y+=1; }
      if(new Date(y, m, 1) >= windowEnd) break;
    }
    return out;
  }

  if(rec === "yearly"){
    const month = baseStart.getMonth();
    const day = baseStart.getDate();
    const hour = baseStart.getHours(), minute = baseStart.getMinutes();
    let y = windowStart.getFullYear();
    const baseY=baseStart.getFullYear();
    if(y < baseY) y = baseY;

    while(safety++ < 200){
      let dd = day, mm = month;
      if(mm===1 && day===29){
        const isLeap = (y%4===0 && (y%100!==0 || y%400===0));
        dd = isLeap ? 29 : 28;
      }else{
        const lastDay = new Date(y, mm+1, 0).getDate();
        dd = Math.min(day, lastDay);
      }
      const cand = new Date(y, mm, dd, hour, minute, 0, 0);
      if(cand >= baseStart && cand >= windowStart && cand < windowEnd){
        pushOcc(cand, out);
      }
      y += 1;
      if(new Date(y, 0, 1) >= windowEnd) break;
    }
    return out;
  }

  return out;
}
