/* [codex] Read larger legacy JSON archives without materializing the complete JSON source string. */
import {
  MAX_MEDIA,
  MAX_METADATA,
  MAX_PROJECT_MEDIA,
  decodeAssetSource,
  packProject,
  unpackProject,
} from '../media.js';

const READ = 256 * 1024;
const DATA_TOKEN = 4 * Math.ceil(MAX_MEDIA / 3) + 1024 * 1024;
const invalid = () => Error('Eski arşiv geçerli bir rölöve JSON’u içermiyor.');
const tooLarge = () => Error('Eski arşiv proje veya ek boyut sınırını aşıyor.');

// Closing quotes preceded by an odd run of backslashes are part of a JSON string.
function endQuote(text, from, carry) {
  for (let at = text.indexOf('"', from); at >= 0; at = text.indexOf('"', at + 1)) {
    let slash = at;
    while (slash > from && text[slash - 1] === '\\') slash--;
    if ((at - slash + (slash === from && carry ? 1 : 0)) % 2 === 0) return at;
  }
  return -1;
}
function remainingEscape(text, carry) {
  let i = text.length;
  while (i > 0 && text[i - 1] === '\\') i--;
  return (text.length - i + (i === 0 && carry ? 1 : 0)) % 2 !== 0;
}
export async function readClassic(blob) {
  const decoder = new TextDecoder('utf-8', { fatal: true }),
    metadata = [],
    sources = new Map();
  let plain = '',
    metadataChars = 0,
    mediaBytes = 0,
    inside = false,
    carry = false,
    lastKey = '',
    isData = false,
    nextData = false;
  let fragments = [],
    tokenChars = 0;
  function write(text) {
    metadataChars += text.length;
    if (metadataChars > MAX_METADATA) throw tooLarge();
    plain += text;
    if (plain.length >= READ) {
      metadata.push(plain);
      plain = '';
    }
  }
  function outside(text) {
    // Indentation in R7 backups does not consume the canonical project metadata budget.
    const compact = text.replace(/[ \t\r\n]+/g, ' ').replace(/ *([{}\[\],:]) */g, '$1');
    write(compact);
    const codes = text.trim();
    if (!codes) return;
    if (lastKey === '$roleveMedia' && codes.startsWith(':')) throw invalid();
    nextData = lastKey === 'data' && codes === ':';
    lastKey = '';
  }
  function appendToken(text) {
    if (!text) return;
    tokenChars += text.length;
    if (tokenChars > (isData ? DATA_TOKEN : MAX_METADATA)) throw tooLarge();
    fragments.push(text);
  }
  async function finishToken() {
    const quoted = '"' + fragments.join('') + '"';
    fragments = [];
    tokenChars = 0;
    let parsed;
    if (isData || quoted.length < 96) {
      try {
        parsed = JSON.parse(quoted);
      } catch {
        throw invalid();
      }
    }
    lastKey = parsed === 'data' || parsed === '$roleveMedia' ? parsed : '';
    if (isData && parsed.slice(0, 5).toLowerCase() === 'data:') {
      const { document } = await packProject({ data: parsed }, { sourcesOnly: true });
      const ref = document.data.$roleveMedia;
      if (!sources.has(ref.sha256)) {
        mediaBytes += ref.size;
        if (mediaBytes > MAX_PROJECT_MEDIA) throw tooLarge();
        sources.set(ref.sha256, parsed);
      }
      write(JSON.stringify(document.data));
    } else write(quoted);
  }
  for (let at = 0; at < blob.size; at += READ) {
    let text;
    try {
      text = decoder.decode(await blob.slice(at, at + READ).arrayBuffer(), { stream: at + READ < blob.size });
    } catch {
      throw invalid();
    }
    let pos = 0;
    while (pos < text.length) {
      if (!inside) {
        const quote = text.indexOf('"', pos);
        outside(text.slice(pos, quote < 0 ? text.length : quote));
        if (quote < 0) break;
        inside = true;
        carry = false;
        isData = nextData;
        nextData = false;
        lastKey = '';
        pos = quote + 1;
      } else {
        const end = endQuote(text, pos, carry);
        if (end < 0) {
          const tail = text.slice(pos);
          appendToken(tail);
          carry = remainingEscape(tail, carry);
          break;
        }
        appendToken(text.slice(pos, end));
        await finishToken();
        inside = false;
        pos = end + 1;
      }
    }
  }
  if (inside) throw invalid();
  if (plain) metadata.push(plain);
  const document = new Blob(metadata);
  if (document.size > MAX_METADATA) throw tooLarge();
  let raw;
  try {
    raw = JSON.parse(await document.text());
  } catch {
    throw invalid();
  }
  const project = raw?.schemaVersion === 1 ? raw : raw?.project;
  if (!project) throw invalid();
  return unpackProject(project, (sha) => {
    const source = sources.get(sha);
    if (!source) throw invalid();
    sources.delete(sha);
    return decodeAssetSource(source);
  });
}
