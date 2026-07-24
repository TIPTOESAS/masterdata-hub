import React, { useState } from 'react';
import { signInWithGoogle } from '../services/auth';

const Login: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <img className="login-mark" src={process.env.PUBLIC_URL + '/favicon.svg'} alt="" />
        <div className="login-title">Master Data Hub</div>
        <p className="login-sub">Hiérarchie produit · variantes · logistique · pricing · traductions · BOM</p>
        <button className="login-btn" onClick={handleLogin} disabled={loading}>
          {loading ? 'Connexion…' : 'Se connecter avec Google'}
        </button>
        {error && <p className="login-err">{error}</p>}
        <p className="login-note">Réservé aux adresses @tiptoe.fr</p>
      </div>
    </div>
  );
};

export default Login;
