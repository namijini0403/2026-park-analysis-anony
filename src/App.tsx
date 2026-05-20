import { useEffect, useMemo, useState } from "react";
import type { AppSummaryPayload, Candidate, MapIndexPayload, School, SchoolsPayload, StatisticsPayload, SyntheticMapPoint } from "./types";

type ViewMode = "map" | "statistics" | "detail" | "simulation";
type LayerState = {
  radius: boolean;
  walk: boolean;
  parks: boolean;
  candidates: boolean;
  redevelopment: boolean;
  apartments: boolean;
  barriers: boolean;
};

const CASE_COLORS: Record<number, string> = {
  1: "#dc2626",
  2: "#ea580c",
  3: "#ca8a04",
  4: "#16a34a",
  99: "#64748b",
};

const POINT_COLORS: Record<SyntheticMapPoint["kind"], string> = {
  school: "#0f172a",
  candidate: "#2563eb",
  park: "#16a34a",
  apartment: "#7c3aed",
  redevelopment: "#f97316",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(value || 0));
}

function formatDecimal(value: number, digits = 1) {
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

function metricLabel(value: number, unit: string) {
  return `${formatNumber(value)}${unit}`;
}

function getCandidateScore(candidate: Candidate) {
  const demand = candidate.walkshed_beneficiary_2029;
  const route = candidate.route_length_m || 9999;
  const gap = candidate.nearest_park_dist_m || 0;
  return demand * 1.3 + gap * 0.22 - route * 0.5;
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${path} 로딩 실패`);
  }
  return response.json() as Promise<T>;
}

export default function App() {
  const [schoolsPayload, setSchoolsPayload] = useState<SchoolsPayload | null>(null);
  const [statistics, setStatistics] = useState<StatisticsPayload | null>(null);
  const [appSummary, setAppSummary] = useState<AppSummaryPayload | null>(null);
  const [mapIndex, setMapIndex] = useState<MapIndexPayload | null>(null);
  const [selectedCode, setSelectedCode] = useState<string>("");
  const [view, setView] = useState<ViewMode>("map");
  const [showCover, setShowCover] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedGu, setSelectedGu] = useState("전체");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      loadJson<SchoolsPayload>("./data/schools_anon.json"),
      loadJson<StatisticsPayload>("./data/statistics_anon.json"),
      loadJson<AppSummaryPayload>("./data/app_summary_anon.json"),
      loadJson<MapIndexPayload>("./data/map_index_anon.json"),
    ])
      .then(([schools, stats, summary, index]) => {
        setSchoolsPayload(schools);
        setStatistics(stats);
        setAppSummary(summary);
        setMapIndex(index);
        setSelectedCode(schools.schools[0]?.anon_code ?? "");
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "데이터 로딩 실패"));
  }, []);

  const schools = schoolsPayload?.schools ?? [];
  const districtNames = useMemo(() => ["전체", ...Array.from(new Set(schools.map((school) => school.gu))).sort()], [schools]);
  const selectedSchool = useMemo(
    () => schools.find((school) => school.anon_code === selectedCode) ?? schools[0],
    [schools, selectedCode],
  );

  const filteredSchools = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return schools.filter((school) => {
      const guMatch = selectedGu === "전체" || school.gu === selectedGu;
      const queryMatch =
        !needle ||
        school.anon_code.toLowerCase().includes(needle) ||
        school.short_label.toLowerCase().includes(needle) ||
        school.gu.toLowerCase().includes(needle);
      return guMatch && queryMatch;
    });
  }, [query, schools, selectedGu]);

  if (error) {
    return <div className="app-error">{error}</div>;
  }

  if (!schoolsPayload || !statistics || !appSummary || !mapIndex || !selectedSchool) {
    return <div className="app-error">비식별 데이터를 불러오는 중입니다.</div>;
  }

  return (
    <main className="app-shell">
      {showCover ? (
        <IntroCover
          summary={appSummary}
          onStart={() => {
            setShowCover(false);
            setView("map");
          }}
          onGuide={() => setShowGuide(true)}
          onReport={() => {
            setShowCover(false);
            setView("detail");
          }}
        />
      ) : null}
      {showGuide ? <GuideModal summary={appSummary} onClose={() => setShowGuide(false)} /> : null}
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">Anonymized Submission</p>
          <h1>학교 야외활동 환경 정책지원</h1>
          <p>실명·실좌표·실시설명을 제거한 제출용 의사결정 지원 앱입니다.</p>
        </div>

        <div className="tab-row" aria-label="화면 전환">
          <button className={view === "map" ? "active" : ""} onClick={() => setView("map")}>지도</button>
          <button className={view === "detail" ? "active" : ""} onClick={() => setView("detail")}>상세</button>
          <button className={view === "simulation" ? "active" : ""} onClick={() => setView("simulation")}>시뮬레이션</button>
          <button className={view === "statistics" ? "active" : ""} onClick={() => setView("statistics")}>통계</button>
        </div>
        <button className="guide-button" type="button" onClick={() => setShowGuide(true)}>
          앱 요약 보기
        </button>

        <label className="control-label">
          구 선택
          <select value={selectedGu} onChange={(event) => setSelectedGu(event.target.value)}>
            {districtNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>

        <label className="control-label">
          비식별 코드 검색
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="S- 코드, A001, 구 이름"
          />
        </label>

        <div className="school-list">
          {filteredSchools.slice(0, 80).map((school) => (
            <button
              key={school.anon_code}
              className={school.anon_code === selectedSchool.anon_code ? "school-row active" : "school-row"}
              onClick={() => setSelectedCode(school.anon_code)}
            >
              <span className="school-code">{school.short_label}</span>
              <span>
                <strong>{school.display_name}</strong>
                <small>{school.gu} · {school.case_policy_label}</small>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="content">
        {view === "map" ? (
          <MapWorkspace
            schools={schools}
            mapIndex={mapIndex}
            selectedSchool={selectedSchool}
            selectedGu={selectedGu}
            onSelect={(code) => setSelectedCode(code)}
            onOpenDetail={() => setView("detail")}
            onOpenSimulation={() => setView("simulation")}
          />
        ) : view === "statistics" ? (
          <Overview statistics={statistics} onSelect={(code) => { setSelectedCode(code); setView("detail"); }} />
        ) : view === "simulation" ? (
          <Simulation school={selectedSchool} />
        ) : (
          <Detail school={selectedSchool} onOpenSimulation={() => setView("simulation")} />
        )}
      </section>
    </main>
  );
}

function MapWorkspace({
  schools,
  mapIndex,
  selectedSchool,
  selectedGu,
  onSelect,
  onOpenDetail,
  onOpenSimulation,
}: {
  schools: School[];
  mapIndex: MapIndexPayload;
  selectedSchool: School;
  selectedGu: string;
  onSelect: (code: string) => void;
  onOpenDetail: () => void;
  onOpenSimulation: () => void;
}) {
  const [caseFilter, setCaseFilter] = useState("all");
  const [layers, setLayers] = useState<LayerState>({
    radius: true,
    walk: true,
    parks: true,
    candidates: true,
    redevelopment: true,
    apartments: true,
    barriers: true,
  });

  const rows = useMemo(() => {
    return mapIndex.schools.filter((school) => {
      const guMatch = selectedGu === "전체" || school.gu === selectedGu;
      const caseMatch = caseFilter === "all" || String(school.case_type) === caseFilter;
      return guMatch && caseMatch;
    });
  }, [caseFilter, mapIndex.schools, selectedGu]);

  return (
    <div className="map-layout">
      <section className="map-surface">
        <div className="map-toolbar">
          <div>
            <p className="eyebrow">Anonymized Map</p>
            <h2>비식별 학교 지도</h2>
          </div>
          <div className="case-filter">
            {[
              ["all", "전체"],
              ["1", "즉시"],
              ["2", "우선"],
              ["3", "모니터링"],
              ["4", "양호"],
              ["99", "별도"],
            ].map(([key, label]) => (
              <button key={key} className={caseFilter === key ? "active" : ""} onClick={() => setCaseFilter(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <AbstractCityMap rows={rows} selectedCode={selectedSchool.anon_code} onSelect={onSelect} />
        <div className="layer-controls">
          {([
            ["radius", "직선 500m"],
            ["walk", "도보 500m"],
            ["parks", "공원"],
            ["candidates", "후보지"],
            ["redevelopment", "재개발"],
            ["apartments", "대단지"],
            ["barriers", "단절요소"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              className={layers[key] ? "active" : ""}
              type="button"
              onClick={() => setLayers((previous) => ({ ...previous, [key]: !previous[key] }))}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <aside className="map-detail-panel">
        <div className="panel-title-row">
          <div>
            <p className="eyebrow">{selectedSchool.gu} · {selectedSchool.short_label}</p>
            <h3>{selectedSchool.display_name}</h3>
          </div>
          <span style={{ backgroundColor: CASE_COLORS[selectedSchool.case_type] ?? "#64748b" }}>
            {selectedSchool.case_policy_label}
          </span>
        </div>
        <SyntheticMap mapData={selectedSchool.synthetic_map} layers={layers} highlightCandidates />
        <div className="map-metrics">
          <span>공원 {formatDecimal(selectedSchool.metrics.nearest_park_dist_m)}m</span>
          <span>녹지 {formatDecimal(selectedSchool.metrics.green_ratio)}%</span>
          <span>후보지 {selectedSchool.candidates.length}곳</span>
        </div>
        <div className="panel-actions">
          <button type="button" onClick={onOpenDetail}>상세 리포트</button>
          <button type="button" onClick={onOpenSimulation}>시뮬레이션</button>
        </div>
      </aside>
    </div>
  );
}

function AbstractCityMap({
  rows,
  selectedCode,
  onSelect,
}: {
  rows: MapIndexPayload["schools"];
  selectedCode: string;
  onSelect: (code: string) => void;
}) {
  const maxX = Math.max(1, ...rows.map((row) => row.x));
  const maxY = Math.max(1, ...rows.map((row) => row.y));
  const toX = (value: number) => 52 + (value / maxX) * 696;
  const toY = (value: number) => 52 + (value / maxY) * 436;
  return (
    <svg className="city-map" viewBox="0 0 800 540" role="img" aria-label="비식별 학교 전체 지도">
      <rect width="800" height="540" rx="18" fill="#081421" />
      <g opacity="0.2">
        {Array.from({ length: 11 }).map((_, index) => (
          <line key={`v-${index}`} x1={60 + index * 68} y1="40" x2={60 + index * 68} y2="500" stroke="#e2e8f0" />
        ))}
        {Array.from({ length: 7 }).map((_, index) => (
          <line key={`h-${index}`} x1="40" y1={58 + index * 68} x2="760" y2={58 + index * 68} stroke="#e2e8f0" />
        ))}
      </g>
      {rows.map((row) => {
        const active = row.anon_code === selectedCode;
        return (
          <g key={row.anon_code} onClick={() => onSelect(row.anon_code)} className="city-point">
            <circle
              cx={toX(row.x)}
              cy={toY(row.y)}
              r={active ? 11 : 7}
              fill={CASE_COLORS[row.case_type] ?? "#64748b"}
              stroke={active ? "#fff" : "rgba(255,255,255,0.45)"}
              strokeWidth={active ? 3 : 1}
            />
            {active ? (
              <text x={toX(row.x) + 14} y={toY(row.y) + 4} fill="#f8fafc" fontSize="12" fontWeight="800">
                {row.short_label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function IntroCover({
  summary,
  onStart,
  onGuide,
  onReport,
}: {
  summary: AppSummaryPayload;
  onStart: () => void;
  onGuide: () => void;
  onReport: () => void;
}) {
  return (
    <section className="intro-cover" role="dialog" aria-modal="true" aria-labelledby="introTitle">
      <div className="intro-shell">
        <div className="intro-main">
          <p className="cover-kicker">Anonymized Outdoor Equity</p>
          <h1 id="introTitle">{summary.title}</h1>
          <p className="cover-statement">{summary.subtitle}</p>
          <p className="cover-copy">
            학교명과 실제 좌표를 공개하지 않고, 현재 격차와 미래 수요, 접근 마찰, 후보지 추천을 하나의 판단 흐름으로 연결합니다.
          </p>
          <div className="cover-tags" aria-label="핵심 분석 기준">
            {summary.flow.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="cover-actions">
            <button className="primary" type="button" onClick={onStart}>지도에서 시작하기</button>
            <button type="button" onClick={onGuide}>정책 흐름 보기</button>
            <button className="ghost" type="button" onClick={onReport}>학교 진단 보기</button>
          </div>
        </div>
        <div className="intro-visual" aria-label="앱 요약">
          <div className="visual-map">
            <span className="node school">학교</span>
            <span className="node park">A</span>
            <span className="node candidate">B</span>
            <span className="node barrier" />
          </div>
          <p>도식지도는 실제 지도가 아니라 학교 중심 상대거리만 보여줍니다.</p>
        </div>
      </div>
    </section>
  );
}

function GuideModal({ summary, onClose }: { summary: AppSummaryPayload; onClose: () => void }) {
  return (
    <div className="guide-overlay" role="dialog" aria-modal="true" aria-labelledby="guideTitle">
      <section className="guide-dialog">
        <button className="close-button" type="button" onClick={onClose} aria-label="닫기">×</button>
        <p className="eyebrow">Policy Flow</p>
        <h2 id="guideTitle">비식별 정책지원 흐름</h2>
        <div className="guide-flow">
          {summary.flow.map((item, index) => (
            <article key={item}>
              <span>{index + 1}</span>
              <strong>{item}</strong>
            </article>
          ))}
        </div>
        <div className="principle-grid">
          {summary.principles.map((item) => (
            <div key={item}>{item}</div>
          ))}
        </div>
        <div className="guide-stats">
          <Kpi title="분석 학교" value={metricLabel(summary.statistics_summary.school_count, "개교")} />
          <Kpi title="즉시 개선" value={metricLabel(summary.statistics_summary.urgent_count, "개교")} tone="danger" />
          <Kpi title="우선 검토" value={metricLabel(summary.statistics_summary.priority_count, "개교")} />
        </div>
      </section>
    </div>
  );
}

function Overview({ statistics, onSelect }: { statistics: StatisticsPayload; onSelect: (code: string) => void }) {
  return (
    <div className="page-grid">
      <section className="hero-band">
        <p className="eyebrow">City Overview</p>
        <h2>비식별 학교 단위 환경 격차 요약</h2>
        <p>구 단위 통계와 비식별 학교 코드를 통해 정책 우선순위를 검토합니다.</p>
      </section>

      <section className="kpi-grid">
        <Kpi title="분석 학교" value={metricLabel(statistics.summary.school_count, "개교")} />
        <Kpi title="분석 구·군" value={metricLabel(statistics.summary.district_count, "개")} />
        <Kpi title="즉시 개선" value={metricLabel(statistics.summary.urgent_count, "개교")} tone="danger" />
        <Kpi title="2029 잠재 수요" value={metricLabel(statistics.summary.potential_demand_2029, "명")} />
      </section>

      <section className="district-grid">
        {statistics.districts.map((district) => (
          <article className="district-card" key={district.gu}>
            <div className="card-head">
              <div>
                <p className="eyebrow">{district.gu}</p>
                <h3>{district.school_count}개교</h3>
              </div>
              <span>{district.urgent_count + district.priority_count}개 검토</span>
            </div>
            <div className="mini-metrics">
              <span>평균 공원 {formatDecimal(district.avg_nearest_park_dist_m)}m</span>
              <span>평균 녹지 {formatDecimal(district.avg_green_ratio)}%</span>
            </div>
            <div className="top-list">
              {district.top_priority.map((school) => (
                <button key={school.anon_code} onClick={() => onSelect(school.anon_code)}>
                  <strong>{school.display_name}</strong>
                  <small>{school.case_policy_label} · 2029 {formatNumber(school.potential_demand_2029)}명</small>
                </button>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function Detail({ school, onOpenSimulation }: { school: School; onOpenSimulation: () => void }) {
  const metrics = school.metrics;
  const barrierCount = school.synthetic_map.barriers.length;
  const candidateCount = school.candidates.length;
  const latestTrend = school.trend[school.trend.length - 1]?.students ?? metrics.current_students_2025;
  const firstTrend = school.trend[0]?.students ?? latestTrend;
  const trendDelta = latestTrend - firstTrend;
  const topCandidate = [...school.candidates].sort((left, right) => getCandidateScore(right) - getCandidateScore(left))[0];

  return (
    <div className="page-grid">
      <section className="hero-band compact">
        <p className="eyebrow">{school.gu} · {school.short_label}</p>
        <h2>{school.display_name}</h2>
        <div className="badge-row">
          <span style={{ backgroundColor: CASE_COLORS[school.case_type] ?? "#64748b" }}>{school.case_policy_label}</span>
          <span>{school.case_status_label}</span>
        </div>
      </section>

      <section className="kpi-grid">
        <Kpi title="최근접 공원" value={metricLabel(metrics.nearest_park_dist_m, "m")} tone={metrics.nearest_park_dist_m >= 500 ? "danger" : "default"} />
        <Kpi title="녹지 비율" value={`${formatDecimal(metrics.green_ratio)}%`} />
        <Kpi title="도보권 놀이터" value={metricLabel(metrics.playground_count_500m, "개")} />
        <Kpi title="2029 잠재 수요" value={metricLabel(metrics.potential_demand_2029, "명")} />
      </section>

      <section className="report-grid">
        <article className="report-card danger-line">
          <p className="eyebrow">Current Gap</p>
          <h3>현재 생활권 격차</h3>
          <div className="report-metric-list">
            <MetricLine label="최근접 공원" value={`${formatDecimal(metrics.nearest_park_dist_m)}m`} alert={metrics.nearest_park_dist_m >= 500} />
            <MetricLine label="공식 공원 수" value={`${metrics.official_park_count_500m}개`} alert={metrics.official_park_count_500m === 0} />
            <MetricLine label="활동규모 공원 수" value={`${metrics.functional_park_count_500m}개`} alert={metrics.functional_park_count_500m === 0} />
            <MetricLine label="도보권 놀이터" value={`${metrics.playground_count_500m}개`} alert={metrics.playground_count_500m === 0} />
          </div>
        </article>

        <article className="report-card blue-line">
          <p className="eyebrow">Future Demand</p>
          <h3>미래 수요 신호</h3>
          <div className="demand-compare">
            <div>
              <span>현재</span>
              <strong>{formatNumber(metrics.current_students_2025)}명</strong>
            </div>
            <div>
              <span>2029</span>
              <strong>{formatNumber(metrics.potential_demand_2029)}명</strong>
            </div>
            <div>
              <span>2031</span>
              <strong>{formatNumber(metrics.potential_demand_2031)}명</strong>
            </div>
          </div>
          <p className="report-note">
            최근 추세 변화는 {trendDelta >= 0 ? "+" : ""}{formatNumber(trendDelta)}명이며, 현재 부족 지표와 미래 잠재 수요를 함께 검토합니다.
          </p>
        </article>

        <article className="report-card orange-line">
          <p className="eyebrow">Access Friction</p>
          <h3>접근 마찰과 단절요소</h3>
          <div className="report-metric-list">
            <MetricLine label="도식 단절요소" value={`${barrierCount}개`} alert={barrierCount > 0} />
            <MetricLine label="추천 후보지" value={`${candidateCount}곳`} alert={candidateCount === 0} />
            <MetricLine label="상위 후보" value={topCandidate ? topCandidate.label : "없음"} alert={!topCandidate} />
            <MetricLine label="상위 후보 경로" value={topCandidate ? `${formatDecimal(topCandidate.route_length_m)}m` : "-"} />
          </div>
        </article>
      </section>

      <section className="two-column">
        <article className="panel-card">
          <h3>학교별 도식지도</h3>
          <SyntheticMap mapData={school.synthetic_map} />
          <p className="note">{school.synthetic_map.note}</p>
        </article>
        <article className="panel-card">
          <h3>KNN 유사학교 비교</h3>
          <div className="compare-list">
            {school.similar_schools.length ? school.similar_schools.map((peer) => (
              <div key={peer.anon_code}>
                <strong>{peer.rank}. {peer.display_name}</strong>
                <span>{peer.gu} · 공원 {formatDecimal(peer.nearest_park_dist_m)}m · 녹지 {formatDecimal(peer.green_ratio)}%</span>
              </div>
            )) : <p className="note">표시 가능한 비식별 유사학교가 없습니다.</p>}
          </div>
        </article>
      </section>

      <section className="two-column">
        <article className="panel-card">
          <h3>학생 수 추세</h3>
          <TrendBar trend={school.trend} />
        </article>
        <article className="panel-card policy-card">
          <p className="eyebrow">Policy Interpretation</p>
          <h3>정책 판단 흐름</h3>
          <div className="policy-flow">
            <div>
              <strong>1. 현재 격차</strong>
              <span>공원 거리, 녹지, 놀이터를 분리해 부족 요인을 확인합니다.</span>
            </div>
            <div>
              <strong>2. 미래 수요</strong>
              <span>현재 학생 수와 2029/2031 잠재 수요가 함께 높은지 확인합니다.</span>
            </div>
            <div>
              <strong>3. 접근 마찰</strong>
              <span>단절요소와 후보지 경로 부담을 현장 검토 전 보조 신호로 사용합니다.</span>
            </div>
          </div>
          <button className="primary-action" type="button" onClick={onOpenSimulation}>
            후보지 시뮬레이션 열기
          </button>
        </article>
      </section>
    </div>
  );
}

function MetricLine({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={alert ? "metric-line alert" : "metric-line"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Simulation({ school }: { school: School }) {
  const ranked = [...school.candidates].sort((left, right) => getCandidateScore(right) - getCandidateScore(left));
  return (
    <div className="page-grid">
      <section className="hero-band compact">
        <p className="eyebrow">{school.display_name}</p>
        <h2>후보지 시뮬레이션</h2>
        <p>후보지는 실제 좌표 대신 학교 중심 상대거리와 보행 부담만 표시합니다.</p>
      </section>

      <section className="two-column">
        <article className="panel-card">
          <h3>후보지 도식지도</h3>
          <SyntheticMap mapData={school.synthetic_map} highlightCandidates />
        </article>
        <article className="panel-card">
          <h3>추천 후보</h3>
          <div className="candidate-list">
            {ranked.length ? ranked.slice(0, 5).map((candidate, index) => (
              <div className="candidate-card" key={candidate.label}>
                <div className="rank-badge">{index + 1}</div>
                <div>
                  <strong>{candidate.label}</strong>
                  <p>2029 잠재수혜 {formatNumber(candidate.walkshed_beneficiary_2029)}명 · 경로 {formatDecimal(candidate.route_length_m)}m</p>
                  <small>{candidate.barrier_label} · 기존 공원 {formatDecimal(candidate.nearest_park_dist_m)}m</small>
                </div>
              </div>
            )) : <p className="note">표시 가능한 비식별 후보지가 없습니다.</p>}
          </div>
        </article>
      </section>
    </div>
  );
}

function Kpi({ title, value, tone = "default" }: { title: string; value: string; tone?: "default" | "danger" }) {
  return (
    <article className={`kpi-card ${tone}`}>
      <p>{title}</p>
      <strong>{value}</strong>
    </article>
  );
}

function SyntheticMap({
  mapData,
  highlightCandidates = false,
  layers = {
    radius: true,
    walk: true,
    parks: true,
    candidates: true,
    redevelopment: true,
    apartments: true,
    barriers: true,
  },
}: {
  mapData: School["synthetic_map"];
  highlightCandidates?: boolean;
  layers?: LayerState;
}) {
  const points = mapData.points.filter((point) => {
    if (point.kind === "park") return layers.parks;
    if (point.kind === "candidate") return layers.candidates;
    if (point.kind === "redevelopment") return layers.redevelopment;
    if (point.kind === "apartment") return layers.apartments;
    return true;
  });
  const extent = Math.max(700, ...points.map((point) => Math.max(Math.abs(point.x_m), Math.abs(point.y_m)))) * 1.25;
  const toSvg = (value: number) => 300 + (value / extent) * 250;
  const candidates = points.filter((point) => point.kind === "candidate");
  const walkPath = mapData.walk_500m_shape.map((point) => `${toSvg(point.x_m)},${toSvg(-point.y_m)}`).join(" ");

  return (
    <div className="synthetic-map">
      <svg viewBox="0 0 600 600" role="img" aria-label="학교 중심 상대거리 도식지도">
        <defs>
          <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#dbe4ef" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="600" height="600" rx="18" fill="#f8fafc" />
        <rect width="600" height="600" fill="url(#grid)" />
        {layers.radius ? <circle cx="300" cy="300" r={toSvg(mapData.radius_500m) - 300} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeDasharray="8 8" /> : null}
        {layers.walk && walkPath ? <polygon points={walkPath} fill="rgba(16,185,129,0.16)" stroke="#10b981" strokeWidth="3" /> : null}
        {[150, 300].map((r) => (
          <circle key={r} cx="300" cy="300" r={r / 2} fill="none" stroke="#cbd5e1" strokeDasharray="6 8" />
        ))}
        {layers.barriers ? mapData.barriers.map((barrier) => (
          <line
            key={barrier.label}
            x1={toSvg(barrier.x1_m)}
            y1={toSvg(-barrier.y1_m)}
            x2={toSvg(barrier.x2_m)}
            y2={toSvg(-barrier.y2_m)}
            stroke="#f97316"
            strokeWidth="7"
            strokeLinecap="round"
          />
        )) : null}
        {highlightCandidates && candidates.map((point) => (
          <line
            key={`route-${point.label}`}
            x1="300"
            y1="300"
            x2={toSvg(point.x_m)}
            y2={toSvg(-point.y_m)}
            stroke="#94a3b8"
            strokeWidth="3"
            strokeDasharray="8 8"
          />
        ))}
        {points.map((point) => {
          const color = POINT_COLORS[point.kind];
          const x = toSvg(point.x_m);
          const y = toSvg(-point.y_m);
          const isSchool = point.kind === "school";
          return (
            <g key={`${point.kind}-${point.label}`} transform={`translate(${x} ${y})`}>
              <circle r={isSchool ? 18 : 13} fill={color} opacity={point.kind === "redevelopment" ? 0.82 : 1} />
              <text y={isSchool ? 5 : 4} textAnchor="middle" fill="#fff" fontSize={isSchool ? 10 : 8} fontWeight="800">
                {isSchool ? "학교" : point.label.replace(/^(후보지|공원|단지|구역) /, "")}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        {Object.entries(POINT_COLORS).map(([kind, color]) => (
          <span key={kind}><i style={{ backgroundColor: color }} />{kindLabel(kind as SyntheticMapPoint["kind"])}</span>
        ))}
      </div>
    </div>
  );
}

function kindLabel(kind: SyntheticMapPoint["kind"]) {
  return {
    school: "학교",
    candidate: "후보지",
    park: "공원",
    apartment: "대단지",
    redevelopment: "재개발",
  }[kind];
}

function TrendBar({ trend }: { trend: School["trend"] }) {
  const max = Math.max(1, ...trend.map((item) => item.students));
  if (!trend.length) {
    return <p className="note">학생 수 추세 데이터가 없습니다.</p>;
  }
  return (
    <div className="trend-bars">
      {trend.map((item) => (
        <div key={item.year}>
          <span style={{ height: `${Math.max(16, (item.students / max) * 120)}px` }} />
          <strong>{formatNumber(item.students)}</strong>
          <small>{item.year}</small>
        </div>
      ))}
    </div>
  );
}
