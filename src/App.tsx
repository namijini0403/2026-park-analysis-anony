import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent } from "react";
import type { AppSummaryPayload, Candidate, MapIndexPayload, School, SchoolsPayload, StatisticsPayload, SyntheticMapPoint } from "./types";

type ViewMode = "map" | "statistics" | "detail" | "simulation";
type SimulationMode = "ai" | "manual";
type LayerState = {
  radius: boolean;
  walk: boolean;
  parks: boolean;
  candidates: boolean;
  redevelopment: boolean;
  apartments: boolean;
  barriers: boolean;
};

type SimulationFilters = {
  excludePrimary: boolean;
  excludeSecondary: boolean;
  excludeTertiary: boolean;
  excludeRedev: boolean;
  excludeLowFeasibility: boolean;
};

type SimulationWeights = {
  benefit: number;
  route: number;
  parkGap: number;
};

type SimulationWeightToggles = Record<keyof SimulationWeights, boolean>;

type ScoredCandidate = Candidate & {
  final_score: number;
  benefit_score: number;
  route_score: number;
  park_gap_score: number;
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

const DEFAULT_SIMULATION_FILTERS: SimulationFilters = {
  excludePrimary: false,
  excludeSecondary: false,
  excludeTertiary: false,
  excludeRedev: false,
  excludeLowFeasibility: false,
};

const AI_SIMULATION_FILTERS: SimulationFilters = {
  excludePrimary: true,
  excludeSecondary: true,
  excludeTertiary: false,
  excludeRedev: false,
  excludeLowFeasibility: false,
};

const DEFAULT_SIMULATION_WEIGHTS: SimulationWeights = {
  benefit: 45,
  route: 30,
  parkGap: 25,
};

const AI_SIMULATION_WEIGHTS: SimulationWeights = {
  benefit: 20,
  route: 70,
  parkGap: 10,
};

const DEFAULT_WEIGHT_TOGGLES: SimulationWeightToggles = {
  benefit: true,
  route: true,
  parkGap: true,
};

const FILTER_OPTIONS: Array<{ key: keyof SimulationFilters; title: string; description: string }> = [
  { key: "excludePrimary", title: "도시 대로 횡단 제외", description: "후보 경로의 주 단절요소가 1회 이상이면 제외" },
  { key: "excludeSecondary", title: "중간급 도로 횡단 제외", description: "중간급 단절요소가 있는 후보 제외" },
  { key: "excludeTertiary", title: "일반 도로 횡단 제외", description: "일반 단절요소까지 보수적으로 제외" },
  { key: "excludeRedev", title: "재개발 영향권 제외", description: "재개발 영향 신호가 있는 후보 제외" },
  { key: "excludeLowFeasibility", title: "낮은 실행가능성 제외", description: "토지 실행가능성 low 후보 제외" },
];

const WEIGHT_OPTIONS: Array<{ key: keyof SimulationWeights; title: string; description: string }> = [
  { key: "benefit", title: "잠재수혜학생수", description: "후보 도보권의 2029 수요가 높을수록 가점" },
  { key: "route", title: "학교 접근성", description: "학교에서 후보지까지 경로가 짧을수록 가점" },
  { key: "parkGap", title: "기존 공원 공백", description: "기존 공원과 멀수록 신규 공급 필요성 가점" },
];

function minmaxScore(values: number[], reverse = false) {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 1);
  return values.map((value) => {
    const normalized = (value - min) / (max - min);
    return reverse ? 1 - normalized : normalized;
  });
}

function normalizeSimulationWeights(weights: SimulationWeights): SimulationWeights {
  const total = weights.benefit + weights.route + weights.parkGap;
  if (total <= 0) {
    return { benefit: 1 / 3, route: 1 / 3, parkGap: 1 / 3 };
  }
  return {
    benefit: weights.benefit / total,
    route: weights.route / total,
    parkGap: weights.parkGap / total,
  };
}

function applyWeightToggles(weights: SimulationWeights, toggles: SimulationWeightToggles): SimulationWeights {
  return {
    benefit: toggles.benefit ? weights.benefit : 0,
    route: toggles.route ? weights.route : 0,
    parkGap: toggles.parkGap ? weights.parkGap : 0,
  };
}

function passesSimulationFilters(candidate: Candidate, filters: SimulationFilters) {
  if (filters.excludePrimary && candidate.barrier_counts.primary > 0) return false;
  if (filters.excludeSecondary && candidate.barrier_counts.secondary > 0) return false;
  if (filters.excludeTertiary && candidate.barrier_counts.tertiary > 0) return false;
  if (filters.excludeRedev && candidate.redev_flag) return false;
  if (filters.excludeLowFeasibility && candidate.land_feasibility_level === "low") return false;
  return true;
}

function scoreCandidates(candidates: Candidate[], weights: SimulationWeights): ScoredCandidate[] {
  if (!candidates.length) return [];
  const normalizedWeights = normalizeSimulationWeights(weights);
  const benefitScores = minmaxScore(candidates.map((candidate) => candidate.walkshed_beneficiary_2029));
  const validRouteValues = candidates.map((candidate) => candidate.route_length_m).filter((value) => value > 0);
  const routeMin = validRouteValues.length ? Math.min(...validRouteValues) : 0;
  const routeMax = validRouteValues.length ? Math.max(...validRouteValues) : 0;
  const routeScores = candidates.map((candidate) => {
    if (candidate.route_length_m <= 0 || !validRouteValues.length) return 0;
    if (routeMax === routeMin) return 1;
    return 1 - ((candidate.route_length_m - routeMin) / (routeMax - routeMin));
  });
  const parkGapScores = minmaxScore(candidates.map((candidate) => candidate.nearest_park_dist_m));

  return candidates
    .map((candidate, index) => {
      const finalScore =
        benefitScores[index] * normalizedWeights.benefit +
        routeScores[index] * normalizedWeights.route +
        parkGapScores[index] * normalizedWeights.parkGap;
      return {
        ...candidate,
        benefit_score: benefitScores[index],
        route_score: routeScores[index],
        park_gap_score: parkGapScores[index],
        final_score: finalScore,
      };
    })
    .sort((left, right) => right.final_score - left.final_score);
}

