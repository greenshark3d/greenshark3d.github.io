import { openDB, uuid, listAll, put, del, getSettings, putSettings, clearAll } from "./db.js";
import { nominatimSuggest, nominatimGeocode } from "./geocode.js";
import { toast, setActiveTab, renderSoon, renderSaved, escapeHtml } from "./ui.js";
import { buildEventICS, exportICSFile, parseICS, icsToLocalDT, mapRRule } from "./ics.js";
import { parseLocalDT, haversineKm } from "./domain.js";
import { t } from "./i18n.js";

const DEFAULT_SETTINGS = {
  id: "singleton",
  language: "en",
  countryCode: "RO",
  useDeviceLocation: true,
  manualCity: "",
  manualLat: null,
  manualLon: null,
  soonEventsHours: 48,
  soonPlacesHours: 8,
};

let db;
let state = {
  settings: { ...DEFAULT_SETTINGS },
  categories: [],
  places: [],
  events: [],
  categoriesById: new Map(),
  location: null,
  detail: null,
};

function byId(id){ return document.getElementById(id); }

function seedDefaultsIfEmpty(){
  if(state.categories.length) return;
  const defaults = [
    { id: uuid(), type:"place", name_en:"Food", name_ro:"Mâncare", name_de:"Essen" },
    { id: uuid(), type:"place", name_en:"Coffee", name_ro:"Cafea", name_de:"Kaffee" },
    { id: uuid(), type:"place", name_en:"Store", name_ro:"Magazin", name_de:"Laden" },
    { id: uuid(), type:"place", name_en:"Pharmacy", name_ro:"Farmacie", name_de:"Apotheke" },
    { id: uuid(), type:"place", name_en:"Gym", name_ro:"Sală", name_de:"Fitness" },
    { id: uuid(), type:"event", name_en:"Concert", name_ro:"Concert", name_de:"Konzert" },
    { id: uuid(), type:"event", name_en:"Festival", name_ro:"Festival", name_de:"Festival" },
    { id: uuid(), type:"event", name_en:"Meetup", name_ro:"Întâlnire", name_de:"Treffen" },
    { id: uuid(), type:"event", name_en:"Sports", name_ro:"Sport", name_de:"Sport" },
  ];
  state.categories = defaults;
}

async function loadAll(){
  state.categories = await listAll(db, "categories");
  state.places = await listAll(db, "places");
  state.events = await listAll(db, "events");
  state.categoriesById = new Map(state.categories.map(c=>[c.id,c]));
  seedDefaultsIfEmpty();
  if(state.categories.length && !(await listAll(db,"categories")).length){
    for(const c of state.categories) await put(db,"categories", c);
  }
  const s = await getSettings(db);
  state.settings = s ? { ...DEFAULT_SETTINGS, ...s } : { ...DEFAULT_SETTINGS };
  if(!s) await putSettings(db, state.settings);
}

async function ensureLocation(){
  const s = state.settings;
  if(s.useDeviceLocation && navigator.geolocation){
    try{
      const pos = await new Promise((res, rej)=>navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy:true, timeout:7000 }));
      state.location = { lat: pos.coords.latitude, lon: pos.coords.longitude, source:"device" };
      return;
    }catch(e){
      // fall through to manual
    }
  }
  if(s.manualLat != null && s.manualLon != null){
    state.location = { lat: Number(s.manualLat), lon: Number(s.manualLon), source:"manual" };
    return;
  }
  state.location = null;
}

function updateTabLabels(){
  const lang = state.settings.language || "en";
  const map = { soon:"soon", search:"search", add:"add", saved:"saved", settings:"settings" };
  document.querySelectorAll(".tab").forEach(btn=>{
    const key = map[btn.dataset.tab];
    btn.textContent = t(lang, key);
  });
}

function bindTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.onclick = ()=>{ setActiveTab(btn.dataset.tab); renderCurrent(btn.dataset.tab); };
  });
  document.querySelector('.tab[data-tab="soon"]').classList.add("active");
}

async function toggleFavorite(type, id){
  if(type === "place"){
    const pl = state.places.find(p=>p.id===id);
    if(!pl) return;
    pl.isFavorite = !pl.isFavorite;
    await put(db, "places", pl);
    await loadAll();
    renderCurrent(currentTab());
    return;
  }
  if(type === "event"){
    const ev = state.events.find(e=>e.id===id);
    if(!ev) return;
    ev.isFavorite = !ev.isFavorite;
    await put(db, "events", ev);
    await loadAll();
    renderCurrent(currentTab());
  }
}

function currentTab(){
  const active = document.querySelector(".tab.active");
  return active ? active.dataset.tab : "soon";
}

function setActive(tab){
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
  setActiveTab(tab);
}

function renderCurrent(tab){
  if(tab==="soon"){
    renderSoon({
      lang: state.settings.language,
      settings: state.settings,
      events: state.events,
      places: state.places,
      categoriesById: state.categoriesById,
      location: state.location
    });
  }else if(tab==="search"){
    renderSearch();
  }else if(tab==="add"){
    renderAdd();
  }else if(tab==="saved"){
    renderSaved({
      lang: state.settings.language,
      events: state.events,
      places: state.places,
      categoriesById: state.categoriesById,
      settings: state.settings,
      location: state.location
    });
  }else if(tab==="settings"){
    renderSettings();
  }else if(tab==="detail"){
    renderDetail();
  }
}

