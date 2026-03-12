import { Routes, Route } from 'react-router-dom';
import Portfolio from './pages/Portfolio';
import Mapping from './pages/Mapping';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Portfolio />} />
      <Route path="/mapping" element={<Mapping />} />
    </Routes>
  );
}
