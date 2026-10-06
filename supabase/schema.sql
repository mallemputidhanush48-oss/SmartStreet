-- SmartStreet schema and security setup.
-- Run this in the Supabase SQL Editor for the target project.

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'citizen'
    CHECK (role IN ('admin', 'technician', 'citizen')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.streetlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  light_code TEXT UNIQUE NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  location TEXT NOT NULL,
  zone TEXT,
  status TEXT NOT NULL DEFAULT 'working'
    CHECK (status IN ('working', 'failed', 'maintenance', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  streetlight_id UUID NOT NULL REFERENCES public.streetlights(id) ON DELETE CASCADE,
  reported_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL,
  description TEXT,
  priority_score INTEGER NOT NULL DEFAULT 0
    CHECK (priority_score BETWEEN 0 AND 100),
  priority_level TEXT NOT NULL DEFAULT 'low'
    CHECK (priority_level IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'verified')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.maintenance_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'in_progress', 'resolved', 'verified')),
  remarks TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reports_status_idx ON public.reports (status);
CREATE INDEX IF NOT EXISTS reports_priority_level_idx ON public.reports (priority_level);
CREATE INDEX IF NOT EXISTS reports_streetlight_id_idx ON public.reports (streetlight_id);
CREATE INDEX IF NOT EXISTS reports_reported_by_idx ON public.reports (reported_by);
CREATE INDEX IF NOT EXISTS reports_streetlight_created_idx ON public.reports (streetlight_id, created_at DESC);
CREATE INDEX IF NOT EXISTS maintenance_tasks_technician_id_idx ON public.maintenance_tasks (technician_id);
CREATE INDEX IF NOT EXISTS maintenance_tasks_status_idx ON public.maintenance_tasks (status);
CREATE INDEX IF NOT EXISTS streetlights_status_idx ON public.streetlights (status);
CREATE INDEX IF NOT EXISTS streetlights_zone_idx ON public.streetlights (zone);
CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles (role);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON public.notifications (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS streetlights_set_updated_at ON public.streetlights;
CREATE TRIGGER streetlights_set_updated_at
  BEFORE UPDATE ON public.streetlights
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS reports_set_updated_at ON public.reports;
CREATE TRIGGER reports_set_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.role
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid())
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(public.current_app_role() = 'admin', FALSE);
$$;

CREATE OR REPLACE FUNCTION public.prevent_user_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- SQL Editor/admin maintenance runs without an end-user JWT and can assign roles.
  -- An authenticated user can only change their role through trusted admin setup.
  IF (SELECT auth.uid()) IS NOT NULL
    AND OLD.role IS DISTINCT FROM NEW.role
    AND NOT public.is_admin()
  THEN
    RAISE EXCEPTION 'Profile role changes require administrator privileges';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_user_role_change ON public.profiles;
CREATE TRIGGER profiles_prevent_user_role_change
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_user_role_change();

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_full_name TEXT;
  v_phone TEXT;
BEGIN
  v_full_name := NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'full_name'), '');
  v_phone := NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'phone'), '');

  INSERT INTO public.profiles (id, full_name, email, phone, role)
  VALUES (
    NEW.id,
    COALESCE(v_full_name, NULLIF(SPLIT_PART(COALESCE(NEW.email, ''), '@', 1), ''), 'Citizen'),
    NEW.email,
    v_phone,
    'citizen'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

CREATE OR REPLACE FUNCTION public.priority_for_report(
  p_issue_type TEXT,
  p_location_importance INTEGER,
  p_traffic_importance INTEGER,
  p_repeated_reports INTEGER,
  p_failure_hours DOUBLE PRECISION
)
RETURNS TABLE (score INTEGER, level TEXT)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_base INTEGER;
  v_score INTEGER;
BEGIN
  v_base := CASE LOWER(BTRIM(COALESCE(p_issue_type, '')))
    WHEN 'exposed_wiring' THEN 74
    WHEN 'exposed wires' THEN 74
    WHEN 'electrical_hazard' THEN 74
    WHEN 'complete_outage' THEN 52
    WHEN 'light_out' THEN 52
    WHEN 'light_outage' THEN 52
    WHEN 'not_working' THEN 52
    WHEN 'damaged_fixture' THEN 44
    WHEN 'broken_fixture' THEN 44
    WHEN 'damaged' THEN 44
    WHEN 'damaged_pole' THEN 48
    WHEN 'flickering' THEN 29
    WHEN 'light_always_on' THEN 12
    WHEN 'daytime_on' THEN 12
    ELSE 24
  END;

  v_score := LEAST(
    100,
    v_base
      + GREATEST(0, LEAST(20, COALESCE(p_location_importance, 0)))
      + GREATEST(0, LEAST(20, COALESCE(p_traffic_importance, 0)))
      + LEAST(16, GREATEST(0, COALESCE(p_repeated_reports, 0)) * 4)
      + LEAST(16, GREATEST(0, FLOOR(COALESCE(p_failure_hours, 0) / 24)::INTEGER) * 4)
  );

  RETURN QUERY
  SELECT
    v_score,
    CASE
      WHEN v_score >= 80 THEN 'critical'
      WHEN v_score >= 60 THEN 'high'
      WHEN v_score >= 40 THEN 'medium'
      ELSE 'low'
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_report_priority_factors(p_streetlight_id UUID)
RETURNS TABLE (
  location_importance INTEGER,
  traffic_importance INTEGER,
  repeated_reports INTEGER,
  failure_hours DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_location TEXT;
  v_zone TEXT;
  v_status TEXT;
  v_updated_at TIMESTAMPTZ;
  v_location_importance INTEGER;
  v_traffic_importance INTEGER;
  v_repeated_reports INTEGER;
  v_failure_hours DOUBLE PRECISION;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  SELECT s.location, s.zone, s.status, s.updated_at
    INTO v_location, v_zone, v_status, v_updated_at
  FROM public.streetlights AS s
  WHERE s.id = p_streetlight_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Streetlight not found';
  END IF;

  v_location_importance := CASE
    WHEN LOWER(CONCAT_WS(' ', v_location, v_zone)) ~ '(hitech|hi-tech|madhapur|junction|main road)' THEN 16
    WHEN LOWER(CONCAT_WS(' ', v_location, v_zone)) ~ '(gachibowli|kukatpally|kondapur)' THEN 12
    ELSE 6
  END;

  v_traffic_importance := CASE
    WHEN LOWER(CONCAT_WS(' ', v_location, v_zone)) ~ '(hitech|hi-tech|madhapur|junction|main road)' THEN 16
    WHEN LOWER(CONCAT_WS(' ', v_location, v_zone)) ~ '(gachibowli|kukatpally|kondapur)' THEN 10
    ELSE 4
  END;

  SELECT COUNT(*)::INTEGER
    INTO v_repeated_reports
  FROM public.reports AS r
  WHERE r.streetlight_id = p_streetlight_id
    AND r.created_at >= NOW() - INTERVAL '30 days';

  v_failure_hours := CASE
    WHEN v_status IN ('failed', 'maintenance')
      THEN GREATEST(0, EXTRACT(EPOCH FROM (NOW() - v_updated_at)) / 3600.0)
    ELSE 0
  END;

  RETURN QUERY
  SELECT v_location_importance, v_traffic_importance, v_repeated_reports, v_failure_hours;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_report(
  p_streetlight_id UUID,
  p_issue_type TEXT,
  p_description TEXT,
  p_priority_score INTEGER,
  p_priority_level TEXT
)
RETURNS public.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_light_code TEXT;
  v_factors RECORD;
  v_priority RECORD;
  v_report public.reports;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF public.current_app_role() IS DISTINCT FROM 'citizen' THEN
    RAISE EXCEPTION 'Only citizens can submit reports';
  END IF;

  IF NULLIF(BTRIM(p_issue_type), '') IS NULL OR LENGTH(BTRIM(p_issue_type)) > 80 THEN
    RAISE EXCEPTION 'An issue type is required';
  END IF;

  IF p_description IS NOT NULL AND LENGTH(p_description) > 2000 THEN
    RAISE EXCEPTION 'Description is too long';
  END IF;

  -- Validate the preview payload shape; the database-calculated score remains authoritative.
  IF p_priority_score IS NULL OR p_priority_score NOT BETWEEN 0 AND 100
    OR p_priority_level IS NULL
    OR p_priority_level NOT IN ('low', 'medium', 'high', 'critical')
  THEN
    RAISE EXCEPTION 'Invalid priority preview';
  END IF;

  SELECT s.light_code INTO v_light_code
  FROM public.streetlights AS s
  WHERE s.id = p_streetlight_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Streetlight not found';
  END IF;

  SELECT * INTO v_factors
  FROM public.get_report_priority_factors(p_streetlight_id);

  SELECT * INTO v_priority
  FROM public.priority_for_report(
    p_issue_type,
    v_factors.location_importance,
    v_factors.traffic_importance,
    v_factors.repeated_reports,
    v_factors.failure_hours
  );

  INSERT INTO public.reports (
    streetlight_id,
    reported_by,
    issue_type,
    description,
    priority_score,
    priority_level,
    status
  )
  VALUES (
    p_streetlight_id,
    v_user_id,
    BTRIM(p_issue_type),
    NULLIF(BTRIM(COALESCE(p_description, '')), ''),
    v_priority.score,
    v_priority.level,
    'open'
  )
  RETURNING * INTO v_report;

  UPDATE public.streetlights
  SET status = 'failed'
  WHERE id = p_streetlight_id
    AND status = 'working';

  INSERT INTO public.notifications (user_id, message)
  SELECT p.id, 'New streetlight report received for ' || v_light_code || '.'
  FROM public.profiles AS p
  WHERE p.role = 'admin';

  RETURN v_report;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_technician(
  p_report_id UUID,
  p_technician_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_report_status TEXT;
  v_light_code TEXT;
  v_task_id UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges are required';
  END IF;

  SELECT r.status, s.light_code
    INTO v_report_status, v_light_code
  FROM public.reports AS r
  JOIN public.streetlights AS s ON s.id = r.streetlight_id
  WHERE r.id = p_report_id
  FOR UPDATE OF r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  IF v_report_status <> 'open' THEN
    RAISE EXCEPTION 'Only open reports can be assigned';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = p_technician_id AND p.role = 'technician'
  ) THEN
    RAISE EXCEPTION 'Selected technician is not available';
  END IF;

  INSERT INTO public.maintenance_tasks (report_id, technician_id, assigned_by, status)
  VALUES (p_report_id, p_technician_id, (SELECT auth.uid()), 'assigned')
  RETURNING id INTO v_task_id;

  UPDATE public.reports
  SET status = 'assigned'
  WHERE id = p_report_id;

  INSERT INTO public.notifications (user_id, message)
  VALUES (
    p_technician_id,
    'New maintenance task assigned for ' || v_light_code || '.'
  );

  RETURN v_task_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_maintenance_task(p_task_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_report_id UUID;
  v_status TEXT;
BEGIN
  IF public.current_app_role() IS DISTINCT FROM 'technician' THEN
    RAISE EXCEPTION 'Technician privileges are required';
  END IF;

  SELECT mt.report_id, mt.status
    INTO v_report_id, v_status
  FROM public.maintenance_tasks AS mt
  WHERE mt.id = p_task_id
    AND mt.technician_id = (SELECT auth.uid())
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  IF v_status <> 'assigned' THEN
    RAISE EXCEPTION 'Only assigned tasks can be started';
  END IF;

  UPDATE public.maintenance_tasks
  SET status = 'in_progress', started_at = NOW()
  WHERE id = p_task_id;

  UPDATE public.reports
  SET status = 'in_progress'
  WHERE id = v_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_maintenance_task(
  p_task_id UUID,
  p_remarks TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_report_id UUID;
  v_technician_id UUID;
  v_light_id UUID;
  v_light_code TEXT;
  v_status TEXT;
BEGIN
  IF public.current_app_role() IS DISTINCT FROM 'technician' THEN
    RAISE EXCEPTION 'Technician privileges are required';
  END IF;

  SELECT mt.report_id, mt.technician_id, mt.status, r.streetlight_id, s.light_code
    INTO v_report_id, v_technician_id, v_status, v_light_id, v_light_code
  FROM public.maintenance_tasks AS mt
  JOIN public.reports AS r ON r.id = mt.report_id
  JOIN public.streetlights AS s ON s.id = r.streetlight_id
  WHERE mt.id = p_task_id
  FOR UPDATE OF mt;

  IF NOT FOUND OR v_technician_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  IF v_status <> 'in_progress' THEN
    RAISE EXCEPTION 'Only in-progress tasks can be resolved';
  END IF;

  IF p_remarks IS NOT NULL AND LENGTH(p_remarks) > 2000 THEN
    RAISE EXCEPTION 'Repair remarks are too long';
  END IF;

  UPDATE public.maintenance_tasks
  SET status = 'resolved',
      completed_at = NOW(),
      remarks = NULLIF(BTRIM(COALESCE(p_remarks, '')), '')
  WHERE id = p_task_id;

  UPDATE public.reports
  SET status = 'resolved'
  WHERE id = v_report_id;

  UPDATE public.streetlights
  SET status = 'working'
  WHERE id = v_light_id;

  INSERT INTO public.notifications (user_id, message)
  SELECT p.id, 'Maintenance for ' || v_light_code || ' is ready for verification.'
  FROM public.profiles AS p
  WHERE p.role = 'admin';
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_maintenance_task(p_task_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_report_id UUID;
  v_reporter_id UUID;
  v_light_code TEXT;
  v_status TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges are required';
  END IF;

  SELECT mt.report_id, r.reported_by, mt.status, s.light_code
    INTO v_report_id, v_reporter_id, v_status, v_light_code
  FROM public.maintenance_tasks AS mt
  JOIN public.reports AS r ON r.id = mt.report_id
  JOIN public.streetlights AS s ON s.id = r.streetlight_id
  WHERE mt.id = p_task_id
  FOR UPDATE OF mt;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  IF v_status <> 'resolved' THEN
    RAISE EXCEPTION 'Only resolved tasks can be verified';
  END IF;

  UPDATE public.maintenance_tasks
  SET status = 'verified'
  WHERE id = p_task_id;

  UPDATE public.reports
  SET status = 'verified'
  WHERE id = v_report_id;

  INSERT INTO public.notifications (user_id, message)
  VALUES (
    v_reporter_id,
    'Your streetlight complaint for ' || v_light_code || ' has been verified and resolved.'
  );
END;
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streetlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_self_or_admin ON public.profiles;
CREATE POLICY profiles_select_self_or_admin
  ON public.profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS profiles_update_self_or_admin ON public.profiles;
CREATE POLICY profiles_update_self_or_admin
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  WITH CHECK (id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS streetlights_read_authenticated ON public.streetlights;
CREATE POLICY streetlights_read_authenticated
  ON public.streetlights FOR SELECT TO authenticated
  USING ((SELECT public.current_app_role()) IN ('admin', 'technician', 'citizen'));

DROP POLICY IF EXISTS streetlights_update_admin ON public.streetlights;
CREATE POLICY streetlights_update_admin
  ON public.streetlights FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS reports_select_own_or_admin ON public.reports;
CREATE POLICY reports_select_own_or_admin
  ON public.reports FOR SELECT TO authenticated
  USING (
    reported_by = (SELECT auth.uid())
    OR (SELECT public.is_admin())
    OR EXISTS (
      SELECT 1
      FROM public.maintenance_tasks AS mt
      WHERE mt.report_id = reports.id
        AND mt.technician_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS maintenance_tasks_select_assigned_or_admin ON public.maintenance_tasks;
CREATE POLICY maintenance_tasks_select_assigned_or_admin
  ON public.maintenance_tasks FOR SELECT TO authenticated
  USING (
    technician_id = (SELECT auth.uid())
    OR (SELECT public.is_admin())
  );

DROP POLICY IF EXISTS notifications_select_own_or_admin ON public.notifications;
CREATE POLICY notifications_select_own_or_admin
  ON public.notifications FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS notifications_update_own_or_admin ON public.notifications;
CREATE POLICY notifications_update_own_or_admin
  ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  WITH CHECK (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
REVOKE ALL ON TABLE public.streetlights FROM anon, authenticated;
REVOKE ALL ON TABLE public.reports FROM anon, authenticated;
REVOKE ALL ON TABLE public.maintenance_tasks FROM anon, authenticated;
REVOKE ALL ON TABLE public.notifications FROM anon, authenticated;

GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (full_name, phone, role) ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.streetlights TO authenticated;
GRANT UPDATE (light_code, latitude, longitude, location, zone, status, updated_at)
  ON TABLE public.streetlights TO authenticated;
GRANT SELECT ON TABLE public.reports TO authenticated;
GRANT SELECT ON TABLE public.maintenance_tasks TO authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT UPDATE (is_read) ON TABLE public.notifications TO authenticated;

REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_user_role_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.priority_for_report(TEXT, INTEGER, INTEGER, INTEGER, DOUBLE PRECISION) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_report_priority_factors(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_report(UUID, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_technician(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_maintenance_task(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_maintenance_task(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_maintenance_task(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.priority_for_report(TEXT, INTEGER, INTEGER, INTEGER, DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_report_priority_factors(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_report(UUID, TEXT, TEXT, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_technician(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_maintenance_task(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_maintenance_task(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_maintenance_task(UUID) TO authenticated;
