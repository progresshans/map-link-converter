const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_MAX_DISTANCE_METERS = 300;
const MAX_ENTRIES = 100;

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request }) {
  try {
    const body = await request.json();
    const direction = normalizeSpace(body.direction);
    const maxDistanceMeters =
      toNumber(body.maxDistanceMeters) ?? DEFAULT_MAX_DISTANCE_METERS;

    if (
      direction !== "naver_to_kakao" &&
      direction !== "kakao_to_naver"
    ) {
      return json({ error: "direction 값이 올바르지 않습니다." }, 400);
    }

    if (!Array.isArray(body.entries)) {
      return json({ error: "entries는 배열이어야 합니다." }, 400);
    }

    const entries = body.entries.slice(0, MAX_ENTRIES).map((entry, idx) =>
      sanitizeEntry(entry, idx + 1)
    );

    const results = [];
    for (const entry of entries) {
      try {
        const row =
          direction === "naver_to_kakao"
            ? await convertNaverToKakao(entry, maxDistanceMeters)
            : await convertKakaoToNaver(entry, maxDistanceMeters);
        results.push(row);
      } catch (err) {
        results.push({
          ok: false,
          source: entry,
          error: toErrorMessage(err),
        });
      }
    }

    return json({
      ok: true,
      direction,
      maxDistanceMeters,
      results,
    });
  } catch (err) {
    return json({ error: toErrorMessage(err) }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function sanitizeEntry(entry, fallbackIndex) {
  return {
    index: toNumber(entry?.index) ?? fallbackIndex,
    name: normalizeSpace(entry?.name),
    address: normalizeSpace(entry?.address),
    sourceUrl: normalizeSpace(entry?.sourceUrl),
    rawBlock: typeof entry?.rawBlock === "string" ? entry.rawBlock : "",
  };
}

async function convertNaverToKakao(source, maxDistanceMeters) {
  const sourceInfo = await buildNaverSourceInfo(source);

  const queryList = [
    [sourceInfo.name, stripAddressDetail(sourceInfo.address)]
      .filter(Boolean)
      .join(" ")
      .trim(),
    sourceInfo.name,
    stripAddressDetail(sourceInfo.address),
  ].filter(Boolean);

  let kakaoCandidates = [];
  for (const query of queryList) {
    kakaoCandidates = await searchKakaoCandidates(query);
    if (kakaoCandidates.length > 0) break;
  }

  if (kakaoCandidates.length === 0) {
    throw new Error("카카오 검색 결과가 없습니다.");
  }

  const picked = pickBestKakaoCandidate(kakaoCandidates, sourceInfo);
  if (!picked) {
    throw new Error("카카오 후보를 고르지 못했습니다.");
  }

  const distanceMeters = calcDistanceMeters(
    sourceInfo.lat,
    sourceInfo.lng,
    picked.lat,
    picked.lng
  );

  return {
    ok: true,
    source,
    targetUrl: `https://place.map.kakao.com/${picked.confirmid}`,
    targetName: picked.name,
    targetAddress: picked.address,
    sourceLat: sourceInfo.lat,
    sourceLng: sourceInfo.lng,
    targetLat: picked.lat,
    targetLng: picked.lng,
    distanceMeters,
    distancePass:
      distanceMeters === null ? null : distanceMeters <= maxDistanceMeters,
  };
}

async function convertKakaoToNaver(source, maxDistanceMeters) {
  const sourceInfo = await buildKakaoSourceInfo(source);

  const queryList = [
    [sourceInfo.name, stripAddressDetail(sourceInfo.address)]
      .filter(Boolean)
      .join(" ")
      .trim(),
    sourceInfo.name,
    stripAddressDetail(sourceInfo.address),
  ].filter(Boolean);

  let naverCandidates = [];
  for (const query of queryList) {
    naverCandidates = await searchNaverCandidates(query);
    if (naverCandidates.length > 0) break;
  }

  if (naverCandidates.length === 0) {
    throw new Error("네이버 검색 결과가 없습니다.");
  }

  const picked = pickBestNaverCandidate(naverCandidates, sourceInfo);
  if (!picked) {
    throw new Error("네이버 후보를 고르지 못했습니다.");
  }

  const distanceMeters = calcDistanceMeters(
    sourceInfo.lat,
    sourceInfo.lng,
    picked.lat,
    picked.lng
  );

  return {
    ok: true,
    source,
    targetUrl: `https://map.naver.com/p/entry/place/${picked.placeId}`,
    targetName: picked.name,
    targetAddress: picked.address,
    sourceLat: sourceInfo.lat,
    sourceLng: sourceInfo.lng,
    targetLat: picked.lat,
    targetLng: picked.lng,
    distanceMeters,
    distancePass:
      distanceMeters === null ? null : distanceMeters <= maxDistanceMeters,
  };
}

async function buildNaverSourceInfo(source) {
  const info = {
    name: source.name,
    address: source.address,
    placeId: extractNaverPlaceIdFromUrl(source.sourceUrl),
    lat: null,
    lng: null,
  };

  if (source.sourceUrl) {
    applyNaverUrlMeta(source.sourceUrl, info);

    if (/naver\.me\//i.test(source.sourceUrl)) {
      const chain = await resolveRedirectChain(source.sourceUrl, 6, {
        referer: "https://map.naver.com/",
      });
      for (const url of chain) {
        applyNaverUrlMeta(url, info);
      }
    }
  }

  if (!info.name || !info.address || info.lat === null || info.lng === null) {
    const query = [info.name, stripAddressDetail(info.address)]
      .filter(Boolean)
      .join(" ")
      .trim();

    if (query) {
      const naverCandidates = await searchNaverCandidates(query);
      const picked = pickBestNaverCandidate(naverCandidates, info);
      if (picked) {
        if (!info.name) info.name = picked.name;
        if (!info.address) info.address = picked.address;
        if (!info.placeId) info.placeId = picked.placeId;
        if (info.lat === null) info.lat = picked.lat;
        if (info.lng === null) info.lng = picked.lng;
      }
    }
  }

  if (!info.name && !info.address && !info.placeId) {
    throw new Error("네이버 입력에서 상호/주소/URL 정보를 찾지 못했습니다.");
  }

  return info;
}

async function buildKakaoSourceInfo(source) {
  const info = {
    name: source.name,
    address: source.address,
    placeId: extractKakaoPlaceIdFromUrl(source.sourceUrl),
    lat: null,
    lng: null,
  };

  if (info.placeId) {
    const detail = await fetchKakaoPlaceInfo(info.placeId);
    if (detail) {
      if (!info.name) info.name = detail.name;
      if (!info.address) info.address = detail.address;
      if (info.lat === null) info.lat = detail.lat;
      if (info.lng === null) info.lng = detail.lng;
    }
  }

  if (!info.placeId || !info.name || info.lat === null || info.lng === null) {
    const query = [source.name, stripAddressDetail(source.address)]
      .filter(Boolean)
      .join(" ")
      .trim();

    if (query) {
      const kakaoCandidates = await searchKakaoCandidates(query);
      const picked = pickBestKakaoCandidate(kakaoCandidates, info);
      if (picked) {
        if (!info.placeId) info.placeId = picked.confirmid;
        if (!info.name) info.name = picked.name;
        if (!info.address) info.address = picked.address;
        if (info.lat === null) info.lat = picked.lat;
        if (info.lng === null) info.lng = picked.lng;
      }
    }
  }

  if (!info.name && !info.address && !info.placeId) {
    throw new Error("카카오 입력에서 상호/주소/URL 정보를 찾지 못했습니다.");
  }

  return info;
}

async function resolveRedirectChain(startUrl, maxHops, extraHeaders = {}) {
  const chain = [];
  let current = startUrl;

  for (let hop = 0; hop < maxHops; hop += 1) {
    chain.push(current);

    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        "user-agent": USER_AGENT,
        ...(extraHeaders.referer ? { referer: extraHeaders.referer } : {}),
      },
    });

    if (response.status < 300 || response.status >= 400) {
      break;
    }

    const location = response.headers.get("location");
    if (!location) break;

    current = new URL(location, current).toString();
  }

  return chain;
}

