#!/usr/bin/env node
/**
 * Capture animated SVG example frames via Chrome DevTools Protocol,
 * then assemble high-quality forever-looping GIFs with gifski.
 *
 * Quality strategy:
 *  - Render at 3× resolution, box-filter downscale for crisp text/edges
 *  - 30 fps for smooth motion
 *  - gifski (pngquant) at quality 100 + --extra for best color fidelity
 */
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { inflateSync, deflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const EXAMPLES = join(ROOT, "assets", "examples");
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const THEMES = ["cat", "spiderman", "batman"];
// Must stay in sync with generate-cards.mjs morphDelay + morph phases (hold+morph+settle, no BACK loop).
const THEME_MORPH_DELAY = { cat: 5.3, spiderman: 10.6, batman: 10.6 };
const MORPH_ACTIVE = 2.6 + 2.4 + 4.2;
const HOLD = 1.0;
const FPS = 30;
const WIDTH = 920;
const HEIGHT = 500;
const SCALE = 3;
const DEBUG_PORT = 9229;

/** Exact SVG/UI colors pinned in gifski's palette for faithful reproduction. */
const THEME_FIXED_COLORS = {
  cat: [
    "F8DC62", "E8BD35", "D7A824", "F2CA45", "FFF0A8", "B98919", "9A7419", "725718",
    "171719", "FFF8DC", "09090B", "131316", "27272A", "FAFAFA", "A1A1AA", "52525B",
    "2DD4BF", "5EEAD4", "115E59", "0F766E", "FBBF24", "38BDF8", "A78BFA", "FB7185", "4ADE80",
  ],
  spiderman: [
    "E5323C", "C1121F", "9D0D18", "D92534", "171719", "0B1A3A", "1E3A8A", "DC2626",
    "09090B", "131316", "27272A", "FAFAFA", "A1A1AA", "52525B", "2DD4BF", "5EEAD4",
    "FBBF24", "38BDF8", "A78BFA", "FB7185", "4ADE80", "F87171",
  ],
  batman: [
    "0B1228", "101A36", "070D1C", "162044", "F5D76E", "C9A227", "FFF6C8", "171719",
    "09090B", "131316", "27272A", "FAFAFA", "A1A1AA", "52525B", "2DD4BF", "5EEAD4",
    "FBBF24", "38BDF8", "A78BFA", "FB7185", "4ADE80", "FACC15",
  ],
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function contentType(file) {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".svg": "image/svg+xml",
      ".js": "text/javascript",
      ".css": "text/css",
    }[extname(file)] || "application/octet-stream"
  );
}

async function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/_gif-preview.html") {
        const theme = url.searchParams.get("theme");
        if (!THEMES.includes(theme)) {
          res.writeHead(400).end("invalid theme");
          return;
        }
        const html = `<!doctype html><style>
          html,body,img{margin:0;width:${WIDTH}px;height:${HEIGHT}px;display:block;overflow:hidden;background:#09090b}
        </style><img src="./${theme}.gif">`;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      const file = join(EXAMPLES, decodeURIComponent(url.pathname.slice(1) || "_frame.html"));
      if (!file.startsWith(EXAMPLES)) {
        res.writeHead(403).end();
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": contentType(file) });
      res.end(data);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function connectCdp(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json());
      const page = tabs.find((t) => t.type === "page") || tabs[0];
      if (!page?.webSocketDebuggerUrl) throw new Error("no page");
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve);
        ws.addEventListener("error", reject);
      });
      return new Cdp(ws);
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Could not connect to Chrome DevTools");
}

function durationForTheme(theme) {
  return THEME_MORPH_DELAY[theme] + MORPH_ACTIVE + HOLD;
}

function frameTimes(theme) {
  const duration = durationForTheme(theme);
  const step = 1 / FPS;
  const times = [];
  for (let t = 0; t <= duration + 1e-9; t += step) times.push(Number(t.toFixed(4)));
  const hold = Math.max(1, Math.round(HOLD * FPS));
  for (let i = 0; i < hold; i++) times.push(duration);
  return times;
}

function readPng(data, source) {
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error(`Invalid PNG: ${source}`);
  }

  let width;
  let height;
  let colorType;
  const idat = [];
  for (let offset = 8; offset < data.length; ) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      const bitDepth = chunk[8];
      colorType = chunk[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`Unsupported PNG ${bitDepth}/${colorType}: ${source}`);
      }
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  let inputOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = inflated[inputOffset++];
    const row = Buffer.from(inflated.subarray(inputOffset, inputOffset + stride));
    inputOffset += stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + ((left + up) >> 1)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        row[x] = (row[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
      } else if (filter !== 0) {
        throw new Error(`Unsupported PNG filter ${filter}: ${source}`);
      }
    }

    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      const alpha = channels === 4 ? row[src + 3] : 255;
      rgba[dst] = Math.round((row[src] * alpha) / 255);
      rgba[dst + 1] = Math.round((row[src + 1] * alpha) / 255);
      rgba[dst + 2] = Math.round((row[src + 2] * alpha) / 255);
      rgba[dst + 3] = 255;
    }
    previous = row;
  }
  return { width, height, rgba };
}

