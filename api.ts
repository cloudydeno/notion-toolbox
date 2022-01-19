import { serve } from "https://deno.land/std@0.120.0/http/server.ts";

import DatadogApi from "https://deno.land/x/datadog_api@v0.1.5/mod.ts";
import { MetricSubmission } from "https://deno.land/x/datadog_api@v0.1.5/v1/metrics.ts";
const datadog = DatadogApi.fromEnvironment(Deno.env);

import { makeCalendarResponse } from "./database-as-ical/mod.ts";
import { NotionConnection } from "./object-model/mod.ts";
import { RequestContext } from "./types.ts";

const repoUrl = 'https://github.com/cloudydeno/notion-toolbox';

async function routeRequest(ctx: RequestContext): Promise<Response> {
  if (ctx.path === '/database-as-ical') {
    ctx.metricTags.push('http_controller:database-as-ical');
    return await makeCalendarResponse(ctx);
  } else if (ctx.path === '/') {
    ctx.metricTags.push('http_controller:index');
    return ResponseText(200, `Notion Toolbox :)\n\n${repoUrl}`);
  } else {
    return ResponseText(404, 'Not found');
  }
}

async function handleRequest(request: Request): Promise<Response> {
  const ctx = new RequestImpl(request);
  console.log(request.method, ctx.path);

  ctx.incrementCounter('http.requests', 1);
  try {
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
    if (this.notion) {
      const botUser = await this.notion.api.users.me({});
      this.metricTags.push(`notion_token:${botUser.name}`);
    }

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
serve(async (request) => {
  const response = await handleRequest(request).catch(renderError);
  response.headers.set("server", "notion-api-toolbox/v0.4.0");
  return response;
});
