"use strict";
// Lantern visitor app. No framework, no AI at runtime: routes are plain shortest paths.

const app = document.getElementById("app");
const live = document.getElementById("live");
const venues = {};      // venue id -> { id, map, byId, adj, ready }
let screenToken = 0;    // bumps on every navigation so async work for an old screen can bail out
let stopCamera = null;

// Material Symbols Rounded (Apache 2.0), inlined so icons work offline and look the same on every phone.
const ICONS = {
  arrow_back_ios_new: "m382-480 294 294q15 15 14.5 35T675-116q-15 15-35 15t-35-15L297-423q-12-12-18-27t-6-30q0-15 6-30t18-27l308-308q15-15 35.5-14.5T676-844q15 15 15 35t-15 35L382-480Z",
  arrow_forward_ios: "M579-480 285-774q-15-15-14.5-35.5T286-845q15-15 35.5-15t35.5 15l307 308q12 12 18 27t6 30q0 15-6 30t-18 27L356-115q-15 15-35 14.5T286-116q-15-15-15-35.5t15-35.5l293-293Z",
  apartment: "M200-120q-33 0-56.5-23.5T120-200v-400q0-33 23.5-56.5T200-680h80v-80q0-33 23.5-56.5T360-840h240q33 0 56.5 23.5T680-760v240h80q33 0 56.5 23.5T840-440v240q0 33-23.5 56.5T760-120H520v-160h-80v160H200Zm0-80h80v-80h-80v80Zm0-160h80v-80h-80v80Zm0-160h80v-80h-80v80Zm160 160h80v-80h-80v80Zm0-160h80v-80h-80v80Zm0-160h80v-80h-80v80Zm160 320h80v-80h-80v80Zm0-160h80v-80h-80v80Zm0-160h80v-80h-80v80Zm160 480h80v-80h-80v80Zm0-160h80v-80h-80v80Z",
  arrow_back: "m313-440 196 196q12 12 11.5 28T508-188q-12 11-28 11.5T452-188L188-452q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l264-264q11-11 27.5-11t28.5 11q12 12 12 28.5T508-715L313-520h447q17 0 28.5 11.5T800-480q0 17-11.5 28.5T760-440H313Z",
  arrow_forward: "M647-440H200q-17 0-28.5-11.5T160-480q0-17 11.5-28.5T200-520h447L451-716q-12-12-11.5-28t12.5-28q12-11 28-11.5t28 11.5l264 264q6 6 8.5 13t2.5 15q0 8-2.5 15t-8.5 13L508-188q-11 11-27.5 11T452-188q-12-12-12-28.5t12-28.5l195-195Z",
  check_circle: "m424-408-86-86q-11-11-28-11t-28 11q-11 11-11 28t11 28l114 114q12 12 28 12t28-12l226-226q11-11 11-28t-11-28q-11-11-28-11t-28 11L424-408Zm56 328q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z",
  chevron_right: "M504-480 348-636q-11-11-11-28t11-28q11-11 28-11t28 11l184 184q6 6 8.5 13t2.5 15q0 8-2.5 15t-8.5 13L404-268q-11 11-28 11t-28-11q-11-11-11-28t11-28l156-156Z",
  door_open: "M468.5-451.5Q480-463 480-480t-11.5-28.5Q457-520 440-520t-28.5 11.5Q400-497 400-480t11.5 28.5Q423-440 440-440t28.5-11.5ZM280-120v-80l240-40v-445q0-15-9-27t-23-14l-208-34v-80l220 36q44 8 72 41t28 77v444q0 29-19 51.5T533-163l-253 43Zm0-80h400v-560H280v560Zm-120 80q-17 0-28.5-11.5T120-160q0-17 11.5-28.5T160-200h40v-560q0-33 23.5-56.5T280-840h400q33 0 56.5 23.5T760-760v560h40q17 0 28.5 11.5T840-160q0 17-11.5 28.5T800-120H160Z",
  elevator: "M280-400v120q0 17 11.5 28.5T320-240h40q17 0 28.5-11.5T400-280v-120q11-11 25.5-17.5T440-440v-60q0-33-23.5-56.5T360-580h-40q-33 0-56.5 23.5T240-500v60q0 16 14.5 22.5T280-400Zm95.5-234.5Q390-649 390-670t-14.5-35.5Q361-720 340-720t-35.5 14.5Q290-691 290-670t14.5 35.5Q319-620 340-620t35.5-14.5ZM556-520h128q12 0 17.5-10.5T701-551l-64-102q-6-10-17-10t-17 10l-64 102q-6 10-.5 20.5T556-520Zm81 213 64-102q6-10 .5-20.5T684-440H556q-12 0-17.5 10.5t.5 20.5l64 102q6 10 17 10t17-10ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0 0v-560 560Z",
  explore: "m335-310 202-58q20-6 34.5-20.5T592-423l58-202q3-11-5.5-19.5T625-650l-202 58q-20 6-34.5 20.5T368-537l-58 202q-3 11 5.5 19.5T335-310Zm145-110q-25 0-42.5-17.5T420-480q0-25 17.5-42.5T480-540q25 0 42.5 17.5T540-480q0 25-17.5 42.5T480-420Zm0 340q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q133 0 226.5-93.5T800-480q0-133-93.5-226.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160Zm0-320Z",
  help: "M513.5-254.5Q528-269 528-290t-14.5-35.5Q499-340 478-340t-35.5 14.5Q428-311 428-290t14.5 35.5Q457-240 478-240t35.5-14.5ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Zm4-172q25 0 43.5 16t18.5 40q0 22-13.5 39T502-525q-23 20-40.5 44T444-427q0 14 10.5 23.5T479-394q15 0 25.5-10t13.5-25q4-21 18-37.5t30-31.5q23-22 39.5-48t16.5-58q0-51-41.5-83.5T484-720q-38 0-72.5 16T359-655q-7 12-4.5 25.5T368-609q14 8 29 5t25-17q11-15 27.5-23t34.5-8Z",
  home: "M240-200h120v-200q0-17 11.5-28.5T400-440h160q17 0 28.5 11.5T600-400v200h120v-360L480-740 240-560v360Zm-80 0v-360q0-19 8.5-36t23.5-28l240-180q21-16 48-16t48 16l240 180q15 11 23.5 28t8.5 36v360q0 33-23.5 56.5T720-120H560q-17 0-28.5-11.5T520-160v-200h-80v200q0 17-11.5 28.5T400-120H240q-33 0-56.5-23.5T160-200Zm320-270Z",
  list: "M320-600q-17 0-28.5-11.5T280-640q0-17 11.5-28.5T320-680h480q17 0 28.5 11.5T840-640q0 17-11.5 28.5T800-600H320Zm0 160q-17 0-28.5-11.5T280-480q0-17 11.5-28.5T320-520h480q17 0 28.5 11.5T840-480q0 17-11.5 28.5T800-440H320Zm0 160q-17 0-28.5-11.5T280-320q0-17 11.5-28.5T320-360h480q17 0 28.5 11.5T840-320q0 17-11.5 28.5T800-280H320ZM160-600q-17 0-28.5-11.5T120-640q0-17 11.5-28.5T160-680q17 0 28.5 11.5T200-640q0 17-11.5 28.5T160-600Zm0 160q-17 0-28.5-11.5T120-480q0-17 11.5-28.5T160-520q17 0 28.5 11.5T200-480q0 17-11.5 28.5T160-440Zm0 160q-17 0-28.5-11.5T120-320q0-17 11.5-28.5T160-360q17 0 28.5 11.5T200-320q0 17-11.5 28.5T160-280Z",
  location_on: "M480-186q122-112 181-203.5T720-552q0-109-69.5-178.5T480-800q-101 0-170.5 69.5T240-552q0 71 59 162.5T480-186Zm-28 74q-14-5-25-15-65-60-115-117t-83.5-110.5q-33.5-53.5-51-103T160-552q0-150 96.5-239T480-880q127 0 223.5 89T800-552q0 45-17.5 94.5t-51 103Q698-301 648-244T533-127q-11 10-25 15t-28 5q-14 0-28-5Zm28-448Zm56.5 56.5Q560-527 560-560t-23.5-56.5Q513-640 480-640t-56.5 23.5Q400-593 400-560t23.5 56.5Q447-480 480-480t56.5-23.5Z",
  offline_pin: "M360-280h240q17 0 28.5-11.5T640-320q0-17-11.5-28.5T600-360H360q-17 0-28.5 11.5T320-320q0 17 11.5 28.5T360-280Zm78-232-58-58q-11-11-28-11t-28 11q-11 11-11 28t11 28l86 86q12 12 28 12t28-12l170-170q12-12 11.5-28.5T635-654q-12-11-28.5-10.5T579-653L438-512Zm42 432q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z",
  photo_library: "m530-460-46-60q-6-8-16-8t-16 8l-67 88q-8 10-2.5 21t18.5 11h318q13 0 18.5-11t-2.5-21l-97-127q-6-8-16-8t-16 8l-76 99ZM320-240q-33 0-56.5-23.5T240-320v-480q0-33 23.5-56.5T320-880h480q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H320Zm0-80h480v-480H320v480ZM160-80q-33 0-56.5-23.5T80-160v-520q0-17 11.5-28.5T120-720q17 0 28.5 11.5T160-680v520h520q17 0 28.5 11.5T720-120q0 17-11.5 28.5T680-80H160Zm160-720v480-480Z",
  qr_code_scanner: "M120-680q-17 0-28.5-11.5T80-720v-120q0-17 11.5-28.5T120-880h120q17 0 28.5 11.5T280-840q0 17-11.5 28.5T240-800h-80v80q0 17-11.5 28.5T120-680Zm0 600q-17 0-28.5-11.5T80-120v-120q0-17 11.5-28.5T120-280q17 0 28.5 11.5T160-240v80h80q17 0 28.5 11.5T280-120q0 17-11.5 28.5T240-80H120Zm600 0q-17 0-28.5-11.5T680-120q0-17 11.5-28.5T720-160h80v-80q0-17 11.5-28.5T840-280q17 0 28.5 11.5T880-240v120q0 17-11.5 28.5T840-80H720Zm91.5-611.5Q800-703 800-720v-80h-80q-17 0-28.5-11.5T680-840q0-17 11.5-28.5T720-880h120q17 0 28.5 11.5T880-840v120q0 17-11.5 28.5T840-680q-17 0-28.5-11.5ZM700-200v-60h60v60h-60Zm0-120v-60h60v60h-60Zm-60 60v-60h60v60h-60Zm-60 60v-60h60v60h-60Zm-60-60v-60h60v60h-60Zm120-120v-60h60v60h-60Zm-60 60v-60h60v60h-60Zm-60-60v-60h60v60h-60Zm40-140q-17 0-28.5-11.5T520-560v-160q0-17 11.5-28.5T560-760h160q17 0 28.5 11.5T760-720v160q0 17-11.5 28.5T720-520H560ZM240-200q-17 0-28.5-11.5T200-240v-160q0-17 11.5-28.5T240-440h160q17 0 28.5 11.5T440-400v160q0 17-11.5 28.5T400-200H240Zm0-320q-17 0-28.5-11.5T200-560v-160q0-17 11.5-28.5T240-760h160q17 0 28.5 11.5T440-720v160q0 17-11.5 28.5T400-520H240Zm20 260h120v-120H260v120Zm0-320h120v-120H260v120Zm320 0h120v-120H580v120Z",
  refresh: "M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-70q0-17 11.5-28.5T760-800q17 0 28.5 11.5T800-760v200q0 17-11.5 28.5T760-520H560q-17 0-28.5-11.5T520-560q0-17 11.5-28.5T560-600h128q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q68 0 124.5-34.5T692-367q8-14 22.5-19.5t29.5-.5q16 5 23 21t-1 30q-41 80-117 128t-169 48Z",
  restaurant: "M280-600v-240q0-17 11.5-28.5T320-880q17 0 28.5 11.5T360-840v240h40v-240q0-17 11.5-28.5T440-880q17 0 28.5 11.5T480-840v240q0 56-34.5 98T360-446v326q0 17-11.5 28.5T320-80q-17 0-28.5-11.5T280-120v-326q-51-14-85.5-56T160-600v-240q0-17 11.5-28.5T200-880q17 0 28.5 11.5T240-840v240h40Zm400 200h-80q-17 0-28.5-11.5T560-440v-240q0-70 51.5-135T718-880q18 0 30 14t12 33v713q0 17-11.5 28.5T720-80q-17 0-28.5-11.5T680-120v-280Z",
  stairs: "M417-373h63q17 0 28.5-11.5T520-413v-93h63q17 0 28.5-11.5T623-546v-94h57q17 0 28.5-11.5T720-680q0-17-11.5-28.5T680-720h-97q-17 0-28.5 11.5T543-680v93h-63q-17 0-28.5 11.5T440-547v93h-63q-17 0-28.5 11.5T337-414v94h-57q-17 0-28.5 11.5T240-280q0 17 11.5 28.5T280-240h97q17 0 28.5-11.5T417-280v-93ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z",
  swap_vert: "M331.5-451.5Q320-463 320-480v-247l-75 75q-11 11-27.5 11T189-652q-12-12-12-28.5t12-28.5l143-143q6-6 13-8.5t15-2.5q8 0 15 2.5t13 8.5l144 144q12 12 11.5 28T531-652q-12 11-28 11.5T475-652l-75-75v247q0 17-11.5 28.5T360-440q-17 0-28.5-11.5ZM585-99.5q-7-2.5-13-8.5L428-252q-12-12-11.5-28t12.5-28q12-11 28-11.5t28 11.5l75 75v-247q0-17 11.5-28.5T600-520q17 0 28.5 11.5T640-480v247l75-75q11-11 27.5-11t28.5 11q12 12 12 28.5T771-251L628-108q-6 6-13 8.5T600-97q-8 0-15-2.5Z",
  volume_up: "M760-481q0-83-44-151.5T598-735q-15-7-22-21.5t-2-29.5q6-16 21.5-23t31.5 0q97 43 155 131.5T840-481q0 108-58 196.5T627-153q-16 7-31.5 0T574-176q-5-15 2-29.5t22-21.5q74-34 118-102.5T760-481ZM280-360H160q-17 0-28.5-11.5T120-400v-160q0-17 11.5-28.5T160-600h120l132-132q19-19 43.5-8.5T480-703v446q0 27-24.5 37.5T412-228L280-360Zm380-120q0 42-19 79.5T591-339q-10 6-20.5.5T560-356v-250q0-12 10.5-17.5t20.5.5q31 25 50 63t19 80ZM400-606l-86 86H200v80h114l86 86v-252ZM300-480Z",
  warning: "M109-120q-11 0-20-5.5T75-140q-5-9-5.5-19.5T75-180l370-640q6-10 15.5-15t19.5-5q10 0 19.5 5t15.5 15l370 640q6 10 5.5 20.5T885-140q-5 9-14 14.5t-20 5.5H109Zm69-80h604L480-720 178-200Zm330.5-51.5Q520-263 520-280t-11.5-28.5Q497-320 480-320t-28.5 11.5Q440-297 440-280t11.5 28.5Q463-240 480-240t28.5-11.5Zm0-120Q520-383 520-400v-120q0-17-11.5-28.5T480-560q-17 0-28.5 11.5T440-520v120q0 17 11.5 28.5T480-360q17 0 28.5-11.5ZM480-460Z",
  wc: "M220-120v-260h-20q-17 0-28.5-11.5T160-420v-180q0-33 23.5-56.5T240-680h120q33 0 56.5 23.5T440-600v180q0 17-11.5 28.5T400-380h-20v260q0 17-11.5 28.5T340-80h-80q-17 0-28.5-11.5T220-120Zm23.5-623.5Q220-767 220-800t23.5-56.5Q267-880 300-880t56.5 23.5Q380-833 380-800t-23.5 56.5Q333-720 300-720t-56.5-23.5ZM600-120v-200h-65q-20 0-32-16.5t-5-36.5l84-253q8-26 29.5-40t48.5-14q27 0 48.5 14t29.5 40l84 253q7 20-5 36.5T785-320h-65v200q0 17-11.5 28.5T680-80h-40q-17 0-28.5-11.5T600-120Zm3.5-623.5Q580-767 580-800t23.5-56.5Q627-880 660-880t56.5 23.5Q740-833 740-800t-23.5 56.5Q693-720 660-720t-56.5-23.5Z",
};

