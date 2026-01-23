const dict = {
  en: { soon:"Soon", search:"Search", add:"Add", saved:"Saved", settings:"Settings", language:"Language", dataTools:"Data tools", resetData:"Reset local data" },
  ro: { soon:"În curând", search:"Căutare", add:"Adaugă", saved:"Favorite", settings:"Setări", language:"Limbă", dataTools:"Instrumente date", resetData:"Reset date locale" },
  de: { soon:"Demnächst", search:"Suche", add:"Hinzufügen", saved:"Gespeichert", settings:"Einstellungen", language:"Sprache", dataTools:"Datenwerkzeuge", resetData:"Lokale Daten löschen" }
};
export function t(lang, key){
  return (dict[lang] && dict[lang][key]) || dict.en[key] || key;
}
