-- Fictional Hyderabad demo fixtures. Safe to rerun: streetlights, reports, and
-- maintenance tasks are inserted only when their demo marker is not present.
-- Create Auth users and set their profile roles before running this file.

INSERT INTO public.streetlights (
  light_code, latitude, longitude, location, zone, status
)
VALUES
  ('SS-HYD-001', 17.4487, 78.3908, 'Madhapur Main Road, near Metro Pillar 1720', 'Madhapur', 'working'),
  ('SS-HYD-002', 17.4498, 78.3916, 'Ayyappa Society Road, Madhapur', 'Madhapur', 'working'),
  ('SS-HYD-003', 17.4509, 78.3827, 'Hitech City Road, Cyber Towers junction', 'Hitech City', 'failed'),
  ('SS-HYD-004', 17.4431, 78.3762, 'Mindspace Road, opposite Raheja IT Park', 'Madhapur', 'working'),
  ('SS-HYD-005', 17.4401, 78.3489, 'Gachibowli Stadium Road', 'Gachibowli', 'working'),
  ('SS-HYD-006', 17.4417, 78.3498, 'Old Mumbai Highway, Gachibowli', 'Gachibowli', 'working'),
  ('SS-HYD-007', 17.4432, 78.3576, 'DLF Road, Gachibowli', 'Gachibowli', 'working'),
  ('SS-HYD-008', 17.4603, 78.3642, 'Kondapur Main Road, Raghavendra Colony', 'Kondapur', 'working'),
  ('SS-HYD-009', 17.4634, 78.3678, 'Botanical Garden Road, Kondapur', 'Kondapur', 'working'),
  ('SS-HYD-010', 17.4665, 78.3710, 'Kondapur Junction, Masjid Banda Road', 'Kondapur', 'working'),
  ('SS-HYD-011', 17.4515, 78.3791, 'Hitech City Road, near Shilparamam', 'Hitech City', 'failed'),
  ('SS-HYD-012', 17.4555, 78.3803, 'Cyberabad Road, Madhapur', 'Hitech City', 'working'),
  ('SS-HYD-013', 17.4932, 78.3991, 'Kukatpally Housing Board Road', 'Kukatpally', 'working'),
  ('SS-HYD-014', 17.4950, 78.4026, 'KPHB 6th Phase, near community park', 'Kukatpally', 'working'),
  ('SS-HYD-015', 17.4877, 78.4057, 'JNTU Road, Kukatpally', 'Kukatpally', 'working'),
  ('SS-HYD-016', 17.4783, 78.4091, 'Moosapet Road, near Metro Station', 'Kukatpally', 'working'),
  ('SS-HYD-017', 17.4476, 78.3774, 'Mindspace Circle, Hitech City', 'Hitech City', 'maintenance'),
  ('SS-HYD-018', 17.4381, 78.3679, 'Financial District approach road', 'Gachibowli', 'working'),
  ('SS-HYD-019', 17.4364, 78.3615, 'Nanakramguda service road', 'Gachibowli', 'working'),
  ('SS-HYD-020', 17.4583, 78.3667, 'Kondapur Botanical Garden entrance', 'Kondapur', 'working'),
  ('SS-HYD-021', 17.4526, 78.3888, 'Madhapur Village Road', 'Madhapur', 'working'),
  ('SS-HYD-022', 17.4463, 78.3835, '100 Feet Road, Madhapur', 'Madhapur', 'working'),
  ('SS-HYD-023', 17.4835, 78.3972, 'KPHB Main Road, Kukatpally', 'Kukatpally', 'working'),
  ('SS-HYD-024', 17.4696, 78.3748, 'Kondapur RTO Road', 'Kondapur', 'working'),
  ('SS-HYD-025', 17.4542, 78.3726, 'Hitech City Metro access road', 'Hitech City', 'working')
ON CONFLICT (light_code) DO NOTHING;