function renderSearch(){
  const el = byId("page-search");
  const lang = state.settings.language;
  const qId = "searchQuery";
  const typeId = "searchType";
  el.innerHTML = `
    <div class="card">
      <div class="grid2">
        <div>
          <div class="small">Type</div>
          <select id="${typeId}" class="input">
            <option value="places">Places</option>
            <option value="events">Events</option>
          </select>
        </div>
        <div>
          <div class="small">Query</div>
          <input id="${qId}" class="input" placeholder="name, city, category..." />
        </div>
      </div>
      <div class="small" style="margin-top:8px">Tip: click an item for details, star to favorite.</div>
    </div>
    <div id="searchResults" class="list"></div>
  `;
  const res = byId("searchResults");
  const qEl = byId(qId);
  const tEl = byId(typeId);

  function doSearch(){
    const q = (qEl.value || "").trim().toLowerCase();
    const type = tEl.value;
    res.innerHTML = "";

    const list = type==="places" ? state.places : state.events;
    const out = [];
    for(const item of list){
      const cat = state.categoriesById.get(item.categoryId);
      const catName = cat ? (cat[`name_${lang}`] || cat.name_en) : "";
      const hay = [
        type==="places" ? item.name : item.title,
        item.city || "",
        item.countryCode || "",
        catName,
        type==="events" ? (item.description||"") : (item.address||"")
      ].join(" ").toLowerCase();
      if(!q || hay.includes(q)){
        out.push({ item, catName });
      }
    }

    if(!out.length){
      res.innerHTML = `<div class="card"><div class="small">No results.</div></div>`;
      return;
    }

    for(const it of out){
      const isFav = !!it.item.isFavorite;
      const star = isFav ? "★" : "☆";
      const title = type==="places" ? it.item.name : it.item.title;
      const sub = type==="places"
        ? `${(it.item.city||"")}, ${(it.item.countryCode||"")}`
        : `${new Date(it.item.startLocal).toLocaleString()}${it.item.placeId ? " · linked place" : ""}`;

      const dist = (state.location && it.item.lat!=null && it.item.lon!=null)
        ? haversineKm(state.location.lat, state.location.lon, it.item.lat, it.item.lon)
        : null;
      const distTxt = dist!=null ? ` · ${dist.toFixed(1)} km` : "";

      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="row">
          <div style="font-weight:700">${escapeHtml(title)}</div>
          <div class="star ${isFav?'on':''}" data-star="${type==='places'?'place':'event'}" data-id="${it.item.id}">${star}</div>
        </div>
        <div class="small">${escapeHtml(sub)}${distTxt}</div>
        <div class="small"><span class="badge">${escapeHtml(it.catName||"")}</span></div>
      `;
      div.dataset.openDetail = type==="places" ? "place" : "event";
      div.dataset.id = it.item.id;
      res.appendChild(div);
    }
  }

  qEl.oninput = doSearch;
  tEl.onchange = doSearch;

  el.onclick = (e)=>{
    const star = e.target.closest("[data-star]");
    if(star){
      e.preventDefault(); e.stopPropagation();
      window.dispatchEvent(new CustomEvent("toggleFavorite", { detail:{ type: star.dataset.star, id: star.dataset.id }}));
      return;
    }
    const item = e.target.closest(".item");
    if(item && item.dataset.openDetail){
      window.dispatchEvent(new CustomEvent("openDetail", { detail:{ type:item.dataset.openDetail, id:item.dataset.id }}));
    }
  };

  doSearch();
}

function renderAdd(){
  const el = byId("page-add");
  const lang = state.settings.language;

  const placeCats = state.categories.filter(c=>c.type==="place");
  const eventCats = state.categories.filter(c=>c.type==="event");

  function optCats(list){
    return list.map(c=>{
      const nm = c[`name_${lang}`] || c.name_en;
      return `<option value="${c.id}">${escapeHtml(nm)}</option>`;
    }).join("");
  }

  el.innerHTML = `
    <div class="card">
      <h3>Add place</h3>
      <div class="grid2">
        <div><div class="small">Name</div><input id="plName" class="input" placeholder="e.g., Cafe ..." /></div>
        <div><div class="small">Category</div><select id="plCat" class="input">${optCats(placeCats)}</select></div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div><div class="small">City</div><input id="plCity" class="input" placeholder="e.g., Reșița" /></div>
        <div><div class="small">Country code</div><input id="plCC" class="input" value="${escapeHtml(state.settings.countryCode||"RO")}" /></div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div><div class="small">Address (optional)</div><input id="plAddr" class="input" placeholder="Street, number..." /></div>
        <div><div class="small">Tags (comma)</div><input id="plTags" class="input" placeholder="wifi, quiet..." /></div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div><div class="small">Website (optional)</div><input id="plWeb" class="input" placeholder="https://..." /></div>
        <div><div class="small">Facebook / Instagram (optional)</div><input id="plSocial" class="input" placeholder="fb link, ig link..." /></div>
      </div>
      <div style="margin-top:10px">
        <div class="small">Notes (optional)</div>
        <textarea id="plNotes" class="input" placeholder="short notes..."></textarea>
      </div>
      <div style="margin-top:10px" class="grid3">
        <div><div class="small">Latitude</div><input id="plLat" class="input" placeholder="45.3" /></div>
        <div><div class="small">Longitude</div><input id="plLon" class="input" placeholder="21.9" /></div>
        <div style="display:flex; align-items:end"><button id="plGeocode" class="btn">Geocode</button></div>
      </div>
      <div style="margin-top:10px">
        <div class="small">Opening hours (simple)</div>
        <div class="small">Set for each weekday; time ranges (start-end). Example: 09:00-17:00, 19:00-23:00</div>
        <div class="grid2" style="margin-top:8px">
          <div><div class="small">Mon</div><input id="hMon" class="input" placeholder="09:00-17:00" /></div>
          <div><div class="small">Tue</div><input id="hTue" class="input" placeholder="" /></div>
          <div><div class="small">Wed</div><input id="hWed" class="input" placeholder="" /></div>
          <div><div class="small">Thu</div><input id="hThu" class="input" placeholder="" /></div>
          <div><div class="small">Fri</div><input id="hFri" class="input" placeholder="" /></div>
          <div><div class="small">Sat</div><input id="hSat" class="input" placeholder="" /></div>
          <div><div class="small">Sun</div><input id="hSun" class="input" placeholder="" /></div>
        </div>
      </div>
      <div style="margin-top:10px" class="row">
        <button id="btnAddPlace" class="btn primary">Save place</button>
      </div>
    </div>

    <div class="card">
      <h3>Add event</h3>
      <div class="grid2">
        <div><div class="small">Title</div><input id="evTitle" class="input" placeholder="e.g., Concert ..." /></div>
        <div><div class="small">Category</div><select id="evCat" class="input">${optCats(eventCats)}</select></div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div><div class="small">Start</div><input id="evStart" class="input" type="datetime-local" /></div>
        <div><div class="small">End (optional)</div><input id="evEnd" class="input" type="datetime-local" /></div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div>
          <div class="small">Recurrence</div>
          <select id="evRec" class="input">
            <option value="none">None</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div>
          <div class="small">Link to place (optional)</div>
          <select id="evPlace" class="input">
            <option value="">— none —</option>
            ${state.places.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div><div class="small">City</div><input id="evCity" class="input" placeholder="e.g., Reșița" /></div>
        <div><div class="small">Country code</div><input id="evCC" class="input" value="${escapeHtml(state.settings.countryCode||"RO")}" /></div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div><div class="small">Website (optional)</div><input id="evUrl" class="input" placeholder="https://..." /></div>
        <div><div class="small">Facebook / Instagram (optional)</div><input id="evSocial" class="input" placeholder="fb link, ig link..." /></div>
      </div>
      <div style="margin-top:10px">
        <div class="small">Notes (optional)</div>
        <textarea id="evDesc" class="input" placeholder="short notes..."></textarea>
      </div>
      <div style="margin-top:10px" class="grid3">
        <div><div class="small">Latitude</div><input id="evLat" class="input" placeholder="" /></div>
        <div><div class="small">Longitude</div><input id="evLon" class="input" placeholder="" /></div>
        <div style="display:flex; align-items:end"><button id="evGeocode" class="btn">Geocode</button></div>
      </div>
      <div style="margin-top:10px" class="row">
        <button id="btnAddEvent" class="btn primary">Save event</button>
      </div>
    </div>
  `;

  function parseHoursLine(s){
    if(!s) return [];
    const parts = s.split(",").map(x=>x.trim()).filter(Boolean);
    const out = [];
    for(const p of parts){
      const m = p.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
      if(m) out.push({ start:m[1], end:m[2] });
    }
    return out;
  }

  function buildOpeningHours(){
    return {
      mon: parseHoursLine(byId("hMon").value),
      tue: parseHoursLine(byId("hTue").value),
      wed: parseHoursLine(byId("hWed").value),
      thu: parseHoursLine(byId("hThu").value),
      fri: parseHoursLine(byId("hFri").value),
      sat: parseHoursLine(byId("hSat").value),
      sun: parseHoursLine(byId("hSun").value),
    };
  }

  byId("plGeocode").onclick = async ()=>{
    const q = [byId("plAddr").value, byId("plCity").value, byId("plCC").value].filter(Boolean).join(", ");
    if(!q.trim()){ toast("Provide address and/or city"); return; }
    try{
      const geo = await nominatimGeocode(q, byId("plCC").value);
      if(!geo){ toast("Not found"); return; }
      byId("plLat").value = geo.lat;
      byId("plLon").value = geo.lon;
      toast("Geocoded");
    }catch(e){ toast("Geocoding failed"); }
  };

  byId("evGeocode").onclick = async ()=>{
    const q = [byId("evCity").value, byId("evCC").value].filter(Boolean).join(", ");
    if(!q.trim()){ toast("Provide city"); return; }
    try{
      const geo = await nominatimGeocode(q, byId("evCC").value);
      if(!geo){ toast("Not found"); return; }
      byId("evLat").value = geo.lat;
      byId("evLon").value = geo.lon;
      toast("Geocoded");
    }catch(e){ toast("Geocoding failed"); }
  };

  byId("btnAddPlace").onclick = async ()=>{
    const name = byId("plName").value.trim();
    if(!name){ toast("Name required"); return; }
    const social = byId("plSocial").value.split(",").map(x=>x.trim()).filter(Boolean);
    const fb = social.find(x=>x.toLowerCase().includes("facebook.com")) || "";
    const ig = social.find(x=>x.toLowerCase().includes("instagram.com")) || "";
    const obj = {
      id: uuid(),
      name,
      categoryId: byId("plCat").value,
      city: byId("plCity").value.trim(),
      countryCode: (byId("plCC").value.trim() || "").toUpperCase(),
      address: byId("plAddr").value.trim(),
      tags: byId("plTags").value.split(",").map(x=>x.trim()).filter(Boolean),
      lat: byId("plLat").value ? Number(byId("plLat").value) : null,
      lon: byId("plLon").value ? Number(byId("plLon").value) : null,
      openingHours: buildOpeningHours(),
      website: byId("plWeb").value.trim(),
      facebook: fb,
      instagram: ig,
      notes: byId("plNotes").value.trim(),
      isFavorite: false,
      createdAt: Date.now()
    };
    await put(db, "places", obj);
    await loadAll();
    toast("Saved place");
    renderCurrent("add");
  };

  byId("btnAddEvent").onclick = async ()=>{
    const title = byId("evTitle").value.trim();
    if(!title){ toast("Title required"); return; }
    const start = byId("evStart").value;
    if(!start){ toast("Start required"); return; }
    const esocial = byId("evSocial").value.split(",").map(x=>x.trim()).filter(Boolean);
    const efb = esocial.find(x=>x.toLowerCase().includes("facebook.com")) || "";
    const eig = esocial.find(x=>x.toLowerCase().includes("instagram.com")) || "";
    const end = byId("evEnd").value || "";
    const placeId = byId("evPlace").value || "";
    const obj = {
      id: uuid(),
      title,
      categoryId: byId("evCat").value,
      startLocal: start,
      endLocal: end || null,
      recurrence: byId("evRec").value || "none",
      placeId: placeId || null,
      city: byId("evCity").value.trim(),
      countryCode: (byId("evCC").value.trim() || "").toUpperCase(),
      lat: byId("evLat").value ? Number(byId("evLat").value) : null,
      lon: byId("evLon").value ? Number(byId("evLon").value) : null,
      url: byId("evUrl").value.trim(),
      facebook: efb,
      instagram: eig,
      description: byId("evDesc").value.trim(),
      isFavorite: false,
      createdAt: Date.now()
    };
    await put(db, "events", obj);
    await loadAll();
    toast("Saved event");
    renderCurrent("add");
  };
}

function renderSettings(){
  const el = byId("page-settings");
  const s = state.settings;
  const lang = s.language || "en";

  function buildChatGPTTemplate(){
    // A template designed for mobile copy/paste import. ChatGPT should output ONLY JSON.
    return `INSTRUCTIONS FOR CHATGPT (IMPORTANT):
1) Output ONLY valid JSON (no markdown, no explanation text).
2) Fill in the JSON below using the event screenshot / description I provide.
3) Use English for titles/descriptions/notes.
4) startLocal/endLocal must be local time in format: YYYY-MM-DDTHH:MM (example: 2026-02-28T20:00).
5) recurrence: "none" | "weekly" | "monthly" | "yearly".
6) countryCode: ISO-2 (RO, DE, etc).
7) If you don’t know something, set it to null or empty string/array (do NOT invent).
8) If an event is at a place, set event.place_ref = the place.ref from the places list.

