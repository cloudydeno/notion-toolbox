import { Client } from "https://deno.land/x/notion_sdk@v0.4.4/src/mod.ts"
import {
  GetBlockResponse,
  GetDatabaseResponse,
  GetPageResponse,
  QueryDatabaseParameters,
  SearchBodyParameters,
  SearchResponse,
} from "https://deno.land/x/notion_sdk@v0.4.4/src/api-endpoints.ts"

export class NotionConnection {
  constructor(
    private api: Client,
  ) {}

  static fromStaticAuthToken(auth?: string) {
    return new NotionConnection(new Client({ auth }));
  }
  static fromEnv(env: Pick<typeof Deno.env, 'get'> = Deno.env) {
    const authKey = env.get("NOTION_KEY");
    if (!authKey) throw new Error(`NOTION_KEY is required`);
    return new NotionConnection(new Client({
      auth: authKey,
    }));
  }

  async searchForFirstDatabase(options: Omit<SearchBodyParameters, 'page_size' | 'filter' | 'start_cursor'> = {}) {
    const response = await this.api.search({
      ...options,
      page_size: 1,
      filter: {
        property: 'object',
        value: 'database',
      },
    });
    if (response.results.length < 1) return null;
    const [result] = response.results;
    return new NotionDatabase(this.api, result.id, result as SearchResult & {object: 'database'});
  }

  async* searchForPages(options: Omit<SearchBodyParameters, 'filter' | 'start_cursor'> = {}) {
    for await (const result of paginateFully(start_cursor => this.api.search({
      ...options,
      start_cursor,
      filter: {
        property: 'object',
        value: 'page',
      },
    }))) {
      yield new NotionPage(this.api, result.id, result as SearchResult & {object: 'page'});
    }
  }
}
type SearchResult = SearchResponse['results'][number];

export class NotionObject {
  constructor(
    api: Client,
  ) {
    Object.defineProperty(this, 'api', {
      value: api,
      writable: false,
      enumerable: false,
    })
  }
  protected readonly api!: Client;
}

export class NotionBlockParent extends NotionObject {
  constructor(
    api: Client,
    public readonly id: string,
  ) {
    super(api);
  }

  async* listAllChildren() {
    for await (const result of paginateFully(start_cursor => this.api.blocks.children.list({
      start_cursor,
      block_id: this.id,
    }))) {
      yield new NotionBlock(this.api, result.id, result);
    }
  }
}

export class NotionBlock extends NotionBlockParent {
  constructor(
    api: Client,
    public readonly id: string,
    public snapshot?: GetBlockResponse,
  ) {
    super(api, id);
  }

  async getSnapshot() {
    if (!this.snapshot) this.snapshot = await this
      .api.blocks.retrieve({ block_id: this.id });
    return this.snapshot;
  }
}

export class NotionPage extends NotionBlockParent {
  constructor(
    api: Client,
    id: string,
    public knownSnapshot?: GetPageResponse,
  ) {
    super(api, id);
  }

  async ensureSnapshot() {
    if (this.knownSnapshot) return;
    this.knownSnapshot = await this.api.pages.retrieve({ page_id: this.id });
  }
  get snapshot() {
    if (!this.knownSnapshot) throw new Error(`BUG: Snapshot wasn't loaded, call .getSnapshot first`)
    return this.knownSnapshot;
  }

  get createdTime() { return new Date(this.snapshot.created_time); }
  get lastEditedTime() { return new Date(this.snapshot.last_edited_time); }
  get url() { return this.snapshot.url; }

  get titleProp() {
    const prop = Object
      .values(this.snapshot.properties)
      .find(x => x.type == 'title') as TitleProperty | undefined;
    return new NotionTextString(prop?.title ?? []);
  }

  get dateProp() {
    const prop = Object
      .values(this.snapshot.properties)
      .find(x => x.type == 'date') as DateProperty | undefined;
    return prop?.date ? {
      start: new Date(prop.date.start),
      end: prop.date.end ? new Date(prop.date.end) : null,
      hasTime: prop.date.start.includes('T'),
    } : null;
  }
}
type TitleProperty = GetPageResponse['properties'][string] & {type: 'title'};
type DateProperty = GetPageResponse['properties'][string] & {type: 'date'};

export class NotionTextString {
  constructor(
    public spans: TitleProperty['title'],
  ) {}

  get asPlainText() {
    return this.spans.map(x => x.plain_text).join('');
  }
}

export class NotionDatabase extends NotionObject {
  constructor(
    api: Client,
    public readonly id: string,
    public knownSnapshot?: GetDatabaseResponse,
  ) {
    super(api);
  }

  async* queryAllPages(options: Omit<QueryDatabaseParameters, 'database_id' | 'start_cursor'> = {}) {
    for await (const result of paginateFully(start_cursor =>
      this.api.databases.query({
        ...options,
        start_cursor,
        database_id: this.id,
    }))) {
      yield new NotionPage(this.api, result.id, result);
    }
  }

  async ensureSnapshot() {
    if (this.knownSnapshot) return;
    this.knownSnapshot = await this.api.databases.retrieve({ database_id: this.id });
  }
  get snapshot() {
    if (!this.knownSnapshot) throw new Error(`BUG: Snapshot wasn't loaded, call .getSnapshot first`)
    return this.knownSnapshot;
  }

  get title() { return new NotionTextString(this.snapshot.title); }
  get url() { return this.snapshot.url; }
}

async function* paginateFully<O>(pageFunc: (start_cursor?: string) => Promise<{
  has_more: boolean;
  next_cursor: string | null;
  results: Array<O>;
}>) {
  let result = await pageFunc();
  yield* result.results;

  while (result.has_more) {
    if (!result.next_cursor) throw new Error(
      `'next_cursor' missing on response with 'has_more'`);

    result = await pageFunc(result.next_cursor);
    yield* result.results;
  }
}