function applyNaverUrlMeta(url, info) {
  const parsed = tryParseUrl(url);
  if (!parsed) return;

  const title = normalizeSpace(parsed.searchParams.get("title"));
  if (title && !info.name) {
    info.name = title;
  }

  const lat = toNumber(parsed.searchParams.get("lat"));
  const lng = toNumber(parsed.searchParams.get("lng"));
  if (lat !== null && lng !== null) {
    info.lat = lat;
    info.lng = lng;
  }

  const pinId = parsed.searchParams.get("pinId");
  if (pinId && /^\d+$/.test(pinId) && !info.placeId) {
    info.placeId = pinId;
  }

  const urlPlaceId = extractNaverPlaceIdFromUrl(url);
  if (urlPlaceId && !info.placeId) {
    info.placeId = urlPlaceId;
  }
}

async function searchKakaoCandidates(query) {
  const url =
    "https://search.map.kakao.com/mapsearch/map.daum?output=json&q=" +
    encodeURIComponent(query);

  const response = await fetch(url, {
    headers: {
      referer: "https://map.kakao.com/",
      "user-agent": USER_AGENT,
      accept: "application/json,text/plain,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`카카오 검색 요청 실패 (${response.status})`);
  }

  const text = await response.text();
  if (!text.trim()) return [];

  let data;
  try {
    data = JSON.parse(text);
  } catch (_err) {
    throw new Error("카카오 검색 응답 파싱 실패");
  }

  const places = Array.isArray(data.place) ? data.place : [];

  return places
    .map((place) => ({
      confirmid: String(place.confirmid || ""),
      name: normalizeSpace(place.name),
      address: normalizeSpace(place.new_address || place.address || ""),
      lat: toNumber(place.lat),
      lng: toNumber(place.lon),
    }))
    .filter((place) => place.confirmid);
}

async function fetchKakaoPlaceInfo(placeId) {
  const url =
    "https://map.kakao.com/api/place/info?output=json&confirmId=" +
    encodeURIComponent(placeId);

  const response = await fetch(url, {
    headers: {
      referer: "https://map.kakao.com/",
      "user-agent": USER_AGENT,
      accept: "application/json,text/plain,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`카카오 상세 요청 실패 (${response.status})`);
  }

  const text = await response.text();
  if (!text.trim()) return null;

  let data;
  try {
    data = JSON.parse(text);
  } catch (_err) {
    return null;
  }

  const place = data?.place;
  if (!place) return null;

  return {
    placeId: String(place.confirmid || placeId),
    name: normalizeSpace(place.placename || place.placenamefull || ""),
    address: normalizeSpace(
      [place?.region?.fullname, place?.newaddr?.newaddrfull, place?.addrdetail]
        .filter(Boolean)
        .join(" ")
    ),
    lat: toNumber(place.wgs84y),
    lng: toNumber(place.wgs84x),
  };
}

async function searchNaverCandidates(query) {
  const url =
    "https://m.map.naver.com/search2/search.naver?query=" +
    encodeURIComponent(query);

  const response = await fetch(url, {
    headers: {
      referer: "https://map.naver.com/",
      "user-agent": USER_AGENT,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`네이버 검색 요청 실패 (${response.status})`);
  }

  const html = await response.text();
  return parseNaverCandidatesFromHtml(html);
}

function parseNaverCandidatesFromHtml(html) {
  const out = [];
  const seen = new Set();

  const richRegex =
    /"id":(\d+),"name":"([^"]+)","category":"[^"]*","address":"([^"]*)","roadAddress":"([^"]*)"[\s\S]*?"latitude":([0-9.\-]+),"longitude":([0-9.\-]+)/g;

  let match;
  while ((match = richRegex.exec(html)) !== null) {
    const placeId = match[1];
    if (seen.has(placeId)) continue;
    seen.add(placeId);

    out.push({
      placeId,
      name: unescapeJsonText(match[2]),
      address: normalizeSpace(unescapeJsonText(match[4] || match[3] || "")),
      lat: toNumber(match[5]),
      lng: toNumber(match[6]),
    });
  }

  if (out.length === 0) {
    const fallbackRegex = /https:\/\/m\.place\.naver\.com\/place\/(\d+)\/home/g;
    let linkMatch;
    while ((linkMatch = fallbackRegex.exec(html)) !== null) {
      const placeId = linkMatch[1];
      if (seen.has(placeId)) continue;
      seen.add(placeId);
      out.push({ placeId, name: "", address: "", lat: null, lng: null });
    }
  }

  return out;
}

function pickBestKakaoCandidate(candidates, sourceInfo) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const sourceNameNorm = normalizeCompareText(sourceInfo.name);
  const sourceAddrNorm = normalizeCompareText(stripAddressDetail(sourceInfo.address));

  let best = null;

  for (const candidate of candidates) {
    const candNameNorm = normalizeCompareText(candidate.name);
    const candAddrNorm = normalizeCompareText(stripAddressDetail(candidate.address));

    const nameScore = similarityScore(sourceNameNorm, candNameNorm);
    const addrScore = similarityScore(sourceAddrNorm, candAddrNorm);

    const distanceMeters = calcDistanceMeters(
      sourceInfo.lat,
      sourceInfo.lng,
      candidate.lat,
      candidate.lng
    );

    const distanceScore =
      distanceMeters === null
        ? 0
        : Math.max(0, 1 - Math.min(distanceMeters, 3000) / 3000);

    const score = nameScore * 0.62 + addrScore * 0.23 + distanceScore * 0.15;

    if (
      !best ||
      score > best.score ||
      (Math.abs(score - best.score) < 0.0001 &&
        compareDistance(distanceMeters, best.distanceMeters) < 0)
    ) {
      best = {
        ...candidate,
        score,
        distanceMeters,
      };
    }
  }

  return best;
}

function pickBestNaverCandidate(candidates, sourceInfo) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const sourceNameNorm = normalizeCompareText(sourceInfo.name);
  const sourceAddrNorm = normalizeCompareText(stripAddressDetail(sourceInfo.address));

  let best = null;

  for (const candidate of candidates) {
    const candNameNorm = normalizeCompareText(candidate.name);
    const candAddrNorm = normalizeCompareText(stripAddressDetail(candidate.address));

    const nameScore = similarityScore(sourceNameNorm, candNameNorm);
    const addrScore = similarityScore(sourceAddrNorm, candAddrNorm);

    const distanceMeters = calcDistanceMeters(
      sourceInfo.lat,
      sourceInfo.lng,
      candidate.lat,
      candidate.lng
    );

    const distanceScore =
      distanceMeters === null
        ? 0
        : Math.max(0, 1 - Math.min(distanceMeters, 3000) / 3000);

    const score = nameScore * 0.62 + addrScore * 0.23 + distanceScore * 0.15;

    if (
      !best ||
      score > best.score ||
      (Math.abs(score - best.score) < 0.0001 &&
        compareDistance(distanceMeters, best.distanceMeters) < 0)
    ) {
      best = {
        ...candidate,
        score,
        distanceMeters,
      };
    }
  }

  return best;
}

function compareDistance(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function similarityScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.86;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;

  let same = 0;
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i += 1) {
    if (a[i] === b[i]) same += 1;
  }

  const prefixScore = same / maxLen;

  const setA = new Set(a.split(""));
  const setB = new Set(b.split(""));
  let inter = 0;
  for (const ch of setA) {
    if (setB.has(ch)) inter += 1;
  }
  const jaccard = inter / Math.max(setA.size + setB.size - inter, 1);

  return Math.max(prefixScore * 0.55 + jaccard * 0.45, 0.05);
}

function calcDistanceMeters(lat1, lng1, lat2, lng2) {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2)
  ) {
    return null;
  }

  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function extractKakaoPlaceIdFromUrl(url) {
  if (!url) return "";

  const direct = String(url).match(/place\.map\.kakao\.com\/(\d+)/i);
  if (direct) return direct[1];

  const parsed = tryParseUrl(url);
  if (!parsed) return "";

  const itemId = parsed.searchParams.get("itemId");
  return itemId && /^\d+$/.test(itemId) ? itemId : "";
}

