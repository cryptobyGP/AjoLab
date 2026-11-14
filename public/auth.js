/* Sign-in. Real sign-in is Privy (Google or email). Demo sign-in is used only when the server has no Privy app yet. */
window.AjoAuth = (function () {
  const A = { cfg: null, privy: null, ready: false, listeners: [] };
  const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const emit = () => A.listeners.forEach(f => f());
  A.on = f => A.listeners.push(f);
  const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

  A.init = async function (cfg) {
    A.cfg = cfg;
    if (!cfg.privyAppId) { A.ready = true; emit(); return; }
    try {
      const [R, D, P] = await Promise.all([
        import('https://esm.sh/react@18.3.1'),
        import('https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1'),
        import('https://esm.sh/@privy-io/react-auth@2?deps=react@18.3.1,react-dom@18.3.1')]);
      const React = R.default || R, h = React.createElement;
      function Bridge() {
        const p = P.usePrivy(); A.privy = p;
        React.useEffect(() => { A.ready = p.ready; emit(); });
        return null;
      }
      const root = document.createElement('div'); root.style.display = 'none'; document.body.appendChild(root);
      D.createRoot(root).render(h(P.PrivyProvider, { appId: cfg.privyAppId, config: { appearance: { theme: 'dark', accentColor: '#3FD68B' }, loginMethods: ['google', 'email'] } }, h(Bridge)));
    } catch (e) { console.error(e); A.error = 'Sign-in could not load. Check your connection and refresh.'; A.ready = true; emit(); }
  };
  A.authed = () => A.cfg && (A.cfg.privyAppId ? !!(A.privy && A.privy.authenticated) : !!get('ajo_demo'));
  A.email = () => {
    if (!A.cfg.privyAppId) return get('ajo_demo') || '';
    const u = A.privy && A.privy.user; return (u && ((u.email && u.email.address) || (u.google && u.google.email))) || '';
  };
  A.token = async () => {
    if (!A.cfg.privyAppId) { const e = get('ajo_demo'); return e ? 'demo.' + b64(e) : null; }
    return A.privy && A.privy.authenticated ? A.privy.getAccessToken() : null;
  };
  A.login = async (method, email) => {
    if (!A.cfg.privyAppId) {
      if (method === 'google') throw new Error('Google sign-in switches on once Privy is connected. For now, use your email.');
      if (!/^\S+@\S+\.\S+$/.test(email || '')) throw new Error('Enter a valid email address');
      put('ajo_demo', email.trim().toLowerCase()); emit(); return;
    }
    if (!A.privy || !A.privy.ready) throw new Error('Sign-in is still loading. Try again in a moment.');
    if (method === 'google') return A.privy.login({ loginMethods: ['google'] });
    if (!/^\S+@\S+\.\S+$/.test(email || '')) throw new Error('Enter a valid email address');
    return A.privy.login({ loginMethods: ['email'], prefill: { type: 'email', value: email.trim() } });
  };
  A.logout = async () => { put('ajo_demo', null); if (A.privy && A.privy.authenticated) await A.privy.logout(); emit(); };
  return A;
})();