function downscaleBox(rgba, width, height, factor) {
  const outW = Math.round(width / factor);
  const outH = Math.round(height / factor);
  const out = Buffer.alloc(outW * outH * 4);
  const area = factor * factor;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      const sx = x * factor;
      const sy = y * factor;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const si = ((sy + dy) * width + (sx + dx)) * 4;
          r += rgba[si];
          g += rgba[si + 1];
          b += rgba[si + 2];
        }
      }
      const di = (y * outW + x) * 4;
      out[di] = Math.round(r / area);
      out[di + 1] = Math.round(g / area);
      out[di + 2] = Math.round(b / area);
      out[di + 3] = 255;
    }
  }
  return { width: outW, height: outH, rgba: out };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodePng(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[(stride + 1) * y] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = (stride + 1) * y + 1 + x * 4;
      raw[dst] = rgba[src];
      raw[dst + 1] = rgba[src + 1];
      raw[dst + 2] = rgba[src + 2];
      raw[dst + 3] = rgba[src + 3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = crc32(body);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, body, crcBuf]);
  };

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 0 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function findGifski() {
  const candidates = [
    process.env.GIFSKI_PATH,
    join(homedir(), ".cargo/bin/gifski"),
    "gifski",
    "/opt/homebrew/bin/gifski",
    "/usr/local/bin/gifski",
  ].filter(Boolean);
  for (const bin of candidates) {
    const probe = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return bin;
  }
  return null;
}

async function encodeWithGifski(framePaths, output, theme) {
  const gifski = findGifski();
  if (!gifski) {
    throw new Error(
      "gifski not found. Install with: cargo install gifski  (or set GIFSKI_PATH)",
    );
  }

  const fixedColors = THEME_FIXED_COLORS[theme] || [];
  const colorArgs = fixedColors.flatMap((hex) => ["--fixed-color", hex]);

  await new Promise((resolve, reject) => {
    const args = [
      "--fps",
      String(FPS),
      "--quality",
      "100",
      "--motion-quality",
      "100",
      "--extra",
      "--no-sort",
      "--repeat",
      "0",
      "-o",
      output,
      ...colorArgs,
      ...framePaths,
    ];
    const child = spawn(gifski, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`gifski exited ${code}`))));
  });
}

async function encodeTheme(frameDir, theme) {
  const times = frameTimes(theme);
  const framePaths = times.map((_, i) =>
    join(frameDir, `${theme}_${String(i).padStart(4, "0")}.png`),
  );

  const output = join(EXAMPLES, `${theme}.gif`);
  await encodeWithGifski(framePaths, output, theme);
  const stat = await readFile(output);
  console.log(
    `wrote assets/examples/${theme}.gif (${Math.round(stat.length / 1024)} KB, ${times.length} frames @ ${FPS}fps, gifski q100)`,
  );
}

async function captureTheme(cdp, port, theme, outDir) {
  const times = frameTimes(theme);
  console.log(
    `capturing ${theme} (${times.length} frames @ ${FPS} fps, ${durationForTheme(theme).toFixed(1)}s, ${SCALE}× supersample)...`,
  );

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: SCALE,
    mobile: false,
  });

  const url = `http://127.0.0.1:${port}/_frame.html?theme=${theme}&t=0`;
  await cdp.send("Page.navigate", { url });

  for (let i = 0; i < 80; i++) {
    try {
      const { result } = await cdp.send("Runtime.evaluate", {
        expression: "document.documentElement.dataset.ready === '1'",
        returnByValue: true,
      });
      if (result?.value) break;
    } catch {
      // page may still be navigating
    }
    await sleep(100);
  }

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    await cdp.send("Runtime.evaluate", {
      expression: `(() => { const svg = document.querySelector('svg'); svg.pauseAnimations(); svg.setCurrentTime(${t}); return true; })()`,
      returnByValue: true,
    });
    await sleep(25);
    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    const raw = readPng(Buffer.from(shot.data, "base64"), `${theme}:${t}`);
    const scaled = downscaleBox(raw.rgba, raw.width, raw.height, SCALE);
    if (scaled.width !== WIDTH || scaled.height !== HEIGHT) {
      throw new Error(`Downscale mismatch ${scaled.width}x${scaled.height} for ${theme} t=${t}`);
    }

    const pngOut = encodePng(scaled.rgba, WIDTH, HEIGHT);
    await writeFile(join(outDir, `${theme}_${String(i).padStart(4, "0")}.png`), pngOut);
    if (i % FPS === 0) console.log(`  ${theme}: ${i + 1}/${times.length} t=${t}s`);
  }
}

async function extractGifPreview(cdp, port, theme) {
  const previewDir = join(EXAMPLES, "_preview");
  await mkdir(previewDir, { recursive: true });
  await cdp.send("Page.navigate", {
    url: `http://127.0.0.1:${port}/_gif-preview.html?theme=${theme}&cache=${Date.now()}`,
  });
  for (let i = 0; i < 80; i++) {
    try {
      const { result } = await cdp.send("Runtime.evaluate", {
        expression: "document.querySelector('img')?.complete === true",
        returnByValue: true,
      });
      if (result?.value) break;
    } catch {
      // page may still be navigating
    }
    await sleep(100);
  }
  await sleep((durationForTheme(theme) / 2) * 1000);
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  const output = join(previewDir, `${theme}-mid.png`);
  await writeFile(output, Buffer.from(shot.data, "base64"));
  console.log(`wrote assets/examples/_preview/${theme}-mid.png`);
}

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);
  if (!findGifski()) {
    throw new Error("gifski not found. Install with: cargo install gifski");
  }

  const server = await startStaticServer();
  const port = server.address().port;
  const work = join(tmpdir(), `curtain-gif-${randomBytes(4).toString("hex")}`);
  await mkdir(work, { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--window-size=${WIDTH * SCALE},${HEIGHT * SCALE}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const cdp = await connectCdp();
    for (const theme of THEMES) {
      await captureTheme(cdp, port, theme, work);
    }

    console.log("encoding GIFs with gifski (quality 100, --extra)...");
    for (const theme of THEMES) await encodeTheme(work, theme);
    console.log("extracting decoded GIF previews...");
    for (const theme of THEMES) await extractGifPreview(cdp, port, theme);
    cdp.ws.close();
  } finally {
    chrome.kill("SIGTERM");
    server.close();
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
