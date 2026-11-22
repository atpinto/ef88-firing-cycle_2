// Keep the photographic exterior and transparency control available without WebGL.
function showReferenceView() {
  if (document.body.classList.contains("reference-mode")) return;
  document.body.classList.add("reference-mode");
  const get = id => document.getElementById(id);
  const sheet = get("referenceView");
  const slider = get("bodyT");
  const requested = new URLSearchParams(location.search);
  let lastLevel = Number(slider.value) || 66;
  const poses = ["left", "right", "iso", "top"];
  function selectView(view) {
    const index = poses.indexOf(view);
    sheet.style.backgroundPosition = "center " + (index * 100 / 3) + "%";
    sheet.setAttribute("aria-label", {left:"Left", right:"Right", iso:"Three-quarter", top:"Overhead"}[view] + " exterior with magazine");
    for (const b of get("views").querySelectorAll("button")) {
      b.hidden = !poses.includes(b.dataset.view);
      b.setAttribute("aria-pressed", b.dataset.view === view);
    }
  }
  function sync() {
    const level = Number(slider.value);
    if (level) lastLevel = level;
    sheet.style.opacity = 1 - level/100;
    get("bodyO").textContent = level + "%";
    for (const b of get("body").querySelectorAll("button")) {
      b.setAttribute("aria-pressed", (b.dataset.b === "solid") === (level === 0));
    }
  }
  get("views").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (b && poses.includes(b.dataset.view)) selectView(b.dataset.view);
  });
  get("body").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (b) { slider.value = b.dataset.b === "solid" ? 0 : lastLevel; sync(); }
  });
  slider.addEventListener("input", sync);
  slider.value = requested.get("body") === "see" ? lastLevel : 0;
  selectView(poses.includes(requested.get("view")) ? requested.get("view") : "iso");
  sync();
}
