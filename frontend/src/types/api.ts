export type ScheduleStatus =
  | 'DRAFT'
  | 'GENERATING'
  | 'GENERATED'
  | 'PARTIAL'
  | 'INFEASIBLE'
  | 'CANCELLED'
  | 'PUBLISHED'

export interface ShortageRow {
  day: number
  pattern_id: number
  pattern_name: string
  required: number
  assigned: number
  missing: number
}

// 役職コード。issue #173 でマスタ化されたため、文字列全般を許容する。
// デフォルトは CHIEF/DEPUTY/STAFF/FULLPART/MORNINGPART だがユーザーが新規追加可能。
export type EmployeeRole = string

// ------------------------------------------------------------------ //
// Role (issue #173 役職マスタ)
// ------------------------------------------------------------------ //

export interface Role {
  code: string
  name: string
  order_index: number
  rest_days_28_29: number
  rest_days_30: number
  rest_days_31: number
}

export interface RoleCreate {
  code: string
  name: string
  rest_days_28_29: number
  rest_days_30: number
  rest_days_31: number
}

export interface RoleUpdate {
  name: string
  rest_days_28_29: number
  rest_days_30: number
  rest_days_31: number
}

// ------------------------------------------------------------------ //
// User (issue #141 アカウントの権限管理)
// ------------------------------------------------------------------ //

export interface User {
  id: number
  email: string
  is_active: boolean
  is_admin: boolean
}

export interface UserCreate {
  email: string
  password: string
  is_active?: boolean
  is_admin?: boolean
}

export interface UserUpdate {
  email?: string
  password?: string
  is_active?: boolean
  is_admin?: boolean
}

export interface Employee {
  id: number
  employee_number: number
  department_id: number
  name: string
  role: EmployeeRole
  available_days: string
  available_shift_types: string
  consecutive_workable: boolean
  sort_order: number
}

export interface EmployeeCreate {
  employee_number: number
  department_id: number
  name: string
  role: EmployeeRole
  available_days: string
  available_shift_types: string
  consecutive_workable: boolean
}

export interface EmployeeUpdate {
  name?: string
  role?: EmployeeRole
  available_days?: string
  available_shift_types?: string
  consecutive_workable?: boolean
}

export interface EmployeeImportResult {
  created: number
  updated: number
  moved: number
  errors: string[]
}

export interface EmployeeUsage {
  assignment_count: number
  schedule_count: number
  leave_request_count: number
}

export interface EmployeePatternPriority {
  id: number
  employee_id: number
  pattern_id: number
  priority: number
}

export interface EmployeePatternPriorityCreate {
  employee_id: number
  pattern_id: number
  priority: number
}

export interface EmployeePatternPriorityUpdate {
  priority: number
}

export interface EmployeePriorityImportResult {
  created: number
  updated: number
  deleted: number
  skipped: number
  errors: string[]
}

export interface Department {
  id: number
  name: string
  created_at: string
  updated_at: string
}

export interface Schedule {
  id: number
  department_id: number
  year: number
  month: number
  status: ScheduleStatus
  generation_attempt: number
  is_active: boolean
  diagnosis: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  time_limit: number
  // issue #196: worker が solve 中に更新する heartbeat。null=未起動 or pre-#196 row。
  // backend 側で stale 判定 (status=GENERATING のまま heartbeat 古い) → INFEASIBLE flip。
  last_heartbeat_at?: string | null
  // PARTIAL 状態のとき backend が同梱する不足ポジ。
  shortages?: ShortageRow[] | null
  // PARTIAL 状態で全不足が手動編集で埋まったとき true。「シフトを確定」ボタンが有効化される。
  can_finalize?: boolean
}

export interface ImportResult {
  created: number
  skipped: number
  year: number
  month: number
}

export interface DayAssignment {
  day: number
  label: string
  // backend は構造化フィールドを直接返す（issue #91）。client は label 文字列の逆引きを行わない。
  // 表示用 label は引き続き返却される（grid セル描画用）。
  assignment_type?: AssignmentType | null
  pattern_id?: number | null
  leave_type?: LeaveType | null
}

export interface EmployeeRow {
  id: number
  name: string
  role: string
  days: DayAssignment[]
}

export interface AssignmentsResponse {
  year: number
  month: number
  employees: EmployeeRow[]
}

export type AssignmentType = 'WORK' | 'REST' | 'LEAVE'
export type LeaveType = 'REQUESTED' | 'TENTATIVE' | 'MANDATORY'

export interface LeaveRequest {
  id: number
  employee_id: number
  year: number
  month: number
  day: number
  leave_type: LeaveType
}

export interface LeaveRequestCreate {
  employee_id: number
  year: number
  month: number
  day: number
  leave_type: LeaveType
}

export interface LeaveRequestUpdate {
  leave_type: LeaveType
}

export interface WorkPatternGroup {
  id: number
  department_id: number
  name: string
  sort_order: number
  is_auxiliary: boolean
  color: string
}

export interface WorkPattern {
  id: number
  // API contract: non-null. Backend `WorkPattern.group_id` は NOT NULL かつ
  // FK CASCADE (`app/models/work_pattern.py`)、Pydantic create schema は
  // 必須フィールド。グループ無しのパターンは仕様上存在しない。`group_id`
  // を index key として `Map<number, number>` を組む callsite (例:
  // `frontend/src/components/shift/ShiftGrid.tsx`) はこの保証に依存している。
  group_id: number
  department_id: number
  pattern_name: string
  shift_type: number
  shift_start: string
  shift_end: string
  sort_order: number
  is_auxiliary: boolean
}

export interface WorkPatternGroupCreate {
  department_id: number
  name: string
  is_auxiliary?: boolean
  color?: string
}

