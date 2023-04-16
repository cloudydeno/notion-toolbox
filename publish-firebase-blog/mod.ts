#!/usr/bin/env -S deno run --allow-net --allow-env=NOTION_KEY,GOOGLE_APPLICATION_CREDENTIALS,NOTION_TOOLBOX_URL --allow-read

import { NotionBlock, NotionConnection, NotionDatabase, NotionPage, NotionRichText } from "../object-model/mod.ts";

import { ServiceAccount } from "https://crux.land/32WBxC#google-service-account";
import { deployFirebaseSite, SiteFile } from "https://crux.land/2rY57Q#firebase-hosting-deploy";
import Mustache from 'https://deno.land/x/mustache@v0.3.0/mustache.mjs';
import { fetchPhoto } from "./instagram.ts";
import { emitPageHtml } from "../extract-html/mod.ts";

const renderMustache = Mustache.render as unknown as (template: string, view: unknown) => string;

function log (strings: TemplateStringsArray, ...inputs: unknown[]) {
  const escapedInputs = inputs.map(x => typeof x === 'number' ? x : JSON.stringify(x));
  console.debug(`[${new Date().toLocaleTimeString()}]`,
    ...strings.flatMap((x, idx) => idx < escapedInputs.length ? [x.trim(), escapedInputs[idx]] : [x.trim()]));
}

async function publishFirebaseSite(siteId: string, credentialPath: string, files: Iterable<SiteFile>) {
  const credential = await ServiceAccount.readFromFile(credentialPath);
  const token = await credential.issueToken([
    "https://www.googleapis.com/auth/iam",
    "https://www.googleapis.com/auth/firebase",
  ]);
  const release = await deployFirebaseSite({
    siteId, files,
    ...(Deno.args.includes('--publish') ? {} : {
      channelId: 'next',
      channelConfig: {
        retainedReleaseCount: 5,
        ttl: '259200s', // 3d
      },
    }),
    accessToken: token.accessToken,
  });
  return release.name;
}

async function loadContentNode(page: NotionPage): Promise<ContentNode> {
  // async function loadContentNodes(path: ApiHandle): Promise<ContentNode[]> {
  //   const nodesRaw = await getChildrenOf(path, 3);
  //   // console.log(nodesRaw);
  //   return nodesRaw.map(raw => {
  //     if (raw.Type !== 'Folder') throw new Error(`BUG`);
  //     const data = readStructure(raw.Children);
  //     const blobs = raw.Children.flatMap(x => x.Type === 'Blob' ? [x] : []);
  // console.log(page.knownSnapshot);

  const extractServer = Deno.env.get("NOTION_TOOLBOX_URL");
  if (extractServer) {
    const auth = Deno.env.get("NOTION_KEY") ?? '';
    const htmlResp = await fetch(new URL(`extract-html?auth=${auth}&page=${page.id}&edited=${page.snapshot.last_edited_time}`, extractServer));
    if (htmlResp.status !== 200) throw new Error(`extract-html API gave ${htmlResp.status} for ${page.id}`);
    const text = await htmlResp.text();

    const marker = '\n<!-- start body -->\n';
    const head = text.slice(0, text.indexOf(marker));
    const body = text.slice(head.length + marker.length);
    const plainTitle = head.match(/<title>(.+)<\/title>/)?.[1];
    const richTitle = head.match(/<h1>(.+)<\/h1>/)?.[1];
    if (!plainTitle || !richTitle) throw new Error(`Failed to find titles in HTML head`);

    const filename = `${page.findRichTextProperty('URL Slug')?.asPlainText || page.id}.html`;
    return {
      filename, path: filename,
      plainTitle, richTitle,
      section: page.findSelectProperty('Section') ?? null,
      publishedAt: page.findDateProperty('Publish date')?.start ?? null,
      status: page.findSelectProperty('Status')?.name as any,
      innerHtml: body,
      // raw: blobs,
    };
  }

  const {body, plainTitle, richTitle} = await emitPageHtml(page);
  const filename = `${page.findRichTextProperty('URL Slug')?.asPlainText || page.id}.html`;
  return {
    filename, path: filename,
    plainTitle, richTitle,
    section: page.findSelectProperty('Section') ?? null,
    publishedAt: page.findDateProperty('Publish date')?.start ?? null,
    status: page.findSelectProperty('Status')?.name as any,
    innerHtml: body,
    // raw: blobs,
  };
}
function comparePublishedAt(a: ContentNode, b: ContentNode) {
  if (!a.publishedAt) return 1;
  if (!b.publishedAt) return -1;
  return b.publishedAt.valueOf() - a.publishedAt.valueOf();
}

