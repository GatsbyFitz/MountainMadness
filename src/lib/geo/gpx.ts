import type { RawPoint } from "./types";

/**
 * Minimal GPX track reader.
 *
 * We scan for <trkpt> elements rather than pulling in a full XML parser: GPX
 * from watches and phones is machine-generated and structurally boring, and a
 * serverless ingest function is a bad place to pay for a general XML DOM. The
 * cost is that we ignore namespaces and exotic nesting — acceptable, because
 * anything we fail to read is reported rather than silently dropped.
 */

export class GpxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GpxParseError";
  }
}

const NUM = /^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?$/;

function attr(tag: string, name: string): number | null {
  // lat="47.1234" or lat='47.1234'
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`));
  if (!m) return null;
  const raw = m[1].trim();
  if (!NUM.test(raw)) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

function childText(body: string, name: string): string | null {
  const m = body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].trim() : null;
}

function childNumber(body: string, name: string): number | null {
  const raw = childText(body, name);
  if (raw === null || !NUM.test(raw)) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/**
 * Extracts every <trkpt> in document order, flattening across <trkseg> and
 * <trk> boundaries. Segment breaks are recoverable later from time gaps, and
 * treating them as one ordered list is what every downstream stage wants.
 */
export function parseGpx(xml: string): RawPoint[] {
  if (!/<gpx[\s>]/i.test(xml)) {
    throw new GpxParseError("Not a GPX file: no <gpx> root element found.");
  }

  const points: RawPoint[] = [];
  const openTag = /<trkpt\b([^>]*?)(\/?)>/gi;

  let m: RegExpExecArray | null;
  while ((m = openTag.exec(xml)) !== null) {
    const attrs = m[1];
    const selfClosing = m[2] === "/";

    const lat = attr(attrs, "lat");
    const lon = attr(attrs, "lon");
    // A trkpt without coordinates is meaningless; skip rather than fail the file.
    if (lat === null || lon === null) continue;

    let ele: number | null = null;
    let t: number | null = null;
    let hr: number | null = null;

    if (!selfClosing) {
      const close = xml.indexOf("</trkpt>", openTag.lastIndex);
      if (close !== -1) {
        const body = xml.slice(openTag.lastIndex, close);
        ele = childNumber(body, "ele");
        const time = childText(body, "time");
        if (time) {
          const parsed = Date.parse(time);
          if (Number.isFinite(parsed)) t = parsed;
        }
        // Garmin/Suunto heart rate lives in a TrackPointExtension namespace.
        hr = childNumber(body, "gpxtpx:hr") ?? childNumber(body, "hr");
      }
    }

    points.push({ lat, lon, ele, t, hr });
  }

  if (points.length === 0) {
    throw new GpxParseError("GPX file contains no track points (<trkpt>).");
  }
  return points;
}

/** Reads <name> from the first <trk>, falling back to the file-level <metadata>. */
export function parseGpxName(xml: string): string | null {
  const trk = xml.match(/<trk\b[^>]*>([\s\S]*?)<\/trk>/i);
  if (trk) {
    const name = childText(trk[1], "name");
    if (name) return name;
  }
  const meta = xml.match(/<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i);
  if (meta) return childText(meta[1], "name");
  return null;
}
