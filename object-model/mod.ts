import { Client } from "https://deno.land/x/notion_sdk@v0.4.4/src/mod.ts"
import {
  GetBlockResponse,
  GetDatabaseResponse,
  GetPageResponse,
  QueryDatabaseParameters,
  SearchBodyParameters,
  SearchResponse,
  UpdateBlockParameters,
  UpdateDatabaseParameters,
  UpdatePageParameters,
} from "https://deno.land/x/notion_sdk@v0.4.4/src/api-endpoints.ts"

export class NotionConnection {
  constructor(
    public readonly api: Client,
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

  async pageById(pageId: string) {
    const page = new NotionPage(this.api, pageId);
    await page.ensureSnapshot();
    return page;
  }
  async blockById(blockId: string) {
    const block = new NotionBlock(this.api, blockId);
    // await block.ensureSnapshot();
    return block;
  }
  async databaseById(databaseId: string) {
    const database = new NotionDatabase(this.api, databaseId);
    await database.ensureSnapshot();
    return database;
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

  async searchForFirstPage(options: Omit<SearchBodyParameters, 'page_size' | 'filter' | 'start_cursor'> = {}) {
    const response = await this.api.search({
      ...options,
      page_size: 1,
      filter: {
        property: 'object',
        value: 'page',
      },
    });
    if (response.results.length < 1) return null;
    const [result] = response.results;
    return new NotionPage(this.api, result.id, result as SearchResult & {object: 'page'});
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
    public knownSnapshot?: GetBlockResponse,
  ) {
    super(api, id);
  }

  async ensureSnapshot() {
    if (this.knownSnapshot) return this.knownSnapshot;
    return this.knownSnapshot = await this.api.blocks.retrieve({ block_id: this.id });
  }
  get snapshot() {
    if (!this.knownSnapshot) throw new Error(`BUG: Snapshot wasn't loaded, call .ensureSnapshot first`)
    return this.knownSnapshot;
  }

  get asDatabase() {
    return new NotionDatabase(this.api, this.id);
  }

  update(options: Omit<UpdateBlockParameters, 'block_id'>) {
    return this.api.blocks.update({
      block_id: this.id,
      ...options,
    });
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
    if (this.knownSnapshot) return this.knownSnapshot;
    return this.knownSnapshot = await this.api.pages.retrieve({ page_id: this.id });
  }
  get snapshot() {
    if (!this.knownSnapshot) throw new Error(`BUG: Snapshot wasn't loaded, call .ensureSnapshot first`)
    return this.knownSnapshot;
  }

  get createdTime() { return new Date(this.snapshot.created_time); }
  get lastEditedTime() { return new Date(this.snapshot.last_edited_time); }
  get url() { return this.snapshot.url; }

  // let the weird property type stuff live here
  findPropertyOfType<T extends string>(type: T, name?: string) {
    return Object
      .entries(this.snapshot.properties)
      .find(x => x[1].type == type && (name == null || name == x[0]))
    ?.[1] as (GetPageResponse['properties'][string] & {type: T}) | undefined;
  }

  // exactly one of these props so a getter seems more intuitive
  get title() {
    const prop = this.findPropertyOfType('title');
    return new NotionRichText(prop?.title ?? []);
  }

  findDateProperty(name?: string) {
    const prop = this.findPropertyOfType('date', name);
    return prop?.date ? {
      start: new Date(prop.date.start),
      end: prop.date.end ? new Date(prop.date.end) : null,
      hasTime: prop.date.start.includes('T'),
    } : null;
  }

  findUrlProperty(name?: string) {
    const prop = this.findPropertyOfType('url', name);
    return prop?.url;
  }
  findRichTextProperty(name?: string) {
    const prop = this.findPropertyOfType('rich_text', name);
    return prop && new NotionRichText(prop.rich_text);
  }
  findSelectProperty(name?: string) {
    const prop = this.findPropertyOfType('select', name);
    return prop?.select;
  }
  findMultiSelectProperty(name?: string) {
    const prop = this.findPropertyOfType('multi_select', name);
    return prop?.multi_select;
  }

  update(options: Omit<UpdatePageParameters, 'page_id'>) {
    return this.api.pages.update({
      page_id: this.id,
      ...options,
    });
  }
}

export class NotionRichText {
  constructor(
    // TODO: probably a shorter path to this?
    public spans: (GetPageResponse['properties'][string] & {type: 'title'})['title'],
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
    if (this.knownSnapshot) return this.knownSnapshot;
    return this.knownSnapshot = await this.api.databases.retrieve({ database_id: this.id });
  }
  get snapshot() {
    if (!this.knownSnapshot) throw new Error(`BUG: Snapshot wasn't loaded, call .ensureSnapshot first`)
    return this.knownSnapshot;
  }

  get title() { return new NotionRichText(this.snapshot.title); }
  get url() { return this.snapshot.url; }

  update(options: Omit<UpdateDatabaseParameters, 'database_id'>) {
    return this.api.databases.update({
      database_id: this.id,
      ...options,
    });
  }
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
