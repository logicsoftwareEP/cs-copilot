import { Routes, Route, Navigate } from 'react-router-dom';
import Portfolio from './pages/Portfolio';
import Admin from './pages/Admin';
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
      <Route path="/mapping" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
