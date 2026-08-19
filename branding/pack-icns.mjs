/**
 * Pack PNGs into a macOS .icns file.
 *
 * Exists because the usual tool for this, png2icns from icnsutils, is not
 * always installable on the machine doing the rendering — and ImageMagick's
 * own ICNS writer quietly emits a plain PNG under an .icns name, which macOS
 * will not read. Modern .icns simply embeds PNG data per size, so packing it
 * directly is a few lines and removes the dependency.
 *
 * Format: "icns" + total length, then chunks of [4-byte type][4-byte length
 * including these 8 bytes][PNG bytes]. Both lengths are big-endian.
 *
 * Usage: node branding/pack-icns.mjs out.icns 16=a.png 32=b.png ...
 */
import { readFileSync, writeFileSync } from "node:fs";

/** OSType per pixel size, using the PNG-capable entries only. */
const TYPE_FOR_SIZE = {
  16: "icp4",
  32: "icp5",
  64: "ic12",
  128: "ic07",
  256: "ic08",
  512: "ic09",
  1024: "ic10",
};

const [out, ...pairs] = process.argv.slice(2);
if (!out || pairs.length === 0) {
  console.error("usage: node pack-icns.mjs out.icns 16=a.png 32=b.png ...");
  process.exit(1);
}

const chunks = [];
for (const pair of pairs) {
  const [size, file] = pair.split("=");
  const type = TYPE_FOR_SIZE[Number(size)];
  if (!type) {
    console.error(`no .icns entry type for size ${size}`);
    process.exit(1);
  }
  const png = readFileSync(file);
  if (png.subarray(1, 4).toString("latin1") !== "PNG") {
    console.error(`${file} is not a PNG`);
    process.exit(1);
  }
  const header = Buffer.alloc(8);
  header.write(type, 0, "latin1");
  header.writeUInt32BE(png.length + 8, 4);
  chunks.push(Buffer.concat([header, png]));
}

const body = Buffer.concat(chunks);
const header = Buffer.alloc(8);
header.write("icns", 0, "latin1");
header.writeUInt32BE(body.length + 8, 4);
writeFileSync(out, Buffer.concat([header, body]));

console.log(`${out}: ${pairs.length} sizes, ${(body.length + 8) / 1024 | 0} KB`);
