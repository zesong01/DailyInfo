export type Market = "US" | "CN" | "HK";
export type Category = "AI" | "科技" | "市场" | "论文" | "开源";
export interface Instrument {
  symbol: string;
  code: string;
  name: string;
  market: Market;
  kind: "ETF" | "股票";
  currency: string;
  theme: string;
  benchmark?: string;
  issuerUrl?: string;
  risk: string;
}
export interface Quote {
  symbol: string;
  price: number;
  previousClose: number;
  changePercent: number;
  time: string;
  source: string;
  high?: number;
  low?: number;
}
export interface Point {
  date: string;
  close: number;
}
export interface Article {
  id: string;
  title: string;
  originalTitle?: string;
  originalSummary?: string;
  summary: string;
  url: string;
  source: string;
  sourceUrl?: string;
  category: Category;
  publishedAt: string;
  discoveredAt: string;
  tags: string[];
  original: boolean;
  authors?: string;
  paperId?: string;
  language?: string;
  license?: string;
  ai?: {
    why: string;
    technical: string;
    investment: string;
    counter: string;
    next: string;
    generatedAt: string;
    model: string;
  };
  stars?: number;
  starsDelta?: number;
  deltaSince?: string;
}
export interface SourceStatus {
  name: string;
  url: string;
  ok: boolean;
  checkedAt: string;
  count: number;
  error?: string;
}
export interface Snapshot {
  version: number;
  generatedAt: string;
  articles: Article[];
  instruments: Instrument[];
  quotes: Record<string, Quote>;
  history: Record<string, Point[]>;
  sources: SourceStatus[];
  aiStatus: string;
}
export interface Settings {
  endpoint: string;
  model: string;
  theme: "dark" | "light";
  autoRefresh: boolean;
}