PASTE YOUR RESULT BACK INTO THE APP (Settings → Paste JSON → Preview → Import).

{
  "categories": [
    { "type": "place", "name_en": "Pub", "name_ro": "Pub", "name_de": "Pub" },
    { "type": "event", "name_en": "Concert", "name_ro": "Concert", "name_de": "Konzert" }
  ],
  "places": [
    {
      "ref": "p1",
      "name": "",
      "category": "Pub",
      "city": "",
      "countryCode": "RO",
      "address": "",
      "lat": null,
      "lon": null,
      "website": "",
      "facebook": "",
      "instagram": "",
      "notes": "",
      "openingHours": {
        "mon": [{"start":"09:00","end":"17:00"}],
        "tue": [],
        "wed": [],
        "thu": [],
        "fri": [],
        "sat": [],
        "sun": []
      }
    }
  ],
  "events": [
    {
      "title": "",
      "category": "Concert",
      "startLocal": "2026-02-28T20:00",
      "endLocal": null,
      "recurrence": "none",
      "city": "",
      "countryCode": "RO",
      "lat": null,
      "lon": null,
      "place_ref": "p1",
      "website": "",
      "facebook": "",
      "instagram": "",
      "notes": ""
    }
  ]
}
`;
  }

  el.innerHTML = `
    <div class="card">
      <h3>${escapeHtml(t(lang,"settings"))}</h3>
      <div class="grid2">
        <div>
          <div class="small">${escapeHtml(t(lang,"language"))}</div>
          <select id="setLang" class="input">
            <option value="en">English</option>
            <option value="ro">Română</option>
            <option value="de">Deutsch</option>
          </select>
        </div>
        <div>
          <div class="small">Default country code</div>
          <input id="setCC" class="input" value="${escapeHtml(s.countryCode||"RO")}" />
        </div>
      </div>

      <hr/>

      <div class="grid2">
        <div>
          <div class="small">Location source</div>
          <select id="setLocSrc" class="input">
            <option value="device">Device GPS (recommended)</option>
            <option value="manual">Manual city</option>
          </select>
        </div>
        <div>
          <div class="small">Manual city (for geocoding)</div>
          <input id="setCity" class="input" placeholder="e.g., Reșița" value="${escapeHtml(s.manualCity||"")}" />
        </div>
      </div>

      <div style="margin-top:10px" class="grid3">
        <div><div class="small">Manual lat</div><input id="setLat" class="input" value="${s.manualLat??""}" /></div>
        <div><div class="small">Manual lon</div><input id="setLon" class="input" value="${s.manualLon??""}" /></div>
        <div style="display:flex; align-items:end"><button id="setGeocodeCity" class="btn">Geocode city</button></div>
      </div>

      <hr/>

      <div class="grid2">
        <div>
          <div class="small">Soon: events window (hours)</div>
          <input id="setSoonEv" class="input" type="number" min="1" max="336" value="${escapeHtml(String(s.soonEventsHours||48))}" />
        </div>
        <div>
          <div class="small">Soon: places open within (hours)</div>
          <input id="setSoonPl" class="input" type="number" min="1" max="24" value="${escapeHtml(String(s.soonPlacesHours||8))}" />
        </div>
      </div>

      <div style="margin-top:10px" class="row">
        <button id="btnSaveSettings" class="btn primary">Save settings</button>
      </div>
    </div>

    <div class="card">
      <h3>Quick import (ChatGPT) — mobile copy/paste</h3>
      <div class="small">
        1) Tap <b>Copy template</b> → paste it into ChatGPT.<br/>
        2) Give ChatGPT a screenshot / description.<br/>
        3) Copy ChatGPT’s JSON output.<br/>
        4) Paste it below → <b>Preview</b> → <b>Import</b>.
      </div>
      <div style="margin-top:10px">
        <div class="small">Template to copy (includes instructions for ChatGPT)</div>
        <textarea id="tplBox" class="input" readonly style="min-height:180px"></textarea>
        <div class="row" style="margin-top:10px; flex-wrap:wrap">
          <button id="btnCopyTpl" class="btn">Copy template</button>
        </div>
      </div>

      <hr/>

      <div style="margin-top:10px">
        <div class="small">Paste ChatGPT JSON here</div>
        <textarea id="pasteBox" class="input" placeholder='Paste JSON here...' style="min-height:160px"></textarea>
        <div class="row" style="margin-top:10px; flex-wrap:wrap">
          <button id="btnPreviewPaste" class="btn">Preview</button>
          <button id="btnImportPaste" class="btn primary">Import</button>
        </div>
        <div id="pastePreview" class="small" style="margin-top:10px"></div>
      </div>
    </div>

    <div class="card">
      <h3>${escapeHtml(t(lang,"dataTools"))}</h3>
      <div class="row" style="flex-wrap:wrap; gap:10px">
        <button id="btnExport" class="btn">Export JSON</button>
        <button id="btnCopyExport" class="btn">Copy export JSON</button>
        <label class="btn" style="cursor:pointer">
          Import JSON <input id="impJson" type="file" accept="application/json" hidden />
        </label>
        <label class="btn" style="cursor:pointer">
          Import ICS <input id="impIcs" type="file" accept="text/calendar,.ics" hidden />
        </label>
        <button id="btnReset" class="btn danger">${escapeHtml(t(lang,"resetData"))}</button>
      </div>
      <div class="small" style="margin-top:8px">
        Export includes categories, places, events, and settings. ICS import maps calendar events into your local events list.
      </div>
    </div>
  `;

  byId("setLang").value = lang;
  byId("setLocSrc").value = s.useDeviceLocation ? "device" : "manual";

  // Quick template box
  const tpl = buildChatGPTTemplate();
  byId("tplBox").value = tpl;

  async function copyTextToClipboard(txt){
    try{
      await navigator.clipboard.writeText(txt);
      toast("Copied");
      return true;
    }catch(_){
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      try{ document.execCommand("copy"); toast("Copied"); }catch(e){ toast("Copy failed"); }
      ta.remove();
      return false;
    }
  }

  byId("btnCopyTpl").onclick = ()=>copyTextToClipboard(tpl);

  function extractJsonFromPaste(raw){
    const a = raw.indexOf("{");
    const b = raw.lastIndexOf("}");
    if(a>=0 && b>a) return raw.slice(a, b+1);
    return raw.trim();
  }

  function normalizeLocalDT(s){
    if(!s) return null;
    const x = String(s).trim().replace(" ", "T");
    // Keep YYYY-MM-DDTHH:MM
    if(x.length >= 16) return x.slice(0,16);
    return x;
  }

  let _previewPayload = null;

  byId("btnPreviewPaste").onclick = ()=>{
    const raw = byId("pasteBox").value;
    if(!raw.trim()){ toast("Paste JSON first"); return; }
    try{
      const jsonText = extractJsonFromPaste(raw);
      const data = JSON.parse(jsonText);
      const cats = Array.isArray(data.categories) ? data.categories.length : 0;
      const pls  = Array.isArray(data.places) ? data.places.length : 0;
      const evs  = Array.isArray(data.events) ? data.events.length : 0;
      _previewPayload = data;
      byId("pastePreview").innerHTML = `Preview: <b>${cats}</b> categories, <b>${pls}</b> places, <b>${evs}</b> events will be imported.`;
      toast("Preview ready");
    }catch(e){
      _previewPayload = null;
      byId("pastePreview").textContent = "Preview failed: invalid JSON.";
      toast("Invalid JSON");
    }
  };

  byId("btnImportPaste").onclick = async ()=>{
    const raw = byId("pasteBox").value;
    if(!raw.trim()){ toast("Paste JSON first"); return; }

    let data = _previewPayload;
    if(!data){
      try{
        data = JSON.parse(extractJsonFromPaste(raw));
      }catch(e){
        toast("Invalid JSON");
        return;
      }
    }

    const catsIn = Array.isArray(data.categories) ? data.categories : [];
    const placesIn = Array.isArray(data.places) ? data.places : [];
    const eventsIn = Array.isArray(data.events) ? data.events : [];

    const ok = confirm(`Import ${catsIn.length} categories, ${placesIn.length} places, ${eventsIn.length} events?`);
    if(!ok) return;

    // Build lookup existing categories by (type + name_en)
    await loadAll();
    const catKeyToId = new Map();
    for(const c of state.categories){
      catKeyToId.set(`${c.type}::${(c.name_en||"").toLowerCase()}`, c.id);
    }

    // 1) Categories
    for(const c of catsIn){
      if(!c || !c.type) continue;
      const type = String(c.type).toLowerCase() === "event" ? "event" : "place";
      const name_en = String(c.name_en || "").trim();
      if(!name_en) continue;
      const key = `${type}::${name_en.toLowerCase()}`;
      const existsId = catKeyToId.get(key);
      if(existsId){
        // Optional: update translations if provided
        const existing = state.categories.find(x=>x.id===existsId);
        if(existing){
          existing.name_ro = c.name_ro || existing.name_ro;
          existing.name_de = c.name_de || existing.name_de;
          await put(db,"categories", existing);
        }
      }else{
        const obj = {
          id: uuid(),
          type,
          name_en,
          name_ro: c.name_ro || "",
          name_de: c.name_de || ""
        };
        await put(db,"categories", obj);
        catKeyToId.set(key, obj.id);
      }
    }

    await loadAll();

    // Rebuild category name to id helper (by name_en only, both types)
    const catNameToId = new Map();
    for(const c of state.categories){
      catNameToId.set(`${c.type}::${(c.name_en||"").toLowerCase()}`, c.id);
    }

    // 2) Places
    const placeRefToId = new Map();
    for(const p of placesIn){
      if(!p || !p.name) continue;
      const catName = String(p.category || "").trim();
      const catId = catName ? (catNameToId.get(`place::${catName.toLowerCase()}`) || null) : null;
      const obj = {
        id: uuid(),
        name: String(p.name).trim(),
        categoryId: catId || state.categories.find(c=>c.type==="place")?.id || state.categories[0]?.id,
        city: String(p.city || "").trim(),
        countryCode: String(p.countryCode || state.settings.countryCode || "RO").trim().toUpperCase(),
        address: String(p.address || "").trim(),
        tags: Array.isArray(p.tags) ? p.tags.map(x=>String(x).trim()).filter(Boolean) : [],
        lat: p.lat==null || p.lat==="" ? null : Number(p.lat),
        lon: p.lon==null || p.lon==="" ? null : Number(p.lon),
        openingHours: p.openingHours && typeof p.openingHours==="object" ? p.openingHours : {mon:[],tue:[],wed:[],thu:[],fri:[],sat:[],sun:[]},
        website: String(p.website || "").trim(),
        facebook: String(p.facebook || "").trim(),
        instagram: String(p.instagram || "").trim(),
        notes: String(p.notes || "").trim(),
        isFavorite: !!p.isFavorite,
        createdAt: Date.now()
      };
      await put(db,"places", obj);
      if(p.ref) placeRefToId.set(String(p.ref), obj.id);
    }

    await loadAll();

    // 3) Events
    for(const e of eventsIn){
      if(!e || !e.title || !e.startLocal) continue;
      const catName = String(e.category || "").trim();
      const catId = catName ? (catNameToId.get(`event::${catName.toLowerCase()}`) || null) : null;
      const placeId = e.place_ref ? (placeRefToId.get(String(e.place_ref)) || null) : null;

      const obj = {
        id: uuid(),
        title: String(e.title).trim(),
        categoryId: catId || state.categories.find(c=>c.type==="event")?.id || state.categories[0]?.id,
        startLocal: normalizeLocalDT(e.startLocal),
        endLocal: e.endLocal ? normalizeLocalDT(e.endLocal) : null,
        recurrence: ["none","weekly","monthly","yearly"].includes(String(e.recurrence||"none")) ? String(e.recurrence) : "none",
        placeId: placeId || null,
        city: String(e.city || "").trim(),
        countryCode: String(e.countryCode || state.settings.countryCode || "RO").trim().toUpperCase(),
        lat: e.lat==null || e.lat==="" ? null : Number(e.lat),
        lon: e.lon==null || e.lon==="" ? null : Number(e.lon),
        url: String(e.website || e.url || "").trim(),
        facebook: String(e.facebook || "").trim(),
        instagram: String(e.instagram || "").trim(),
        description: String(e.notes || e.description || "").trim(),
        isFavorite: !!e.isFavorite,
        createdAt: Date.now()
      };
      await put(db,"events", obj);
    }

    await loadAll();
    await ensureLocation();
    toast("Imported");
    byId("pasteBox").value = "";
    byId("pastePreview").textContent = "";
    _previewPayload = null;
    renderCurrent("settings");
  };

  byId("setGeocodeCity").onclick = async ()=>{
    const city = byId("setCity").value.trim();
    const cc = byId("setCC").value.trim();
    if(!city){ toast("Enter a city"); return; }
    try{
      const sug = await nominatimSuggest(city, cc);
      if(!sug.length){ toast("Not found"); return; }
      byId("setLat").value = sug[0].lat;
      byId("setLon").value = sug[0].lon;
      toast("Geocoded");
    }catch(e){
      toast("Geocoding failed");
    }
  };

  byId("btnSaveSettings").onclick = async ()=>{
    const newS = { ...state.settings };
    newS.language = byId("setLang").value;
    newS.countryCode = (byId("setCC").value.trim() || "RO").toUpperCase();
    const src = byId("setLocSrc").value;
    newS.useDeviceLocation = (src === "device");
    newS.manualCity = byId("setCity").value.trim();
    newS.manualLat = byId("setLat").value ? Number(byId("setLat").value) : null;
    newS.manualLon = byId("setLon").value ? Number(byId("setLon").value) : null;
    newS.soonEventsHours = Number(byId("setSoonEv").value || 48);
    newS.soonPlacesHours = Number(byId("setSoonPl").value || 8);

    state.settings = newS;
    await putSettings(db, newS);
    updateTabLabels();
    await ensureLocation();
    toast("Saved");
    renderCurrent("settings");
  };

  byId("btnExport").onclick = async ()=>{
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      categories: state.categories,
      places: state.places,
      events: state.events,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nearby-planner-export.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 400);
  };

  byId("btnCopyExport").onclick = async ()=>{
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      categories: state.categories,
      places: state.places,
      events: state.events,
    };
    await copyTextToClipboard(JSON.stringify(payload, null, 2));
  };

  byId("impJson").onchange = async (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    try{
      const text = await f.text();
      const data = JSON.parse(text);
      if(data.settings){ state.settings = { ...DEFAULT_SETTINGS, ...data.settings, id:"singleton" }; await putSettings(db, state.settings); }
      if(Array.isArray(data.categories)){
        for(const c of data.categories) await put(db,"categories", c);
      }
      if(Array.isArray(data.places)){
        for(const p of data.places) await put(db,"places", p);
      }
      if(Array.isArray(data.events)){
        for(const ev of data.events) await put(db,"events", ev);
      }
      await loadAll();
      updateTabLabels();
      await ensureLocation();
      toast("Imported");
      renderCurrent("settings");
    }catch(err){
      toast("Import failed");
    }finally{
      e.target.value = "";
    }
  };

  byId("impIcs").onchange = async (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    try{
      const text = await f.text();
      const items = parseICS(text);
      let imported = 0;
      for(const it of items){
        const st = icsToLocalDT(it.dtstart);
        if(!st) continue;
        const en = it.dtend ? icsToLocalDT(it.dtend) : null;
        const ev = {
          id: uuid(),
          title: it.summary || "Untitled",
          categoryId: state.categories.find(c=>c.type==="event")?.id || state.categories[0]?.id,
          startLocal: st.toISOString().slice(0,16),
          endLocal: en ? en.toISOString().slice(0,16) : null,
          recurrence: mapRRule(it.rrule),
          placeId: null,
          city: "",
          countryCode: state.settings.countryCode || "RO",
          lat: null,
          lon: null,
          url: it.url || "",
          facebook: "",
          instagram: "",
          description: it.description || "",
          isFavorite: false,
          createdAt: Date.now()
        };
        await put(db,"events", ev);
        imported++;
      }
      await loadAll();
      toast(`Imported ${imported} events`);
      renderCurrent("settings");
    }catch(err){
      toast("ICS import failed");
    }finally{
      e.target.value = "";
    }
  };

  byId("btnReset").onclick = async ()=>{
    if(!confirm("Delete all local data?")) return;
    await clearAll(db);
    state = { ...state, categories:[], places:[], events:[], categoriesById:new Map(), detail:null };
    await loadAll();
    await ensureLocation();
    updateTabLabels();
    toast("Reset done");
    renderCurrent("settings");
  };
}


function renderDetail(){
  const el = byId("page-detail");
  const { type, id } = state.detail || {};
  if(!type || !id){
    el.innerHTML = `<div class="card"><div class="small">No item selected.</div></div>`;
    return;
  }
  const lang = state.settings.language;
  if(type === "place"){
    const pl = state.places.find(p=>p.id===id);
    if(!pl){ el.innerHTML = `<div class="card"><div class="small">Not found.</div></div>`; return; }
    const cat = state.categoriesById.get(pl.categoryId);
    const catName = cat ? (cat[`name_${lang}`] || cat.name_en) : "";
    const dist = (state.location && pl.lat!=null && pl.lon!=null)
      ? haversineKm(state.location.lat, state.location.lon, pl.lat, pl.lon).toFixed(1) + " km"
      : "—";
    el.innerHTML = `
      <div class="card">
        <div class="row">
          <h3 style="margin:0">${escapeHtml(pl.name)}</h3>
          <div class="star ${pl.isFavorite?'on':''}" data-star="place" data-id="${pl.id}">${pl.isFavorite?"★":"☆"}</div>
        </div>
        <div class="small"><span class="badge">${escapeHtml(catName)}</span> · Distance: ${escapeHtml(dist)}</div>
        <hr/>
        <div class="kv">
          <div>City</div><div>${escapeHtml(pl.city||"")}</div>
          <div>Country</div><div>${escapeHtml(pl.countryCode||"")}</div>
          <div>Address</div><div>${escapeHtml(pl.address||"")}</div>
          <div>Tags</div><div>${escapeHtml((pl.tags||[]).join(", "))}</div>
          <div>Lat/Lon</div><div>${pl.lat!=null && pl.lon!=null ? `${pl.lat}, ${pl.lon}` : "—"}</div>
        </div>
        <hr/>
        <div class="row" style="flex-wrap:wrap">
          ${pl.lat!=null && pl.lon!=null ? `<button class="btn" id="btnNav">Open in Google Maps</button>` : ``}
          ${pl.website ? `<button class="btn" id="btnWeb">Website</button>` : ``}
          ${pl.facebook ? `<button class="btn" id="btnFb">Facebook</button>` : ``}
          ${pl.instagram ? `<button class="btn" id="btnIg">Instagram</button>` : ``}
          ${pl.notes ? `<button class="btn" id="btnNotes">Notes</button>` : ``}
          <button class="btn" id="btnEdit">Edit</button>
          <button class="btn danger" id="btnDel">Delete</button>
        </div>
      </div>
      <div class="card">
        <h3>Opening hours</h3>
        <div class="small">Set per day in Add/Edit.</div>
        <pre style="white-space:pre-wrap; margin:0; color:var(--muted)">${escapeHtml(JSON.stringify(pl.openingHours||{}, null, 2))}</pre>
      </div>
    `;
    const navBtn = byId("btnNav");
    if(navBtn) navBtn.onclick = ()=>{
      if(pl.lat==null || pl.lon==null){ toast("No coordinates"); return; }
      const url = `https://www.google.com/maps/dir/?api=1&destination=${pl.lat},${pl.lon}`;
      window.open(url, "_blank");
    };
    const webBtn = byId("btnWeb");
    if(webBtn) webBtn.onclick = ()=>{ window.open(pl.website, "_blank"); };
    const fbBtn = byId("btnFb");
    if(fbBtn) fbBtn.onclick = ()=> window.open(pl.facebook, "_blank");
    const igBtn = byId("btnIg");
    if(igBtn) igBtn.onclick = ()=> window.open(pl.instagram, "_blank");
    const notesBtn = byId("btnNotes");
    if(notesBtn) notesBtn.onclick = ()=> alert(pl.notes);
    byId("btnDel").onclick = async ()=>{
      if(!confirm("Delete this place?")) return;
      await del(db,"places", pl.id);
      for(const ev of state.events){
        if(ev.placeId === pl.id){ ev.placeId = null; await put(db,"events", ev); }
      }
      await loadAll();
      toast("Deleted");
      setActive("search");
      renderCurrent("search");
    };
    byId("btnEdit").onclick = ()=> openEditPlace(pl);
    el.onclick = (e)=>{
      const star = e.target.closest("[data-star]");
      if(star){
        window.dispatchEvent(new CustomEvent("toggleFavorite", { detail:{ type:"place", id:pl.id }}));
      }
    };
    return;
  }

  if(type === "event"){
    const ev = state.events.find(e=>e.id===id);
    if(!ev){ el.innerHTML = `<div class="card"><div class="small">Not found.</div></div>`; return; }
    const cat = state.categoriesById.get(ev.categoryId);
    const catName = cat ? (cat[`name_${lang}`] || cat.name_en) : "";
    const start = parseLocalDT(ev.startLocal);
    const end = ev.endLocal ? parseLocalDT(ev.endLocal) : null;
    const linked = ev.placeId ? state.places.find(p=>p.id===ev.placeId) : null;

    let lat = ev.lat, lon = ev.lon;
    if(linked && (lat==null || lon==null)){ lat = linked.lat; lon = linked.lon; }

    const dist = (state.location && lat!=null && lon!=null)
      ? haversineKm(state.location.lat, state.location.lon, lat, lon).toFixed(1) + " km"
      : "—";

    el.innerHTML = `
      <div class="card">
        <div class="row">
          <h3 style="margin:0">${escapeHtml(ev.title)}</h3>
          <div class="star ${ev.isFavorite?'on':''}" data-star="event" data-id="${ev.id}">${ev.isFavorite?"★":"☆"}</div>
        </div>
        <div class="small"><span class="badge">${escapeHtml(catName)}</span> · ${escapeHtml(start.toLocaleString())}${end ? " – " + escapeHtml(end.toLocaleTimeString().slice(0,5)) : ""}</div>
        <div class="small">Recurrence: ${escapeHtml(ev.recurrence || "none")} · Distance: ${escapeHtml(dist)}</div>
        ${linked ? `<div class="small">Linked place: <b>${escapeHtml(linked.name)}</b></div>` : ""}
        <hr/>
        <div class="kv">
          <div>City</div><div>${escapeHtml(ev.city||"")}</div>
          <div>Country</div><div>${escapeHtml(ev.countryCode||"")}</div>
          <div>URL</div><div>${ev.url ? `<a href="${escapeHtml(ev.url)}" target="_blank" rel="noreferrer">${escapeHtml(ev.url)}</a>` : "—"}</div>
          <div>Description</div><div>${escapeHtml(ev.description||"")}</div>
          <div>Lat/Lon</div><div>${lat!=null && lon!=null ? `${lat}, ${lon}` : "—"}</div>
        </div>
        <hr/>
        <div class="row" style="flex-wrap:wrap">
          <button class="btn" id="btnIcs">Export ICS</button>
          ${lat!=null && lon!=null ? `<button class="btn" id="btnNav">Open in Google Maps</button>` : ``}
          ${ev.url ? `<button class="btn" id="btnWeb">Website</button>` : ``}
          ${ev.facebook ? `<button class="btn" id="btnFb">Facebook</button>` : ``}
          ${ev.instagram ? `<button class="btn" id="btnIg">Instagram</button>` : ``}
          ${ev.description ? `<button class="btn" id="btnNotes">Notes</button>` : ``}
          <button class="btn" id="btnEdit">Edit</button>
          <button class="btn danger" id="btnDel">Delete</button>
        </div>
      </div>
    `;

    byId("btnIcs").onclick = ()=>{
      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Nearby Planner//EN",
        buildEventICS({
          uid: ev.id + "@nearby-planner",
          title: ev.title,
          start,
          end,
          description: ev.description,
          location: linked ? linked.address : "",
          url: ev.url,
          recurrence: ev.recurrence
        }),
        "END:VCALENDAR"
      ].join("\r\n");
      exportICSFile("event.ics", ics);
    };

    const navBtn = byId("btnNav");
    if(navBtn) navBtn.onclick = ()=>{
      if(lat==null || lon==null){ toast("No coordinates"); return; }
      const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
      window.open(url, "_blank");
    };
    const webBtn = byId("btnWeb");
    if(webBtn) webBtn.onclick = ()=> window.open(ev.url, "_blank");
    const fbBtn = byId("btnFb");
    if(fbBtn) fbBtn.onclick = ()=> window.open(ev.facebook, "_blank");
    const igBtn = byId("btnIg");
    if(igBtn) igBtn.onclick = ()=> window.open(ev.instagram, "_blank");
    const notesBtn = byId("btnNotes");
    if(notesBtn) notesBtn.onclick = ()=> alert(ev.description);

    byId("btnDel").onclick = async ()=>{
      if(!confirm("Delete this event?")) return;
      await del(db,"events", ev.id);
      await loadAll();
      toast("Deleted");
      setActive("search");
      renderCurrent("search");
    };

    byId("btnEdit").onclick = ()=> openEditEvent(ev);
    el.onclick = (e)=>{
      const star = e.target.closest("[data-star]");
      if(star){
        window.dispatchEvent(new CustomEvent("toggleFavorite", { detail:{ type:"event", id:ev.id }}));
      }
    };
  }
}

