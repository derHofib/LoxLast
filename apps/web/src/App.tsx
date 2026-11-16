import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppHeader } from './components/AppHeader';
import { ProjectShell } from './components/ProjectShell';
import { Components } from './pages/Components';
import { ProjectList } from './pages/ProjectList';
import { startLibraryUpdates } from './library/update';
import { startChecks } from './state/checksStore';
import { useShortcuts } from './state/useShortcuts';
import { startAutosave, type SaveStatus } from './storage/autosave';
import { repository } from './storage/db';

/**
 * App-Rahmen. HashRouter, weil die App statisch ohne Serverkonfiguration ausgeliefert wird (ADR 0002).
 */
export function App() {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  useShortcuts();
  useEffect(() => startAutosave(repository, (s) => setSaveStatus(s)), []);
  useEffect(() => startChecks(), []);
  useEffect(() => {
    void startLibraryUpdates();
  }, []);

  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppHeader saveStatus={saveStatus} />
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/komponenten" element={<Components />} />
        <Route path="/projekt/:id/:tab?" element={<ProjectShell />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
