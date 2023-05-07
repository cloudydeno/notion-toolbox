import "https://deno.land/x/observability@v0.4.0/preconfigured/from-environment.ts";
import { trace, httpTracer } from "https://deno.land/x/observability@v0.4.0/mod.ts";

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

import { makeCalendarResponse } from "./database-as-ical/mod.ts";
import { makeExtractHtmlResponse } from "./extract-html/api.ts";
import { NotionConnection } from "./object-model/mod.ts";
import { RequestContext } from "./types.ts";

const repoUrl = 'https://github.com/cloudydeno/notion-toolbox';

async function routeRequest(ctx: RequestContext): Promise<Response> {
  const httpSpan = trace.getActiveSpan();

  if (ctx.path === '/database-as-ical') {
    httpSpan?.setAttribute('http.route', 'database-as-ical');
    return await makeCalendarResponse(ctx);
  } else if (ctx.path === '/extract-html') {
    httpSpan?.setAttribute('http.route', 'extract-html');
    return await makeExtractHtmlResponse(ctx);
  } else if (ctx.path === '/') {
    httpSpan?.setAttribute('http.route', 'index');
    return ResponseText(200, `Notion Toolbox :)\n\n${repoUrl}`);
  } else {
    httpSpan?.setAttribute('http.route', '404');
    return ResponseText(404, 'Not found');
  }
}

async function handleRequest(request: Request): Promise<Response> {
  const ctx = new RequestImpl(request);
  trace.getActiveSpan()?.setAttribute('http.wants_html', ctx.wantsHtml);
  console.log(request.method, ctx.path);

  if (ctx.notion) {
    const botUser = await ctx.notion.api.users.me({});
    if (botUser.name) {
      trace.getActiveSpan()?.setAttribute('notion.bot_user', botUser.name);
    }
  }

  const resp = await routeRequest(ctx).catch(renderError);
  return resp;
}

class RequestImpl implements RequestContext {
  public readonly path: string;
  public readonly params: URLSearchParams;
  public readonly notion: NotionConnection | null;

  constructor(
    public readonly original: Request,
  ) {
    const { protocol, host, pathname, search, searchParams, origin } = new URL(original.url);
    this.path = pathname;
    this.params = searchParams;

    const auth = this.params.get('auth');
    this.notion = auth ? NotionConnection.fromStaticAuthToken(auth) : null;
  }

  get wantsHtml() {
    return this.original.headers.get('accept')?.split(',').some(x => x.startsWith('text/html')) ?? false;
  }
}


function renderError(err: Error) {
  const msg = err.stack || err.message || JSON.stringify(err);
  console.error('!!!', msg);
  return ResponseText(500, `Internal Error!
Feel free to try a second attempt.
File any issues here: ${repoUrl}/issues
Internal stacktrace follows:
${msg}`);
}
function ResponseText(status: number, body: string) {
  const headers = new Headers();
  headers.set('content-type', "text/plain; charset=utf-8");
  return new Response(body, { status, headers });
}

console.log("Listening on http://localhost:8000");
serve(httpTracer(async (request) => {
  const response = await handleRequest(request).catch(renderError);
  response.headers.set("server", "notion-api-toolbox/v0.4.0");
  return response;
}));
