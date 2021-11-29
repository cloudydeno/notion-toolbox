import { assertEquals } from "https://deno.land/std@0.105.0/testing/asserts.ts";
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
      this.lines.push(`<p>${formText(block.paragraph.text)}</p>`);
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
      this.lines.push(`<h2 ${idAttr}>${formText(block.heading_1.text)}</h2>`);
    } else if (block.type === 'heading_2') {
      this.ensureParentIs(null);
      assertEquals(block.has_children, false);
      this.lines.push(`<h3 ${idAttr}>${formText(block.heading_2.text)}</h3>`);
    } else if (block.type === 'heading_3') {
      this.ensureParentIs(null);
      assertEquals(block.has_children, false);
      this.lines.push(`<h4 ${idAttr}>${formText(block.heading_3.text)}</h4>`);
    } else if (block.type === 'quote') {
      this.lines.push(`<blockquote>`);
      this.lines.push(`<p>${formText(block.quote.text)}</p>`);
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
      this.lines.push(`<summary ${idAttr}>${formText(block.toggle.text)}</summary>`);
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
      const codeText = new NotionRichText(block.code.text);
      if (block.code.language === 'html') {
        // TODO: gate this better, such as checking 'caption' once we have that
        this.lines.push(codeText.asPlainText);
      } else {
        this.lines.push(`<pre ${idAttr} class="language-${encode(block.code.language)}"><code>${encode(codeText.asPlainText)}</code></pre>`);
      }
    } else if (block.type === 'numbered_list_item') {
      this.ensureParentIs('ol');
      this.lines.push('<li>' + formText(block.numbered_list_item.text));
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
      this.lines.push('<li>' + formText(block.bulleted_list_item.text));
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
    } else {
      console.error('TODO block:', JSON.stringify(block, null, 2))
      // console.error('TODO:', block.id, block.type, block.has_children);
    }
  }
}

function formText(texts: NotionRichText['spans']) {
  const bits = new Array<string>();
  for (const text of texts) {
    assertEquals(text.type, 'text');
    if (text.type === 'text') {
      if (text.text.link) bits.push(`<a href="${encode(text.text.link.url)}" target="_blank">`);
      if (text.annotations.code) bits.push('<code>');
      if (text.annotations.bold) bits.push('<strong>');
      if (text.annotations.italic) bits.push('<em>');
      if (text.annotations.underline) bits.push('<ins>');
      if (text.annotations.strikethrough) bits.push('<del>');
      if (text.annotations.color != 'default') bits.push(`<span ${mapColorToAttribute(text.annotations.color)}>`);
      bits.push(encode(text.text.content).replace(/\r?\n/g, '\n<br/>'));
      if (text.annotations.color != 'default') bits.push(`</span>`);
      if (text.annotations.strikethrough) bits.push('</del>');
      if (text.annotations.underline) bits.push('</ins>');
      if (text.annotations.italic) bits.push('</em>');
      if (text.annotations.bold) bits.push('</strong>');
      if (text.annotations.code) bits.push('</code>');
      if (text.text.link) bits.push(`</a>`);
    }
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
