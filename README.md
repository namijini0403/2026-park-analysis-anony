# 비식별 제출용 앱

인천 초등학교 500m 생활권 야외활동 환경 격차 분석을 제출용으로 비식별화한 독립 앱입니다.

이 저장소는 원본 저장소의 fork가 아니어야 하며, 기존 저장소 이력을 가져오지 않습니다. 원본 학교명, 학교ID, 실제 위도/경도, 주소, 공원명, 아파트 단지명, 재개발 구역명, 원본 GeoJSON/CSV/XLSX는 공개 저장소에 포함하지 않습니다.

## 포함되는 데이터

- `public/data/*.json`: 앱이 읽는 비식별 산출물
- 학교 표기: `학교 S-XXXXXXXX`
- 유지 항목: 구 단위, 거리, 개수, 비율, case, 수요 예측값
- 후보지/시설 표기: `후보지 A`, `공원 A`, `단지 A`, `구역 A`
- 지도: 실제 지도 API가 아닌 학교 중심 상대거리 도식지도

## 로컬 데이터 생성

원본 데이터와 실명 매핑은 이 저장소 밖의 로컬 작업공간에만 둡니다.

```bash
npm run build:data
npm run check:safety
```

기본 입력 경로:

- `../incheon_school_anon_codes.xlsx`
- `../2026-park-analysis/data_processed/`

필요하면 환경변수로 바꿀 수 있습니다.

```bash
$env:SOURCE_WORKSPACE="C:\Users\Mijin\Desktop\공공데이터공모전"
npm run build:data
```

## 실행

```bash
npm install
npm run build:data
npm run check:safety
npm run dev
```

## 커밋 전 확인

```bash
git status --short
git ls-files | findstr /i "xlsx csv geojson data_processed"
npm run check:safety
```

위 명령에서 원본 데이터 파일이 보이면 커밋하지 않습니다.
