import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import DashboardLayout from './layouts/DashboardLayout';
import ActivatePage from './pages/ActivatePage';
import ComptePage from './pages/ComptePage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import GestionPage from './pages/GestionPage';
import InvitesPage from './pages/InvitesPage';
import LoginPage from './pages/LoginPage';
import PortailPage from './pages/PortailPage';
import ResetPasswordPage from './pages/ResetPasswordPage';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/activate" element={<ActivatePage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<PortailPage />} />
        <Route path="/invites" element={<InvitesPage />} />
        <Route path="/gestion" element={<GestionPage />} />
        <Route path="/compte" element={<ComptePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
