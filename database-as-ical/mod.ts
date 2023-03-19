#!/usr/bin/env -S deno run --allow-net=api.notion.com --allow-env=NOTION_KEY

import { readableStreamFromIterable } from "https://deno.land/std@0.115.0/streams/conversion.ts";
import { map } from "https://deno.land/x/stream_observables@v1.2/transforms/map.ts";
import { NotionConnection, NotionDatabase } from "../object-model/mod.ts";
import { trace } from "../tracer.ts";
import { RequestContext } from "../types.ts";
import { CalendarObject } from "./ical.ts";

export async function makeCalendarResponse(req: RequestContext) {
  if (!req.notion) return new Response('auth= key required', {status: 400});

  // find the desired database
  const db = await req.notion.searchForFirstDatabase({
    query: req.params.get('query') ?? undefined,
  });
  if (!db) return new Response('Database not found', {status: 404});
  trace.getActiveSpan()?.setAttribute('notion.database', db.title.asPlainText);

  // stream the iCal down
  const dataStream = readableStreamFromIterable(emitCalendar(db));
  return new Response(dataStream.pipeThrough(new TextEncoderStream()), {
    headers: {
      'content-type': `text/${req.wantsHtml ? 'plain' : 'calendar'}; charset=utf-8`,
      'content-disposition': 'inline; filename=calendar.ics',
    },
  });
}

export async function* emitCalendar(db: NotionDatabase) {
  const cal = new CalendarObject('VCALENDAR')
    .string('PRODID', import.meta.url.startsWith('https:')
      ? import.meta.url : '-//cloudydeno/notion-toolbox//database-as-ical//EN')
    .string('VERSION', '2.0')
    .string('X-WR-CALNAME', `${db.title.asPlainText} (Notion)`)
    .string('X-WR-RELCALID', `${db.id}@notion.so`)
    .string('X-PUBLISHED-TTL', 'PT1H')
  yield cal.flush();

  let eventCount = 0;
  for await (const page of db.queryAllPages()) {
    const dateProp = page.findDateProperty();
    if (!dateProp) continue;
    eventCount++;

    yield new CalendarObject('VEVENT')
      .string('UID', `${page.id}@notion.so`)
      .datetime('DTSTAMP', page.lastEditedTime, true)
      .datetime('DTSTART', dateProp.start, dateProp.hasTime)
      .datetime('DTEND', determineEndDate(dateProp), dateProp.hasTime)
      .string('SUMMARY', page.title.asPlainText)
      .string('DESCRIPTION', page.url)
      .end().flush();
  }

  trace.getActiveSpan()?.setAttribute('app.entries_returned', eventCount);

  yield cal.end().flush();
}

function determineEndDate(dateProp: { start: Date; end: Date|null; hasTime: boolean; }) {
  const endDate = new Date(dateProp.end ?? dateProp.start);
  if (dateProp.end) {
    if (dateProp.hasTime) return dateProp.end;
    endDate.setDate(endDate.getDate() + 1);
  } else {
    endDate.setHours(endDate.getHours() + (dateProp.hasTime ? 1 : 24));
  }
  return endDate;
}

// CLI test entrypoint, not used when handling HTTP requests
if (import.meta.main) {
  const notion = NotionConnection.fromEnv();
  const db = await notion.searchForFirstDatabase({query: 'Posts'});
  if (!db) throw new Error(`No 'Posts' database found`);

  for await (const line of emitCalendar(db)) {
    await Deno.stdout.write(new TextEncoder().encode(line));
  }
}