WITH citizen AS (
  SELECT p.id
  FROM public.profiles AS p
  WHERE p.role = 'citizen'
  ORDER BY p.created_at, p.id
  LIMIT 1
),
demo_reports(
  marker, light_code, issue_type, description,
  priority_score, priority_level, status
) AS (
  VALUES
    ('01', 'SS-HYD-001', 'not_working', '[DEMO SEED:01] Full outage reported near the Metro Pillar.', 84, 'critical', 'open'),
    ('02', 'SS-HYD-005', 'flickering', '[DEMO SEED:02] Light flickers during evening traffic.', 51, 'medium', 'assigned'),
    ('03', 'SS-HYD-003', 'exposed_wiring', '[DEMO SEED:03] Exposed wiring reported by the footpath.', 100, 'critical', 'in_progress'),
    ('04', 'SS-HYD-008', 'damaged', '[DEMO SEED:04] Fixture cover is loose after recent rain.', 66, 'high', 'resolved'),
    ('05', 'SS-HYD-013', 'not_working', '[DEMO SEED:05] Pole is dark beside the bus stop.', 74, 'high', 'assigned'),
    ('06', 'SS-HYD-002', 'flickering', '[DEMO SEED:06] Intermittent flicker on the residential lane.', 61, 'high', 'open'),
    ('07', 'SS-HYD-006', 'not_working', '[DEMO SEED:07] Outage makes the crossing difficult to see.', 74, 'high', 'open'),
    ('08', 'SS-HYD-010', 'light_always_on', '[DEMO SEED:08] Light remains on during the day.', 34, 'low', 'open'),
    ('09', 'SS-HYD-011', 'damaged_fixture', '[DEMO SEED:09] Fixture appears cracked near the junction.', 76, 'high', 'open'),
    ('10', 'SS-HYD-014', 'not_working', '[DEMO SEED:10] Streetlight is out near the park entrance.', 74, 'high', 'resolved')
)
INSERT INTO public.reports (
  streetlight_id, reported_by, issue_type, description,
  priority_score, priority_level, status
)
SELECT
  s.id,
  c.id,
  d.issue_type,
  d.description,
  d.priority_score,
  d.priority_level,
  d.status
FROM demo_reports AS d
JOIN public.streetlights AS s ON s.light_code = d.light_code
CROSS JOIN citizen AS c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.reports AS existing
  WHERE existing.reported_by = c.id
    AND existing.description = d.description
);

WITH technicians AS (
  SELECT COALESCE(ARRAY_AGG(p.id ORDER BY p.id), ARRAY[]::UUID[]) AS ids
  FROM public.profiles AS p
  WHERE p.role = 'technician'
),
admin_user AS (
  SELECT p.id
  FROM public.profiles AS p
  WHERE p.role = 'admin'
  ORDER BY p.created_at, p.id
  LIMIT 1
),
seeded_reports AS (
  SELECT
    r.id,
    r.status,
    (REGEXP_MATCH(r.description, '\[DEMO SEED:([0-9]{2})\]'))[1]::INTEGER AS marker
  FROM public.reports AS r
  WHERE r.description LIKE '[DEMO SEED:%'
    AND r.status IN ('assigned', 'in_progress', 'resolved')
)
INSERT INTO public.maintenance_tasks (
  report_id, technician_id, assigned_by, status, remarks,
  started_at, completed_at
)
SELECT
  r.id,
  t.ids[((ROW_NUMBER() OVER (ORDER BY r.marker) - 1) % NULLIF(CARDINALITY(t.ids), 0)) + 1],
  a.id,
  r.status,
  CASE WHEN r.status = 'resolved' THEN 'Demo repair completed; awaiting administrator verification.' ELSE NULL END,
  CASE WHEN r.status IN ('in_progress', 'resolved') THEN NOW() - INTERVAL '2 hours' ELSE NULL END,
  CASE WHEN r.status = 'resolved' THEN NOW() - INTERVAL '30 minutes' ELSE NULL END
FROM seeded_reports AS r
CROSS JOIN technicians AS t
LEFT JOIN admin_user AS a ON TRUE
WHERE CARDINALITY(t.ids) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.maintenance_tasks AS existing
    WHERE existing.report_id = r.id
  );