const TYPE_ICON = {
  entrance: "door_open", room: "door_open", corridor: "location_on", junction: "location_on", stairs: "stairs",
  lift: "elevator", washroom: "wc", canteen: "restaurant", office: "apartment", exit: "door_open", other: "location_on",
};
// Common destinations; "Exit" also accepts entrances because they are a way out too.
const QUICK = [
  { word: "Washroom", icon: "wc", tone: "blue", types: ["washroom"] },
  { word: "Exit", icon: "door_open", tone: "green", types: ["exit", "entrance"] },
  { word: "Canteen", icon: "restaurant", tone: "orange", types: ["canteen"] },
  { word: "Office", icon: "apartment", tone: "purple", types: ["office"] },
  { word: "Stairs or lift", icon: "stairs", tone: "teal", types: ["stairs", "lift"] },
];

// ---------- helpers ----------
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const enc = encodeURIComponent;
const base = (v) => `#/venue/${enc(v.id)}`;
const imgUrl = (v, n) => `venues/${enc(v.id)}/images/${enc(n.id)}.jpg`;
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
// Floors are free text from the walker ("Ground", "G", "1"…): ground sorts first and reads naturally.
const isGround = (f) => /^(g|gf|ground|ground floor|0)$/i.test(String(f).trim());
const floorLabel = (f) => (isGround(f) ? "Ground floor" : /floor/i.test(f) ? String(f) : `Floor ${f}`);
const floorRank = (f) => (isGround(f) ? 0 : isNaN(parseFloat(f)) ? 999 : parseFloat(f));

