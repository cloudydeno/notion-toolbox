#!/usr/bin/env -S deno run --allow-net=api.notion.com --allow-env=NOTION_KEY

import { readableStreamFromIterable } from "https://deno.land/std@0.115.0/io/streams.ts";
import { map } from "https://deno.land/x/stream_observables@v1.2/transforms/map.ts";
import { NotionConnection, NotionDatabase } from "../object-model/mod.ts";
import { RequestContext } from "../types.ts";
import { CalendarObject } from "./ical.ts";

export async function makeCalendarResponse(req: RequestContext) {
  const notion = await req.getNotion();

  // find the desired database
  const db = await notion.searchForFirstDatabase({
    query: req.params.get('query') ?? undefined,
  });
  if (!db) return new Response('Database not found', {status: 404});

  // how often does google calendar update anyway?
  req.metricTags.push(`notion_db:${db.title.asPlainText}`);
  req.incrementCounter('notion.database_as_ical.render', 1);

  // stream the iCal down
  const dataStream = readableStreamFromIterable(emitCalendar(db));
  const encoder = new TextEncoder();
  return new Response(dataStream.pipeThrough(map(x => encoder.encode(x))), {
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

  for await (const page of db.queryAllPages()) {
    const dateProp = page.findDateProperty();
    if (!dateProp) continue;

    yield new CalendarObject('VEVENT')
      .string('UID', `${page.id}@notion.so`)
      .datetime('DTSTAMP', page.lastEditedTime, true)
      .datetime('DTSTART', dateProp.start, dateProp.hasTime)
      .datetime('DTEND', determineEndDate(dateProp), dateProp.hasTime)
      .string('SUMMARY', page.title.asPlainText)
      .string('DESCRIPTION', page.url)
      .end().flush();
  }

  yield cal.end().flush();
}

function determineEndDate(dateProp: { start: Date; end: Date|null; hasTime: boolean; }) {
  if (dateProp.end) return dateProp.end;
  const endDate = new Date(dateProp.start);
  endDate.setHours(endDate.getHours() + (dateProp.hasTime ? 1 : 24));
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
