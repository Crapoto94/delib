import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, getActAs, getOrgId, getToken, setActAs, setOrgId, setToken } from './api';

export type Organisme = { id: number; code: string; nom: string; type: string; isDefault: boolean; roles: string[]; via?: string; hasLogo?: boolean; logoVersion?: string | null; contact?: Record<string, string>; adresse?: string | null };
export type Me = {
  username: string; displayName: string; email: string | null; kind: string; isPlatformAdmin: boolean;
  agent: null | { displayName?: string; prenom?: string | null; nom?: string | null; direction?: { code: string; label: string }; service?: { code: string; label: string } | null; poste?: string };
  organismes: Organisme[]; defaultOrganismeId: number | null; onboarding: { toShow: any[] };
  impersonation: null | { by: string }; canImpersonate: boolean;
};
type Ctx = {
  me: Me | null; loading: boolean; org: Organisme | null; setOrg: (id: number) => void; isAdmin: boolean; isScc: boolean;
  startActAs: (username: string) => Promise<void>; stopActAs: () => void;
  login: (u: string, p: string, local?: boolean) => Promise<void>; logout: () => Promise<void>; reload: () => Promise<void>;
};
const AuthCtx = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!getToken());
  const [orgId, setOrgIdState] = useState<number | null>(getOrgId());

  const reload = useCallback(async () => {
    if (!getToken()) { setMe(null); setLoading(false); return; }
    try { setMe((await api.get('/me')).data); } catch { setMe(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const org = me ? (me.organismes.find((o) => o.id === orgId) ?? me.organismes.find((o) => o.id === me.defaultOrganismeId) ?? me.organismes[0] ?? null) : null;
  const roles = org?.roles ?? [];
  const value: Ctx = {
    me, loading, org, reload,
    setOrg: (id) => { setOrgId(id); setOrgIdState(id); },
    isAdmin: !!me?.isPlatformAdmin || roles.includes('org_admin'),
    isScc: !!me?.isPlatformAdmin || roles.includes('org_admin') || roles.includes('scc'),
    login: async (username, password, local) => {
      const r = await api.post(local ? '/auth/login-local' : '/auth/login', { username, password });
      setToken(r.data.token); setLoading(true); await reload();
    },
    startActAs: async (username) => { await api.post('/auth/act-as', { username }); setActAs(username.toLowerCase()); window.location.href = '/'; },
    stopActAs: () => { const u = getActAs(); setActAs(null); if (u) api.delete('/auth/act-as', { params: { username: u } }).catch(() => {}); window.location.href = '/'; },
    logout: async () => { try { await api.post('/auth/logout'); } catch { /* déjà expirée */ } setToken(null); setActAs(null); setMe(null); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
