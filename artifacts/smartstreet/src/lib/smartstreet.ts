'use client';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  calculatePriority,
  type PriorityFactors,
  type PriorityLevel,
} from '@/lib/priority/calculatePriority';

export type StreetlightStatus = 'working' | 'failed' | 'maintenance' | 'inactive';

export type Streetlight = {
  id: string;
  light_code: string;
  latitude: number;
  longitude: number;
  location: string;
  zone: string;
  status: StreetlightStatus;
  created_at: string;
  updated_at: string;
};

export type Report = {
  id: string;
  streetlight_id: string;
  reported_by: string;
  issue_type: string;
  description: string;
  priority_score: number;
  priority_level: PriorityLevel;
  status: string;
  created_at: string;
  updated_at: string;
  streetlight?: Streetlight;
  light?: Streetlight;
};

export type ReportWithLight = Report & {
  streetlight: Streetlight | undefined;
  light: Streetlight | undefined;
};

export type MaintenanceTask = {
  id: string;
  report_id: string;
  technician_id: string;
  assigned_by: string | null;
  status: string;
  remarks: string | null;
  assigned_at: string;
  started_at: string | null;
  completed_at: string | null;
  report?: ReportWithLight;
};

export type TaskWithReport = MaintenanceTask & {
  report: ReportWithLight | undefined;
};

export type ProfileSummary = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: 'admin' | 'technician' | 'citizen';
};

export type Notification = {
  id: string;
  user_id: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

export type AdminData = {
  streetlights: Streetlight[];
  reports: ReportWithLight[];
  tasks: TaskWithReport[];
  technicians: ProfileSummary[];
};

type CreateReportInput = {
  streetlightId: string;
  issueType: string;
  description: string;
};

const reportColumns =
  'id, streetlight_id, reported_by, issue_type, description, priority_score, priority_level, status, created_at, updated_at';
const lightColumns =
  'id, light_code, latitude, longitude, location, zone, status, created_at, updated_at';
const taskColumns =
  'id, report_id, technician_id, assigned_by, status, remarks, assigned_at, started_at, completed_at';

export async function getStreetlights(): Promise<Streetlight[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('streetlights')
    .select(lightColumns)
    .order('light_code', { ascending: true });
  if (error) throwServiceError(error, 'streetlights');
  return (data ?? []).map(normalizeStreetlight);
}

export async function createReport(input: CreateReportInput): Promise<Report> {
  const supabase = createSupabaseBrowserClient();
  if (!input.streetlightId || !input.issueType.trim()) {
    throw new Error('Choose a streetlight and an issue type before submitting.');
  }
  if (input.description.length > 2000) {
    throw new Error('Keep report details under 2,000 characters.');
  }

  const { data: factorsData, error: factorsError } = await supabase.rpc(
    'get_report_priority_factors',
    { p_streetlight_id: input.streetlightId },
  );
  if (factorsError) throwServiceError(factorsError, 'report');
  const factors = firstRow(factorsData) as PriorityFactors | null;
  if (!factors) {
    throw new Error('We could not calculate report priority. Please try again.');
  }

  const priority = calculatePriority(input.issueType, factors);
  const { data, error } = await supabase.rpc('submit_report', {
    p_streetlight_id: input.streetlightId,
    p_issue_type: input.issueType.trim(),
    p_description: input.description.trim() || null,
    p_priority_score: priority.score,
    p_priority_level: priority.level,
  });
  if (error) throwServiceError(error, 'report');

  const report = firstRow(data);
  if (!report) {
    throw new Error('Your report was submitted, but its confirmation could not be loaded.');
  }
  return normalizeReport(report);
}

export async function getCitizenReports(userId: string): Promise<ReportWithLight[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('reports')
    .select(reportColumns)
    .eq('reported_by', userId)
    .order('created_at', { ascending: false });
  if (error) throwServiceError(error, 'reports');
  return attachStreetlights((data ?? []).map(normalizeReport), await getStreetlightIndex());
}

export async function getAdminData(): Promise<AdminData> {
  const supabase = createSupabaseBrowserClient();
  const [lightsResult, reportsResult, tasksResult, peopleResult] = await Promise.all([
    supabase.from('streetlights').select(lightColumns).order('light_code'),
    supabase.from('reports').select(reportColumns).order('created_at', { ascending: false }),
    supabase.from('maintenance_tasks').select(taskColumns).order('assigned_at', { ascending: false }),
    supabase
      .from('profiles')
      .select('id, full_name, email, phone, role')
      .eq('role', 'technician')
      .order('full_name'),
  ]);

  if (lightsResult.error) throwServiceError(lightsResult.error, 'streetlights');
  if (reportsResult.error) throwServiceError(reportsResult.error, 'reports');
  if (tasksResult.error) throwServiceError(tasksResult.error, 'tasks');
  if (peopleResult.error) throwServiceError(peopleResult.error, 'technicians');

  const streetlights = (lightsResult.data ?? []).map(normalizeStreetlight);
  const lightIndex = new Map(streetlights.map((light) => [light.id, light]));
  const reports = (reportsResult.data ?? []).map((row) =>
    attachOneStreetlight(normalizeReport(row), lightIndex),
  );
  const reportsById = new Map(reports.map((report) => [report.id, report]));
  const tasks = (tasksResult.data ?? []).map((row) => {
    const task = normalizeTask(row);
    return { ...task, report: reportsById.get(task.report_id) };
  });
  const technicians = (peopleResult.data ?? []).map((person) => ({
    ...person,
    email: person.email ?? '',
    role: 'technician' as const,
  }));

  return { streetlights, reports, tasks, technicians };
}

export async function assignTechnician(
  reportId: string,
  technicianId: string,
): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc('assign_technician', {
    p_report_id: reportId,
    p_technician_id: technicianId,
  });
  if (error) throwServiceError(error, 'assign');
}