class BlogSite {
  photos = new Array<InstagramPhoto>();
  posts = new Array<ContentNode>();
  pages = new Array<ContentNode>();
  assets = new Array<SiteFile>();
  prefs = new Map<string, string>();
  templates = new Map<string, string>();

  // files = new Array<SiteFile>();
  siteTitle: string = 'TODO';
  siteSubtitle: string = 'TODO';

  async loadPosts(db: NotionDatabase) {
    log `Loading posts...`;
    this.posts.length = 0;
    for await (const post of db.queryAllPages()) {
      this.posts.push(await loadContentNode(post));
    }
    log `Loaded ${this.posts.length} posts`;
    this.posts.sort(comparePublishedAt);
  }

  async loadPages(db: NotionDatabase) {
    log `Loading pages...`;
    this.pages.length = 0;
    for await (const page of db.queryAllPages()) {
      this.pages.push(await loadContentNode(page));
    }
    log `Loaded ${this.pages.length} pages`;
    this.pages.sort(comparePublishedAt);
  }

  async loadPhotos(db: NotionDatabase) {
    log `Loading photos...`;
    for await (const photo of db.queryAllPages()) {
      console.log('photo:', photo.knownSnapshot?.properties);
      const originalUrl = photo.findUrlProperty('Original URL');
      if (!originalUrl) continue;
      let cachedData = photo.findRichTextProperty('Cached data')?.asPlainText;
      if (!cachedData) {
        cachedData = JSON.stringify(await fetchPhoto(originalUrl));
        await photo.update({ properties: {
          "Cached data": { type: 'rich_text', rich_text: [{
            type: 'text',
            text: { content: cachedData },
          }] },
        } });
      }
      this.photos.push({
        originalUrl,
        ...(JSON.parse(cachedData) as {
          caption: string;
          takenAt: Date;
          alternative: string;
          fullResUrl: string;
          thumbnailUrl: string;
        }),
        slug: photo.snapshot.url.split('/').slice(3).join('/'),
      });
    }
    log `Loaded ${this.photos.length} photos`;
  }
  async rehostPhotos() {
    for (const photo of this.photos) {
      const photoPath = `/assets/photos/${photo.slug}.jpg`;
      const rehostFrom = new URL(photoPath, 'https://danopia.net');
      const fullData =
        await fetch(rehostFrom).then(x => x.status == 200 ? x.arrayBuffer() : null) ??
        await fetch(photo.fullResUrl).then(x => x.status == 200 ? x.arrayBuffer() : Promise.reject(`photo rehost: ${x.status}`));
      this.assets.push({
        path: photoPath,
        body: new Uint8Array(fullData!),
      });
      photo.fullResUrl = `assets/photos/${photo.slug}.jpg`;
    }
  }

  async loadAssets(db: NotionDatabase) {
    log `Loading assets...`;
    for await (const asset of db.queryAllPages()) {
      let codeBlock: (NotionBlock['snapshot'] & {type: 'code'})['code'] | null = null;
      for await (const block of asset.listAllChildren()) {
        if (block.snapshot.type === 'code') {
          codeBlock = block.snapshot.code;
        }
      }
      if (codeBlock) {
        const rawText = new NotionRichText(codeBlock.rich_text).asPlainText;
        this.assets.push({
          path: asset.title.asPlainText,
          body: new TextEncoder().encode(rawText),
        });
      } else {
        console.warn("Asset", asset.url, "didn't have a code block!");
      }
    }
  }

  async loadTemplates(db: NotionDatabase) {
    log `Loading templates...`;
    for await (const template of db.queryAllPages()) {
      let codeBlock: (NotionBlock['snapshot'] & {type: 'code'})['code'] | null = null;
      for await (const block of template.listAllChildren()) {
        if (block.snapshot.type === 'code') {
          codeBlock = block.snapshot.code;
        }
      }
      if (codeBlock) {
        const rawText = new NotionRichText(codeBlock.rich_text).asPlainText;
        this.templates.set(template.title.asPlainText, rawText);
      } else {
        console.warn("Template", template.url, "didn't have a code block!");
      }
    }
  }

