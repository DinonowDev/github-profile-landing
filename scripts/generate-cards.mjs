#!/usr/bin/env node
/**
 * Self-hosted GitHub profile SVG — dark bento + animated contribution morph.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const USERNAME = process.env.GH_USERNAME || "DinonowDev";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
/** Local/demo snapshot. CI and real installs should set USE_MOCK=0. */
const USE_MOCK = process.env.USE_MOCK !== "0";

/** Hardcoded author credit — do not wire this to USERNAME / profile data. */
const DEVELOPER = {
  name: "AmirHossein Rezaei",
  handle: "DinonowDev",
};

const SOCIAL = {
  telegram: { handle: "@dinonow", url: "https://t.me/dinonow" },
  linkedin: { handle: "linkedin/in/dinonow", url: "https://www.linkedin.com/in/dinonow" },
  github: { handle: "github.com/DinonowDev", url: "https://github.com/DinonowDev" },
};

const C = {
  bg: "#09090b",
  card: "#131316",
  line: "#27272a",
  text: "#fafafa",
  muted: "#a1a1aa",
  faint: "#52525b",
  teal: "#2dd4bf",
  sky: "#38bdf8",
  violet: "#a78bfa",
  amber: "#fbbf24",
  rose: "#fb7185",
  green: "#4ade80",
};

const HIDE_LANGS = new Set(["Vim Script", "Vim Snippet", "C", "Makefile", "Shell"]);
const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

const QUERY = `
query ($login: String!) {
  user(login: $login) {
    name login bio location createdAt
    status { message }
    followers { totalCount }
    following { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 12, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
    repositoriesContributedTo(
      first: 100
      contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]
      includeUserRepositories: false
      privacy: PUBLIC
    ) {
      totalCount
      nodes { nameWithOwner stargazerCount url }
    }
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount } }
      }
    }
  }
}
`;

/**
 * Snapshot used when the GitHub API is unavailable locally.
 * Contribution days are irregular on purpose (bursts, quiet weekends, gaps).
 */
function mockData() {
  const contributions = 1608;
  const activeDays = 250;
  const maxDay = 39;
  const contributedRepos = [
    { name: "diegosouzapw/OmniRoute", stars: 30831 },
    { name: "klinecharts/KLineChart", stars: 3999 },
    { name: "kianelbo/noon", stars: 12 },
  ];
  const weeks = mockContributionWeeks(contributions, activeDays, maxDay);

  return {
    name: "AmirHossein Rezaei",
    login: USERNAME,
    bio: "Front-end Developer",
    location: "Tehran",
    status: "Learn & Study",
    followers: 31,
    following: 25,
    repos: 7,
    stars: 32,
    contributedRepoCount: contributedRepos.length,
    contributedStars: contributedRepos.reduce((sum, r) => sum + r.stars, 0),
    contributedRepos,
    contributions,
    years: 5,
    since: 2021,
    languages: [
      { name: "TypeScript", pct: 54, color: "#3178c6" },
      { name: "JavaScript", pct: 28, color: "#f1e05a" },
      { name: "CSS", pct: 9, color: "#663399" },
      { name: "SCSS", pct: 7, color: "#c6538c" },
      { name: "Python", pct: 2, color: "#3572A5" },
    ],
    weeks,
    maxDay,
    activeDays,
    averagePerActiveDay: contributions / activeDays,
  };
}

/** Seeded PRNG so the demo heatmap stays stable across regenerations. */
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a 53-week calendar that looks like a real GitHub year:
 * weekday bias, weekend dips, quiet gaps, and short intense streaks.
 */
function mockContributionWeeks(total, activeDays, maxDay) {
  const weekCount = 53;
  const dayCount = weekCount * 7;
  const days = Array.from({ length: dayCount }, () => 0);
  const rand = mulberry32(0xd1007e57);

  // Quiet stretches (vacation / burnout) — week indexes.
  const quietWeeks = new Set([4, 5, 22, 35, 36, 48]);
  // Hot streaks with denser commits.
  const hotWeeks = new Set([11, 12, 13, 27, 28, 41, 42]);

  const weights = [];
  for (let i = 0; i < dayCount; i++) {
    const week = Math.floor(i / 7);
    const dow = i % 7; // 0=Sun … 6=Sat
    let w = 0.08;
    if (dow >= 1 && dow <= 5) w = 1.0; // weekdays
    else if (dow === 6) w = 0.35;
    else w = 0.22; // Sunday
    if (quietWeeks.has(week)) w *= 0.05;
    if (hotWeeks.has(week)) w *= 1.85;
    // Occasional random dead days even in busy weeks.
    if (rand() < 0.08) w *= 0.05;
    // Mid-year and late-year energy wobble.
    w *= 0.7 + 0.6 * Math.sin((week / weekCount) * Math.PI * 2 + 0.4);
    weights.push(Math.max(0.01, w));
  }

  // Pick which days are active, weighted, without a rigid pattern.
  const order = weights
    .map((w, i) => [w * (0.55 + rand()), i])
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i)
    .slice(0, activeDays);

  let remaining = total;
  let left = order.length;
  for (const i of order) {
    if (left <= 0 || remaining <= 0) break;
    const week = Math.floor(i / 7);
    const burst = hotWeeks.has(week) ? 1.35 : quietWeeks.has(week) ? 0.45 : 1;
    let count = Math.round((remaining / left) * burst * (0.55 + rand() * 1.1));
    count = Math.max(1, Math.min(maxDay, count));
    if (left === 1) count = Math.min(maxDay, Math.max(1, remaining));
    days[i] = count;
    remaining -= count;
    left -= 1;
  }

  if (remaining !== 0) {
    const hot = order.find((i) => days[i] > 0) ?? 0;
    days[hot] = Math.max(1, Math.min(maxDay, days[hot] + remaining));
  }
  // Guarantee the advertised peak shows up somewhere mid-year.
  days[Math.floor(weekCount * 0.48) * 7 + 2] = maxDay;

  const weeks = [];
  for (let w = 0; w < weekCount; w++) weeks.push(days.slice(w * 7, w * 7 + 7));
  return weeks;
}

async function fetchUser() {
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "dinonowdev-profile-cards",
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query: QUERY, variables: { login: USERNAME } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data.user;
}

