import type { NotionConnection } from "./object-model/mod.ts";

export interface RequestContext {
  readonly original: Request;
  readonly path: string;
  readonly params: URLSearchParams;
  get wantsHtml(): boolean;

  getNotion(): Promise<NotionConnection>;

  readonly metricTags: Array<string>;
  incrementCounter(name: string, value: number): void;
}
