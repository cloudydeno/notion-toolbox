import { assertEquals } from "https://deno.land/std@0.115.0/testing/asserts.ts";
import { encode } from "https://deno.land/x/html_entities@v1.0/lib/xml-entities.js";

import {
  NotionBlock,
  NotionPage,
  NotionRichText,
} from "../object-model/mod.ts";

export async function emitPageHtml(page: NotionPage) {
  const scope = new HtmlBlockScope();
  for await (const block of page.listAllChildren()) {
    await scope.writeBlock(block);
  }
  return {
    plainTitle: encode(page.title.asPlainText),
    richTitle: formText(page.title.spans),
    body: scope.stringify(),
  };
}

class HtmlBlockScope {
  readonly lines = new Array<String>();
  stringify() {
    this.ensureParentIs(null);
    return this.lines.join('\n');
  }

  private inParent: null | 'ol' | 'ul' = null;
  ensureParentIs(parent: typeof this.inParent) {
    if (this.inParent == parent) return;
    if (this.inParent) this.lines.push(`</${this.inParent}>`);
    if (parent) this.lines.push(`<${parent}>`);
    this.inParent = parent;
  }

  async writeBlock(ref: NotionBlock) {
    const idAttr = `id="${ref.id.split('-')[0]}"`;
    const block = await ref.ensureSnapshot();
    if (block.type === 'paragraph') {
      this.ensureParentIs(null);
      this.lines.push(`<p>${formText(block.paragraph.rich_text)}</p>`);
      if (block.has_children) {
        this.lines.push('<div style="padding-left: 1.5em;">');
        for await (const child of ref.listAllChildren()) {
          await this.writeBlock(child);
        }
        this.lines.push('</div>');
      }
    } else if (block.type === 'divider') {
      this.ensureParentIs(null);
      assertEquals(block.has_children, false);
      this.lines.push(`<hr />`);
    } else if (block.type === 'heading_1') {
      this.ensureParentIs(null);
      assertEquals(block.has_children, false);
      this.lines.push(`<h2 ${idAttr}>${formText(block.heading_1.rich_text)}</h2>`);
    } else if (block.type === 'heading_2') {
      this.ensureParentIs(null);
      assertEquals(block.has_children, false);
      this.lines.push(`<h3 ${idAttr}>${formText(block.heading_2.rich_text)}</h3>`);
    } else if (block.type === 'heading_3') {
      this.ensureParentIs(null);
      assertEquals(block.has_children, false);
      this.lines.push(`<h4 ${idAttr}>${formText(block.heading_3.rich_text)}</h4>`);
    } else if (block.type === 'quote') {
      this.lines.push(`<blockquote>`);
      this.lines.push(`<p>${formText(block.quote.rich_text)}</p>`);
      if (block.has_children) {
        const scope = new HtmlBlockScope();
        for await (const child of ref.listAllChildren()) {
          await scope.writeBlock(child);
        }
        this.lines.push(scope.stringify());
      }
      this.lines.push(`</blockquote>`);
    } else if (block.type === 'toggle') {
      this.lines.push(`<details>`);
      this.lines.push(`<summary ${idAttr}>${formText(block.toggle.rich_text)}</summary>`);
      if (block.has_children) {
        const scope = new HtmlBlockScope();
        for await (const child of ref.listAllChildren()) {
          await scope.writeBlock(child);
        }
        this.lines.push('<div style="padding-left: 1.5em;">');
        this.lines.push(scope.stringify());
        this.lines.push('</div>');
      }
      this.lines.push(`</details>`);
    } else if (block.type === 'code') {
      this.ensureParentIs(null);
      assertEquals(block.has_children, false);
      const codeText = new NotionRichText(block.code.rich_text);
      if (block.code.language === 'html') {
        // TODO: gate this better, such as checking 'caption' once we have that
        this.lines.push(codeText.asPlainText);
      } else {
        this.lines.push(`<pre ${idAttr} class="language-${encode(block.code.language)}"><code>${encode(codeText.asPlainText)}</code></pre>`);
      }
    } else if (block.type === 'numbered_list_item') {
      this.ensureParentIs('ol');
      this.lines.push('<li>' + formText(block.numbered_list_item.rich_text));
      if (block.has_children) {
        const scope = new HtmlBlockScope();
        for await (const child of ref.listAllChildren()) {
          await scope.writeBlock(child);
        }
        this.lines.push(scope.stringify());
      }
      this.lines.push('</li>');
    } else if (block.type === 'bulleted_list_item') {
      this.ensureParentIs('ul');
      this.lines.push('<li>' + formText(block.bulleted_list_item.rich_text));
      if (block.has_children) {
        const scope = new HtmlBlockScope();
        for await (const child of ref.listAllChildren()) {
          await scope.writeBlock(child);
        }
        this.lines.push(scope.stringify());
      }
      this.lines.push('</li>');
    } else if (block.type === 'image') {
      this.ensureParentIs(null);
      assertEquals(block.has_children, false);
      if (block.image.type === 'external') {
        this.lines.push(`<img title="${encode(new NotionRichText(block.image.caption).asPlainText)}" src="${encode(block.image.external.url)}">`);
      } else if (block.image.type === 'file') {
        // TODO: register images for uploading
        this.lines.push(`<img title="${encode(new NotionRichText(block.image.caption).asPlainText)}" src="${encode(block.image.file.url)}">`);
      }
    } else if (block.type === 'embed') {
      this.ensureParentIs(null);
      if (block.embed.url.startsWith('https://twitter.com/')) {
        const params = new URLSearchParams([['url', block.embed.url]]);
        const oembed = await fetch('https://publish.twitter.com/oembed?'+params).then(x => x.json());
        this.lines.push((oembed.html as string).trim());
      } else {
        console.error('TODO: embed', JSON.stringify(block, null, 2))
      }
    // } else if (block.type === 'column_list') {
    } else if (block.type === 'table') {
      this.ensureParentIs(null);
      this.lines.push('<table class="simple-table">');
      if (block.has_children) {
        const scope = new HtmlBlockScope();
        let isHead = block.table.has_column_header;
        scope.lines.push(isHead ? `<thead>` : `<tbody>`);
        for await (const child of ref.listAllChildren()) {
          const childData = await child.ensureSnapshot();
          if (childData.type !== 'table_row') {
            await scope.writeBlock(child);
            continue;
          }
          if (isHead) {
            scope.lines.push('<tr>');
            for (const cell of childData.table_row.cells) {
              scope.lines.push(`<th>${formText(cell)}</th>`);
            }
            scope.lines.push('</tr>');
            scope.lines.push(`</thead>`);
            scope.lines.push(`<tbody>`);
            isHead = false;
          } else {
            scope.lines.push('<tr>');
            for (const cell of childData.table_row.cells) {
              const tag = (block.table.has_row_header
                 && cell == childData.table_row.cells[0])
                  ? 'th' : 'td';
              scope.lines.push(`<${tag}>${formText(cell)}</${tag}>`);
            }
            scope.lines.push('</tr>');
          }
        }
        scope.lines.push(isHead ? `</thead>` : `</tbody>`);
        this.lines.push(scope.stringify());
      }
      this.lines.push('</table>');
    } else if (block.type === 'table_row') {
      throw new Error(`Found a table_row outside of a table`);
    } else {
      console.error('TODO block:', JSON.stringify(block, null, 2))
      // console.error('TODO:', block.id, block.type, block.has_children);
    }
  }
}