function aggregate(user) {
  const langBytes = new Map();
  const langColor = new Map();
  let stars = 0;

  for (const repo of user.repositories.nodes) {
    stars += repo.stargazerCount;
    for (const edge of repo.languages.edges) {
      const name = edge.node.name;
      if (HIDE_LANGS.has(name)) continue;
      langBytes.set(name, (langBytes.get(name) || 0) + edge.size);
      langColor.set(name, edge.node.color || C.sky);
    }
  }

  const totalBytes = [...langBytes.values()].reduce((a, b) => a + b, 0) || 1;
  const languages = [...langBytes.entries()]
    .map(([name, size]) => ({
      name,
      pct: (size / totalBytes) * 100,
      color: langColor.get(name),
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);

  const cal = user.contributionsCollection.contributionCalendar;
  const weeks = cal.weeks.map((w) => w.contributionDays.map((d) => d.contributionCount));
  const maxDay = Math.max(1, ...weeks.flat());
  const activeDays = weeks.flat().filter((count) => count > 0).length;
  const averagePerActiveDay =
    activeDays > 0 ? cal.totalContributions / activeDays : 0;
  const created = new Date(user.createdAt);
  const years = Math.max(
    1,
    Math.floor((Date.now() - created.getTime()) / (365.25 * 24 * 3600 * 1000)),
  );

  const contributedRepos = (user.repositoriesContributedTo?.nodes || []).map((repo) => ({
    name: repo.nameWithOwner,
    stars: repo.stargazerCount,
    url: repo.url,
  }));
  const contributedStars = contributedRepos.reduce((sum, repo) => sum + repo.stars, 0);

  return {
    name: user.name || user.login,
    login: user.login,
    bio: (user.bio || "Front-end Developer").replace(/\r?\n/g, " ").trim(),
    location: user.location || "",
    status: user.status?.message || "",
    followers: user.followers.totalCount,
    following: user.following.totalCount,
    repos: user.repositories.totalCount,
    stars,
    contributedRepoCount: user.repositoriesContributedTo?.totalCount ?? contributedRepos.length,
    contributedStars,
    contributedRepos,
    contributions: cal.totalContributions,
    years,
    since: created.getFullYear(),
    languages,
    weeks,
    maxDay,
    activeDays,
    averagePerActiveDay,
  };
}

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmt(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function heatColor(count, max) {
  if (count <= 0) return "#1c1c22";
  const t = Math.min(1, count / max);
  if (t < 0.25) return "#115e59";
  if (t < 0.5) return "#0f766e";
  if (t < 0.75) return "#14b8a6";
  return "#5eead4";
}

function card(x, y, w, h, inner) {
  return `<g transform="translate(${x},${y})">
  <rect width="${w}" height="${h}" rx="14" fill="${C.card}" stroke="${C.line}"/>
  ${inner}
</g>`;
}

function label(text, x, y) {
  return `<text x="${x}" y="${y}" fill="${C.muted}" font-size="10" letter-spacing="0.08em" font-family="${FONT}">${esc(text)}</text>`;
}

function value(text, x, y, size = 26) {
  return `<text x="${x}" y="${y}" fill="${C.text}" font-size="${size}" font-weight="600" font-family="${FONT}">${esc(text)}</text>`;
}

/** 5×7 pixel glyphs — contribution-dot typography */
const GLYPHS = {
  0: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  3: ["01110", "10001", "00001", "00110", "00001", "10001", "01110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["01110", "10000", "11110", "10001", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  k: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00100", "00100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function glyphDots(text, cell = 8, gap = 2, tracking = 1) {
  const step = cell + gap;
  const dots = [];
  let cursor = 0;
  for (const ch of text) {
    const g = GLYPHS[ch] || GLYPHS[" "];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (g[row][col] === "1") {
          dots.push({ x: cursor + col * step, y: row * step });
        }
      }
    }
    cursor += (5 + tracking) * step;
  }
  return { dots, width: Math.max(0, cursor - tracking * step), height: 7 * step - gap };
}

/**
 * Phase 1: dots form the contribution count (e.g. "1.5k")
 * Phase 2: dots fly into the real heatmap cells
 * Then loop.
 */
function animatedContributionPanel(data, leftW) {
  const cell = 8;
  const cg = 2;
  const step = cell + cg;
  const areaW = leftW - 32;

  const targets = [];
  data.weeks.forEach((days, wi) => {
    days.forEach((count, di) => {
      targets.push({
        x: wi * step,
        y: di * step,
        count,
        color: heatColor(count, data.maxDay),
      });
    });
  });

  const heatH = 7 * step - cg;
  const heatW = data.weeks.length * step - cg;

  const word = fmt(data.contributions); // e.g. "1.5k"
  const { dots: textDots, width: textW, height: textH } = glyphDots(word, cell, cg, 1);
  const originX = Math.max(0, (Math.min(areaW, heatW) - textW) / 2);
  const originY = Math.max(0, (heatH - textH) / 2);

  // Prefer mapping text-dots onto active contribution cells first
  const destinations = [
    ...targets.filter((t) => t.count > 0),
    ...targets.filter((t) => t.count <= 0),
  ];

  const HOLD = 2.6;
  const MORPH = 2.4;
  const SETTLE = 4.2;
  const BACK = 1.6;
  const INTRO_DELAY = 11.2;
  const TOTAL = HOLD + MORPH + SETTLE + BACK;
  const tHold = +(HOLD / TOTAL).toFixed(4);
  const tMorphEnd = +((HOLD + MORPH) / TOTAL).toFixed(4);
  const tSettleEnd = +((HOLD + MORPH + SETTLE) / TOTAL).toFixed(4);
  const ease = "0 0 1 1;0.4 0 0.2 1;0 0 1 1;0.4 0 0.2 1";

  const used = new Set();
  let morphRects = "";

  textDots.forEach((dot, i) => {
    const dest = destinations[i];
    if (!dest) return;
    used.add(`${dest.x},${dest.y}`);
    const x0 = +(originX + dot.x).toFixed(1);
    const y0 = +(originY + dot.y).toFixed(1);
    const delay = +((i % 16) * 0.03).toFixed(3);
    const begin = +(INTRO_DELAY + delay).toFixed(3);

    morphRects += `<rect width="${cell}" height="${cell}" rx="2" x="${x0}" y="${y0}" fill="#5eead4">
  <animate attributeName="x" values="${x0};${x0};${dest.x};${dest.x};${x0}" keyTimes="0;${tHold};${tMorphEnd};${tSettleEnd};1" dur="${TOTAL}s" repeatCount="indefinite" begin="${begin}s" calcMode="spline" keySplines="${ease}"/>
  <animate attributeName="y" values="${y0};${y0};${dest.y};${dest.y};${y0}" keyTimes="0;${tHold};${tMorphEnd};${tSettleEnd};1" dur="${TOTAL}s" repeatCount="indefinite" begin="${begin}s" calcMode="spline" keySplines="${ease}"/>
  <animate attributeName="fill" values="#5eead4;#5eead4;${dest.color};${dest.color};#5eead4" keyTimes="0;${tHold};${tMorphEnd};${tSettleEnd};1" dur="${TOTAL}s" repeatCount="indefinite" begin="${begin}s"/>
</rect>
`;
  });

  let restRects = "";
  targets.forEach((t, i) => {
    if (used.has(`${t.x},${t.y}`)) return;
    const delay = +(INTRO_DELAY + (i % 28) * 0.01).toFixed(3);
    restRects += `<rect width="${cell}" height="${cell}" rx="2" x="${t.x}" y="${t.y}" fill="${t.color}" opacity="0">
  <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;${tHold};${tMorphEnd};${tSettleEnd};1" dur="${TOTAL}s" repeatCount="indefinite" begin="${delay}s"/>
</rect>
`;
  });

  const caption = `
  <text x="${(Math.min(areaW, heatW) / 2).toFixed(1)}" y="${heatH + 26}" text-anchor="middle" fill="${C.teal}" font-size="11" font-weight="600" font-family="${FONT}">
    <animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;${(tHold * 0.85).toFixed(4)};${tHold};${tSettleEnd};1" dur="${TOTAL}s" repeatCount="indefinite" begin="${INTRO_DELAY}s"/>
    ${esc(word)} contributions
  </text>
  <g opacity="0">
    <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;${tHold};${tMorphEnd};${tSettleEnd};1" dur="${TOTAL}s" repeatCount="indefinite" begin="${INTRO_DELAY}s"/>
    <text x="0" y="${heatH + 26}" fill="${C.faint}" font-size="10" font-family="${FONT}">Less</text>
    <rect x="30" y="${heatH + 18}" width="8" height="8" rx="2" fill="#1c1c22"/>
    <rect x="42" y="${heatH + 18}" width="8" height="8" rx="2" fill="#115e59"/>
    <rect x="54" y="${heatH + 18}" width="8" height="8" rx="2" fill="#0f766e"/>
    <rect x="66" y="${heatH + 18}" width="8" height="8" rx="2" fill="#14b8a6"/>
    <rect x="78" y="${heatH + 18}" width="8" height="8" rx="2" fill="#5eead4"/>
    <text x="92" y="${heatH + 26}" fill="${C.faint}" font-size="10" font-family="${FONT}">More</text>
    <text x="${Math.min(heatW, areaW)}" y="${heatH + 26}" text-anchor="end" fill="${C.faint}" font-size="10" font-family="${FONT}">last 12 months</text>
  </g>`;

  const insightsY = heatH + 54;
  const insightW = (areaW - 16) / 3;
  const insights = `
  <g transform="translate(0,${insightsY})">
    <line x1="0" y1="-12" x2="${areaW}" y2="-12" stroke="${C.line}"/>
    ${label("ACTIVE DAYS", 0, 8)}
    ${value(data.activeDays, 0, 34, 20)}
    ${label("BEST DAY", insightW, 8)}
    ${value(data.maxDay, insightW, 34, 20)}
    ${label("AVG / ACTIVE DAY", insightW * 2, 8)}
    ${value(data.averagePerActiveDay.toFixed(1), insightW * 2, 34, 20)}
  </g>`;

  return `<g transform="translate(16,44)">${morphRects}${restRects}${caption}${insights}</g>`;
}

/**
 * Both curtain characters share one local coordinate system: the origin sits
 * between their feet on the floor, and the raised hand lands on the cord.
 */
const ARM_REST = "M19,-72 C32,-86 42,-104 46,-116";
const ARM_PULL = "M19,-64 C30,-70 40,-76 44,-82";

/** Swaps the resting arms for the raised, cord-gripping pose. */
function armSwap(A, shown) {
  const { DUR, K } = A;
  const from = shown ? 0 : 1;
  const to = shown ? 1 : 0;
  return `<animate attributeName="opacity" values="${from};${from};${to};${to};${from};${from}" keyTimes="0;${K.grabbed - 0.02};${K.grabbed};${K.letGo};${K.letGo + 0.02};1" dur="${DUR}s" fill="freeze"/>`;
}

/**
 * Drives the raised arm and hand down as the cord is hauled toward the floor.
 * `edge` draws a wider stroke underneath so the limb reads against a same
 * coloured torso. Optional rest/pull coords override the default reach so
 * scaled heroes (Batman) still land on the shared cord.
 */
function pullArm(A, {
  arm,
  hand,
  edge,
  restX = 46,
  restY = -116,
  pullX = 44,
  pullY = -82,
  restD = ARM_REST,
  pullD = ARM_PULL,
}) {
  const { DUR, K } = A;
  const times = `0;${K.grabbed};${K.yankEnd};${K.released};${K.letGo};1`;
  const splines = "0 0 1 1;0.4 0 0.2 1;0 0 1 1;0.2 0.9 0.3 1;0 0 1 1";
  const morph = `<animate attributeName="d" values="${restD};${restD};${pullD};${pullD};${restD};${restD}" keyTimes="${times}" dur="${DUR}s" fill="freeze" calcMode="spline" keySplines="${splines}"/>`;
  const limb = (color, w) =>
    `<path d="${restD}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round">${morph}</path>`;

  return `${edge ? limb(edge, 15) : ""}
          ${limb(arm, 12)}
          <circle cx="${restX}" cy="${restY}" r="9" fill="${hand}"${edge ? ` stroke="${edge}" stroke-width="1.6"` : ""}>
            <animate attributeName="cx" values="${restX};${restX};${pullX};${pullX};${restX};${restX}" keyTimes="${times}" dur="${DUR}s" fill="freeze"/>
            <animate attributeName="cy" values="${restY};${restY};${pullY};${pullY};${restY};${restY}" keyTimes="${times}" dur="${DUR}s" fill="freeze" calcMode="spline" keySplines="${splines}"/>
          </circle>`;
}

/** Black cat with golden eyes, sitting on the floor. */
function heroCat(A) {
  const { DUR, lookTimes, headTurn, eyeShift } = A;
  return `
        <g>
          <animateTransform attributeName="transform" type="rotate" values="0 -22 -24;7 -22 -24;-6 -22 -24;0 -22 -24" keyTimes="0;0.33;0.7;1" dur="2.4s" repeatCount="indefinite"/>
          <path d="M-22,-24 C-52,-26 -66,-58 -46,-76" fill="none" stroke="#17171a" stroke-width="13" stroke-linecap="round"/>
          <circle cx="-46" cy="-76" r="7" fill="#26262c"/>
        </g>

        <ellipse cx="-17" cy="-8" rx="15" ry="9" fill="#17171a" stroke="#43434e" stroke-width="1.4"/>
        <ellipse cx="17" cy="-8" rx="15" ry="9" fill="#17171a" stroke="#43434e" stroke-width="1.4"/>
        <path d="M-26,-28 C-32,-64 -24,-90 0,-90 C24,-90 32,-64 26,-28 C22,-14 -22,-14 -26,-28 Z" fill="#17171a" stroke="#43434e" stroke-width="1.4"/>
        <ellipse cx="0" cy="-44" rx="14" ry="22" fill="#24242a"/>

        <g>
          ${armSwap(A, false)}
          <path d="M-19,-70 C-27,-56 -27,-40 -23,-30" fill="none" stroke="#17171a" stroke-width="12" stroke-linecap="round"/>
          <path d="M19,-70 C27,-56 27,-40 23,-30" fill="none" stroke="#17171a" stroke-width="12" stroke-linecap="round"/>
          <ellipse cx="-23" cy="-26" rx="10" ry="7" fill="#1f1f25"/>
          <ellipse cx="23" cy="-26" rx="10" ry="7" fill="#1f1f25"/>
        </g>

        <g opacity="0">
          ${armSwap(A, true)}
          <path d="M-19,-70 C-27,-56 -27,-40 -23,-30" fill="none" stroke="#17171a" stroke-width="12" stroke-linecap="round"/>
          <ellipse cx="-23" cy="-26" rx="10" ry="7" fill="#1f1f25"/>
          ${pullArm(A, { arm: "#17171a", hand: "#1f1f25" })}
        </g>

        <g>
          <animateTransform attributeName="transform" type="rotate" values="${headTurn}" keyTimes="${lookTimes}" dur="${DUR}s" fill="freeze"/>

          <g>
            <animateTransform attributeName="transform" type="rotate" values="0 -25 -126;0 -25 -126;-11 -25 -126;4 -25 -126;0 -25 -126" keyTimes="0;0.86;0.9;0.94;1" dur="3.7s" repeatCount="indefinite"/>
            <path d="M-25,-126 L-31,-153 L-6,-136 Z" fill="#17171a"/>
            <path d="M-23,-129 L-26,-146 L-12,-136 Z" fill="#d98a86"/>
          </g>
          <path d="M25,-126 L31,-153 L6,-136 Z" fill="#17171a"/>
          <path d="M23,-129 L26,-146 L12,-136 Z" fill="#d98a86"/>

          <circle cx="0" cy="-110" r="28" fill="#17171a" stroke="#43434e" stroke-width="1.4"/>
          <ellipse cx="-9" cy="-97" rx="11" ry="8" fill="#1f1f25"/>
          <ellipse cx="9" cy="-97" rx="11" ry="8" fill="#1f1f25"/>

          <g stroke="#efe6cf" stroke-width="1.3" opacity="0.75">
            <line x1="-16" y1="-102" x2="-44" y2="-108"/>
            <line x1="-16" y1="-98" x2="-46" y2="-97"/>
            <line x1="-16" y1="-94" x2="-44" y2="-87"/>
            <line x1="16" y1="-102" x2="44" y2="-108"/>
            <line x1="16" y1="-98" x2="46" y2="-97"/>
            <line x1="16" y1="-94" x2="44" y2="-87"/>
          </g>

          <ellipse cx="-11" cy="-114" rx="8.5" ry="10" fill="#f8dc62"/>
          <ellipse cx="11" cy="-114" rx="8.5" ry="10" fill="#f8dc62"/>
          <g>
            <animateTransform attributeName="transform" type="translate" values="${eyeShift}" keyTimes="${lookTimes}" dur="${DUR}s" fill="freeze"/>
            <ellipse cx="-11" cy="-114" rx="3" ry="7.5" fill="#17171a"/>
            <ellipse cx="11" cy="-114" rx="3" ry="7.5" fill="#17171a"/>
            <circle cx="-13.5" cy="-118" r="1.8" fill="#fffdf2"/>
            <circle cx="8.5" cy="-118" r="1.8" fill="#fffdf2"/>
          </g>

          <path d="M-4,-101 L4,-101 L0,-96 Z" fill="#e0a3a3"/>
          <path d="M0,-96 Q-5,-91 -10,-94" fill="none" stroke="#9a9aa4" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M0,-96 Q5,-91 10,-94" fill="none" stroke="#9a9aa4" stroke-width="1.4" stroke-linecap="round"/>

          <rect x="-26" y="-132" width="52" height="0" fill="#17171a">
            <animate attributeName="height" values="0;0;24;0;0" keyTimes="0;0.9;0.94;0.98;1" dur="4.1s" repeatCount="indefinite"/>
          </rect>
        </g>`;
}

/**
 * Classic comic Spider-Man mask: oval head + large white almond lenses with
 * a thick black rim and a sharp outer corner (matches the reference plate).
 */
const SPIDEY_MASK =
  "M0,-162 C26,-162 38,-142 36,-116 C34,-96 28,-80 16,-70 Q0,-60 -16,-70 C-28,-80 -34,-96 -36,-116 C-38,-142 -26,-162 0,-162 Z";
// Black rim — classic Spidey: big almond, brow dips in, sharp outer tip.
const SPIDEY_LENS_R =
  "M1,-122 C2,-142 14,-156 28,-153 C37,-150 39,-138 36,-124 C32,-110 20,-102 8,-105 C3,-107 0,-114 1,-122 Z";
const SPIDEY_LENS_L =
  "M-1,-122 C-2,-142 -14,-156 -28,-153 C-37,-150 -39,-138 -36,-124 C-32,-110 -20,-102 -8,-105 C-3,-107 0,-114 -1,-122 Z";
// White inset leaves a bold comic rim (~3–4px) all the way around.
const SPIDEY_WHITE_R =
  "M6,-123 C8,-139 16,-150 26,-148 C33,-146 34,-136 31,-125 C28,-114 19,-108 10,-109 C7,-110 5,-116 6,-123 Z";
const SPIDEY_WHITE_L =
  "M-6,-123 C-8,-139 -16,-150 -26,-148 C-33,-146 -34,-136 -31,-125 C-28,-114 -19,-108 -10,-109 C-7,-110 -5,-116 -6,-123 Z";

/** One thick-stroked capsule limb, drawn twice (dark outline, then color) for a clean edge. */
function limb(d, color, ink, w) {
  return `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${w + 3}" stroke-linecap="round"/>
          <path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
}

/** Simple round mitten fist — reads far cleaner at this size than fingers. */
function fist(cx, cy, color, ink) {
  return `<circle cx="${cx}" cy="${cy}" r="8.5" fill="${color}" stroke="${ink}" stroke-width="2"/>`;
}

/**
 * A classic spider web: straight spokes from a centre plus concentric rings
 * of arcs that sag toward the centre — same construction as the tie print.
 */
function spiderWeb(cx, cy, r, { a0 = 0, a1 = 360, spokes = 8, rings = 4, color = "#5e0a12", width = 1.5, opacity = 0.55 } = {}) {
  const pt = (deg, rr) => {
    const a = (deg * Math.PI) / 180;
    return [+(cx + Math.cos(a) * rr).toFixed(1), +(cy + Math.sin(a) * rr).toFixed(1)];
  };
  const step = (a1 - a0) / spokes;
  const angles = Array.from({ length: spokes + 1 }, (_, i) => a0 + i * step);
  let d = "";
  for (const a of angles) {
    const [x, y] = pt(a, r);
    d += `M${cx},${cy} L${x},${y} `;
  }
  for (let k = 1; k <= rings; k++) {
    const rr = r * (0.28 + (0.72 * k) / rings);
    for (let i = 0; i < spokes; i++) {
      const [xa, ya] = pt(angles[i], rr);
      const [xm, ym] = pt(angles[i] + step / 2, rr * 0.87);
      const [xb, yb] = pt(angles[i + 1], rr);
      d += `M${xa},${ya} Q${xm},${ym} ${xb},${yb} `;
    }
  }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" opacity="${opacity}" stroke-linecap="round"/>`;
}

/** Chibi cartoon Spider-Man with blocky, LEGO-inspired limbs; boots planted on the floor. */
function heroSpiderMan(A) {
  const { DUR, K, lookTimes, headTurn, eyeShift } = A;
  const RED = "#e0262d";
  const BLUE = "#1c2f8f";
  const INK = "#101018";
  const armL = "M-24,-78 C-36,-66 -39,-52 -35,-42";
  const armR = "M24,-78 C36,-66 39,-52 35,-42";
  // Aim toward the camera (up-left), then switch to a vertical climb pose.
  const armAim = "M-18,-78 C-30,-96 -34,-116 -28,-128";
  const armWeb = "M22,-78 C34,-100 38,-132 34,-156";

  return `
        <rect x="-30" y="-20" width="25" height="20" rx="5" fill="${RED}" stroke="${INK}" stroke-width="1.8"/>
        <rect x="5" y="-20" width="25" height="20" rx="5" fill="${RED}" stroke="${INK}" stroke-width="1.8"/>
        <rect x="-23" y="-53" width="17" height="36" rx="6" fill="${BLUE}" stroke="${INK}" stroke-width="1.8"/>
        <rect x="6" y="-53" width="17" height="36" rx="6" fill="${BLUE}" stroke="${INK}" stroke-width="1.8"/>
        <rect x="-16" y="-58" width="32" height="14" rx="6" fill="${BLUE}" stroke="${INK}" stroke-width="1.8"/>

        <path d="M-28,-50 C-33,-76 -24,-94 0,-94 C24,-94 33,-76 28,-50 C19,-41 -19,-41 -28,-50 Z" fill="${RED}" stroke="${INK}" stroke-width="1.8"/>
        <path d="M-28,-52 C-25,-59 25,-59 28,-52 C19,-41 -19,-41 -28,-52 Z" fill="${BLUE}" stroke="${INK}" stroke-width="1.4"/>
        <g fill="none" stroke="${INK}" stroke-width="0.9" opacity="0.5">
          <path d="M-16,-90 C-12,-76 -13,-63 -17,-53"/>
          <path d="M16,-90 C12,-76 13,-63 17,-53"/>
          <path d="M-26,-79 C-11,-74 11,-74 26,-79"/>
          <path d="M-28,-64 C-12,-59 12,-59 28,-64"/>
        </g>

        <!-- Left arm: rests at his side, then aims at the camera, then drops while climbing -->
        <g>
          <animate attributeName="opacity" values="1;1;0;0;1;1" keyTimes="0;${K.camAim - 0.02};${K.camAim};${K.lookBEnd};${K.lookBEnd + 0.02};1" dur="${DUR}s" fill="freeze"/>
          ${limb(armL, RED, INK, 13)}
          ${fist(-35, -40, RED, INK)}
        </g>

        <!-- Right arm resting: hidden while pulling the cord and during the camera/climb beat -->
        <g>
          <animate attributeName="opacity" values="1;1;0;0;1;1;0;0" keyTimes="0;${K.grabbed - 0.02};${K.grabbed};${K.letGo};${K.letGo + 0.02};${K.camAim - 0.02};${K.camAim};1" dur="${DUR}s" fill="freeze"/>
          ${limb(armR, RED, INK, 13)}
          ${fist(35, -40, RED, INK)}
        </g>

        <!-- Right arm hauling the cord -->
        <g opacity="0">
          ${armSwap(A, true)}
          ${pullArm(A, { arm: RED, hand: RED, edge: INK })}
        </g>

        <!-- Left arm aiming a web at the camera -->
        <g opacity="0">
          <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${K.camAim - 0.02};${K.camAim};${K.lookBEnd};${K.lookBEnd + 0.02};1" dur="${DUR}s" fill="freeze"/>
          ${limb(armAim, RED, INK, 13)}
          ${fist(-28, -128, RED, INK)}
        </g>

        <g>
          <animateTransform attributeName="transform" type="rotate" values="${headTurn}" keyTimes="${lookTimes}" dur="${DUR}s" fill="freeze"/>

          <path d="${SPIDEY_MASK}" fill="${RED}" stroke="${INK}" stroke-width="2.2"/>

          <!-- Radial web from the nose bridge (classic comic construction) -->
          <g clip-path="url(#spidey-mask-clip)">
            ${spiderWeb(0, -126, 54, { spokes: 14, rings: 5, color: INK, width: 1.05, opacity: 0.78 })}
          </g>

          <!-- Classic white lenses with thick black rims -->
          <g>
            <animateTransform attributeName="transform" type="translate" values="${eyeShift}" keyTimes="${lookTimes}" dur="${DUR}s" fill="freeze"/>
            <path d="${SPIDEY_LENS_L}" fill="${INK}"/>
            <path d="${SPIDEY_LENS_R}" fill="${INK}"/>
            <path d="${SPIDEY_WHITE_L}" fill="#ffffff"/>
            <path d="${SPIDEY_WHITE_R}" fill="#ffffff"/>
            <g clip-path="url(#spidey-lens-clip)">
              <rect x="-40" y="-155" width="80" height="0" fill="${RED}" opacity="0.35">
                <animate attributeName="height" values="0;0;14;0;0" keyTimes="0;0.9;0.94;0.98;1" dur="4.1s" repeatCount="indefinite"/>
              </rect>
            </g>
          </g>
        </g>

        <!-- Right arm thrown up for the climb (drawn over the head) -->
        <g opacity="0">
          <animate attributeName="opacity" values="0;0;1;1" keyTimes="0;${K.lookBEnd - 0.02};${K.lookBEnd};1" dur="${DUR}s" fill="freeze"/>
          ${limb(armWeb, RED, INK, 13)}
          ${fist(34, -158, RED, INK)}
        </g>`;
}

/** Classic 1989-style bat emblem (for chest + Bat-Signal). */
const BAT_EMBLEM =
  "M0,-4 L-5,-15 L-6,-5 C-15,-11 -27,-13 -39,-9 C-47,-7 -53,-2 -58,4 L-45,1 C-46,7 -43,12 -37,15 C-33,11 -28,10 -23,13 C-22,18 -17,22 -11,23 C-8,18 -4,15 0,21 C4,15 8,18 11,23 C17,22 22,18 23,13 C28,10 33,11 37,15 C43,12 46,7 45,1 L58,4 C53,-2 47,-7 39,-9 C27,-13 15,-11 6,-5 L5,-15 Z";

/** Tiny flying-bat silhouette for curtain + exit swarm. */
const BAT_FLY =
  "M0,0 C-4,-5 -10,-4 -13,2 C-9,0 -5,3 -2,1 C-3,5 -1,6 0,4 C1,6 3,5 2,1 C5,3 9,0 13,2 C10,-4 4,-5 0,0 Z";

/** Chibi Batman with a classic cowl: tall ears, white slits, exposed jaw. */
function heroBatman(A) {
  const { DUR, K, lookTimes, headTurn, eyeShift } = A;
  const BLACK = "#0e1016";
  const GRAY = "#4a4f59";
  const SKIN = "#d4a574";
  const YELLOW = "#f5d76e";
  const INK = "#07080c";
  const armL = "M-29,-89 C-43,-79 -47,-58 -38,-42";
  const armR = "M29,-89 C43,-79 47,-58 38,-42";
  // Batman is drawn at scale(1.35) and stands farther left for the Batmobile,
  // so the pull reach is compensated back into local (pre-scale) space.
  // Target a few px past the cord so the fist overlaps the pull-handle.
  const BAT_SCALE = 1.35;
  const batRestX = +(88 / BAT_SCALE).toFixed(2);
  const batRestY = +(-116 / BAT_SCALE).toFixed(2);
  const batPullX = +(86 / BAT_SCALE).toFixed(2);
  const batPullY = +(-82 / BAT_SCALE).toFixed(2);
  const batArmRest = `M29,-89 C46,-96 58,-102 ${batRestX},${batRestY}`;
  const batArmPull = `M29,-70 C44,-66 56,-62 ${batPullX},${batPullY}`;

  return `
        <g transform="scale(${BAT_SCALE})">
        <animate attributeName="opacity" values="1;1;0;0" keyTimes="0;${K.board};${+(K.board + 0.03).toFixed(4)};1" dur="${DUR}s" fill="freeze"/>
        <!-- Two hanging cape panels leave the suit visible, like the reference -->
        <path d="M-26,-100 C-44,-101 -56,-90 -61,-74 L-75,7 L-57,-8 L-45,8 L-36,-20 L-30,-54 L-20,-97 Z" fill="${BLACK}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M26,-100 C44,-101 56,-90 61,-74 L75,7 L57,-8 L45,8 L36,-20 L30,-54 L20,-97 Z" fill="${BLACK}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M-48,-89 L-57,-12 M48,-89 L57,-12" fill="none" stroke="#242936" stroke-width="1.4" opacity="0.9"/>

        <!-- Gray legs, black trunks and substantial boots -->
        <path d="M-29,-30 L-3,-30 L-2,-7 L-17,-3 L-31,-13 Z" fill="${GRAY}" stroke="${INK}" stroke-width="1.8"/>
        <path d="M29,-30 L3,-30 L2,-7 L17,-3 L31,-13 Z" fill="${GRAY}" stroke="${INK}" stroke-width="1.8"/>
        <path d="M-27,-17 L-4,-14 L-4,0 L-32,0 Q-34,-10 -27,-17 Z" fill="${BLACK}" stroke="${INK}" stroke-width="1.8"/>
        <path d="M27,-17 L4,-14 L4,0 L32,0 Q34,-10 27,-17 Z" fill="${BLACK}" stroke="${INK}" stroke-width="1.8"/>
        <path d="M-28,-36 L28,-36 L20,-18 L0,-12 L-20,-18 Z" fill="${BLACK}" stroke="${INK}" stroke-width="1.8"/>

        <!-- Broad gray torso with classic paneling -->
        <path d="M-32,-101 Q0,-112 32,-101 L42,-76 L35,-47 L26,-36 L-26,-36 L-35,-47 L-42,-76 Z" fill="${GRAY}" stroke="${INK}" stroke-width="2"/>
        <path d="M0,-103 L0,-48 M-32,-83 Q0,-69 32,-83" fill="none" stroke="#3a4050" stroke-width="1.3" opacity="0.9"/>
        <ellipse cx="0" cy="-76" rx="18" ry="13" fill="${YELLOW}" stroke="${INK}" stroke-width="1.6"/>
        <path d="${BAT_EMBLEM}" fill="${INK}" transform="translate(0,-76) scale(0.27)"/>
        <!-- Segmented yellow utility belt -->
        <path d="M-34,-48 L34,-48 L32,-35 L-32,-35 Z" fill="${YELLOW}" stroke="${INK}" stroke-width="1.8"/>
        <rect x="-8" y="-47" width="16" height="11" rx="2" fill="#e4b72f" stroke="${INK}" stroke-width="1.3"/>
        <path d="M-23,-47 L-22,-36 M-13,-47 L-13,-36 M13,-47 L13,-36 M23,-47 L22,-36" stroke="${INK}" stroke-width="1.2"/>

        <!-- Gray shoulders under black gauntlets -->
        <path d="M-29,-91 C-43,-87 -49,-75 -46,-62 M29,-91 C43,-87 49,-75 46,-62" fill="none" stroke="${INK}" stroke-width="20" stroke-linecap="round"/>
        <path d="M-29,-91 C-43,-87 -49,-75 -46,-62 M29,-91 C43,-87 49,-75 46,-62" fill="none" stroke="${GRAY}" stroke-width="16" stroke-linecap="round"/>

        <g>
          ${armSwap(A, false)}
          ${limb(armL, BLACK, INK, 13)}
          ${limb(armR, BLACK, INK, 13)}
          <path d="M-43,-61 L-54,-68 L-48,-55 Z M43,-61 L54,-68 L48,-55 Z" fill="${BLACK}" stroke="${INK}" stroke-width="1.2"/>
          ${fist(-38, -40, BLACK, INK)}
          ${fist(38, -40, BLACK, INK)}
        </g>

        <g opacity="0">
          ${armSwap(A, true)}
          ${limb(armL, BLACK, INK, 13)}
          ${fist(-38, -40, BLACK, INK)}
          ${pullArm(A, {
            arm: BLACK,
            hand: BLACK,
            edge: INK,
            restX: batRestX,
            restY: batRestY,
            pullX: batPullX,
            pullY: batPullY,
            restD: batArmRest,
            pullD: batArmPull,
          })}
        </g>

        <!-- Lift the cowl clear of the chest while preserving the approved face -->
        <g transform="translate(0,-61) scale(0.65)">
          <g>
            <animateTransform attributeName="transform" type="rotate" values="${headTurn}" keyTimes="${lookTimes}" dur="${DUR}s" fill="freeze"/>

          <!-- Broad classic cowl with integrated pointed ears -->
          <path d="M-39,-88
            C-43,-112 -42,-139 -33,-157
            L-28,-204 L-11,-165
            Q0,-170 11,-165
            L28,-204 L33,-157
            C42,-139 43,-112 39,-88
            L33,-63 Q24,-54 15,-50
            L14,-43 Q0,-36 -14,-43
            L-15,-50 Q-24,-54 -33,-63 Z"
            fill="${BLACK}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
          <!-- Ear insets and forehead contour -->
          <path d="M-27,-194 L-21,-164 L-12,-158" fill="none" stroke="#242936" stroke-width="1.8"/>
          <path d="M27,-194 L21,-164 L12,-158" fill="none" stroke="#242936" stroke-width="1.8"/>
          <path d="M-21,-151 Q0,-158 21,-151" fill="none" stroke="#242936" stroke-width="1.5" stroke-linecap="round"/>
          <!-- Wide, sharply angled white eye slits -->
          <g>
            <animateTransform attributeName="transform" type="translate" values="${eyeShift}" keyTimes="${lookTimes}" dur="${DUR}s" fill="freeze"/>
            <path d="M-5,-121 L-33,-134 Q-27,-120 -18,-115 Q-10,-115 -5,-121 Z" fill="#f4f7ff" stroke="${INK}" stroke-width="1.2"/>
            <path d="M5,-121 L33,-134 Q27,-120 18,-115 Q10,-115 5,-121 Z" fill="#f4f7ff" stroke="${INK}" stroke-width="1.2"/>
          </g>
          <!-- Large exposed jaw window and angular nose -->
          <path d="M-31,-104
            C-25,-96 -23,-87 -21,-76
            L-14,-58 Q0,-50 14,-58
            L21,-76 C23,-87 25,-96 31,-104
            Q16,-96 0,-92 Q-16,-96 -31,-104 Z"
            fill="${SKIN}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
          <path d="M0,-125 L-7,-101 L0,-94 L7,-101 Z" fill="#181c26" stroke="${INK}" stroke-width="1.2"/>
          <path d="M-10,-72 Q-4,-77 0,-74 Q4,-77 10,-72" fill="none" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>
          <path d="M-7,-66 Q0,-64 7,-66" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>
          <!-- Neck folds into shoulders -->
          <path d="M-20,-52 C-28,-48 -32,-40 -30,-34" fill="none" stroke="#1c2030" stroke-width="1.3"/>
          <path d="M20,-52 C28,-48 32,-40 30,-34" fill="none" stroke="#1c2030" stroke-width="1.3"/>
          </g>
        </g>
        </g>`;
}

const CURTAIN_THEMES = {
  cat: {
    fabric: ["#f8dc62", "#e8bd35", "#d7a824", "#f2ca45"],
    slat: "#9a7419",
    plate: { fill: "#f8dc62", stroke: "#171719", text: "#171719", sub: "#725718" },
    bar: "#171719",
    barStroke: "#3a3020",
    cord: "#332b1a",
    handle: "#171719",
    handleDot: "#f8dc62",
    glow: "#f8dc62",
    sparkle: "#f8dc62",
    exit: "slideDown",
    hero: heroCat,
    defs: `
    <g id="cat-face">
      <path d="M-20,-8 L-16,-27 L-5,-18 Q0,-21 5,-18 L16,-27 L20,-8 Q21,9 0,17 Q-21,9 -20,-8Z" fill="#171719"/>
      <ellipse cx="-7" cy="-2" rx="5" ry="7" fill="#fff8dc"/>
      <ellipse cx="7" cy="-2" rx="5" ry="7" fill="#fff8dc"/>
      <circle cx="-6" cy="0" r="2.4" fill="#171719"/>
      <circle cx="8" cy="0" r="2.4" fill="#171719"/>
      <path d="M-3,8 Q0,11 3,8" fill="none" stroke="#fff8dc" stroke-width="1.5" stroke-linecap="round"/>
    </g>
    <pattern id="curtain-print" width="240" height="180" patternUnits="userSpaceOnUse" patternTransform="rotate(-2)">
      <use href="#cat-face" transform="translate(52 48) rotate(-8) scale(1.05)"/>
      <use href="#cat-face" transform="translate(174 112) rotate(11) scale(0.78)"/>
      <circle cx="12" cy="18" r="1" fill="#b98919" opacity="0.45"/>
      <circle cx="120" cy="80" r="1.2" fill="#fff0a8" opacity="0.35"/>
      <circle cx="220" cy="154" r="1" fill="#b98919" opacity="0.45"/>
    </pattern>`,
  },

  spiderman: {
    fabric: ["#e5323c", "#c1121f", "#9d0d18", "#d92534"],
    slat: "#7d0f19",
    plate: { fill: "#16205c", stroke: "#0a0e2b", text: "#ffffff", sub: "#a9b6ef" },
    bar: "#0f1330",
    barStroke: "#2a3468",
    cord: "#2a3468",
    handle: "#0f1330",
    handleDot: "#e5323c",
    glow: "#ff5964",
    sparkle: "#ffd9dc",
    exit: "webUp",
    hero: heroSpiderMan,
    defs: `
    <clipPath id="spidey-mask-clip">
      <path d="${SPIDEY_MASK}"/>
    </clipPath>
    <clipPath id="spidey-lens-clip">
      <path d="${SPIDEY_WHITE_L}"/>
      <path d="${SPIDEY_WHITE_R}"/>
    </clipPath>

    <!-- Curtain print: sleek eight-legged spider silhouette. -->
    <g id="spider-mark">
      <g fill="none" stroke="#171719" stroke-width="1.8" stroke-linecap="round">
        <path d="M-3,-3 C-11,-8 -18,-8 -24,-15"/>
        <path d="M-4,1 C-13,0 -19,3 -25,0"/>
        <path d="M-4,5 C-12,8 -16,13 -22,14"/>
        <path d="M-2,9 C-8,15 -10,20 -14,25"/>
        <path d="M3,-3 C11,-8 18,-8 24,-15"/>
        <path d="M4,1 C13,0 19,3 25,0"/>
        <path d="M4,5 C12,8 16,13 22,14"/>
        <path d="M2,9 C8,15 10,20 14,25"/>
      </g>
      <ellipse cx="0" cy="5" rx="8" ry="11" fill="#171719"/>
      <path d="M-6,-1 Q0,3 6,-1" fill="none" stroke="#3a3a42" stroke-width="1"/>
      <circle cx="0" cy="-7" r="6" fill="#171719"/>
      <circle cx="-2.4" cy="-8.4" r="1.5" fill="#fff3f4"/>
      <circle cx="2.4" cy="-8.4" r="1.5" fill="#fff3f4"/>
      <circle cx="-2.4" cy="-8.4" r="0.6" fill="#171719"/>
      <circle cx="2.4" cy="-8.4" r="0.6" fill="#171719"/>
    </g>

    <pattern id="curtain-print" width="230" height="190" patternUnits="userSpaceOnUse" patternTransform="rotate(-3)">
      <use href="#spider-mark" transform="translate(46 44) rotate(-10) scale(1.05)"/>
      <use href="#spider-mark" transform="translate(196 150) rotate(14) scale(0.62)" opacity="0.85"/>
      <use href="#spider-mark" transform="translate(132 108) rotate(24) scale(0.45)" opacity="0.7"/>
    </pattern>`,
    // One big corner web + one full web, drawn on the fabric like the tie print.
    curtainExtra: (w, h) => `
      ${spiderWeb(0, 14, 250, { a0: 4, a1: 88, spokes: 6, rings: 5, color: "#5e0a12", width: 1.7, opacity: 0.6 })}
      ${spiderWeb(w - 178, 128, 105, { spokes: 10, rings: 4, color: "#5e0a12", width: 1.4, opacity: 0.5 })}
      <line x1="146" y1="128" x2="146" y2="206" stroke="#5e0a12" stroke-width="1.4" opacity="0.6"/>
      <use href="#spider-mark" transform="translate(146 218) scale(1.15)"/>`,
  },

  batman: {
    fabric: ["#0b1228", "#101a36", "#070d1c", "#162044"],
    slat: "#1a2748",
    plate: { fill: "#f5d76e", stroke: "#12141c", text: "#12141c", sub: "#5a4a18" },
    bar: "#0a0c14",
    barStroke: "#2a3148",
    cord: "#3a4258",
    handle: "#0a0c14",
    handleDot: "#f5d76e",
    glow: "#f5d76e",
    sparkle: "#ffe9a0",
    exit: "batmobile",
    hero: heroBatman,
    defs: `
    <radialGradient id="bat-signal-glow" cx="0.5" cy="0.45" r="0.55">
      <stop offset="0" stop-color="#fff6c8" stop-opacity="0.95"/>
      <stop offset="0.35" stop-color="#f5d76e" stop-opacity="0.75"/>
      <stop offset="0.7" stop-color="#c9a227" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#c9a227" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bat-beam" x1="0.5" y1="1" x2="0.5" y2="0">
      <stop offset="0" stop-color="#f5d76e" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#f5d76e" stop-opacity="0"/>
    </linearGradient>
    <g id="bat-emblem">
      <ellipse cx="0" cy="0" rx="46" ry="26" fill="#f5d76e"/>
      <ellipse cx="0" cy="0" rx="46" ry="26" fill="none" stroke="#0a0c14" stroke-width="3"/>
      <path d="${BAT_EMBLEM}" fill="#0a0c14" transform="translate(0,-1) scale(0.72)"/>
    </g>
    <g id="bat-fly">
      <path d="${BAT_FLY}" fill="#0a0c14"/>
    </g>
    <!-- Stars + scattered bats on the night curtain -->
    <pattern id="curtain-print" width="220" height="170" patternUnits="userSpaceOnUse">
      <circle cx="24" cy="30" r="1.1" fill="#dce6ff" opacity="0.55"/>
      <circle cx="110" cy="18" r="0.8" fill="#dce6ff" opacity="0.4"/>
      <circle cx="168" cy="70" r="1.2" fill="#dce6ff" opacity="0.5"/>
      <circle cx="70" cy="100" r="0.7" fill="#dce6ff" opacity="0.35"/>
      <circle cx="150" cy="130" r="1" fill="#dce6ff" opacity="0.45"/>
      <circle cx="40" cy="140" r="0.6" fill="#dce6ff" opacity="0.3"/>
      <use href="#bat-fly" transform="translate(48 55) rotate(-18) scale(1.1)" opacity="0.55"/>
      <use href="#bat-fly" transform="translate(170 40) rotate(22) scale(0.85)" opacity="0.45"/>
      <use href="#bat-fly" transform="translate(120 145) rotate(-8) scale(0.7)" opacity="0.4"/>
    </pattern>`,
    curtainExtra: (w, h) => {
      const cx = w * 0.5;
      const signalY = h * 0.21;
      return `
      <!-- Searchlight cone from the ground up into the night sky -->
      <path d="M${cx - 28},${h - 8} L${cx - 94},${signalY + 59} L${cx + 94},${signalY + 59} L${cx + 28},${h - 8} Z" fill="url(#bat-beam)" opacity="0.9"/>
      <ellipse cx="${cx}" cy="${signalY}" rx="112" ry="80" fill="url(#bat-signal-glow)"/>
      <!-- Cloud wisps stay behind the signal so the emblem remains readable -->
      <ellipse cx="${cx - 150}" cy="${signalY + 25}" rx="58" ry="20" fill="#1a2748" opacity="0.4"/>
      <ellipse cx="${cx + 155}" cy="${signalY + 111}" rx="64" ry="22" fill="#1a2748" opacity="0.35"/>
      <ellipse cx="${cx + 40}" cy="${signalY + 5}" rx="40" ry="14" fill="#1a2748" opacity="0.25"/>
      <!-- Classic yellow-oval Bat-Signal -->
      <use href="#bat-emblem" transform="translate(${cx} ${signalY}) scale(2.3)"/>
      <!-- Extra bats around the signal -->
      <use href="#bat-fly" transform="translate(${cx - 210} ${signalY + 115}) rotate(-25) scale(2.2)" opacity="0.7"/>
      <use href="#bat-fly" transform="translate(${cx + 200} ${signalY + 55}) rotate(18) scale(1.9)" opacity="0.6"/>
      <use href="#bat-fly" transform="translate(${cx - 80} ${signalY + 185}) rotate(10) scale(1.5)" opacity="0.55"/>
      <use href="#bat-fly" transform="translate(${cx + 110} ${signalY + 170}) rotate(-12) scale(1.7)" opacity="0.6"/>
      <use href="#bat-fly" transform="translate(${cx - 170} ${signalY - 5}) rotate(30) scale(1.3)" opacity="0.5"/>
      <use href="#bat-fly" transform="translate(${cx + 160} ${signalY + 145}) rotate(-20) scale(1.4)" opacity="0.55"/>`;
    },
  },

};

/**
 * Resolve the curtain theme from CARD_THEME. Anything unset, empty or
 * "random" rolls the dice, so the profile alternates between characters.
 */
function pickTheme() {
  const names = Object.keys(CURTAIN_THEMES);
  const want = (process.env.CARD_THEME || "").trim().toLowerCase();
  if (want && want !== "random") {
    if (CURTAIN_THEMES[want]) return want;
    console.warn(`Unknown CARD_THEME "${want}". Valid values: ${names.join(", ")}, random.`);
  }
  return names[Math.floor(Math.random() * names.length)];
}

/**
 * A one-shot roller blind intro. The pull tab drops first, then the shutter
 * retracts upward to reveal the dashboard. `fill="freeze"` keeps it open.
 */
function openingShutter(width, height, themeName) {
  const theme = CURTAIN_THEMES[themeName] ?? CURTAIN_THEMES.cat;
  const slatHeight = 22;
  let slats = "";
  for (let y = slatHeight; y < height; y += slatHeight) {
    slats += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${theme.slat}" stroke-width="1" opacity="0.42"/>`;
  }

  // Walk in → pull → reveal. Looking / camera-web / Batmobile only AFTER the blind is up.
  const DUR = 11;
  const at = (s) => +(s / DUR).toFixed(4);
  const K = {
    walkedIn: at(1.0),
    planted: at(1.25),
    grabbed: at(1.7),
    yankEnd: at(2.2),
    released: at(2.45),
    letGo: at(2.65),
    blindUp: at(3.9),
    // Post-reveal beat: cat looks around; Spidey shoots a web; Batmobile arrives.
    camAim: at(4.15),
    camHit: at(4.45),
    lookBEnd: at(5.2),
    // Spidey climb after the camera splat sticks.
    webStart: at(5.5),
    gone: at(10.4),
    // Camera splat fades early so the dashboard reads cleanly during the climb.
    splatFade: at(5.0),
    splatGone: at(7.0),
    // Batmobile pickup.
    carIn: at(4.3),
    carStop: at(5.35),
    board: at(5.65),
    drive: at(5.95),
  };
  // Roller blinds travel fast then settle; keep it readable rather than snappy.
  const BLIND_EASE = "0 0 1 1;0.45 0 0.12 1;0 0 1 1";

  // The hero stands on the very bottom edge of the card; its raised hand meets the cord.
  const heroX = theme.exit === "batmobile" ? width - 118 : width - 82;
  const heroY = height - 6;
  const cordX = width - 36;
  const cordRestY = heroY - 116;
  const cordPullY = heroY + 14 - 82;

  // Cat only: check both sides AFTER the curtain rises. Others stay facing forward.
  const isCat = theme.exit === "slideDown";
  const lookTimes = isCat
    ? [
        0, K.blindUp,
        at(4.2), at(4.4), at(4.7), at(4.95), K.lookBEnd,
        1,
      ].join(";")
    : "0;1";
  const lookAngles = isCat
    ? [0, 0, -9, -9, 10, 10, 0, 0]
    : [0, 0];
  const headTurn = lookAngles.map((a) => `${a} 0 -88`).join(";");
  const eyeShift = lookAngles.map((a) => `${a * 0.45} 0`).join(";");
  const A = { DUR, K, lookTimes, headTurn, eyeShift };

  const heroTranslate =
    theme.exit === "webUp"
      ? {
          values: "150 0;0 0;0 0;0 0;0 14;0 0;0 0;0 0;0 0;0 -700;0 -700",
          keyTimes: `0;${K.walkedIn};${K.planted};${K.grabbed};${K.yankEnd};${K.released};${K.blindUp};${K.lookBEnd};${K.webStart};${K.gone};1`,
          splines: "0.25 0.1 0.25 1;0.4 0 0.2 1;0 0 1 1;0.5 0 0.9 0.4;0.2 0.9 0.3 1;0 0 1 1;0 0 1 1;0 0 1 1;0.25 0 0.5 1;0 0 1 1",
        }
      : theme.exit === "batmobile"
        ? {
            // Run left into the cockpit with a bobbing stride, then vanish with the car.
            values: "150 0;0 0;0 0;0 0;0 14;0 0;0 0;0 0;-18 -14;-40 2;-72 -10;-72 -10",
            keyTimes: `0;${K.walkedIn};${K.planted};${K.grabbed};${K.yankEnd};${K.released};${K.blindUp};${K.carStop};${+(K.carStop + 0.012).toFixed(4)};${+(K.carStop + 0.022).toFixed(4)};${K.board};1`,
            splines: "0.25 0.1 0.25 1;0.4 0 0.2 1;0 0 1 1;0.5 0 0.9 0.4;0.2 0.9 0.3 1;0 0 1 1;0 0 1 1;0.4 0 0.6 1;0.4 0 0.6 1;0.3 0 0.55 1;0 0 1 1",
          }
        : {
            values: "150 0;0 0;0 0;0 0;0 14;0 0;0 0;0 0;0 240",
            keyTimes: `0;${K.walkedIn};${K.planted};${K.grabbed};${K.yankEnd};${K.released};${K.blindUp};${K.lookBEnd};1`,
            splines: "0.25 0.1 0.25 1;0.4 0 0.2 1;0 0 1 1;0.5 0 0.9 0.4;0.2 0.9 0.3 1;0 0 1 1;0 0 1 1;0.42 0 0.7 0.55",
          };

  return `
  <defs>${theme.defs}
    <clipPath id="card-clip">
      <rect x="0" y="0" width="${width}" height="${height}" rx="18"/>
    </clipPath>
    <clipPath id="shutter-clip">
      <rect x="0" y="0" width="${width}" height="${height}">
        <animate attributeName="height" values="${height};${height};0;0" keyTimes="0;${K.released};${K.blindUp};1" dur="${DUR}s" fill="freeze" calcMode="spline" keySplines="${BLIND_EASE}"/>
      </rect>
    </clipPath>
    <filter id="hero-glow" x="-45%" y="-45%" width="190%" height="190%">
      <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="${theme.glow}" flood-opacity="0.22"/>
    </filter>
    <linearGradient id="curtain-fabric" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${theme.fabric[0]}"/>
      <stop offset="0.42" stop-color="${theme.fabric[1]}"/>
      <stop offset="0.72" stop-color="${theme.fabric[2]}"/>
      <stop offset="1" stop-color="${theme.fabric[3]}"/>
    </linearGradient>
    <linearGradient id="blind-edge-shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="hero-shadow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#000" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <g clip-path="url(#card-clip)">
    <g clip-path="url(#shutter-clip)">
      <rect width="${width}" height="${height}" rx="18" fill="url(#curtain-fabric)"/>
      ${theme.curtainExtra ? theme.curtainExtra(width, height) : ""}
      <rect width="${width}" height="${height}" rx="18" fill="url(#curtain-print)"/>
      ${slats}
      <rect x="${width / 2 - 138}" y="${height / 2 - 36}" width="276" height="72" rx="20" fill="${theme.plate.fill}" stroke="${theme.plate.stroke}" stroke-width="2"/>
      <text x="${width / 2}" y="${height / 2 - 4}" text-anchor="middle" fill="${theme.plate.text}" font-size="13" font-weight="700" letter-spacing="0.14em" font-family="${FONT}">CURIOUS? PULL TO OPEN</text>
      <text x="${width / 2}" y="${height / 2 + 18}" text-anchor="middle" fill="${theme.plate.sub}" font-size="10" font-family="${FONT}">by ${esc(DEVELOPER.name)}</text>
      <rect x="0" y="${height - 8}" width="${width}" height="8" fill="${theme.bar}"/>
    </g>

    <!-- Soft shadow that trails the rising blind -->
    <rect x="0" y="${height}" width="${width}" height="26" fill="url(#blind-edge-shade)">
      <animate attributeName="y" values="${height};${height};0;0" keyTimes="0;${K.released};${K.blindUp};1" dur="${DUR}s" fill="freeze" calcMode="spline" keySplines="${BLIND_EASE}"/>
      <animate attributeName="opacity" values="1;1;0;0" keyTimes="0;${K.blindUp - 0.04};${K.blindUp};1" dur="${DUR}s" fill="freeze"/>
    </rect>

    <!-- Roller bar + pull cord -->
    <g>
      <animate attributeName="opacity" values="1;1;0;0" keyTimes="0;${K.lookBEnd};0.96;1" dur="${DUR}s" fill="freeze"/>
      <rect x="0" y="0" width="${width}" height="16" rx="8" fill="${theme.bar}" stroke="${theme.barStroke}"/>
      <line x1="${cordX}" y1="14" x2="${cordX}" y2="${cordRestY}" stroke="${theme.cord}" stroke-width="3">
        <animate attributeName="y2" values="${cordRestY};${cordRestY};${cordPullY};${cordPullY};18;18" keyTimes="0;${K.grabbed};${K.yankEnd};${K.released};${K.blindUp};1" dur="${DUR}s" fill="freeze" calcMode="spline" keySplines="0 0 1 1;0.4 0 0.2 1;0 0 1 1;0.45 0 0.12 1;0 0 1 1"/>
      </line>
      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 ${cordPullY - cordRestY};0 ${cordPullY - cordRestY};0 ${18 - cordRestY};0 ${18 - cordRestY}" keyTimes="0;${K.grabbed};${K.yankEnd};${K.released};${K.blindUp};1" dur="${DUR}s" fill="freeze" calcMode="spline" keySplines="0 0 1 1;0.4 0 0.2 1;0 0 1 1;0.45 0 0.12 1;0 0 1 1"/>
        <rect x="${cordX - 11}" y="${cordRestY - 8}" width="22" height="32" rx="11" fill="${theme.handle}"/>
        <circle cx="${cordX}" cy="${cordRestY + 2}" r="3.5" fill="${theme.handleDot}"/>
      </g>
    </g>

    <!-- Sparkles on reveal -->
    ${[
      [width * 0.2, height * 0.32, 0],
      [width * 0.46, height * 0.2, 0.12],
      [width * 0.68, height * 0.4, 0.06],
      [width * 0.84, height * 0.24, 0.18],
      [width * 0.32, height * 0.62, 0.22],
    ]
      .map(([sx, sy, lag]) => {
        const t0 = K.blindUp - 0.05 + lag * 0.35;
        return `<g opacity="0" transform="translate(${sx.toFixed(1)},${sy.toFixed(1)})">
      <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;${t0.toFixed(4)};${(t0 + 0.02).toFixed(4)};${(t0 + 0.07).toFixed(4)};1" dur="${DUR}s" fill="freeze"/>
      <animateTransform attributeName="transform" type="scale" additive="sum" values="0.2;0.2;1.25;0.4;0.4" keyTimes="0;${t0.toFixed(4)};${(t0 + 0.02).toFixed(4)};${(t0 + 0.07).toFixed(4)};1" dur="${DUR}s" fill="freeze"/>
      <path d="M0,-11 Q1.6,-1.6 11,0 Q1.6,1.6 0,11 Q-1.6,1.6 -11,0 Q-1.6,-1.6 0,-11Z" fill="${theme.sparkle}"/>
    </g>`;
      })
      .join("\n    ")}

    <!-- Hero: walks in, pulls the cord, then leaves the scene -->
    <g transform="translate(${heroX},${heroY})">
      <g filter="url(#hero-glow)">
        <animateTransform attributeName="transform" type="translate"
          values="${heroTranslate.values}"
          keyTimes="${heroTranslate.keyTimes}"
          dur="${DUR}s" fill="freeze" calcMode="spline"
          keySplines="${heroTranslate.splines}"/>
        ${
          theme.exit === "webUp"
            ? `<animateTransform attributeName="transform" type="rotate" additive="sum" values="0 34 -158;0 34 -158;-7 34 -158;-7 34 -158" keyTimes="0;${K.lookBEnd};${K.webStart};1" dur="${DUR}s" fill="freeze" calcMode="spline" keySplines="0 0 1 1;0.3 0 0.6 1;0 0 1 1"/>`
            : ""
        }

        <ellipse cx="0" cy="-2" rx="48" ry="10" fill="url(#hero-shadow)">
          <animate attributeName="opacity" values="1;1;0;0" keyTimes="0;${theme.exit === "batmobile" ? K.board : K.lookBEnd};${+((theme.exit === "batmobile" ? K.board : K.lookBEnd) + 0.05).toFixed(4)};1" dur="${DUR}s" fill="freeze"/>
        </ellipse>
        ${theme.hero(A)}
      </g>
    </g>

    <!-- Camera web splat sits on top of everything (POV lens) -->
    ${theme.exit === "webUp" ? webExitLine(A, heroX, heroY, width, height) : ""}
    ${theme.exit === "batmobile" ? batmobileExit(A, heroX, heroY, width, height) : ""}
  </g>`;
}

/**
 * Spidey shoots a web AT the camera (POV splat sticks to the lens), then
 * rides a second strand straight up and off-screen. The camera splat fades
 * while he climbs.
 */
function webExitLine(A, heroX, heroY, width, height) {
  const { DUR, K } = A;
  const camX = +(width * 0.5).toFixed(1);
  const camY = +(height * 0.5).toFixed(1);
  // Fist while aiming toward the camera (local ≈ (-28, -128)).
  const aimX = heroX - 28;
  const aimY = heroY - 128;
  // Fist while riding upward (local ≈ (34, -158)).
  const climbX = heroX + 34;
  const climbY = heroY - 158;
  const topY = 8;
  const shot = +(K.camAim + 0.02).toFixed(4);
  const hit = K.camHit;
  const fadeStart = K.splatFade;
  // Diameter = 150% of the longer card edge.
  const splatR = Math.max(width, height) * 0.75;

  const splat = spiderWeb(0, 0, splatR, {
    spokes: 14,
    rings: 6,
    color: "#f4f7ff",
    width: 2.4,
    opacity: 0.95,
  });

  return `
    <!-- Strand that flies from his fist into the camera lens -->
    <g>
      <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${K.camAim};${shot};${hit};${+(hit + 0.04).toFixed(4)};1" dur="${DUR}s" fill="freeze"/>
      <line x1="${aimX}" y1="${aimY}" x2="${aimX}" y2="${aimY}" stroke="#f4f7ff" stroke-width="2.2" stroke-linecap="round">
        <animate attributeName="x2" values="${aimX};${aimX};${camX};${camX}" keyTimes="0;${K.camAim};${hit};1" dur="${DUR}s" fill="freeze"/>
        <animate attributeName="y2" values="${aimY};${aimY};${camY};${camY}" keyTimes="0;${K.camAim};${hit};1" dur="${DUR}s" fill="freeze"/>
      </line>
    </g>

    <!-- Web splat stuck on the camera — grows on impact, then fades early -->
    <g transform="translate(${camX},${camY})" opacity="0">
      <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${hit};${+(hit + 0.04).toFixed(4)};${fadeStart};${K.splatGone};1" dur="${DUR}s" fill="freeze"/>
      <g>
        <animateTransform attributeName="transform" type="scale" values="0.02;0.02;1.08;1;1" keyTimes="0;${hit};${+(hit + 0.08).toFixed(4)};${+(hit + 0.18).toFixed(4)};1" dur="${DUR}s" fill="freeze" calcMode="spline" keySplines="0 0 1 1;0.12 0.75 0.2 1;0.4 0 0.6 1;0 0 1 1"/>
        ${splat}
        <circle cx="0" cy="0" r="12" fill="#f4f7ff" opacity="0.85"/>
        <circle cx="0" cy="0" r="5" fill="#ffffff"/>
      </g>
    </g>

    <!-- Climbing strand: hand → ceiling, stays attached as he rides up -->
    <g>
      <animate attributeName="opacity" values="0;0;1;1" keyTimes="0;${K.lookBEnd};${K.webStart};1" dur="${DUR}s" fill="freeze"/>
      <line x1="${climbX}" y1="${climbY}" x2="${climbX}" y2="${climbY}" stroke="#f4f7ff" stroke-width="2" opacity="0.95">
        <animate attributeName="y1" values="${climbY};${climbY};${topY};${topY}" keyTimes="0;${K.lookBEnd};${K.webStart};1" dur="${DUR}s" fill="freeze"/>
        <animate attributeName="y2" values="${climbY};${climbY};${climbY};${climbY - 700};${climbY - 700}" keyTimes="0;${K.lookBEnd};${K.webStart};${K.gone};1" dur="${DUR}s" fill="freeze" calcMode="spline" keySplines="0 0 1 1;0 0 1 1;0.25 0 0.5 1;0 0 1 1"/>
      </line>
      <g transform="translate(${climbX},${topY})" opacity="0">
        <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;${K.lookBEnd};${K.webStart};${+(K.webStart + 0.12).toFixed(4)};1" dur="${DUR}s" fill="freeze"/>
        <path d="M-9,0 L9,0 M0,-9 L0,9 M-6,-6 L6,6 M-6,6 L6,-6" stroke="#f4f7ff" stroke-width="1.6" stroke-linecap="round"/>
      </g>
    </g>`;
}

/**
 * The Batmobile rolls in from the left, Batman hops aboard, then it peels out
 * to the right — shrinking with perspective — trailing exhaust smoke and a
 * swarm of bats.
 */
function batmobileExit(A, heroX, heroY, width, height) {
  const { DUR, K } = A;
  const stopX = heroX - 90;
  const y = heroY + 2;
  const offL = -280;
  const offR = width + 320;
  const BLACK = "#0d1018";
  const BODY = "#161a24";
  const YELLOW = "#f5d76e";
  const INK = "#05060a";

  const smokePuff = (dx, dy, delay, scale = 1) => {
    const t0 = +(K.drive + delay).toFixed(4);
    const t1 = +(t0 + 0.06).toFixed(4);
    const t2 = +(t0 + 0.55).toFixed(4);
    return `<g transform="translate(${dx},${dy})" opacity="0">
      <animate attributeName="opacity" values="0;0;0.85;0;0" keyTimes="0;${t0};${t1};${t2};1" dur="${DUR}s" fill="freeze"/>
      <animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;0 0;-28 -14;-70 -36;-70 -36" keyTimes="0;${t0};${t1};${t2};1" dur="${DUR}s" fill="freeze"/>
      <animateTransform attributeName="transform" type="scale" additive="sum" values="${scale};${scale};${scale * 1.8};${scale * 3.2};${scale * 3.2}" keyTimes="0;${t0};${t1};${t2};1" dur="${DUR}s" fill="freeze"/>
      <ellipse cx="0" cy="0" rx="12" ry="8" fill="#9aa1ad"/>
      <ellipse cx="-5" cy="-4" rx="6" ry="4" fill="#d0d4dc" opacity="0.5"/>
    </g>`;
  };

  // Bats streak across the frame from mixed directions as he drives off.
  const swarm = [
    [ -40, 80, width + 60, 40, 0.00, 1.4 ],
    [ width + 30, 140, -50, 90, 0.08, 1.1 ],
    [ -30, 220, width + 40, 160, 0.14, 1.6 ],
    [ width + 20, 300, -40, 250, 0.22, 1.25 ],
    [ -50, 360, width + 70, 280, 0.30, 1.5 ],
    [ width + 40, 60, -30, 180, 0.18, 1.0 ],
    [ -20, 420, width + 50, 340, 0.40, 1.35 ],
    [ width + 10, 200, -60, 120, 0.48, 1.2 ],
  ].map(([x0, y0, x1, y1, delay, sc], i) => {
    const t0 = +(K.drive + delay).toFixed(4);
    const t1 = +(t0 + 0.12).toFixed(4);
    return `<g opacity="0">
      <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${t0};${+(t0 + 0.02).toFixed(4)};${+(t1 - 0.02).toFixed(4)};${t1};1" dur="${DUR}s" fill="freeze"/>
      <animateTransform attributeName="transform" type="translate" values="${x0} ${y0};${x0} ${y0};${x1} ${y1};${x1} ${y1}" keyTimes="0;${t0};${t1};1" dur="${DUR}s" fill="freeze" calcMode="spline" keySplines="0 0 1 1;0.2 0 0.6 1;0 0 1 1"/>
      <g>
        <animateTransform attributeName="transform" type="scale" values="${sc};${sc * 0.85};${sc};${sc * 0.85};${sc}" keyTimes="0;0.25;0.5;0.75;1" dur="0.28s" repeatCount="indefinite"/>
        <use href="#bat-fly" transform="translate(0 0)"/>
      </g>
    </g>`;
  }).join("\n    ");

  return `
    <!-- Flying bat swarm across the card while he peels out -->
    <g>${swarm}</g>

    <g>
      <!-- Drive across, shrinking as he gets farther (perspective) -->
      <animateTransform attributeName="transform" type="translate"
        values="${offL} ${y};${offL} ${y};${stopX} ${y};${stopX} ${y};${offR} ${y + 28};${offR} ${y + 36}"
        keyTimes="0;${K.carIn};${K.carStop};${K.drive};${K.gone};1"
        dur="${DUR}s" fill="freeze" calcMode="spline"
        keySplines="0 0 1 1;0.2 0.7 0.2 1;0 0 1 1;0.35 0 0.55 1;0 0 1 1"/>
      <animateTransform attributeName="transform" type="scale" additive="sum"
        values="1.55;1.55;1.55;1.55;0.42;0.28"
        keyTimes="0;${K.carIn};${K.carStop};${K.drive};${K.gone};1"
        dur="${DUR}s" fill="freeze" calcMode="spline"
        keySplines="0 0 1 1;0 0 1 1;0 0 1 1;0.45 0 0.65 1;0 0 1 1"/>

      <!-- Exhaust smoke trail once he floors it -->
      <g transform="translate(-96, -22)">
        ${smokePuff(0, 0, 0, 1.0)}
        ${smokePuff(-6, 5, 0.1, 1.2)}
        ${smokePuff(5, -3, 0.2, 0.95)}
        ${smokePuff(-12, 3, 0.32, 1.35)}
        ${smokePuff(-2, 7, 0.45, 1.1)}
        ${smokePuff(-16, 1, 0.58, 1.45)}
        ${smokePuff(-4, 6, 0.72, 1.2)}
        ${smokePuff(-20, 4, 0.88, 1.55)}
        ${smokePuff(-8, 2, 1.05, 1.3)}
        ${smokePuff(-24, 5, 1.25, 1.6)}
        ${smokePuff(-10, 0, 1.5, 1.4)}
        ${smokePuff(-18, 6, 1.8, 1.5)}
      </g>

      <!-- Idle puffs while parked -->
      <g transform="translate(-96, -22)" opacity="0">
        <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${K.carStop};${+(K.carStop + 0.02).toFixed(4)};${K.drive};${+(K.drive + 0.02).toFixed(4)};1" dur="${DUR}s" fill="freeze"/>
        <ellipse cx="0" cy="0" rx="10" ry="6" fill="#8a909c" opacity="0.4">
          <animate attributeName="rx" values="7;12;7" dur="0.9s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.45;0.2;0.45" dur="0.9s" repeatCount="indefinite"/>
        </ellipse>
      </g>

      <!-- Wheels -->
      <ellipse cx="-58" cy="-6" rx="20" ry="17" fill="${INK}"/>
      <ellipse cx="-58" cy="-6" rx="11" ry="9" fill="#2a303c"/>
      <ellipse cx="52" cy="-6" rx="20" ry="17" fill="${INK}"/>
      <ellipse cx="52" cy="-6" rx="11" ry="9" fill="#2a303c"/>

      <!-- Low long body + rear fin -->
      <path d="M-98,-20 C-88,-50 -48,-62 -8,-60 L40,-58 C68,-56 88,-44 96,-26 L102,-12 L102,-4 L-102,-4 L-102,-14 Z" fill="${BODY}" stroke="${INK}" stroke-width="2.2"/>
      <path d="M-24,-60 L-8,-96 L12,-60 Z" fill="${BLACK}" stroke="${INK}" stroke-width="1.8"/>
      <path d="M-92,-24 L-60,-24 L-54,-14 L-98,-14 Z" fill="${BLACK}"/>
      <!-- Cockpit canopy -->
      <path d="M-22,-58 C-6,-76 24,-76 42,-58 C26,-52 -6,-52 -22,-58 Z" fill="#1c2438" stroke="${INK}" stroke-width="1.6" opacity="0.9"/>
      <!-- Headlights -->
      <ellipse cx="90" cy="-22" rx="6" ry="4" fill="${YELLOW}">
        <animate attributeName="opacity" values="0.55;1;0.55" dur="0.55s" repeatCount="indefinite"/>
      </ellipse>
      <ellipse cx="84" cy="-32" rx="4" ry="3" fill="${YELLOW}" opacity="0.8"/>
      <!-- Yellow trim stripe -->
      <path d="M-72,-26 L86,-26" fill="none" stroke="${YELLOW}" stroke-width="1.8" opacity="0.75"/>
      <use href="#bat-emblem" transform="translate(10 -36) scale(0.55)" opacity="0.9"/>

      <!-- Batman silhouette in the cockpit after boarding -->
      <g opacity="0" transform="translate(4,-70) scale(0.78)">
        <animate attributeName="opacity" values="0;0;1;1" keyTimes="0;${K.board};${+(K.board + 0.04).toFixed(4)};1" dur="${DUR}s" fill="freeze"/>
        <!-- Cape and shoulders visible through the canopy -->
        <path d="M-10,-7 C-20,-6 -27,0 -30,10 L30,10 C27,0 20,-6 10,-7 Q0,-2 -10,-7 Z" fill="${BLACK}" stroke="${INK}" stroke-width="1.5"/>
        <!-- Miniature version of the classic cowl -->
        <path d="M-13,-13
          C-15,-23 -14,-31 -10,-36
          L-8,-50 L-3,-37
          Q0,-39 3,-37
          L8,-50 L10,-36
          C14,-31 15,-23 13,-13
          L10,-7 Q0,-2 -10,-7 Z"
          fill="${BLACK}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M-2,-25 L-11,-30 Q-9,-24 -6,-22 Q-4,-22 -2,-25 Z" fill="#f4f7ff"/>
        <path d="M2,-25 L11,-30 Q9,-24 6,-22 Q4,-22 2,-25 Z" fill="#f4f7ff"/>
        <path d="M-10,-19 Q-6,-15 0,-14 Q6,-15 10,-19 L7,-8 Q0,-3 -7,-8 Z" fill="#d4a574" stroke="${INK}" stroke-width="1"/>
        <path d="M0,-26 L-3,-18 L0,-15 L3,-18 Z" fill="#181c26"/>
        <path d="M-4,-9 Q0,-7 4,-9" fill="none" stroke="${INK}" stroke-width="1.1" stroke-linecap="round"/>
      </g>
    </g>`;
}


function buildCard(data, theme) {
  const W = 920;
  const H = 500;
  const updated = new Date().toISOString().slice(0, 10);
  const line2 = [data.bio, data.location, data.status].filter(Boolean).join("  ·  ");

  const pad = 18;
  const gap = 12;
  const leftW = 580;
  const rightW = W - pad * 2 - gap - leftW;

  const mCount = 6;
  const mW = (W - pad * 2 - gap * (mCount - 1)) / mCount;

  const metrics = [
    ["STARS", fmt(data.stars), C.amber],
    ["REPOS", fmt(data.repos), C.sky],
    ["FOLLOWERS", fmt(data.followers), C.violet],
    ["FOLLOWING", fmt(data.following), C.rose],
    ["CONTRIB REPOS", fmt(data.contributedRepoCount), C.teal],
    ["OSS STARS", fmt(data.contributedStars), C.green],
  ];

  let metricCards = "";
  metrics.forEach(([lab, val, color], i) => {
    const x = pad + i * (mW + gap);
    // Left accent bar — never overlaps label text
    metricCards += card(
      x,
      148,
      mW,
      78,
      `<rect x="0" y="14" width="3" height="50" rx="1.5" fill="${color}"/>
       ${label(lab, 16, 28)}
       ${value(val, 16, 58, 24)}`,
    );
  });

  let langRows = "";
  data.languages.forEach((lang, i) => {
    const barMax = rightW - 36;
    const barW = Math.max(4, (lang.pct / 100) * barMax);
    langRows += `<g transform="translate(16,${48 + i * 34})">
      <text x="0" y="0" fill="${C.text}" font-size="12" font-family="${FONT}">${esc(lang.name)}</text>
      <text x="${barMax}" y="0" text-anchor="end" fill="${C.muted}" font-size="11" font-family="${FONT}">${lang.pct.toFixed(0)}%</text>
      <rect x="0" y="8" width="${barMax}" height="4" rx="2" fill="${C.bg}"/>
      <rect x="0" y="8" width="${barW}" height="4" rx="2" fill="${lang.color}"/>
    </g>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
  <title>${esc(data.name)} — GitHub profile</title>
  <rect width="${W}" height="${H}" rx="18" fill="${C.bg}"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="17.5" fill="none" stroke="${C.line}"/>

  ${card(
    pad,
    pad,
    leftW,
    116,
    `
    ${value(data.name, 20, 40, 24)}
    <text x="20" y="64" fill="${C.muted}" font-size="13" font-family="${FONT}">${esc(line2)}</text>
    <text x="20" y="92" fill="${C.faint}" font-size="12" font-family="${FONT}">${esc(SOCIAL.telegram.handle)}   ·   ${esc(SOCIAL.linkedin.handle)}   ·   ${esc(SOCIAL.github.handle)}</text>
  `,
  )}

  ${card(
    pad + leftW + gap,
    pad,
    rightW,
    116,
    `
    ${label("ON GITHUB", 16, 28)}
    ${value(`${data.years} years`, 16, 58, 24)}
    <text x="16" y="82" fill="${C.faint}" font-size="12" font-family="${FONT}">since ${data.since}</text>
    <text x="16" y="102" fill="${C.teal}" font-size="12" font-weight="600" font-family="${FONT}">${fmt(data.contributions)} contributions</text>
  `,
  )}

  ${metricCards}

  ${card(
    pad,
    240,
    leftW,
    242,
    `
    ${label("CONTRIBUTION ACTIVITY", 16, 26)}
    ${animatedContributionPanel(data, leftW)}
  `,
  )}

  ${card(
    pad + leftW + gap,
    240,
    rightW,
    242,
    `
    ${label("TOP LANGUAGES", 16, 26)}
    ${langRows}
  `,
  )}

  <text x="${pad}" y="${H - 8}" fill="${C.faint}" font-size="9" font-family="${FONT}">by ${esc(DEVELOPER.handle)}</text>
  <text x="${W - pad}" y="${H - 8}" text-anchor="end" fill="${C.faint}" font-size="9" font-family="${FONT}">${updated}</text>
  ${openingShutter(W, H, theme)}
</svg>
`;
}

async function main() {
  let data;
  if (USE_MOCK) {
    console.log(`Using demo snapshot for @${USERNAME} (set USE_MOCK=0 for live API)...`);
    data = mockData();
  } else {
    console.log(`Fetching @${USERNAME}...`);
    data = aggregate(await fetchUser());
  }
  const theme = pickTheme();
  await mkdir(join(ROOT, "assets"), { recursive: true });
  await writeFile(join(ROOT, "assets", "profile-card.svg"), buildCard(data, theme));
  console.log(`Wrote assets/profile-card.svg (curtain theme: ${theme})`);
  console.log(
    `${data.stars}★ own · ${data.contributedRepoCount} contrib repos · ${fmt(data.contributedStars)} OSS ★ · ${fmt(data.contributions)} calendar`,
  );
  if (data.contributedRepos?.length) {
    for (const repo of data.contributedRepos) {
      console.log(`  - ${repo.name} (${fmt(repo.stars)}★)`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
