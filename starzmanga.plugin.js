// Harbor source for Manga Starz (starzmanga.com).
// Reads only public listing, series, chapter, and reader pages.

const BASE = "https://starzmanga.com";

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res || !res.ok || !res.body) {
    throw new Error("http " + (res && res.status) + " for " + path);
  }
  return harbor.parseHtml(res.body);
}

async function postDoc(path, body) {
  const url = BASE + path;
  const variants = [
    {
      method: "POST",
      body,
      responseType: "text",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
    },
    { method: "POST", body, responseType: "text" },
    { method: "POST", data: body, responseType: "text" },
  ];
  let lastError;
  for (const options of variants) {
    try {
      const res = await harbor.http(url, options);
      if (res && res.ok && res.body) return harbor.parseHtml(res.body);
      lastError = new Error("http " + (res && res.status) + " for " + path);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("POST failed for " + path);
}

function abs(url) {
  if (!url) return undefined;
  url = String(url).trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function mangaIdFromHref(href) {
  const match = String(href || "").match(/\/manga\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch (error) {
    return match[1];
  }
}

function chapterIdFromHref(href, mangaId) {
  const path = String(href || "").split(/[?#]/)[0];
  const match = path.match(/\/manga\/([^/]+)\/([^/]+)\/?$/i);
  if (!match) return null;
  let slug = match[1];
  let chapter = match[2];
  try {
    slug = decodeURIComponent(slug);
    chapter = decodeURIComponent(chapter);
  } catch (error) {
    /* Keep path segments as they appeared in the link. */
  }
  if (slug !== mangaId || /^(?:ajax|page|genre)$/i.test(chapter)) return null;
  return mangaId + "/" + chapter;
}

function coverFrom(node) {
  if (!node) return undefined;
  const img = node.attr && (node.attr("data-src") || node.attr("src"))
    ? node
    : node.querySelector("img");
  if (!img) return undefined;
  return abs(
    img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      img.attr("data-original") ||
      img.attr("src")
  );
}

function summariesFromDoc(doc) {
  const out = [];
  const seen = new Set();
  const add = (anchor, card) => {
    if (!anchor) return;
    const id = mangaIdFromHref(anchor.attr("href"));
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      title: cleanText(anchor.attr("title") || anchor.text()) || id,
      cover: coverFrom(card) || coverFrom(anchor),
    });
  };

  [".page-item-detail", ".c-tabs-item__content", ".manga-item", ".bs .bsx", ".bsx", "article"]
    .forEach((selector) => {
      doc.querySelectorAll(selector).forEach((card) => {
        card.querySelectorAll('a[href*="/manga/"]').forEach((anchor) => add(anchor, card));
      });
    });

  if (!out.length) {
    doc.querySelectorAll('a[href*="/manga/"]').forEach((anchor) => add(anchor, anchor));
  }
  return out;
}

function parseChapterRows(doc, mangaId) {
  const result = [];
  const seen = new Set();
  doc.querySelectorAll('a[href*="/manga/"]').forEach((anchor) => {
    const id = chapterIdFromHref(anchor.attr("href"), mangaId);
    if (!id || seen.has(id)) return;
    const raw = cleanText(anchor.text() || anchor.attr("title"));
    const lastPart = id.split("/").pop();
    const numberMatch = (raw + " " + lastPart).match(
      /(?:الفصل|chapter|ch\.?|episode|ep\.?|#)?\s*(\d+(?:\.\d+)?)/i
    );
    const dateNode = anchor.querySelector("time");
    seen.add(id);
    result.push({
      id,
      chapter: numberMatch ? numberMatch[1] : lastPart,
      title: raw || ("الفصل " + lastPart),
      volume: null,
      pages: 0,
      language: "ar",
      publishAt:
        (dateNode && (dateNode.attr("datetime") || dateNode.text())) || undefined,
    });
  });
  return result;
}

function sortChapters(chapters) {
  return chapters.sort((a, b) => {
    const an = parseFloat(a.chapter);
    const bn = parseFloat(b.chapter);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return bn - an;
    return String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
  });
}

function pageNumber(offset) {
  // StarzManga's public manga archive shows ten series per page.
  return Math.floor(offset / 10) + 1;
}

function latestPath(offset) {
  const page = pageNumber(offset);
  return page === 1
    ? "/manga/?m_orderby=latest"
    : "/manga/page/" + page + "/?m_orderby=latest";
}

function genrePath(tagId, offset) {
  const page = pageNumber(offset);
  const base = "/manga-genre/" + encodeURIComponent(tagId) + "/";
  return page === 1 ? base : base + "page/" + page + "/";
}

const plugin = {
  id: "starzmanga",
  name: "مانجا ستارز",
  version: "1.0.0",

  async popular(offset, tagId) {
    const doc = await getDoc(tagId ? genrePath(tagId, offset) : latestPath(offset));
    return summariesFromDoc(doc);
  },

  async search(query, offset) {
    const page = pageNumber(offset);
    const prefix = page === 1 ? "/" : "/page/" + page + "/";
    const doc = await getDoc(
      prefix + "?s=" + encodeURIComponent(query) + "&post_type=wp-manga"
    );
    return summariesFromDoc(doc);
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    const titleNode =
      doc.querySelector(".post-title h1") ||
      doc.querySelector("h1.entry-title") ||
      doc.querySelector("h1");
    const title = cleanText(titleNode && titleNode.text()) || id;
    const summaryRows = doc.querySelectorAll(
      ".post-content_item, .full-list-info, .manga-info, .summary-content, .manga-info li"
    );
    const field = (labels) => {
      let found;
      summaryRows.forEach((row) => {
        if (found) return;
        const heading = row.querySelector(".summary-heading, .label, strong, b");
        const content = row.querySelector(".summary-content, .summary-content a, .value");
        const labelText = cleanText(heading && heading.text()) || cleanText(row.text());
        if (!labels.some((label) => labelText.toLowerCase().includes(label.toLowerCase()))) return;
        const value = cleanText(content ? content.text() : row.text().replace(labelText, ""));
        if (value && value !== labelText) found = value;
      });
      return found;
    };
    const imageNode =
      doc.querySelector(".summary_image img") ||
      doc.querySelector(".manga-info-pic img") ||
      doc.querySelector(".summary_image") ||
      doc.querySelector("img.wp-post-image");
    const descriptionNode =
      doc.querySelector(".description-summary .summary__content") ||
      doc.querySelector(".description-summary") ||
      doc.querySelector(".manga-excerpt") ||
      doc.querySelector(".entry-content");
    return {
      id,
      title,
      cover: coverFrom(imageNode),
      description: cleanText(descriptionNode && descriptionNode.text()) || undefined,
      status: field(["الحالة", "status"]),
      author: field(["المؤلف", "الكاتب", "author"]),
    };
  },

  async chapters(id) {
    // Try the public Madara-compatible endpoint first; if unavailable, use
    // the chapter links rendered in the series page.
    try {
      const doc = await postDoc("/manga/" + encodeURIComponent(id) + "/ajax/chapters/", "");
      const chapters = parseChapterRows(doc, id);
      if (chapters.length) return sortChapters(chapters);
    } catch (error) {
      /* Fall back to the public series page. */
    }
    const doc = await getDoc("/manga/" + encodeURIComponent(id) + "/");
    return sortChapters(parseChapterRows(doc, id));
  },

  async pageUrls(chapterId) {
    const doc = await getDoc("/manga/" + chapterId + "/");
    let images = doc.querySelectorAll(
      ".reading-content img, .page-break img, .reader-area img, .chapter-content img"
    );
    if (!images.length) images = doc.querySelectorAll("img");
    return images
      .map((img) =>
        abs(
          img.attr("data-src") ||
            img.attr("data-lazy-src") ||
            img.attr("data-original") ||
            img.attr("src")
        )
      )
      .filter((url) => url && /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(url));
  },

  async tags() {
    const doc = await getDoc("/manga/");
    const tags = new Map();
    doc.querySelectorAll('a[href*="/manga-genre/"]').forEach((anchor) => {
      const href = anchor.attr("href") || "";
      const match = href.match(/\/manga-genre\/([^/?#]+)\/?(?:[?#].*)?$/i);
      const name = cleanText(anchor.text()).replace(/\s*\(\s*\d+\s*\)\s*$/, "");
      if (!match || !name) return;
      let id = match[1];
      try {
        id = decodeURIComponent(id);
      } catch (error) {
        /* Keep the original path segment. */
      }
      if (!tags.has(id)) tags.set(id, name);
    });
    return Array.from(tags, ([id, name]) => ({ id, name, group: "التصنيف" }));
  },
};

return plugin;
