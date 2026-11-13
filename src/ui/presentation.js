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
      scene: null,
      silhouetteImage: null,
      silhouettes: [],
      bgm: null,
      soundEffects: [],
    };
  }

  const silhouettes = Array.isArray(line.silhouettes)
    ? line.silhouettes.filter((silhouette) =>
      silhouette && typeof silhouette === "object" && !Array.isArray(silhouette),
    )
    : [];
  if (line.silhouetteImage) {
    silhouettes.unshift({ image: line.silhouetteImage });
  }

  return {
    backgroundImage: localAssetPath(line.backgroundImage),
    scene: typeof line.scene === "string" && /^[a-z][a-z0-9-]*$/.test(line.scene)
      ? line.scene
      : null,
    silhouetteImage: localAssetPath(line.silhouetteImage),
    silhouettes: silhouettes.map((silhouette) => ({
      image: localAssetPath(silhouette.image),
      placeholder: silhouette.placeholder === true,
      left: finitePercentage(silhouette.left, 58),
      bottom: finitePercentage(silhouette.bottom, 8),
      width: finitePercentage(silhouette.width, 34),
      opacity: finitePercentage(silhouette.opacity, 78) / 100,
      brightness: finitePercentage(silhouette.brightness, 42) / 100,
    })).filter((silhouette) => silhouette.image || silhouette.placeholder),
    bgm: typeof line.bgm === "string" ? line.bgm : null,
    soundEffects: Array.isArray(line.soundEffects)
      ? line.soundEffects.filter((cue) => typeof cue === "string")
      : [],
  };
}

function finitePercentage(value, fallback) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : fallback;
}

export function renderScenePresentation(presentation) {
  const scene = presentation ?? resolvePresentation(null);
  const background = scene.backgroundImage
    ? `<img class="scene-background-image" src="${escapeAttribute(scene.backgroundImage)}" alt="" />`
    : "";
  const silhouettes = scene.silhouettes?.length
    ? scene.silhouettes
    : scene.silhouetteImage
      ? [{ image: scene.silhouetteImage, left: 58, bottom: 8, width: 34, opacity: 0.78, brightness: 0.42 }]
      : [];
  const silhouetteMarkup = silhouettes.map((silhouette) => {
    const style = [
      `--silhouette-left:${silhouette.left}%`,
      `--silhouette-bottom:${silhouette.bottom}%`,
      `--silhouette-width:${silhouette.width}%`,
      `--silhouette-opacity:${silhouette.opacity}`,
      `--silhouette-brightness:${silhouette.brightness}`,
    ].join(";");
    const content = silhouette.placeholder
      ? `<span class="silhouette-placeholder-shape"></span>`
      : `<img src="${escapeAttribute(silhouette.image)}" alt="" />`;
    return `<div class="scene-silhouette${silhouette.placeholder ? " scene-silhouette--placeholder" : ""}" style="${style}" aria-hidden="true">${content}</div>`;
  }).join("");

  return `
    <div class="scene-background${scene.scene ? ` scene-background--${escapeAttribute(scene.scene)}` : ""}" aria-hidden="true">${background}</div>
    ${silhouetteMarkup}
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
