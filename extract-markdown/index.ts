#!/usr/bin/env -S deno run --allow-env=NOTION_KEY --allow-net=api.notion.com --allow-write=.
import { assertEquals } from "https://deno.land/std@0.115.0/testing/asserts.ts";

import {
  NotionConnection,
  NotionBlock,
  NotionPage,
  NotionRichText,
} from "../object-model/mod.ts";

const notion = NotionConnection.fromEnv(Deno.env);

switch (true) {

  case Deno.args[0] == 'database' && Deno.args.length == 2: {
    const db = await notion.searchForFirstDatabase({
      query: Deno.args[1],
    });
    if (!db) throw "No database found matching query";

    for await (const page of db.queryAllPages()) {
      const plainTitle = formText(page.title.spans);

      const md = `# ${plainTitle}\n\n${await emitPageMarkdown(page)}`;
      await Deno.writeTextFile(`${plainTitle}.md`, md);
      console.log(`${plainTitle}.md`);
    }
  }; break;

  case Deno.args[0] == 'pages' && Deno.args.length == 2: {
    throw "TODO: page input";
  }; break;

  default: {
    console.error(`USAGE:`);
    console.error(`  ./index.ts database <query>    Extract all pages within one database.`);
    // console.error(`  ./index.ts pages <query>       Extract all pages matching a search.`);
    Deno.exit(1);
  };
}

async function emitPageMarkdown(page: NotionPage) {
  const lines = new Array<string>();
  for await (const block of page.listAllChildren()) {
    for await (const x of writeBlock(block)) {
      lines.push(x);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function* writeBlock(ref: NotionBlock): AsyncGenerator<string> {
  const block = await ref.ensureSnapshot();
  if (block.type === 'paragraph') {
    assertEquals(block.has_children, false);
    yield formText(block.paragraph.rich_text);
  } else if (block.type === 'heading_1') {
    assertEquals(block.has_children, false);
    yield '## '+formText(block.heading_1.rich_text);
  } else if (block.type === 'heading_2') {
    assertEquals(block.has_children, false);
    yield '### '+formText(block.heading_2.rich_text);
  } else if (block.type === 'heading_3') {
    assertEquals(block.has_children, false);
    yield '#### '+formText(block.heading_3.rich_text);
  } else if (block.type === 'quote') {
    assertEquals(block.has_children, false);
    yield '> '+formText(block.quote.rich_text);
  } else if (block.type === 'code') {
    assertEquals(block.has_children, false);
    assertEquals(block.code.rich_text.length, 1);
    assertEquals(block.code.rich_text[0].type, 'text');
    yield '```'+block.code.language;
    for (const x of block.code.rich_text[0].plain_text.split(/\r?\n+/)) {
      yield x;
    }
    yield '```';
  } else if (block.type === 'numbered_list_item') {
    yield '1.  ' + formText(block.numbered_list_item.rich_text);
    if (block.has_children) {
      for await (const child of ref.listAllChildren()) {
        yield '';
        for await (const x of writeBlock(child)) {
          yield '    '+x;
        }
      }
    }
  } else if (block.type === 'bulleted_list_item') {
    yield '*   ' + formText(block.bulleted_list_item.rich_text);
    if (block.has_children) {
      for await (const child of ref.listAllChildren()) {
        yield '';
        for await (const x of writeBlock(child)) {
          yield '    '+x;
        }
      }
    }
  } else if (block.type === 'image') {
    assertEquals(block.has_children, false);
    if (block.image.type === 'external') {
      yield `![${formText(block.image.caption)}](${block.image.external.url})`;
    } else if (block.image.type === 'file') {
      // TODO: register images for uploading
      yield `![${formText(block.image.caption)}](${block.image.file.url})`;
    }
  } else {
    yield 'TODO:', block.id, block.type, block.has_children;
  }
}

function formText(texts: NotionRichText['spans']) {
  const bits = new Array<string>();
  for (const text of texts) {
    assertEquals(text.type, 'text');
    assertEquals(text.annotations.color, 'default');
    if (text.type === 'text') {
      if (text.text.link) {
        bits.push(`[${text.text.content}](${text.text.link.url})`);
      } else if (text.annotations.code) {
        bits.push('`'+text.text.content.replace(/`/g,'\\`')+'`');
      } else if (text.annotations.bold && text.annotations.italic) {
        bits.push('***'+text.text.content+'***');
      } else if (text.annotations.italic) {
        bits.push('*'+text.text.content+'*');
      } else if (text.annotations.bold) {
        bits.push('**'+text.text.content+'**');
      } else if (text.annotations.underline) {
        bits.push('<ins>'+text.text.content+'</ins>');
      } else if (text.annotations.strikethrough) {
        bits.push('~~'+text.text.content+'~~');
      } else {
        bits.push(text.text.content);
      }
    }
  }
  return bits.join('');
}