function extractNaverPlaceIdFromUrl(url) {
  if (!url) return "";

  const entry = String(url).match(/\/entry\/place\/(\d+)/i);
  if (entry) return entry[1];

  const mobile = String(url).match(/m\.place\.naver\.com\/place\/(\d+)/i);
  if (mobile) return mobile[1];

  const parsed = tryParseUrl(url);
  if (!parsed) return "";

  const pinId = parsed.searchParams.get("pinId");
  return pinId && /^\d+$/.test(pinId) ? pinId : "";
}

function stripAddressDetail(address) {
  let out = normalizeSpace(address);
  out = out.replace(/\s+\d+\s*[~\-]\s*\d+\s*층\b/g, "");
  out = out.replace(/\s+\d+\s*층\b/g, "");
  out = out.replace(/\s+\d+\s*호\b/g, "");
  return normalizeSpace(out);
}

function normalizeCompareText(value) {
  return normalizeSpace(value)
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "");
}

function normalizeSpace(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toErrorMessage(err) {
  if (err instanceof Error && err.message) return err.message;
  return String(err || "알 수 없는 오류");
}

function tryParseUrl(value) {
  try {
    return new URL(value);
  } catch (_err) {
    return null;
  }
}

function unescapeJsonText(text) {
  if (!text) return "";
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .trim();
}