export async function getTechnicianTasks(
  technicianId: string,
): Promise<TaskWithReport[]> {
  const supabase = createSupabaseBrowserClient();
  const { data: taskRows, error: taskError } = await supabase
    .from('maintenance_tasks')
    .select(taskColumns)
    .eq('technician_id', technicianId)
    .order('assigned_at', { ascending: false });
  if (taskError) throwServiceError(taskError, 'tasks');

  const tasks = (taskRows ?? []).map(normalizeTask);
  if (!tasks.length) return [];

  const reportIds = [...new Set(tasks.map((task) => task.report_id))];
  const { data: reportRows, error: reportError } = await supabase
    .from('reports')
    .select(reportColumns)
    .in('id', reportIds);
  if (reportError) throwServiceError(reportError, 'reports');

  const reports = (reportRows ?? []).map(normalizeReport);
  const reportIndex = new Map(
    attachStreetlights(reports, await getStreetlightIndex()).map((report) => [report.id, report]),
  );
  return tasks.map((task) => ({ ...task, report: reportIndex.get(task.report_id) }));
}

export async function startMaintenanceTask(taskId: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc('start_maintenance_task', { p_task_id: taskId });
  if (error) throwServiceError(error, 'start');
}

export async function resolveMaintenanceTask(
  taskId: string,
  remarks: string,
): Promise<void> {
  if (!remarks.trim()) throw new Error('Add a brief repair note before resolving this task.');
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc('resolve_maintenance_task', {
    p_task_id: taskId,
    p_remarks: remarks.trim(),
  });
  if (error) throwServiceError(error, 'resolve');
}

export async function verifyMaintenanceTask(taskId: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc('verify_maintenance_task', { p_task_id: taskId });
  if (error) throwServiceError(error, 'verify');
}

export async function getNotifications(userId: string): Promise<Notification[]> {
  const supabase = createSupabaseBrowserClient();
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError) throwServiceError(userError, 'notifications');
  if (!userResult.user || userResult.user.id !== userId) return [];

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) throwServiceError(profileError, 'notifications');

  let query = supabase
    .from('notifications')
    .select('id, user_id, message, is_read, created_at')
    .order('created_at', { ascending: false });
  if (profile?.role !== 'admin') query = query.eq('user_id', userId);

  const { data, error } = await query;
  if (error) throwServiceError(error, 'notifications');
  return (data ?? []) as Notification[];
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .select('id')
    .maybeSingle();
  if (error) throwServiceError(error, 'notification-update');
  if (!data) {
    throw new Error('That notification is unavailable or you do not have permission to update it.');
  }
}

async function getStreetlightIndex(): Promise<Map<string, Streetlight>> {
  const lights = await getStreetlights();
  return new Map(lights.map((light) => [light.id, light]));
}

function attachStreetlights(
  reports: Report[],
  lightIndex: Map<string, Streetlight>,
): ReportWithLight[] {
  return reports.map((report) => attachOneStreetlight(report, lightIndex));
}

function attachOneStreetlight(
  report: Report,
  lightIndex: Map<string, Streetlight>,
): ReportWithLight {
  const light = lightIndex.get(report.streetlight_id);
  return { ...report, streetlight: light, light };
}

function normalizeStreetlight(row: any): Streetlight {
  return {
    ...row,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    zone: row.zone || 'Hyderabad',
    status: row.status as StreetlightStatus,
  };
}

function normalizeReport(row: any): Report {
  return {
    ...row,
    description: row.description ?? '',
    priority_score: Number(row.priority_score ?? 0),
    priority_level: row.priority_level as PriorityLevel,
  };
}

function normalizeTask(row: any): MaintenanceTask {
  return { ...row, remarks: row.remarks ?? null };
}

function firstRow<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function throwServiceError(error: unknown, operation: string): never {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`SmartStreet ${operation} request failed:`, error);
  }

  const status = getErrorStatus(error);
  if (status === 401) {
    throw new Error('Your session may have expired. Sign in again and retry.');
  }
  if (status === 403) {
    throw new Error('Your account does not have permission to complete this action.');
  }

  const messages: Record<string, string> = {
    streetlights: 'We could not load the streetlight directory. Please try again.',
    reports: 'We could not load these reports. Please refresh and try again.',
    report: 'Your report could not be submitted. Check the details and try again.',
    tasks: 'We could not load the maintenance tasks. Please refresh and try again.',
    technicians: 'We could not load the technician list. Please refresh and try again.',
    assign: 'This report could not be assigned. Refresh the queue and try again.',
    start: 'This task could not be started. Refresh your task list and try again.',
    resolve: 'This repair could not be submitted. Check your note and try again.',
    verify: 'This repair could not be verified. Refresh the queue and try again.',
    notifications: 'We could not load service updates. Please refresh and try again.',
    'notification-update': 'This notification could not be updated. Please try again.',
  };
  throw new Error(messages[operation] ?? 'A connection error interrupted the request. Please try again.');
}

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : undefined;
}