function store(key, val) {
  try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; }
}

function icon(name) {
  return `<svg class="i" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path d="${ICONS[name] || ICONS.location_on}"/></svg>`;
}

function photo(v, n, alt, lazy) {
  // If a photo is missing, show the place's icon instead of a broken image.
  const fallback = `<div class="noimg">${icon(TYPE_ICON[n.type])}</div>`.replace(/"/g, "&quot;");
  return `<img src="${imgUrl(v, n)}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ""} onerror="this.outerHTML='${fallback}'">`;
}

function btn(href, ic, word, cls) {
  return `<a class="btn ${cls || ""}" href="${href}">${icon(ic)}<span>${word}</span></a>`;
}

// Big list-style card: round icon, title, optional supporting line, chevron.
function choice(href, ic, title, sub, cls) {
  return `<a class="choice ${cls || ""}" href="${href}"><span class="ic">${icon(ic)}</span>
    <span class="txt"><span class="title">${title}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</span>
    <span class="chev">${icon("arrow_forward_ios")}</span></a>`;
}

function topbar(backHref, v) {
  return `<nav class="topbar" aria-label="Back and home">
    ${btn(backHref, "arrow_back_ios_new", "Back", "nav")}${v ? btn(base(v), "home", "Home", "nav") : ""}</nav>`;
}

function say(msg) {
  live.textContent = "";
  setTimeout(() => { live.textContent = msg; }, 50); // clear-then-set so repeats are announced too
}

function render(html, title, focusSel) {
  app.innerHTML = html;
  document.title = title ? `${title} – Lantern` : "Lantern";
  const el = app.querySelector(focusSel || "h1");
  if (el) {
    if (!focusSel) el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
  updateSpeakButtons();
}

// ---------- data + offline pack ----------
let indexPromise = null;
function loadIndex() {
  indexPromise = indexPromise || fetch("venues/index.json").then((r) => r.json()).catch(() => ({ venues: [] }));
  return indexPromise;
}

async function loadVenue(id) {
  if (venues[id]) return venues[id];
  const res = await fetch(`venues/${enc(id)}/map.json`);
  if (!res.ok) throw new Error("no map");
  const map = await res.json();
  const v = { id, map, byId: {}, adj: {}, ready: undefined };
  map.nodes.forEach((n) => { v.byId[n.id] = n; v.adj[n.id] = []; });
  map.edges.forEach((e) => {
    if (!v.byId[e.from] || !v.byId[e.to]) return;
    const w = Math.max(1, Number(e.approx_steps) || 1);
    v.adj[e.from].push({ to: e.to, w, hint: e.hint_forward, stairs: !!e.has_stairs });
    v.adj[e.to].push({ to: e.from, w, hint: e.hint_backward, stairs: !!e.has_stairs });
  });
  v.floors = new Set(map.nodes.map((n) => n.floor)).size;
  venues[id] = v;
  cachePack(v).then((ok) => { v.ready = ok; updateBadge(v); });
  return v;
}

// Save map.json + every photo in the Cache API so the venue works in airplane mode.
async function cachePack(v) {
  if (!("caches" in window) || !("serviceWorker" in navigator)) return false;
  try {
    const cache = await caches.open(`lantern-pack-${v.id}`);
    const urls = [`venues/${enc(v.id)}/map.json`].concat(v.map.nodes.map((n) => imgUrl(v, n)));
    await Promise.all(urls.map(async (u) => {
      if (await cache.match(u)) return;
      const r = await fetch(u);
      if (r.ok) await cache.put(u, r);
      else if (u.endsWith(".json")) throw new Error("map not saved");
    }));
    await navigator.serviceWorker.ready;
    return !!(await caches.match("index.html")) && !!(await caches.match("app.js"));
  } catch (e) {
    return false;
  }
}

function updateBadge(v) {
  const b = document.getElementById("badge");
  if (!b || b.dataset.venue !== v.id) return;
  if (v.ready === true) {
    b.className = "status ok";
    b.innerHTML = `${icon("offline_pin")}<span>Ready to use without internet</span>`;
    say("Ready to use without internet");
  } else if (v.ready === false) {
    b.className = "status err";
    b.innerHTML = `${icon("warning")}<span>Not saved for offline use yet. Stay connected to the internet and open this page again.</span>`;
  }
}

// ---------- routing (Dijkstra; tiny graphs so a simple O(n²) loop is plenty) ----------
// opts.avoidStairs is reserved for the step-free milestone.
function shortest(v, from, opts) {
  opts = opts || {};
  const dist = { [from]: 0 }, prev = {}, done = new Set();
  for (;;) {
    let u = null;
    for (const k in dist) if (!done.has(k) && (u === null || dist[k] < dist[u])) u = k;
    if (u === null) break;
    done.add(u);
    for (const e of v.adj[u] || []) {
      if (opts.avoidStairs && e.stairs) continue;
      const d = dist[u] + e.w;
      if (!(e.to in dist) || d < dist[e.to]) { dist[e.to] = d; prev[e.to] = { from: u, edge: e }; }
    }
  }
  return { dist, prev };
}

function pathSteps(v, from, to) {
  const { dist, prev } = shortest(v, from);
  if (!(to in dist)) return null;
  const steps = [];
  for (let x = to; x !== from; x = prev[x].from) steps.unshift({ edge: prev[x].edge, node: v.byId[x] });
  return steps;
}

function nearest(v, from, types) {
  const { dist } = shortest(v, from);
  let best = null;
  for (const n of v.map.nodes) {
    if (n.id === from || !types.includes(n.type) || !(n.id in dist)) continue;
    if (!best || dist[n.id] < dist[best.id]) best = n;
  }
  return best ? { node: best, steps: dist[best.id] } : null;
}

// ---------- screens ----------
const MARK = `<svg class="mark" viewBox="0 0 100 100" aria-hidden="true"><path d="M38 18h24v9H38z" fill="currentColor"/>
  <path d="M33 30h34l-5 44H38z" fill="currentColor"/><circle cx="50" cy="52" r="9" fill="var(--glow)"/><path d="M35 78h30v7H35z" fill="currentColor"/></svg>`;

async function venueList() {
  const idx = await loadIndex();
  const list = idx.venues || [];
  const last = store("lantern-venue");
  if (list.length === 1) return location.replace(`#/venue/${enc(list[0].id)}`);
  if (!location.hash && last && list.some((x) => x.id === last)) return location.replace(`#/venue/${enc(last)}`);
  render(`<div class="brandrow">${MARK}<span>Lantern</span></div>
    <h1>Choose the place you are in</h1>
    ${list.length ? `<div class="choices">${list.map((x) => choice(`#/venue/${enc(x.id)}`, "apartment", esc(x.name))).join("")}</div>`
      : `<p class="muted">No places have been added yet.</p>`}`, "Choose a place");
}

async function home(v) {
  const idx = await loadIndex();
  const cover = v.map.nodes.find((n) => n.type === "entrance") || v.map.nodes[0];
  render(`<section class="cover">
      ${cover ? `<img class="cover-img" src="${imgUrl(v, cover)}" alt="" onerror="this.remove()">` : ""}
      <div class="cover-text">
        <span class="brandrow light">${MARK}<span>Lantern</span></span>
        <h1>${esc(v.map.venue.name)}</h1>
        <p>Step-by-step directions with photos</p>
      </div>
    </section>
    <div id="badge" class="status" data-venue="${esc(v.id)}" role="status">
      <span class="spinner" aria-hidden="true"></span><span>Getting ready for use without internet…</span></div>
    ${btn(`${base(v)}/where`, "explore", "Find my way", "filled xl")}
    <ul class="facts" aria-label="About this place">
      <li><strong>${v.map.nodes.length}</strong><span>places</span></li>
      <li><strong>${v.floors}</strong><span>${v.floors === 1 ? "floor" : "floors"}</span></li>
      <li><strong>${icon("offline_pin")}</strong><span>offline</span></li>
    </ul>
    <h2 class="section">How it works</h2>
    <ol class="how">
      <li><span class="num" aria-hidden="true">1</span><span>Tell us where you are</span></li>
      <li><span class="num" aria-hidden="true">2</span><span>Choose where to go</span></li>
      <li><span class="num" aria-hidden="true">3</span><span>Follow the photos, one step at a time</span></li>
    </ol>
    ${(idx.venues || []).length > 1 ? btn("#/all", "apartment", "Choose another place", "text") : ""}`,
    v.map.venue.name);
  updateBadge(v);
}

function where(v) {
  const pics = v.map.nodes.filter((n) => n.type !== "corridor").slice(0, 3);
  render(`${topbar(base(v), v)}
    <h1>Where are you?</h1>
    <div class="bigcards">
      <a class="bigcard scan" href="${base(v)}/scan">
        <span class="bigic">${icon("qr_code_scanner")}</span>
        <span class="t">Scan the sign near you</span>
        <span class="s">Look for a square code on the wall</span>
      </a>
      <a class="bigcard pics" href="${base(v)}/photos">
        <span class="mosaic" aria-hidden="true">${pics.map((n) => photo(v, n, "")).join("")}</span>
        <span class="t">Choose from photos</span>
        <span class="s">Tap the place you can see</span>
      </a>
    </div>`, "Where are you?");
}

function photos(v) {
  const nodes = v.map.nodes.slice().sort((a, b) =>
    floorRank(a.floor) - floorRank(b.floor) || String(a.floor).localeCompare(String(b.floor)) || byName(a, b));
  let html = "", floor = null;
  for (const n of nodes) {
    if (v.floors > 1 && n.floor !== floor) {
      html += `${floor === null ? "" : "</div>"}<h2 class="section">${esc(floorLabel(n.floor))}</h2><div class="grid">`;
      floor = n.floor;
    }
    html += `<a class="tile" href="${base(v)}/here/${enc(n.id)}">${photo(v, n, "", true)}<span>${esc(n.name)}</span></a>`;
  }
  render(`${topbar(`${base(v)}/where`, v)}
    <h1>Which place can you see?</h1>
    <p class="lead">Tap the photo that looks like where you are.</p>
    ${v.floors > 1 ? html + "</div>" : `<div class="grid">${html}</div>`}`, "Choose from photos");
}

async function scan(v, token) {
  render(`${topbar(`${base(v)}/where`, v)}
    <h1>Scan the sign near you</h1>
    <div class="scanner"><video playsinline muted aria-label="Camera view"></video><div class="frame" aria-hidden="true"></div></div>
    <p id="scanmsg" class="scanmsg" role="status">Point your camera at the square code on the sign.</p>
    ${btn(`${base(v)}/photos`, "photo_library", "Choose from photos instead")}`, "Scan the sign");
  const msg = (t) => { const el = document.getElementById("scanmsg"); if (el) el.textContent = t; };
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return msg("This phone cannot open the camera here. Please choose from photos instead.");
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch (e) {
    return msg("We could not open the camera. Please choose from photos instead.");
  }
  let running = true;
  const stop = () => { running = false; stream.getTracks().forEach((t) => t.stop()); };
  if (token !== screenToken) return stop(); // visitor left while the permission prompt was open
  stopCamera = stop;
  const video = app.querySelector("video");
  video.srcObject = stream;
  try { await video.play(); } catch (e) { /* autoplay quirks; frames still arrive */ }

  // Use the phone's built-in QR reader when it has one; otherwise the bundled jsQR.
  let detector = null;
  try {
    if ("BarcodeDetector" in window && (await BarcodeDetector.getSupportedFormats()).includes("qr_code")) {
      detector = new BarcodeDetector({ formats: ["qr_code"] });
    }
  } catch (e) { detector = null; }
  if (!detector && !window.jsQR) await loadScript("vendor/jsQR.js");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const tick = async () => {
    if (!running) return;
    let text = null;
    if (video.readyState >= 2) {
      if (detector) {
        try { const r = await detector.detect(video); text = r[0] && r[0].rawValue; } catch (e) { /* try next frame */ }
      } else if (window.jsQR) {
        const scale = Math.min(1, 640 / video.videoWidth); // smaller frames keep cheap phones fast
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        text = code && code.data;
      }
    }
    if (text && running) {
      const m = text.match(/#\/venue\/([^/\s]+)\/here\/([^/?#\s]+)/);
      if (m) { stop(); stopCamera = null; location.hash = `#/venue/${m[1]}/here/${m[2]}`; return; }
      msg("This code is not a Lantern sign. Look for a sign that says “You are here”.");
    }
    requestAnimationFrame(tick);
  };
  tick();
}

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
}

function hereChip(v, n) {
  return `<div class="here">${photo(v, n, "")}<span><span class="lbl">You are at</span><strong>${esc(n.name)}</strong></span></div>`;
}

// Rough walking time so visitors know what to expect (about 1.5 steps per second for a slow walker).
function minutes(steps) {
  const m = Math.round(steps / 90);
  return m < 1 ? "Under 1 min" : `About ${m} min`;
}

function whereTo(v, here) {
  const cur = v.byId[here];
  const quick = QUICK.map((q) => ({ q, hit: nearest(v, here, q.types) })).filter((x) => x.hit);
  render(`${topbar(`${base(v)}/where`, v)}
    ${hereChip(v, cur)}
    <h1>Where do you want to go?</h1>
    ${quick.length ? `<div class="tiles">
      ${quick.map(({ q, hit }) => `<a class="dtile tone-${q.tone}" href="${base(v)}/go/${enc(here)}/${enc(hit.node.id)}/1">
        <span class="ic">${icon(q.icon)}</span>
        <span class="t">${q.word}</span>
        <span class="s">${esc(hit.node.name)}</span>
        <span class="time">${minutes(hit.steps)}</span></a>`).join("")}
    </div>` : ""}
    <div class="choices">
      ${choice(`${base(v)}/here/${enc(here)}/all`, "list", "All places", `${v.map.nodes.length - 1} places with photos`, "tone-gray")}
    </div>`, "Where do you want to go?");
}

function allPlaces(v, here) {
  const nodes = v.map.nodes.filter((n) => n.id !== here).sort(byName);
  render(`${topbar(`${base(v)}/here/${enc(here)}`, v)}
    <h1>All places</h1>
    <ul class="list">${nodes.map((n) => `<li><a href="${base(v)}/go/${enc(here)}/${enc(n.id)}/1">
      ${photo(v, n, "", true)}<span class="txt">${esc(n.name)}${v.floors > 1 ? `<small>${esc(floorLabel(n.floor))}</small>` : ""}</span>
      <span class="chev">${icon("arrow_forward_ios")}</span></a></li>`).join("")}
    </ul>`, "All places");
}

function directions(v, from, to, step) {
  const dest = v.byId[to];
  const steps = pathSteps(v, from, to);
  const whereToHref = `${base(v)}/here/${enc(from)}`;
  if (!steps) {
    return render(`${topbar(whereToHref, v)}
      <div class="empty"><div class="ic">${icon("help")}</div>
      <h1>Sorry, we don't know the way to ${esc(dest.name)} from here.</h1>
      <p class="lead">Please ask someone nearby.</p></div>
      ${btn(`${base(v)}/where`, "location_on", "Choose where you are again", "filled")}`, "No way found");
  }
  const goHref = (s) => `${base(v)}/go/${enc(from)}/${enc(to)}/${s}`;
  const total = steps.length;
  if (step > total) {
    report({ kind: "arrived", venue: v.id, from, to, step });
    render(`<div class="arrived">
        <div class="arrived-photo">${photo(v, dest, dest.visual_cue || "")}<span class="tick">${icon("check_circle")}</span></div>
        <h1>You have arrived</h1>
        <p class="dest">${esc(dest.name)}</p>
      </div>
      ${btn(`${base(v)}/here/${enc(to)}`, "explore", "Go somewhere else", "filled xl")}
      <div class="row2">${btn(total ? goHref(total) : whereToHref, "arrow_back", "Back")}${btn(base(v), "home", "Home")}</div>`,
      "You have arrived");
    return;
  }
  const s = steps[step - 1];
  const hint = s.edge.hint || "Keep walking to the next place";
  const prevNode = step === 1 ? v.byId[from] : steps[step - 2].node;
  const floorChange = v.floors > 1 && s.node.floor !== prevNode.floor;
  const spoken = `Step ${step} of ${total}. ${hint}. Walk until you see ${s.node.name}.`;
  // Segments read like "3 of 6" at a glance; long routes fall back to a plain bar.
  const progress = total <= 10
    ? `<ol class="segs">${steps.map((_, i) => `<li class="${i < step - 1 ? "done" : i === step - 1 ? "now" : ""}"></li>`).join("")}</ol>`
    : `<div class="bar"><span style="width:${Math.round((step / total) * 100)}%"></span></div>`;
  render(`<div class="stephead">
      <div class="stepmeta"><strong>Step ${step} of ${total}</strong><span>To ${esc(dest.name)}</span></div>
      <div role="progressbar" aria-label="Progress" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="${step}"
        aria-valuetext="Step ${step} of ${total}">${progress}</div>
    </div>
    <h1 class="instruction">${esc(hint)}</h1>
    ${s.edge.stairs ? `<p class="notice">${icon("stairs")}<span>This part has stairs</span></p>` : ""}
    ${floorChange ? `<p class="notice">${icon("swap_vert")}<span>${isGround(s.node.floor) ? "Go to the ground floor" : `Go to ${esc(floorLabel(s.node.floor).toLowerCase())}`}</span></p>` : ""}
    <figure class="target">
      ${photo(v, s.node, s.node.visual_cue || "")}
      <figcaption><span class="see">Walk until you see this</span><span class="name">${esc(s.node.name)}</span></figcaption>
    </figure>
    ${btn(goHref(step + 1), "arrow_forward", step === total ? "I see it" : "Next", "filled xl")}
    <div class="row2">
      ${btn(step === 1 ? whereToHref : goHref(step - 1), "arrow_back", "Back")}
      <button class="btn tonal" type="button" data-speak="${esc(spoken)}" hidden>${icon("volume_up")}<span>Read aloud</span></button>
    </div>
    ${btn(`${base(v)}/where`, "help", "I'm lost", "text").replace("<a ", `<a data-lost="${esc(JSON.stringify(
      { venue: v.id, from, to, step, edge_from: prevNode.id, edge_to: s.node.id }))}" `)}`, `Step ${step} of ${total}`, ".btn.filled");
  say(spoken); // focus stays on Next so screen-reader users can keep tapping it
}

