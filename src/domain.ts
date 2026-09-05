import type { Market, Point, Quote } from "./types";

export function parseQuote(symbol: string, raw: string): Quote | null {
  const f = raw.split("~");
  const price = Number(f[3]),
    previousClose = Number(f[4]);
  if (
    f.length < 33 ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(previousClose) ||
    previousClose <= 0
  )
    return null;
  const stamp = f[30] || "";
  // Tencent US timestamps use exchange-local wall time; keep it labelled, never guess UTC.
  const time = /^\d{14}$/.test(stamp)
    ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}`
    : stamp;
  return {
    symbol,
    price,
    previousClose,
    changePercent: (price / previousClose - 1) * 100,
    time,
    source: "腾讯财经",
    high: Number(f[33]) || undefined,
    low: Number(f[34]) || undefined,
  };
}

export function performance(points: Point[]) {
  const values = points
    .filter((p) => Number.isFinite(p.close) && p.close > 0)
    .map((p) => p.close);
  if (values.length < 2) return null;
  const returns = values.slice(1).map((v, i) => Math.log(v / values[i]));
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance =
    returns.length > 1
      ? returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length - 1)
      : null;
  let peak = values[0],
    drawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    drawdown = Math.min(drawdown, value / peak - 1);
  }
  return {
    change: (values.at(-1)! / values[0] - 1) * 100,
    drawdown: drawdown * 100,
    volatility: variance === null ? null : Math.sqrt(variance * 252) * 100,
    count: values.length,
  };
}

export function correlation(a: Point[], b: Point[]) {
  const bm = new Map(b.map((p) => [p.date, p.close]));
  const matched = a.filter(
    (p) => bm.has(p.date) && p.close > 0 && bm.get(p.date)! > 0,
  );
  if (matched.length < 21) return null;
  const x = matched
    .slice(1)
    .map((p, i) => Math.log(p.close / matched[i].close));
  const y = matched
    .slice(1)
    .map((p, i) => Math.log(bm.get(p.date)! / bm.get(matched[i].date)!));
  const mx = x.reduce((s, v) => s + v, 0) / x.length,
    my = y.reduce((s, v) => s + v, 0) / y.length;
  let cov = 0,
    vx = 0,
    vy = 0;
  x.forEach((v, i) => {
    cov += (v - mx) * (y[i] - my);
    vx += (v - mx) ** 2;
    vy += (y[i] - my) ** 2;
  });
  return vx && vy ? { value: cov / Math.sqrt(vx * vy), count: x.length } : null;
}

export const formatBjt = (date: string | number | Date, full = false) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    ...(full ? { year: "numeric" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(date));
export function quoteTimeBjt(
  stamp: string | undefined,
  market: Market,
): string {
  if (!stamp) return "暂无报价";
  const match = stamp.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) return `${stamp}（原始时间）`;
  if (market !== "US") return stamp;
  const parts = match.slice(1).map(Number);
  const wall = Date.UTC(
    parts[0],
    parts[1] - 1,
    parts[2],
    parts[3],
    parts[4],
    parts[5],
  );
  let candidate = wall;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let n = 0; n < 2; n++) {
    const p = Object.fromEntries(
      fmt.formatToParts(new Date(candidate)).map((x) => [x.type, x.value]),
    );
    const represented = Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour,
      +p.minute,
      +p.second,
    );
    candidate += wall - represented;
  }
  return formatBjt(candidate, true);
}
export const percent = (n: number | undefined | null) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
export const safeUrl = (url: string) => {
  try {
    const u = new URL(url);
    return ["https:", "http:"].includes(u.protocol) ? u.href : "#";
  } catch {
    return "#";
  }
};
