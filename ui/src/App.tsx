// Route map. Three trees behind one Service/proxy (ui/NOTES.md §5, §7):
//   member (public)  /  /services  /about
//   operator (gated) /ops           — lazy chunk, telemetry lives here
//   presenter        /present       — lazy chunk
// Ops and presenter are React.lazy, so their code (and lib/ops, the verdict
// stream) ships in separate chunks the member surface never requests.

import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { MemberLayout } from "./member/MemberLayout";
import { Home } from "./member/Home";
import { About } from "./member/About";
import { Services } from "./member/Services";
import { Spinner } from "./ui/primitives";

const OpsConsole = lazy(() => import("./ops/OpsConsole").then((m) => ({ default: m.OpsConsole })));
const OpsGate = lazy(() => import("./ops/OpsGate").then((m) => ({ default: m.OpsGate })));
const Presenter = lazy(() => import("./present/Presenter").then((m) => ({ default: m.Presenter })));

function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner label="Loading…" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* member surface */}
        <Route element={<MemberLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/services" element={<Services />} />
          <Route path="/about" element={<About />} />
        </Route>

        {/* operator console, behind the gate */}
        <Route
          path="/ops"
          element={
            <Suspense fallback={<Loading />}>
              <OpsGate>
                <OpsConsole />
              </OpsGate>
            </Suspense>
          }
        />

        {/* presenter mode */}
        <Route
          path="/present"
          element={
            <Suspense fallback={<Loading />}>
              <Presenter />
            </Suspense>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
