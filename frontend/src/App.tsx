import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuthStore } from './stores/auth'
import { useRoleStore } from './stores/roles'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import ShiftPage from './pages/ShiftPage'
import EmployeesPage from './pages/EmployeesPage'
import EmployeePrioritiesPage from './pages/EmployeePrioritiesPage'
import WorkPatternsPage from './pages/WorkPatternsPage'
import DayTemplatesPage from './pages/DayTemplatesPage'
import ChoiceGroupsPage from './pages/ChoiceGroupsPage'
import PatternTriggersPage from './pages/PatternTriggersPage'
import UsersPage from './pages/UsersPage'
import RolesPage from './pages/RolesPage'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  const currentUser = useAuthStore((s) => s.currentUser)
  if (!token) return <Navigate to="/login" replace />
  // /auth/me ロード中は loading 表示 (currentUser=null)
  if (currentUser === null) {
    return <div className="p-8 text-ink-muted">権限を確認中…</div>
  }
  if (!currentUser.is_admin) return <Navigate to="/shift" replace />
  return <>{children}</>
}

export default function App() {
  const token = useAuthStore((s) => s.token)
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser)
  const fetchRoles = useRoleStore((s) => s.fetch)
  useEffect(() => {
    if (token) {
      fetchCurrentUser()
      fetchRoles()
    }
  }, [token, fetchCurrentUser, fetchRoles])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route path="/" element={<Navigate to="/shift" replace />} />
          <Route path="/shift" element={<ShiftPage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/employee-priorities" element={<EmployeePrioritiesPage />} />
          <Route path="/work-patterns" element={<WorkPatternsPage />} />
          <Route path="/day-templates" element={<DayTemplatesPage />} />
          <Route path="/choice-groups" element={<ChoiceGroupsPage />} />
          <Route path="/pattern-triggers" element={<PatternTriggersPage />} />
          <Route
            path="/admin/users"
            element={
              <AdminRoute>
                <UsersPage />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/roles"
            element={
              <AdminRoute>
                <RolesPage />
              </AdminRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/shift" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
