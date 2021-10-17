import { readableStreamFromIterable } from "https://deno.land/std@0.105.0/io/streams.ts";
import { map } from "https://deno.land/x/stream_observables@v1.2/transforms/map.ts";
import { emitICalendar } from "./database-as-ical/mod.ts";
import { NotionConnection } from "./object-model/mod.ts";

async function asICal(params: URLSearchParams): Promise<Response> {
  const notion = NotionConnection.fromStaticAuthToken(params.get('auth') ?? undefined);

  const db = await notion.searchForFirstDatabase({
    query: params.get('query') ?? undefined,
  });
  if (!db) return new Response('Not Found', {status: 404});

  const dataStream = readableStreamFromIterable(emitICalendar(db));
  return new Response(dataStream.pipeThrough(utf8Encode()), {
    headers: new Headers({
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename=calendar.ics',
    }),
  });
}
function utf8Encode() {
  const encoder = new TextEncoder();
  return map<string,Uint8Array>(x => encoder.encode(x));
}

async function handleRequest(request: Request): Promise<Response> {
  const { protocol, host, pathname, search, searchParams, origin } = new URL(request.url);
  console.log(request.method, pathname);
  const wantsHtml = request.headers.get('accept')?.split(',').some(x => x.startsWith('text/html')) ?? false;

  if (pathname === '/database-as-ical') {
    return await asICal(searchParams);
  } else if (pathname === '/') {
    return ResponseText(200, 'Notion API Toolbox :)');
  } else {
    return ResponseText(404, 'Not found');
  }
}

addEventListener("fetch", async (event) => {
  const request = (event as any).request as Request;
  const response = await handleRequest(request).catch(renderError);
  response.headers.set("server", "notion-api-toolbox/v0.4.0");
  (event as any).respondWith(response);
});
function renderError(err: Error) {
  const msg = err.stack || err.message || JSON.stringify(err);
  console.error('!!!', msg);
  return ResponseText(500, `Internal Error!
Feel free to try a second attempt.
File any issues here: https://github.com/cloudydeno/notion-api-toolbox/issues
Internal stacktrace follows:
${msg}`);
}
function ResponseText(status: number, body: string) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
