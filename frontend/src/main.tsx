import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { UserPage } from "./pages/UserPage";
import { ResponderPage } from "./pages/ResponderPage";
import { SimPage } from "./pages/SimPage";
import { DevPage } from "./pages/DevPage";

function Home() {
  return (
    <main className="page">
      <h1>GuideWing prototype</h1>
      <p className="notice">Simulated journey, simulated responder organization. Not an emergency service.</p>
      <nav aria-label="Views">
        <ul className="home-links">
          <li><a href="/user">User companion page</a></li>
          <li><a href="/responder">Responder dashboard</a></li>
          <li><a href="/sim">2D simulation fallback</a></li>
          <li><a href="/dev">Developer controls (TEST)</a></li>
        </ul>
      </nav>
    </main>
  );
}

const pages: Record<string, () => React.JSX.Element> = {
  "/user": UserPage,
  "/responder": ResponderPage,
  "/sim": SimPage,
  "/dev": DevPage,
};
const Page = pages[location.pathname.replace(/\/$/, "")] ?? Home;
document.title = `GuideWing — ${location.pathname.replace("/", "") || "home"}`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
