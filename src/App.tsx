import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  ExternalLink,
  FileText,
  Globe2,
  Layers3,
  LayoutDashboard,
  Menu,
  Moon,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  X,
} from "lucide-react";
import type {
  Article,
  Instrument,
  Market,
  Point,
  Quote,
  Settings,
  Snapshot,
} from "./types";
import {
  correlation,
  formatBjt,
  percent,
  performance,
  quoteTimeBjt,
  safeUrl,
} from "./domain";
import { askAI, getSnapshot, liveQuotes, validEndpoint } from "./api";

type Page = "brief" | "markets" | "etf" | "radar" | "research" | "saved";
type Context =
  | { kind: "article"; article: Article }
  | { kind: "instrument"; instrument: Instrument }
  | { kind: "overview" };
const NAV = [
  { id: "brief", name: "每日情报", icon: LayoutDashboard },
  { id: "markets", name: "全球市场", icon: Globe2 },
  { id: "etf", name: "ETF 研究", icon: Layers3 },
  { id: "radar", name: "趋势雷达", icon: Radar },
  { id: "research", name: "论文与开源", icon: Code2 },
  { id: "saved", name: "我的关注", icon: Bookmark },
] as const;
const MARKET_NAMES: Record<Market, string> = {
  US: "美股",
  CN: "A 股",
  HK: "港股",
};
const DEFAULT_SETTINGS: Settings = {
  endpoint: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  theme: "dark",
  autoRefresh: true,
};
const DEFAULT_WATCH = ["QQQ", "NVDA", "510300", "03033"];
function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private mode retains in-memory state. */
  }
}
const age = (date: string) => {
  const hours = Math.max(0, (Date.now() - new Date(date).getTime()) / 3600000);
  return hours < 1
    ? "刚刚"
    : hours < 24
      ? `${Math.floor(hours)} 小时前`
      : `${Math.floor(hours / 24)} 天前`;
};

