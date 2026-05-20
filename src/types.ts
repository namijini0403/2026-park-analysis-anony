export type MapPointKind = "school" | "park" | "apartment" | "redevelopment" | "candidate";

export type SyntheticMapPoint = {
  label: string;
  kind: MapPointKind;
  x_m: number;
  y_m: number;
  distance_m: number;
  households_bucket?: string;
  stage?: string;
};

export type Candidate = {
  label: string;
  walkshed_beneficiary_2029: number;
  walkshed_beneficiary_2031: number;
  nearest_park_dist_m: number;
  nearest_playground_dist_m: number;
  land_feasibility_level: string;
  redev_flag: boolean;
  route_length_m: number;
  barrier_label: string;
  barrier_counts: {
    primary: number;
    secondary: number;
    tertiary: number;
  };
};

export type SimilarSchool = {
  rank: number;
  anon_code: string;
  display_name: string;
  gu: string;
  nearest_park_dist_m: number;
  green_ratio: number;
  playground_count: number;
};

export type School = {
  anon_code: string;
  display_name: string;
  short_label: string;
  gu: string;
  case_type: number;
  case_policy_label: string;
  case_status_label: string;
  priority_rank: number;
  metrics: {
    nearest_park_dist_m: number;
    official_park_count_500m: number;
    functional_park_count_500m: number;
    playground_count_500m: number;
    green_ratio: number;
    current_students_2025: number;
    potential_demand_2029: number;
    potential_demand_2031: number;
  };
  trend: Array<{ year: number; students: number }>;
  similar_schools: SimilarSchool[];
  candidates: Candidate[];
  synthetic_map: {
    note: string;
    points: SyntheticMapPoint[];
  };
};

export type SchoolsPayload = {
  generated_at: string;
  schools: School[];
};

export type StatisticsPayload = {
  generated_at: string;
  summary: {
    school_count: number;
    district_count: number;
    urgent_count: number;
    priority_count: number;
    potential_demand_2029: number;
  };
  districts: Array<{
    gu: string;
    school_count: number;
    urgent_count: number;
    priority_count: number;
    avg_nearest_park_dist_m: number;
    avg_green_ratio: number;
    top_priority: Array<{
      anon_code: string;
      display_name: string;
      case_policy_label: string;
      nearest_park_dist_m: number;
      potential_demand_2029: number;
    }>;
  }>;
};
