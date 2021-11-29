import * as Base64 from 'https://deno.land/std@0.95.0/encoding/base64.ts';
import * as XmlEntities from 'https://deno.land/x/html_entities@v1.0/lib/xml-entities.js';

export async function fetchPhoto(instagramUrl: string) {
  console.log(`Fetching`, instagramUrl);
  const htmlBody = await fetch(instagramUrl).then(res => res.text());
  await new Promise(ok => setTimeout(ok, 5000));

  const hotlinkMatch = htmlBody.match(/<meta property="og:image" content="([^"]+)" \/>/);
  const linkingDataMatch = htmlBody.match(/<script type="application\/ld\+json">\n +({.+})\n +<\/script>/);
  const jsonMatch = htmlBody.match(/window\._sharedData = ([^\n]+);/);
  if (!hotlinkMatch || !linkingDataMatch || !jsonMatch) throw new Error(`TODO: regex failed`);

  const pageData = JSON.parse(jsonMatch[1]);
  const mediaData = pageData.entry_data.PostPage[0].graphql.shortcode_media;
  // console.log(JSON.stringify(mediaData, null, 2));

  const linkingData = JSON.parse(linkingDataMatch[1]);

  const commentCount = linkingData.commentCount || 0;
  const likeCount = linkingData.interactionStatistic.userInteractionCount || 0;
  const addlTexts = [ `${likeCount} like${likeCount!==1?'s':''}` ];

  const caption = XmlEntities.decode(linkingData.caption) as string;
  const takenAt = new Date(linkingData.uploadDate + 'Z');
  const takenMonth = takenAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  let altText = `Photo posted on ${takenMonth}`;

  const thumbnailUrl = preview_to_jpeg_url(mediaData.media_preview);

  if (commentCount > 0) {
    const commentText = `${commentCount} comment${commentCount!==1?'s':''}`;
    addlTexts.push(commentText);
    altText = `${altText}, plus ${commentText}`;
  }

  const fullCaption = [
    caption, '', `Posted ${takenMonth}`, addlTexts.join(', ')
  ].join('\n');

  return {
    caption: fullCaption,
    takenAt,
    alternative: altText,
    fullResUrl: hotlinkMatch[1],
    thumbnailUrl,
  };
}

// based on https://stackoverflow.com/questions/49625771/how-to-recreate-the-preview-from-instagrams-media-preview-raw-data/49791447#49791447
const jpegtpl = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsaGikdKUEmJkFCLy8vQkc/Pj4/R0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0cBHSkpNCY0PygoP0c/NT9HR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR//AABEIABQAKgMBIgACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AA==";
function preview_to_jpeg_url(inputString: string) {
	const dynamic = Base64.decode(inputString);
	const payload = dynamic.subarray(3);
	const template = Base64.decode(jpegtpl);
	template[162] = dynamic[1];
  template[160] = dynamic[2];
  var final = new Uint8Array(template.length + payload.length);
  final.set(template);
  final.set(payload, template.length);
  return 'data:image/jpg;base64,'+Base64.encode(final);
};
