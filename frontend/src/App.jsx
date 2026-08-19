import { BrowserRouter, Routes, Route } from "react-router-dom"
import MobileShell from "./components/layout/MobileShell"
import AuthGate from "./components/auth/AuthGate"
import Dashboard from "./pages/Dashboard"
import TablePage from "./pages/TablePage"
import TableSettingsPage from "./pages/TableSettingsPage"
import SessionPage from "./pages/SessionPage"
import SummaryPage from "./pages/SummaryPage"
import LearnPage from "./pages/LearnPage"
import CalculatorPage from "./pages/CalculatorPage"
import SettingsPage from "./pages/SettingsPage"
import LoginPage from "./pages/LoginPage"
import ResetPasswordPage from "./pages/ResetPasswordPage"
import LandingPage from "./pages/LandingPage"
import SharedTablePage from "./pages/SharedTablePage"

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/shared/:token" element={<SharedTablePage />} />
        <Route element={<AuthGate />}>
          <Route element={<MobileShell />}>
            <Route path="/tables" element={<Dashboard />} />
            <Route path="/table/:id/settings" element={<TableSettingsPage />} />
            <Route path="/table/:id" element={<TablePage />} />
            <Route path="/session/:id" element={<SessionPage />} />
            <Route path="/summary/:id" element={<SummaryPage />} />
            <Route path="/learn" element={<LearnPage />} />
            <Route path="/calculator" element={<CalculatorPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