function formText(texts: NotionRichText['spans']) {
  const textWithTags = texts.flatMap(text => {
    // Handle specific rich text spans that we care about
    if (text.type === 'mention') {
      if (text.mention.type === 'link_preview') {
        const { url } = text.mention.link_preview;
        // e.g. https://github.com/danopia/kube-pet-node
        // TODO: better handling
        return [{
          text: encode(url.split('/').slice(-1)[0]).replace(/\r?\n/g, '\n<br/>'),
          tags: new Set([
            `<a href="${encode(url)}" target="_blank">`,
          ]),
        }];
      }
    }

    assertEquals(text.type, 'text');
    if (text.type !== 'text') return [];

    const tags = new Set<string>();
    if (text.text.link) tags.add(`<a href="${encode(text.text.link.url)}" target="_blank">`);
    if (text.annotations.code) tags.add('<code>');
    if (text.annotations.bold) tags.add('<strong>');
    if (text.annotations.italic) tags.add('<em>');
    if (text.annotations.underline) tags.add('<ins>');
    if (text.annotations.strikethrough) tags.add('<del>');
    if (text.annotations.color != 'default') tags.add(`<span ${mapColorToAttribute(text.annotations.color)}>`);
    return [{
      text: encode(text.text.content).replace(/\r?\n/g, '\n<br/>'),
      tags,
    }];
  });

  const bits = new Array<string>();
  const openTags = new Array<string>();
  textWithTags.forEach(({text, tags}, idx, array) => {
    while (openTags.length > 0 && openTags.some(x => !tags.has(x))) {
      const goneTag = openTags.shift()!;
      bits.push(`</${goneTag.split(/[<> ]/)[1]}>`);
    }

    const newTags = Array.from(tags).filter(x => !openTags.includes(x));
    const nextTags = array[idx+1]?.tags ?? new Set();
    newTags.sort((a, b) => {
      if (nextTags.has(a) === nextTags.has(b)) {
        return `${a}`.localeCompare(`${b}`);
      }
      else return nextTags.has(a) ? -1 : 1;
    });

    for (const tag of newTags) {
      bits.push(tag);
      openTags.unshift(tag);
    }

    bits.push(text);
  });
  while (openTags.length > 0) {
    const goneTag = openTags.shift()!;
    bits.push(`</${goneTag.split(/[<> ]/)[1]}>`);
  }
  return bits.join('');
}

function mapColorToAttribute(color: NotionRichText['spans'][number]['annotations']['color']) {
  if (color.endsWith('_background')) {
    return `style="background-color: ${color.replace(/_background$/, '')};"`;
  } else {
    return `style="color: ${color};"`;
  }
}
