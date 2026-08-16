/**
 * 共通テスト fixture。
 *
 * 各 page / component テストで個別に宣言されていた Department / Employee /
 * WorkPattern / Schedule などのサンプルデータを集約。
 *
 * - 直接使うか、`{ ...EMP, name: 'Bob' }` の形で派生させる
 * - 型は `types/api` に依存。プロダクション側の interface 変更で
 *   ここがコンパイル失敗 → 影響範囲が一目で分かる
 */
import type {
  DayOverride,
  DayTemplate,
  Department,
  Employee,
  PatternChoiceGroup,
  PatternIncompatibility,
  PatternTrigger,
  Schedule,
  WorkPattern,
  WorkPatternGroup,
} from '../types/api'

export const DEPT: Department = {
  id: 1,
  name: '本店',
  created_at: '',
  updated_at: '',
}

export const DEPT2: Department = {
  id: 2,
  name: '支店',
  created_at: '',
  updated_at: '',
}

export const EMP_ALICE: Employee = {
  id: 1,
  employee_number: 1001,
  department_id: 1,
  name: 'Alice',
  role: 'STAFF',
  available_days: '0,1,2,3,4,5,6',
  available_shift_types: '1,2,3',
  consecutive_workable: true,
  sort_order: 0,
}

export const EMP_BOB: Employee = {
  id: 2,
  employee_number: 1002,
  department_id: 1,
  name: 'Bob',
  role: 'CHIEF',
  available_days: '1,2,3,4,5',
  available_shift_types: '2',
  consecutive_workable: false,
  sort_order: 1,
}

export const PATTERN_A1: WorkPattern = {
  id: 100,
  group_id: 10,
  department_id: 1,
  pattern_name: 'A1',
  shift_type: 2,
  shift_start: '09:00',
  shift_end: '18:00',
  sort_order: 0,
  is_auxiliary: false,
}

export const PATTERN_A2: WorkPattern = {
  id: 101,
  group_id: 10,
  department_id: 1,
  pattern_name: 'A2',
  shift_type: 1,
  shift_start: '07:00',
  shift_end: '15:00',
  sort_order: 1,
  is_auxiliary: false,
}

export const PATTERN_B2: WorkPattern = {
  id: 200,
  group_id: 20,
  department_id: 1,
  pattern_name: 'B2',
  shift_type: 1,
  shift_start: '07:00',
  shift_end: '15:00',
  sort_order: 0,
  is_auxiliary: false,
}

export const GROUP_A: WorkPatternGroup = {
  id: 10,
  department_id: 1,
  name: 'A',
  sort_order: 0,
  is_auxiliary: false,
}

export const GROUP_B: WorkPatternGroup = {
  id: 20,
  department_id: 1,
  name: 'B',
  sort_order: 1,
  is_auxiliary: true,
}

export const DAY_TEMPLATE_MON: DayTemplate = {
  id: 11,
  department_id: 1,
  day_of_week: 0,
  pattern_id: 100,
  required_min: 1,
  required_max: null,
  sort_order: 0,
}

export const DAY_TEMPLATE_THU: DayTemplate = {
  id: 12,
  department_id: 1,
  day_of_week: 3,
  pattern_id: 101,
  required_min: 2,
  required_max: null,
  sort_order: 1,
}

export const DAY_OVERRIDE_HOLIDAY: DayOverride = {
  id: 21,
  department_id: 1,
  specific_date: '2026-05-03',
  pattern_id: 100,
  required_min: 3,
  required_max: null,
  sort_order: 0,
}

export const CHOICE_GROUP_DAILY: PatternChoiceGroup = {
  id: 31,
  department_id: 1,
  day_of_week: null,
  min_count: 1,
  max_count: 1,
  candidate_pattern_ids: [100, 101],
  sort_order: 0,
}

export const CHOICE_GROUP_THU: PatternChoiceGroup = {
  id: 32,
  department_id: 1,
  day_of_week: 3,
  min_count: 0,
  max_count: 2,
  candidate_pattern_ids: [200],
  sort_order: 1,
}

export const INCOMPAT_AB: PatternIncompatibility = {
  id: 41,
  department_id: 1,
  pattern_id_a: 100,
  pattern_id_b: 200,
  sort_order: 0,
}

export const GROUP_C_REQ: WorkPatternGroup = {
  id: 30,
  department_id: 1,
  name: 'C',
  sort_order: 2,
  is_auxiliary: false,
}

export const GROUP_AUX: WorkPatternGroup = {
  id: 40,
  department_id: 1,
  name: 'AUX',
  sort_order: 3,
  is_auxiliary: true,
}

export const PATTERN_TRIGGER_AUX_AC: PatternTrigger = {
  id: 51,
  department_id: 1,
  auxiliary_group_id: 40,
  required_group_ids: [10, 30],
  sort_order: 0,
}

/**
 * Schedule fixture。テストごとに year/month を上書きできるよう
 * 関数で返す。
 */
export function makeSchedule(over: Partial<Schedule> = {}): Schedule {
  return {
    id: 1,
    department_id: 1,
    year: 2026,
    month: 4,
    status: 'GENERATED',
    generation_attempt: 1,
    is_active: false,
    diagnosis: null,
    created_at: '',
    started_at: null,
    finished_at: null,
    time_limit: 120,
    ...over,
  }
}
