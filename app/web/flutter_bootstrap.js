{{flutter_js}}
{{flutter_build_config}}

// CanvasKit is served by Tideover itself (fast and reliable); fallback fonts for
// scripts Inter doesn't cover (Arabic, CJK, emoji…) come from Google Fonts.
_flutter.loader.load({
  config: {
    canvasKitBaseUrl: "canvaskit/",
    fontFallbackBaseUrl: "https://fonts.gstatic.com/s/",
  },
});
