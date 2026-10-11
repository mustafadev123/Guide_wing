import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { UserPage } from "./pages/UserPage";
import { ResponderPage } from "./pages/ResponderPage";
import { SimPage } from "./pages/SimPage";
import { DevPage } from "./pages/DevPage";

const pages: Record<string, () => React.JSX.Element> = {
  "": UserPage,
  "/user": UserPage,
  "/responder": ResponderPage,
  "/sim": SimPage,
  "/dev": DevPage,
};
const Page = pages[location.pathname.replace(/\/$/, "")] ?? UserPage;
document.title = `GuideWing — ${location.pathname.replace("/", "") || "home"}`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
