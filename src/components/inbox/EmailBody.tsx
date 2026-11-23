import { useMemo, useState } from "react";
import { Box, Text } from "@mantine/core";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { openExternalUrl } from "../../lib/openExternal";

type Block =
  | { kind: "text"; text: string }
  | { kind: "quote"; header: string | null; lines: string[] }
  | { kind: "sig"; text: string };

const QUOTE_LINE_RE = /^\s*(?:>|&gt;)/;
const SIG_DELIM_RE = /^\s*--\s*$/;

// Klasszikus email-idézet fejlécek (Gmail, Outlook, magyar kliensek)
const SEPARATOR_RES = [
  /^\s*On\b.+wrote:\s*$/i, // Gmail: On Tue, ... wrote:
  /^\s*.+írta:\s*$/i, // magyar: ... írta:
  /^\s*Feladó:.*$/i, // továbbított fejlécblokk kezdete
  /^\s*From:.*$/i,
  /^-{2,}.*(Original Message|Eredeti üzenet|Továbbított|Forwarded).*/i,
  /^\s*_{5,}\s*$/,
  /^-{5,}\s*$/,
  /^\s*Begin forwarded message/i,
  /^\s*Továbbított üzenet/i,
  /^\s*Eredeti üzenet\s*:?\s*$/i,
];

const URL_RE = /(https?:\/\/[^\s<>()"']+|www\.[^\s<>()"']+)/gi;

function isSeparator(line: string): boolean {
  return SEPARATOR_RES.some((re) => re.test(line));
}

function stripQuoteMarkers(line: string): string {
  return line.replace(/^\s*(?:(?:>|&gt;)\s*)+/, "");
}

/** Linkesítés: URL-eket kattinthatóvá tesz, végükről levágja a központozást. */
export function linkify(text: string, keyPrefix: string): React.ReactNode[] {
  URL_RE.lastIndex = 0;
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const raw = m[0];
    const trimmed = raw.replace(/[.,;:!?)\]]+$/, "");
    const trail = raw.slice(trimmed.length);
    const href = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
    out.push(
      <a
        key={`${keyPrefix}-${k++}`}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="ml-mail-link"
      >
        {trimmed}
      </a>
    );
    if (trail) out.push(trail);
    last = m.index + raw.length;
  }
  out.push(text.slice(last));
  return out;
}

function parseEmailBody(body: string): Block[] {
  const lines = (body || "").split("\n");
  const blocks: Block[] = [];
  let textBuf: string[] = [];
  const flushText = () => {
    const t = textBuf.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
    // Csak nem üres (nem csupa whitespace) blokkot tartunk meg
    if (t.trim()) blocks.push({ kind: "text", text: t.replace(/^\n+/, "") });
    textBuf = [];
  };

  // Idézet-gyűjtés i-től: egymást követő `>`-os sorok (üres sor átugorható, ha utána folytatódik)
  const collectMarkedQuote = (from: number): { lines: string[]; next: number } => {
    const q: string[] = [];
    let j = from;
    while (j < lines.length) {
      const ln = lines[j];
      if (QUOTE_LINE_RE.test(ln)) {
        q.push(stripQuoteMarkers(ln));
        j++;
      } else if (
        ln.trim() === "" &&
        j + 1 < lines.length &&
        QUOTE_LINE_RE.test(lines[j + 1])
      ) {
        q.push("");
        j++;
      } else {
        break;
      }
    }
    return { lines: q, next: j };
  };

  let i = 0;
  // Aláírás-elválasztó: az első `-- ` sortól minden aláírás
  while (i < lines.length) {
    const line = lines[i];
    if (SIG_DELIM_RE.test(line)) {
      flushText();
      const sig = lines.slice(i + 1).join("\n").trim();
      if (sig) blocks.push({ kind: "sig", text: sig });
      return blocks;
    }
    if (isSeparator(line)) {
      flushText();
      const header = line.trim();
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j < lines.length && QUOTE_LINE_RE.test(lines[j])) {
        const { lines: q, next } = collectMarkedQuote(j);
        if (q.join("").trim()) blocks.push({ kind: "quote", header, lines: q });
        i = next;
        continue;
      }
      // Jelöletlen folytatás (pl. továbbított üzenet sima szöveggel): a levél végéig idézet
      const rest = lines.slice(j).join("\n").trim();
      if (rest) blocks.push({ kind: "quote", header, lines: rest.split("\n") });
      return blocks;
    }
    if (QUOTE_LINE_RE.test(line)) {
      flushText();
      const { lines: q, next } = collectMarkedQuote(i);
      if (q.join("").trim()) blocks.push({ kind: "quote", header: null, lines: q });
      i = next;
      continue;
    }
    textBuf.push(line);
    i++;
  }
  flushText();
  return blocks;
}

function QuoteBlock({ header, lines }: { header: string | null; lines: string[] }) {
  const [open, setOpen] = useState(lines.length <= 3);
  const label = header || "Korábbi üzenet";
  return (
    <Box className="ml-quote">
      {lines.length > 3 && (
        <button
          type="button"
          className="ml-quote-toggle"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
          <span>
            {open ? "Idézet elrejtése" : `${label} · ${lines.length} sor`}
          </span>
        </button>
      )}
      {open && (
        <Box className="ml-quote-body">
          {lines.map((ln, idx) =>
            ln.trim() === "" ? (
              <Box key={idx} h={6} />
            ) : (
              <Text key={idx} size="12.5px" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                {linkify(ln, `q${idx}`)}
              </Text>
            )
          )}
        </Box>
      )}
    </Box>
  );
}

export function EmailBody({ body, hideQuoted }: { body: string; hideQuoted?: boolean }) {
  const blocks = useMemo(() => parseEmailBody(body || ""), [body]);
  const visible = hideQuoted ? blocks.filter((b) => b.kind !== "quote") : blocks;
  if (visible.length === 0) {
    if (!hideQuoted) return null;
    return (
      <Text size="12px" c="dimmed" fs="italic">
        Csak idézett előzmény — kattints a teljes levélhez.
      </Text>
    );
  }
  // Tauri-ban a sima <a target="_blank"> nem nyit külső böngészőt,
  // ezért a linkkattintásokat itt kapjuk el és az opener pluginnal nyitjuk.
  const handleClick = (e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]");
    if (anchor) {
      e.preventDefault();
      void openExternalUrl(anchor.getAttribute("href"));
    }
  };
  return (
    <Box className="ml-email-body" onClick={handleClick}>
      {visible.map((b, idx) => {
        if (b.kind === "quote") {
          return <QuoteBlock key={idx} header={b.header} lines={b.lines} />;
        }
        if (b.kind === "sig") {
          return (
            <Text key={idx} size="12px" c="dimmed" className="ml-sig">
              {linkify(b.text, `s${idx}`)}
            </Text>
          );
        }
        return (
          <Text key={idx} size="13.5px" style={{ whiteSpace: "pre-wrap", lineHeight: 1.65 }}>
            {linkify(b.text, `t${idx}`)}
          </Text>
        );
      })}
    </Box>
  );
}
