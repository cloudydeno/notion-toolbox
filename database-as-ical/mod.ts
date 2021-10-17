#!/usr/bin/env -S deno run --allow-net=api.notion.com --allow-env=NOTION_KEY

import { NotionConnection, NotionDatabase } from "../object-model/mod.ts";

if (import.meta.main) {
  const notion = NotionConnection.fromEnv();
  const db = await notion.searchForFirstDatabase({query: 'Posts'});
  if (!db) throw new Error(`No 'Posts' database found`);
  for await (const line of emitICalendar(db)) {
    await Deno.stdout.write(new TextEncoder().encode(line));
  }
}

export async function* emitICalendar(db: NotionDatabase) {
  yield `BEGIN:VCALENDAR\n`;
  yield `PRODID:-//cloudydeno//notion-as-ical//EN\n`;
  yield `VERSION:2.0\n`;
  yield `X-WR-CALNAME:${escapeString(db.title.asPlainText)} (Notion)\n`;
  yield `\n`;

  for await (const page of db.queryAllPages()) {
    const dateProp = page.dateProp;
    if (!dateProp) continue;

    yield `BEGIN:VEVENT\n`;
    yield `DTSTAMP${formatDate(page.lastEditedTime, true)}\n`;
    yield `DTSTART${formatDate(dateProp.start, dateProp.hasTime)}\n`;
    if (dateProp.end) {
      yield `DTEND${formatDate(dateProp.end, dateProp.hasTime)}\n`;
    } else {
      const endDate = new Date(dateProp.start);
      endDate.setHours(endDate.getHours() + (dateProp.hasTime ? 1 : 24));
      yield `DTEND${formatDate(endDate, dateProp.hasTime)}\n`;
    }
    yield `SUMMARY:${escapeString(page.titleProp.asPlainText)}\n`;
    yield `DESCRIPTION:${escapeString(page.url)}\n`;
    yield `END:VEVENT\n\n`;
  }
  yield `END:VCALENDAR\n`;
}

function formatDate(date: Date, hasTime: boolean) {
  if (hasTime) {
    return ':'+date.toISOString().replace(/([-:]|\.\d+)/g, '');
  } else {
    return ';VALUE=DATE:'+date.toISOString().split('T')[0].replace(/-/g, '');
  }
}

function escapeString(raw: string) {
  return raw
    .replace(/[\\,;]/g, x => `\\${x}`)
    .replace(/\r?\n/g, '\\n');
}
