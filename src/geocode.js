export async function nominatimSuggest(cityQuery, countryCode){
  const q = encodeURIComponent(cityQuery);
  const cc = encodeURIComponent(countryCode || "");
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&city=${q}&countrycodes=${cc}`;
  const r = await fetch(url, { headers: { "Accept":"application/json" }});
  if(!r.ok) throw new Error("Geocoding failed");
  const data = await r.json();
  return data.map(x=>({
    display: x.display_name,
    lat: Number(x.lat),
    lon: Number(x.lon),
    city: (x.address && (x.address.city || x.address.town || x.address.village)) || "",
    countryCode: (x.address && x.address.country_code) ? String(x.address.country_code).toUpperCase() : (countryCode||"")
  }));
}

export async function nominatimGeocode(text, countryCode){
  const q = encodeURIComponent(text);
  const cc = encodeURIComponent(countryCode || "");
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${q}&countrycodes=${cc}`;
  const r = await fetch(url, { headers: { "Accept":"application/json" }});
  if(!r.ok) throw new Error("Geocoding failed");
  const data = await r.json();
  if(!data || !data[0]) return null;
  return { lat:Number(data[0].lat), lon:Number(data[0].lon), display:data[0].display_name };
}
