import { httpTracer, trace } from "./tracer.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

import DatadogApi from "https://deno.land/x/datadog_api@v0.1.5/mod.ts";
import { MetricSubmission } from "https://deno.land/x/datadog_api@v0.1.5/v1/metrics.ts";
const datadog = DatadogApi.fromEnvironment(Deno.env);

import { makeCalendarResponse } from "./database-as-ical/mod.ts";
import { makeExtractHtmlResponse } from "./extract-html/api.ts";
import { NotionConnection } from "./object-model/mod.ts";
import { RequestContext } from "./types.ts";

const repoUrl = 'https://github.com/cloudydeno/notion-toolbox';

async function routeRequest(ctx: RequestContext): Promise<Response> {
  const httpSpan = trace.getActiveSpan();

  if (ctx.path === '/database-as-ical') {
    httpSpan?.setAttribute('http.route', 'database-as-ical');
    ctx.metricTags.push('http_controller:database-as-ical');
    return await makeCalendarResponse(ctx);
  } else if (ctx.path === '/extract-html') {
    httpSpan?.setAttribute('http.route', 'extract-html');
    ctx.metricTags.push('http_controller:extract-html');
    return await makeExtractHtmlResponse(ctx);
  } else if (ctx.path === '/') {
    httpSpan?.setAttribute('http.route', 'index');
    ctx.metricTags.push('http_controller:index');
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

  ctx.incrementCounter('http.requests', 1);
  try {
    if (ctx.notion) {
      const botUser = await ctx.notion.api.users.me({});
      ctx.metricTags.push(`notion_token:${botUser.name}`);
      trace.getActiveSpan()?.setAttribute('notion.bot_user', botUser.name);
    }

    const resp = await routeRequest(ctx).catch(renderError);
    ctx.metricTags.push(`http_status:${resp.status}`);
    return resp;
  } finally {
    ctx.flushMetrics().catch(err => {
      console.error(`FAILED to flush metrics!`);
      console.error((err as Error).message ?? err);
    });
  }
}

class RequestImpl implements RequestContext {
  public readonly metricTags = new Array<string>();
  private readonly metrics = new Array<MetricSubmission>();
  public readonly path: string;
  public readonly params: URLSearchParams;

  constructor(
    public readonly original: Request,
  ) {
    const { protocol, host, pathname, search, searchParams, origin } = new URL(original.url);
    this.path = pathname;
    this.params = searchParams;
  }

  public notion?: NotionConnection;
  public async getNotion() {
    if (!this.notion) {
      const auth = this.params.get('auth') ?? undefined;
      this.notion = NotionConnection.fromStaticAuthToken(auth);
    }
    return this.notion;
  }

  incrementCounter(name: string, value: number) {
    this.metrics.push({
      metric_name: name,
      metric_type: 'count',
      points: [{value}],
      tags: [],
    });
  }
  async flushMetrics() {
    const metrics = this.metrics.map(x => ({ ...x,
      tags: [...(x.tags || []), ...this.metricTags],
    }));
    this.metrics.length = 0;

    await datadog.v1Metrics.submit(metrics);
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
