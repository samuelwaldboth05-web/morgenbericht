#!/usr/bin/env node
// Baut aus work/calendar.json, work/news.json und work/health.json die
// verschlüsselte Datei data.enc.json. Verschlüsselt wird mit dem öffentlichen
// Schlüssel aus keys.json. Der Klartext verlässt dieses Skript nie.
//
// Aufruf:  node scripts/build.mjs
// Optional: REPORT_DATE=YYYY-MM-DD (Standard: heutiges Datum in Wien)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

const TZ = "Europe/Vienna";
const problems = [];
const warn = (msg) => problems.push(msg);

const b64 = (buf) => Buffer.from(buf).toString("base64");
const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isIso = (v) => typeof v === "string" && !Number.isNaN(new Date(v).getTime());
const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

const todayVienna = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
const reportDate = process.env.REPORT_DATE || todayVienna;
if (!isDay(reportDate)) {
  console.error("REPORT_DATE muss das Format YYYY-MM-DD haben.");
  process.exit(1);
}
const prevDay = (d) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day - 1)).toISOString().slice(0, 10);
};

// ---------- Kalender ----------
let calendar = null;
const calRaw = readJson("work/calendar.json");
if (Array.isArray(calRaw)) {
  calendar = [];
  calRaw.forEach((e, i) => {
    const title = str(e?.title, 200);
    const allDay = isDay(e?.start);
    if (!title) return warn(`Termin ${i + 1}: Titel fehlt, übersprungen.`);
    if (!(allDay || isIso(e?.start))) return warn(`Termin "${title}": Startzeit ungültig, übersprungen.`);
    const end = allDay ? (isDay(e?.end) ? e.end : e.start) : isIso(e?.end) ? e.end : e.start;
    calendar.push({ title, where: str(e?.where, 200), start: e.start, end, allDay });
  });
  calendar.sort((a, b) => new Date(a.start) - new Date(b.start));
} else if (calRaw !== null) {
  warn("work/calendar.json muss eine Liste sein.");
}

// ---------- Nachrichten ----------
let news = null;
const newsRaw = readJson("work/news.json");
if (Array.isArray(newsRaw)) {
  news = [];
  newsRaw.slice(0, 14).forEach((n, i) => {
    const title = str(n?.title, 160);
    const text = str(n?.text, 520);
    if (!title || !text) return warn(`Meldung ${i + 1}: Titel oder Text fehlt, übersprungen.`);
    const sources = (Array.isArray(n?.sources) ? n.sources : [])
      .map((s) => ({ name: str(s?.name, 60), url: str(s?.url, 400) }))
      .filter((s) => s.name && /^https?:\/\//i.test(s.url))
      .slice(0, 3);
    if (!sources.length) return warn(`Meldung "${title}": keine gültige Quelle (nur http/https erlaubt), übersprungen.`);
    news.push({ tag: str(n?.tag, 40), title, text, sources, dateLabel: str(n?.dateLabel, 30) });
  });
} else if (newsRaw !== null) {
  warn("work/news.json muss eine Liste sein.");
}

// ---------- Gesundheit ----------
let health = null;
const hRaw = readJson("work/health.json");
if (hRaw && Array.isArray(hRaw.nights) && Array.isArray(hRaw.days)) {
  const nights = hRaw.nights.filter((n) => isDay(n.date) && n.date <= reportDate && Number(n.total) > 0).slice(-7);
  const activity = hRaw.days.find((d) => d.date === prevDay(reportDate)) ?? null;
  health = { nights, activity };
} else if (hRaw !== null) {
  warn("work/health.json hat nicht das erwartete Format.");
}

const status = {
  calendar: calendar ? "ok" : "missing",
  news: news && news.length ? "ok" : "missing",
  health: health ? "ok" : "missing",
};

const data = {
  v: 1,
  date: reportDate,
  generatedAt: new Date().toISOString(),
  status,
  calendar: calendar ?? [],
  news: news ?? [],
  health: health ?? { nights: [], activity: null },
};

// ---------- Verschlüsseln ----------
if (!existsSync("keys.json")) {
  console.error("keys.json fehlt. Die Einrichtung (setup.html) ist noch nicht abgeschlossen.");
  process.exit(1);
}
const keys = JSON.parse(readFileSync("keys.json", "utf8"));
const pub = await crypto.subtle.importKey(
  "spki",
  Buffer.from(keys.pub, "base64"),
  { name: "RSA-OAEP", hash: "SHA-256" },
  false,
  ["encrypt"],
);
const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(data)));
const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub, await crypto.subtle.exportKey("raw", aes));

writeFileSync("data.enc.json", JSON.stringify({ v: 1, key: b64(wrapped), iv: b64(iv), ct: b64(ct) }));

console.log(`Bericht für ${reportDate} verschlüsselt geschrieben (data.enc.json).`);
console.log(
  `Kalender: ${status.calendar} (${data.calendar.length} Termine) | Nachrichten: ${status.news} (${data.news.length}) | Gesundheit: ${status.health} (${data.health.nights.length} Nächte, Aktivität ${data.health.activity ? "ja" : "nein"})`,
);
if (problems.length) {
  console.log("Hinweise:");
  problems.forEach((p) => console.log(" - " + p));
}