function buildFilterSummary(filters: SimulationFilters) {
  return FILTER_OPTIONS.filter((option) => filters[option.key]).map((option) => option.title);
}

function buildCandidateReasons(candidate: ScoredCandidate) {
  const reasons: string[] = [];
  if (candidate.benefit_score >= 0.65) reasons.push("수요 규모 우수");
  if (candidate.route_score >= 0.65) reasons.push("학교 접근성 우수");
  if (candidate.park_gap_score >= 0.65) reasons.push("기존 공원 공백 큼");
  if (candidate.barrier_counts.primary > 0 || candidate.barrier_counts.secondary > 0) reasons.push("주요 단절요소 검토 필요");
  if (candidate.redev_flag) reasons.push("재개발 영향권 현장 확인 필요");
  return reasons.length ? reasons.slice(0, 3) : ["복합 조건 균형"];
}

function formatScore(value: number) {
  return `${Math.round(value * 100)}점`;
}

function formatDistance(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value >= 9999) return "정보 없음";
  return `${formatDecimal(value)}m`;
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

  const shellClassName = view === "map" ? "app-shell map-mode" : "app-shell page-mode";

  return (
    <main className={shellClassName}>
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
      {view === "map" ? (
        <div className="top-action-stack" aria-label="상단 바로가기">
          <button className="top-action-button primary" type="button" onClick={() => setView("detail")}>학교 진단</button>
          <button className="top-action-button secondary" type="button" onClick={() => setView("simulation")}>시뮬레이션</button>
          <button className="top-action-button secondary" type="button" onClick={() => setView("statistics")}>전체 통계</button>
          <button className="top-action-button secondary" type="button" onClick={() => setShowGuide(true)}>사용설명서</button>
        </div>
      ) : null}
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">Incheon Outdoor Equity</p>
          <h1>반경 너머, 도달 가능성으로</h1>
          <p>비식별 학교 단위로 도보 접근성·환경 격차·미래 수요를 진단합니다.</p>
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

        {view === "map" ? <h2 className="panel-section-title">구 선택</h2> : null}
        <label className="control-label">
          구 선택
          <select value={selectedGu} onChange={(event) => setSelectedGu(event.target.value)}>
            {districtNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>

        {view === "map" ? <h2 className="panel-section-title">학교 검색</h2> : null}
        <label className="control-label">
          비식별 코드 검색
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="S- 코드, A001, 구 이름"
          />
        </label>

        {view === "map" ? (
          <div className="sidebar-selected-card">
            <h2 className="panel-section-title in-card">학교 상세</h2>
            <div className="detail-head">
              <div>
                <p className="eyebrow">{selectedSchool.gu} · {selectedSchool.short_label}</p>
                <h2 className="detail-name">{selectedSchool.display_name}</h2>
                <p className="detail-subtitle">{selectedSchool.case_status_label}</p>
              </div>
              <span className="detail-badge" style={{ borderColor: CASE_COLORS[selectedSchool.case_type] ?? "#64748b" }}>
                {selectedSchool.case_policy_label}
              </span>
            </div>
            <div className="detail-metric-grid">
              <span>공원 {formatDecimal(selectedSchool.metrics.nearest_park_dist_m)}m</span>
              <span>녹지 {formatDecimal(selectedSchool.metrics.green_ratio)}%</span>
              <span>후보지 {selectedSchool.candidates.length}곳</span>
            </div>
            <div className="panel-actions">
              <button type="button" onClick={() => setView("detail")}>상세 리포트</button>
              <button type="button" onClick={() => setView("simulation")}>시뮬레이션</button>
            </div>
          </div>
        ) : null}

        {view === "map" ? <h2 className="panel-section-title school-list-title">학교 목록</h2> : null}
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

      <section className={view === "map" ? "content map-content" : "content page-content"}>
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
          <Overview
            statistics={statistics}
            schools={schools}
            selectedGu={selectedGu}
            onSelectGu={setSelectedGu}
            onSelect={(code) => { setSelectedCode(code); setView("detail"); }}
          />
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
            <h2>학교 검색</h2>
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
        <p className="map-note">
          전체 지도 점 위치는 원본 좌표의 전체 방향감과 상대 배치를 유지하되, 정확한 지점은 변위 처리한 비식별 화면 좌표입니다.
        </p>
        <AbstractCityMap rows={rows} selectedCode={selectedSchool.anon_code} onSelect={onSelect} />
        <div className="layer-controls">
          {([
            ["walk", "🚶 실제 도보이동 500m"],
            ["radius", "⭕ 직선거리 500m"],
            ["parks", "🌳 공원·놀이터"],
            ["redevelopment", "🏗️ 재개발"],
            ["candidates", "📍 후보지"],
            ["apartments", "🏢 대단지"],
            ["barriers", "🚧 단절요소"],
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
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [dragAnchor, setDragAnchor] = useState<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);
  const dragDistanceRef = useRef(0);
  const toX = (value: number) => Math.min(760, Math.max(40, value));
  const toY = (value: number) => Math.min(500, Math.max(40, value));
  const selectedRow = rows.find((row) => row.anon_code === selectedCode);
  const fallbackCenter = rows.length
    ? {
        x: rows.reduce((sum, row) => sum + toX(row.x), 0) / rows.length,
        y: rows.reduce((sum, row) => sum + toY(row.y), 0) / rows.length,
      }
    : { x: 400, y: 270 };
  const center = selectedRow ? { x: toX(selectedRow.x), y: toY(selectedRow.y) } : fallbackCenter;
  const viewWidth = 800 / zoom;
  const viewHeight = 540 / zoom;
  const panSlackX = 260;
  const panSlackY = 90;
  const clampViewX = (value: number) => Math.min(Math.max(value, -panSlackX), Math.max(0, 800 - viewWidth) + panSlackX);
  const clampViewY = (value: number) => Math.min(Math.max(value, -panSlackY), Math.max(0, 540 - viewHeight) + panSlackY);
  const viewX = clampViewX(center.x - viewWidth / 2 + panOffset.x);
  const viewY = clampViewY(center.y - viewHeight / 2 + panOffset.y);
  const viewBox = `${viewX} ${viewY} ${viewWidth} ${viewHeight}`;
  const markerScale = 1 / zoom;
  const changeZoom = (delta: number) => {
    setZoom((value) => Math.min(4, Math.max(1, Number((value + delta).toFixed(2)))));
  };
  const handleWheelZoom = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? 0.25 : -0.25);
  };
  const handleMapPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    dragDistanceRef.current = 0;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragAnchor({ clientX: event.clientX, clientY: event.clientY, panX: panOffset.x, panY: panOffset.y });
  };
  const handleMapPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragAnchor) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const dx = ((event.clientX - dragAnchor.clientX) * viewWidth) / bounds.width;
    const dy = ((event.clientY - dragAnchor.clientY) * viewHeight) / bounds.height;
    dragDistanceRef.current = Math.max(dragDistanceRef.current, Math.hypot(event.clientX - dragAnchor.clientX, event.clientY - dragAnchor.clientY));
    setPanOffset({ x: dragAnchor.panX - dx, y: dragAnchor.panY - dy });
  };
  const handleMapPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragAnchor(null);
  };
  const handlePointPointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    event.stopPropagation();
    dragDistanceRef.current = 0;
    setDragAnchor(null);
  };
  const handleMapClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (dragDistanceRef.current > 5) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX;
    const clickY = event.clientY;
    const nearest = rows.reduce<{ code: string; distance: number } | null>((best, row) => {
      const screenX = bounds.left + ((toX(row.x) - viewX) / viewWidth) * bounds.width;
      const screenY = bounds.top + ((toY(row.y) - viewY) / viewHeight) * bounds.height;
      const distance = Math.hypot(screenX - clickX, screenY - clickY);
      return !best || distance < best.distance ? { code: row.anon_code, distance } : best;
    }, null);
    if (nearest && nearest.distance <= 28) {
      onSelect(nearest.code);
    }
  };

  return (
    <div className="city-map-wrap" onWheel={handleWheelZoom}>
      <div className="zoom-controls" aria-label="전체 지도 확대 축소">
        <button type="button" onClick={() => changeZoom(0.5)}>+</button>
        <button type="button" onClick={() => changeZoom(-0.5)}>-</button>
        <button type="button" onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }}>{zoom.toFixed(1)}x</button>
      </div>
      <svg
        className={dragAnchor ? "city-map dragging" : "city-map"}
        viewBox={viewBox}
        role="img"
        aria-label="비식별 학교 전체 지도"
        onPointerDown={handleMapPointerDown}
        onPointerMove={handleMapPointerMove}
        onPointerUp={handleMapPointerUp}
        onPointerCancel={handleMapPointerUp}
        onClick={handleMapClick}
      >
        <rect width="800" height="540" rx="18" fill="#081421" />
        <g opacity="0.2">
          {Array.from({ length: 11 }).map((_, index) => (
            <line key={`v-${index}`} x1={60 + index * 68} y1="40" x2={60 + index * 68} y2="500" stroke="#e2e8f0" strokeWidth={markerScale} />
          ))}
          {Array.from({ length: 7 }).map((_, index) => (
            <line key={`h-${index}`} x1="40" y1={58 + index * 68} x2="760" y2={58 + index * 68} stroke="#e2e8f0" strokeWidth={markerScale} />
          ))}
        </g>
        {rows.map((row) => {
          const active = row.anon_code === selectedCode;
          const x = toX(row.x);
          const y = toY(row.y);
          return (
            <g
              key={row.anon_code}
              onPointerDown={handlePointPointerDown}
              className="city-point"
            >
              <circle
                cx={x}
                cy={y}
                r={(active ? 11 : 7) * markerScale}
                fill={CASE_COLORS[row.case_type] ?? "#64748b"}
                stroke={active ? "#fff" : "rgba(255,255,255,0.45)"}
                strokeWidth={(active ? 3 : 1) * markerScale}
                onPointerDown={handlePointPointerDown}
              />
              {active ? (
                <text
                  x={x + 14 * markerScale}
                  y={y + 4 * markerScale}
                  fill="#f8fafc"
                  fontSize={12 * markerScale}
                  fontWeight="800"
                  onPointerDown={handlePointPointerDown}
                >
                  {row.short_label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
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

function Overview({
  statistics,
  schools,
  selectedGu,
  onSelectGu,
  onSelect,
}: {
  statistics: StatisticsPayload;
  schools: School[];
  selectedGu: string;
  onSelectGu: (gu: string) => void;
  onSelect: (code: string) => void;
}) {
  const selectedDistrict = statistics.districts.find((district) => district.gu === selectedGu) ?? statistics.districts[0];
  const maxPressure = Math.max(...statistics.districts.map((district) => district.urgent_count * 1.4 + district.priority_count), 1);
  const maxDemand = Math.max(...statistics.districts.map((district) => district.top_priority.reduce((sum, school) => sum + school.potential_demand_2029, 0)), 1);
  const cityTopSchools = [...schools]
    .sort((left, right) => {
      const leftClass = left.case_type === 1 ? 0 : left.case_type === 2 ? 1 : left.case_type === 3 ? 2 : 3;
      const rightClass = right.case_type === 1 ? 0 : right.case_type === 2 ? 1 : right.case_type === 3 ? 2 : 3;
      return leftClass - rightClass || left.priority_rank - right.priority_rank;
    })
    .slice(0, 10);

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
        <Kpi title="우선 검토" value={metricLabel(statistics.summary.priority_count, "개교")} />
        <Kpi title="2029 잠재 수요" value={metricLabel(statistics.summary.potential_demand_2029, "명")} />
      </section>

      <section className="statistics-grid">
        <article className="panel-card">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">District Pressure</p>
              <h3>구별 우선 지원 압력</h3>
            </div>
            <span>즉시 개선 + 우선 검토</span>
          </div>
          <div className="pressure-list">
            {statistics.districts.map((district) => {
              const pressure = district.urgent_count * 1.4 + district.priority_count;
              const isActive = selectedDistrict?.gu === district.gu;
              return (
                <button
                  className={isActive ? "pressure-row active" : "pressure-row"}
                  key={district.gu}
                  type="button"
                  onClick={() => onSelectGu(district.gu)}
                >
                  <span>{district.gu}</span>
                  <strong>{district.urgent_count + district.priority_count}개교</strong>
                  <i style={{ width: `${Math.max(8, (pressure / maxPressure) * 100)}%` }} />
                </button>
              );
            })}
          </div>
        </article>

        <article className="panel-card">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">District Mix</p>
              <h3>구별 2029 잠재 수요</h3>
            </div>
            <span>Top 학교 합계 기준</span>
          </div>
          <div className="demand-bars">
            {statistics.districts.map((district) => {
              const demand = district.top_priority.reduce((sum, school) => sum + school.potential_demand_2029, 0);
              return (
                <button
                  className={selectedDistrict?.gu === district.gu ? "demand-bar active" : "demand-bar"}
                  key={district.gu}
                  type="button"
                  onClick={() => onSelectGu(district.gu)}
                >
                  <span>{district.gu}</span>
                  <i style={{ height: `${Math.max(10, (demand / maxDemand) * 100)}%` }} />
                  <strong>{formatNumber(demand)}명</strong>
                </button>
              );
            })}
          </div>
        </article>
      </section>

      {selectedDistrict ? (
        <section className="statistics-grid">
          <article className="panel-card">
            <div className="panel-title-row">
              <div>
                <p className="eyebrow">District Detail</p>
                <h3>{selectedDistrict.gu} 상세 통계</h3>
              </div>
              <span>{selectedDistrict.school_count}개교</span>
            </div>
            <div className="district-stat-grid">
              <MetricLine label="즉시 개선" value={`${selectedDistrict.urgent_count}개교`} alert={selectedDistrict.urgent_count > 0} />
              <MetricLine label="우선 검토" value={`${selectedDistrict.priority_count}개교`} alert={selectedDistrict.priority_count > 0} />
              <MetricLine label="평균 최근접 공원" value={`${formatDecimal(selectedDistrict.avg_nearest_park_dist_m)}m`} />
              <MetricLine label="평균 녹지" value={`${formatDecimal(selectedDistrict.avg_green_ratio)}%`} />
            </div>
          </article>

          <article className="panel-card">
            <div className="panel-title-row">
              <div>
                <p className="eyebrow">Top 5</p>
                <h3>{selectedDistrict.gu} 우선 지원 학교</h3>
              </div>
              <span>비식별 코드</span>
            </div>
            <div className="top-list rich">
              {selectedDistrict.top_priority.map((school, index) => (
                <button key={school.anon_code} type="button" onClick={() => onSelect(school.anon_code)}>
                  <span className="rank-badge">{index + 1}</span>
                  <span>
                    <strong>{school.display_name}</strong>
                    <small>{school.case_policy_label} · 공원 {formatDecimal(school.nearest_park_dist_m)}m · 2029 {formatNumber(school.potential_demand_2029)}명</small>
                  </span>
                </button>
              ))}
            </div>
          </article>
        </section>
      ) : null}

      <section className="panel-card">
        <div className="panel-title-row">
          <div>
            <p className="eyebrow">City Top 10</p>
            <h3>시 전체 우선 지원 학교</h3>
          </div>
          <span>상세 이동 가능</span>
        </div>
        <div className="city-top-list">
          {cityTopSchools.map((school, index) => (
            <button key={school.anon_code} type="button" onClick={() => onSelect(school.anon_code)}>
              <span className="rank-badge">{index + 1}</span>
              <span>
                <strong>{school.display_name}</strong>
                <small>{school.gu} · {school.case_policy_label} · 공원 {formatDecimal(school.metrics.nearest_park_dist_m)}m · 2029 {formatNumber(school.metrics.potential_demand_2029)}명</small>
              </span>
              <em>{school.case_status_label}</em>
            </button>
          ))}
        </div>
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
    <div className="page-grid detail-report">
      <section className="hero-band compact detail-report-hero">
        <div className="report-title-block">
          <p className="eyebrow">School Detail Report</p>
          <h2>{school.display_name}</h2>
          <p className="report-lead">
            현재 생활권 격차, 미래 수요, 접근 마찰, KNN 비교군을 한 화면에서 연결해 정책 검토 순서를 제안합니다.
          </p>
          <div className="badge-row">
            <span style={{ backgroundColor: CASE_COLORS[school.case_type] ?? "#64748b" }}>{school.case_policy_label}</span>
            <span>{school.case_status_label}</span>
            <span>{school.gu} · {school.short_label}</span>
          </div>
        </div>
        <div className="report-hero-metrics" aria-label="핵심 요약">
          <div>
            <span>최근접 공원</span>
            <strong>{metricLabel(metrics.nearest_park_dist_m, "m")}</strong>
          </div>
          <div>
            <span>2029 잠재 수요</span>
            <strong>{metricLabel(metrics.potential_demand_2029, "명")}</strong>
          </div>
          <div>
            <span>후보지</span>
            <strong>{candidateCount}곳</strong>
          </div>
        </div>
      </section>

      <section className="report-profile-grid" aria-label="상세 리포트 요약">
        <article className="profile-card">
          <p className="eyebrow">Profile</p>
          <h3>진단 대상</h3>
          <div className="profile-row"><span>비식별 코드</span><strong>{school.display_name}</strong></div>
          <div className="profile-row"><span>구 단위</span><strong>{school.gu}</strong></div>
          <div className="profile-row"><span>정책 상태</span><strong>{school.case_status_label}</strong></div>
        </article>
        <article className="profile-card">
          <p className="eyebrow">Living Area</p>
          <h3>생활권 현황</h3>
          <div className="profile-row"><span>활동규모 공원</span><strong>{metrics.functional_park_count_500m}개</strong></div>
          <div className="profile-row"><span>도보권 놀이터</span><strong>{metrics.playground_count_500m}개</strong></div>
          <div className="profile-row"><span>녹지 비율</span><strong>{formatDecimal(metrics.green_ratio)}%</strong></div>
        </article>
        <article className="profile-card action-card">
          <p className="eyebrow">Next Action</p>
          <h3>검토 액션</h3>
          <p>
            후보지 추천은 자동 결정이 아니라 현장 검토 전 비교 신호입니다. 필터와 가중치를 조정해 같은 학교의 대안을 비교합니다.
          </p>
          <button className="primary-action" type="button" onClick={onOpenSimulation}>
            후보지 시뮬레이션 열기
          </button>
        </article>
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
          <p className="eyebrow">Trend</p>
          <h3>학생 수 추세</h3>
          <TrendBar trend={school.trend} />
        </article>
      </section>

      <SimilarSchoolsSection school={school} />

      <section className="report-action-row">
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

function getSimilarityPercent(distance: number) {
  return Math.max(1, Math.min(99, Math.round(100 / (1 + distance))));
}

function SimilarSchoolsSection({ school }: { school: School }) {
  const peers = school.similar_schools;
  const avgPark = peers.length ? peers.reduce((sum, peer) => sum + peer.nearest_park_dist_m, 0) / peers.length : 0;
  const avgGreen = peers.length ? peers.reduce((sum, peer) => sum + peer.green_ratio, 0) / peers.length : 0;
  const avgPlayground = peers.length ? peers.reduce((sum, peer) => sum + peer.playground_count, 0) / peers.length : 0;

  return (
    <article className="panel-card knn-panel">
      <div className="panel-title-row">
        <div>
          <p className="eyebrow">Benchmark</p>
          <h3>KNN 유사학교 비교</h3>
        </div>
        <span className="subtle-badge">유사학교 {peers.length}개</span>
      </div>
      {peers.length ? (
        <div className="knn-grid">
          <div className="knn-card">
            <div className="knn-card-head">
              <strong>KNN 비교군 및 현재 위치</strong>
              <span>좋은 방향은 왼쪽 위</span>
            </div>
            <KnnPositionChart school={school} peers={peers} avgPark={avgPark} avgGreen={avgGreen} />
            <div className="knn-average-grid">
              <span>비교군 평균 공원 <strong>{formatNumber(avgPark)}m</strong></span>
              <span>녹지 <strong>{formatDecimal(avgGreen)}%</strong></span>
              <span>놀이터 <strong>{formatDecimal(avgPlayground)}개</strong></span>
            </div>
            <div className="similarity-list">
              {peers.map((peer) => (
                <SimilarityBar
                  key={peer.anon_code}
                  label={`${peer.rank}. ${peer.display_name}`}
                  districtName={peer.gu}
                  percent={getSimilarityPercent(peer.distance)}
                />
              ))}
            </div>
          </div>
          <div className="knn-side">
            <KnnTextCard title="공통점" items={school.similarity_common_points} empty="집계된 공통점 없음" />
            <KnnTextCard title="상대 강점" items={school.relative_strengths} empty="두드러진 상대 강점 없음" tone="green" />
            <KnnTextCard title="상대 약점" items={school.relative_weaknesses} empty="집계된 상대 약점 없음" tone="red" />
          </div>
        </div>
      ) : (
        <p className="note">표시 가능한 비식별 유사학교가 없습니다.</p>
      )}
    </article>
  );
}

function KnnPositionChart({
  school,
  peers,
  avgPark,
  avgGreen,
}: {
  school: School;
  peers: School["similar_schools"];
  avgPark: number;
  avgGreen: number;
}) {
  const metrics = school.metrics;
  const width = 760;
  const height = 420;
  const margin = { top: 28, right: 28, bottom: 52, left: 62 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxPark = Math.max(1200, metrics.nearest_park_dist_m, avgPark, ...peers.map((peer) => peer.nearest_park_dist_m));
  const maxGreen = Math.max(24, metrics.green_ratio, avgGreen, ...peers.map((peer) => peer.green_ratio));
  const xMax = Math.ceil(maxPark / 300) * 300;
  const yMax = Math.ceil(maxGreen / 5) * 5;
  const parkThreshold = 500;
  const greenThreshold = 5;
  const scaleX = (value: number) => margin.left + (Math.min(value, xMax) / xMax) * chartWidth;
  const scaleY = (value: number) => margin.top + chartHeight - (Math.min(value, yMax) / yMax) * chartHeight;
  const xTicks = [0, Math.round(xMax * 0.25), Math.round(xMax * 0.5), Math.round(xMax * 0.75), xMax];
  const yTicks = [0, Math.round(yMax * 0.25), Math.round(yMax * 0.5), Math.round(yMax * 0.75), yMax];

  return (
    <div className="knn-position-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="KNN 유사학교 위치 그래프">
        <rect width={width} height={height} fill="#050b14" />
        <rect x={margin.left} y={margin.top} width={Math.max(0, scaleX(parkThreshold) - margin.left)} height={Math.max(0, scaleY(greenThreshold) - margin.top)} fill="rgba(16, 185, 129, 0.12)" />
        <rect x={scaleX(parkThreshold)} y={margin.top} width={Math.max(0, margin.left + chartWidth - scaleX(parkThreshold))} height={Math.max(0, scaleY(greenThreshold) - margin.top)} fill="rgba(251, 191, 36, 0.09)" />
        <rect x={margin.left} y={scaleY(greenThreshold)} width={Math.max(0, scaleX(parkThreshold) - margin.left)} height={Math.max(0, margin.top + chartHeight - scaleY(greenThreshold))} fill="rgba(251, 191, 36, 0.08)" />
        <rect x={scaleX(parkThreshold)} y={scaleY(greenThreshold)} width={Math.max(0, margin.left + chartWidth - scaleX(parkThreshold))} height={Math.max(0, margin.top + chartHeight - scaleY(greenThreshold))} fill="rgba(248, 113, 113, 0.12)" />
        {xTicks.map((tick) => (
          <g key={`x-${tick}`}>
            <line x1={scaleX(tick)} x2={scaleX(tick)} y1={margin.top} y2={margin.top + chartHeight} stroke="rgba(148, 163, 184, 0.2)" strokeDasharray="3 3" />
            <text x={scaleX(tick)} y={height - 18} textAnchor="middle" fontSize="11" fill="#94a3b8">{formatNumber(tick)}</text>
          </g>
        ))}
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line x1={margin.left} x2={margin.left + chartWidth} y1={scaleY(tick)} y2={scaleY(tick)} stroke="rgba(148, 163, 184, 0.2)" strokeDasharray="3 3" />
            <text x={margin.left - 12} y={scaleY(tick) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{tick}</text>
          </g>
        ))}
        <line x1={scaleX(parkThreshold)} x2={scaleX(parkThreshold)} y1={margin.top} y2={margin.top + chartHeight} stroke="rgba(255,255,255,0.35)" strokeDasharray="6 5" />
        <line x1={margin.left} x2={margin.left + chartWidth} y1={scaleY(greenThreshold)} y2={scaleY(greenThreshold)} stroke="rgba(255,255,255,0.35)" strokeDasharray="6 5" />
        <text x={scaleX(parkThreshold) + 8} y={height - 34} fontSize="11" fontWeight="700" fill="#cbd5e1">500m 판단선</text>
        <text x={margin.left + 8} y={scaleY(greenThreshold) - 10} fontSize="11" fontWeight="700" fill="#cbd5e1">녹지 5%</text>
        <text x={margin.left + 10} y={margin.top + 18} fontSize="12" fontWeight="800" fill="#6ee7b7">생활환경 양호</text>
        <text x={margin.left + chartWidth - 120} y={margin.top + 18} fontSize="12" fontWeight="800" fill="#facc15">공원 접근 불리</text>
        <text x={margin.left + 10} y={margin.top + chartHeight - 12} fontSize="12" fontWeight="800" fill="#facc15">녹지 부족</text>
        <text x={margin.left + chartWidth - 76} y={margin.top + chartHeight - 12} fontSize="12" fontWeight="800" fill="#fca5a5">이중 취약</text>
        {peers.map((peer) => (
          <g key={peer.anon_code}>
            <circle cx={scaleX(peer.nearest_park_dist_m)} cy={scaleY(peer.green_ratio)} r={12} fill="#475569" stroke="#ffffff" strokeWidth={2.5} />
            <text x={scaleX(peer.nearest_park_dist_m)} y={scaleY(peer.green_ratio) + 4} textAnchor="middle" fontSize="9" fontWeight="800" fill="#f8fafc">
              K{peer.rank}
            </text>
          </g>
        ))}
        <g>
          <circle cx={scaleX(metrics.nearest_park_dist_m)} cy={scaleY(metrics.green_ratio)} r={17} fill="#ef4444" opacity={0.2} />
          <circle cx={scaleX(metrics.nearest_park_dist_m)} cy={scaleY(metrics.green_ratio)} r={10} fill="#dc2626" stroke="#ffffff" strokeWidth={3} />
          <text x={scaleX(metrics.nearest_park_dist_m) + 15} y={scaleY(metrics.green_ratio) - 12} fontSize="11" fontWeight="800" fill="#fecaca">현재 학교</text>
        </g>
        <g>
          <path d={`M ${scaleX(avgPark)} ${scaleY(avgGreen) - 11} L ${scaleX(avgPark) + 11} ${scaleY(avgGreen)} L ${scaleX(avgPark)} ${scaleY(avgGreen) + 11} L ${scaleX(avgPark) - 11} ${scaleY(avgGreen)} Z`} fill="#38bdf8" stroke="#ffffff" strokeWidth={2.5} />
          <text x={scaleX(avgPark) + 15} y={scaleY(avgGreen) + 4} fontSize="11" fontWeight="800" fill="#bae6fd">비교군 평균</text>
        </g>
        <text x={margin.left + chartWidth / 2} y={height - 2} textAnchor="middle" fontSize="12" fill="#94a3b8">최근접 공원 거리 (m)</text>
        <text transform={`translate(18 ${margin.top + chartHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="#94a3b8">녹지 비율 (%)</text>
      </svg>
    </div>
  );
}

function SimilarityBar({
  label,
  districtName,
  percent,
}: {
  label: string;
  districtName: string;
  percent: number;
}) {
  return (
    <div className="similarity-item">
      <div className="similarity-head">
        <div>
          <strong>{label}</strong>
          <span>{districtName}</span>
        </div>
        <em>{percent}%</em>
      </div>
      <div className="similarity-bar-track">
        <i style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function KnnTextCard({
  title,
  items,
  empty,
  tone = "default",
}: {
  title: string;
  items: string[];
  empty: string;
  tone?: "default" | "green" | "red";
}) {
  return (
    <div className="knn-mini-card">
      <strong>{title}</strong>
      <div className="knn-pill-row">
        {items.length ? items.map((item) => (
          <span className={`knn-pill ${tone}`} key={item}>{item}</span>
        )) : (
          <span className="knn-empty">{empty}</span>
        )}
      </div>
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
  const [mode, setMode] = useState<SimulationMode>("manual");
  const [filters, setFilters] = useState<SimulationFilters>(DEFAULT_SIMULATION_FILTERS);
  const [weights, setWeights] = useState<SimulationWeights>(DEFAULT_SIMULATION_WEIGHTS);
  const [weightToggles, setWeightToggles] = useState<SimulationWeightToggles>(DEFAULT_WEIGHT_TOGGLES);
  const [selectedLabel, setSelectedLabel] = useState<string>("");
  const effectiveWeights = applyWeightToggles(weights, weightToggles);
  const filteredCandidates = school.candidates.filter((candidate) => passesSimulationFilters(candidate, filters));
  const rankedCandidates = scoreCandidates(filteredCandidates, effectiveWeights);
  const aiCandidates = scoreCandidates(
    school.candidates.filter((candidate) => passesSimulationFilters(candidate, AI_SIMULATION_FILTERS)),
    AI_SIMULATION_WEIGHTS,
  ).slice(0, 3);
  const displayedCandidates = mode === "ai" ? aiCandidates : rankedCandidates;
  const selectedCandidate = displayedCandidates.find((candidate) => candidate.label === selectedLabel) ?? displayedCandidates[0] ?? null;
  const normalizedWeights = normalizeSimulationWeights(effectiveWeights);
  const activeFilterSummary = buildFilterSummary(mode === "ai" ? AI_SIMULATION_FILTERS : filters);

  const setFilter = (key: keyof SimulationFilters, value: boolean) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setMode("manual");
    setSelectedLabel("");
  };

  const setWeight = (key: keyof SimulationWeights, value: number) => {
    setWeights((current) => ({ ...current, [key]: value }));
    setMode("manual");
    setSelectedLabel("");
  };

  const setWeightToggle = (key: keyof SimulationWeights, value: boolean) => {
    setWeightToggles((current) => ({ ...current, [key]: value }));
    setMode("manual");
    setSelectedLabel("");
  };

  const applyAiMode = () => {
    setMode("ai");
    setFilters(AI_SIMULATION_FILTERS);
    setWeights(AI_SIMULATION_WEIGHTS);
    setWeightToggles(DEFAULT_WEIGHT_TOGGLES);
    setSelectedLabel("");
  };

  const applyManualMode = () => {
    setMode("manual");
    setFilters(DEFAULT_SIMULATION_FILTERS);
    setWeights(DEFAULT_SIMULATION_WEIGHTS);
    setWeightToggles(DEFAULT_WEIGHT_TOGGLES);
    setSelectedLabel("");
  };

  return (
    <div className="page-grid simulation-workspace">
      <section className="hero-band compact simulation-hero">
        <div>
          <p className="eyebrow">Human-in-the-loop Simulation</p>
          <h2>{school.display_name}</h2>
          <p>후보지는 실제 좌표 대신 학교 중심 상대거리와 보행 부담만 표시합니다. 자동 추천은 결정이 아니라 비교 후보를 좁히는 보조 신호입니다.</p>
          <div className="badge-row">
            <span style={{ backgroundColor: CASE_COLORS[school.case_type] ?? "#64748b" }}>{school.case_policy_label}</span>
            <span>{school.case_status_label}</span>
            <span>{school.gu} · {school.short_label}</span>
          </div>
        </div>
        <div className="simulation-hero-summary">
          <div><span>전체 후보</span><strong>{school.candidates.length}곳</strong></div>
          <div><span>현재 표시</span><strong>{displayedCandidates.length}곳</strong></div>
          <div><span>선택 모드</span><strong>{mode === "ai" ? "AI 추천" : "직접 설정"}</strong></div>
        </div>
      </section>

      <section className="simulation-map-section">
        <article className="panel-card simulation-map-card">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Route Map</p>
              <h3>후보지 경로 도식지도</h3>
            </div>
            <span>학교 중심 상대거리</span>
          </div>
          <SyntheticMap mapData={school.synthetic_map} highlightCandidates selectedCandidateLabel={selectedCandidate?.label} />
        </article>
      </section>

      <section className="simulation-grid simulation-setup-grid">
        <article className="panel-card simulation-controls">
          <div className="mode-toggle" role="group" aria-label="시뮬레이션 모드">
            <button className={mode === "ai" ? "active" : ""} type="button" onClick={applyAiMode}>AI 추천</button>
            <button className={mode === "manual" ? "active" : ""} type="button" onClick={applyManualMode}>직접 설정</button>
          </div>
          <div className="simulation-note">
            <strong>{mode === "ai" ? "AI 추천 기준" : "직접 설정 기준"}</strong>
            <span>{activeFilterSummary.length ? activeFilterSummary.join(" · ") : "제외 조건 없음"} · 가중치 {Math.round(normalizedWeights.benefit * 100)}/{Math.round(normalizedWeights.route * 100)}/{Math.round(normalizedWeights.parkGap * 100)}</span>
          </div>

          <div className="control-section">
            <h3>제외 조건</h3>
            <div className="filter-list">
              {FILTER_OPTIONS.map((option) => (
                <label key={option.key} className="filter-option">
                  <input
                    type="checkbox"
                    checked={filters[option.key]}
                    onChange={(event) => setFilter(option.key, event.target.checked)}
                  />
                  <span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="control-section">
            <h3>가중치</h3>
            <div className="weight-list">
              {WEIGHT_OPTIONS.map((option) => (
                <div key={option.key} className="weight-option">
                  <label>
                    <input
                      type="checkbox"
                      checked={weightToggles[option.key]}
                      onChange={(event) => setWeightToggle(option.key, event.target.checked)}
                    />
                    <span>{option.title}</span>
                    <strong>{weights[option.key]}</strong>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={weights[option.key]}
                    disabled={!weightToggles[option.key]}
                    onChange={(event) => setWeight(option.key, Number(event.target.value))}
                    aria-label={option.title}
                  />
                  <small>{option.description}</small>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="panel-card simulation-explain-card">
          <p className="eyebrow">Decision Support</p>
          <h3>추천 결과 읽는 법</h3>
          <div className="policy-flow">
            <div>
              <strong>1. 후보 위치</strong>
              <span>지도에서 학교와 후보지의 상대거리, 단절요소, 기존 공원과의 관계를 먼저 봅니다.</span>
            </div>
            <div>
              <strong>2. 조건 조정</strong>
              <span>간선도로, 재개발, 실행가능성 조건을 바꿔 남는 후보가 어떻게 달라지는지 확인합니다.</span>
            </div>
            <div>
              <strong>3. 후보 상세</strong>
              <span>수요, 학교 거리, 기존 공원 거리, 단절요소를 함께 보고 현장 검토 대상을 좁힙니다.</span>
            </div>
          </div>
        </article>
      </section>

      <section className="simulation-metric-strip" aria-label="시뮬레이션 요약">
        <div><span>필터 적용 전</span><strong>{school.candidates.length}곳</strong></div>
        <div><span>{mode === "ai" ? "AI 추천 후보" : "조건 통과 후보"}</span><strong>{displayedCandidates.length}곳</strong></div>
        <div><span>수요/접근/공백</span><strong>{Math.round(normalizedWeights.benefit * 100)}/{Math.round(normalizedWeights.route * 100)}/{Math.round(normalizedWeights.parkGap * 100)}</strong></div>
        <div><span>선택 후보</span><strong>{selectedCandidate?.label ?? "없음"}</strong></div>
      </section>

      <section className="simulation-grid simulation-results-grid">
        <article className="panel-card">
          <div className="panel-title-row">
            <h3>{mode === "ai" ? "AI 추천 후보" : "후보 순위"}</h3>
            <span>{displayedCandidates.length}/{school.candidates.length}곳 표시</span>
          </div>
          <div className="candidate-list">
            {displayedCandidates.length ? displayedCandidates.slice(0, 6).map((candidate, index) => (
              <button
                className={selectedCandidate?.label === candidate.label ? "candidate-card selected" : "candidate-card"}
                key={candidate.label}
                type="button"
                onClick={() => setSelectedLabel(candidate.label)}
              >
                <div className="rank-badge">{index + 1}</div>
                <div>
                  <div className="candidate-heading">
                    <strong>{candidate.label}</strong>
                    <span>{formatScore(candidate.final_score)}</span>
                  </div>
                  <p>2029 잠재수혜 {formatNumber(candidate.walkshed_beneficiary_2029)}명 · 경로 {formatDistance(candidate.route_length_m)}</p>
                  <small>단절요소 {candidate.barrier_label} · 기존 공원 {formatDistance(candidate.nearest_park_dist_m)}</small>
                  <div className="score-pills">
                    <span>수요 {formatScore(candidate.benefit_score)}</span>
                    <span>접근 {formatScore(candidate.route_score)}</span>
                    <span>공백 {formatScore(candidate.park_gap_score)}</span>
                  </div>
                </div>
              </button>
            )) : <p className="note">표시 가능한 비식별 후보지가 없습니다.</p>}
          </div>
        </article>

        <article className="panel-card candidate-detail">
          <h3>후보 상세</h3>
          {selectedCandidate ? (
            <>
              <div className="detail-head">
                <span>{selectedCandidate.label}</span>
                <strong>{formatScore(selectedCandidate.final_score)}</strong>
              </div>
              <div className="detail-metrics">
                <MetricLine label="2029 잠재수혜" value={`${formatNumber(selectedCandidate.walkshed_beneficiary_2029)}명`} />
                <MetricLine label="2031 잠재수혜" value={`${formatNumber(selectedCandidate.walkshed_beneficiary_2031)}명`} />
                <MetricLine label="학교 경로거리" value={formatDistance(selectedCandidate.route_length_m)} alert={selectedCandidate.route_score < 0.35} />
                <MetricLine label="기존 공원 거리" value={formatDistance(selectedCandidate.nearest_park_dist_m)} />
                <MetricLine label="놀이터 거리" value={formatDistance(selectedCandidate.nearest_playground_dist_m)} />
                <MetricLine label="실행가능성" value={selectedCandidate.land_feasibility_level} alert={selectedCandidate.land_feasibility_level === "low"} />
                <MetricLine label="단절요소" value={`주 ${selectedCandidate.barrier_counts.primary} · 중 ${selectedCandidate.barrier_counts.secondary} · 일반 ${selectedCandidate.barrier_counts.tertiary}`} alert={selectedCandidate.barrier_counts.primary + selectedCandidate.barrier_counts.secondary > 0} />
                <MetricLine label="재개발 영향" value={selectedCandidate.redev_flag ? "있음" : "없음"} alert={selectedCandidate.redev_flag} />
              </div>
              <div className="reason-list">
                {buildCandidateReasons(selectedCandidate).map((reason) => <span key={reason}>{reason}</span>)}
              </div>
            </>
          ) : (
            <p className="note">후보를 선택하면 수요, 학교 거리, 기존 공원 거리, 단절요소 요약을 표시합니다.</p>
          )}
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
  selectedCandidateLabel,
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
  selectedCandidateLabel?: string;
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
            stroke={point.label === selectedCandidateLabel ? "#1d4ed8" : "#94a3b8"}
            strokeWidth={point.label === selectedCandidateLabel ? "5" : "3"}
            strokeDasharray={point.label === selectedCandidateLabel ? "0" : "8 8"}
          />
        ))}
        {points.map((point) => {
          const color = POINT_COLORS[point.kind];
          const x = toSvg(point.x_m);
          const y = toSvg(-point.y_m);
          const isSchool = point.kind === "school";
          return (
            <g key={`${point.kind}-${point.label}`} transform={`translate(${x} ${y})`}>
              <circle
                r={point.label === selectedCandidateLabel ? 18 : isSchool ? 18 : 13}
                fill={color}
                opacity={point.kind === "redevelopment" ? 0.82 : 1}
                stroke={point.label === selectedCandidateLabel ? "#f8fafc" : "none"}
                strokeWidth={point.label === selectedCandidateLabel ? 4 : 0}
              />
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
