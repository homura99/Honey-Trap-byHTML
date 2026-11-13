# Silhouette and standing assets

Place character silhouette or standing images in this folder. Transparent PNG
or WebP images work well when the image should blend into the background.

Reference images from scenario YAML with their URL paths under `public/`:

```yaml
silhouettes:
  - image: /images/silhouettes/wana.png
    left: 58
    bottom: 8
    width: 34
    opacity: 78
    brightness: 42
```

Position, width, opacity, and brightness values are percentages from 0 to 100.
Use multiple entries in `silhouettes` to show more than one person. A CSS
placeholder can be used instead with `placeholder: true`.
