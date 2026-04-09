import { Routes, Route, Navigate } from 'react-router-dom';
import Portfolio from './pages/Portfolio';
import Admin from './pages/Admin';
import Troubleshoot from './pages/Troubleshoot';
import Diagnostics from './pages/Diagnostics';
import { useAuth } from './contexts/AuthContext';

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/" element={<Portfolio />} />
      <Route
        path="/admin"
        element={user?.role === 'admin' ? <Admin /> : <Navigate to="/" replace />}
      />
      <Route
        path="/troubleshoot"
        element={user?.role === 'admin' ? <Troubleshoot /> : <Navigate to="/" replace />}
      />
      <Route
        path="/diagnostics"
        element={user?.role === 'admin' ? <Diagnostics /> : <Navigate to="/" replace />}
      />
      <Route path="/mapping" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
