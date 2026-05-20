import { useEffect, useMemo, useState } from "react";
import type { AppSummaryPayload, Candidate, School, SchoolsPayload, StatisticsPayload, SyntheticMapPoint } from "./types";

type ViewMode = "overview" | "detail" | "simulation";

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
  const [selectedCode, setSelectedCode] = useState<string>("");
  const [view, setView] = useState<ViewMode>("overview");
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
    ])
      .then(([schools, stats, summary]) => {
        setSchoolsPayload(schools);
        setStatistics(stats);
        setAppSummary(summary);
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

  if (!schoolsPayload || !statistics || !appSummary || !selectedSchool) {
    return <div className="app-error">비식별 데이터를 불러오는 중입니다.</div>;
  }

  return (
    <main className="app-shell">
      {showCover ? (
        <IntroCover
          summary={appSummary}
          onStart={() => {
            setShowCover(false);
            setView("overview");
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
          <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>전체</button>
          <button className={view === "detail" ? "active" : ""} onClick={() => setView("detail")}>상세</button>
          <button className={view === "simulation" ? "active" : ""} onClick={() => setView("simulation")}>시뮬레이션</button>
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
        {view === "overview" ? (
          <Overview statistics={statistics} onSelect={(code) => { setSelectedCode(code); setView("detail"); }} />
        ) : view === "simulation" ? (
          <Simulation school={selectedSchool} />
        ) : (
          <Detail school={selectedSchool} />
        )}
      </section>
    </main>
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

function Detail({ school }: { school: School }) {
  const metrics = school.metrics;
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

      <section className="two-column">
        <article className="panel-card">
          <h3>학교별 도식지도</h3>
          <SyntheticMap points={school.synthetic_map.points} />
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

      <section className="panel-card">
        <h3>학생 수 추세</h3>
        <TrendBar trend={school.trend} />
      </section>
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
          <SyntheticMap points={school.synthetic_map.points} highlightCandidates />
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

function SyntheticMap({ points, highlightCandidates = false }: { points: SyntheticMapPoint[]; highlightCandidates?: boolean }) {
  const extent = Math.max(700, ...points.map((point) => Math.max(Math.abs(point.x_m), Math.abs(point.y_m)))) * 1.25;
  const toSvg = (value: number) => 300 + (value / extent) * 250;
  const candidates = points.filter((point) => point.kind === "candidate");

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
        {[150, 300, 450].map((r) => (
          <circle key={r} cx="300" cy="300" r={r / 2} fill="none" stroke="#cbd5e1" strokeDasharray="6 8" />
        ))}
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
