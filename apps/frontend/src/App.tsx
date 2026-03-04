import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import LobbyBrowserPage from './pages/LobbyBrowserPage';
import LobbyRoomPage from './pages/LobbyRoomPage';
import MatchPage from './pages/MatchPage';
import ProfilePage from './pages/ProfilePage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Loading…</div>;
  if (session) return <Navigate to="/lobbies" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/lobbies" element={<ProtectedRoute><LobbyBrowserPage /></ProtectedRoute>} />
        <Route path="/lobbies/:lobbyId" element={<ProtectedRoute><LobbyRoomPage /></ProtectedRoute>} />
        <Route path="/match/:matchId" element={<ProtectedRoute><MatchPage /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/lobbies" replace />} />
      </Routes>
    </AuthProvider>
  );
}
