import { Routes, Route, Navigate } from 'react-router-dom';
import Portfolio from './pages/Portfolio';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Portfolio />} />
      {/* Legacy mapping route — alias editing is now inline in the portfolio grid */}
      <Route path="/mapping" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
