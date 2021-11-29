#!/usr/bin/env -S deno run --allow-env=NOTION_KEY --allow-net=api.notion.com,publish.twitter.com --allow-write=.

import { NotionConnection, NotionPage } from "../object-model/mod.ts";
import { emitPageHtml } from "./mod.ts";

const notion = NotionConnection.fromEnv(Deno.env);

switch (true) {

  case Deno.args[0] == 'database' && Deno.args.length == 2: {
    const db = await notion.searchForFirstDatabase({
      query: Deno.args[1],
    });
    if (!db) throw "No database found matching query";

    for await (const page of db.queryAllPages()) {
      await writePage(page);
    }
  }; break;

  case Deno.args[0] == 'pages' && Deno.args.length == 2: {
    for await (const page of notion.searchForPages({
      query: Deno.args[1],
    })) {
      await writePage(page);
    }
  }; break;

  default: {
    console.error(`USAGE:`);
    console.error(`  ./cli.ts database <query>    Extract all pages within one database.`);
    console.error(`  ./cli.ts pages <query>       Extract all pages matching a search.`);
    Deno.exit(1);
  };
}

async function writePage(page: NotionPage) {
  const filePath = `${page.title.asPlainText}.html`;
  const {body, plainTitle, richTitle} = await emitPageHtml(page);
  await Deno.writeTextFile(new URL(filePath, import.meta.url), [
    '<!doctype html>',
    '<meta charset="utf-8">',
    `<title>${plainTitle}</title>`,
    `<h1>${richTitle}</h1>`,
    body,
  ].join('\n'));
  console.log(filePath);
}
