/**
 * iCalendar (RFC 5545) 生成ヘルパ
 *
 * 招待メールに添付する .ics ファイルを最小実装で組み立てる。
 * 外部ライブラリは導入せず、必要な部分だけ手書きで安全に。
 *
 * 実装範囲:
 *   ・VCALENDAR > VEVENT 1 件
 *   ・SUMMARY / DESCRIPTION / DTSTART / DTEND / DTSTAMP / UID / LOCATION
 *   ・ORGANIZER / ATTENDEE(必要に応じて)
 *   ・STATUS(CANCELLED 通知に対応)
 *   ・SEQUENCE(更新ごとに +1)
 *
 * 仕様で守るべき点:
 *   ・改行は CRLF
 *   ・1 行は 75 オクテット(マルチバイト含む)で折り返し、続行行は ` ` で始める
 *   ・TEXT 値のエスケープ:`\` → `\\`、`;` `,` `\n` も適切にエスケープ
 *   ・UTC 表記は YYYYMMDDTHHMMSSZ
 *
 * 参照:
 *   https://datatracker.ietf.org/doc/html/rfc5545
 */

const CRLF = "\r\n";

/** RFC 5545 の TEXT 値エスケープ。 */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * ISO 8601 / Date を YYYYMMDDTHHMMSSZ(UTC)に整形する。
 * タイムゾーン情報を持つ ISO 文字列を渡す前提。
 */
export function formatIcsUtc(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * 1 行を 75 オクテット(UTF-8 でのバイト長)以内に折り返す。
 * 続行行はスペース 1 つで始める。
 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(line);
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let cursor = 0;
  // ASCII 限定なら 75 で切ればよいが、マルチバイトを含むので
  // 「文字単位で進めて、byte 長が 75 を超える直前で区切る」ロジックにする。
  while (cursor < line.length) {
    let take = 0;
    let used = 0;
    const limit = out.length === 0 ? 75 : 74; // 続行行はスペース 1 octet 消費
    while (cursor + take < line.length) {
      const ch = line[cursor + take];
      const chLen = enc.encode(ch).length;
      if (used + chLen > limit) break;
      used += chLen;
      take += 1;
    }
    if (take === 0) {
      // 1 文字も入らない異常系(限界文字を含む)→ そのまま 1 文字進める(致命破壊回避)
      take = 1;
    }
    out.push((out.length === 0 ? "" : " ") + line.slice(cursor, cursor + take));
    cursor += take;
  }
  return out.join(CRLF);
}

export type IcsEventInput = {
  /** UID は安定したユニーク値(meeting_schedules.id @ domain など) */
  uid: string;
  /** タイトル */
  summary: string;
  /** 説明本文(改行 OK、自動エスケープ) */
  description?: string;
  /** Meet/Zoom URL や住所 */
  location?: string;
  /** 開始日時(ISO 8601 = タイムゾーン情報を含む) */
  startsAt: string | Date;
  /** 終了日時 */
  endsAt: string | Date;
  /** イベント作成 / 更新の時刻(既定 now) */
  stamp?: string | Date;
  /** 主催者メール */
  organizerEmail?: string;
  organizerName?: string;
  /** 招待先メール(複数) */
  attendees?: Array<{ email: string; name?: string }>;
  /** "PUBLISH"(新規)or "CANCEL"(キャンセル通知) */
  method?: "PUBLISH" | "CANCEL";
  /** SEQUENCE(再送 / 更新時に +1) */
  sequence?: number;
  /** PRODID 識別子(既定 -//Maira//Calendar//JA) */
  prodId?: string;
};

/**
 * VEVENT を含む VCALENDAR 文字列を組み立てる。
 * STATUS は method=CANCEL のとき CANCELLED に固定する。
 */
export function buildIcsEvent(event: IcsEventInput): string {
  const stamp = formatIcsUtc(event.stamp ?? new Date());
  const dtstart = formatIcsUtc(event.startsAt);
  const dtend = formatIcsUtc(event.endsAt);
  const method = event.method ?? "PUBLISH";

  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push(`PRODID:${event.prodId ?? "-//Maira//Calendar//JA"}`);
  lines.push(`METHOD:${method}`);
  lines.push("CALSCALE:GREGORIAN");
  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${event.uid}`);
  lines.push(`DTSTAMP:${stamp}`);
  lines.push(`DTSTART:${dtstart}`);
  lines.push(`DTEND:${dtend}`);
  lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }
  lines.push(`SEQUENCE:${event.sequence ?? 0}`);
  lines.push(`STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`);

  if (event.organizerEmail) {
    const cn = event.organizerName ? `;CN=${escapeIcsText(event.organizerName)}` : "";
    lines.push(`ORGANIZER${cn}:mailto:${event.organizerEmail}`);
  }
  for (const a of event.attendees ?? []) {
    const cn = a.name ? `;CN=${escapeIcsText(a.name)}` : "";
    lines.push(
      `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE${cn}:mailto:${a.email}`,
    );
  }
  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join(CRLF) + CRLF;
}