  async runNow(root: NotionPage) {
    const startTime = Date.now();

    log `Loading blog configuration...`;

    for await (const b of root.listAllChildren())  {
      if (b.snapshot?.type == 'child_database') {
        const timerGroup = `${new Date().toLocaleTimeString().replace(/./g, ' ')}   Load ${b.snapshot.child_database.title}`;
        console.time(timerGroup);
        switch (b.snapshot.child_database.title) {
          case 'Blog Posts': {
            await this.loadPosts(b.asDatabase);
          }; break;
          case 'Extra Pages': {
            await this.loadPages(b.asDatabase);
          }; break;
          case 'Featured Photos': {
            await this.loadPhotos(b.asDatabase);
            await this.rehostPhotos();
          }; break;
          case 'Site Assets': {
            await this.loadAssets(b.asDatabase);
          }; break;
          case 'Site Templates': {
            await this.loadTemplates(b.asDatabase);
          }; break;
          default: {
            log `TODO ${b.id} ${b.snapshot.child_database.title}`;
          }; break;
        }
        console.timeEnd(timerGroup);
      } else if (b.snapshot?.type == 'heading_2') {
      } else if (b.snapshot?.type == 'bulleted_list_item') {
        const {rich_text} = b.snapshot.bulleted_list_item;
        if (rich_text.length == 2) {
          const key = rich_text[0].plain_text.replace(/: *$/, '');
          const val = rich_text[1].plain_text;
          this.prefs.set(key, val);
        } else {
          log `TODO ${b.snapshot.bulleted_list_item}`;
        }
      } else {
        log `TODO ${b}`;
      }
    }

    this.siteTitle = this.prefs.get('site title') || 'New Blog';
    this.siteSubtitle = this.prefs.get('site subtitle') || 'Content goes here';
    // const sections = readMap((config.find(x => x.Name === 'sections') as FolderEntry).Children, readStructure);
    // console.log(siteTitle, siteSubtitle, sections);

    // load all the asset & layout files into a Map
    // const assetsRaw = await getChildrenOf(this.data.subPath`/assets`, 2);
    // const assets = readMap(assetsRaw, x => x.find(y => y.Name === 'data') as BlobEntry);

    // async function loadContentNodes(path: ApiHandle): Promise<ContentNode[]> {
    //   const nodesRaw = await getChildrenOf(path, 3);
    //   // console.log(nodesRaw);
    //   return nodesRaw.map(raw => {
    //     if (raw.Type !== 'Folder') throw new Error(`BUG`);
    //     const data = readStructure(raw.Children);
    //     const blobs = raw.Children.flatMap(x => x.Type === 'Blob' ? [x] : []);
    //     return {
    //       path: `${raw.Name}.html`,
    //       title: data.title || raw.Name,
    //       section: sections.get(data.section),
    //       publishedAt: data.publishedAt ? new Date(data.publishedAt) : null,
    //       innerHtml: renderInnerHtml(blobs),
    //       raw: blobs,
    //     };
    //   }).sort((a, b) => {
    //     if (!a.publishedAt) return 1;
    //     if (!b.publishedAt) return -1;
    //     return b.publishedAt.valueOf() - a.publishedAt.valueOf();
    //   });
    // }
    // const pages = await loadContentNodes(this.data.subPath`/pages`);
    // const posts = await loadContentNodes(this.data.subPath`/posts`);
    // // console.log(pages, posts);

    // const photosPath = this.data.subPath`/photos`;
    // const photos = (await getChildrenOf(photosPath, 3)).map(raw => {
    //   if (raw.Type !== 'Folder') throw new Error(`BUG`);
    //   return {_id: raw.Name, ...readStructure(raw.Children)};
    // });

    const outdatedCutoff = new Date().getUTCFullYear() - 5;
    const months = [
      'January', 'Febuary', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    // const dateFormat = new Intl.DateTimeFormat('en-US', {dateStyle: "long"});
    this.posts.forEach(p => {
      p.path = `posts/drafts/${p.filename}`;
      if (p.publishedAt) {
        const publishedYear = p.publishedAt.getUTCFullYear();
        p.publishDate = `${months[p.publishedAt.getUTCMonth()]} ${p.publishedAt.getUTCDate()}, ${publishedYear}`;
        // publishedAt.format('LL [at] LT');
        p.isOutdated = publishedYear < outdatedCutoff;
        if (p.status == 'Published' || p.status == 'Archived') {
          p.path = `posts/${publishedYear}/${p.filename}`;
        }
      }
    });
    // posts.sort(function (a, b) {
    //   return (b.publishedAt||'').localeCompare(a.publishedAt||'');
    // });
    const publishedPosts = this.posts.filter(x => x.publishedAt
      && (x.status == 'Published' || x.status == 'Archived'));
    log `Found ${publishedPosts.length} published posts`;

    log `Generating blog files...`;

    function reversePath(path: string) {
      if (path.includes('/')) {
        return path.split('/').slice(1).map(x => '..').join('/');
      } else {
        return '.';
      }
    }

    const htmlFiles = new Array<SiteFile>();
    htmlFiles.push({
      path: '/health',
      body: new TextEncoder().encode('ok'),
    });

    const renderContentNodes = (list: ContentNode[], layout: string) => {
      list.forEach(content => {
        const contentPath = content.path || content.filename;
        content.baseHref = reversePath(contentPath);
        htmlFiles.push({
          path: `/${contentPath}`,
          body: this.renderPage(content, layout),
        });
      });
    }
    renderContentNodes(this.pages, 'Page');
    renderContentNodes(this.posts, 'Post');

    const oneYear = 365 * 24 * 60 * 60 * 1000;
    const recentPostCutoff = Date.now() - (2 * oneYear);
    htmlFiles.push({
      path: '/index.html',
      body: this.renderPage({
        pages: this.pages,
        photos: this.photos,
        recentPosts: publishedPosts
          .slice(0, 5)
          .filter(x => x.publishedAt && x.publishedAt.valueOf() > recentPostCutoff),
      }, 'Home'),
    });

    const newestYear = publishedPosts[0]?.publishedAt?.getUTCFullYear() ?? new Date().getFullYear();
    const oldestYear = publishedPosts.slice(-1)[0]?.publishedAt?.getUTCFullYear() ?? 2020;
    const postTimes = [];
    for (let year = newestYear; year >= oldestYear; year--) {
      for (let month = 11; month >= 0; month--) {
        const posts = publishedPosts.filter(x =>
          x.publishedAt?.getUTCFullYear() === year &&
          x.publishedAt?.getUTCMonth() === month);
        if (posts.length === 0) continue;

        const timeStr = `${months[month]} ${year}`;
        postTimes.push({ year, month, timeStr, posts });
      }
    }

    htmlFiles.push({
      path: '/posts/archive.html',
      body: this.renderPage({
        baseHref: '..',
        postTimes,
      }, 'Archive'),
    });

    for (const asset of this.assets) {
      // if (path.startsWith('/_layouts/')) continue;
      htmlFiles.push(asset);
    }

    // console.log(htmlFiles);
    log `Uploading ${htmlFiles.length} files to web hosting...`;

    await publishFirebaseSite('blog-bbudj4be', Deno.env.get('GOOGLE_APPLICATION_CREDENTIALS')!, htmlFiles);

    const endTime = Date.now();
    const elapsedSecs = Math.round((endTime - startTime) / 1000);
    log `Blog published in ${elapsedSecs} seconds :)`;

  }

  // helper to pass a data object though one layout, then the site layout
  // special page? don't pass a layout, pass html as data.innerHtml instead
  renderPage(data: {innerHtml?: string; baseHref?: string} | Record<string,unknown>, layoutName: string) {
    var {innerHtml, baseHref} = data;
    const layoutText = this.templates.get(layoutName);
    if (layoutText) {
      innerHtml = renderMustache(layoutText, data);
    }
    if (!innerHtml) throw new Error("No innerHtml for content");

    const defaultText = this.templates.get('Wrapper');
    if (!defaultText) throw new Error(
      `Layout 'default' not found`);

    const pageBody = renderMustache(defaultText, {
      siteTitle: this.siteTitle,
      siteSubtitle: this.siteSubtitle,
      pages: this.pages.filter(x => x.status === 'Published'),
      posts: this.posts,
      photos: this.photos,
      innerHtml, baseHref,
    });//.replace(/&#x2F;/g, '/')
      //.replace(/&#x3D;/g, '=');
    return new TextEncoder().encode(pageBody);
  }

}

interface ContentNode {
  filename: string;
  path?: string;
  // title: string;
  plainTitle: string;
  richTitle: string;
  section: Record<string, string> | null;
  publishedAt: Date | null;
  status: 'Idea' | 'Draft' | 'Published' | 'Archived' | 'Hidden' | 'Ignored';
  innerHtml: string;
  // raw: string;

  publishDate?: string;
  isOutdated?: boolean;
  baseHref?: string;
}

export interface InstagramPhoto {
  caption: string;
  takenAt: Date;
  alternative: string;
  originalUrl: string;
  fullResUrl: string;
  thumbnailUrl: string;
  slug: string;
}

if (import.meta.main) {
  const notion = NotionConnection.fromEnv();
  const db = await notion.pageById('70bb63f638a6401496dd9a0c54a60369');
  if (!db) throw new Error(`No 'Posts' database found`);

  const site = new BlogSite();
  await site.runNow(db);
}
