import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import type { Plugin } from "vite";

/**
 * A plain .zip of a folder (deflate, no extras), so the built site can go to Netlify as one file by drag-and-drop.
 * Node has the deflate and the CRC; this writes the zip's own headers around them.
 */
export function zipFolder(dir: string, to: string): void {
  const files = walk(dir).sort();
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(relative(dir, file).split(sep).join("/"));
    const data = readFileSync(file);
    const packed = deflateRawSync(data);
    // version 2.0, UTF-8 names, deflate, a fixed 1980-01-01 stamp so the same site makes the same zip
    const local = head(0x04034b50, 30);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = head(0x02014b50, 46);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    local.copy(entry, 8, 6, 30);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    central.push(entry, name);
    offset += local.length + name.length + packed.length;
  }
  const dirBytes = Buffer.concat(central);
  const end = head(0x06054b50, 22);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(to, Buffer.concat([...locals, dirBytes, end]));
}

function head(signature: number, size: number): Buffer {
  const b = Buffer.alloc(size);
  b.writeUInt32LE(signature, 0);
  return b;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** After the build: dist.zip next to dist. */
export function zipDist(): Plugin {
  let outDir = "";
  return {
    name: "qa-zip-dist",
    apply: "build",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle: () => zipFolder(outDir, `${outDir}.zip`),
  };
}