function openEditPlace(pl){
  const el = byId("page-detail");
  const lang = state.settings.language;
  const placeCats = state.categories.filter(c=>c.type==="place");
  const optCats = placeCats.map(c=>{
    const nm = c[`name_${lang}`] || c.name_en;
    return `<option value="${c.id}" ${c.id===pl.categoryId?"selected":""}>${escapeHtml(nm)}</option>`;
  }).join("");

  function lineFor(day){
    const arr = (pl.openingHours && pl.openingHours[day]) || [];
    return arr.map(x=>`${x.start}-${x.end}`).join(", ");
  }

  el.innerHTML = `
    <div class="card">
      <h3>Edit place</h3>
      <div class="grid2">
        <div><div class="small">Name</div><input id="ePlName" class="input" value="${escapeHtml(pl.name)}" /></div>
        <div><div class="small">Category</div><select id="ePlCat" class="input">${optCats}</select></div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div><div class="small">City</div><input id="ePlCity" class="input" value="${escapeHtml(pl.city||"")}" /></div>
        <div><div class="small">Country</div><input id="ePlCC" class="input" value="${escapeHtml(pl.countryCode||"")}" /></div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div><div class="small">Address</div><input id="ePlAddr" class="input" value="${escapeHtml(pl.address||"")}" /></div>
        <div><div class="small">Tags (comma)</div><input id="ePlTags" class="input" value="${escapeHtml((pl.tags||[]).join(", "))}" /></div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div><div class="small">Website</div><input id="ePlWeb" class="input" value="${escapeHtml(pl.website||"")}" /></div>
        <div><div class="small">Facebook</div><input id="ePlFb" class="input" value="${escapeHtml(pl.facebook||"")}" /></div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div><div class="small">Instagram</div><input id="ePlIg" class="input" value="${escapeHtml(pl.instagram||"")}" /></div>
        <div><div class="small">Notes</div><input id="ePlNotes" class="input" value="${escapeHtml(pl.notes||"")}" /></div>
      </div>
      <div style="margin-top:10px" class="grid3">
        <div><div class="small">Lat</div><input id="ePlLat" class="input" value="${pl.lat??""}" /></div>
        <div><div class="small">Lon</div><input id="ePlLon" class="input" value="${pl.lon??""}" /></div>
        <div style="display:flex; align-items:end"><button id="ePlGeocode" class="btn">Geocode</button></div>
      </div>
      <div style="margin-top:10px">
        <div class="small">Opening hours</div>
        <div class="grid2" style="margin-top:8px">
          <div><div class="small">Mon</div><input id="ehMon" class="input" value="${escapeHtml(lineFor("mon"))}" /></div>
          <div><div class="small">Tue</div><input id="ehTue" class="input" value="${escapeHtml(lineFor("tue"))}" /></div>
          <div><div class="small">Wed</div><input id="ehWed" class="input" value="${escapeHtml(lineFor("wed"))}" /></div>
          <div><div class="small">Thu</div><input id="ehThu" class="input" value="${escapeHtml(lineFor("thu"))}" /></div>
          <div><div class="small">Fri</div><input id="ehFri" class="input" value="${escapeHtml(lineFor("fri"))}" /></div>
          <div><div class="small">Sat</div><input id="ehSat" class="input" value="${escapeHtml(lineFor("sat"))}" /></div>
          <div><div class="small">Sun</div><input id="ehSun" class="input" value="${escapeHtml(lineFor("sun"))}" /></div>
        </div>
      </div>
      <div style="margin-top:10px" class="row" style="flex-wrap:wrap">
        <button id="ePlSave" class="btn primary">Save</button>
        <button id="ePlCancel" class="btn">Cancel</button>
      </div>
    </div>
  `;

  function parseHoursLine(s){
    if(!s) return [];
    const parts = s.split(",").map(x=>x.trim()).filter(Boolean);
    const out = [];
    for(const p of parts){
      const m = p.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
      if(m) out.push({ start:m[1], end:m[2] });
    }
    return out;
  }

  function buildOpeningHours(){
    return {
      mon: parseHoursLine(byId("ehMon").value),
      tue: parseHoursLine(byId("ehTue").value),
      wed: parseHoursLine(byId("ehWed").value),
      thu: parseHoursLine(byId("ehThu").value),
      fri: parseHoursLine(byId("ehFri").value),
      sat: parseHoursLine(byId("ehSat").value),
      sun: parseHoursLine(byId("ehSun").value),
    };
  }

  byId("ePlGeocode").onclick = async ()=>{
    const q = [byId("ePlAddr").value, byId("ePlCity").value, byId("ePlCC").value].filter(Boolean).join(", ");
    if(!q.trim()){ toast("Provide address and/or city"); return; }
    try{
      const geo = await nominatimGeocode(q, byId("ePlCC").value);
      if(!geo){ toast("Not found"); return; }
      byId("ePlLat").value = geo.lat;
      byId("ePlLon").value = geo.lon;
      toast("Geocoded");
    }catch(e){ toast("Geocoding failed"); }
  };

  byId("ePlCancel").onclick = ()=>{
    state.detail = { type:"place", id:pl.id };
    renderDetail();
  };

  byId("ePlSave").onclick = async ()=>{
    pl.name = byId("ePlName").value.trim();
    pl.categoryId = byId("ePlCat").value;
    pl.city = byId("ePlCity").value.trim();
    pl.countryCode = (byId("ePlCC").value.trim() || "").toUpperCase();
    pl.address = byId("ePlAddr").value.trim();
    pl.tags = byId("ePlTags").value.split(",").map(x=>x.trim()).filter(Boolean);
    pl.lat = byId("ePlLat").value ? Number(byId("ePlLat").value) : null;
    pl.lon = byId("ePlLon").value ? Number(byId("ePlLon").value) : null;
    pl.openingHours = buildOpeningHours();
    pl.website = byId("ePlWeb").value.trim();
    pl.facebook = byId("ePlFb").value.trim();
    pl.instagram = byId("ePlIg").value.trim();
    pl.notes = byId("ePlNotes").value.trim();

    await put(db,"places", pl);
    await loadAll();
    toast("Saved");
    state.detail = { type:"place", id:pl.id };
    renderDetail();
  };
}

