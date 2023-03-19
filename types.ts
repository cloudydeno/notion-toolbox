import type { NotionConnection } from "./object-model/mod.ts";

export interface RequestContext {
  readonly original: Request;
  readonly path: string;
  readonly params: URLSearchParams;
  readonly notion: NotionConnection | null;
  get wantsHtml(): boolean;
}
