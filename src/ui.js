import { t } from "./i18n.js";
import { fmtTime, placeStatusNow, nextOpenWithin, haversineKm, generateOccurrences } from "./domain.js";

export function toast(msg){
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(()=>{ el.hidden = true; }, 2600);
}

export function setActiveTab(tab){
  document.querySelectorAll(".tab").forEach(b=>{
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  const pages = ["soon","search","add","saved","settings","detail"];
  for(const p of pages){
    const el = document.getElementById(`page-${p}`);
    if(el) el.hidden = (p !== tab);
  }
  window.scrollTo({top:0, behavior:"instant"});
}

export function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, ch=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
}

export function renderSoon({lang, settings, events, places, categoriesById, location}){
  const el = document.getElementById("page-soon");
  const seg = document.createElement("div");
  seg.className = "segment";
  seg.innerHTML = `
    <button class="btn primary" id="soonBtnEvents">Events</button>
    <button class="btn" id="soonBtnPlaces">Places</button>
  `;
  const container = document.createElement("div");
  el.innerHTML = "";
  el.appendChild(seg);
  el.appendChild(container);

  const windowHours = Number(settings.soonEventsHours || 48);
  const now = new Date();
  const winEnd = new Date(now.getTime() + windowHours*3600*1000);

  function renderEvents(){
    document.getElementById("soonBtnEvents").classList.add("primary");
    document.getElementById("soonBtnPlaces").classList.remove("primary");

    const occItems = [];
    for(const ev of events){
      const occ = generateOccurrences(ev, now, winEnd);
      for(const o of occ){
        let lat = ev.lat, lon = ev.lon;
        let placeName = "";
        if(ev.placeId){
          const pl = places.find(p=>p.id===ev.placeId);
          if(pl){ lat = pl.lat; lon = pl.lon; placeName = pl.name; }
        }
        const dist = (location && lat!=null && lon!=null) ? haversineKm(location.lat, location.lon, lat, lon) : null;
        occItems.push({ ev, occ:o, dist, placeName });
      }
    }
    occItems.sort((a,b)=> a.occ.start - b.occ.start);

    const list = document.createElement("div");
    list.className = "list";
    if(!occItems.length){
      list.innerHTML = `<div class="card"><div class="small">No events in the next ${windowHours} hours.</div></div>`;
    }else{
      for(const it of occItems){
        const cat = categoriesById.get(it.ev.categoryId);
        const catName = cat ? (cat[`name_${lang}`] || cat.name_en) : "";
        const when = `${it.occ.start.toLocaleString()}${it.occ.end ? " – " + it.occ.end.toLocaleTimeString().slice(0,5) : ""}`;
        const distTxt = (it.dist!=null) ? ` · ${it.dist.toFixed(1)} km` : "";
        const star = it.ev.isFavorite ? "★" : "☆";
        const item = document.createElement("div");
        item.className = "item";
        item.innerHTML = `
          <div class="row">
            <div style="font-weight:700">${escapeHtml(it.ev.title)}</div>
            <div class="star ${it.ev.isFavorite?'on':''}" data-star="event" data-id="${it.ev.id}">${star}</div>
          </div>
          <div class="small">${escapeHtml(when)}${distTxt}</div>
          <div class="small">${escapeHtml(it.placeName || it.ev.city || "")} <span class="badge">${escapeHtml(catName)}</span></div>
        `;
        item.dataset.openDetail = "event";
        item.dataset.id = it.ev.id;
        list.appendChild(item);
      }
    }
    container.innerHTML = "";
    container.appendChild(list);
  }

  function renderPlaces(){
    document.getElementById("soonBtnPlaces").classList.add("primary");
    document.getElementById("soonBtnEvents").classList.remove("primary");
    const soonHours = Number(settings.soonPlacesHours || 8);
    const list = document.createElement("div");
    list.className = "list";
    const now = new Date();
    const rows = [];
    for(const pl of places){
      const st = placeStatusNow(pl.openingHours, now);
      let label = st.label;
      if(!st.open){
        const next = nextOpenWithin(pl.openingHours, soonHours, now);
        if(next) label = `Closed · Opens ${fmtTime(next)}`;
      }
      const dist = (location && pl.lat!=null && pl.lon!=null) ? haversineKm(location.lat, location.lon, pl.lat, pl.lon) : null;
      rows.push({ pl, st, label, dist });
    }
    rows.sort((a,b)=> (b.st.open - a.st.open) || ((a.dist??1e9) - (b.dist??1e9)));

    if(!rows.length){
      list.innerHTML = `<div class="card"><div class="small">No places yet. Add some places first.</div></div>`;
    }else{
      for(const it of rows){
        const cat = categoriesById.get(it.pl.categoryId);
        const catName = cat ? (cat[`name_${lang}`] || cat.name_en) : "";
        const distTxt = (it.dist!=null) ? ` · ${it.dist.toFixed(1)} km` : "";
        const star = it.pl.isFavorite ? "★" : "☆";
        const item = document.createElement("div");
        item.className = "item";
        item.innerHTML = `
          <div class="row">
            <div style="font-weight:700">${escapeHtml(it.pl.name)}</div>
            <div class="star ${it.pl.isFavorite?'on':''}" data-star="place" data-id="${it.pl.id}">${star}</div>
          </div>
          <div class="small">${escapeHtml(it.label)}${distTxt}</div>
          <div class="small">${escapeHtml(it.pl.city || "")}, ${escapeHtml(it.pl.countryCode || "")} <span class="badge">${escapeHtml(catName)}</span></div>
        `;
        item.dataset.openDetail = "place";
        item.dataset.id = it.pl.id;
        list.appendChild(item);
      }
    }
    container.innerHTML = "";
    container.appendChild(list);
  }

  el.onclick = (e)=>{
    const star = e.target.closest("[data-star]");
    if(star){
      e.preventDefault(); e.stopPropagation();
      const type = star.dataset.star;
      const id = star.dataset.id;
      window.dispatchEvent(new CustomEvent("toggleFavorite", { detail:{ type, id }}));
      return;
    }
    const item = e.target.closest(".item");
    if(item && item.dataset.openDetail){
      window.dispatchEvent(new CustomEvent("openDetail", { detail:{ type:item.dataset.openDetail, id:item.dataset.id }}));
    }
  };

  renderEvents();
  document.getElementById("soonBtnEvents").onclick = renderEvents;
  document.getElementById("soonBtnPlaces").onclick = renderPlaces;
}

export function renderSaved({lang, events, places, categoriesById, settings, location}){
  const el = document.getElementById("page-saved");
  el.innerHTML = "";
  const seg = document.createElement("div");
  seg.className = "segment";
  seg.innerHTML = `
    <button class="btn primary" id="favBtnPlaces">Places</button>
    <button class="btn" id="favBtnEvents">Events</button>
  `;
  const container = document.createElement("div");
  el.appendChild(seg);
  el.appendChild(container);

  function renderFavPlaces(){
    document.getElementById("favBtnPlaces").classList.add("primary");
    document.getElementById("favBtnEvents").classList.remove("primary");
    const list = document.createElement("div");
    list.className = "list";
    const now = new Date();
    const soonHours = Number(settings.soonPlacesHours || 8);
    const favs = places.filter(p=>p.isFavorite);
    if(!favs.length){
      list.innerHTML = `<div class="card"><div class="small">No favorite places yet.</div></div>`;
    }else{
      for(const pl of favs){
        const st = placeStatusNow(pl.openingHours, now);
        let label = st.label;
        if(!st.open){
          const next = nextOpenWithin(pl.openingHours, soonHours, now);
          if(next) label = `Closed · Opens ${fmtTime(next)}`;
        }
        const dist = (location && pl.lat!=null && pl.lon!=null) ? haversineKm(location.lat, location.lon, pl.lat, pl.lon) : null;
        const distTxt = (dist!=null) ? ` · ${dist.toFixed(1)} km` : "";
        const cat = categoriesById.get(pl.categoryId);
        const catName = cat ? (cat[`name_${lang}`] || cat.name_en) : "";
        const item = document.createElement("div");
        item.className = "item";
        item.innerHTML = `
          <div class="row">
            <div style="font-weight:700">${escapeHtml(pl.name)}</div>
            <div class="star on" data-star="place" data-id="${pl.id}">★</div>
          </div>
          <div class="small">${escapeHtml(label)}${distTxt}</div>
          <div class="small">${escapeHtml(pl.city || "")}, ${escapeHtml(pl.countryCode || "")} <span class="badge">${escapeHtml(catName)}</span></div>
        `;
        item.dataset.openDetail = "place";
        item.dataset.id = pl.id;
        list.appendChild(item);
      }
    }
    container.innerHTML = "";
    container.appendChild(list);
  }

  function renderFavEvents(){
    document.getElementById("favBtnEvents").classList.add("primary");
    document.getElementById("favBtnPlaces").classList.remove("primary");
    const listWrap = document.createElement("div");
    listWrap.className = "list";

    const now = new Date();
    const favs = events.filter(e=>e.isFavorite);
    if(!favs.length){
      listWrap.innerHTML = `<div class="card"><div class="small">No favorite events yet.</div></div>`;
      container.innerHTML = "";
      container.appendChild(listWrap);
      return;
    }

    const upcoming = [];
    const past = [];
    for(const ev of favs){
      if(ev.recurrence && ev.recurrence !== "none"){
        const winEnd = new Date(now.getTime() + 365*24*3600*1000);
        const occ = generateOccurrences(ev, now, winEnd).sort((a,b)=>a.start-b.start);
        upcoming.push({ev, next: occ[0] || null});
      }else{
        const st = new Date(ev.startLocal);
        if(st >= now) upcoming.push({ev, next:{start: st}});
        else past.push({ev, next:{start: st}});
      }
    }
    upcoming.sort((a,b)=> (a.next?.start || 9e15) - (b.next?.start || 9e15));
    past.sort((a,b)=> (b.next?.start || 0) - (a.next?.start || 0));

    const sec1 = document.createElement("div");
    sec1.className = "card";
    sec1.innerHTML = `<h3>Upcoming</h3>`;
    const sec1List = document.createElement("div");
    sec1List.className = "list";
    sec1.appendChild(sec1List);

    const sec2 = document.createElement("div");
    sec2.className = "card";
    sec2.innerHTML = `<h3>Past</h3>`;
    const sec2List = document.createElement("div");
    sec2List.className = "list";
    sec2.appendChild(sec2List);

    function rowFor(ev, next){
      const cat = categoriesById.get(ev.categoryId);
      const catName = cat ? (cat[`name_${lang}`] || cat.name_en) : "";
      const when = next?.start ? new Date(next.start).toLocaleString() : "No next occurrence found";
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `
        <div class="row">
          <div style="font-weight:700">${escapeHtml(ev.title)}</div>
          <div class="star on" data-star="event" data-id="${ev.id}">★</div>
        </div>
        <div class="small">${escapeHtml(when)}</div>
        <div class="small"><span class="badge">${escapeHtml(catName)}</span></div>
      `;
      item.dataset.openDetail="event";
      item.dataset.id=ev.id;
      return item;
    }

    if(upcoming.length) for(const it of upcoming) sec1List.appendChild(rowFor(it.ev, it.next));
    else sec1List.innerHTML = `<div class="small">No upcoming favorite events.</div>`;

    if(past.length) for(const it of past) sec2List.appendChild(rowFor(it.ev, it.next));
    else sec2List.innerHTML = `<div class="small">No past favorite events.</div>`;

    container.innerHTML = "";
    container.appendChild(sec1);
    container.appendChild(sec2);
  }

  el.onclick = (e)=>{
    const star = e.target.closest("[data-star]");
    if(star){
      e.preventDefault(); e.stopPropagation();
      window.dispatchEvent(new CustomEvent("toggleFavorite", { detail:{ type:star.dataset.star, id:star.dataset.id }}));
      return;
    }
    const item = e.target.closest(".item");
    if(item && item.dataset.openDetail){
      window.dispatchEvent(new CustomEvent("openDetail", { detail:{ type:item.dataset.openDetail, id:item.dataset.id }}));
    }
  };

  renderFavPlaces();
  document.getElementById("favBtnPlaces").onclick = renderFavPlaces;
  document.getElementById("favBtnEvents").onclick = renderFavEvents;
}
