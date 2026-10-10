import 'package:flutter/material.dart';

/// Tideover design tokens: calm, warm, trustworthy.
abstract final class T {
  static const ink = Color(0xFF14211D);
  static const inkSoft = Color(0xFF2E3F3A);
  static const muted = Color(0xFF5B6B66);
  static const faint = Color(0xFF8A9893);
  static const paper = Color(0xFFF6F4EF);
  static const paperDeep = Color(0xFFEDE9E0);
  static const surface = Color(0xFFFFFFFF);
  static const line = Color(0xFFE6E1D6);
  static const teal = Color(0xFF0E7C66);
  static const tealDark = Color(0xFF0A5C4C);
  static const tealSoft = Color(0xFFE2F1EC);
  static const sun = Color(0xFFF2B33D);
  static const sunSoft = Color(0xFFFFF4DB);
  static const coral = Color(0xFFE5603B);
  static const coralSoft = Color(0xFFFDEBE5);
  static const danger = Color(0xFFB42318);
  static const dangerSoft = Color(0xFFFDECEA);
  static const warn = Color(0xFFB54708);
  static const warnSoft = Color(0xFFFFF3E0);
  static const info = Color(0xFF3B5BDB);
  static const infoSoft = Color(0xFFEDF1FF);
  static const paypal = Color(0xFF003087);
  static const paypalLight = Color(0xFF0070E0);
  static const venmo = Color(0xFF008CFF);

  static const r8 = BorderRadius.all(Radius.circular(8));
  static const r12 = BorderRadius.all(Radius.circular(12));
  static const r16 = BorderRadius.all(Radius.circular(16));
  static const r20 = BorderRadius.all(Radius.circular(20));
  static const r28 = BorderRadius.all(Radius.circular(28));

  static const shadow = [
    BoxShadow(color: Color(0x0F14211D), blurRadius: 24, offset: Offset(0, 8)),
    BoxShadow(color: Color(0x0A14211D), blurRadius: 2, offset: Offset(0, 1)),
  ];

  static Color parseHex(String hex, [Color fallback = teal]) {
    final h = hex.replaceAll('#', '');
    if (h.length != 6) return fallback;
    final v = int.tryParse(h, radix: 16);
    return v == null ? fallback : Color(0xFF000000 | v);
  }
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: T.teal,
    brightness: Brightness.light,
  ).copyWith(
    primary: T.teal,
    onPrimary: Colors.white,
    secondary: T.sun,
    surface: T.surface,
    onSurface: T.ink,
    error: T.danger,
    outline: T.line,
    outlineVariant: T.line,
  );

  const body = 'Inter'; // every style names its family explicitly (copyWith replaces styles)
  const display = 'InterDisplay';
  final base = ThemeData(useMaterial3: true, colorScheme: scheme, fontFamily: body);
  final text = base.textTheme
      .copyWith(
        displayLarge: const TextStyle(fontFamily: display, fontWeight: FontWeight.w800, fontSize: 56, height: 1.02, letterSpacing: -1.6),
        displayMedium: const TextStyle(fontFamily: display, fontWeight: FontWeight.w800, fontSize: 44, height: 1.05, letterSpacing: -1.2),
        displaySmall: const TextStyle(fontFamily: display, fontWeight: FontWeight.w700, fontSize: 34, height: 1.1, letterSpacing: -0.8),
        headlineMedium: const TextStyle(fontFamily: display, fontWeight: FontWeight.w700, fontSize: 28, height: 1.15, letterSpacing: -0.5),
        headlineSmall: const TextStyle(fontFamily: display, fontWeight: FontWeight.w700, fontSize: 22, height: 1.2, letterSpacing: -0.3),
        titleLarge: const TextStyle(fontFamily: body, fontWeight: FontWeight.w700, fontSize: 19, letterSpacing: -0.2),
        titleMedium: const TextStyle(fontFamily: body, fontWeight: FontWeight.w600, fontSize: 16),
        titleSmall: const TextStyle(fontFamily: body, fontWeight: FontWeight.w600, fontSize: 14),
        bodyLarge: const TextStyle(fontFamily: body, fontSize: 16, height: 1.5),
        bodyMedium: const TextStyle(fontFamily: body, fontSize: 14.5, height: 1.45),
        bodySmall: const TextStyle(fontFamily: body, fontSize: 12.5, height: 1.4, color: T.muted),
        labelLarge: const TextStyle(fontFamily: body, fontWeight: FontWeight.w600, fontSize: 15),
        labelMedium: const TextStyle(fontFamily: body, fontWeight: FontWeight.w600, fontSize: 12.5),
        labelSmall: const TextStyle(fontFamily: body, fontWeight: FontWeight.w600, fontSize: 11, letterSpacing: 0.4),
      )
      .apply(bodyColor: T.ink, displayColor: T.ink);

  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(14));
  return base.copyWith(
    textTheme: text,
    scaffoldBackgroundColor: T.paper,
    canvasColor: T.paper,
    dividerColor: T.line,
    dividerTheme: const DividerThemeData(color: T.line, thickness: 1, space: 1),
    appBarTheme: const AppBarTheme(
      backgroundColor: T.paper,
      foregroundColor: T.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w700, fontSize: 17, color: T.ink),
    ),
    cardTheme: const CardThemeData(
      color: T.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: T.r20, side: BorderSide(color: T.line)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(64, 50),
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
        shape: shape,
        textStyle: const TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w700, fontSize: 15.5),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(64, 50),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        shape: shape,
        foregroundColor: T.ink,
        side: const BorderSide(color: T.line, width: 1.2),
        textStyle: const TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w600, fontSize: 15),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: T.teal,
        textStyle: const TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w600, fontSize: 14.5),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: T.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: T.line)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: T.line)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: T.teal, width: 1.6)),
      hintStyle: const TextStyle(color: T.faint),
      labelStyle: const TextStyle(color: T.muted),
    ),
    chipTheme: base.chipTheme.copyWith(
      side: const BorderSide(color: T.line),
      shape: const StadiumBorder(),
      backgroundColor: T.surface,
      selectedColor: T.tealSoft,
      labelStyle: const TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w600, fontSize: 13, color: T.ink),
    ),
    snackBarTheme: const SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: T.ink,
      contentTextStyle: TextStyle(fontFamily: 'Inter', color: Colors.white, fontSize: 14),
      shape: RoundedRectangleBorder(borderRadius: T.r12),
    ),
    navigationRailTheme: const NavigationRailThemeData(
      backgroundColor: T.surface,
      indicatorColor: T.tealSoft,
      selectedIconTheme: IconThemeData(color: T.tealDark),
      selectedLabelTextStyle: TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w700, fontSize: 12.5, color: T.tealDark),
      unselectedLabelTextStyle: TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w600, fontSize: 12.5, color: T.muted),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: T.surface,
      indicatorColor: T.tealSoft,
      labelTextStyle: WidgetStateProperty.all(
        const TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w600, fontSize: 12),
      ),
    ),
    dialogTheme: const DialogThemeData(backgroundColor: T.surface, shape: RoundedRectangleBorder(borderRadius: T.r20)),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: T.surface,
      showDragHandle: true,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    ),
    tooltipTheme: const TooltipThemeData(
      decoration: BoxDecoration(color: T.ink, borderRadius: T.r8),
      textStyle: TextStyle(fontFamily: 'Inter', color: Colors.white, fontSize: 12.5),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: T.teal),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Colors.white : null),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? T.teal : null),
    ),
  );
}