function Sparkline({
  points,
  large = false,
  positive = true,
}: {
  points: Point[];
  large?: boolean;
  positive?: boolean;
}) {
  if (points.length < 2)
    return (
      <div className={large ? "chart-missing" : "spark-missing"}>
        暂无日线数据
      </div>
    );
  const values = points.map((p) => p.close),
    min = Math.min(...values),
    max = Math.max(...values),
    range = max - min || 1;
  const w = large ? 680 : 110,
    h = large ? 190 : 40,
    pad = large ? 14 : 3;
  const path = values
    .map(
      (v, i) =>
        `${pad + (i / (values.length - 1)) * (w - pad * 2)},${h - pad - ((v - min) / range) * (h - pad * 2)}`,
    )
    .join(" ");
  return (
    <svg
      className={large ? "price-chart" : "sparkline"}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`价格走势，${points[0].date} 至 ${points.at(-1)!.date}`}
    >
      <title>{`价格范围 ${min.toFixed(2)} 至 ${max.toFixed(2)}`}</title>
      {large &&
        [0.25, 0.5, 0.75].map((v) => (
          <line
            key={v}
            x1="0"
            x2={w}
            y1={h * v}
            y2={h * v}
            stroke="var(--line)"
            strokeDasharray="3 6"
          />
        ))}
      <polyline
        points={path}
        fill="none"
        stroke={positive ? "var(--positive)" : "var(--negative)"}
        strokeWidth={large ? 2.5 : 1.6}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <BookOpen size={25} />
      <p>{text}</p>
    </div>
  );
}
function Change({ value }: { value?: number }) {
  return (
    <span
      className={`change ${value != null && value < 0 ? "negative" : "positive"}`}
    >
      {value != null &&
        (value < 0 ? <ArrowDown size={12} /> : <ArrowUpRight size={13} />)}
      {percent(value)}
    </span>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("brief");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loadError, setLoadError] = useState("");
  const [quoteStatus, setQuoteStatus] = useState("等待报价刷新");
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部");
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const [market, setMarket] = useState<"ALL" | Market>("ALL");
  const [budget, setBudget] = useState(10);
  const [limit, setLimit] = useState(8);
  const [watch, setWatch] = useState<string[]>(() =>
    stored("di-watch", DEFAULT_WATCH),
  );
  const [saved, setSaved] = useState<string[]>(() => stored("di-saved", []));
  const [topics, setTopics] = useState<string[]>(() =>
    stored("di-topics", ["AI Coding", "AI 算力"]),
  );
  const [settings, setSettings] = useState<Settings>(() => ({
    ...DEFAULT_SETTINGS,
    ...stored("di-settings", {}),
  }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [context, setContext] = useState<Context | null>(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [selectedEtf, setSelectedEtf] = useState("QQQ");
  const [compareEtf, setCompareEtf] = useState("SMH");
  const [range, setRange] = useState(63);
  const [lastVisit] = useState(() =>
    stored<string | null>("di-last-visit", null),
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const quoteBusy = useRef(false);
  const refreshQuotes = async (instruments: Instrument[]) => {
    if (quoteBusy.current) return;
    quoteBusy.current = true;
    try {
      const q = await liveQuotes(instruments);
      setQuotes((old) => ({ ...old, ...q }));
      setQuoteStatus(
        `报价已获取 · ${formatBjt(Date.now()).split(" ")[1] || formatBjt(Date.now())}`,
      );
    } catch (e) {
      setQuoteStatus((e as Error).message);
    } finally {
      quoteBusy.current = false;
    }
  };
  const refresh = async () => {
    setRefreshing(true);
    setLoadError("");
    try {
      const data = await getSnapshot();
      setSnapshot(data);
      setQuotes((old) => {
        const next = { ...old };
        for (const [symbol, q] of Object.entries(data.quotes)) {
          if (!next[symbol] || q.time >= next[symbol].time) next[symbol] = q;
        }
        return next;
      });
      await refreshQuotes(data.instruments);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => {
    void refresh();
    persist("di-last-visit", new Date().toISOString());
    return () => abortRef.current?.abort();
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    try {
      validEndpoint(settings.endpoint);
      persist("di-settings", settings);
    } catch {
      /* Never persist an invalid credential-bearing endpoint. */
    }
  }, [settings]);
  useEffect(() => {
    persist("di-watch", watch);
  }, [watch]);
  useEffect(() => {
    persist("di-saved", saved);
  }, [saved]);
  useEffect(() => {
    persist("di-topics", topics);
  }, [topics]);
  useEffect(() => {
    if (!snapshot || !settings.autoRefresh) return;
    const t = setInterval(() => {
      if (!document.hidden) void refreshQuotes(snapshot.instruments);
    }, 60000);
    const n = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 300000);
    return () => {
      clearInterval(t);
      clearInterval(n);
    };
  }, [snapshot?.generatedAt, settings.autoRefresh]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setSettingsOpen(false);
        setMobileNav(false);
        setSourcesOpen(false);
        if (!aiBusy) setContext(null);
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [aiBusy]);
  useEffect(() => {
    if (!context && !settingsOpen && !sourcesOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialogs = Array.from(
      document.querySelectorAll<HTMLElement>("[role=dialog]"),
    );
    const dialog = dialogs.at(-1);
    if (!dialog) return;
    const selector =
      'button:not([disabled]),a[href],input,select,textarea,[tabindex="0"]';
    const first = dialog.querySelector<HTMLElement>(selector);
    first?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = Array.from(
        dialog.querySelectorAll<HTMLElement>(selector),
      ).filter((el) => el.getClientRects().length);
      const first = elements[0],
        last = elements.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", trap);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, [!!context, settingsOpen, sourcesOpen]);
  const navigate = (p: Page) => {
    setPage(p);
    setSearch("");
    setCategory("全部");
    setMobileNav(false);
    setLimit(8);
  };
  const openResearch = (next: Context) => {
    abortRef.current?.abort();
    setContext(next);
    setMessages([]);
    setQuestion("");
    setAiError("");
    setAiBusy(false);
  };
  const toggleSaved = (id: string) =>
    setSaved((x) => (x.includes(id) ? x.filter((i) => i !== id) : [...x, id]));
  const toggleWatch = (symbol: string) =>
    setWatch((x) =>
      x.includes(symbol) ? x.filter((i) => i !== symbol) : [...x, symbol],
    );
  const toggleTopic = (topic: string) =>
    setTopics((x) =>
      x.includes(topic) ? x.filter((i) => i !== topic) : [...x, topic],
    );
  const articles = snapshot?.articles || [];
  const instruments = snapshot?.instruments || [];
  const selected = instruments.find((i) => i.symbol === selectedEtf);
  const compared = instruments.find((i) => i.symbol === compareEtf);
  const selectedPoints = (snapshot?.history[selectedEtf] || []).slice(-range);
  const comparedPoints = (snapshot?.history[compareEtf] || []).slice(-range);
  const stats = performance(selectedPoints),
    comparisonStats = performance(comparedPoints);
  const corr =
    selected && compared && selected.market === compared.market
      ? correlation(selectedPoints, comparedPoints)
      : null;
  const scopedArticles = useMemo(() => {
    const hours = period === "day" ? 24 : period === "week" ? 168 : 744;
    let rows = articles.filter(
      (a) => new Date(a.publishedAt).getTime() >= Date.now() - hours * 3600000,
    );
    if (page === "research")
      rows = articles.filter((a) => ["论文", "开源"].includes(a.category));
    if (page === "saved")
      rows = articles.filter(
        (a) => saved.includes(a.id) || a.tags.some((t) => topics.includes(t)),
      );
    if (category !== "全部")
      rows = rows.filter(
        (a) => a.category === category || a.tags.includes(category),
      );
    const q = search.trim().toLowerCase();
    if (q)
      rows = rows.filter((a) =>
        `${a.title} ${a.originalTitle || ""} ${a.summary} ${a.source} ${a.tags.join(" ")}`
          .toLowerCase()
          .includes(q),
      );
    if (page === "brief") {
      const score = (a: Article) =>
        ({ AI: 4, 科技: 2, 市场: 3, 论文: 3, 开源: 0 })[a.category] +
        a.tags.filter((t) => topics.includes(t)).length * 2 +
        (a.source === "量子位" ? 2 : 0) +
        (a.original ? 1 : 0);
      rows.sort(
        (a, b) =>
          score(b) - score(a) ||
          new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
      );
    }
    return rows;
  }, [articles, period, page, category, search, saved, topics]);
  const filteredInstruments = instruments.filter(
    (i) =>
      (market === "ALL" || i.market === market) &&
      `${i.symbol} ${i.name} ${i.theme}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const allTopics = Array.from(new Set(articles.flatMap((a) => a.tags)));
  const newCount = lastVisit
    ? articles.filter((a) => new Date(a.discoveredAt) > new Date(lastVisit))
        .length
    : 0;
  const failedSources = snapshot?.sources.filter((s) => !s.ok).length || 0;
  const selectedArticle = context?.kind === "article" ? context.article : null;
  const contextInstrument =
    context?.kind === "instrument" ? context.instrument : null;
  const researchSources = selectedArticle
    ? [selectedArticle]
    : contextInstrument
      ? articles
          .filter((a) =>
            [
              contextInstrument.symbol,
              contextInstrument.name,
              contextInstrument.theme,
            ].some((t) =>
              (a.title + " " + a.summary + " " + a.tags.join(" "))
                .toLowerCase()
                .includes(t.toLowerCase()),
            ),
          )
          .slice(0, 5)
      : scopedArticles.slice(0, 6);
  const send = async (text = question) => {
    if (!text.trim() || aiBusy) return;
    if (!apiKey) {
      setAiError("连接 AI 后即可继续追问。当前来源和量化数据可直接查看。");
      setSettingsOpen(true);
      return;
    }
    const next = [...messages, { role: "user" as const, content: text.trim() }];
    setMessages(next);
    setQuestion("");
    setAiBusy(true);
    setAiError("");
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const instrument = contextInstrument;
      const evidence = {
        asOf: snapshot?.generatedAt,
        sources: researchSources.map((a, i) => ({
          reference: `S${i + 1}`,
          title: a.title,
          summary: a.summary,
          url: a.url,
          publishedAt: a.publishedAt,
          source: a.source,
          ai: a.ai,
        })),
        instrument,
        quote: instrument && quotes[instrument.symbol] ? { ...quotes[instrument.symbol], time: quoteTimeBjt(quotes[instrument.symbol].time, instrument.market), timezone: "Asia/Shanghai" } : undefined,
        priceStats: instrument
          ? performance(snapshot?.history[instrument.symbol] || [])
          : undefined,
      };
      const answer = await askAI(
        settings,
        apiKey,
        evidence,
        next,
        controller.signal,
      );
      if (abortRef.current === controller)
        setMessages([...next, { role: "assistant", content: answer }]);
    } catch (e) {
      if (abortRef.current === controller)
        setAiError(
          (e as Error).name === "AbortError"
            ? "研究已停止或请求超时。"
            : (e as Error).message,
        );
    } finally {
      clearTimeout(timeout);
      if (abortRef.current === controller) setAiBusy(false);
    }
  };

  const articleCard = (a: Article, index: number) => (
    <article className="event-card" key={a.id}>
      <div className="event-index">{String(index + 1).padStart(2, "0")}</div>
      <div className="event-body">
        <div className="event-meta">
          <span className={`category-tag cat-${a.category}`}>
            {a.category === "开源" ? (
              <Code2 size={12} />
            ) : a.category === "论文" ? (
              <FileText size={12} />
            ) : (
              <span className="tiny-dot" />
            )}
            {a.category}
          </span>
          <span>{a.source}</span>
          <span className="meta-separator">·</span>
          <time title={formatBjt(a.publishedAt, true)}>
            {age(a.publishedAt)}
          </time>
          {a.original && (
            <span className="original">
              <ShieldCheck size={12} />
              原始来源
            </span>
          )}
        </div>
        <button
          className="event-title"
          onClick={() => openResearch({ kind: "article", article: a })}
        >
          {a.title}
        </button>
        {budget !== 5 && (
          <p className="event-summary">
            {a.summary || "打开来源阅读完整内容。"}
          </p>
        )}
        {a.ai && budget === 15 && (
          <div className="why">
            <Sparkles size={14} />
            <span>
              <b>为什么重要</b> {a.ai.why}
            </span>
          </div>
        )}
        <div className="event-bottom">
          <div className="tags">
            {a.tags.slice(0, 3).map((tag) => (
              <button key={tag} onClick={() => setCategory(tag)}>
                {tag}
              </button>
            ))}
            {a.stars != null && (
              <span className="star-count">
                <Star size={12} />
                {a.stars.toLocaleString()}
                {a.starsDelta != null && (
                  <small title={`自 ${formatBjt(a.deltaSince!)} 净增`}>
                    {" "}
                    ({a.starsDelta >= 0 ? "+" : ""}
                    {a.starsDelta})
                  </small>
                )}
              </span>
            )}
          </div>
          <div className="event-actions">
            <a
              href={safeUrl(a.url)}
              target="_blank"
              rel="noreferrer"
              aria-label="阅读原文"
            >
              <ExternalLink size={14} />
            </a>
            <button
              aria-label={saved.includes(a.id) ? "取消收藏" : "收藏"}
              className={saved.includes(a.id) ? "active" : ""}
              onClick={() => toggleSaved(a.id)}
            >
              <Bookmark
                size={15}
                fill={saved.includes(a.id) ? "currentColor" : "none"}
              />
            </button>
            <button
              className="ask-link"
              onClick={() => openResearch({ kind: "article", article: a })}
            >
              <Sparkles size={13} />
              分析
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );

  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="关闭导航"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("brief");
          }}
        >
          <div className="brand-mark">序</div>
          <div>
            <strong>
              知序<span> DAILYINFO</span>
            </strong>
            <small>个人情报工作台</small>
          </div>
        </a>
        <div className="workspace-label">
          <span className="status-dot" />
          个人空间
          <ChevronDown size={13} />
        </div>
        <div className="nav-caption">工作台</div>
        <nav>
          {NAV.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? "nav-item current" : "nav-item"}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              <span>{item.name}</span>
              {item.id === "saved" && (
                <small>{watch.length + saved.length}</small>
              )}
              {page === item.id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="nav-caption following-label">
          关注主题
          <Plus size={13} />
        </div>
        <div className="sidebar-topics">
          {["AI Coding", "Agent", "AI 算力", "大模型", "市场"].map((t) => (
            <button
              key={t}
              onClick={() => {
                navigate("brief");
                setCategory(t);
              }}
            >
              <span className={`topic-dot topic-${t.length % 3}`} />
              {t}
              {topics.includes(t) && <span className="follow-dot" />}
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="system-health">
            <Activity size={15} />
            <span>{snapshot ? "数据源已连接" : "正在连接数据源"}</span>
            <button
              aria-label="数据源状态"
              onClick={() => setSourcesOpen(true)}
            >
              <CircleHelp size={13} />
            </button>
          </div>
          <button className="profile" onClick={() => setSettingsOpen(true)}>
            <span className="avatar">Z</span>
            <span>
              <strong>我的工作台</strong>
              <small>AI 工程师 · 投资者</small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="打开导航"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            工作台
            <ChevronRight size={13} />
            <span>{NAV.find((n) => n.id === page)?.name}</span>
          </div>
          <div className="global-search">
            <Search size={16} />
            <input
              ref={searchRef}
              aria-label="搜索情报或证券"
              placeholder="搜索事件、公司、股票代码…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(30);
              }}
            />
            <kbd>⌘ K</kbd>
            {search && (
              <button aria-label="清空搜索" onClick={() => setSearch("")}>
                <X size={14} />
              </button>
            )}
          </div>
          <button
            className="icon-button theme-toggle"
            aria-label="切换明暗模式"
            onClick={() =>
              setSettings((s) => ({
                ...s,
                theme: s.theme === "dark" ? "light" : "dark",
              }))
            }
          >
            {settings.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            className="top-ai"
            onClick={() => openResearch({ kind: "overview" })}
          >
            <Sparkles size={15} />
            <span>研究助手</span>
          </button>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="status-dot" />
                {new Intl.DateTimeFormat("zh-CN", {
                  timeZone: "Asia/Shanghai",
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                }).format(new Date())}
                <span className="bjt">北京时间 UTC+8</span>
              </div>
              <h1>
                {page === "brief"
                  ? "把变化，看清楚。"
                  : page === "markets"
                    ? "全球市场"
                    : page === "etf"
                      ? "ETF 研究室"
                      : page === "radar"
                        ? "信号，逐渐成形。"
                        : page === "research"
                          ? "从研究，到实践。"
                          : "值得持续关注。"}
              </h1>
              <p>
                {page === "brief"
                  ? "技术进展与市场变化，在这里连接。"
                  : page === "markets"
                    ? "美股 · A 股 · 港股，关注价格背后的变化。"
                    : page === "etf"
                      ? "理解暴露、比较表现，也看见风险。"
                      : page === "radar"
                        ? "从已收录证据出发，观察主题活跃度。"
                        : page === "research"
                          ? "论文、模型与开源项目的最新进展。"
                          : "关注对象和研究线索，保留在这台设备上。"}
              </p>
            </div>
            <button
              className="refresh-button"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              <RefreshCw size={14} className={refreshing ? "spin" : ""} />
              {refreshing ? "正在更新" : "刷新数据"}
            </button>
          </div>
          {loadError && (
            <div className="notice error">
              {loadError}
              <button onClick={() => void refresh()}>重试</button>
            </div>
          )}
          {!snapshot && !loadError && (
            <div className="loading-panel">
              <RefreshCw className="spin" />
              <span>正在整理你的情报工作台…</span>
            </div>
          )}
          {snapshot && (
            <>
              <div className="market-strip">
                {["QQQ", "SPY", "510300", "03033"].map((symbol) => {
                  const i = instruments.find((x) => x.symbol === symbol),
                    q = quotes[symbol];
                  if (!i) return null;
                  return (
                    <button
                      className="market-tile"
                      key={symbol}
                      onClick={() =>
                        openResearch({ kind: "instrument", instrument: i })
                      }
                    >
                      <div className="market-tile-name">
                        <span>{i.name.replace(/华泰柏瑞|南方东英/g, "")}</span>
                        <small>{MARKET_NAMES[i.market]}</small>
                      </div>
                      <div className="market-tile-bottom">
                        <div>
                          <strong>
                            {q?.price.toLocaleString("en-US", {
                              maximumFractionDigits: 3,
                            }) || "—"}
                          </strong>
                          <Change value={q?.changePercent} />
                        </div>
                        <Sparkline
                          points={(snapshot.history[symbol] || []).slice(-30)}
                          positive={(q?.changePercent || 0) >= 0}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="quote-footnote">
                <span>
                  <span className="small-pulse" />
                  {quoteStatus}
                </span>
                <span>
                  涨红跌绿 · 数据可能延迟 ·{" "}
                  <button onClick={() => setSourcesOpen(true)}>
                    查看来源与时间
                  </button>
                </span>
              </div>
              {(page === "brief" ||
                page === "research" ||
                page === "saved") && (
                <div className="content-grid">
                  <section className="main-feed">
                    <div className="section-toolbar">
                      <div className="period-tabs">
                        {(
                          [
                            ["day", "每日简报"],
                            ["week", "近 7 天"],
                            ["month", "近 31 天"],
                          ] as const
                        ).map(([id, name]) => (
                          <button
                            className={period === id ? "selected" : ""}
                            onClick={() => {
                              setPeriod(id);
                              setLimit(8);
                            }}
                            key={id}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                      <label className="reading-budget">
                        <Clock3 size={14} />
                        <select
                          aria-label="阅读预算"
                          value={budget}
                          onChange={(e) => setBudget(Number(e.target.value))}
                        >
                          {[5, 10, 15].map((n) => (
                            <option key={n} value={n}>
                              {n} 分钟
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="brief-note">
                      <span className="brief-note-icon">
                        <Sparkles size={18} />
                      </span>
                      <div>
                        <strong>
                          {page === "saved"
                            ? "你的研究线索"
                            : lastVisit
                              ? `自上次访问，新增 ${newCount} 条材料`
                              : "今天，从关键变化开始"}
                        </strong>
                        <p>
                          {period === "day"
                            ? `过去 24 小时 · ${scopedArticles.length} 条相关材料`
                            : "按原始发布时间汇总；观察期不足时，不推断长期趋势"}{" "}
                          ·{" "}
                          {snapshot.articles.filter((a) => a.ai).length
                            ? "含 AI 辅助解读，推断与事实分开"
                            : "来源摘要已就绪，AI 服务可在设置中连接"}
                        </p>
                      </div>
                    </div>
                    {page === "saved" && (
                      <div className="watch-chips">
                        {instruments
                          .filter((i) => watch.includes(i.symbol))
                          .map((i) => (
                            <button
                              key={i.symbol}
                              onClick={() =>
                                openResearch({
                                  kind: "instrument",
                                  instrument: i,
                                })
                              }
                            >
                              {i.symbol}
                              <Change value={quotes[i.symbol]?.changePercent} />
                            </button>
                          ))}
                      </div>
                    )}
                    <div className="filter-row">
                      {(page === "research"
                        ? ["全部", "论文", "开源"]
                        : ["全部", "AI", "科技", "市场", "论文", "开源"]
                      ).map((c) => (
                        <button
                          className={category === c ? "active" : ""}
                          key={c}
                          onClick={() => {
                            setCategory(c);
                            setLimit(8);
                          }}
                        >
                          {c}
                        </button>
                      ))}
                      {!["全部", "AI", "科技", "市场", "论文", "开源"].includes(
                        category,
                      ) && (
                        <button
                          className="active"
                          onClick={() => setCategory("全部")}
                        >
                          {category}
                          <X size={12} />
                        </button>
                      )}
                      <span className="filter-count">
                        {page === "brief" ? "相关优先 · " : ""}
                        {scopedArticles.length} 条
                      </span>
                    </div>
                    {scopedArticles.length ? (
                      scopedArticles.slice(0, limit).map(articleCard)
                    ) : (
                      <Empty
                        text={
                          search
                            ? "没有匹配的材料，试试公司名、主题或其他时间范围。"
                            : "当前范围暂无材料。可以切换近 7 天，或查看数据源状态。"
                        }
                      />
                    )}
                    <div className="feed-end">
                      {scopedArticles.length > limit ? (
                        <button onClick={() => setLimit((n) => n + 8)}>
                          再看 {Math.min(8, scopedArticles.length - limit)} 条
                          <ChevronDown size={14} />
                        </button>
                      ) : (
                        <>
                          <Check size={16} />
                          <span>已读到这里。留一点时间，形成自己的判断。</span>
                        </>
                      )}
                    </div>
                  </section>
                  <aside className="right-rail">
                    <section className="rail-panel">
                      <div className="rail-heading">
                        <h2>
                          <Radar size={16} />
                          主题脉动
                        </h2>
                        <button
                          aria-label="查看趋势雷达"
                          onClick={() => navigate("radar")}
                        >
                          <ArrowUpRight size={17} />
                        </button>
                      </div>
                      <p className="rail-caption">当前材料中的活跃主题</p>
                      {allTopics.slice(0, 4).map((t, index) => {
                        const count = articles.filter((a) =>
                          a.tags.includes(t),
                        ).length;
                        return (
                          <button
                            className="topic-row"
                            key={t}
                            onClick={() => setCategory(t)}
                          >
                            <div>
                              <span className="rank">0{index + 1}</span>
                              <strong>{t}</strong>
                            </div>
                            <span>
                              {count} 条<ArrowUpRight size={13} />
                            </span>
                            <div className="momentum-track">
                              <i
                                style={{
                                  width: `${Math.min(100, (count / articles.length) * 220)}%`,
                                }}
                              />
                            </div>
                          </button>
                        );
                      })}
                      <div className="rail-disclaimer">
                        讨论热度 ≠ 技术成熟度
                      </div>
                    </section>
                    <section className="rail-panel">
                      <div className="rail-heading">
                        <h2>
                          <Bookmark size={16} />
                          我的观察列表
                        </h2>
                        <button
                          aria-label="管理关注证券"
                          onClick={() => navigate("markets")}
                        >
                          <Plus size={17} />
                        </button>
                      </div>
                      {instruments
                        .filter((i) => watch.includes(i.symbol))
                        .slice(0, 5)
                        .map((i) => (
                          <button
                            className="watch-row"
                            key={i.symbol}
                            onClick={() =>
                              openResearch({
                                kind: "instrument",
                                instrument: i,
                              })
                            }
                          >
                            <span>
                              <strong>{i.symbol}</strong>
                              <small>{i.name}</small>
                            </span>
                            <Change value={quotes[i.symbol]?.changePercent} />
                          </button>
                        ))}
                    </section>
                    <section className="research-invite">
                      <div className="ai-orb">
                        <Sparkles size={20} />
                      </div>
                      <h2>多一层理解。</h2>
                      <p>
                        选一条情报，追问技术逻辑、市场影响与尚未验证的部分。
                      </p>
                      <button
                        onClick={() => openResearch({ kind: "overview" })}
                      >
                        打开研究助手
                        <ArrowRight size={15} />
                      </button>
                    </section>
                  </aside>
                </div>
              )}
              {page === "markets" && (
                <section className="surface">
                  <div className="surface-head">
                    <h2>市场观察</h2>
                    <div className="segmented">
                      {(["ALL", "US", "CN", "HK"] as const).map((m) => (
                        <button
                          key={m}
                          className={market === m ? "active" : ""}
                          onClick={() => setMarket(m)}
                        >
                          {m === "ALL" ? "全部" : MARKET_NAMES[m]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>证券 / 代码</th>
                          <th>市场</th>
                          <th>最新价</th>
                          <th>涨跌幅</th>
                          <th>近 30 个交易日</th>
                          <th>报价时间 · 北京时间</th>
                          <th>关注</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredInstruments.map((i) => (
                          <tr key={i.symbol}>
                            <td>
                              <button
                                className="instrument-name"
                                onClick={() =>
                                  openResearch({
                                    kind: "instrument",
                                    instrument: i,
                                  })
                                }
                              >
                                <strong>{i.name}</strong>
                                <small>
                                  {i.symbol} <span>{i.kind}</span>
                                </small>
                              </button>
                            </td>
                            <td>{MARKET_NAMES[i.market]}</td>
                            <td className="number">
                              {quotes[i.symbol]?.price.toLocaleString("en-US", {
                                maximumFractionDigits: 3,
                              }) || "—"}
                              <small className="currency">{i.currency}</small>
                            </td>
                            <td>
                              <Change value={quotes[i.symbol]?.changePercent} />
                            </td>
                            <td>
                              <Sparkline
                                points={(
                                  snapshot.history[i.symbol] || []
                                ).slice(-30)}
                                positive={
                                  (quotes[i.symbol]?.changePercent || 0) >= 0
                                }
                              />
                            </td>
                            <td className="quote-time">
                              {quoteTimeBjt(quotes[i.symbol]?.time, i.market)}
                              <small>北京时间 UTC+8</small>
                            </td>
                            <td>
                              <button
                                className={`icon-button ${watch.includes(i.symbol) ? "watched" : ""}`}
                                aria-label={
                                  watch.includes(i.symbol)
                                    ? `取消关注 ${i.symbol}`
                                    : `关注 ${i.symbol}`
                                }
                                onClick={() => toggleWatch(i.symbol)}
                              >
                                <Star
                                  size={17}
                                  fill={
                                    watch.includes(i.symbol)
                                      ? "currentColor"
                                      : "none"
                                  }
                                />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="data-note">
                    腾讯财经公开报价，可能延迟；页面每 60
                    秒尝试获取。不同市场休市与节假日不同，最后报价时间不等于页面更新时间。
                  </p>
                </section>
              )}
              {page === "etf" && (
                <section className="etf-workspace">
                  <div className="etf-controls">
                    <label>
                      研究标的
                      <select
                        value={selectedEtf}
                        onChange={(e) => setSelectedEtf(e.target.value)}
                      >
                        {instruments
                          .filter((i) => i.kind === "ETF")
                          .map((i) => (
                            <option key={i.symbol} value={i.symbol}>
                              {i.symbol} · {i.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      比较标的
                      <select
                        value={compareEtf}
                        onChange={(e) => setCompareEtf(e.target.value)}
                      >
                        {instruments
                          .filter((i) => i.kind === "ETF")
                          .map((i) => (
                            <option key={i.symbol} value={i.symbol}>
                              {i.symbol} · {i.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className="range-control">
                      {[
                        [21, "1 月"],
                        [63, "3 月"],
                        [126, "6 月"],
                        [260, "1 年"],
                      ].map(([v, label]) => (
                        <button
                          key={v}
                          className={range === v ? "active" : ""}
                          onClick={() => setRange(Number(v))}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {selected && (
                    <>
                      <div className="etf-grid">
                        <section className="surface chart-surface">
                          <div className="surface-head">
                            <div>
                              <span className="category-tag">
                                {MARKET_NAMES[selected.market]} ·{" "}
                                {selected.theme}
                              </span>
                              <h2>
                                {selected.name}
                                <small>{selected.symbol}</small>
                              </h2>
                            </div>
                            <button
                              className="icon-button"
                              aria-label="关注ETF"
                              onClick={() => toggleWatch(selected.symbol)}
                            >
                              <Star
                                size={18}
                                fill={
                                  watch.includes(selected.symbol)
                                    ? "currentColor"
                                    : "none"
                                }
                              />
                            </button>
                          </div>
                          <div className="chart-price">
                            {quotes[selectedEtf]?.price.toFixed(3) || "—"}
                            <small>{selected.currency}</small>
                            <Change
                              value={quotes[selectedEtf]?.changePercent}
                            />
                          </div>
                          <Sparkline
                            points={selectedPoints}
                            large
                            positive={(stats?.change || 0) >= 0}
                          />
                          <div className="chart-dates">
                            <span>{selectedPoints[0]?.date || "—"}</span>
                            <span>
                              前复权日线 · 价格单位 {selected.currency}
                            </span>
                            <span>{selectedPoints.at(-1)?.date || "—"}</span>
                          </div>
                          <div className="metrics">
                            <div>
                              <span>区间价格表现</span>
                              <strong>
                                <Change value={stats?.change} />
                              </strong>
                            </div>
                            <div>
                              <span>区间最大回撤</span>
                              <strong>{percent(stats?.drawdown)}</strong>
                            </div>
                            <div>
                              <span>年化波动率</span>
                              <strong>
                                {stats?.volatility?.toFixed(2) ?? "—"}
                                {stats?.volatility != null ? "%" : ""}
                              </strong>
                            </div>
                            <div>
                              <span>实际交易日</span>
                              <strong>{stats?.count || "—"}</strong>
                            </div>
                          </div>
                        </section>
                        <section className="surface fund-profile">
                          <h2>理解这只基金</h2>
                          <dl>
                            <dt>跟踪基准</dt>
                            <dd>{selected.benchmark}</dd>
                            <dt>投资方向</dt>
                            <dd>{selected.theme}</dd>
                            <dt>交易币种</dt>
                            <dd>{selected.currency}</dd>
                            <dt>风险观察</dt>
                            <dd>{selected.risk}</dd>
                          </dl>
                          <a
                            href={safeUrl(selected.issuerUrl || "")}
                            target="_blank"
                            rel="noreferrer"
                          >
                            发行人资料
                            <ExternalLink size={13} />
                          </a>
                          <p className="data-note">
                            费率、规模、持仓权重、净值及溢折价尚未接入，不使用估算值代替。请核对发行人最新资料。
                          </p>
                          <button
                            className="primary-button"
                            onClick={() =>
                              openResearch({
                                kind: "instrument",
                                instrument: selected,
                              })
                            }
                          >
                            <Sparkles size={15} />
                            分析配置逻辑
                          </button>
                        </section>
                      </div>
                      <section className="surface comparison">
                        <h2>
                          对照研究
                          <span>
                            {selected.symbol} / {compared?.symbol}
                          </span>
                        </h2>
                        <div className="comparison-grid">
                          <div>
                            <small>{selected.symbol} 区间表现</small>
                            <Change value={stats?.change} />
                            <span>
                              {selected.currency} · {selectedPoints[0]?.date} —{" "}
                              {selectedPoints.at(-1)?.date}
                            </span>
                          </div>
                          <div>
                            <small>{compared?.symbol} 区间表现</small>
                            <Change value={comparisonStats?.change} />
                            <span>
                              {compared?.currency} · {comparedPoints[0]?.date} —{" "}
                              {comparedPoints.at(-1)?.date}
                            </span>
                          </div>
                          <div>
                            <small>收益相关性</small>
                            <strong>{corr?.value.toFixed(2) ?? "—"}</strong>
                            <span>
                              {corr
                                ? `${corr.count} 个共同日期收益样本`
                                : "同一市场且至少 21 个共同日期才计算"}
                            </span>
                          </div>
                        </div>
                        <p className="data-note">
                          上述表现为各自币种的前复权价格变化，不等于含分红总回报。不同币种未做汇率换算；比较前请检查观察日期。波动率采用日对数收益样本标准差
                          × √252，历史相关性不代表未来。
                        </p>
                      </section>
                    </>
                  )}
                </section>
              )}
              {page === "radar" && (
                <>
                  <div className="radar-intro">
                    <Radar size={21} />
                    <p>
                      <strong>证据先于结论。</strong>{" "}
                      这里展示已收录材料的主题分布。只有积累独立证据与历史基线后，才能判断趋势是否增强。
                    </p>
                  </div>
                  <div className="trend-grid">
                    {allTopics.map((t, index) => {
                      const evidence = articles.filter((a) =>
                        a.tags.includes(t),
                      );
                      const sourceCount = new Set(evidence.map((a) => a.source))
                        .size;
                      return (
                        <section className="surface trend-card" key={t}>
                          <div className="trend-top">
                            <span className="trend-no">
                              SIGNAL / {String(index + 1).padStart(2, "0")}
                            </span>
                            <button
                              className="icon-button"
                              aria-label={`关注主题 ${t}`}
                              onClick={() => toggleTopic(t)}
                            >
                              {topics.includes(t) ? (
                                <Check size={17} />
                              ) : (
                                <Plus size={17} />
                              )}
                            </button>
                          </div>
                          <h2>{t}</h2>
                          <div className="trend-stats">
                            <strong>
                              {evidence.length}
                              <small>条材料</small>
                            </strong>
                            <strong>
                              {sourceCount}
                              <small>个来源</small>
                            </strong>
                            <span className="observing">观察中</span>
                          </div>
                          <div className="trend-evidence">
                            {evidence.slice(0, 3).map((a) => (
                              <button
                                key={a.id}
                                onClick={() =>
                                  openResearch({ kind: "article", article: a })
                                }
                              >
                                <span className="tiny-dot" />
                                {a.title}
                                <ChevronRight size={13} />
                              </button>
                            ))}
                          </div>
                          <p className="data-note">
                            来源数量不等于独立证据数量；尚未验证因果关系。
                          </p>
                          <button
                            className="text-button"
                            onClick={() => {
                              navigate("brief");
                              setPeriod("month");
                              setCategory(t);
                            }}
                          >
                            查看全部证据
                            <ArrowRight size={14} />
                          </button>
                        </section>
                      );
                    })}
                  </div>
                </>
              )}
              <footer>
                <span>
                  知序 DAILYINFO <i>·</i> 信息有出处，判断有依据。
                </span>
                <button onClick={() => setSourcesOpen(true)}>
                  <span
                    className={failedSources ? "amber-dot" : "status-dot"}
                  />
                  内容截至 {formatBjt(snapshot.generatedAt)}
                  {failedSources ? ` · ${failedSources} 个源需检查` : ""}
                </button>
              </footer>
            </>
          )}
        </main>
      </div>
      {context && (
        <>
          <button
            className="panel-scrim"
            aria-label="关闭研究面板"
            onClick={() => {
              abortRef.current?.abort();
              setContext(null);
            }}
          />
          <aside
            className="research-panel"
            role="dialog"
            aria-modal="true"
            aria-label="研究助手"
          >
            <div className="panel-header">
              <span>
                <Sparkles size={18} />
                研究助手
              </span>
              <button
                className="icon-button"
                aria-label="关闭研究助手"
                onClick={() => {
                  abortRef.current?.abort();
                  setContext(null);
                }}
              >
                <X size={19} />
              </button>
            </div>
            <div className="research-scroll">
              <div className="research-context">
                <small>当前研究范围</small>
                <h2>
                  {selectedArticle?.title ||
                    contextInstrument?.name ||
                    "当前筛选的情报"}
                </h2>
                <span>
                  <ShieldCheck size={13} />
                  基于下方列出的材料
                </span>
              </div>
              {contextInstrument && (
                <div className="research-facts">
                  <div className="panel-quote">
                    <strong>
                      {quotes[
                        contextInstrument.symbol
                      ]?.price.toLocaleString() || "—"}{" "}
                      <small>{contextInstrument.currency}</small>
                    </strong>
                    <Change
                      value={quotes[contextInstrument.symbol]?.changePercent}
                    />
                  </div>
                  <p>
                    报价时间：
                    {quoteTimeBjt(
                      quotes[contextInstrument.symbol]?.time,
                      contextInstrument.market,
                    )}
                    （北京时间）
                  </p>
                  <h3>观察重点 · 通用研究框架</h3>
                  <p>{contextInstrument.risk}</p>
                  {contextInstrument.kind === "ETF" && (
                    <p>
                      检查基准、费率、集中度、跟踪误差和溢折价。当前未获取持仓明细，无法判断持仓重合度。
                    </p>
                  )}
                </div>
              )}
              {selectedArticle && (
                <div className="research-facts">
                  <h3>
                    {selectedArticle.ai ? "AI 中文摘要 · 基于来源" : "来源摘要"}
                  </h3>
                  {selectedArticle.authors && (
                    <p className="data-note">作者：{selectedArticle.authors}</p>
                  )}
                  {selectedArticle.language && (
                    <p className="data-note">
                      语言：{selectedArticle.language} · 许可证：
                      {selectedArticle.license || "未识别，请查看仓库"}
                    </p>
                  )}
                  <p>{selectedArticle.summary}</p>
                  <p className="data-note">
                    {selectedArticle.original
                      ? "原始发布仍需核验其主张。"
                      : "媒体报道不等于独立验证。"}{" "}
                    {formatBjt(selectedArticle.publishedAt, true)}
                  </p>
                  {selectedArticle.ai && (
                    <>
                      <div className="analysis-label">
                        <Sparkles size={13} />
                        AI 分析 · 推断
                      </div>
                      {(
                        [
                          ["why", "为什么重要"],
                          ["technical", "技术视角"],
                          ["investment", "投资视角"],
                          ["counter", "反证与限制"],
                          ["next", "下一观察点"],
                        ] as const
                      ).map(([key, label]) => (
                        <div key={key}>
                          <h3>{label}</h3>
                          <p>{selectedArticle.ai![key]}</p>
                        </div>
                      ))}
                    </>
                  )}
                  {!selectedArticle.ai && (
                    <div className="muted-box">
                      这条材料尚未生成 AI
                      分析。连接你的服务后，可基于来源摘要继续研究。
                    </div>
                  )}
                </div>
              )}
              <div className="source-list">
                <h3>研究材料</h3>
                {researchSources.map((a, i) => (
                  <a
                    key={a.id}
                    href={safeUrl(a.url)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>S{i + 1}</span>
                    <div>
                      {a.title}
                      <small>
                        {a.source} · {formatBjt(a.publishedAt)}
                      </small>
                    </div>
                    <ExternalLink size={13} />
                  </a>
                ))}
                {contextInstrument && (
                  <a
                    href={safeUrl(
                      contextInstrument.issuerUrl ||
                        `https://gu.qq.com/${contextInstrument.code}`,
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>Q</span>
                    <div>
                      报价 / 发行人资料
                      <small>腾讯财经；基金信息以发行人最新披露为准</small>
                    </div>
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
              <div className="question-chips">
                {[
                  "为什么重要？",
                  "给 AI 工程师解释",
                  "对投资有什么影响？",
                  "Bull Case / Bear Case",
                  "哪些证据可能推翻判断？",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => void send(q)}
                    disabled={aiBusy}
                  >
                    {q}
                    <ArrowUpRight size={12} />
                  </button>
                ))}
              </div>
              {messages.map((m, i) => (
                <div className={`message ${m.role}`} key={i}>
                  <span>{m.role === "user" ? "你" : "AI · 分析推断"}</span>
                  <p>{m.content}</p>
                </div>
              ))}
              {aiBusy && (
                <div className="ai-loading">
                  <Sparkles size={14} className="spin" />
                  正在阅读材料并组织分析…
                  <button onClick={() => abortRef.current?.abort()}>
                    停止
                  </button>
                </div>
              )}
              {aiError && <p className="notice error">{aiError}</p>}
            </div>
            <form
              className="ask-form"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <textarea
                aria-label="追问"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="追问这个事件，或挑战当前判断…"
                rows={2}
              />
              <div>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="model-status"
                >
                  <span className={apiKey ? "status-dot" : "amber-dot"} />
                  {apiKey ? settings.model : "连接 AI 服务"}
                </button>
                <button
                  className="send-button"
                  aria-label="发送问题"
                  disabled={aiBusy || !question.trim()}
                >
                  <Send size={16} />
                </button>
              </div>
            </form>
          </aside>
        </>
      )}
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="工作台设置"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <span>
                <Settings2 size={18} />
                工作台设置
              </span>
              <button
                className="icon-button"
                aria-label="关闭设置"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="settings-body">
              <h3>连接 AI</h3>
              <p>
                支持 DeepSeek 等 OpenAI
                兼容接口。问题与所选公开材料将直接发送至你指定的服务。
              </p>
              <label>
                API 地址
                <input
                  value={settings.endpoint}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, endpoint: e.target.value }))
                  }
                  placeholder="https://api.deepseek.com"
                  autoComplete="off"
                />
              </label>
              <label>
                模型
                <input
                  value={settings.model}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, model: e.target.value }))
                  }
                  placeholder="deepseek-v4-flash"
                />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="仅保留在当前页面，刷新后清除"
                  autoComplete="off"
                />
              </label>
              <div className="muted-box">
                <ShieldCheck size={16} />
                <span>
                  密钥不写入
                  GitHub、不保存到浏览器存储。若接口不允许浏览器跨域访问，请使用你信任的兼容代理。
                </span>
              </div>
              <label className="switch-label">
                <span>
                  自动刷新报价<small>页面可见时每 60 秒尝试获取</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.autoRefresh}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      autoRefresh: e.target.checked,
                    }))
                  }
                />
              </label>
              <p className="data-note">
                时间：北京时间。观察列表、收藏和偏好仅保存于当前浏览器，电脑与手机暂不自动同步。
              </p>
              {settingsError && <p className="error">{settingsError}</p>}
              <button
                className="primary-button"
                onClick={() => {
                  try {
                    validEndpoint(settings.endpoint);
                    if (!settings.model.trim())
                      throw new Error("请输入模型名称");
                    setSettingsError("");
                    setSettingsOpen(false);
                  } catch (e) {
                    setSettingsError((e as Error).message);
                  }
                }}
              >
                <Check size={15} />
                完成设置
              </button>
            </div>
          </section>
        </div>
      )}
      {sourcesOpen && (
        <div className="modal-backdrop" onClick={() => setSourcesOpen(false)}>
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="数据来源"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <span>
                <Activity size={18} />
                数据来源与更新时间
              </span>
              <button
                className="icon-button"
                aria-label="关闭来源状态"
                onClick={() => setSourcesOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="settings-body">
              <p>
                新闻和研究材料计划每 30 分钟采集，GitHub
                调度可能延迟。行情刷新不代表交易所实时授权数据。
              </p>
              {snapshot?.sources.map((s) => (
                <div className="source-status" key={s.name}>
                  <span className={s.ok ? "status-dot" : "amber-dot"} />
                  <a href={safeUrl(s.url)} target="_blank" rel="noreferrer">
                    {s.name}
                    <small>
                      {formatBjt(s.checkedAt)} · {s.count} 项
                    </small>
                  </a>
                  <span>{s.ok ? "已连接" : "暂不可用"}</span>
                </div>
              ))}
              <p className="data-note">{snapshot?.aiStatus}</p>
              <p className="data-note">
                来源异常时保留旧内容和原始时间，不将采集失败解释成没有新事件。新闻标签为自动分类，主题卡为材料分布。
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
