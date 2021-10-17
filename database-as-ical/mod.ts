#!/usr/bin/env -S deno run --allow-net=api.notion.com --allow-env=NOTION_KEY

import { NotionConnection, NotionDatabase } from "../object-model/mod.ts";
import { Calendar, CalEvent } from "./ical.ts";

export async function* emitICalendar(db: NotionDatabase) {
  const cal = new Calendar()
    .string('PRODID', '-//cloudydeno//notion-as-ical//EN')
    .string('VERSION', '2.0')
    .string('X-WR-CALNAME', `${db.title.asPlainText} (Notion)`)
  yield cal.flush();

  for await (const page of db.queryAllPages()) {
    const dateProp = page.findDateProperty();
    if (!dateProp) continue;
    yield new CalEvent()
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

  for await (const line of emitICalendar(db)) {
    await Deno.stdout.write(new TextEncoder().encode(line));
  }
}