export interface WorkPatternGroupUpdate {
  name?: string
  is_auxiliary?: boolean
  color?: string
}

export interface WorkPatternCreate {
  group_id: number
  pattern_name: string
  shift_type: number
  shift_start: string
  shift_end: string
}

export interface WorkPatternUpdate {
  pattern_name?: string
  shift_type?: number
  shift_start?: string
  shift_end?: string
}

export interface AssignmentPatchRequest {
  employee_id: number
  date: string
  assignment_type: AssignmentType
  pattern_id: number | null
  leave_type: LeaveType | null
}

export interface CellPatchResponse {
  employee_id: number
  day: number
  label: string
  assignment_type: AssignmentType
  pattern_id: number | null
  leave_type?: LeaveType | null
}

export interface BatchAssignmentPatchRequest {
  edits: AssignmentPatchRequest[]
  /** issue #245: ハード制約 (H8/H10/H11/H13) を無視して強制確定する。 */
  force?: boolean
}

/**
 * REST → WORK 遷移を batch PATCH で検出した際に backend が自動で返す代休候補。
 * issue #91: 旧 frontend で行っていた検知ロジックを backend に集約。
 */
export interface CompensatorySuggestion {
  employee_id: number
  target_date: string
  proposals: CompensatoryProposal[]
  additional_transition_count: number
}

export interface BatchAssignmentPatchResponse {
  results: CellPatchResponse[]
  compensatory_suggestion?: CompensatorySuggestion | null
}

export interface ConstraintErrorDetail {
  message: string
}

export interface CompensatoryProposal {
  date: string
  score: number
  reason: string
}

export interface CompensatoryProposalsResponse {
  proposals: CompensatoryProposal[]
}

/**
 * 単一セル編集の前後状態。undo / redo 用。
 * `prior` が null の場合は「空セル → 何か」で、undo は DELETE 相当ではなく
 * REST へ戻す運用にしない（現実には生成直後に全セル埋まる前提のため prior は常に存在する）。
 */
export interface EditDelta {
  employeeId: number
  day: number
  date: string
  prior: {
    assignmentType: AssignmentType
    patternId: number | null
    leaveType: LeaveType | null
    label: string
  }
  next: {
    assignmentType: AssignmentType
    patternId: number | null
    leaveType: LeaveType | null
    label: string
  }
}

export interface CellState {
  assignmentType: AssignmentType | null
  patternId: number | null
  leaveType: LeaveType | null
  label: string
}

// ------------------------------------------------------------------ //
// 日テンプレート (曜日別) と特定日上書き
// ------------------------------------------------------------------ //

export interface DayTemplate {
  id: number
  department_id: number
  day_of_week: number
  pattern_id: number
  required_min: number
  required_max: number | null
  sort_order: number
}

export interface DayTemplateCreate {
  department_id: number
  day_of_week: number
  pattern_id: number
  required_min: number
  required_max?: number | null
}

export interface DayTemplateUpdate {
  day_of_week?: number
  pattern_id?: number
  required_min?: number
  required_max?: number | null
}

export interface DayOverride {
  id: number
  department_id: number
  specific_date: string
  pattern_id: number
  required_min: number
  required_max: number | null
  sort_order: number
}

export interface DayOverrideCreate {
  department_id: number
  specific_date: string
  pattern_id: number
  required_min: number
  required_max?: number | null
}

export interface DayOverrideUpdate {
  specific_date?: string
  pattern_id?: number
  required_min?: number
  required_max?: number | null
}

export interface DayTemplateImportResult {
  created: number
  updated: number
  skipped: number
  errors: string[]
}

// ------------------------------------------------------------------ //
// 作業パターン選択グループ + 非両立ルール
// ------------------------------------------------------------------ //

export interface PatternChoiceGroup {
  id: number
  department_id: number
  day_of_week: number | null
  min_count: number
  max_count: number
  candidate_pattern_ids: number[]
  sort_order: number
}

export interface PatternChoiceGroupCreate {
  department_id: number
  day_of_week: number | null
  min_count: number
  max_count: number
  candidate_pattern_ids: number[]
}

export interface PatternChoiceGroupUpdate {
  day_of_week?: number | null
  min_count?: number
  max_count?: number
  candidate_pattern_ids?: number[]
}

export interface PatternIncompatibility {
  id: number
  department_id: number
  pattern_id_a: number
  pattern_id_b: number
  sort_order: number
}

export interface PatternIncompatibilityCreate {
  department_id: number
  pattern_id_a: number
  pattern_id_b: number
}

export interface PatternIncompatibilityUpdate {
  pattern_id_a?: number
  pattern_id_b?: number
}

export interface ChoiceGroupImportResult {
  created: number
  updated: number
  skipped: number
  errors: string[]
}

// ------------------------------------------------------------------ //
// 補助ポジション発生条件 (PatternTrigger)
// ------------------------------------------------------------------ //

export interface PatternTrigger {
  id: number
  department_id: number
  auxiliary_group_id: number
  required_group_ids: number[]
  sort_order: number
}

export interface PatternTriggerCreate {
  department_id: number
  auxiliary_group_id: number
  required_group_ids: number[]
}

export interface PatternTriggerUpdate {
  auxiliary_group_id?: number
  required_group_ids?: number[]
}

export interface PatternTriggerImportResult {
  created: number
  updated: number
  skipped: number
  errors: string[]
}

// ------------------------------------------------------------------ //
// 法定祝日 (Holiday) — 読み取り専用
// ------------------------------------------------------------------ //

export interface Holiday {
  date: string // ISO date "YYYY-MM-DD"
  name: string
}
