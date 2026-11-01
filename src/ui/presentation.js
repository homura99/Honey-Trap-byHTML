function localAssetPath(value) {
  if (typeof value !== "string" || !value.trim() || value.startsWith("//")) {
    return null;
  }
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" || !url.pathname.startsWith("/")) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function escapeAttribute(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

export function resolveDisplayMode(line, override = null) {
  if (override === "bottom" || override === "fullscreen") {
    return override;
  }
  return line?.displayMode === "fullscreen" ? "fullscreen" : "bottom";
}

export function resolvePresentation(line) {
  if (!line || typeof line !== "object") {
    return {
      backgroundImage: null,
      silhouetteImage: null,
      bgm: null,
      soundEffects: [],
    };
  }

  return {
    backgroundImage: localAssetPath(line.backgroundImage),
    silhouetteImage: localAssetPath(line.silhouetteImage),
    bgm: typeof line.bgm === "string" ? line.bgm : null,
    soundEffects: Array.isArray(line.soundEffects)
      ? line.soundEffects.filter((cue) => typeof cue === "string")
      : [],
  };
}

export function renderScenePresentation(presentation) {
  const scene = presentation ?? resolvePresentation(null);
  const background = scene.backgroundImage
    ? `<img class="scene-background-image" src="${escapeAttribute(scene.backgroundImage)}" alt="" />`
    : "";
  const silhouette = scene.silhouetteImage
    ? `<img class="scene-silhouette" src="${escapeAttribute(scene.silhouetteImage)}" alt="" />`
    : "";

  return `
    <div class="scene-background" aria-hidden="true">${background}</div>
    ${silhouette}
  `;
}

export class PresentationController {
  constructor() {
    this.lastPresentation = null;
  }

  update(root, presentation, cueId) {
    const cue = {
      bgm: presentation.bgm,
      soundEffects: presentation.soundEffects,
    };
    const serialized = JSON.stringify({ cue, cueId });
    if (serialized === this.lastPresentation) {
      return;
    }
    this.lastPresentation = serialized;
    const EventConstructor = root.ownerDocument.defaultView.CustomEvent;
    root.dispatchEvent(new EventConstructor("game:presentation", { detail: cue }));
  }
}
