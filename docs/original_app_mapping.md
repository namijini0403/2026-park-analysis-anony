# 기존 앱 구조 대응표

## 목적

기존 식별 가능 앱의 디자인과 기능 흐름을 비식별 제출 앱에서 최대한 유지하기 위한 대응표다. 이 문서는 원본 학교명, 원본 학교 ID, 실제 좌표, 실제 시설명을 포함하지 않는다.

## 화면 대응 요약

| 기존 앱 화면/기능 | 기존 역할 | 비식별 앱 대응 | 유지할 기능 | 제거할 식별자 | 대체 표현 | 필요 데이터 |
| --- | --- | --- | --- | --- | --- | --- |
| 첫 화면 커버 | 앱 진입, 프로젝트 메시지, 정책 흐름 안내 | `IntroCover` | 제목, 핵심 분석 기준, 시작/가이드/진단 진입 버튼 | 실제 사례명, 실제 이미지 속 식별 정보 | 비식별 안내 이미지 또는 추상 UI 캡처 | `app_summary_anon.json` |
| 전체 지도 | 학교 마커, 구/분류 필터, 레이어 토글 | `AnonymizedMapWorkspace` | 전체 학교 탐색, 구 선택, case 필터, 접근성 필터 | 실제 지도 타일, 실제 좌표, 실제 학교명 | 비식별 학교 점, 구 단위 영역 없는 추상 배치 | `schools_anon.json`, `map_index_anon.json` |
| 학교 검색 | 학교명 검색 및 선택 | `AnonSchoolSearch` | 검색, 목록 선택, 현재 선택 상태 표시 | 학교명 | 비식별 코드, 짧은 라벨, 구 | `schools_anon.json` |
| 지도 레이어 토글 | 도보 500m, 직선 500m, 공원, 재개발, 후보지 표시 | `SyntheticLayerControls` | 레이어 on/off, 범례, 선택 상태 | 실제 polygon, 실제 공원/구역/후보지 좌표 | 학교별 상대 도식 레이어 | `synthetic_map_anon.json` |
| 줌인/학교 선택 | 개별 학교 주변 환경 확인 | `SchoolSyntheticMap` | 학교 중심 500m 반경, 도보권, 시설/후보/단절요소 위치 | 실제 배경지도, 실제 방향/좌표 | 고정 난수 회전/반전된 상대 위치 | `synthetic_map_anon.json` |
| 우측 학교 패널 | 선택 학교 요약, 핵심 지표, 상세 진입 | `AnonSchoolSidePanel` | 요약 진단, 지표 카드, 상세/시뮬레이션 버튼 | 학교명, 공원명, 구역명, 단지명 | 학교 코드, 공원 A, 구역 A, 단지 A | `school_detail_anon.json` |
| 구 전체 통계 | 선택 구 요약 | `DistrictSummaryPanel` | 학교 수, 우선 검토 수, 평균 거리/녹지 | 없음. 구는 유지 | 구 이름 유지 | `statistics_anon.json` |
| 상세 리포트 오버레이 | iframe으로 상세 리포트 표시 | `ReportView` | 현재 격차, 미래 수요, 접근 마찰, 유사학교 비교 | 학교명, 유사학교명, 공원명 | 비식별 코드, 공원 A, 거리 중심 표현 | `school_detail_anon.json` |
| 후보지 시뮬레이션 | AI 추천, 직접 설정, 후보 비교 | `SimulationView` | 추천 모드, 필터, 가중치, 후보 상세, 지도 연동 | 실제 grid ID, 실제 후보 좌표, 실제 경로 좌표 | 후보지 A/B/C, 상대거리, 단절요소 요약 | `candidate_anon.json`, `synthetic_map_anon.json` |
| 전체 통계 리포트 | 시/구 단위 통계와 Top 학교 | `StatisticsView` | KPI, 구별 압력, Top 목록, 선택 이동 | 학교명 | 비식별 코드 | `statistics_anon.json` |
| 사용설명서/정책 흐름 | 앱 사용법과 분석 철학 안내 | `GuideModal` | 단계형 가이드, 원칙, FAQ, CTA | 실제 사례 이미지/명칭 | 비식별 또는 추상 화면 캡처 | `app_summary_anon.json` |

## 데이터 대응

| 기존 입력 | 비식별 산출 | 비식별 처리 |
| --- | --- | --- |
| 학교 우선순위/정책 분류 | `schools_anon.json`, `school_detail_anon.json` | 학교명/ID 제거, 비식별 코드만 유지 |
| 학교 좌표 | `synthetic_map_anon.json` | 실제 좌표 제거, 학교 중심 상대좌표로 변환 |
| 도보권/반경 geometry | `synthetic_map_anon.json` | 실제 geometry 제거, 학교별 추상 shape로 변환 |
| 공원/놀이터 | `synthetic_map_anon.json` | 실제명 제거, 공원 A/B/C와 상대거리만 유지 |
| 재개발/대단지 | `synthetic_map_anon.json` | 실제명/주소 제거, 구역 A/단지 A와 거리·상태만 유지 |
| 후보지 grid | `candidate_anon.json` | grid ID와 좌표 제거, 후보지 A/B/C로 표시 |
| 후보지 경로 | `candidate_anon.json`, `synthetic_map_anon.json` | 실제 경로좌표 제거, 길이와 단절요소 카운트만 유지 |
| KNN 유사학교 | `school_detail_anon.json` | 유사학교명 제거, 비식별 코드로 치환 |
| 전체 통계 | `statistics_anon.json` | 구 단위 집계 유지, 학교 Top 목록은 비식별 코드로 표시 |

## 비식별 지도 설계

- 전체 보기:
  - 실제 행정지도 대신 비식별 학교 점 분포를 보여준다.
  - 구 필터와 case 필터는 기존처럼 유지한다.
  - 점 위치는 실제 좌표가 아니라 구별 그룹 또는 난수 배치다.

- 학교별 보기:
  - 학교 중심점은 화면 중앙에 둔다.
  - 직선거리 500m는 원으로 표시한다.
  - 도보 500m 범위는 실제 polygon이 아니라 단순화된 불규칙 shape로 표시한다.
  - 공원, 후보지, 대단지, 재개발, 단절요소는 상대 좌표로 표시한다.
  - 상대 좌표는 학교마다 고정 난수 회전/반전을 적용해 실제 방향성을 약화한다.

## 단계 1 완료 검증

- 이 문서가 기존 화면과 비식별 화면을 1:1로 대응한다.
- 첫 화면, 지도, 학교 패널, 상세 리포트, 시뮬레이션, 전체 통계, 앱 요약/가이드가 모두 포함되어 있다.
- 각 화면에 유지할 기능, 제거할 식별자, 대체 표현, 필요 데이터가 명시되어 있다.
- 문서에 원본 학교명, 원본 학교 ID, 실제 좌표, 실제 시설명이 없다.
- `npm run check:safety`가 통과해야 한다.
