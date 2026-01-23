const DB_NAME = "nearby_planner_v1";
const DB_VERSION = 1;

function reqToPromise(req){
  return new Promise((resolve, reject)=>{
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}

export function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = ()=>{
      const db = req.result;
      if(!db.objectStoreNames.contains("categories")){
        const s = db.createObjectStore("categories", { keyPath:"id" });
        s.createIndex("by_type", "type", { unique:false });
        s.createIndex("by_name_en", "name_en", { unique:false });
      }
      if(!db.objectStoreNames.contains("places")){
        const s = db.createObjectStore("places", { keyPath:"id" });
        s.createIndex("by_fav", "isFavorite", { unique:false });
        s.createIndex("by_cat", "categoryId", { unique:false });
      }
      if(!db.objectStoreNames.contains("events")){
        const s = db.createObjectStore("events", { keyPath:"id" });
        s.createIndex("by_fav", "isFavorite", { unique:false });
        s.createIndex("by_cat", "categoryId", { unique:false });
        s.createIndex("by_start", "startLocal", { unique:false });
      }
      if(!db.objectStoreNames.contains("settings")){
        db.createObjectStore("settings", { keyPath:"id" });
      }
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}

export function tx(db, store, mode="readonly"){
  return db.transaction(store, mode).objectStore(store);
}

export function uuid(){
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c=>{
    const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
    const v = c==="x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getSettings(db){
  const store = tx(db, "settings");
  const s = await reqToPromise(store.get("singleton"));
  return s || null;
}

export async function putSettings(db, settings){
  const store = tx(db, "settings", "readwrite");
  await reqToPromise(store.put(settings));
}

export async function listAll(db, storeName){
  const store = tx(db, storeName);
  return await reqToPromise(store.getAll());
}

export async function getById(db, storeName, id){
  const store = tx(db, storeName);
  return await reqToPromise(store.get(id));
}

export async function put(db, storeName, obj){
  const store = tx(db, storeName, "readwrite");
  await reqToPromise(store.put(obj));
}

export async function del(db, storeName, id){
  const store = tx(db, storeName, "readwrite");
  await reqToPromise(store.delete(id));
}

export async function clearAll(db){
  for(const storeName of ["categories","places","events","settings"]){
    const store = tx(db, storeName, "readwrite");
    await reqToPromise(store.clear());
  }
}
