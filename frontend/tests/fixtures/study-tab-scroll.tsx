import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useStudyTabScroll } from "../../src/useStudyTabScroll";
function Fixture() {
  const [tab, setTab] = useState("Scripture");
  useStudyTabScroll(tab, new URLSearchParams(location.search).has("reader"));
  return <><header style={{ height: 700 }}>Study introduction</header><nav id="viewport-2-b-tabs" style={{ position: "sticky", top: 0, height: 90, background: "white" }}>{["Scripture", "Commentary"].map(name => <button key={name} onClick={() => setTab(name)}>{name}</button>)}</nav><section id="study-panel" style={{ minHeight: 3000 }}><h2>{tab} start</h2></section></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