function openEditEvent(ev){
  const el = byId("page-detail");
  const lang = state.settings.language;
  const eventCats = state.categories.filter(c=>c.type==="event");
  const optCats = eventCats.map(c=>{
    const nm = c[`name_${lang}`] || c.name_en;
    return `<option value="${c.id}" ${c.id===ev.categoryId?"selected":""}>${escapeHtml(nm)}</option>`;
  }).join("");

  el.innerHTML = `
    <div class="card">
      <h3>Edit event</h3>
      <div class="grid2">
        <div><div class="small">Title</div><input id="eEvTitle" class="input" value="${escapeHtml(ev.title)}" /></div>
        <div><div class="small">Category</div><select id="eEvCat" class="input">${optCats}</select></div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div><div class="small">Start</div><input id="eEvStart" class="input" type="datetime-local" value="${escapeHtml(ev.startLocal)}"/></div>
        <div><div class="small">End</div><input id="eEvEnd" class="input" type="datetime-local" value="${escapeHtml(ev.endLocal||"")}"/></div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div>
          <div class="small">Recurrence</div>
          <select id="eEvRec" class="input">
            <option value="none">None</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div>
          <div class="small">Link to place</div>
          <select id="eEvPlace" class="input">
            <option value="">— none —</option>
            ${state.places.map(p=>`<option value="${p.id}" ${p.id===ev.placeId?"selected":""}>${escapeHtml(p.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div><div class="small">City</div><input id="eEvCity" class="input" value="${escapeHtml(ev.city||"")}" /></div>
        <div><div class="small">Country</div><input id="eEvCC" class="input" value="${escapeHtml(ev.countryCode||"")}" /></div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div><div class="small">Website</div><input id="eEvUrl" class="input" value="${escapeHtml(ev.url||"")}" /></div>
        <div><div class="small">Notes</div><input id="eEvDesc" class="input" value="${escapeHtml(ev.description||"")}" /></div>
      </div>
      <div style="margin-top:10px" class="grid2">
        <div><div class="small">Facebook</div><input id="eEvFb" class="input" value="${escapeHtml(ev.facebook||"")}" /></div>
        <div><div class="small">Instagram</div><input id="eEvIg" class="input" value="${escapeHtml(ev.instagram||"")}" /></div>
      </div>
      <div style="margin-top:10px" class="grid3">
        <div><div class="small">Lat</div><input id="eEvLat" class="input" value="${ev.lat??""}" /></div>
        <div><div class="small">Lon</div><input id="eEvLon" class="input" value="${ev.lon??""}" /></div>
        <div style="display:flex; align-items:end"><button id="eEvGeocode" class="btn">Geocode</button></div>
      </div>
      <div style="margin-top:10px" class="row" style="flex-wrap:wrap">
        <button id="eEvSave" class="btn primary">Save</button>
        <button id="eEvCancel" class="btn">Cancel</button>
      </div>
    </div>
  `;

  byId("eEvRec").value = ev.recurrence || "none";

  byId("eEvGeocode").onclick = async ()=>{
    const q = [byId("eEvCity").value, byId("eEvCC").value].filter(Boolean).join(", ");
    if(!q.trim()){ toast("Provide city"); return; }
    try{
      const geo = await nominatimGeocode(q, byId("eEvCC").value);
      if(!geo){ toast("Not found"); return; }
      byId("eEvLat").value = geo.lat;
      byId("eEvLon").value = geo.lon;
      toast("Geocoded");
    }catch(e){ toast("Geocoding failed"); }
  };

  byId("eEvCancel").onclick = ()=>{
    state.detail = { type:"event", id:ev.id };
    renderDetail();
  };

  byId("eEvSave").onclick = async ()=>{
    ev.title = byId("eEvTitle").value.trim();
    ev.categoryId = byId("eEvCat").value;
    ev.startLocal = byId("eEvStart").value;
    ev.endLocal = byId("eEvEnd").value || null;
    ev.recurrence = byId("eEvRec").value || "none";
    ev.placeId = byId("eEvPlace").value || null;
    ev.city = byId("eEvCity").value.trim();
    ev.countryCode = (byId("eEvCC").value.trim() || "").toUpperCase();
    ev.url = byId("eEvUrl").value.trim();
    ev.description = byId("eEvDesc").value.trim();
    ev.facebook = byId("eEvFb").value.trim();
    ev.instagram = byId("eEvIg").value.trim();
    ev.lat = byId("eEvLat").value ? Number(byId("eEvLat").value) : null;
    ev.lon = byId("eEvLon").value ? Number(byId("eEvLon").value) : null;

    await put(db,"events", ev);
    await loadAll();
    toast("Saved");
    state.detail = { type:"event", id:ev.id };
    renderDetail();
  };
}

function wireGlobalEvents(){
  window.addEventListener("toggleFavorite", (e)=>toggleFavorite(e.detail.type, e.detail.id));
  window.addEventListener("openDetail", (e)=>{
    state.detail = { type: e.detail.type, id: e.detail.id };
    setActive("detail");
    renderCurrent("detail");
  });
}

function wireInstallPrompt(){
  let deferred;
  window.addEventListener("beforeinstallprompt", (e)=>{
    e.preventDefault();
    deferred = e;
    const btn = byId("btnInstall");
    btn.hidden = false;
    btn.onclick = async ()=>{
      btn.hidden = true;
      try{ await deferred.prompt(); await deferred.userChoice; }catch(_){}
      deferred = null;
    };
  });
}

async function registerSW(){
  if("serviceWorker" in navigator){
    try{
      await navigator.serviceWorker.register("./sw.js");
    }catch(e){
      // ignore
    }
  }
}

async function main(){
  db = await openDB();
  await loadAll();
  await ensureLocation();
  updateTabLabels();
  bindTabs();
  wireGlobalEvents();
  wireInstallPrompt();
  await registerSW();
  setActive("soon");
  renderCurrent("soon");
}

main();
