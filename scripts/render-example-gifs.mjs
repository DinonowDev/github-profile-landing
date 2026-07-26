#!/usr/bin/env node
/**
 * Capture curtain-theme example frames via Chrome DevTools Protocol,
 * then assemble high-quality forever-looping GIFs entirely in Node.js.
 */
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { inflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const EXAMPLES = join(ROOT, "assets", "examples");
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const THEMES = ["cat", "spiderman", "batman"];
const DURATION = 7;
const HOLD = 0.8;
const FPS = 8;
const WIDTH = 920;
const HEIGHT = 500;
const DEBUG_PORT = 9229;

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

function frameTimes() {
  const step = 1 / FPS;
  const times = [];
  for (let t = 0; t <= DURATION + 1e-9; t += step) times.push(Number(t.toFixed(3)));
  const hold = Math.max(1, Math.round(HOLD * FPS));
  for (let i = 0; i < hold; i++) times.push(DURATION);
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

function quantizeMedianCut(rgba, width, height) {
  // A 15-bit histogram keeps median-cut fast while retaining 32 levels per
  // channel. Palette colors themselves use weighted averages of the original
  // 24-bit pixels, rather than fixed RGB-cube colors.
  const counts = new Uint32Array(32768);
  const sumR = new Uint32Array(32768);
  const sumG = new Uint32Array(32768);
  const sumB = new Uint32Array(32768);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const r = rgba[offset];
    const g = rgba[offset + 1];
    const b = rgba[offset + 2];
    const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
    counts[key]++;
    sumR[key] += r;
    sumG[key] += g;
    sumB[key] += b;
  }

  const colors = [];
  for (let key = 0; key < counts.length; key++) {
    if (counts[key]) {
      colors.push({
        key,
        count: counts[key],
        r: sumR[key] / counts[key],
        g: sumG[key] / counts[key],
        b: sumB[key] / counts[key],
      });
    }
  }

  const describe = (entries) => {
    let count = 0;
    let minR = 255, minG = 255, minB = 255;
    let maxR = 0, maxG = 0, maxB = 0;
    for (const color of entries) {
      count += color.count;
      minR = Math.min(minR, color.r);
      minG = Math.min(minG, color.g);
      minB = Math.min(minB, color.b);
      maxR = Math.max(maxR, color.r);
      maxG = Math.max(maxG, color.g);
      maxB = Math.max(maxB, color.b);
    }
    const ranges = [maxR - minR, maxG - minG, maxB - minB];
    return { entries, count, ranges, score: count * Math.max(...ranges) };
  };

  const boxes = [describe(colors)];
  while (boxes.length < 256) {
    let splitAt = -1;
    let bestScore = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].entries.length > 1 && boxes[i].score > bestScore) {
        bestScore = boxes[i].score;
        splitAt = i;
      }
    }
    if (splitAt < 0) break;
    const box = boxes.splice(splitAt, 1)[0];
    const channel = box.ranges.indexOf(Math.max(...box.ranges));
    const property = ["r", "g", "b"][channel];
    box.entries.sort((a, b) => a[property] - b[property]);
    const midpoint = box.count / 2;
    let accumulated = 0;
    let cut = 1;
    for (; cut < box.entries.length; cut++) {
      accumulated += box.entries[cut - 1].count;
      if (accumulated >= midpoint) break;
    }
    boxes.push(describe(box.entries.slice(0, cut)), describe(box.entries.slice(cut)));
  }

  const palette = Buffer.alloc(256 * 3);
  const colorMap = new Uint8Array(32768);
  boxes.forEach((box, index) => {
    let count = 0;
    let r = 0, g = 0, b = 0;
    for (const color of box.entries) {
      count += color.count;
      r += color.r * color.count;
      g += color.g * color.count;
      b += color.b * color.count;
      colorMap[color.key] = index;
    }
    palette[index * 3] = Math.round(r / count);
    palette[index * 3 + 1] = Math.round(g / count);
    palette[index * 3 + 2] = Math.round(b / count);
  });

  const indexes = Buffer.alloc(width * height);
  for (let pixel = 0, offset = 0; pixel < indexes.length; pixel++, offset += 4) {
    indexes[pixel] = colorMap[
      (rgba[offset] >> 3) << 10 | (rgba[offset + 1] >> 3) << 5 | (rgba[offset + 2] >> 3)
    ];
  }
  return { palette, indexes };
}

