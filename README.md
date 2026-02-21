# Map Link Converter (Pages + Worker)

네이버/카카오 지도 텍스트 블록을 서로 변환하는 Cloudflare Pages + Functions(Worker Runtime) 프로젝트입니다.

## 기능

- `네이버 -> 카카오` 변환
  - `naver.me` 단축 URL 해석
  - 카카오 장소 링크(`https://place.map.kakao.com/{id}`) 반환
- `카카오 -> 네이버` 변환
  - 카카오 장소 링크에서 정보 조회
  - 네이버 장소 링크(`https://map.naver.com/p/entry/place/{id}`) 반환
- 자동 감지 모드
  - 입력 URL 기준으로 각 항목을 자동으로 방향 판별
  - 네이버/카카오 링크가 섞여 있어도 한 번에 변환 가능
- URL만 입력해도 변환
  - 상호/주소 없이 URL만 붙여넣어도 자동으로 변환
- 거리 검증
  - 가능한 경우 좌표를 비교해 거리(m)와 기준 통과 여부 표시

## 입력 형식

네이버지도/카카오맵 앱에서 공유한 텍스트를 그대로 붙여넣으면 됩니다.

```
[네이버지도]
상호명
서울 성북구 개운사길 41-3 1~3층
https://naver.me/IGs3UqxD

[네이버지도]
상호명
서울 성북구 개운사길 21-3 1층
https://naver.me/x7e0US2z
```

URL만 입력하는 것도 가능합니다.

```
https://naver.me/IGs3UqxD
https://naver.me/x7e0US2z
```

한 번에 최대 100건까지 변환할 수 있습니다.

## 폴더 구조

- `public/index.html`: UI
- `functions/api/convert.js`: 변환 API (Pages Function)
- `wrangler.toml`: Pages 설정

## 로컬 실행

```bash
cd map-link-converter-cloudflare
npx wrangler pages dev public
```

실행 후 브라우저에서 로컬 URL을 열면 `public/index.html`과 `/api/convert`가 함께 동작합니다.

## 배포

### 권장: Pages Git 연동

Cloudflare Pages 대시보드에서 GitHub 저장소를 연결하고 아래처럼 설정하세요.

- Framework preset: `None`
- Build command: 비움
- Build output directory: `public`
- Root directory: `/`

### 선택: Wrangler Direct Upload

1. Pages 프로젝트 생성(최초 1회)

```bash
npx wrangler pages project create map-link-converter-cloudflare
```

2. 배포

```bash
cd map-link-converter-cloudflare
npx wrangler pages deploy public --project-name map-link-converter-cloudflare
```

## 참고

- Free 플랜은 Worker 요청량 제한이 있습니다(일일 요청 수 제한).
- 네이버/카카오 측 응답 정책 변경 시 파싱 로직 업데이트가 필요할 수 있습니다.
- 소스 코드: https://github.com/progresshans/map-link-converter-cloudflare
