#!/usr/bin/env node
// Fasst Dateien von "Health Auto Export" zu Tageswerten zusammen.
//
// Aufruf:  node scripts/health_summary.mjs datei1.json datei2.json ... > work/health.json
//
// Jede Datei darf entweder die rohe Export-Datei sein oder das Ergebnis des
// Google-Drive-Werkzeugs "download_file_content" ({ content: <base64>, title: "..." }).
// Ausgabe: { days: [{date, steps, kcal, km, hr}], nights: [{date, total, ...}] }

import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Bitte mindestens eine Datei angeben.");
  process.exit(1);
}

function load(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (raw && typeof raw.content === "string" && !raw.data) {
    const inner = JSON.parse(Buffer.from(raw.content, "base64").toString("utf8"));
    return { json: inner, title: String(raw.title || "") };
  }
  return { json: raw, title: "" };
}

// "2026-10-12 07:05:59 +0200" -> Date
function parseHae(s) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(String(s || ""));
  return m ? new Date(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : null;
}
const sum = (list, key) => list.reduce((t, x) => t + (Number(x[key]) || 0), 0);
const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const r = (v, d = 2) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

const days = [];
const nights = [];

for (const file of files) {
  const { json, title } = load(file);
  const metrics = {};
  const units = {};
  for (const m of json?.data?.metrics ?? []) {
    metrics[m.name] = m.data ?? [];
    units[m.name] = m.units;
  }

  let date = /(\d{4}-\d{2}-\d{2})/.exec(title)?.[1];
  if (!date) {
    const probe = metrics.sleep_analysis?.[0]?.date ?? metrics.step_count?.[0]?.date ?? metrics.heart_rate?.[0]?.date;
    date = String(probe || "").slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`Datum nicht erkennbar in ${file}, Datei wird übersprungen.`);
    continue;
  }

  // Aktivität des Tages
  const energy = sum(metrics.active_energy ?? [], "qty");
  days.push({
    date,
    steps: metrics.step_count?.length ? Math.round(sum(metrics.step_count, "qty")) : null,
    kcal: metrics.active_energy?.length ? Math.round(units.active_energy === "kJ" ? energy / 4.184 : energy) : null,
    km: metrics.walking_running_distance?.length ? r(sum(metrics.walking_running_distance, "qty"), 1) : null,
    hr: r(mean((metrics.heart_rate ?? []).map((x) => Number(x.Avg)).filter((v) => !Number.isNaN(v))), 0),
  });

  // Schlaf (gehört zum Aufwachtag = date)
  const s = metrics.sleep_analysis?.[0];
  if (s && Number(s.totalSleep) > 0) {
    const start = parseHae(s.sleepStart);
    const end = parseHae(s.sleepEnd);
    const during = (list) =>
      (list ?? [])
        .filter((x) => {
          const d = parseHae(x.date);
          return d && start && end && d >= start && d <= end;
        })
        .map((x) => Number(x.qty))
        .filter((v) => !Number.isNaN(v));
    nights.push({
      date,
      total: r(s.totalSleep, 3),
      inBed: r(s.inBed, 3),
      deep: r(s.deep ?? 0, 3),
      core: r(s.core ?? 0, 3),
      rem: r(s.rem ?? 0, 3),
      awake: r(s.awake ?? 0, 3),
      inBedStart: parseHae(s.inBedStart)?.toISOString() ?? null,
      inBedEnd: parseHae(s.inBedEnd)?.toISOString() ?? null,
      rhr: metrics.resting_heart_rate?.[0] ? r(Number(metrics.resting_heart_rate[0].qty), 0) : null,
      hrv: r(mean(during(metrics.heart_rate_variability)), 0),
      resp: r(mean(during(metrics.respiratory_rate)), 1),
    });
  }
}

days.sort((a, b) => a.date.localeCompare(b.date));
nights.sort((a, b) => a.date.localeCompare(b.date));
process.stdout.write(JSON.stringify({ days, nights }, null, 1) + "\n");
