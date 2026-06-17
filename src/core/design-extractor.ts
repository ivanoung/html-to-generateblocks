// ── Design Evidence Extractor ──────────────────────────────
//
// Extracts design tokens from a rendered HTML page.
// Three parts:
//   1. colorToHex() — normalize any CSS color format to #rrggbb (pure, testable)
//   2. parseJsObjectLiteral() — parse JS object literal from string (no eval)
//   3. extractConfigFromHtml() — find tailwind.config in <script> tags
//   4. buildExtractionScript() — stringified IIFE for page.evaluate()

// ── Color Format Normalization ─────────────────────────────

/**
 * Normalize any CSS color format to #rrggbb.
 * Handles: #hex, rgb(), rgba(), hsl(), hsla(), oklch(), color-mix().
 * Returns null for transparent, currentColor, or unparseable values.
 */
export function colorToHex(cssColor: string): string | null {
  if (!cssColor) return null;
  const c = cssColor.trim().toLowerCase();

  // transparent / currentColor → skip
  if (c === "transparent" || c === "rgba(0, 0, 0, 0)" || c === "currentcolor") return null;

  // #hex
  let hm = c.match(/^#([0-9a-f]{3,8})$/);
  if (hm) {
    let h = hm[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    else if (h.length === 8) h = h.slice(0, 6);
    return "#" + h.slice(0, 6).toLowerCase();
  }

  // rgb() / rgba() — both comma and space-separated; allow negative (clamped later)
  let rm = c.match(/rgba?\s*\(\s*([\d.-]+)[,\s]+([\d.-]+)[,\s]+([\d.-]+)/);
  if (rm) {
    return rgbChannelsToHex(rm[1], rm[2], rm[3]);
  }

  // hsl() / hsla()
  let hsm = c.match(/hsla?\s*\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/);
  if (hsm) {
    const h = parseFloat(hsm[1]) / 360;
    const s = parseFloat(hsm[2]) / 100;
    const l = parseFloat(hsm[3]) / 100;
    return hslToHex(h, s, l);
  }

  // oklch()
  let om = c.match(/oklch\s*\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (om) {
    try {
      return oklchToHex(parseFloat(om[1]), parseFloat(om[2]), parseFloat(om[3]));
    } catch {
      return null;
    }
  }

  // color-mix() — extract first color argument (just the color value, not percentages)
  let mm = c.match(/color-mix\s*\([^,]*,\s*([^\s,\)]+)/);
  if (mm) return colorToHex(mm[1].trim());

  return null;
}

function rgbChannelsToHex(r: string, g: string, b: string): string {
  return "#" + [r, g, b].map((x) => {
    const n = Math.min(255, Math.max(0, Math.round(parseFloat(x))));
    return n.toString(16).padStart(2, "0");
  }).join("");
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color);
  };
  return "#" + [f(0), f(8), f(4)].map((n) =>
    Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")
  ).join("");
}

function oklchToHex(l: number, c: number, h: number): string {
  const hRad = (h * Math.PI) / 180;
  const aVal = c * Math.cos(hRad);
  const bVal = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * aVal + 0.2158037573 * bVal;
  const m_ = l - 0.1055613458 * aVal - 0.0638541728 * bVal;
  const s_ = l - 0.0894841775 * aVal - 1.291485548 * bVal;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const rLin = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  const toSrgb = (x: number) => {
    const v = Math.max(0, Math.min(1, x));
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  };

  return "#" + [toSrgb(rLin), toSrgb(gLin), toSrgb(bLin)]
    .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
    .join("");
}

// ── JS Object Literal Parser ───────────────────────────────

/**
 * Parse a JavaScript object literal string into a Record.
 * Handles unquoted keys, single/double-quoted strings, nested objects,
 * arrays, numbers, booleans, null, trailing commas.
 * No eval() — character-by-character parsing with brace-depth tracking.
 */
export function parseJsObjectLiteral(raw: string): Record<string, unknown> {
  let i = raw.indexOf("{");
  if (i === -1) return {};

  function parseValue(start: number): { value: unknown; next: number } {
    // Skip whitespace
    while (start < raw.length && /\s/.test(raw[start])) start++;
    if (start >= raw.length) return { value: undefined, next: start };

    const ch = raw[start];

    // String (single or double quoted)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = start + 1;
      while (j < raw.length) {
        if (raw[j] === "\\") { j += 2; continue; }
        if (raw[j] === quote) return { value: raw.slice(start + 1, j), next: j + 1 };
        j++;
      }
      return { value: raw.slice(start + 1), next: raw.length };
    }

    // Object
    if (ch === "{") {
      const obj: Record<string, unknown> = {};
      let j = start + 1;
      while (j < raw.length) {
        // Skip whitespace
        while (j < raw.length && /\s/.test(raw[j])) j++;
        if (j >= raw.length) break;
        if (raw[j] === "}") return { value: obj, next: j + 1 };
        if (raw[j] === ",") { j++; continue; }

        // Parse key (unquoted identifier or quoted string)
        let key: string;
        if (raw[j] === '"' || raw[j] === "'") {
          const r = parseValue(j);
          key = String(r.value);
          j = r.next;
        } else {
          const m = raw.slice(j).match(/^(\w+)/);
          if (!m) break;
          key = m[1];
          j += m[0].length;
        }

        // Skip colon
        while (j < raw.length && /\s/.test(raw[j])) j++;
        if (raw[j] === ":") j++;

        // Parse value
        const r = parseValue(j);
        obj[key] = r.value;
        j = r.next;
      }
      return { value: obj, next: j };
    }

    // Array
    if (ch === "[") {
      const arr: unknown[] = [];
      let j = start + 1;
      while (j < raw.length) {
        while (j < raw.length && /\s/.test(raw[j])) j++;
        if (raw[j] === "]") return { value: arr, next: j + 1 };
        if (raw[j] === ",") { j++; continue; }
        const r = parseValue(j);
        arr.push(r.value);
        j = r.next;
      }
      return { value: arr, next: j };
    }

    // Number (including negative and decimals)
    const numMatch = raw.slice(start).match(/^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (numMatch) {
      return { value: parseFloat(numMatch[1]), next: start + numMatch[0].length };
    }

    // Unquoted identifier (true, false, null, undefined, or plain word)
    const idMatch = raw.slice(start).match(/^(\w+)/);
    if (idMatch) {
      const word = idMatch[1];
      if (word === "true") return { value: true, next: start + 4 };
      if (word === "false") return { value: false, next: start + 5 };
      if (word === "null") return { value: null, next: start + 4 };
      if (word === "undefined") return { value: undefined, next: start + 9 };
      return { value: word, next: start + word.length };
    }

    return { value: undefined, next: start + 1 };
  }

  const result = parseValue(i);
  return (result.value as Record<string, unknown>) || {};
}

// ── Config Extraction from HTML ────────────────────────────

export interface ExtractedConfig {
  colors: Record<string, string>;
  fontFamily: Record<string, string[]>;
  maxWidth: Record<string, string>;
}

/**
 * Extract tailwind.config values from <script> tags in raw HTML.
 * Parses the JS object literal, navigates to theme.colors / theme.extend.colors,
 * theme.fontFamily, theme.maxWidth.
 * For shade objects (e.g. slate: { 800: "#272f31" }), picks DEFAULT or '500'
 * or the first numeric key as fallback.
 */
export function extractConfigFromHtml(rawHtml: string): ExtractedConfig | null {
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(rawHtml)) !== null) {
    const content = match[1];
    const configIdx = content.indexOf("tailwind.config");
    if (configIdx === -1) continue;

    const afterAssign = content.indexOf("=", configIdx);
    if (afterAssign === -1) continue;

    const parsed = parseJsObjectLiteral(content.slice(afterAssign + 1));
    const theme = (parsed.theme || parsed) as Record<string, unknown>;
    const extend = (theme.extend || {}) as Record<string, unknown>;

    const result: ExtractedConfig = {
      colors: {},
      fontFamily: {},
      maxWidth: {},
    };

    // Colors: check theme.colors first, then theme.extend.colors
    const colors = (theme.colors || extend.colors || {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(colors)) {
      if (typeof v === "string") {
        result.colors[k] = v;
      } else if (typeof v === "object" && v !== null) {
        const shadeObj = v as Record<string, unknown>;
        const shade = shadeObj["DEFAULT"] ?? shadeObj["500"] ?? Object.values(shadeObj).find((sv) => typeof sv === "string");
        if (typeof shade === "string") result.colors[k] = shade;
      }
    }

    // Font families
    const fonts = (theme.fontFamily || extend.fontFamily || {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(fonts)) {
      if (Array.isArray(v)) result.fontFamily[k] = v as string[];
    }

    // Max widths
    const mw = (theme.maxWidth || extend.maxWidth || {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(mw)) {
      if (typeof v === "string") result.maxWidth[k] = v;
    }

    return result;
  }

  return null;
}

// ── Playwright Extraction Script (IIFE) ────────────────────

/**
 * Build a stringified IIFE that extracts design evidence from the
 * live DOM. Designed to be passed to page.evaluate().
 *
 * Extracts: colors (computed bg/text), fonts (semantic elements),
 * CSS custom properties, Google Fonts <link> tags, container candidates
 * (centered, max-width elements), typography samples (body, h1-h6, a, button).
 *
 * Does NOT read window.tailwind.config — config is extracted separately
 * via extractConfigFromHtml() on the Node.js side.
 */
export function buildExtractionScript(): string {
  return `(function() {
    var result = {
      colors: [],
      fonts: [],
      containers: [],
      customProperties: [],
      googleFonts: [],
      typographySamples: [],
      tailwindConfig: null,
      extracted: true,
      warnings: []
    };

    try {

    // ── 0. Pseudo-class warning ────────────────────────────
    result.warnings.push(
      "Pseudo-class colors (:hover, :focus, :active) are not captured by getComputedStyle"
    );

    // ── 1. Extract all computed colors ─────────────────────
    var colorMap = new Map();
    var allElements = document.querySelectorAll('body, body *');
    var maxElements = 500;

    for (var i = 0; i < Math.min(allElements.length, maxElements); i++) {
      var el = allElements[i];
      var cs = window.getComputedStyle(el);

      [cs.backgroundColor, cs.color].forEach(function(rawColor, idx) {
        if (!rawColor) return;
        var hex = colorToHex(rawColor);
        if (!hex) return;

        var existing = colorMap.get(hex);
        if (existing) {
          existing.count++;
          if (existing.roles.length < 5) {
            var role = idx === 0 ? classifyBgRole(el) : classifyTextRole(el);
            if (existing.roles.indexOf(role) === -1) existing.roles.push(role);
          }
          if (existing.examples.length < 5) {
            existing.examples.push(getElementPath(el));
          }
        } else {
          colorMap.set(hex, {
            hex: hex,
            count: 1,
            roles: [idx === 0 ? classifyBgRole(el) : classifyTextRole(el)],
            examples: [getElementPath(el)]
          });
        }
      });
    }

    result.colors = Array.from(colorMap.values()).sort(function(a, b) {
      return b.count - a.count;
    });

    // ── 2. Font families on semantic elements ──────────────
    var fontMap = new Map();
    var tags = ['body', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'button'];
    tags.forEach(function(tag) {
      var els = document.querySelectorAll(tag);
      for (var i = 0; i < els.length; i++) {
        var cs = window.getComputedStyle(els[i]);
        var ff = cs.fontFamily;
        if (!ff) continue;
        var norm = ff.split(',')[0].trim().replace(/['"]/g, '');
        var role = tag;
        var existing = fontMap.get(norm);
        if (existing) {
          if (existing.roles.indexOf(role) === -1) existing.roles.push(role);
        } else {
          fontMap.set(norm, {
            fontFamily: ff,
            roles: [role],
            sampleSize: cs.fontSize,
            sampleWeight: cs.fontWeight
          });
        }
      }
    });
    result.fonts = Array.from(fontMap.values());

    // ── 3. CSS custom properties ───────────────────────────
    var contexts = [document.documentElement, document.body];
    var propSet = new Set();
    contexts.forEach(function(ctx) {
      if (!ctx) return;
      var cs = window.getComputedStyle(ctx);
      for (var j = 0; j < cs.length && propSet.size < 100; j++) {
        var propName = cs[j];
        if (propName.indexOf('--') === 0 && !propSet.has(propName)) {
          propSet.add(propName);
          result.customProperties.push({
            name: propName,
            value: cs.getPropertyValue(propName).trim(),
            context: ctx === document.documentElement ? ':root' : 'body'
          });
        }
      }
    });

    // ── 4. Google Fonts ────────────────────────────────────
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function(link) {
      var href = link.getAttribute('href') || '';
      if (href.indexOf('fonts.googleapis.com') !== -1) {
        result.googleFonts.push({
          family: extractGoogleFontFamily(href),
          variants: extractGoogleFontVariants(href),
          href: href
        });
      }
    });

    // ── 5. Container candidates (centered, reasonable width) ──
    var containerEls = document.querySelectorAll(
      '[class*="container"], [class*="max-w-"], .mx-auto, main, .wrapper, #content'
    );
    var seenWidths = new Set();
    var candidates = [];
    for (var ci = 0; ci < containerEls.length && candidates.length < 10; ci++) {
      var el = containerEls[ci];
      var cs = window.getComputedStyle(el);
      var maxW = parseInt(cs.maxWidth, 10);

      if (!maxW || maxW < 400 || maxW > 2500) continue;
      var ml = cs.marginLeft;
      var mr = cs.marginRight;
      if (ml !== mr && ml !== 'auto' && mr !== 'auto') continue;

      if (!seenWidths.has(maxW)) {
        seenWidths.add(maxW);
        candidates.push({
          px: maxW,
          source: 'computed',
          selector: getShortSelector(el)
        });
      }
    }
    result.containers = candidates;

    // ── 6. Typography samples ──────────────────────────────
    ['body', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'button'].forEach(function(tag) {
      var el = document.querySelector(tag);
      if (!el) return;
      var cs = window.getComputedStyle(el);
      result.typographySamples.push({
        selector: tag, tagName: tag,
        fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight, fontFamily: cs.fontFamily,
        textTransform: cs.textTransform, letterSpacing: cs.letterSpacing
      });
    });

    } catch(e) {
      result.warnings.push('Extraction error: ' + e.message);
      result.extracted = false;
    }

    return JSON.stringify(result);

    // ── Color normalization (embedded in IIFE) ─────────────
    function colorToHex(raw) {
      if (!raw) return null;
      var c = raw.trim().toLowerCase();

      if (c === 'transparent' || c === 'rgba(0, 0, 0, 0)' || c === 'currentcolor') return null;

      var hm = c.match(/^#([0-9a-f]{3,8})$/);
      if (hm) {
        var h = hm[1];
        if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
        else if (h.length === 8) h = h.slice(0, 6);
        return '#' + h.slice(0, 6).toLowerCase();
      }

      var rm = c.match(/rgba?\\s*\\(\\s*([\\d.-]+)[,\\s]+([\\d.-]+)[,\\s]+([\\d.-]+)/);
      if (rm) {
        return '#' + [rm[1], rm[2], rm[3]].map(function(x) {
          var n = Math.min(255, Math.max(0, Math.round(parseFloat(x))));
          return n.toString(16).padStart(2, '0');
        }).join('');
      }

      var hsm = c.match(/hsla?\\s*\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)%[,\\s]+([\\d.]+)%/);
      if (hsm) {
        var hh = parseFloat(hsm[1]) / 360;
        var ss = parseFloat(hsm[2]) / 100;
        var ll = parseFloat(hsm[3]) / 100;
        return hslToHex(hh, ss, ll);
      }

      var om = c.match(/oklch\\s*\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)/);
      if (om) {
        try { return oklchToHex(parseFloat(om[1]), parseFloat(om[2]), parseFloat(om[3])); }
        catch(e) { return null; }
      }

      var mm = c.match(/color-mix\\s*\\([^,]*,\\s*([^\\s,\\\)]+)/);
      if (mm) return colorToHex(mm[1].trim());

      return null;
    }

    function hslToHex(h, s, l) {
      var a = s * Math.min(l, 1 - l);
      var f = function(n) {
        var k = (n + h * 12) % 12;
        var color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color);
      };
      return '#' + [f(0), f(8), f(4)].map(function(n) {
        return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
      }).join('');
    }

    function oklchToHex(l, c, h) {
      var hRad = (h * Math.PI) / 180;
      var aVal = c * Math.cos(hRad);
      var bVal = c * Math.sin(hRad);
      var l_ = l + 0.3963377774 * aVal + 0.2158037573 * bVal;
      var m_ = l - 0.1055613458 * aVal - 0.0638541728 * bVal;
      var s_ = l - 0.0894841775 * aVal - 1.291485548 * bVal;
      var l3 = l_ * l_ * l_, m3 = m_ * m_ * m_, s3 = s_ * s_ * s_;
      var rLin = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
      var gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
      var bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;
      var toSrgb = function(x) {
        var v = Math.max(0, Math.min(1, x));
        return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1/2.4) - 0.055));
      };
      return '#' + [toSrgb(rLin), toSrgb(gLin), toSrgb(bLin)].map(function(n) {
        return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
      }).join('');
    }

    // ── Role classifiers ───────────────────────────────────
    function classifyBgRole(el) {
      if (el === document.body) return 'body-bg';
      if (el.tagName === 'BUTTON' || el.closest('button')) return 'button';
      if (el.tagName === 'HEADER' || el.closest('header')) return 'header';
      if (el.tagName === 'FOOTER' || el.closest('footer')) return 'footer';
      if (el.tagName === 'NAV' || el.closest('nav')) return 'nav';
      if (/^H[1-6]$/.test(el.tagName)) return 'heading';
      if (el.closest('a')) return 'link';
      return 'generic';
    }

    function classifyTextRole(el) {
      if (/^H[1-6]$/.test(el.tagName)) return 'heading';
      if (el.tagName === 'A' || el.closest('a')) return 'link';
      if (el === document.body) return 'body-text';
      return 'generic';
    }

    function getElementPath(el) {
      var path = el.tagName.toLowerCase();
      if (el.id) path += '#' + el.id;
      else if (el.className && typeof el.className === 'string') {
        var cls = el.className.split(/\\s+/).slice(0, 2).join('.');
        if (cls) path += '.' + cls;
      }
      return path;
    }

    function getShortSelector(el) {
      var sel = el.tagName.toLowerCase();
      if (el.id) sel += '#' + el.id;
      else if (el.className && typeof el.className === 'string') {
        var c = el.className.split(/\\s+/)[0];
        if (c) sel += '.' + c;
      }
      return sel;
    }

    function extractGoogleFontFamily(href) {
      var m = href.match(/family=([^&:]+)/);
      return m ? decodeURIComponent(m[1].replace(/\\+/g, ' ')) : '';
    }

    function extractGoogleFontVariants(href) {
      var m = href.match(/family=[^:]+:([^&]+)/);
      return m ? m[1].split(';').filter(Boolean) : ['400'];
    }
  })()`;
}
