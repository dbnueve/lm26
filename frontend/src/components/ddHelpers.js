// Shared Data Dragon version (updated when DraftSystem mounts)
let _ddVersion = "16.7.1";

// Data Dragon champion key overrides (display name → DD key)
const DD_KEY_OVERRIDES = {
  "K'Sante": "KSante",
  "Kai'Sa": "Kaisa",
  "Renata Glasc": "Renata",
  "Dr. Mundo": "DrMundo",
  "Aurelion Sol": "AurelionSol",
  "Jarvan IV": "JarvanIV",
  "Xin Zhao": "XinZhao",
  "Wukong": "MonkeyKing",
  "LeBlanc": "Leblanc",
  "Bel'Veth": "Belveth",
  "Cho'Gath": "Chogath",
  "Kog'Maw": "KogMaw",
  "Kha'Zix": "Khazix",
  "Vel'Koz": "Velkoz",
  "Rek'Sai": "RekSai",
  "Lee Sin": "LeeSin",
  "Master Yi": "MasterYi",
  "Miss Fortune": "MissFortune",
  "Twisted Fate": "TwistedFate",
  "Tahm Kench": "TahmKench",
  "Nunu & Willump": "Nunu",
};
const toDDragonKey = (name) =>
  DD_KEY_OVERRIDES[name] || name.replace(/['\s.]/g, "");

export { _ddVersion, toDDragonKey };
// Allow DraftSystem to update the shared version
export function setDdVersion(v) { _ddVersion = v; }
