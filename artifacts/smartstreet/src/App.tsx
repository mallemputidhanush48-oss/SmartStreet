'use client';

import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAuth } from '@/lib/auth-context';
import {
  assignTechnician, createReport, getAdminData, getCitizenReports, getNotifications,
  getStreetlights, getTechnicianTasks, markNotificationRead, resolveMaintenanceTask,
  startMaintenanceTask, verifyMaintenanceTask,
} from '@/lib/smartstreet';
import {
  Activity, AlertCircle, Bell, Check, CheckCircle2, ChevronRight, ClipboardList,
  Clock3, Construction, FileWarning, LampDesk, Lightbulb, LoaderCircle, LogOut,
  MapPin, Menu, ShieldCheck, Signal, UserRound, Wrench, X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const StreetlightMap = dynamic(() => import('@/components/streetlight-map'), {
  ssr: false,
  loading: () => <div className="map-card"><div className="skeleton" style={{ width: 180, margin: '24px auto' }} /></div>,
});

type Role = 'citizen' | 'admin' | 'technician';
type Profile = { id: string; full_name: string; email: string; phone?: string | null; role: Role | string };
type Streetlight = { id: string; light_code: string; latitude: number; longitude: number; location: string; zone: string; status: string; created_at: string; updated_at: string };
type Report = { id: string; streetlight_id: string; reported_by: string; issue_type: string; description: string; priority_score?: number; priority_level?: string; status: string; created_at: string; updated_at: string; streetlight?: Streetlight; light?: Streetlight };
type Task = { id: string; report_id: string; technician_id: string; assigned_by?: string; status: string; remarks?: string | null; assigned_at?: string; started_at?: string | null; completed_at?: string | null; report?: Report };
type NotificationItem = { id: string; user_id: string; message: string; is_read: boolean; created_at: string };
type Technician = Profile;

const roleRoute = (role?: string | null) => role === 'admin' ? '/admin' : role === 'technician' ? '/technician' : role === 'citizen' ? '/citizen' : '/login';
const titleCase = (value?: string | null) => (value || 'unknown').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const initials = (name?: string) => (name || 'Resident').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
const statusClass = (status?: string) => `status-pill ${(status || '').toLowerCase().replaceAll(' ', '_')}`;
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
const niceError = (error: unknown) => error instanceof Error
  ? error.message
  : 'We couldn’t complete that request. Please try again in a moment.';

function Busy({ label = 'Loading your street view' }: { label?: string }) {
  return <div className="panel" aria-live="polite"><div className="skeleton" style={{ width: 110, marginBottom: 14 }} /><div className="skeleton" style={{ width: '70%', height: 23, marginBottom: 20 }} /><div className="skeleton" style={{ width: '100%', height: 95 }} /><p className="helper" style={{ marginBottom: 0 }}>{label}…</p></div>;
}
function Failure({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div className="error-box" role="alert"><span>{niceError(error)}</span>{retry && <button className="btn small secondary" onClick={retry} data-testid="button-retry">Retry</button>}</div>;
}
function Empty({ icon: Icon = Signal, title, copy }: { icon?: typeof Signal; title: string; copy: string }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={19} /></div><strong>{title}</strong><p>{copy}</p></div>;
}
function Brand({ light = false }: { light?: boolean }) {
  return <span className="brand" style={light ? { margin: 0 } : undefined}><span className="brand-mark"><Lightbulb size={17} /></span>SmartStreet</span>;
}

function AuthScreen({ mode, onDone }: { mode: 'login' | 'signup'; onDone: (profile?: Profile | null) => void }) {
  const { signIn, signUp, refreshProfile, configured, error: authError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submitInFlight = useRef(false);
  const signup = mode === 'signup';
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitInFlight.current) return;
    setError(''); setSuccessMessage('');
    if (signup && !fullName.trim()) { setError('Please enter your full name.'); return; }
    if (password.length < 6) { setError('Use a password with at least 6 characters.'); return; }
    submitInFlight.current = true;
    setBusy(true);
    try {
      if (signup) {
        const result = await signUp({ email, password, fullName: fullName.trim(), phone: phone.trim() });
        if (result.needsEmailConfirmation) {
          setPassword('');
          setSuccessMessage(`Account created. Check ${email} for the confirmation link, then sign in.`);
          return;
        }
      } else await signIn(email, password);
      const profile = await refreshProfile();
      onDone(profile as Profile | null);
    } catch (err) { setError(niceError(err)); }
    finally { submitInFlight.current = false; setBusy(false); }
  }
  return <main className="auth-page">
    <section className="auth-art">
      <div className="auth-brand"><Brand light /></div>
      <div className="art-path" aria-hidden="true" />
      <div className="auth-copy fade-up">
        <div className="eyebrow">Hyderabad · Neighbourhood services</div>
        <h1>Every street<br />deserves light.</h1>
        <p>Report a streetlight fault, follow its progress, and know when your neighbourhood is bright again.</p>
      </div>
      <div className="auth-art-foot">REPORT → REPAIR → VERIFIED</div>
    </section>
    <section className="auth-form-side">
      <div className="auth-form-box fade-up">
        <div className="eyebrow">{signup ? 'Join your neighbourhood' : 'Resident & city staff access'}</div>
        <h2>{signup ? 'Create an account' : 'Welcome back'}</h2>
        <p>{signup ? 'One account to report faults and follow repairs.' : 'Sign in to continue where your street left off.'}</p>
        {!configured && <div className="error-box" role="alert"><span>{authError || 'Supabase is not configured for this app.'}</span></div>}
        {error && <div className="error-box" role="alert"><span>{error}</span></div>}
        {successMessage && <div className="notice" role="status">{successMessage}</div>}
        <form onSubmit={submit}>
          {signup && <div className="form-field"><label htmlFor="fullName">Full name</label><input id="fullName" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" required data-testid="input-full-name" /></div>}
          <div className="form-field"><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required data-testid="input-email" /></div>
          {signup && <div className="form-field"><label htmlFor="phone">Phone number <span className="helper">(optional)</span></label><input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91" data-testid="input-phone" /></div>}
          <div className="form-field"><label htmlFor="password">Password</label><input id="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" required data-testid="input-password" /></div>
          <button className="btn" type="submit" disabled={busy} style={{ width: '100%', marginTop: 6 }} data-testid="button-auth-submit">{busy ? <LoaderCircle size={15} className="spin" /> : null}{busy ? 'Please wait…' : signup ? 'Create resident account' : 'Sign in'}</button>
        </form>
        <div className="auth-switch">{signup ? 'Already have an account?' : 'New to SmartStreet?'}<Link href={signup ? '/login' : '/signup'} data-testid="link-auth-switch">{signup ? 'Sign in' : 'Create an account'}</Link></div>
        <div className="auth-footnote"><ShieldCheck size={16} /><span>Your account is used to keep your reports and updates in one place. City staff access is assigned by the service administrator.</span></div>
      </div>
    </section>
  </main>;
}

function AppRouter() {
  const auth = useAuth();
  const location = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const priorUser = useRef<string | null>(null);
  const profile = auth.profile as Profile | null;
  const userId = auth.user?.id || null;
  useEffect(() => {
    if (priorUser.current !== userId) {
      qc.removeQueries({ queryKey: ['citizen-reports'] });
      qc.removeQueries({ queryKey: ['notifications'] });
      qc.removeQueries({ queryKey: ['technician-tasks'] });
      qc.removeQueries({ queryKey: ['admin-data'] });
    }
    priorUser.current = userId;
  }, [userId, qc]);
  useEffect(() => {
    if (auth.loading) return;
    if (location === '/') router.replace(roleRoute(profile?.role));
    else if (location === '/login' || location === '/signup') {
      if (auth.user && profile?.role) router.replace(roleRoute(profile.role));
    } else if (!auth.user) router.replace('/login');
    else if (profile && (location === '/citizen' || location === '/admin' || location === '/technician') && roleRoute(profile.role) !== location) router.replace(roleRoute(profile.role));
  }, [auth.loading, auth.user, profile?.role, location, router]);
  if (auth.loading) return <div className="auth-page" style={{ placeItems: 'center' }}><Busy label="Checking your account" /></div>;
  if (auth.user && !profile && auth.error) {
    return <main className="auth-page" style={{ placeItems: 'center' }}><section className="panel" role="alert"><div className="eyebrow">Account setup</div><h1 style={{ margin: '10px 0', color: '#203b35' }}>We couldn’t load your profile</h1><p className="panel-note">{auth.error}</p><button className="btn secondary" onClick={() => void auth.signOut()}>Sign out</button></section></main>;
  }
  const afterAuth = (result?: Profile | null) => router.replace(roleRoute(result?.role || profile?.role));
  let content: ReactNode;
  if (location === '/') {
    content = <HomeRedirect />;
  } else if (location === '/login' || location === '/signup') {
    content = auth.user && profile?.role ? <Busy label="Opening your workspace" /> : <AuthScreen mode={location === '/signup' ? 'signup' : 'login'} onDone={afterAuth} />;
  } else if (location === '/citizen') {
    content = auth.user && profile?.role === 'citizen' ? <DashboardShell profile={profile} section="citizen" onSignOut={auth.signOut}><CitizenDashboard profile={profile} /></DashboardShell> : <Busy label="Opening resident workspace" />;
  } else if (location === '/admin') {
    content = auth.user && profile?.role === 'admin' ? <DashboardShell profile={profile} section="admin" onSignOut={auth.signOut}><AdminDashboard profile={profile} /></DashboardShell> : <Busy label="Opening city operations" />;
  } else if (location === '/technician') {
    content = auth.user && profile?.role === 'technician' ? <DashboardShell profile={profile} section="technician" onSignOut={auth.signOut}><TechnicianDashboard profile={profile} /></DashboardShell> : <Busy label="Opening technician workspace" />;
  } else {
    content = <main className="auth-page" style={{ placeItems: 'center' }}><section className="panel"><div className="eyebrow">SmartStreet · Hyderabad</div><h1 style={{ margin: '10px 0', color: '#203b35' }}>Page not found</h1><p className="panel-note">That page isn’t part of your street service workspace.</p><Link className="btn" href="/">Return to your dashboard</Link></section></main>;
  }
  return <RoutedErrorBoundary key={location}>{content}</RoutedErrorBoundary>;
}

function HomeRedirect() {
  const { profile, loading } = useAuth();
  const router = useRouter();
  const role = (profile as Profile | null)?.role;
  useEffect(() => { if (!loading) router.replace(roleRoute(role)); }, [loading, role, router]);
  return <Busy label="Finding your workspace" />;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const location = usePathname();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function DashboardShell({ profile, section, onSignOut, children }: { profile: Profile; section: Role; onSignOut: () => Promise<unknown> | void; children: ReactNode }) {
  const location = usePathname();
  const nav = section === 'citizen'
    ? [{ href: '/citizen', text: 'Neighbourhood', icon: MapPin }]
    : section === 'admin' ? [{ href: '/admin', text: 'Operations overview', icon: Activity }]
      : [{ href: '/technician', text: 'My assigned work', icon: Wrench }];
  const labels: Record<Role, string> = { citizen: 'Resident services', admin: 'City operations', technician: 'Field workspace' };
  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <div className="sidebar-label">{labels[section]}</div>
      <nav aria-label="Main navigation">{nav.map(({ href, text, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href ? 'active' : ''}`} data-testid={`link-${section}-nav`}><Icon size={17} />{text}<ChevronRight size={14} style={{ marginLeft: 'auto', opacity: .55 }} /></Link>)}</nav>
      <div className="sidebar-foot"><div className="user-chip"><div className="user-avatar">{initials(profile.full_name)}</div><div className="user-meta"><strong>{profile.full_name || profile.email}</strong><span>{section}</span></div><button className="signout" title="Sign out" onClick={() => void onSignOut()} aria-label="Sign out" data-testid="button-sign-out"><LogOut size={16} /></button></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div className="mobile-top"><span className="brand-mark"><Lightbulb size={15} /></span>SmartStreet</div>
        <span className="crumb">{labels[section]} / Hyderabad</span>
        <div className="top-actions"><span className="crumb">SERVICE STATUS · ACTIVE</span><span className="icon-button" aria-label="Account"><UserRound size={17} /></span></div>
      </header>
      {children}
    </main>
    <nav className="mobile-nav" aria-label="Mobile navigation">{nav.map(({ href, text, icon: Icon }) => <Link key={href} href={href} className={location === href ? 'active' : ''} data-testid={`mobile-link-${section}`}><Icon size={18} />{text}</Link>)}<button onClick={() => void onSignOut()} aria-label="Sign out" style={{ border: 0, background: 'none', color: '#b9ccc3', display: 'grid', gap: 3, placeItems: 'center', fontSize: 9 }} data-testid="mobile-button-sign-out"><LogOut size={17} />Sign out</button></nav>
  </div>;
}

function CitizenDashboard({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const [reporting, setReporting] = useState(false);
  const [lightId, setLightId] = useState('');
  const [issue, setIssue] = useState('not_working');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState('');
  const lights = useQuery({ queryKey: ['streetlights'], queryFn: getStreetlights });
  const reports = useQuery({ queryKey: ['citizen-reports', profile.id], queryFn: () => getCitizenReports(profile.id), enabled: !!profile.id });
  const notifications = useQuery({ queryKey: ['notifications', profile.id], queryFn: () => getNotifications(profile.id), enabled: !!profile.id });
  const create = useMutation({
    mutationFn: createReport,
    onSuccess: async () => { await Promise.all([qc.invalidateQueries({ queryKey: ['citizen-reports', profile.id] }), qc.invalidateQueries({ queryKey: ['streetlights'] })]); setReporting(false); setDescription(''); setLightId(''); setFormError(''); },
  });
  const markRead = useMutation({ mutationFn: markNotificationRead, onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', profile.id] }) });
  const reportItems = (reports.data || []) as Report[];
  const lightItems = (lights.data || []) as Streetlight[];
  const openCount = reportItems.filter((r) => !['verified', 'closed'].includes((r.status || '').toLowerCase())).length;
  const unread = ((notifications.data || []) as NotificationItem[]).filter((n) => !n.is_read).length;
  async function submitReport(event: FormEvent) {
    event.preventDefault(); setFormError('');
    if (!lightId) { setFormError('Choose the closest streetlight to continue.'); return; }
    try { await create.mutateAsync({ streetlightId: lightId, issueType: issue, description: description.trim() }); }
    catch (err) { setFormError(niceError(err)); }
  }
  return <div className="fade-up">
    <div className="page-head"><div><div className="eyebrow">Your neighbourhood · Hyderabad</div><h1>Good day, {profile.full_name?.split(' ')[0] || 'neighbour'}.</h1><p>Streetlight faults, from your report to a verified fix.</p></div><button className="btn terracotta" onClick={() => { setReporting((value) => !value); setFormError(''); }} data-testid="button-report-light"><FileWarning size={15} />{reporting ? 'Close report form' : 'Report a fault'}</button></div>
    <section className="stats-grid">
      <Stat icon={Lightbulb} label="Streetlights listed" value={lights.isLoading ? '—' : lightItems.length} />
      <Stat icon={ClipboardList} label="Your open reports" value={reports.isLoading ? '—' : openCount} />
      <Stat icon={Bell} label="Unread updates" value={notifications.isLoading ? '—' : unread} />
      <Stat icon={CheckCircle2} label="Verified repairs" value={reports.isLoading ? '—' : reportItems.filter((r) => r.status === 'verified').length} />
    </section>
    {reporting && <section className="panel section-gap fade-up">
      <div className="panel-head"><div><h2 className="panel-title">Tell us what needs attention</h2><div className="panel-note">Select a nearby light and describe what you noticed.</div></div><button className="icon-button" aria-label="Close report form" onClick={() => setReporting(false)} data-testid="button-close-report"><X size={16} /></button></div>
      {formError && <div className="error-box" role="alert">{formError}</div>}
      {lights.isLoading ? <Busy label="Finding streetlights" /> : lights.isError ? <Failure error={lights.error} retry={() => void lights.refetch()} /> : lightItems.length === 0 ? <Empty icon={Lightbulb} title="No streetlights are listed yet" copy="The city directory is currently empty. Please try again later." /> :
        <form onSubmit={submitReport} className="two-col">
          <div className="form-field"><label htmlFor="report-light">Nearest streetlight</label><select id="report-light" required value={lightId} onChange={(e) => setLightId(e.target.value)} data-testid="select-streetlight"><option value="">Choose a streetlight</option>{lightItems.map((light) => <option key={light.id} value={light.id}>{light.light_code} · {light.location} ({light.zone})</option>)}</select><span className="helper">Use the code printed on the pole if you can see it.</span></div>
          <div className="form-field"><label htmlFor="issue-type">What is the issue?</label><select id="issue-type" value={issue} onChange={(e) => setIssue(e.target.value)} data-testid="select-issue-type"><option value="not_working">Not working</option><option value="flickering">Flickering</option><option value="damaged">Damaged fixture or pole</option><option value="other">Other electrical fault</option></select></div>
          <div className="form-field" style={{ gridColumn: '1/-1' }}><label htmlFor="description">Helpful details</label><textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Landmark, when you noticed it, or anything a technician should know…" data-testid="input-report-description" /></div>
          <div style={{ gridColumn: '1/-1', display: 'flex', justifyContent: 'flex-end' }}><button className="btn" type="submit" disabled={create.isPending} data-testid="button-submit-report">{create.isPending ? 'Sending report…' : 'Submit report'}<ChevronRight size={15} /></button></div>
        </form>}
    </section>}
     <div className="workspace-grid section-gap">
      <section className="panel"><div className="panel-head"><div><h2 className="panel-title">Streetlight map</h2><div className="panel-note">Each marker reflects the city directory status.</div></div><span className="eyebrow">{lightItems.length} listed</span></div>
         {lights.isLoading ? <Busy label="Loading streetlight directory" /> : lights.isError ? <Failure error={lights.error} retry={() => void lights.refetch()} /> : lightItems.length === 0 ? <Empty icon={MapPin} title="No map points yet" copy="Streetlights will appear here once the city directory is available." /> : <StreetlightMap lights={lightItems} />}
      </section>
      <section className="panel"><div className="panel-head"><div><h2 className="panel-title">Your reports</h2><div className="panel-note">Track the latest service progress.</div></div><ClipboardList size={17} color="#839188" /></div>
        {reports.isLoading ? <Busy label="Loading your reports" /> : reports.isError ? <Failure error={reports.error} retry={() => void reports.refetch()} /> : reportItems.length === 0 ? <Empty icon={FileWarning} title="Nothing to follow yet" copy="When you report a faulty light, its progress will appear here." /> :
          <div className="row-list">{reportItems.slice(0, 6).map((report) => <ReportRow key={report.id} report={report} />)}</div>}
      </section>
    </div>
    <section className="panel section-gap"><div className="panel-head"><div><h2 className="panel-title">Service updates</h2><div className="panel-note">Notifications about your streetlight reports.</div></div><Bell size={17} color="#839188" /></div>
      {notifications.isLoading ? <Busy label="Checking for updates" /> : notifications.isError ? <Failure error={notifications.error} retry={() => void notifications.refetch()} /> : !(notifications.data as NotificationItem[] | undefined)?.length ? <Empty icon={Bell} title="No updates yet" copy="We'll keep this space updated as the city responds to your reports." /> :
        <div className="row-list">{((notifications.data || []) as NotificationItem[]).map((item) => <div className="list-row" key={item.id}><div className="row-icon"><Bell size={16} /></div><div className="row-main"><strong>{item.message}</strong><span>{formatDate(item.created_at)} · {item.is_read ? 'Read' : 'New update'}</span></div>{!item.is_read && <button className="btn small secondary" onClick={() => markRead.mutate(item.id)} disabled={markRead.isPending} data-testid={`button-read-notification-${item.id}`}>Mark read</button>}</div>)}</div>}
    </section>
  </div>;
}

function AdminDashboard({ profile: _profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['admin-data'], queryFn: getAdminData });
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'reports' | 'lights' | 'tasks'>('reports');
  const [message, setMessage] = useState('');
  const assign = useMutation({ mutationFn: ({ reportId, technicianId }: { reportId: string; technicianId: string }) => assignTechnician(reportId, technicianId), onSuccess: () => { setMessage('Technician assigned.'); void qc.invalidateQueries({ queryKey: ['admin-data'] }); } });
  const verify = useMutation({ mutationFn: verifyMaintenanceTask, onSuccess: () => { setMessage('Repair verified.'); void qc.invalidateQueries({ queryKey: ['admin-data'] }); } });
  if (data.isLoading) return <div><PageHeading eyebrow="City operations · Hyderabad" title="Operations overview" subtitle="Coordinate streetlight repairs across the service area." /><div className="stats-grid">{[1, 2, 3, 4].map((n) => <div className="stat-card" key={n}><div className="skeleton" style={{ width: '50%' }} /><div className="skeleton" style={{ width: '35%', height: 28, marginTop: 15 }} /></div>)}</div><Busy label="Loading city service records" /></div>;
  if (data.isError) return <><PageHeading eyebrow="City operations · Hyderabad" title="Operations overview" subtitle="Coordinate streetlight repairs across the service area." /><Failure error={data.error} retry={() => void data.refetch()} /></>;
  const value = data.data as { streetlights: Streetlight[]; reports: Report[]; tasks: Task[]; technicians: Technician[] };
  const lights = value.streetlights || [], reports = value.reports || [], tasks = value.tasks || [], techs = value.technicians || [];
  const activeReports = reports.filter((r) => !['verified', 'closed'].includes((r.status || '').toLowerCase()));
  const unassigned = reports.filter((r) => !tasks.some((task) => task.report_id === r.id && !['verified', 'closed'].includes(task.status)));
  const completed = tasks.filter((t) => ['completed', 'resolved'].includes((t.status || '').toLowerCase()));
  return <div className="fade-up">
    <PageHeading eyebrow="City operations · Hyderabad" title="Operations overview" subtitle="Coordinate streetlight repairs across the service area." />
    {message && <div className="error-box" style={{ borderColor: '#cad9ca', background: '#edf5ec', color: '#42694c' }} role="status"><span>{message}</span><button className="icon-button" onClick={() => setMessage('')} aria-label="Dismiss message"><X size={14} /></button></div>}
    {(assign.isError || verify.isError) && <Failure error={assign.error || verify.error} />}
    <div className="stats-grid">
      <Stat icon={Lightbulb} label="Streetlights in directory" value={lights.length} />
      <Stat icon={FileWarning} label="Open reports" value={activeReports.length} />
      <Stat icon={Construction} label="Tasks awaiting verification" value={completed.length} />
      <Stat icon={UserRound} label="Technicians" value={techs.length} />
    </div>
    <div className="workspace-grid">
      <section className="panel">
        <div className="panel-head"><div><h2 className="panel-title">Service queue</h2><div className="panel-note">Assign work and verify completed repairs.</div></div><div className="filter-tabs">{(['reports', 'tasks', 'lights'] as const).map((tab) => <button key={tab} className={`filter-tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)} data-testid={`button-admin-tab-${tab}`}>{titleCase(tab)}</button>)}</div></div>
        {activeTab === 'reports' && (reports.length === 0 ? <Empty icon={FileWarning} title="No reports in the queue" copy="New resident reports will appear here when submitted." /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Streetlight / issue</th><th>Priority</th><th>Status</th><th>Assign technician</th></tr></thead><tbody>{reports.map((report) => {
          const light = getLightFromReport(report, lights);
          const activeTask = tasks.find((task) => task.report_id === report.id && !['verified', 'closed'].includes(task.status));
          return <tr key={report.id}><td><strong>{light?.light_code || 'Streetlight'}</strong><br /><span className="helper">{report.issue_type.replaceAll('_', ' ')} · {light?.location || 'Location unavailable'}</span></td><td><span className={statusClass(report.priority_level)}>{titleCase(report.priority_level || 'normal')}</span></td><td><span className={statusClass(report.status)}>{titleCase(report.status)}</span></td><td>{activeTask ? <span className="helper">{techs.find((t) => t.id === activeTask.technician_id)?.full_name || 'Assigned'}</span> : <div className="inline-tools"><select aria-label={`Choose technician for ${report.id}`} className="select-compact" value={selected[report.id] || ''} onChange={(e) => setSelected((prev) => ({ ...prev, [report.id]: e.target.value }))} data-testid={`select-technician-${report.id}`}><option value="">Choose technician</option>{techs.map((tech) => <option key={tech.id} value={tech.id}>{tech.full_name}</option>)}</select><button className="btn small" disabled={!selected[report.id] || assign.isPending} onClick={() => assign.mutate({ reportId: report.id, technicianId: selected[report.id] })} data-testid={`button-assign-${report.id}`}>Assign</button></div>}</td></tr>;
        })}</tbody></table></div>)}
        {activeTab === 'tasks' && (tasks.length === 0 ? <Empty icon={Construction} title="No maintenance tasks" copy="Assign a technician from an open report to create a task." /> : <div className="row-list">{tasks.map((task) => {
          const report = getReportForTask(task, reports);
          const light = report ? getLightFromReport(report, lights) : undefined;
          const canVerify = ['completed', 'resolved'].includes(task.status.toLowerCase());
          return <div className="task-card" key={task.id}><div className="task-card-top"><span className="task-code">{light?.light_code || task.report_id}</span><span className={statusClass(task.status)}>{titleCase(task.status)}</span></div><h3>{light?.location || 'Streetlight repair'}</h3><p>{report ? `${titleCase(report.issue_type)} · ${report.description || 'No extra details provided.'}` : 'Report details are no longer available.'}<br />Technician: {techs.find((t) => t.id === task.technician_id)?.full_name || 'Assigned technician'}</p>{canVerify && <button className="btn small" onClick={() => verify.mutate(task.id)} disabled={verify.isPending} data-testid={`button-verify-${task.id}`}><ShieldCheck size={13} />Verify repair</button>}</div>;
        })}</div>)}
        {activeTab === 'lights' && (lights.length === 0 ? <Empty icon={Lightbulb} title="No streetlights found" copy="The streetlight directory is empty." /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Light code</th><th>Location</th><th>Zone</th><th>Status</th></tr></thead><tbody>{lights.map((light) => <tr key={light.id}><td><strong>{light.light_code}</strong></td><td>{light.location}</td><td>{light.zone}</td><td><span className={statusClass(light.status)}>{titleCase(light.status)}</span></td></tr>)}</tbody></table></div>)}
      </section>
      <section className="panel"><div className="panel-head"><div><h2 className="panel-title">Needs attention</h2><div className="panel-note">Reports not yet verified.</div></div><AlertCircle size={17} color="#db7955" /></div>
        {activeReports.length === 0 ? <Empty icon={CheckCircle2} title="Queue is clear" copy="There are no active reports requiring coordination." /> : <div className="row-list">{activeReports.slice(0, 7).map((r) => <ReportRow key={r.id} report={r} light={getLightFromReport(r, lights)} />)}</div>}
      </section>
    </div>
  </div>;
}

function TechnicianDashboard({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const tasks = useQuery({ queryKey: ['technician-tasks', profile.id], queryFn: () => getTechnicianTasks(profile.id), enabled: !!profile.id });
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const invalidate = () => Promise.all([qc.invalidateQueries({ queryKey: ['technician-tasks', profile.id] }), qc.invalidateQueries({ queryKey: ['admin-data'] })]);
  const start = useMutation({ mutationFn: startMaintenanceTask, onSuccess: invalidate });
  const resolve = useMutation({ mutationFn: ({ id, remarks: note }: { id: string; remarks: string }) => resolveMaintenanceTask(id, note), onSuccess: invalidate });
  if (tasks.isLoading) return <div><PageHeading eyebrow="Field workspace · Hyderabad" title="My assigned work" subtitle="Repairs assigned to you by city operations." /><Busy label="Loading your assigned tasks" /></div>;
  if (tasks.isError) return <><PageHeading eyebrow="Field workspace · Hyderabad" title="My assigned work" subtitle="Repairs assigned to you by city operations." /><Failure error={tasks.error} retry={() => void tasks.refetch()} /></>;
  const items = (tasks.data || []) as Task[];
  const active = items.filter((t) => !['verified', 'closed'].includes(t.status.toLowerCase()));
  const inProgress = items.filter((t) => ['started', 'in_progress'].includes(t.status.toLowerCase())).length;
  return <div className="fade-up">
    <PageHeading eyebrow="Field workspace · Hyderabad" title={`Hello, ${profile.full_name?.split(' ')[0] || 'technician'}.`} subtitle="Your assigned streetlight repairs, all in one place." />
    <div className="stats-grid"><Stat icon={ClipboardList} label="Assigned tasks" value={items.length} /><Stat icon={Clock3} label="In progress" value={inProgress} /><Stat icon={CheckCircle2} label="Ready for review" value={items.filter((t) => ['completed', 'resolved'].includes(t.status.toLowerCase())).length} /><Stat icon={MapPin} label="Open tasks" value={active.length} /></div>
    <section className="panel"><div className="panel-head"><div><h2 className="panel-title">Your work queue</h2><div className="panel-note">Only tasks assigned to your account are shown here.</div></div><Wrench size={17} color="#839188" /></div>
      {items.length === 0 ? <Empty icon={Construction} title="No assigned repairs" copy="When city operations assigns a task to you, it will appear here." /> :
        <div className="row-list">{items.map((task) => {
          const report = task.report as Report | undefined;
          const light = report ? (report.streetlight || report.light) : undefined;
          const status = (task.status || '').toLowerCase();
          const done = ['completed', 'resolved', 'verified', 'closed'].includes(status);
          const started = ['started', 'in_progress'].includes(status);
          return <article className="task-card" key={task.id} data-testid={`card-task-${task.id}`}>
            <div className="task-card-top"><span className="task-code">{light?.light_code || `TASK ${task.id.slice(0, 8)}`}</span><span className={statusClass(task.status)}>{titleCase(task.status)}</span></div>
            <h3>{light?.location || report?.issue_type?.replaceAll('_', ' ') || 'Streetlight repair'}</h3>
            <p>{report?.description || 'No extra details were provided for this repair.'}{light?.zone ? ` · ${light.zone}` : ''}<br />Assigned {formatDate(task.assigned_at)}</p>
            {errors[task.id] && <div className="notice">{errors[task.id]}</div>}
            {!done && (started ? <div className="task-actions"><textarea aria-label={`Repair remarks for task ${task.id}`} value={remarks[task.id] || ''} onChange={(e) => setRemarks((old) => ({ ...old, [task.id]: e.target.value }))} placeholder="Work completed, parts replaced, or follow-up needed…" style={{ flex: 1, minHeight: 42, maxHeight: 90, border: '1px solid #ddd8cc', borderRadius: 8, padding: 9, fontSize: 11 }} data-testid={`input-remarks-${task.id}`} /><button className="btn small terracotta" disabled={resolve.isPending} onClick={() => { if (!remarks[task.id]?.trim()) { setErrors((old) => ({ ...old, [task.id]: 'Add a brief note about the repair before resolving.' })); return; } setErrors((old) => ({ ...old, [task.id]: '' })); resolve.mutate({ id: task.id, remarks: remarks[task.id].trim() }); }} data-testid={`button-resolve-${task.id}`}><Check size={13} />Resolve task</button></div> : <button className="btn small" disabled={start.isPending} onClick={() => start.mutate(task.id)} data-testid={`button-start-${task.id}`}><Wrench size={13} />Start repair</button>)}
            {done && <div className="helper"><CheckCircle2 size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Submitted for city verification{task.completed_at ? ` · ${formatDate(task.completed_at)}` : ''}</div>}
          </article>;
        })}</div>}
    </section>
  </div>;
}

function Stat({ icon: Icon, label, value }: { icon: typeof Lightbulb; label: string; value: number | string }) {
  return <div className="stat-card" data-testid={`stat-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon className="stat-mark" size={17} /><div className="stat-label">{label}</div><div className="stat-number">{value}</div></div>;
}
function PageHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <div className="page-head"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div></div>;
}
function getLightFromReport(report: Report, lights: Streetlight[]) {
  return report.streetlight || report.light || lights.find((light) => light.id === report.streetlight_id);
}
function getReportForTask(task: Task, reports: Report[]) { return task.report || reports.find((r) => r.id === task.report_id); }
function ReportRow({ report, light }: { report: Report; light?: Streetlight }) {
  return <div className="list-row" data-testid={`row-report-${report.id}`}><div className="row-icon"><Lightbulb size={16} /></div><div className="row-main"><strong>{light?.light_code || report.streetlight?.light_code || report.light?.light_code || 'Streetlight report'} · {titleCase(report.issue_type)}</strong><span>{(light || report.streetlight || report.light)?.location || 'Location unavailable'} · Reported {formatDate(report.created_at)}</span></div><span className={statusClass(report.status)}>{titleCase(report.status)}</span></div>;
}

function App() {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 25_000, retry: 1, refetchOnWindowFocus: false } },
  }));
  return <QueryClientProvider client={client}><TooltipProvider><AppRouter /><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
