import { RequestContext } from "../types.ts";

import { ApiFactory, AwsServiceError } from "https://deno.land/x/aws_api@v0.5.0/client/mod.ts";
import { S3 } from "https://aws-api.deno.dev/v0.3/services/s3.ts?actions=HeadObject,GetObject,PutObject";
import { emitPageHtml } from "./mod.ts";
const s3 = new ApiFactory().makeNew(S3);

const Bucket = Deno.env.get('S3_BUCKET') ?? '';
if (!Bucket) throw new Error(`S3_BUCKET is required`);

export async function makeExtractHtmlResponse(req: RequestContext) {
  const pageId = req.params.get('page');
  if (!pageId) return new Response(`Need ?page=<pageid>`, {status: 400});

  const notion = await req.getNotion();

  // find the desired page
  const page = await notion.pageById(pageId);
  if (!page) return new Response('Page not found', {status: 404});

  const headers = new Headers();
  headers.set('last-modified', page.lastEditedTime.toUTCString());
  const slug = page.snapshot.url.split('/').slice(-1)[0].replace(/-[0-9a-f]+$/, '');
  headers.set('content-type', `text/html; charset=utf-8`);
  headers.set('content-disposition', `inline; filename="${slug ?? 'page'}.html"`);
  if (page.snapshot.icon?.type == 'emoji') {
    headers.set('x-page-emoji', encodeURI(page.snapshot.icon.emoji));
  }
  // 'x-plain-title': cacheHead?.Metadata?.['plain-title'] ?? '',
  headers.set('last-modified', page.lastEditedTime.toUTCString());

  // console.log(page);
  const Key = `extract-html/${page.id}.html`;

  const cacheHead = await s3.headObject({
    Bucket, Key,
  }).catch(err => {
    if (!(err instanceof AwsServiceError)) throw err;
    if (err.code !== 'Http404') throw err;
    return null;
  });

  if (cacheHead?.Metadata?.['last-edited'] === page.snapshot.last_edited_time) {
    headers.set('x-cache', 'HIT');
    console.log('HTML Cache hit for page', page.id);

    const cachedObject = await s3.getObject({
      Bucket, Key,
      VersionId: cacheHead.VersionId,
    });

    // 'x-plain-title': cacheHead?.Metadata?.['plain-title'] ?? '',
    return new Response(cachedObject.Body, { headers });
  } else if (cacheHead) {
    headers.set('x-cache', 'STALE');
  } else {
    headers.set('x-cache', 'MISS');
  }

  console.log('Extracting HTML for page', page.id, '- cache', headers.get('x-cache'));

  const d0 = Date.now();
  const {body, plainTitle, richTitle} = await emitPageHtml(page);
  const htmlDoc = [
    '<!doctype html>',
    '<meta charset="utf-8">',
    `<title>${plainTitle}</title>`,
    `<h1>${richTitle}</h1>`,
    `<!-- start body -->`,
    body,
  ].join('\n');
  const dt = Date.now() - d0;

  console.log('Extracted', htmlDoc.split('\n').length, 'lines of HTML in', dt, 'ms');

  await s3.putObject({
    Bucket, Key,
    Body: htmlDoc,
    Metadata: {
      'filename': page.snapshot.url.split('/').slice(-1)[0].replace(/-[0-9a-f]+$/, '')+'.html',
      'last-edited': page.snapshot.last_edited_time,
    },
  });

  return new Response(htmlDoc, { headers });
}