function lzwEncode(indexes, minCodeSize = 8) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dictionary = new Map();
  const bytes = [];
  let bits = 0;
  let bitCount = 0;

  const writeCode = (code) => {
    bits |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(bits & 255);
      bits >>>= 8;
      bitCount -= 8;
    }
  };

  writeCode(clearCode);
  let prefix = indexes[0];
  for (let i = 1; i < indexes.length; i++) {
    const symbol = indexes[i];
    const key = prefix * 256 + symbol;
    const found = dictionary.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }

    writeCode(prefix);
    if (nextCode < 4096) {
      dictionary.set(key, nextCode++);
      // GIF decoders skip a dictionary addition immediately after Clear, so
      // the encoder must grow one slot later than a naive implementation.
      if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      writeCode(clearCode);
      dictionary = new Map();
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
    }
    prefix = symbol;
  }
  writeCode(prefix);
  writeCode(endCode);
  if (bitCount) bytes.push(bits & 255);
  return Buffer.from(bytes);
}

function subBlocks(data) {
  const parts = [];
  for (let offset = 0; offset < data.length; offset += 255) {
    const chunk = data.subarray(offset, offset + 255);
    parts.push(Buffer.from([chunk.length]), chunk);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function validateGif(data, expectedFrames) {
  if (data.toString("ascii", 0, 6) !== "GIF89a") throw new Error("Invalid GIF header");
  const width = data.readUInt16LE(6);
  const height = data.readUInt16LE(8);
  if (width !== WIDTH || height !== HEIGHT) {
    throw new Error(`Invalid GIF dimensions: ${width}x${height}`);
  }
  let offset = 13;
  const globalFlags = data[10];
  if (globalFlags & 0x80) offset += 3 * (1 << ((globalFlags & 7) + 1));
  let frames = 0;
  let loopsForever = false;

  const readSubBlocks = () => {
    const chunks = [];
    while (true) {
      const length = data[offset++];
      if (length === 0) break;
      chunks.push(data.subarray(offset, offset + length));
      offset += length;
    }
    return Buffer.concat(chunks);
  };

  while (offset < data.length) {
    const marker = data[offset++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      const label = data[offset++];
      const payload = readSubBlocks();
      if (label === 0xff && payload.subarray(0, 11).toString("ascii") === "NETSCAPE2.0") {
        loopsForever = payload.length >= 14 && payload[11] === 1 && payload.readUInt16LE(12) === 0;
      }
      continue;
    }
    if (marker !== 0x2c) throw new Error(`Invalid GIF block marker 0x${marker.toString(16)}`);
    const frameWidth = data.readUInt16LE(offset + 4);
    const frameHeight = data.readUInt16LE(offset + 6);
    const flags = data[offset + 8];
    offset += 9;
    if (flags & 0x80) offset += 3 * (1 << ((flags & 7) + 1));
    const minCodeSize = data[offset++];
    const compressed = readSubBlocks();

    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = endCode + 1;
    let dictionary = [];
    let bitOffset = 0;
    let previous = null;
    let pixels = 0;
    const reset = () => {
      dictionary = Array.from({ length: clearCode }, (_, value) => ({ length: 1, first: value }));
      dictionary.length = endCode + 1;
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
      previous = null;
    };
    reset();

    while (bitOffset + codeSize <= compressed.length * 8) {
      let code = 0;
      for (let bit = 0; bit < codeSize; bit++) {
        code |= ((compressed[(bitOffset + bit) >> 3] >> ((bitOffset + bit) & 7)) & 1) << bit;
      }
      bitOffset += codeSize;
      if (code === clearCode) {
        reset();
        continue;
      }
      if (code === endCode) break;
      let entry = dictionary[code];
      if (!entry && code === nextCode && previous) {
        entry = { length: previous.length + 1, first: previous.first };
      }
      if (!entry) throw new Error(`Invalid LZW code ${code} in frame ${frames + 1}`);
      pixels += entry.length;
      if (previous && nextCode < 4096) {
        dictionary[nextCode++] = { length: previous.length + 1, first: previous.first };
        if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
      }
      previous = entry;
    }
    if (pixels !== frameWidth * frameHeight) {
      throw new Error(`Frame ${frames + 1} decoded ${pixels} pixels, expected ${frameWidth * frameHeight}`);
    }
    frames++;
  }
  if (!loopsForever) throw new Error("GIF is missing the NETSCAPE forever loop");
  if (frames !== expectedFrames) throw new Error(`GIF has ${frames} frames, expected ${expectedFrames}`);
  return { width, height, frames };
}

async function encodeTheme(frameDir, theme) {
  const times = frameTimes();
  const chunks = [
    Buffer.from("GIF89a", "ascii"),
    Buffer.from([WIDTH & 255, WIDTH >> 8, HEIGHT & 255, HEIGHT >> 8, 0x70, 0, 0]),
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from("NETSCAPE2.0", "ascii"),
    Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
  ];
  const delay = Math.max(2, Math.round(100 / FPS));

  for (let i = 0; i < times.length; i++) {
    const path = join(frameDir, `${theme}_${String(i).padStart(3, "0")}.png`);
    const png = readPng(await readFile(path), path);
    if (png.width !== WIDTH || png.height !== HEIGHT) {
      throw new Error(`Unexpected frame size ${png.width}x${png.height}: ${path}`);
    }
    const { palette, indexes } = quantizeMedianCut(png.rgba, png.width, png.height);
    const encoded = lzwEncode(indexes);
    chunks.push(
      Buffer.from([0x21, 0xf9, 0x04, 0x04, delay & 255, delay >> 8, 0x00, 0x00]),
      Buffer.from([0x2c, 0, 0, 0, 0, WIDTH & 255, WIDTH >> 8, HEIGHT & 255, HEIGHT >> 8, 0x87]),
      palette,
      Buffer.from([0x08]),
      subBlocks(encoded),
    );
  }
  chunks.push(Buffer.from([0x3b]));
  const output = join(EXAMPLES, `${theme}.gif`);
  const gif = Buffer.concat(chunks);
  validateGif(gif, times.length);
  await writeFile(output, gif);
  console.log(
    `wrote assets/examples/${theme}.gif (${Math.round(gif.length / 1024)} KB, ${times.length} frames, ${WIDTH}x${HEIGHT} verified)`,
  );
}

async function makeLoopingSvg(theme) {
  const src = join(EXAMPLES, `${theme}.svg`);
  let text = await readFile(src, "utf8");
  text = text.replaceAll('fill="freeze"', 'repeatCount="indefinite"');
  await writeFile(src, text);
}

async function captureTheme(cdp, port, theme, outDir) {
  const times = frameTimes();
  console.log(`capturing ${theme} (${times.length} frames)...`);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const url = `http://127.0.0.1:${port}/_frame.html?theme=${theme}&t=0`;
  await cdp.send("Page.navigate", { url });
  // Wait until the harness marks itself ready.
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
      expression: `(() => { const svg = document.querySelector('svg'); svg.pauseAnimations(); svg.setCurrentTime(${t}); document.title = 'ready:${theme}:${t}'; return true; })()`,
      returnByValue: true,
    });
    await sleep(30);
    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    await writeFile(join(outDir, `${theme}_${String(i).padStart(3, "0")}.png`), Buffer.from(shot.data, "base64"));
    if (i % 10 === 0) console.log(`  ${theme}: ${i + 1}/${times.length} t=${t}s`);
  }
}

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);

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
      `--window-size=${WIDTH},${HEIGHT}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const cdp = await connectCdp();
    for (const theme of THEMES) {
      await captureTheme(cdp, port, theme, work);
      await makeLoopingSvg(theme);
    }
    cdp.ws.close();

    console.log("encoding GIFs in Node.js...");
    for (const theme of THEMES) await encodeTheme(work, theme);
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