// ---------- read aloud (Web Speech API; hidden when the phone has no voice) ----------
function voice() {
  if (!("speechSynthesis" in window)) return null;
  const vs = speechSynthesis.getVoices();
  if (!vs.length) return null;
  // Prefer on-device English voices: they work offline.
  return vs.find((x) => /^en/i.test(x.lang) && x.localService) || vs.find((x) => /^en/i.test(x.lang)) || vs[0];
}
function updateSpeakButtons() {
  const ok = !!voice();
  app.querySelectorAll("[data-speak]").forEach((b) => { b.hidden = !ok; });
}
if ("speechSynthesis" in window) speechSynthesis.addEventListener("voiceschanged", updateSpeakButtons);
app.addEventListener("click", (e) => {
  const b = e.target.closest("[data-speak]");
  if (!b) return;
  const u = new SpeechSynthesisUtterance(b.dataset.speak);
  u.voice = voice();
  u.rate = 0.9; // a little slower for older listeners
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
});

// ---------- anonymous feedback (optional; navigation never waits for it) ----------
// Events wait in an outbox and are written to Firestore whenever the phone is online,
// so admins can see which instructions confuse people. Only place ids are sent: no personal data.
function report(ev) {
  try {
    const box = JSON.parse(store("lantern-outbox") || "[]").slice(-50);
    const last = box[box.length - 1];
    // Re-rendering the same screen must not count twice.
    if (last && last.kind === ev.kind && last.to === ev.to && last.step === ev.step && Date.now() - last.at < 5000) return;
    box.push(Object.assign({ at: Date.now() }, ev));
    store("lantern-outbox", JSON.stringify(box));
  } catch (e) { /* storage blocked: skip feedback */ }
  flushFeedback();
}
let flushing = false;
async function flushFeedback() {
  if (flushing || !navigator.onLine) return;
  let box;
  try { box = JSON.parse(store("lantern-outbox") || "[]"); } catch (e) { return; }
  if (!box.length) return;
  flushing = true;
  const done = new Set();
  for (const ev of box) {
    if (await sendFeedback(ev)) done.add(JSON.stringify(ev));
  }
  // Re-read so events added while sending are kept.
  try { store("lantern-outbox", JSON.stringify(JSON.parse(store("lantern-outbox") || "[]").filter((ev) => !done.has(JSON.stringify(ev))))); } catch (e) { /* ignore */ }
  flushing = false;
}
// Written straight to Firestore over REST (no SDK, no server). Security rules only accept
// well-formed anonymous events. Returns true when the event is done (sent, or rejected for good).
async function sendFeedback(ev) {
  try {
    const cfg = (await (await fetch("config.json")).json()).firebase;
    const fields = {
      venue: { stringValue: ev.venue }, kind: { stringValue: ev.kind },
      from: { stringValue: ev.from }, to: { stringValue: ev.to },
      step: { integerValue: String(ev.step || 0) }, at: { timestampValue: new Date(ev.at || Date.now()).toISOString() },
    };
    if (ev.edge_from && ev.edge_to) { fields.edge_from = { stringValue: ev.edge_from }; fields.edge_to = { stringValue: ev.edge_to }; }
    const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/feedback?key=${cfg.apiKey}`;
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }), keepalive: true });
    return r.ok || (r.status >= 400 && r.status < 500 && r.status !== 429); // rejected by rules: drop; else retry later
  } catch (e) {
    return false; // offline: keep it in the outbox
  }
}

app.addEventListener("click", (e) => {
  const a = e.target.closest("[data-lost]");
  if (a) try { report(Object.assign({ kind: "lost" }, JSON.parse(a.dataset.lost))); } catch (err) { /* ignore */ }
});
window.addEventListener("online", flushFeedback);

// ---------- router ----------
async function show() {
  const token = ++screenToken;
  if (stopCamera) { stopCamera(); stopCamera = null; }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  const p = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  try {
    if (p[0] !== "venue" || !p[1]) return await venueList();
    const v = await loadVenue(p[1]);
    if (token !== screenToken) return;
    store("lantern-venue", v.id);
    const [screen, a, b, c] = p.slice(2);
    const ids = screen === "here" ? [a] : screen === "go" ? [a, b] : [];
    if (ids.some((id) => id && !v.byId[id])) return render(`${topbar(`${base(v)}/where`, v)}
      <div class="empty"><div class="ic">${icon("location_on")}</div>
      <h1>We can't find that place</h1><p class="muted">The sign may be old. Please choose where you are.</p></div>
      ${btn(`${base(v)}/where`, "location_on", "Where are you?", "filled xl")}`, "Not found");
    if (screen === "where") return where(v);
    if (screen === "photos") return photos(v);
    if (screen === "scan") return scan(v, token);
    if (screen === "here" && a) return b === "all" ? allPlaces(v, a) : whereTo(v, a);
    if (screen === "go" && a && b) return directions(v, a, b, Math.max(1, parseInt(c, 10) || 1));
    return home(v);
  } catch (e) {
    render(`<div class="empty"><div class="ic">${icon("warning")}</div>
      <h1>Sorry, this place could not be opened</h1>
      <p class="muted">Connect to the internet once, then try again. After that it works without internet.</p></div>
      <button class="btn filled xl" type="button" onclick="location.reload()">${icon("refresh")}<span>Try again</span></button>
      ${btn("#/all", "apartment", "Choose a place")}`, "Error");
  }
}

window.addEventListener("hashchange", show);
show();
flushFeedback();

if ("serviceWorker" in navigator) {
  // When a new version takes over (not on the very first install), reload once so the visitor sees it.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register("sw.js").catch(() => { /* offline mode simply unavailable */ });
}
